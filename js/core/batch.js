import { SCORE_KEYS, normaliseWeights } from './score.js';
import { evalCell, preparePatient, planSplit, summarisePlan, partsOf, rankRows } from './route.js';
import { compareText } from './stats.js';

const GATE_NAMES = ['covers', 'load', 'reach', 'deadline', 'capacity'];

const excludedCounts = rows => {
  const out = {};
  GATE_NAMES.forEach(g => {
    const n = rows.filter(r => !r.gates[g]).length;
    if (n) out[g] = n;
  });
  return out;
};

const aggregate = (model, results) => {
  const placed = results.filter(r => r.status !== 'unplaced');
  const n = placed.length || 1;
  let km = 0;
  let ttc = 0;
  let wait = 0;
  let cost = 0;
  let pub = 0;
  let near = 0;
  placed.forEach(r => {
    km += r.summary.km;
    ttc += r.summary.ttc;
    wait += r.summary.wait;
    cost += r.summary.cost;
    if (r.stops.every(s => s.row.facility.tier === 'public')) pub += 1;
    r.stops.forEach(s => { if (s.row.load >= model.cfg.nearFull) near += 1; });
  });
  return {
    placed: placed.length,
    unplaced: results.length - placed.length,
    avgKm: km / n,
    avgTtc: ttc / n,
    avgWait: wait / n,
    avgCost: cost / n,
    publicShare: pub / n,
    nearFull: near
  };
};

export const routeBatch = (model, patients, options = {}) => {
  const cfg = model.cfg;
  const wn = normaliseWeights(cfg.weights, SCORE_KEYS);
  const count = model.facilities.length;
  const listed = (options.order || cfg.order) === 'listed';
  const progress = options.onProgress || null;
  const prepared = patients.map(p => preparePatient(model, p));
  const processing = listed ? prepared.slice() : prepared.slice().sort((a, b) => compareText(a.id, b.id));
  const assigned = new Float64Array(count);
  const resultById = new Map();
  const sequence = [];
  let done = 0;

  const evalAll = pp => {
    const rows = new Array(count);
    for (let fi = 0; fi < count; fi++) rows[fi] = evalCell(model, pp, fi, assigned[fi], true, wn);
    return rows;
  };

  const tick = () => {
    done += 1;
    if (progress && (done % 25 === 0 || done === prepared.length)) progress(done, prepared.length);
  };

  const record = (pp, result) => {
    resultById.set(pp.id, { pp, id: pp.id, name: pp.name, urgency: pp.urgency, ...result });
    sequence.push(pp);
    tick();
  };

  const placeSingle = (pp, rows, ranked) => {
    const top = ranked[0];
    const second = ranked.length > 1 ? ranked[1] : null;
    const margin = second ? top.total - second.total : null;
    assigned[top.fi] += 1;
    const parts = partsOf(top, wn);
    const stops = [{ fi: top.fi, id: top.id, needs: pp.needs.slice(), row: top }];
    record(pp, {
      status: 'single',
      stops,
      summary: summarisePlan(model, pp, stops),
      parts,
      s: top.s,
      margin,
      excluded: excludedCounts(rows),
      reason: margin === null ? 'only option' : margin > cfg.marginClear ? 'clear lead' : margin > cfg.marginModerate ? 'moderate lead' : 'near tie'
    });
  };

  const placeDeferred = pp => {
    const rows = evalAll(pp);
    const ranked = rankRows(rows);
    if (ranked.length) {
      placeSingle(pp, rows, ranked);
      return;
    }
    const split = planSplit(model, pp, rows);
    if (split.stops.length) {
      split.stops.forEach(stop => { assigned[stop.row.fi] += 1; });
      const stops = split.stops.map(stop => ({ fi: stop.row.fi, id: stop.row.id, needs: stop.needs, row: stop.row }));
      record(pp, {
        status: 'split',
        stops,
        summary: summarisePlan(model, pp, split.stops),
        parts: null,
        s: null,
        margin: null,
        excluded: excludedCounts(rows),
        reason: 'split plan'
      });
    } else {
      record(pp, {
        status: 'unplaced',
        stops: [],
        summary: null,
        parts: null,
        s: null,
        margin: null,
        excluded: excludedCounts(rows),
        reason: split.blocked ? split.blocked.reason : 'No feasible site',
        blocked: split.blocked
      });
    }
  };

  const placeListed = group => {
    const deferred = [];
    group.forEach(pp => {
      const rows = evalAll(pp);
      const ranked = rankRows(rows);
      if (ranked.length) placeSingle(pp, rows, ranked);
      else deferred.push(pp);
    });
    return deferred;
  };

  const placeRegret = group => {
    const n = group.length;
    const deferred = [];
    if (!n) return deferred;
    const keys = new Float64Array(n * count);
    const feasible = new Uint8Array(n * count);
    const stamp = new Int32Array(n * count).fill(-1);
    const facilityStamp = new Int32Array(count);
    const best = new Int32Array(n).fill(-1);
    const second = new Int32Array(n).fill(-1);
    const alive = new Uint8Array(n).fill(1);
    let remaining = n;

    const scan = q => {
      let b = -1;
      let s = -1;
      const base = q * count;
      for (let fi = 0; fi < count; fi++) {
        const idx = base + fi;
        if (stamp[idx] !== facilityStamp[fi]) {
          const cell = evalCell(model, group[q], fi, assigned[fi], true, wn);
          feasible[idx] = cell.G ? 1 : 0;
          keys[idx] = cell.key;
          stamp[idx] = facilityStamp[fi];
        }
        if (!feasible[idx]) continue;
        const key = keys[idx];
        if (b < 0 || key > keys[base + b]) {
          s = b;
          b = fi;
        } else if (s < 0 || key > keys[base + s]) {
          s = fi;
        }
      }
      best[q] = b;
      second[q] = s;
    };

    const retire = q => {
      alive[q] = 0;
      remaining -= 1;
    };

    for (let q = 0; q < n; q++) {
      scan(q);
      if (best[q] < 0) {
        retire(q);
        deferred.push(group[q]);
      }
    }

    while (remaining > 0) {
      let pick = -1;
      let pickRegret = -2;
      for (let q = 0; q < n; q++) {
        if (!alive[q]) continue;
        const regret = second[q] < 0 ? Infinity : keys[q * count + best[q]] - keys[q * count + second[q]];
        if (regret > pickRegret) {
          pickRegret = regret;
          pick = q;
        }
      }
      const pp = group[pick];
      const rows = evalAll(pp);
      const ranked = rankRows(rows);
      retire(pick);
      if (!ranked.length) {
        deferred.push(pp);
        continue;
      }
      const chosen = ranked[0].fi;
      placeSingle(pp, rows, ranked);
      facilityStamp[chosen] += 1;
      for (let q = 0; q < n; q++) {
        if (!alive[q]) continue;
        if (best[q] === chosen || second[q] === chosen) {
          scan(q);
          if (best[q] < 0) {
            retire(q);
            deferred.push(group[q]);
          }
        }
      }
    }
    return deferred;
  };

  [2, 1, 0].forEach(u => {
    const group = processing.filter(pp => pp.urgency === u);
    const deferred = listed ? placeListed(group) : placeRegret(group);
    const ordered = listed ? deferred : deferred.slice().sort((a, b) => compareText(a.id, b.id));
    ordered.forEach(placeDeferred);
  });

  const results = prepared.map(pp => resultById.get(pp.id));
  const baselineAssigned = new Float64Array(count);
  const baselineById = new Map();
  sequence.forEach(pp => {
    let pick = null;
    for (let fi = 0; fi < count; fi++) {
      const cell = evalCell(model, pp, fi, baselineAssigned[fi], true, wn);
      if (!cell.G) continue;
      if (pick === null || cell.hours < pick.hours) pick = cell;
    }
    if (pick) {
      baselineAssigned[pick.fi] += 1;
      const stops = [{ fi: pick.fi, id: pick.id, needs: pp.needs.slice(), row: pick }];
      baselineById.set(pp.id, { id: pp.id, status: 'single', stops, summary: summarisePlan(model, pp, stops) });
    } else {
      baselineById.set(pp.id, { id: pp.id, status: 'unplaced', stops: [], summary: null });
    }
  });
  const baselineResults = prepared.map(pp => baselineById.get(pp.id));

  const loads = model.facilities.map((f, fi) => ({
    id: f.id,
    assigned: assigned[fi],
    capacity: f.capacity,
    before: f.capacity > 0 ? (f.lambda * cfg.horizon + f.waitlist) / (f.capacity * cfg.horizon) : 1,
    after: f.capacity > 0 ? (f.lambda * cfg.horizon + f.waitlist + assigned[fi]) / (f.capacity * cfg.horizon) : 1,
    room: Math.max(0, f.capacity * cfg.horizon - f.lambda * cfg.horizon - f.waitlist)
  }));

  return {
    results,
    sequence: sequence.map(pp => pp.id),
    loads,
    summary: aggregate(model, results),
    baseline: { results: baselineResults, summary: aggregate(model, baselineResults) }
  };
};

const slimStop = (model, stop) => ({
  id: stop.id,
  fi: stop.fi,
  name: stop.row.facility.name,
  tier: stop.row.facility.tier,
  needs: stop.needs,
  km: stop.row.km,
  ttc: stop.row.ttc,
  wait: stop.row.wait,
  cost: stop.row.cost,
  load: stop.row.load,
  total: stop.row.total
});

const slimResult = (model, r) => ({
  id: r.id,
  name: r.name,
  urgency: r.urgency,
  status: r.status,
  reason: r.reason || '',
  margin: r.margin === undefined ? null : r.margin,
  excluded: r.excluded || {},
  parts: r.parts || null,
  s: r.s || null,
  summary: r.summary,
  blocked: r.blocked || null,
  stops: r.stops.map(stop => slimStop(model, stop))
});

export const slimBatch = (model, batch) => ({
  results: batch.results.map(r => slimResult(model, r)),
  sequence: batch.sequence,
  loads: batch.loads,
  summary: batch.summary,
  baseline: { summary: batch.baseline.summary, results: batch.baseline.results.map(r => slimResult(model, r)) }
});
