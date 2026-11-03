import { defaultParams } from '../core/params.js';
import { prepareRouting, routePatient, gateReasons as gateReasonsFor } from '../core/route.js';
import { judgeOverride } from '../core/override.js';
import { createRng } from '../core/rng.js';
import { routeBatch } from '../core/batch.js';
import { validateTables } from '../data/validate.js';
import { priorityWaits } from '../core/queue.js';
import { paramIssues } from '../core/params.js';
import { guardCell, batchCsv } from '../data/export.js';
import { hydrateSettings } from '../data/migrate.js';
import { runFlow } from '../core/flow.js';
import { randomRouting, randomRouteParams } from './props.js';
import { generatePatients } from '../data/synth.js';
import { buildSampleTables } from '../data/samples.js';

const service = { id: 'svc', name: 'svc', price: 100, complexity: 1 };

const facility = (id, over) => ({
  id, name: id, tier: 'public', x: 0, y: 0, services: ['svc'], capacity: 10, multiplier: 1,
  referrals: null, waitlist: 0, quality: 0.8, reviews: 100, ...over
});

const patient = { id: 'p', name: 'p', x: 0, y: 0, needs: ['svc'], urgency: 1, previous: '' };

const rowFor = (facilities, params) => {
  const model = prepareRouting({ services: [service], facilities, patients: [], travel: [] }, params);
  return routePatient(model, patient).rows[0];
};

export const register = t => {
  t.test('B3 a missing referral rate does not double-count the waitlist', () => {
    const params = { ...defaultParams('route'), horizon: 7 };
    t.near(rowFor([facility('a', { waitlist: 70 })], params).load, 71 / 70, 1e-12);
    t.near(rowFor([facility('a', { waitlist: 70, referrals: 2 })], params).load, (14 + 70 + 1) / 70, 1e-12);
    t.near(rowFor([facility('a', { waitlist: 70, referrals: 0 })], params).load, 71 / 70, 1e-12);
  });

  t.test('B3 blank referrals with a waitlist raise a validation warning', () => {
    const tables = buildSampleTables();
    tables.facilities = tables.facilities.map((f, i) => (i === 0 ? { ...f, referrals_per_day: '', waitlist: '12' } : f));
    const result = validateTables(tables, defaultParams());
    t.ok(result.ok, 'still valid');
    t.ok(result.issues.some(i => i.table === 'facilities' && i.row === 0 && i.column === 'referrals_per_day' && i.severity === 'warning'), 'warning present');
  });

  t.test('B4 gaps in clinic hours are filled with zero arrivals and drain the backlog', () => {
    const tables = buildSampleTables();
    tables.arrivals = tables.arrivals.filter(a => ['8', '9', '12'].includes(a.hour));
    const params = defaultParams();
    const result = validateTables(tables, params);
    t.ok(result.ok, 'valid');
    const site = result.clinic.sites[0];
    t.same(site.hours, [8, 9, 10, 11, 12]);
    t.same(site.arrivals.slice(2, 4), [0, 0]);
    t.ok(result.issues.some(i => i.table === 'arrivals' && i.severity === 'warning' && i.message.includes('10–11')), 'gap warning');
    const flow = runFlow(site, params);
    t.same(flow.buckets, 5 * flow.per);
    const station = flow.stations.find(s => s.id === 'rec');
    const bucketOf = hour => (hour - 8) * flow.per + flow.per - 1;
    t.ok(station.bk[bucketOf(11)] <= station.bk[bucketOf(9)] + 1e-9, 'backlog does not grow through the empty hours');
  });

  t.test('B7 the nearest baseline also uses split plans, so unplaced counts are comparable', () => {
    const services = [{ id: 'A', name: 'A', price: 50, complexity: 1 }, { id: 'B', name: 'B', price: 70, complexity: 1 }];
    const facilities = [
      facility('f1', { services: ['A'], x: 5, referrals: 0 }),
      facility('f2', { services: ['B'], x: 9, referrals: 0 }),
      facility('f3', { services: ['A'], x: 80, referrals: 0 })
    ];
    const patients = [
      { id: 'p1', name: 'p1', x: 0, y: 0, needs: ['A', 'B'], urgency: 0, previous: '' },
      { id: 'p2', name: 'p2', x: 0, y: 0, needs: ['A'], urgency: 0, previous: '' }
    ];
    const model = prepareRouting({ services, facilities, patients, travel: [] }, defaultParams('route'));
    const batch = routeBatch(model, patients);
    t.same(batch.summary.unplaced, 0);
    t.same(batch.baseline.summary.unplaced, 0);
    t.same(batch.summary.split, 1);
    t.same(batch.baseline.summary.split, 1);
    const baselineSplit = batch.baseline.results.find(r => r.id === 'p1');
    t.same(baselineSplit.status, 'split');
    t.same(baselineSplit.stops.map(s => s.id).sort(), ['f1', 'f2']);
  });

  t.test('B10 related parameters that contradict each other are reported', () => {
    t.same(paramIssues(defaultParams()), []);
    const bad = { ...defaultParams(), marginModerate: 0.2, marginClear: 0.1, riskMedium: 60, riskHigh: 60, shareRoutine: 0, shareSoon: 0, shareUrgent: 0 };
    t.same(paramIssues(bad).length, 3);
  });

  t.test('B18 priority waits with all shares zero use equal shares and keep the average wait', () => {
    const waits = priorityWaits(3, 4, 1, 1, 0.5, [0, 0, 0]);
    t.ok(waits.every(Number.isFinite), 'finite');
    const mean = waits.reduce((a, b) => a + b, 0) / 3;
    t.near(mean, priorityWaits(3, 4, 1, 1, 0.5, [1, 1, 1]).reduce((a, b) => a + b, 0) / 3, 1e-12);
  });

  t.test('B13 carriage-return formulas are neutralised and batch CSV starts with a byte order mark', () => {
    t.ok(guardCell('\r=1+1').startsWith("'"), 'leading CR guarded');
    const batch = { results: [], sequence: [], loads: [], summary: {}, baseline: { summary: {}, results: [] } };
    t.ok(batchCsv(batch).startsWith('\ufeff'), 'BOM present');
  });

  t.test('B17 an unknown data table in settings falls back to a table of the chosen model', () => {
    const out = hydrateSettings({ dataModel: 'clinic', dataTable: 'nonsense' });
    t.ok(out.dataTable !== 'nonsense');
    t.same(hydrateSettings({ dataModel: 'route', dataTable: 'facilities' }).dataTable, 'facilities');
  });

  t.test('B19 an empty fix effect window raises a warning', () => {
    const tables = buildSampleTables();
    tables.fix_effects = tables.fix_effects.map((e, i) => (i === 0 ? { ...e, from_hour: '12', to_hour: '9' } : e));
    const result = validateTables(tables, defaultParams());
    t.ok(result.issues.some(i => i.table === 'fix_effects' && i.severity === 'warning' && i.column === 'to_hour'));
  });

  const overrideCase = (params, requested, tokenUsed = false, tweak = {}) => {
    const facilities = [
      facility('f1', { x: 5, referrals: 0, quality: 0.9, reviews: 500 }),
      facility('f2', { x: 6, referrals: 0, quality: 0.88, reviews: 500 }),
      facility('f3', { x: 7, referrals: 0, quality: 0.9, reviews: 500, multiplier: 1.5 }),
      facility('f4', { x: 8, referrals: 0, quality: 0.9, reviews: 500, waitlist: 66 })
    ];
    const model = prepareRouting({ services: [service], facilities, patients: [patient], travel: [] }, { ...defaultParams('route'), horizon: 7, ...params });
    const result = routePatient(model, patient, { ...tweak });
    return { result, judgement: judgeOverride(model, result, requested, { tokenUsed }) };
  };

  t.test('WP2 each override outcome has a golden case', () => {
    const first = overrideCase({}, 'f1');
    t.same(first.result.ranked[0].id, 'f1', 'f1 is the engine choice');
    t.same(first.judgement.outcome, 'same');
    t.same(overrideCase({}, 'f2').judgement.outcome, 'approved');
    t.same(overrideCase({ overrideTolerance: 0 }, 'f2').judgement.outcome, 'signoff');
    const copay = overrideCase({ overrideTolerance: 1 }, 'f3').judgement;
    t.same(copay.outcome, 'copay');
    t.ok(copay.copay > 0.005, 'co-pay amount');
    t.same(overrideCase({ overrideTolerance: 1 }, 'f4').judgement.outcome, 'waitlist');
    const denied = overrideCase({}, 'f2', true).judgement;
    t.same(denied.outcome, 'denied');
    t.ok(!denied.rules.find(r => r.id === 'token').pass);
    t.same(overrideCase({ overrideReachMult: 1, reachSoon: 5 }, 'f3').judgement.outcome, 'denied');
    t.same(overrideCase({}, 'missing').judgement, null);
  });

  t.test('WP2 same happens exactly for the requested single stop and a missing service always denies', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(t.seed * 977 + i);
      const data = randomRouting(rng);
      const params = { ...randomRouteParams(rng) };
      const model = prepareRouting(data, params);
      const p = rng.pick(data.patients);
      const result = routePatient(model, p);
      const requested = rng.pick(data.facilities);
      const judgement = judgeOverride(model, result, requested.id, { tokenUsed: rng.chance(0.3) });
      const single = result.status === 'single' && result.stops.length === 1 && result.stops[0].row.id === requested.id;
      t.same(judgement.outcome === 'same', single);
      if (!judgement.row.gates.covers && !single) t.same(judgement.outcome, 'denied');
    }
  });

  const lockModel = (lock, over = {}) => {
    const facilities = [
      facility('pub', { tier: 'public', x: 30, quality: 0.5, reviews: 500, referrals: 0, ...over.pub }),
      facility('priv', { tier: 'private', x: 2, quality: 0.95, reviews: 500, referrals: 0, ...over.priv })
    ];
    const params = { ...defaultParams('route'), wT: 50, wQ: 50, wP: 0, wC: 0, wL: 0, wK: 0, publicLock: lock ? 1 : 0 };
    return prepareRouting({ services: [service], facilities, patients: [patient], travel: [] }, params);
  };

  t.test('WP5 the lock sends a patient to a passing public site even when a private one scores higher', () => {
    const off = routePatient(lockModel(false), patient);
    t.same(off.ranked[0].id, 'priv', 'without the lock the private site wins');
    const on = routePatient(lockModel(true), patient);
    t.same(on.ranked.map(r => r.id), ['pub']);
    const held = on.rows.find(r => r.id === 'priv');
    t.ok(held.lockedOut, 'private site is marked held back');
    t.ok(gateReasonsFor(lockModel(true), on.pp, held).includes('Held back by the public-first lock'));
  });

  t.test('WP5 a private site is used when no public site passes the gates', () => {
    const model = lockModel(true, { pub: { services: [] } });
    const result = routePatient(model, patient);
    t.same(result.ranked.map(r => r.id), ['priv']);
    t.ok(!result.rows.some(r => r.lockedOut));
  });

  t.test('WP5 split plans fill from public sites first, then everything else', () => {
    const services = [{ id: 'A', name: 'A', price: 50, complexity: 1 }, { id: 'B', name: 'B', price: 70, complexity: 1 }];
    const facilities = [
      facility('pubA', { tier: 'public', services: ['A'], x: 20, referrals: 0, quality: 0.4 }),
      facility('privAB', { tier: 'private', services: ['A', 'B'], x: 3, referrals: 0, quality: 0.95 }),
      facility('privB', { tier: 'private', services: ['B'], x: 4, referrals: 0, quality: 0.95 })
    ];
    const both = { id: 'q', name: 'q', x: 0, y: 0, needs: ['A', 'B'], urgency: 1, previous: '' };
    const params = { ...defaultParams('route'), wT: 50, wQ: 50, wP: 0, wC: 0, wL: 0, wK: 0 };
    const result = routePatient(prepareRouting({ services, facilities, patients: [both], travel: [] }, { ...params, publicLock: 1 }), both);
    t.same(result.status, 'single', 'privAB covers both, so the lock keeps it single when no public site covers both');
    const noSingle = [facilities[0], facility('privA', { tier: 'private', services: ['A'], x: 3, referrals: 0, quality: 0.95 }), facilities[2]];
    const split = routePatient(prepareRouting({ services, facilities: noSingle, patients: [both], travel: [] }, { ...params, publicLock: 1 }), both);
    t.same(split.status, 'split');
    t.same(split.stops.map(s => s.row.id).sort(), ['privB', 'pubA']);
  });

  t.test('WP5 with the lock on, single and batch agree and never skip a passing public site', () => {
    for (let i = 0; i < 150; i++) {
      const rng = createRng(t.seed * 191 + i);
      const data = randomRouting(rng);
      data.facilities = data.facilities.map(f => ({ ...f, capacity: 100000, waitlist: 0, referrals: 0 }));
      const params = { ...randomRouteParams(rng), publicLock: 1 };
      const model = prepareRouting(data, params);
      const patients = data.patients.slice(0, 12);
      const batch = routeBatch(model, patients);
      patients.forEach(p => {
        const result = routePatient(model, p);
        if (result.rows.some(r => r.G && r.facility.tier === 'public')) t.ok(result.ranked.every(r => r.facility.tier === 'public'));
        const placed = batch.results.find(r => r.id === p.id);
        if (result.status === 'single' && (result.margin === null || result.margin > 1e-3)) {
          t.same(placed.status, 'single');
          t.same(placed.stops[0].id, result.ranked[0].id);
        }
      });
    }
  });

  t.test('WP7 batch KPIs add up from the placements', () => {
    for (let i = 0; i < 40; i++) {
      const rng = createRng(t.seed * 53 + i);
      const data = randomRouting(rng);
      const model = prepareRouting(data, randomRouteParams(rng));
      const batch = routeBatch(model, data.patients.slice(0, 20));
      [batch.summary, batch.baseline.summary].forEach((sum, k) => {
        const results = k === 0 ? batch.results : batch.baseline.results;
        const placed = results.filter(r => r.status !== 'unplaced');
        t.near(sum.totalCost, placed.reduce((a, r) => a + r.summary.cost, 0), 1e-6);
        const stops = placed.reduce((a, r) => a + r.stops.length, 0);
        t.same(sum.tierMix.public + sum.tierMix.contracted + sum.tierMix.private, stops);
        t.ok(sum.loadSpread >= 0 && Number.isFinite(sum.loadSpread));
        t.ok(sum.publicSlotsUsed >= 0);
      });
    }
  });

  t.test('B8 the regret heap and the linear scan give identical batches', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(t.seed * 421 + i);
      const data = randomRouting(rng);
      const params = { ...randomRouteParams(rng), batchOrder: 0 };
      const model = prepareRouting(data, params);
      const patients = data.patients.slice(0, 25);
      const heap = routeBatch(model, patients, { pick: 'heap' });
      const linear = routeBatch(model, patients, { pick: 'linear' });
      t.same(heap.sequence, linear.sequence);
      t.same(heap.results.map(r => [r.id, r.status, r.stops.map(s => s.id)]), linear.results.map(r => [r.id, r.status, r.stops.map(s => s.id)]));
      t.same(heap.summary, linear.summary);
    }
  });

  const bigBatch = (patientCount, siteCount) => {
    const tables = buildSampleTables();
    const base = tables.facilities;
    tables.facilities = Array.from({ length: siteCount }, (_, i) => ({ ...base[i % base.length], id: `F${String(i).padStart(4, '0')}`, name: `Site ${i}`, x: String(Number(base[i % base.length].x) + (i % 7) * 3), y: String(Number(base[i % base.length].y) + (i % 5) * 3), capacity_per_day: '40' }));
    tables.patients = generatePatients({ facilities: tables.facilities, services: tables.services, n: patientCount, seed: 5 }).map(p => ({ ...p, urgency: 'routine' }));
    const params = defaultParams('route');
    const result = validateTables(tables, params);
    const model = prepareRouting(result.routing.data, params);
    const started = performance.now();
    const batch = routeBatch(model, result.routing.data.patients);
    return { batch, ms: performance.now() - started, ok: result.ok };
  };

  t.test('B8 a 3000 patient by 300 site regret batch finishes inside the time budget', () => {
    const run = bigBatch(3000, 300);
    t.ok(run.ok, 'valid');
    t.same(run.batch.summary.placed + run.batch.summary.unplaced, 3000);
    t.ok(run.ms < 30000, `took ${Math.round(run.ms)} ms`);
  });

  t.test('B8 the documented 10 000 by 1 000 limit, run only with ?big=1', () => {
    if (typeof location === 'undefined' || !location.search.includes('big=1')) { t.ok(true, 'skipped'); return; }
    const run = bigBatch(10000, 1000);
    t.same(run.batch.summary.placed + run.batch.summary.unplaced, 10000);
    t.ok(run.ms < 120000, `took ${Math.round(run.ms)} ms`);
  });
};
