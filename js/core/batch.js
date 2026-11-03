import { SCORE_KEYS, normaliseWeights } from './score.js';
import { evalCell, preparePatient, planSplit, planSplitNearest, summarisePlan, partsOf, rankRows, confidenceLabel } from './route.js';
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

const TIERS = ['public', 'contracted', 'private'];

const aggregate = (model, results, assigned) => {
  const placed = results.filter(r => r.status !== 'unplaced');
  const n = placed.length || 1;
  let km = 0;
  let ttc = 0;
  let wait = 0;
  let cost = 0;
  let pub = 0;
  let near = 0;
  const tierMix = { public: 0, contracted: 0, private: 0 };
  placed.forEach(r => {
    km += r.summary.km;
    ttc += r.summary.ttc;
    wait += r.summary.wait;
    cost += r.summary.cost;
    if (r.stops.every(s => s.row.facility.tier === 'public')) pub += 1;
    r.stops.forEach(s => {
      if (s.row.load >= model.cfg.nearFull) near += 1;
      if (TIERS.includes(s.row.facility.tier)) tierMix[s.row.facility.tier] += 1;
    });
  });
  const horizon = model.cfg.horizon;
  const publicRoom = model.facilities.reduce((a, f) => (f.tier === 'public' ? a + Math.max(0, f.capacity * horizon - f.inflow - f.waitlist) : a), 0);
  const after = model.facilities.map((f, fi) => (f.capacity > 0 ? (f.inflow + f.waitlist + assigned[fi]) / (f.capacity * horizon) : 1));
  const meanAfter = after.length ? after.reduce((a, b) => a + b, 0) / after.length : 0;
  const loadSpread = after.length ? Math.sqrt(after.reduce((a, b) => a + (b - meanAfter) * (b - meanAfter), 0) / after.length) : 0;
  return {
    totalCost: cost,
    publicSlotsUsed: publicRoom > 0 ? tierMix.public / publicRoom : 0,
    loadSpread,
    tierMix,
    placed: placed.length,
    split: placed.filter(r => r.status === 'split').length,
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
      reason: confidenceLabel(margin, 1, cfg)
    });
  };

  const placeDeferred = pp => {
    const rows = evalAll(pp);
    const ranked = rankRows(rows, cfg.publicLock);
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
        reason: 'Split plan'
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
      const ranked = rankRows(rows, cfg.publicLock);
      if (ranked.length) placeSingle(pp, rows, ranked);
      else deferred.push(pp);
    });
    return deferred;
  };

  const heapBefore = (x, y) => x.regret > y.regret || (x.regret === y.regret && x.q < y.q);

  const heapPush = (heap, item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!heapBefore(heap[i], heap[parent])) break;
      const tmp = heap[i];
      heap[i] = heap[parent];
      heap[parent] = tmp;
      i = parent;
    }
  };

  const heapPop = heap => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let next = i;
        if (left < heap.length && heapBefore(heap[left], heap[next])) next = left;
        if (right < heap.length && heapBefore(heap[right], heap[next])) next = right;
        if (next === i) break;
        const tmp = heap[i];
        heap[i] = heap[next];
        heap[next] = tmp;
        i = next;
      }
    }
    return top;
  };

  const placeRegret = group => {
    const n = group.length;
    const deferred = [];
    if (!n) return deferred;
    const offsets = new Int32Array(n + 1);
    for (let q = 0; q < n; q++) {
      const covers = group[q].covers;
      let c = 0;
      for (let fi = 0; fi < count; fi++) if (covers[fi] === 1) c += 1;
      offsets[q + 1] = offsets[q] + c;
    }
    const total = offsets[n];
    const fiList = new Int32Array(total);
    for (let q = 0; q < n; q++) {
      const covers = group[q].covers;
      let at = offsets[q];
      for (let fi = 0; fi < count; fi++) if (covers[fi] === 1) fiList[at++] = fi;
    }
    const keys = new Float64Array(total);
    const feasible = new Uint8Array(total);
    const stamp = new Int32Array(total).fill(-1);
    const facilityStamp = new Int32Array(count);
    const isPublic = model.facilities.map(f => f.tier === 'public');
    const best = new Int32Array(n).fill(-1);
    const second = new Int32Array(n).fill(-1);
    const bestAt = new Int32Array(n).fill(-1);
    const secondAt = new Int32Array(n).fill(-1);
    const version = new Int32Array(n);
    const alive = new Uint8Array(n).fill(1);
    const heap = [];
    const useHeap = options.pick !== 'linear';
    let remaining = n;

    const regretOf = q => (secondAt[q] < 0 ? Infinity : keys[bestAt[q]] - keys[secondAt[q]]);

    const scan = q => {
      let b = -1;
      let s = -1;
      let pb = -1;
      let ps = -1;
      for (let k = offsets[q]; k < offsets[q + 1]; k++) {
        const fi = fiList[k];
        if (stamp[k] !== facilityStamp[fi]) {
          const cell = evalCell(model, group[q], fi, assigned[fi], true, wn);
          feasible[k] = cell.G ? 1 : 0;
          keys[k] = cell.key;
          stamp[k] = facilityStamp[fi];
        }
        if (!feasible[k]) continue;
        const key = keys[k];
        if (b < 0 || key > keys[b]) {
          s = b;
          b = k;
        } else if (s < 0 || key > keys[s]) {
          s = k;
        }
        if (isPublic[fi]) {
          if (pb < 0 || key > keys[pb]) {
            ps = pb;
            pb = k;
          } else if (ps < 0 || key > keys[ps]) {
            ps = k;
          }
        }
      }
      if (cfg.publicLock && pb >= 0) {
        b = pb;
        s = ps;
      }
      bestAt[q] = b;
      secondAt[q] = s;
      best[q] = b < 0 ? -1 : fiList[b];
      second[q] = s < 0 ? -1 : fiList[s];
      version[q] += 1;
      if (useHeap && b >= 0) heapPush(heap, { q, version: version[q], regret: regretOf(q) });
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

    const nextPick = () => {
      if (useHeap) {
        while (heap.length) {
          const top = heapPop(heap);
          if (alive[top.q] && top.version === version[top.q]) return top.q;
        }
        return -1;
      }
      let pick = -1;
      let pickRegret = -2;
      for (let q = 0; q < n; q++) {
        if (!alive[q]) continue;
        const regret = regretOf(q);
        if (regret > pickRegret) {
          pickRegret = regret;
          pick = q;
        }
      }
      return pick;
    };

    while (remaining > 0) {
      const pick = nextPick();
      const pp = group[pick];
      const rows = evalAll(pp);
      const ranked = rankRows(rows, cfg.publicLock);
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
    let pickPublic = null;
    const rows = new Array(count);
    for (let fi = 0; fi < count; fi++) {
      const cell = evalCell(model, pp, fi, baselineAssigned[fi], true, wn);
      rows[fi] = cell;
      if (!cell.G) continue;
      if (pick === null || cell.hours < pick.hours) pick = cell;
      if (cell.facility.tier === 'public' && (pickPublic === null || cell.hours < pickPublic.hours)) pickPublic = cell;
    }
    if (cfg.publicLock && pickPublic) pick = pickPublic;
    if (pick) {
      baselineAssigned[pick.fi] += 1;
      const stops = [{ fi: pick.fi, id: pick.id, needs: pp.needs.slice(), row: pick }];
      baselineById.set(pp.id, { id: pp.id, status: 'single', stops, summary: summarisePlan(model, pp, stops) });
      return;
    }
    const split = planSplitNearest(model, pp, rows);
    if (split.stops.length) {
      split.stops.forEach(stop => { baselineAssigned[stop.row.fi] += 1; });
      const stops = split.stops.map(stop => ({ fi: stop.row.fi, id: stop.row.id, needs: stop.needs, row: stop.row }));
      baselineById.set(pp.id, { id: pp.id, status: 'split', stops, summary: summarisePlan(model, pp, split.stops) });
    } else {
      baselineById.set(pp.id, { id: pp.id, status: 'unplaced', stops: [], summary: null });
    }
  });
  const baselineResults = prepared.map(pp => baselineById.get(pp.id));

  const loads = model.facilities.map((f, fi) => ({
    id: f.id,
    assigned: assigned[fi],
    capacity: f.capacity,
    before: f.capacity > 0 ? (f.inflow + f.waitlist) / (f.capacity * cfg.horizon) : 1,
    after: f.capacity > 0 ? (f.inflow + f.waitlist + assigned[fi]) / (f.capacity * cfg.horizon) : 1,
    room: Math.max(0, f.capacity * cfg.horizon - f.inflow - f.waitlist)
  }));

  return {
    results,
    sequence: sequence.map(pp => pp.id),
    loads,
    summary: aggregate(model, results, assigned),
    baseline: { results: baselineResults, summary: aggregate(model, baselineResults, baselineAssigned) }
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
