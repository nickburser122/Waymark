import { createRng } from '../core/rng.js';
import { waitAllenCunneen, priorityWaits } from '../core/queue.js';
import { defaultParams, ROUTE_WEIGHT_KEYS } from '../core/params.js';
import { prepareRouting, routePatient, preparePatient, evalCell } from '../core/route.js';
import { routeBatch } from '../core/batch.js';
import { normaliseWeights, SCORE_KEYS } from '../core/score.js';
import { runFlow } from '../core/flow.js';
import { evaluateClinic, rankFixes, autoPlan } from '../core/plan.js';
import { parseCSV, serialiseCSV } from '../data/csv.js';
import { TABLE_NAMES, templateRows, matchHeaders, readTable, convertQuality, qualityScaleOptions } from '../data/schema.js';
import { buildSampleTables } from '../data/samples.js';
import { guardCell, csvText, batchCsv } from '../data/export.js';
import { createManager, createMemoryBackend } from '../data/store.js';
import { loadSettings, SETTINGS_KEY, LEGACY_KEY } from '../data/migrate.js';
import { validateTables } from '../data/validate.js';
import { slimBatch } from '../core/batch.js';
import { REGISTRY, sanitiseParams } from '../core/params.js';
import { fmtNum } from '../core/stats.js';
import { exportAll, exportBlock, equationBlocks, explain, valueLine } from '../ui/explain.js';

const CASES = 200;
const pad = n => String(n).padStart(3, '0');

export const randomRouting = (rng, options = {}) => {
  const serviceCount = rng.int(3, 7);
  const services = Array.from({ length: serviceCount }, (_, i) => ({ id: `s${i}`, name: `Service ${i}`, price: Math.round(rng.range(10, 200)), complexity: rng.pick([0.5, 1, 1.5, 2]) }));
  const serviceIds = services.map(s => s.id);
  const facilityCount = rng.int(3, options.maxFacilities || 12);
  const tiers = ['public', 'contracted', 'private'];
  const facilities = Array.from({ length: facilityCount }, (_, i) => {
    const capacity = options.tight ? rng.int(2, 8) : rng.int(2, 40);
    return {
      id: `f${pad(i)}`,
      name: `Site ${i}`,
      tier: rng.pick(tiers),
      x: rng.range(0, 120),
      y: rng.range(0, 80),
      services: rng.subset(serviceIds, 1),
      capacity,
      multiplier: rng.range(0.8, 3),
      referrals: rng.chance(0.7) ? rng.range(0, capacity * 0.95) : null,
      waitlist: rng.chance(0.8) ? rng.int(0, capacity * 3) : 0,
      quality: rng.chance(0.8) ? rng.range(0.4, 1) : null,
      reviews: rng.int(0, 500)
    };
  });
  if (rng.chance(0.3)) {
    const twin = { ...facilities[0], id: `f${pad(facilityCount)}`, name: 'Twin' };
    facilities.push(twin);
  }
  const patientCount = rng.int(5, options.maxPatients || 40);
  const patients = Array.from({ length: patientCount }, (_, i) => ({
    id: `p${pad(i)}`,
    name: `Patient ${i}`,
    x: rng.range(0, 120),
    y: rng.range(0, 80),
    needs: rng.subset(serviceIds, 1).slice(0, 3),
    urgency: rng.int(0, 2),
    previous: rng.chance(0.3) ? rng.pick(facilities).id : ''
  }));
  return { services, facilities, patients, travel: [] };
};

export const randomRouteParams = rng => {
  const params = defaultParams('route');
  ROUTE_WEIGHT_KEYS.forEach(k => { params[k] = rng.int(0, 100); });
  if (ROUTE_WEIGHT_KEYS.every(k => params[k] === 0)) params.wT = 50;
  if (rng.chance(0.4)) {
    params.reachRoutine = rng.range(30, 150);
    params.reachSoon = rng.range(20, 100);
    params.reachUrgent = rng.range(10, 70);
  }
  if (rng.chance(0.3)) params.deadlineSoon = rng.range(0.5, 10);
  if (rng.chance(0.35)) params.publicLock = 1;
  return params;
};

const shuffled = (rng, data) => ({
  ...data,
  facilities: rng.shuffle(data.facilities),
  patients: rng.shuffle(data.patients)
});

const assignmentMap = batch => batch.results
  .map(r => [r.id, `${r.status}:${r.stops.map(s => s.id).join(',')}`])
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));

const independentKm = (params, patient, facility) => params.eta * Math.hypot(patient.x - facility.x, patient.y - facility.y);

export const randomSite = rng => {
  const stationCount = rng.int(3, 8);
  const hours = Array.from({ length: rng.int(4, 12) }, (_, i) => 8 + i);
  const stations = Array.from({ length: stationCount }, (_, i) => ({
    id: `st${i}`,
    name: `Station ${i}`,
    serviceMin: rng.range(1, 15),
    csSq: rng.range(0, 2),
    servers: hours.map(() => (i === 0 ? rng.int(1, 5) : rng.int(0, 5)))
  }));
  const routes = [{ from: 'in', to: 'st0', share: 1 }];
  for (let i = 0; i < stationCount - 1; i++) {
    const kids = rng.subset(stations.slice(i + 1).map(s => s.id), 1).slice(0, 2);
    const raw = kids.map(() => rng.range(0.2, 1));
    const total = raw.reduce((a, b) => a + b, 0);
    const scale = rng.range(0.5, 1);
    kids.forEach((to, j) => routes.push({ from: stations[i].id, to, share: raw[j] / total * scale }));
  }
  const weakPoints = stations.filter(() => rng.chance(0.7)).map((st, i) => ({
    id: `w${i}`, station: st.id, title: `Weak ${i}`, I: rng.int(1, 5), F: rng.int(1, 5), P: rng.int(1, 5), D: rng.int(1, 5)
  }));
  const fixes = Array.from({ length: rng.int(3, 8) }, (_, i) => ({ id: `x${i}`, title: `Fix ${i}`, effort: rng.int(1, 3), cost: rng.int(0, 40) }));
  const effects = [];
  fixes.forEach(fix => {
    for (let k = 0; k < rng.int(1, 2); k++) {
      const kind = rng.pick(['staff', 'speed', 'risk']);
      if (kind === 'staff') effects.push({ fix: fix.id, kind, target: rng.pick(stations).id, field: '', delta: rng.int(1, 2), from: hours[rng.int(0, 2)], to: hours[hours.length - 1] });
      else if (kind === 'speed') effects.push({ fix: fix.id, kind, target: rng.pick(stations).id, field: '', delta: rng.range(0.6, 0.95), from: null, to: null });
      else if (weakPoints.length) effects.push({ fix: fix.id, kind, target: rng.pick(weakPoints).id, field: rng.pick(['I', 'F', 'P', 'D']), delta: -rng.int(1, 3), from: null, to: null });
    }
  });
  return {
    id: 'main',
    hours,
    arrivals: hours.map(() => rng.range(0, 90)),
    arrivalCv2: hours.map(() => rng.range(0.5, 2)),
    stations,
    routes,
    weakPoints,
    fixes,
    effects
  };
};

export const randomClinicParams = rng => ({
  ...defaultParams('clinic'),
  season: rng.range(0.8, 1.4),
  bucketMin: rng.pick([30, 60]),
  fwR: rng.int(0, 100),
  fwO: rng.int(0, 100),
  fwP: rng.int(0, 100),
  fwB: rng.int(1, 100),
  alpha: rng.pick([0, 0.5, 1]),
  gamma: rng.pick([0, 0.5, 1])
});

const eachCase = (t, label, body) => {
  t.test(label, () => {
    for (let i = 0; i < CASES; i++) {
      const rng = createRng(t.seed * 1000003 + i * 7919 + label.length);
      body(rng, i);
    }
  });
};

export const register = t => {
  eachCase(t, 'P1 queue wait is monotone in servers and arrival rate', (rng, i) => {
    const c = rng.int(1, 30);
    const s = rng.range(0.5, 5);
    const rho = rng.range(0.05, 0.9);
    const lambda = rho * c / s;
    const w = waitAllenCunneen(lambda, c, s, 1, 0.5);
    const more = waitAllenCunneen(lambda, c + 1, s, 1, 0.5);
    t.ok(more <= w + 1e-12, `servers case ${i}: ${more} > ${w}`);
    const higher = Math.min(lambda * rng.range(1, 1.05), 0.97 * c / s);
    t.ok(waitAllenCunneen(higher, c, s, 1, 0.5) >= w - 1e-12, `lambda case ${i}`);
  });

  eachCase(t, 'P1 route wait is monotone in waitlist, servers and referrals', (rng, i) => {
    const data = randomRouting(rng, { maxFacilities: 5, maxPatients: 5 });
    const params = defaultParams('route');
    const model = prepareRouting(data, params);
    const wn = normaliseWeights(model.cfg.weights, SCORE_KEYS);
    const pp = preparePatient(model, data.patients[0]);
    const fi = rng.int(0, model.facilities.length - 1);
    const a = evalCell(model, pp, fi, 0, false, wn);
    const b = evalCell(model, pp, fi, rng.int(1, 5), false, wn);
    t.ok(b.ttc >= a.ttc - 1e-12, `waitlist case ${i}`);
    const f = data.facilities.find(x => x.id === model.facilities[fi].id);
    const bigger = { ...data, facilities: data.facilities.map(x => (x.id === f.id ? { ...x, capacity: x.capacity + 1 } : x)) };
    const model2 = prepareRouting(bigger, params);
    const pp2 = preparePatient(model2, data.patients[0]);
    const c = evalCell(model2, pp2, model2.facilityIndex.get(f.id), 0, false, wn);
    t.ok(c.ttc <= a.ttc + 1e-12, `servers case ${i}: ${c.ttc} > ${a.ttc}`);
    const busier = { ...data, facilities: data.facilities.map(x => (x.id === f.id ? { ...x, referrals: Math.min(x.capacity * 0.97, (x.referrals === null ? x.waitlist / params.horizon : x.referrals) + rng.range(0, 2)) } : x)) };
    const model3 = prepareRouting(busier, params);
    const pp3 = preparePatient(model3, data.patients[0]);
    const d = evalCell(model3, pp3, model3.facilityIndex.get(f.id), 0, false, wn);
    const baseLambda = a.facility.lambda;
    if (d.facility.lambda >= baseLambda) t.ok(d.ttc >= a.ttc - 1e-9, `referrals case ${i}`);
  });

  eachCase(t, 'P2 Erlang C matches closed forms for c=1 and c=2', (rng, i) => {
    const s = rng.range(0.3, 6);
    const rho = rng.range(0.02, 0.95);
    const one = waitAllenCunneen(rho / s, 1, s, 1, 1);
    t.near(one, rho * s / (1 - rho), 1e-9 * Math.max(1, one), `c=1 case ${i}`);
    const lambda = 2 * rho / s;
    const probWait = 2 * rho * rho / (1 + rho);
    const expected = probWait / (2 / s - lambda);
    t.near(waitAllenCunneen(lambda, 2, s, 1, 1), expected, 1e-9 * Math.max(1, expected), `c=2 case ${i}`);
  });

  eachCase(t, 'P3 priority classes conserve the FCFS wait', (rng, i) => {
    const c = rng.int(1, 25);
    const s = rng.range(0.3, 6);
    const rho = rng.range(0.05, 0.95);
    const lambda = rho * c / s;
    const classes = rng.int(2, 5);
    const raw = Array.from({ length: classes }, () => rng.range(0.05, 1));
    const total = raw.reduce((a, b) => a + b, 0);
    const shares = raw.map(v => v / total);
    const ca2 = rng.range(0, 3);
    const cs2 = rng.range(0, 3);
    const waits = priorityWaits(lambda, c, s, ca2, cs2, shares);
    const mixed = waits.reduce((acc, w, k) => acc + shares[k] * w, 0);
    const fcfs = waitAllenCunneen(lambda, c, s, ca2, cs2);
    t.near(mixed, fcfs, 1e-6, `case ${i}`);
  });

  eachCase(t, 'P4 never choose a site that fails a gate', (rng, i) => {
    const data = randomRouting(rng);
    const params = randomRouteParams(rng);
    const model = prepareRouting(data, params);
    const facilityById = new Map(data.facilities.map(f => [f.id, f]));
    const patientById = new Map(data.patients.map(p => [p.id, p]));
    const check = (patient, stop, label) => {
      const f = facilityById.get(stop.row.id);
      const row = stop.row;
      const u = patient.urgency;
      t.ok(row.relaxed, `${label}: relaxed gates ${i}`);
      t.ok(stop.needs.every(n => f.services.includes(n)), `${label}: stop does not offer its needs ${i}`);
      t.ok(independentKm(params, patient, f) <= [params.reachRoutine, params.reachSoon, params.reachUrgent][u] + 1e-9, `${label}: reach ${i}`);
      t.ok(row.ttc <= [params.deadlineRoutine, params.deadlineSoon, params.deadlineUrgent][u] + 1e-9, `${label}: deadline ${i}`);
      const lambda = f.referrals === null ? (f.waitlist || 0) / params.horizon : f.referrals;
      t.ok(lambda / f.capacity < params.rhoMax, `${label}: load ${i}`);
    };
    data.patients.forEach(p => {
      const result = routePatient(model, p);
      result.stops.forEach(stop => {
        check(p, stop, 'single');
        if (result.status === 'single') t.ok(stop.row.G, `single full gate ${i}`);
      });
    });
    const batch = routeBatch(model, data.patients);
    batch.results.forEach(r => {
      const p = patientById.get(r.id);
      r.stops.forEach(stop => {
        check(p, stop, 'batch');
        t.ok(stop.row.gates.capacity, `batch capacity gate ${i}`);
        if (r.status === 'single') t.ok(stop.row.G, `batch full gate ${i}`);
      });
    });
  });

  eachCase(t, 'P5 raising one weight never lowers the winner score on it', (rng, i) => {
    const data = randomRouting(rng);
    const params = randomRouteParams(rng);
    const model = prepareRouting(data, params);
    const patient = rng.pick(data.patients);
    const key = rng.pick(SCORE_KEYS);
    const base = { ...model.cfg.weights };
    const raised = { ...base, [key]: base[key] + rng.range(1, 80) };
    const a = routePatient(model, patient, { weights: base });
    const b = routePatient(model, patient, { weights: raised });
    if (a.status !== 'single' || b.status !== 'single') return;
    t.ok(b.ranked[0].s[key] >= a.ranked[0].s[key] - 1e-12, `case ${i} ${key}: ${b.ranked[0].s[key]} < ${a.ranked[0].s[key]}`);
  });

  eachCase(t, 'P6 shuffling rows does not change any assignment', (rng, i) => {
    const data = randomRouting(rng, { tight: i % 2 === 0, maxPatients: 50 });
    const params = randomRouteParams(rng);
    const a = routeBatch(prepareRouting(data, params), data.patients);
    const b = routeBatch(prepareRouting(shuffled(rng, data), params), rng.shuffle(data.patients));
    t.same(assignmentMap(b), assignmentMap(a), `batch case ${i}`);
    const patient = data.patients[0];
    const s1 = routePatient(prepareRouting(data, params), patient);
    const s2 = routePatient(prepareRouting(shuffled(rng, data), params), patient);
    t.same(s2.stops.map(s => s.row.id), s1.stops.map(s => s.row.id), `single case ${i}`);
  });

  eachCase(t, 'P7 scaling all weights does not change any ranking', (rng, i) => {
    const data = randomRouting(rng);
    const params = randomRouteParams(rng);
    const factor = rng.pick([0.013, 0.5, 3.7, 40]);
    const scaled = { ...params };
    ROUTE_WEIGHT_KEYS.forEach(k => { scaled[k] = params[k] * factor; });
    const m1 = prepareRouting(data, params);
    const m2 = prepareRouting(data, scaled);
    data.patients.slice(0, 8).forEach(p => {
      const r1 = routePatient(m1, p).ranked.map(r => r.id);
      const r2 = routePatient(m2, p).ranked.map(r => r.id);
      t.same(r2, r1, `ranking case ${i}`);
    });
    t.same(assignmentMap(routeBatch(m2, data.patients)), assignmentMap(routeBatch(m1, data.patients)), `batch case ${i}`);
  });

  eachCase(t, 'P8 batch placements stay within free capacity', (rng, i) => {
    const data = randomRouting(rng, { maxPatients: 60, tight: i % 2 === 0 });
    const params = randomRouteParams(rng);
    const batch = routeBatch(prepareRouting(data, params), data.patients);
    batch.loads.forEach(load => {
      t.ok(load.assigned <= load.room + 1e-9, `case ${i} ${load.id}: ${load.assigned} > ${load.room}`);
    });
    const placed = batch.results.reduce((acc, r) => acc + r.stops.length, 0);
    t.near(batch.loads.reduce((acc, l) => acc + l.assigned, 0), placed, 1e-9, `load total ${i}`);
  });

  const scarceData = () => ({
    services: [{ id: 's', name: 's', price: 10, complexity: 1 }],
    facilities: [
      { id: 'X', name: 'X', tier: 'public', x: 0, y: 0, services: ['s'], capacity: 10, multiplier: 1, referrals: 0, waitlist: 9, quality: 1, reviews: 5000 },
      { id: 'Y', name: 'Y', tier: 'public', x: 80, y: 0, services: ['s'], capacity: 50, multiplier: 1, referrals: 0, waitlist: 0, quality: 0.2, reviews: 5000 }
    ],
    patients: [
      { id: 'p1', name: 'B', x: 40, y: 0, needs: ['s'], urgency: 0, previous: '' },
      { id: 'p2', name: 'A', x: 0, y: 0, needs: ['s'], urgency: 0, previous: '' }
    ],
    travel: []
  });
  const scarceParams = extra => ({ ...defaultParams('route'), wT: 50, wC: 0, wP: 0, wL: 0, wQ: 50, wK: 0, horizon: 1, ...extra });

  t.test('B1 regret order gives the scarce slot to the patient who loses most', () => {
    const data = scarceData();
    const batch = routeBatch(prepareRouting(data, scarceParams({})), data.patients);
    const at = Object.fromEntries(batch.results.map(r => [r.name, r.stops.map(s => s.id).join(',')]));
    t.same(at, { B: 'Y', A: 'X' });
    t.near(batch.loads.find(l => l.id === 'X').assigned, 1, 0);
  });

  t.test('B2 as-listed order gives the scarce slot to the first listed patient', () => {
    const data = scarceData();
    const batch = routeBatch(prepareRouting(data, scarceParams({ batchOrder: 1 })), data.patients);
    const at = Object.fromEntries(batch.results.map(r => [r.name, r.stops.map(s => s.id).join(',')]));
    t.same(at, { B: 'X', A: 'Y' });
  });

  t.test('T1 exact ties go to the lowest facility id, whatever the row order', () => {
    const f = id => ({ id, name: id, tier: 'public', x: 10, y: 0, services: ['s'], capacity: 20, multiplier: 1, referrals: 2, waitlist: 3, quality: 0.8, reviews: 100 });
    const data = { services: [{ id: 's', name: 's', price: 10, complexity: 1 }], facilities: [f('b'), f('c'), f('a')], patients: [{ id: 'p', name: 'p', x: 0, y: 0, needs: ['s'], urgency: 1, previous: '' }], travel: [] };
    const model = prepareRouting(data, defaultParams('route'));
    t.same(routePatient(model, data.patients[0]).ranked.map(r => r.id), ['a', 'b', 'c']);
    t.same(routeBatch(model, data.patients).results[0].stops.map(s => s.id), ['a']);
  });

  eachCase(t, 'P9 flow mass balance and capacity per station', (rng, i) => {
    const site = randomSite(rng);
    const params = randomClinicParams(rng);
    const flow = runFlow(site, params);
    flow.stations.forEach(st => {
      const arrivals = Array.from(st.lam).reduce((a, b) => a + b, 0);
      const departures = Array.from(st.dep).reduce((a, b) => a + b, 0);
      t.near(arrivals, departures + st.bk[st.bk.length - 1], 1e-6, `balance case ${i} ${st.id}`);
      for (let b = 0; b < st.dep.length; b++) t.ok(st.dep[b] <= st.cap[b] + 1e-9, `cap case ${i} ${st.id}`);
    });
  });

  eachCase(t, 'P10 the top fix lowers risk and waiting by its reported effect', (rng, i) => {
    const site = randomSite(rng);
    const params = { ...randomClinicParams(rng), budget: Infinity };
    const applied = site.fixes.filter(() => rng.chance(0.25)).map(f => f.id);
    const ranking = rankFixes(site, applied, params);
    if (!ranking.items.length) return;
    const top = ranking.items[0];
    const after = evaluateClinic(site, applied.concat(top.fix.id), params);
    t.near(ranking.base.totR - after.totR, top.dR, 1e-6, `risk case ${i}`);
    t.near(ranking.base.pmw - after.pmw, top.dPMW, 1e-6, `pmw case ${i}`);
  });

  eachCase(t, 'P11 auto-plan total cost stays within budget', (rng, i) => {
    const site = randomSite(rng);
    const budget = rng.pick([0, 5, 20, 60, 150]);
    const params = { ...randomClinicParams(rng), budget };
    const plan = autoPlan(site, [], params);
    const spent = plan.steps.reduce((acc, s) => acc + s.cost, 0);
    t.ok(spent <= budget + 1e-9, `case ${i}: ${spent} > ${budget}`);
    t.near(spent, plan.totalCost, 1e-9, `cumulative ${i}`);
    const ids = plan.steps.map(s => s.fix.id);
    t.ok(new Set(ids).size === ids.length, `duplicate fix ${i}`);
  });

  const NASTY = ['plain', 'with,comma', 'with;semi', 'tab\there', 'say "hi"', 'two\nlines', 'cr\r\nlf', ' padded ', '"', '""', 'é ü 日本', 'a,b;c\td', '=SUM(1)', 'x'];

  const randomMatrix = rng => {
    const cols = rng.int(1, 6);
    const rows = rng.int(1, 8);
    return Array.from({ length: rows }, () => Array.from({ length: cols }, (_, c) => (c === 0 ? `k${rng.int(0, 99)}` : rng.chance(0.2) ? '' : rng.pick(NASTY))));
  };

  eachCase(t, 'P12 CSV round-trip keeps quotes, commas, newlines, BOM and delimiters', (rng, i) => {
    const matrix = randomMatrix(rng);
    const delimiter = rng.pick([',', ';', '\t']);
    const eol = rng.pick(['\n', '\r\n']);
    const bom = rng.chance(0.5);
    const text = serialiseCSV(matrix, { delimiter, eol, bom });
    const parsed = parseCSV(text, delimiter);
    t.same(parsed.rows, matrix, `parse case ${i}`);
    const again = parseCSV(serialiseCSV(parsed.rows, { delimiter, eol, bom }), delimiter);
    t.same(again.rows, parsed.rows, `second pass case ${i}`);
    const header = matrix[0];
    if (header.length > 1 && header.every(cell => !cell.includes(',') && !cell.includes(';') && !cell.includes('\t'))) {
      t.same(parseCSV(text).delimiter, delimiter, `detect case ${i}`);
    }
  });

  t.test('P12 every table template parses, maps and round-trips', () => {
    const samples = buildSampleTables();
    TABLE_NAMES.forEach(name => {
      const rows = templateRows(name, samples);
      [[',', '\n', false], [';', '\r\n', true], ['\t', '\n', false]].forEach(([delimiter, eol, bom]) => {
        const parsed = parseCSV(serialiseCSV(rows, { delimiter, eol, bom }));
        t.same(parsed.rows, rows, `${name} ${JSON.stringify(delimiter)}`);
        t.ok(matchHeaders(name, parsed.rows[0]).complete, `${name} headers map`);
      });
    });
  });

  t.test('P12 synonyms, wide staffing and quality scales are understood', () => {
    const table = readTable('facilities', 'ID;Facility;Type;Latitude;Longitude;Offers;Slots;Price;Rating\r\nA;Alpha;public;1;2;lab xray;5;1.2;4\r\nB;Beta;private;1;2;lab;5;2;5', 'f.csv');
    t.ok(table.match.complete, 'synonym mapping complete');
    t.same(qualityScaleOptions(table.records), ['five', 'percent'].filter(o => o === 'five' || table.records.every(r => Number(r.quality) <= 100)));
    t.same(convertQuality(table.records, 'five').map(r => r.quality), ['0.75', '1']);
    const wide = readTable('staffing', 'station_id,h08,h09\nrec,2,3\ntri,1,', 'staffing.csv');
    t.same(wide.records.map(r => `${r.station_id}:${r.hour}:${r.servers}`), ['rec:8:2', 'rec:9:3', 'tri:8:1']);
    const missing = readTable('facilities', 'id,name\nA,Alpha', 'f.csv');
    t.ok(!missing.match.complete && missing.match.missing.includes('tier'), 'missing required columns reported');
  });

  t.test('S2 CSV injection guard prefixes risky strings and spares numbers', () => {
    t.same(guardCell('=HYPERLINK(1)'), "'=HYPERLINK(1)");
    ['+1', '-1', '@x', '\tx'].forEach(v => t.same(guardCell(v), `'${v}`));
    t.same(guardCell(-3), -3);
    t.same(guardCell('safe'), 'safe');
    const text = csvText([['name', 'n'], ['=HYPERLINK(1)', -2]]);
    t.same(parseCSV(text).rows, [['name', 'n'], ["'=HYPERLINK(1)", '-2']]);
    const data = { services: [{ id: 's', name: 's', price: 10, complexity: 1 }], facilities: [{ id: 'f', name: 'f', tier: 'public', x: 0, y: 0, services: ['s'], capacity: 10, multiplier: 1, referrals: 1, waitlist: 0, quality: 0.8, reviews: 10 }], patients: [{ id: 'p', name: '=HYPERLINK(1)', x: 0, y: 0, needs: ['s'], urgency: 0, previous: '' }], travel: [] };
    const model = prepareRouting(data, defaultParams('route'));
    const out = batchCsv(slimBatch(model, routeBatch(model, data.patients)));
    t.same(parseCSV(out).rows[1][1], "'=HYPERLINK(1)");
  });

  const newManager = () => {
    const params = defaultParams();
    return createManager({ backend: createMemoryBackend(), getParams: () => params });
  };

  t.test('S3 an invalid upload leaves the previous dataset and the engine untouched', () => {
    const manager = newManager();
    const tablesBefore = manager.tables();
    const compiledBefore = manager.compiled();
    const versionBefore = manager.version();
    const broken = manager.records('facilities').map(r => ({ ...r }));
    broken[1].id = broken[0].id;
    const outcome = manager.apply({ facilities: broken });
    t.ok(!outcome.ok, 'upload rejected');
    t.ok(outcome.issues.some(i => i.message.startsWith('Duplicate id')), 'duplicate id reported');
    t.ok(manager.tables() === tablesBefore, 'tables object unchanged');
    t.ok(manager.compiled() === compiledBefore, 'compiled engine input unchanged');
    t.same(manager.version(), versionBefore);
    t.ok(manager.compiled().routing.ready, 'engine still ready');
    const fine = manager.records('facilities').map(r => ({ ...r, name: `${r.name}!` }));
    t.ok(manager.apply({ facilities: fine }).ok, 'valid upload accepted');
    t.ok(manager.undo(), 'undo works');
    t.same(manager.records('facilities')[0].name, 'Sarema General');
  });

  t.test('S3 validation catches references, cycles, shares and ranges', () => {
    const base = buildSampleTables();
    const check = (patch, text) => {
      const result = validateTables({ ...base, ...patch }, defaultParams());
      t.ok(result.errors.some(e => e.message.includes(text)), `expected "${text}", got ${JSON.stringify(result.errors.slice(0, 3).map(e => e.message))}`);
    };
    check({ patients: base.patients.map((p, i) => (i === 0 ? { ...p, needs: 'nope' } : p)) }, 'Unknown service');
    check({ patients: base.patients.map((p, i) => (i === 0 ? { ...p, previous_site: 'zzz' } : p)) }, 'Unknown facility');
    check({ facilities: base.facilities.map((f, i) => (i === 0 ? { ...f, quality: '4' } : f)) }, 'quality must be');
    check({ routes: base.routes.concat({ from: 'bil', to: 'rec', share: '0.5' }) }, 'Route cycle');
    check({ routes: base.routes.map(r => (r.from === 'rec' && r.to === 'tri' ? { ...r, share: '0.9' } : r)) }, 'add up to');
    check({ fix_effects: base.fix_effects.map((e, i) => (i === 1 ? { ...e, target: 'zz' } : e)) }, 'Unknown weak point');
    const zero = validateTables({ ...base, facilities: base.facilities.map((f, i) => (i === 0 ? { ...f, capacity_per_day: '0' } : f)) }, defaultParams());
    t.ok(zero.ok && zero.warnings.some(w => w.message.includes('Zero capacity')), 'zero capacity is a warning');
  });

  t.test('S4 migration carries v2 settings into v3 and keeps the v2 key', () => {
    const store = new Map();
    const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, v); }, removeItem: k => { store.delete(k); } };
    const legacy = JSON.stringify({ view: 'clinic', rw: { T: 61, C: 7, P: 3, L: 9, Q: 12, K: 8 }, fw: { R: 11, P: 22, O: 33, B: 34 }, season: 1.25, applied: ['f1', 'f4'], p: { name: 'x' } });
    store.set(LEGACY_KEY, legacy);
    const settings = loadSettings(storage);
    t.same(settings.params.wT, 61);
    t.same(settings.params.wK, 8);
    t.same(settings.params.fwO, 33);
    t.same(settings.params.season, 1.25);
    t.same(settings.applied, { main: ['f1', 'f4'] });
    t.same(settings.view, 'clinic');
    t.same(store.get(LEGACY_KEY), legacy);
    const written = JSON.parse(store.get(SETTINGS_KEY));
    t.same(written.params.wT, 61);
    t.same(written.version, 3);
    t.same(loadSettings(storage).params.wT, 61);
  });

  const randomRegistryParams = rng => {
    const raw = {};
    REGISTRY.forEach(entry => {
      raw[entry.key] = entry.choices ? rng.pick(entry.choices).value : Number((entry.min + (entry.max - entry.min) * rng.range(0.05, 0.95)).toPrecision(3));
    });
    return sanitiseParams(raw);
  };

  eachCase(t, 'E1 every registry value appears in the exported equations with the same number', (rng, i) => {
    const params = i === 0 ? sanitiseParams({}) : randomRegistryParams(rng);
    ['md', 'tex', 'txt'].forEach(format => {
      const text = exportAll(format, params);
      REGISTRY.forEach(entry => {
        const needle = format === 'tex' ? `${entry.latex} &= ${fmtNum(params[entry.key])}` : `${entry.symbol} = ${fmtNum(params[entry.key])}`;
        t.ok(text.includes(needle), `${format} export is missing "${needle}"`);
      });
    });
  });

  t.test('E1 every formula changes when any parameter it uses changes', () => {
    const rng = createRng(t.seed + 77);
    for (let round = 0; round < 12; round++) {
      const base = randomRegistryParams(rng);
      const blocks = equationBlocks(base);
      blocks.forEach((block, bi) => {
        block.uses.forEach(key => {
          const entry = REGISTRY.find(e => e.key === key);
          let next = base[key];
          if (entry.choices) next = entry.choices.find(c => c.value !== base[key]).value;
          else {
            while (next === base[key]) next = Number((entry.min + (entry.max - entry.min) * rng.range(0.05, 0.95)).toPrecision(3));
          }
          const changed = { ...base, [key]: next };
          const before = block.formula.join('\n');
          const after = equationBlocks(changed)[bi].formula.join('\n');
          t.ok(before !== after, `${block.id}: formula ignores ${key}`);
          t.ok(after.includes(fmtNum(next)) || entry.choices, `${block.id}: formula lacks the new ${key} value ${fmtNum(next)}`);
        });
      });
    }
  });

  eachCase(t, 'E2 explain parts sum to the total and the formula evaluates to it', (rng, i) => {
    const data = randomRouting(rng);
    const params = randomRouteParams(rng);
    const model = prepareRouting(data, params);
    const patient = rng.pick(data.patients);
    const result = routePatient(model, patient);
    result.ranked.slice(0, 3).forEach(row => {
      const out = explain(row, params, patient.urgency);
      const sum = Object.values(out.parts).reduce((a, b) => a + b, 0);
      t.near(sum, out.total, 1e-9, `parts case ${i}`);
      t.near(out.total, row.total, 1e-9, `total case ${i}`);
      const text = out.formula;
      const expr = text.slice('Score = '.length, text.lastIndexOf(' = ')).split('·').join('*').split('−').join('-').split('^').join('**').split('[').join('(').split(']').join(')');
      const shown = Number(text.slice(text.lastIndexOf(' = ') + 3));
      const evaluated = Function(`return (${expr})`)();
      t.near(evaluated, shown, 1.5e-3, `formula case ${i}: ${text}`);
      t.near(shown, row.total, 6e-4, `shown total case ${i}`);
    });
  });

  t.test('S4 theme setting defaults to system, persists and ignores bad values', () => {
    const store = new Map();
    const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, v); }, removeItem: k => { store.delete(k); } };
    t.same(loadSettings(storage).theme, 'system');
    store.set(SETTINGS_KEY, JSON.stringify({ version: 3, theme: 'dark' }));
    t.same(loadSettings(storage).theme, 'dark');
    store.set(SETTINGS_KEY, JSON.stringify({ version: 3, theme: 'neon' }));
    t.same(loadSettings(storage).theme, 'system');
    store.delete(SETTINGS_KEY);
    store.set(LEGACY_KEY, JSON.stringify({ view: 'route' }));
    t.same(loadSettings(storage).theme, 'system');
  });
};
