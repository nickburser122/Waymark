import { clamp, percentile, haversineKm, euclidKm, tieKey, compareText, fmtNum } from './stats.js';
import { priorityWaits } from './queue.js';
import { fnv1a, canonical } from './hash.js';
import { ENGINE_VERSION } from './version.js';
import { paramsToJSON } from './params.js';
import { SCORE_KEYS, normaliseWeights, timeScore, costScore, loadScore, shrinkQuality, utilisation } from './score.js';

const perUrgency = (params, prefix) => [params[`${prefix}Routine`], params[`${prefix}Soon`], params[`${prefix}Urgent`]];

export const routeConfig = params => ({
  tau: perUrgency(params, 'tau'),
  deadline: perUrgency(params, 'deadline'),
  reach: perUrgency(params, 'reach'),
  beta: perUrgency(params, 'beta'),
  shares: perUrgency(params, 'share'),
  eta: params.eta,
  speed: params.speed,
  rhoMax: params.rhoMax,
  horizon: params.horizon,
  shrinkK: params.shrinkK,
  caSq: params.caSq,
  csSq: params.csSq,
  tier: { public: params.tierPublic, contracted: params.tierContracted, private: params.tierPrivate },
  costLow: params.costLow,
  costHigh: params.costHigh,
  marginClear: params.marginClear,
  marginModerate: params.marginModerate,
  robustStep: params.robustStep,
  nearFull: params.nearFull,
  maxStops: Math.max(1, Math.round(params.maxStops)),
  waitCap: params.waitCap,
  defaultComplexity: params.defaultComplexity,
  qualityFallback: params.qualityFallback,
  publicLock: params.publicLock === 1,
  overrideReserve: params.overrideReserve,
  overrideReachMult: params.overrideReachMult,
  overrideTolerance: params.overrideTolerance,
  order: params.batchOrder === 1 ? 'listed' : 'regret',
  weights: { T: params.wT, C: params.wC, P: params.wP, L: params.wL, Q: params.wQ, K: params.wK }
});

const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export const prepareRouting = (data, params) => {
  const cfg = routeConfig(params);
  const services = new Map(data.services.map(service => [service.id, service]));
  const sorted = data.facilities.slice().sort((a, b) => compareText(a.id, b.id));
  const multipliers = sorted.map(f => f.multiplier);
  let reviewTotal = 0;
  let reviewQuality = 0;
  const qualities = [];
  sorted.forEach(f => {
    if (f.quality !== null && f.quality !== undefined) {
      qualities.push(f.quality);
      reviewTotal += f.reviews || 0;
      reviewQuality += (f.reviews || 0) * f.quality;
    }
  });
  const prior = reviewTotal > 0 ? reviewQuality / reviewTotal : qualities.length ? qualities.reduce((a, b) => a + b, 0) / qualities.length : cfg.qualityFallback;
  const facilities = sorted.map((f, fi) => {
    const capacity = f.capacity;
    const waitlist = finiteOr(f.waitlist, 0);
    const lambdaObserved = Number.isFinite(f.referrals);
    const lambda = finiteOr(f.referrals, waitlist / cfg.horizon);
    const rho = capacity > 0 ? lambda / capacity : lambda > 0 ? Infinity : 0;
    const waits = priorityWaits(lambda, capacity, 1, cfg.caSq, cfg.csSq, [cfg.shares[2], cfg.shares[1], cfg.shares[0]]);
    const hasQuality = f.quality !== null && f.quality !== undefined;
    return {
      fi,
      id: f.id,
      name: f.name,
      tier: f.tier,
      lat: f.lat,
      lon: f.lon,
      x: f.x,
      y: f.y,
      services: new Set(f.services),
      capacity,
      waitlist,
      lambda,
      lambdaObserved,
      inflow: lambdaObserved ? lambda * cfg.horizon : 0,
      rho,
      wq: [waits[2], waits[1], waits[0]],
      multiplier: f.multiplier,
      quality: hasQuality ? f.quality : prior,
      reviews: hasQuality ? f.reviews || 0 : 0,
      shrunk: shrinkQuality(hasQuality ? f.reviews || 0 : 0, hasQuality ? f.quality : prior, cfg.shrinkK, prior),
      tierValue: finiteOr(cfg.tier[f.tier], 0)
    };
  });
  const travel = new Map();
  (data.travel || []).forEach(t => travel.set(`${t.patient}\u0001${t.facility}`, t.minutes));
  return {
    cfg,
    services,
    facilities,
    facilityIndex: new Map(facilities.map(f => [f.id, f.fi])),
    travel,
    priceLow: percentile(multipliers, cfg.costLow),
    priceHigh: percentile(multipliers, cfg.costHigh),
    qualityPrior: prior
  };
};

const serviceName = (model, id) => (model.services.has(id) ? model.services.get(id).name : id);

export const preparePatient = (model, patient) => {
  const cfg = model.cfg;
  const count = model.facilities.length;
  const km = new Float64Array(count);
  const hours = new Float64Array(count);
  const covers = new Uint8Array(count);
  let kappa = 0;
  let basePrice = 0;
  patient.needs.forEach(need => {
    const service = model.services.get(need);
    kappa = Math.max(kappa, service ? service.complexity : cfg.defaultComplexity);
    basePrice += service ? service.price : 0;
  });
  if (kappa === 0) kappa = cfg.defaultComplexity;
  const hasGeo = Number.isFinite(patient.lat) && Number.isFinite(patient.lon);
  const hasXy = Number.isFinite(patient.x) && Number.isFinite(patient.y);
  model.facilities.forEach((f, fi) => {
    const minutes = model.travel.get(`${patient.id}\u0001${f.id}`);
    if (minutes !== undefined && Number.isFinite(minutes)) {
      hours[fi] = minutes / 60;
      km[fi] = hours[fi] * cfg.speed;
    } else {
      let straight = Infinity;
      if (hasGeo && Number.isFinite(f.lat) && Number.isFinite(f.lon)) straight = haversineKm(patient.lat, patient.lon, f.lat, f.lon);
      else if (hasXy && Number.isFinite(f.x) && Number.isFinite(f.y)) straight = euclidKm(patient.x, patient.y, f.x, f.y);
      km[fi] = cfg.eta * straight;
      hours[fi] = km[fi] / cfg.speed;
    }
    covers[fi] = patient.needs.every(need => f.services.has(need)) ? 1 : 0;
  });
  return {
    source: patient,
    id: patient.id,
    name: patient.name || patient.id,
    urgency: patient.urgency,
    needs: patient.needs.slice(),
    previous: patient.previous || '',
    kappa,
    basePrice,
    km,
    hours,
    covers
  };
};

export const scoreDot = (wn, s) => wn.T * s.T + wn.C * s.C + wn.P * s.P + wn.L * s.L + wn.Q * s.Q + wn.K * s.K;

export const evalCell = (model, pp, fi, assigned, capacityGate, wn) => {
  const cfg = model.cfg;
  const f = model.facilities[fi];
  const u = pp.urgency;
  const km = pp.km[fi];
  const backlog = f.waitlist + assigned;
  let wait;
  if (f.capacity > 0) wait = pp.kappa * (backlog / f.capacity * cfg.beta[u] + f.wq[u]);
  else wait = Infinity;
  if (!(wait <= cfg.waitCap)) wait = cfg.waitCap;
  const ttc = pp.hours[fi] / 24 + wait;
  const load = f.capacity > 0 ? utilisation(f.lambda, backlog, f.capacity, cfg.horizon, f.lambdaObserved) : Infinity;
  const s = {
    T: timeScore(ttc, cfg.tau[u]),
    C: costScore(f.multiplier, model.priceLow, model.priceHigh),
    P: f.tierValue,
    L: loadScore(load),
    Q: f.shrunk,
    K: pp.previous === f.id ? 1 : 0
  };
  const gates = {
    covers: pp.covers[fi] === 1,
    load: f.rho < cfg.rhoMax,
    reach: km <= cfg.reach[u],
    deadline: ttc <= cfg.deadline[u],
    capacity: !capacityGate || load <= 1
  };
  const relaxed = gates.load && gates.reach && gates.deadline && gates.capacity;
  const G = relaxed && gates.covers;
  const raw = scoreDot(wn, s);
  return {
    fi,
    id: f.id,
    facility: f,
    km,
    hours: pp.hours[fi],
    backlog,
    wait,
    ttc,
    load,
    s,
    gates,
    G,
    relaxed,
    raw,
    total: G ? raw : 0,
    relaxedTotal: relaxed ? raw : 0,
    key: G ? tieKey(raw) : -1,
    cost: pp.basePrice * f.multiplier
  };
};

export const partsOf = (row, wn) => ({
  T: wn.T * row.s.T,
  C: wn.C * row.s.C,
  P: wn.P * row.s.P,
  L: wn.L * row.s.L,
  Q: wn.Q * row.s.Q,
  K: wn.K * row.s.K
});

export const gateReasons = (model, pp, row) => {
  const cfg = model.cfg;
  const u = pp.urgency;
  const out = [];
  if (!row.gates.covers) {
    const missing = pp.needs.filter(need => !row.facility.services.has(need)).map(need => serviceName(model, need));
    out.push(`Missing ${missing.join(', ')}`);
  }
  if (!row.gates.load) out.push(`Booked beyond ${fmtNum(cfg.rhoMax * 100)}% load`);
  if (!row.gates.reach) out.push(Number.isFinite(row.km) ? `${Math.round(row.km)} km > ${fmtNum(cfg.reach[u])} km reach` : 'No travel data');
  if (!row.gates.deadline) out.push(`${row.ttc.toFixed(1)} d > ${fmtNum(cfg.deadline[u])} d deadline`);
  if (!row.gates.capacity) out.push('Full this week');
  if (row.lockedOut) out.push('Held back by the public-first lock');
  return out;
};

const better = (a, b) => (a.key !== b.key ? a.key > b.key : a.fi < b.fi);

export const rankRows = (rows, lock = false) => {
  const ranked = rows.filter(r => r.G).sort((a, b) => (better(a, b) ? -1 : 1));
  if (!lock) return ranked;
  const open = ranked.filter(r => r.facility.tier === 'public');
  return open.length ? open : ranked;
};

export const confidenceLabel = (margin, count, cfg) => {
  if (count === 0) return 'None';
  if (margin === null) return 'Only option';
  if (margin > cfg.marginClear) return 'Clear lead';
  if (margin > cfg.marginModerate) return 'Moderate lead';
  return 'Near tie';
};

const blockedBy = (model, pp, rows, remaining) => {
  const cfg = model.cfg;
  const u = pp.urgency;
  const names = remaining.map(need => serviceName(model, need)).join(', ');
  const offering = rows.filter(r => remaining.some(need => r.facility.services.has(need)));
  if (!offering.length) return { gate: 'covers', reason: `No site offers ${names}` };
  const tally = { reach: 0, deadline: 0, load: 0, capacity: 0 };
  offering.forEach(r => {
    Object.keys(tally).forEach(g => { if (!r.gates[g]) tally[g] += 1; });
  });
  const gate = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || compareText(a, b))[0];
  if (tally[gate] === 0) return { gate: 'stops', reason: `Needs exceed ${cfg.maxStops} sites` };
  const text = {
    reach: `Sites for ${names} are beyond ${fmtNum(cfg.reach[u])} km reach`,
    deadline: `Sites for ${names} miss the ${fmtNum(cfg.deadline[u])} d deadline`,
    load: `Sites for ${names} are fully loaded`,
    capacity: `Sites for ${names} are full this week`
  };
  return { gate, reason: text[gate] };
};

const greedySplit = (model, pp, rows, score, minimum, stages = [() => true]) => {
  const cfg = model.cfg;
  let remaining = pp.needs.slice();
  const used = new Set();
  const stops = [];
  stages.forEach(allowed => {
    while (remaining.length && stops.length < cfg.maxStops) {
      let best = null;
      let bestKey = minimum;
      rows.forEach(row => {
        if (used.has(row.fi) || !row.relaxed || !allowed(row)) return;
        const covered = remaining.filter(need => row.facility.services.has(need));
        if (!covered.length) return;
        const key = score(row, covered);
        if (key > bestKey) {
          bestKey = key;
          best = { row, needs: covered };
        }
      });
      if (!best) break;
      used.add(best.row.fi);
      stops.push(best);
      remaining = remaining.filter(need => !best.needs.includes(need));
    }
  });
  if (remaining.length) return { stops: [], blocked: { needs: remaining, ...blockedBy(model, pp, rows, remaining) } };
  return { stops, blocked: null };
};

const lockStages = model => (model.cfg.publicLock ? [row => row.facility.tier === 'public', () => true] : [() => true]);

export const planSplit = (model, pp, rows) => greedySplit(model, pp, rows, (row, covered) => tieKey(row.raw * covered.length), 0, lockStages(model));

export const planSplitNearest = (model, pp, rows) => greedySplit(model, pp, rows, (row, covered) => covered.length - row.hours / 1e6, -Infinity, lockStages(model));

export const summarisePlan = (model, pp, stops) => {
  const needCount = pp.needs.length || 1;
  let cost = 0;
  let km = 0;
  let ttc = 0;
  let wait = 0;
  let score = 0;
  stops.forEach(stop => {
    const price = stop.needs.reduce((a, need) => a + (model.services.has(need) ? model.services.get(need).price : 0), 0);
    cost += price * stop.row.facility.multiplier;
    km += stop.row.km;
    ttc = Math.max(ttc, stop.row.ttc);
    wait = Math.max(wait, stop.row.wait);
    score += (stops.length === 1 ? stop.row.total : stop.row.raw * stop.needs.length / needCount);
  });
  return { cost, km, ttc, wait, score };
};

const toAssignedArray = (model, assigned) => {
  if (Array.isArray(assigned) || assigned instanceof Float64Array) return assigned;
  const out = new Array(model.facilities.length).fill(0);
  Object.keys(assigned || {}).forEach(id => {
    const fi = model.facilityIndex.get(id);
    if (fi !== undefined) out[fi] = assigned[id];
  });
  return out;
};

export const routePatient = (model, patient, options = {}) => {
  const cfg = model.cfg;
  const weights = options.weights || cfg.weights;
  const wn = normaliseWeights(weights, SCORE_KEYS);
  const pp = options.prepared || preparePatient(model, patient);
  const assigned = toAssignedArray(model, options.assigned);
  const rows = model.facilities.map((f, fi) => {
    const row = evalCell(model, pp, fi, assigned[fi] || 0, !!options.capacityGate, wn);
    row.parts = partsOf(row, wn);
    return row;
  });
  const ranked = rankRows(rows, model.cfg.publicLock);
  rows.forEach(row => { row.lockedOut = row.G && !ranked.includes(row); });
  let stops = [];
  let status = 'none';
  let blocked = null;
  if (ranked.length) {
    stops = [{ row: ranked[0], needs: pp.needs.slice() }];
    status = 'single';
  } else {
    const split = planSplit(model, pp, rows);
    stops = split.stops;
    blocked = split.blocked;
    status = stops.length ? 'split' : 'none';
  }
  const margin = status === 'single' && ranked.length > 1 ? ranked[0].total - ranked[1].total : null;
  return {
    pp,
    wn,
    rows,
    ranked,
    stops,
    status,
    blocked,
    margin,
    confidence: status === 'single' ? confidenceLabel(margin, ranked.length, cfg) : status === 'split' ? 'Split plan' : 'None',
    summary: stops.length ? summarisePlan(model, pp, stops) : null
  };
};

export const robustness = (model, result, weights) => {
  const cfg = model.cfg;
  const base = weights || cfg.weights;
  if (result.status !== 'single') return null;
  if (result.ranked.length < 2) return { holds: true, only: true, flip: null };
  const winner = result.ranked[0];
  const names = { T: 'Time', C: 'Cost', P: 'Public', L: 'Load', Q: 'Quality', K: 'Continuity' };
  for (const key of SCORE_KEYS) {
    for (const direction of [1, -1]) {
      const shifted = { ...base, [key]: clamp(base[key] + direction * cfg.robustStep, 0, 100) };
      if (shifted[key] === base[key]) continue;
      const wn = normaliseWeights(shifted, SCORE_KEYS);
      let top = null;
      result.ranked.forEach(row => {
        const candidate = { fi: row.fi, key: tieKey(scoreDot(wn, row.s)), row };
        if (top === null || candidate.key > top.key || (candidate.key === top.key && candidate.fi < top.fi)) top = candidate;
      });
      if (top.fi !== winner.fi) {
        return { holds: false, only: false, flip: { key, name: names[key], direction, step: cfg.robustStep, to: top.row.facility } };
      }
    }
  }
  return { holds: true, only: false, flip: null };
};

export const runId = (pp, params, dataFingerprint, extra = {}) => fnv1a(canonical({
  v: ENGINE_VERSION,
  p: { id: pp.id, needs: pp.needs, urgency: pp.urgency, previous: pp.previous, lat: pp.source.lat, lon: pp.source.lon, x: pp.source.x, y: pp.source.y },
  params: paramsToJSON(params),
  data: dataFingerprint,
  ...extra
}));

export const integrityChecks = (model, result, options = {}) => {
  const checks = [];
  const pp = result.pp;
  const weightSum = SCORE_KEYS.reduce((a, k) => a + result.wn[k], 0);
  checks.push({
    ok: weightSum === 0 || Math.abs(weightSum - 1) < 1e-9,
    label: 'Weights are normalised',
    detail: `Sum of weights ${weightSum.toFixed(6)}`
  });
  const badRaw = result.rows.filter(r => !(r.raw >= 0 && r.raw <= 1 + 1e-12));
  checks.push({
    ok: badRaw.length === 0,
    label: 'Every raw score lies in 0 to 1',
    detail: badRaw.length ? `${badRaw.length} outside: ${badRaw.slice(0, 3).map(r => r.facility.name).join(', ')}` : `${result.rows.length} sites checked`
  });
  let sorted = true;
  for (let i = 1; i < result.ranked.length; i++) {
    const a = result.ranked[i - 1];
    const b = result.ranked[i];
    if (a.key < b.key || (a.key === b.key && a.fi > b.fi)) sorted = false;
  }
  checks.push({ ok: sorted, label: 'Ranking order is score, then list order', detail: `${result.ranked.length} ranked` });
  const stopsOk = result.stops.every(stop => (result.status === 'single' ? stop.row.G : stop.row.relaxed));
  checks.push({
    ok: stopsOk,
    label: result.status === 'split' ? 'Every stop passes the relaxed gates' : 'The chosen site passes every gate',
    detail: result.stops.length ? result.stops.map(stop => stop.row.facility.name).join(', ') : 'No stops'
  });
  const again = routePatient(model, pp.source, { ...options, prepared: pp });
  const same = again.ranked.length === result.ranked.length && again.ranked.every((r, i) => r.id === result.ranked[i].id);
  checks.push({ ok: same, label: 'A second run gives the same ranking', detail: `${again.ranked.length} ranked again` });
  const unexplained = result.rows.filter(r => !r.G && gateReasons(model, pp, r).length === 0);
  checks.push({
    ok: unexplained.length === 0,
    label: 'Every excluded site has a reason',
    detail: unexplained.length ? `${unexplained.length} without one` : `${result.rows.length - result.ranked.length} excluded`
  });
  if (result.status === 'single') {
    const top = result.ranked[0];
    const parts = partsOf(top, result.wn);
    const total = SCORE_KEYS.reduce((a, k) => a + parts[k], 0);
    checks.push({ ok: Math.abs(total - top.total) <= 1e-12, label: 'The parts add up to the winner score', detail: `${total.toFixed(6)} against ${top.total.toFixed(6)}` });
  } else {
    checks.push({ ok: true, label: 'The parts add up to the winner score', detail: 'No single winner' });
  }
  return checks;
};

export const contributionGap = result => {
  if (result.status !== 'single' || result.ranked.length < 2) return null;
  const a = result.ranked[0];
  const b = result.ranked[1];
  const terms = SCORE_KEYS.map(k => ({ key: k, delta: a.parts[k] - b.parts[k] }));
  const decisive = terms.reduce((x, y) => (y.delta > x.delta ? y : x));
  return { winner: a, runnerUp: b, margin: a.total - b.total, terms, decisive };
};

export const nearestFeasible = result => {
  let pick = null;
  result.rows.forEach(row => {
    if (!row.G) return;
    if (pick === null || row.hours < pick.hours) pick = row;
  });
  return pick;
};

export const GATE_ORDER = Object.freeze(['covers', 'deadline', 'reach', 'load', 'capacity']);

export const firstFailingGate = row => GATE_ORDER.find(g => !row.gates[g]) || (row.lockedOut ? 'lock' : null);

export const gateFunnel = result => {
  const split = result.status === 'split';
  const needs = result.pp.needs;
  let rows = result.rows.slice();
  const steps = [{ key: 'all', label: 'All sites', count: rows.length }];
  const stage = (key, label, test) => {
    rows = rows.filter(test);
    steps.push({ key, label, count: rows.length });
  };
  if (split) stage('covers', 'offer some needs', r => needs.some(n => r.facility.services.has(n)));
  else stage('covers', 'offer every need', r => r.gates.covers);
  stage('deadline', 'meet the deadline', r => r.gates.deadline);
  stage('reach', 'within reach', r => r.gates.reach);
  stage('load', 'below the load limit', r => r.gates.load);
  if (result.rows.some(r => !r.gates.capacity)) stage('capacity', 'have free slots', r => r.gates.capacity);
  if (result.rows.some(r => r.lockedOut)) stage('lock', 'public only', r => !r.lockedOut);
  steps.push({ key: 'scored', label: split ? 'used in the plan' : 'scored', count: split ? result.stops.length : rows.length });
  return steps;
};

export const flipThresholds = (result, weights, key) => {
  if (result.status !== 'single' || !result.ranked.length) return null;
  const others = SCORE_KEYS.filter(k => k !== key);
  const total = others.reduce((a, k) => a + weights[k], 0);
  const share = k => (total > 0 ? weights[k] / total : 1 / others.length);
  const lines = result.ranked.map(r => {
    const a = others.reduce((acc, k) => acc + share(k) * r.s[k], 0);
    return { row: r, a, b: (r.s[key] - a) / 100 };
  });
  const top = t => lines.reduce((best, l) => {
    const v = tieKey(l.a + l.b * t);
    const bv = tieKey(best.a + best.b * t);
    return v > bv || (v === bv && l.row.fi < best.row.fi) ? l : best;
  });
  const runs = [];
  let t = 0;
  let current = top(1e-7);
  while (t < 100) {
    let next = 100;
    lines.forEach(l => {
      if (l === current || l.b <= current.b) return;
      const cross = (current.a - l.a) / (l.b - current.b);
      if (cross > t + 1e-9 && cross < next) next = cross;
    });
    const last = runs[runs.length - 1];
    if (last && last.id === current.row.id) last.to = next;
    else runs.push({ id: current.row.id, from: t, to: next, facility: current.row.facility });
    t = next;
    if (t < 100) current = top(t + 1e-7);
  }
  const sum = SCORE_KEYS.reduce((a, k) => a + weights[k], 0);
  return { key, runs, changes: runs.length - 1, now: sum > 0 ? (weights[key] / sum) * 100 : 0 };
};
