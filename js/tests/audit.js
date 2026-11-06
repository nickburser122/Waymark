import { createRng } from '../core/rng.js';
import { fnv1a, canonical } from '../core/hash.js';
import { defaultParams, REGISTRY, sanitiseValue } from '../core/params.js';
import { prepareRouting, routePatient, runId, integrityChecks, contributionGap, flipThresholds, nearestFeasible, gateFunnel, firstFailingGate } from '../core/route.js';
import { SCORE_KEYS } from '../core/score.js';
import { patientNote } from '../ui/explain.js';
import { randomRouting, randomRouteParams } from './props.js';
import { buildSampleTables } from '../data/samples.js';
import { validateTables } from '../data/validate.js';
import { createManager, createMemoryBackend } from '../data/store.js';
import { decisionRecord, mdCell } from '../data/record.js';
import { loadLedger, saveLedger, addEntry, ledgerCsv, sanitiseEntry, normaliseLedger, parseLedgerJson, mergeLedgers, LEDGER_MAX, LEDGER_KEY } from '../data/ledger.js';
import { createRouteView } from '../ui/route-view.js';
import { makeContext, wait, waitFor, durableBackend, memoryStorage } from './ui.js';

const routing = (tables, params) => {
  const result = validateTables(tables, params);
  return { data: result.routing.data, model: prepareRouting(result.routing.data, params) };
};

export const register = t => {
  t.test('WP1 hash golden values and key-order independence', () => {
    t.same(fnv1a(''), '811c9dc5');
    t.same(fnv1a('a'), 'e40c292c');
    t.same(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
    t.same(canonical(Infinity), '"Infinity"');
  });

  t.test('WP1 run id is stable across rebuilds and changes with any input', () => {
    const base = defaultParams();
    const tables = buildSampleTables();
    const first = routing(tables, base);
    const patient = first.data.patients[3];
    const pp = routePatient(first.model, patient).pp;
    const manager = createManager({ backend: null, getParams: () => base });
    const fp = manager.fingerprint();
    const id = runId(pp, base, fp);
    t.same(id, runId(routePatient(routing(buildSampleTables(), base).model, patient).pp, base, createManager({ backend: null, getParams: () => base }).fingerprint()));
    t.same(id.length, 8);
    for (let i = 0; i < 200; i++) {
      const rng = createRng(t.seed * 31 + i);
      const entry = rng.pick(REGISTRY);
      const tweaked = { ...base };
      const candidates = entry.choices ? entry.choices.map(c => c.value) : [entry.min, entry.max, entry.default * 1.1 + 0.05];
      const next = sanitiseValue(entry, rng.pick(candidates));
      if (next === base[entry.key]) continue;
      tweaked[entry.key] = next;
      t.ok(runId(pp, tweaked, fp) !== id, `${entry.key} changes the run id`);
    }
    t.ok(runId(pp, base, fp + 'x') !== id, 'data fingerprint');
    t.ok(runId(pp, base, fp, { capacity: { a: 1 } }) !== id, 'extras');
    const other = routePatient(first.model, first.data.patients[4]).pp;
    t.ok(runId(other, base, fp) !== id, 'patient');
  });

  t.test('WP1 the data fingerprint follows table content', () => {
    const base = defaultParams();
    const manager = createManager({ backend: createMemoryBackend(), getParams: () => base });
    const before = manager.fingerprint();
    t.same(manager.fingerprint(), before);
    const rows = manager.records('facilities');
    manager.apply({ facilities: rows.map((r, i) => (i === 0 ? { ...r, name: `${r.name}!` } : r)) });
    t.ok(manager.fingerprint() !== before);
    manager.undo();
    t.same(manager.fingerprint(), before);
  });

  t.test('WP1 integrity checks pass for every sample patient and expose a tampered ranking', () => {
    const params = defaultParams();
    const { data, model } = routing(buildSampleTables(), params);
    data.patients.forEach(p => {
      const result = routePatient(model, p);
      const failed = integrityChecks(model, result).filter(c => !c.ok);
      t.same(failed.map(c => c.label), [], `patient ${p.id}`);
    });
    const result = routePatient(model, data.patients[0]);
    if (result.ranked.length > 1) {
      const swapped = { ...result, ranked: result.ranked.slice().reverse() };
      t.ok(integrityChecks(model, swapped).some(c => !c.ok), 'order violation is caught');
    }
  });

  t.test('WP1 the decision record escapes hostile text', () => {
    const params = defaultParams();
    const tables = buildSampleTables();
    tables.patients = tables.patients.map((p, i) => (i === 0 ? { ...p, name: 'a|b\n<script>' } : p));
    tables.facilities = tables.facilities.map((f, i) => (i === 0 ? { ...f, name: 'x|y\r\nz' } : f));
    const { data, model } = routing(tables, params);
    const patient = data.patients[0];
    const result = routePatient(model, patient);
    const text = decisionRecord({ model, result, patient, params, runId: 'abcd1234', fingerprint: 'ffff0000', generatedAt: '2026-01-01T00:00:00.000Z' });
    t.ok(text.startsWith('# Referral decision — a\\|b '), 'title escaped and single line');
    t.ok(!/\|\s*x\|y/.test(text), 'facility pipes escaped');
    t.ok(text.split('\n').every(line => !line.includes('\r')), 'no carriage returns');
    t.same(mdCell('a|b\\c\n'), 'a\\|b\\\\c ');
    t.ok(text.includes('abcd1234') && text.includes('ffff0000'));
  });

  t.test('WP1 the ledger deduplicates, caps and never stores names unless asked', () => {
    let items = [];
    const entry = n => ({ id: `r${n}`, t: '2026-01-01T00:00:00.000Z', engine: '3.1.0', patientId: `P${n}`, needs: ['a'], urgency: 'routine', preset: 'Balanced', plan: ['s'], score: 0.5, km: 3, ttc: 1, cost: 10, confidence: 'Clear lead' });
    t.ok(addEntry(items, entry(1)).added);
    items = addEntry(items, entry(1)).items;
    t.same(addEntry(items, entry(1)).added, false);
    for (let n = 2; n < LEDGER_MAX + 30; n++) items = addEntry(items, entry(n)).items;
    t.same(items.length, LEDGER_MAX);
    t.same(items[0].id, `r${LEDGER_MAX + 29}`);
    const storage = memoryStorage();
    t.ok(saveLedger(storage, items));
    t.same(loadLedger(storage).length, LEDGER_MAX);
    storage.setItem(LEDGER_KEY, '{broken');
    t.same(loadLedger(storage), []);
    const csv = ledgerCsv([{ ...entry(1), id: '=cmd()', patientId: '+1', patientName: '@x' }]);
    t.ok(csv.includes("'=cmd()") && csv.includes("'+1") && csv.includes("'@x"), 'formula guard');
  });

  t.test('WP1 logging a decision persists it, skips names by default and survives a reload', async () => {
    window.localStorage.removeItem(LEDGER_KEY);
    const ctx = makeContext();
    const toasts = [];
    ctx.toast = text => toasts.push(text);
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      const log = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Log decision');
      t.ok(log, 'log button');
      log.click();
      await wait(60);
      log.click();
      await wait(60);
      t.same(toasts, ['Logged', 'Already in the ledger']);
      const stored = await ctx.manager.readLedger();
      t.same(stored.length, 1);
      t.ok(!('patientName' in stored[0]), 'no names by default');
      t.ok(view.el.querySelector('.audit-checks .ok'), 'integrity list rendered');
      t.ok(view.el.querySelector('.runid code').textContent.length === 8, 'run id shown');
      t.ok(Array.from(view.el.querySelectorAll('button')).some(b => b.textContent === 'Copy decision record'));
      const again = createRouteView(ctx);
      Object.assign(ctx.views, { route: again });
      document.body.append(again.el);
      again.update();
      t.ok(await waitFor(() => again.el.querySelector('.audit-card table, .card table.tbl'), 2000), 'a new view reads the saved ledger');
      again.el.remove();
    } finally {
      view.el.remove();
    }
  });

  t.test('WP2 choosing a requested site shows the override card, changes the run id and the record', async () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'single';
    ctx.settings.patientId = 'P003';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      const runBefore = view.el.querySelector('.runid code').textContent;
      t.ok(!Array.from(view.el.querySelectorAll('h3')).some(el => el.textContent.startsWith('Override')), 'no card without a request');
      view.el.querySelector('.sel-btn[aria-label="Patient asks for"]').click();
      const options = Array.from(document.body.querySelectorAll('.sel-opt'));
      t.ok(options.length > 2, 'options listed');
      options[1].click();
      await wait(30);
      t.ok(Array.from(view.el.querySelectorAll('h3')).some(el => el.textContent.startsWith('Override')), 'card shown');
      t.ok(view.el.querySelector('.runid code').textContent !== runBefore, 'run id changes with the request');
      t.ok(view.el.querySelectorAll('.audit-check').length >= 14, 'override rules listed next to integrity checks');
    } finally {
      document.body.querySelectorAll('.sel-list').forEach(el => el.remove());
      view.el.remove();
    }
  });

  t.test('WP3 the contribution gap adds up to the margin and names a decisive term', () => {
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const rng = createRng(t.seed * 613 + i);
      const data = randomRouting(rng);
      const model = prepareRouting(data, randomRouteParams(rng));
      const result = routePatient(model, rng.pick(data.patients));
      const gap = contributionGap(result);
      if (!gap) continue;
      seen += 1;
      t.near(gap.terms.reduce((a, x) => a + x.delta, 0), gap.margin, 1e-12);
      t.ok(gap.terms.every(x => x.delta <= gap.decisive.delta + 1e-15), 'decisive is the largest delta');
    }
    t.ok(seen > 20, 'enough comparable cases');
  });

  t.test('WP3 nearest feasible and the funnel follow the gate order', () => {
    for (let i = 0; i < 100; i++) {
      const rng = createRng(t.seed * 71 + i);
      const data = randomRouting(rng);
      const model = prepareRouting(data, randomRouteParams(rng));
      const result = routePatient(model, rng.pick(data.patients));
      const nearest = nearestFeasible(result);
      const passing = result.rows.filter(r => r.G);
      if (!passing.length) t.same(nearest, null);
      else t.ok(passing.every(r => r.hours > nearest.hours || (r.hours === nearest.hours && r.fi >= nearest.fi)));
      const funnel = gateFunnel(result);
      t.same(funnel[0].count, result.rows.length);
      for (let k = 1; k < funnel.length - 1; k++) t.ok(funnel[k].count <= funnel[k - 1].count);
      if (result.status === 'single') t.same(funnel[funnel.length - 1].count, result.ranked.length);
      result.rows.filter(r => !r.G).forEach(r => t.ok(firstFailingGate(r) !== null));
    }
  });

  t.test('WP3 the patient note makes no absolute promises and covers all three outcomes', () => {
    const params = defaultParams();
    const { data, model } = routing(buildSampleTables(), params);
    const patient = data.patients[0];
    const single = routePatient(model, patient);
    const text = patientNote(single, model, patient);
    t.ok(text.includes(single.ranked[0].facility.name));
    t.ok(text.includes('standard tariff') && !/nothing extra|free of charge/i.test(text));
    const none = patientNote({ status: 'none', blocked: { reason: 'every site is full' } }, model, patient);
    t.ok(none.includes('could not find'));
    const splitResult = data.patients.map(p => routePatient(model, p)).find(r => r.status === 'split');
    if (splitResult) t.ok(patientNote(splitResult, model, data.patients[0]).includes('more than one site'));
  });

  t.test('WP3 the single view shows the gap card, funnel and patient note toggle', async () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(Array.from(view.el.querySelectorAll('h3')).some(el => el.textContent.startsWith('Why this one and not that one')), 'gap card');
      t.ok(view.el.querySelector('.gap-row'), 'bars');
      t.ok(view.el.querySelector('.funnel'), 'funnel');
      t.ok(view.el.querySelector('.rchip'), 'reason chips');
      const toggle = Array.from(view.el.querySelectorAll('.chk')).find(el => el.textContent.includes('Explain this to the patient'));
      toggle.click();
      await wait(20);
      t.ok(view.el.querySelector('.explain-box'), 'note shown');
    } finally {
      view.el.remove();
    }
  });

  const swept = (result, key, point) => {
    const w = result.wn;
    const others = SCORE_KEYS.filter(k => k !== key);
    const total = others.reduce((a, k) => a + w[k], 0);
    const out = {};
    others.forEach(k => { out[k] = (total > 0 ? w[k] / total : 1 / others.length) * (100 - point) / 100; });
    out[key] = point / 100;
    return out;
  };

  const sampledWinner = (result, weights) => {
    const values = result.ranked.map(r => ({ r, v: SCORE_KEYS.reduce((a, k) => a + weights[k] * r.s[k], 0) }));
    values.sort((a, b) => b.v - a.v);
    if (values.length > 1 && values[0].v - values[1].v < 1e-9) return null;
    return values[0].r.id;
  };

  t.test('WP4 exact flip thresholds agree with brute-force sampling', () => {
    let swept_cases = 0;
    for (let i = 0; i < 60; i++) {
      const rng = createRng(t.seed * 389 + i);
      const data = randomRouting(rng);
      const model = prepareRouting(data, randomRouteParams(rng));
      const result = routePatient(model, rng.pick(data.patients));
      if (result.status !== 'single') continue;
      SCORE_KEYS.forEach(key => {
        const info = flipThresholds(result, result.wn, key);
        t.same(info.runs[0].from, 0);
        t.same(info.runs[info.runs.length - 1].to, 100);
        info.runs.slice(1).forEach((run, n) => t.near(run.from, info.runs[n].to, 1e-12));
        const edges = info.runs.map(r => r.to);
        for (let step = 0; step <= 1000; step++) {
          const point = step / 10;
          if (edges.some(e => Math.abs(e - point) < 1e-5)) continue;
          const run = info.runs.find(r => point >= r.from && point <= r.to);
          const expected = sampledWinner(result, swept(result, key, point));
          if (expected !== null) t.same(run.id, expected, `${key} at ${point}`);
        }
        swept_cases += 1;
      });
    }
    t.ok(swept_cases > 30, 'enough cases');
  });

  t.test('WP4 a lone site never flips and zero weights split evenly', () => {
    const params = { ...defaultParams('route'), wT: 0, wC: 0, wP: 0, wL: 0, wQ: 0, wK: 0 };
    const service = { id: 'svc', name: 'svc', price: 100, complexity: 1 };
    const site = { id: 'a', name: 'a', tier: 'public', x: 0, y: 0, services: ['svc'], capacity: 10, multiplier: 1, referrals: 0, waitlist: 0, quality: 0.8, reviews: 100 };
    const model = prepareRouting({ services: [service], facilities: [site], patients: [], travel: [] }, params);
    const result = routePatient(model, { id: 'p', name: 'p', x: 0, y: 0, needs: ['svc'], urgency: 1, previous: '' });
    const info = flipThresholds(result, result.wn, 'T');
    t.same(info.changes, 0);
    t.same(info.now, 0);
    t.same(flipThresholds({ status: 'none', ranked: [] }, {}, 'T'), null);
  });

  t.test('WP4 the thresholds card renders one strip per weight', () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.same(view.el.querySelectorAll('.flip-strip').length, 6);
      t.ok(view.el.querySelectorAll('.flip-now').length === 6);
    } finally {
      view.el.remove();
    }
  });

  const sampleEntry = (n, when = '2026-01-02T03:04:05.000Z') => ({ id: `r${n}`, t: when, engine: '3.1.0', patientId: `P${n}`, needs: ['a'], urgency: 'routine', preset: 'Balanced', plan: ['s'], score: 0.5, km: 3, ttc: 1, cost: 10, confidence: 'Clear lead' });

  t.test('LEDGER entries are sanitised, parsed and merged defensively', () => {
    t.same(sanitiseEntry(null), null);
    t.same(sanitiseEntry({ id: '', t: '2026-01-01' }), null);
    t.same(sanitiseEntry({ id: 'x', t: 'not a date' }), null);
    const dirty = sanitiseEntry({ ...sampleEntry(1), score: 'abc', extra: '<img onerror=alert(1)>', needs: ['a', 5], patientName: 7 });
    t.same(dirty.score, 0);
    t.same(dirty.needs, ['a']);
    t.ok(!('extra' in dirty) && !('patientName' in dirty), 'unknown keys and non-text names are dropped');
    t.same(normaliseLedger('nope'), []);
    t.same(normaliseLedger([sampleEntry(1), sampleEntry(1), sampleEntry(2, '2026-02-01T00:00:00.000Z')]).map(e => e.id), ['r2', 'r1']);
    t.ok(parseLedgerJson('{broken').error.includes('not valid JSON'));
    t.ok(parseLedgerJson('{"a":1}').error.includes('does not look like'));
    const parsed = parseLedgerJson(JSON.stringify({ entries: [sampleEntry(1), { id: 'bad' }, sampleEntry(3)] }));
    t.same([parsed.items.length, parsed.skipped], [2, 1]);
    const merged = mergeLedgers([sampleEntry(1)], normaliseLedger([sampleEntry(1), sampleEntry(2, '2026-03-01T00:00:00.000Z')]));
    t.same([merged.added, merged.duplicates, merged.items.map(e => e.id)], [1, 1, ['r2', 'r1']]);
  });

  t.test('LEDGER an old localStorage ledger is migrated into the store and removed', async () => {
    saveLedger(window.localStorage, [sampleEntry(8), sampleEntry(9, '2026-05-05T00:00:00.000Z')]);
    const ctx = makeContext({ backend: durableBackend() });
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(await waitFor(() => view.el.querySelectorAll('.card table.tbl tbody tr').length === 2, 3000), 'both entries shown');
      t.same((await ctx.manager.readLedger()).map(e => e.id).sort(), ['r8', 'r9']);
      t.same(window.localStorage.getItem(LEDGER_KEY), null, 'the old copy is removed after a successful write');
    } finally {
      view.el.remove();
      window.localStorage.removeItem(LEDGER_KEY);
    }
  });

  t.test('LEDGER importing a JSON export merges, skips duplicates and reports what happened', async () => {
    window.localStorage.removeItem(LEDGER_KEY);
    const ctx = makeContext();
    const toasts = [];
    ctx.toast = text => toasts.push(text);
    await ctx.manager.writeLedger([sampleEntry(1)]);
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      await waitFor(() => view.el.querySelectorAll('.card table.tbl tbody tr').length === 1, 3000);
      const input = view.el.querySelector('input[aria-label="Import ledger JSON"]');
      const file = new window.File([JSON.stringify([sampleEntry(1), sampleEntry(2, '2026-04-01T00:00:00.000Z'), { id: 'junk' }])], 'ledger.json', { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new window.Event('change'));
      t.ok(await waitFor(() => toasts.some(x => x.startsWith('Imported')), 3000), 'a result is reported');
      t.same(toasts.find(x => x.startsWith('Imported')), 'Imported 1 entry, skipped 2');
      t.same((await ctx.manager.readLedger()).map(e => e.id), ['r2', 'r1']);
      const bad = new window.File(['not json'], 'x.json');
      const input2 = view.el.querySelector('input[aria-label="Import ledger JSON"]');
      Object.defineProperty(input2, 'files', { value: [bad], configurable: true });
      input2.dispatchEvent(new window.Event('change'));
      t.ok(await waitFor(() => toasts.some(x => x.includes('not valid JSON')), 3000), 'a bad file is refused');
      t.same((await ctx.manager.readLedger()).length, 2, 'and nothing changed');
    } finally {
      view.el.remove();
    }
  });

  t.test('LEDGER keeps up to five thousand entries', () => {
    t.same(LEDGER_MAX, 5000);
  });

  t.test('LEDGER without durable storage the ledger stays in localStorage and nothing is deleted', async () => {
    const storage = memoryStorage();
    const manager = createManager({ backend: createMemoryBackend(), getParams: defaultParams, ledgerStorage: storage });
    t.same(manager.ledgerDurable(), false);
    t.same(await manager.readLedger(), null);
    t.ok(await manager.writeLedger([sampleEntry(1)]), 'write reports success when localStorage works');
    t.same(JSON.parse(storage.getItem(LEDGER_KEY)).map(e => e.id), ['r1'], 'written to localStorage');
    const reopened = createManager({ backend: createMemoryBackend(), getParams: defaultParams, ledgerStorage: storage });
    t.same((await reopened.readLedger()).map(e => e.id), ['r1'], 'a fresh session reads it back');
    const bare = createManager({ backend: createMemoryBackend(), getParams: defaultParams });
    t.same(await bare.writeLedger([sampleEntry(2)]), false, 'with no storage at all the write is reported as failed');
    t.same((await bare.readLedger()).map(e => e.id), ['r2'], 'but it still works for this session');
    const failing = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    t.same(await createManager({ backend: createMemoryBackend(), getParams: defaultParams, ledgerStorage: failing }).writeLedger([sampleEntry(3)]), false, 'a full localStorage is reported');
    const durable = createManager({ backend: durableBackend(), getParams: defaultParams, ledgerStorage: storage });
    t.same(durable.ledgerDurable(), true);
    await durable.writeLedger([sampleEntry(4)]);
    t.same(JSON.parse(storage.getItem(LEDGER_KEY)).map(e => e.id), ['r1'], 'a durable store leaves localStorage alone');
  });

  t.test('LEDGER an old localStorage ledger is left in place when only memory storage is available', async () => {
    saveLedger(window.localStorage, [sampleEntry(5)]);
    const ctx = makeContext({ ledgerStorage: window.localStorage });
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(await waitFor(() => view.el.querySelectorAll('.card table.tbl tbody tr').length === 1, 3000), 'the entry is shown');
      t.ok(window.localStorage.getItem(LEDGER_KEY), 'the old copy is not deleted');
      view.el.querySelectorAll('button').forEach(b => { if (b.textContent === 'Log decision') b.click(); });
      await wait(80);
      t.same(JSON.parse(window.localStorage.getItem(LEDGER_KEY)).length, 2, 'new entries are saved to localStorage');
    } finally {
      view.el.remove();
      window.localStorage.removeItem(LEDGER_KEY);
    }
  });
};
