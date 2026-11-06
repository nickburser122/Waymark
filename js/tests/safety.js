import { createManager, createMemoryBackend } from '../data/store.js';
import { buildSampleTables } from '../data/samples.js';
import { validateTables } from '../data/validate.js';
import { defaultParams } from '../core/params.js';
import { hydrateSettings, defaultSettings, loadSettings, SETTINGS_KEY } from '../data/migrate.js';
import { createClinicView } from '../ui/clinic-view.js';
import { createRouteView } from '../ui/route-view.js';
import { confidenceLabel } from '../core/route.js';
import { shortcutFor, nextTheme } from '../ui/shortcuts.js';
import { makeContext, wait, waitFor } from './ui.js';

const CLINIC_TABLES = ['stations', 'routes', 'staffing', 'arrivals', 'weak_points', 'fixes', 'fix_effects'];

const twoSiteTables = () => {
  const t = buildSampleTables();
  const out = { ...t };
  CLINIC_TABLES.forEach(name => {
    out[name] = t[name].map(r => ({ ...r, site: 'A' })).concat(t[name].map(r => ({ ...r, site: 'B' })));
  });
  return out;
};

export const register = t => {
  t.test('B1 saved data that fails validation is quarantined, kept visible and never overwritten', async () => {
    const backend = createMemoryBackend();
    const tables = buildSampleTables();
    tables.facilities = tables.facilities.slice(0, 3).map((r, i) => ({ ...r, name: `Mine ${i}`, capacity: 'not a number' }));
    t.ok(!validateTables({ ...buildSampleTables(), ...tables }, defaultParams()).ok, 'the stored dataset fails validation');
    const record = { version: 3, tables, sources: { facilities: 'yours' }, files: {} };
    await backend.set('active', record);
    const manager = createManager({ backend, getParams: defaultParams });
    await manager.init();
    t.same(manager.records('facilities').map(r => r.name), ['Mine 0', 'Mine 1', 'Mine 2'], 'the user rows stay active');
    t.ok(manager.storageNote().includes('backup'), 'the user is told');
    t.same(manager.quarantined().length, 1, 'one backup key');
    const copy = await manager.backup(manager.quarantined()[0]);
    t.same(copy, record, 'backup holds the original record');
    manager.startBlank();
    await wait(30);
    const afterEdit = await backend.get(manager.quarantined()[0]);
    t.same(afterEdit, record, 'the backup survives later edits');
    const again = createManager({ backend, getParams: defaultParams });
    await again.init();
    await again.init();
    t.same(again.quarantined().length, 1, 'an identical record is not backed up twice');
  });

  t.test('B1 a record with the wrong shape is backed up and the samples stay active', async () => {
    const backend = createMemoryBackend();
    await backend.set('active', { version: 9, tables: { facilities: 'broken' } });
    const manager = createManager({ backend, getParams: defaultParams });
    await manager.init();
    t.same(manager.quarantined().length, 1);
    t.ok(manager.records('facilities').length > 0, 'samples remain');
  });

  t.test('B1 healthy saved data is adopted without a backup', async () => {
    const backend = createMemoryBackend();
    await backend.set('active', { version: 3, tables: buildSampleTables(), sources: {}, files: {} });
    const manager = createManager({ backend, getParams: defaultParams });
    await manager.init();
    t.same(manager.quarantined().length, 0);
    t.same(manager.storageNote(), '');
  });

  t.test('B2 applied fixes are stored per site and migrate from the old flat list', () => {
    t.same(defaultSettings().applied, {});
    t.same(hydrateSettings({ siteId: 'B', applied: ['f1', 7, 'f2'] }).applied, { B: ['f1', 'f2'] });
    t.same(hydrateSettings({ applied: ['f1'] }).applied, { main: ['f1'] });
    t.same(hydrateSettings({ applied: { A: ['x'], B: [], C: 'no', D: ['y', 1] } }).applied, { A: ['x'], D: ['y'] });
    t.same(hydrateSettings({ applied: 'bad' }).applied, {});
    const hostile = JSON.parse('{"applied":{"__proto__":["x"]}}');
    const result = hydrateSettings(hostile).applied;
    t.same(Object.getPrototypeOf(result), Object.prototype);
    t.same(Object.keys(result), ['__proto__']);
  });

  t.test('B2 applying a fix in one site leaves a site with the same fix id untouched', async () => {
    const ctx = makeContext();
    const outcome = ctx.manager.apply(twoSiteTables());
    t.ok(outcome.ok, 'two-site dataset is valid');
    const view = createClinicView(ctx);
    Object.assign(ctx.views, { clinic: view });
    document.body.append(view.el);
    try {
      ctx.settings.clinicMode = 'single';
      ctx.settings.siteId = 'A';
      view.update();
      const first = view.el.querySelector('.fixrow .chk');
      t.ok(first, 'fix rows render');
      const fixId = first.dataset.fix;
      first.click();
      t.same(ctx.settings.applied, { A: [fixId] });
      ctx.settings.siteId = 'B';
      view.update();
      t.same(view.el.querySelectorAll('.fixrow .chk[aria-checked="true"]').length, 0, 'site B shows nothing applied');
      ctx.settings.siteId = 'A';
      view.update();
      t.same(view.el.querySelectorAll('.fixrow .chk[aria-checked="true"]').length, 1, 'site A keeps its fix');
      const clear = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Clear applied');
      ctx.settings.siteId = 'B';
      view.update();
      const clearB = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Clear applied');
      clearB.click();
      t.same(ctx.settings.applied, { A: [fixId] }, 'clearing B does not touch A');
      t.ok(clear, 'clear control exists');
    } finally {
      view.el.remove();
    }
  });

  const withWorker = async (WorkerClass, body) => {
    const saved = globalThis.Worker;
    globalThis.Worker = WorkerClass;
    try { await body(); } finally { globalThis.Worker = saved; }
  };

  const mountBatch = () => {
    const ctx = makeContext();
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    ctx.settings.routeMode = 'batch';
    return { ctx, view };
  };

  t.test('B5 a worker error shows a failure card with Retry and stops the progress bar', async () => {
    let created = 0;
    class FailingWorker {
      constructor() { created += 1; this.terminated = false; }
      postMessage() { setTimeout(() => this.onmessage({ data: { type: 'error', message: 'boom' } }), 5); }
      terminate() { this.terminated = true; }
    }
    await withWorker(FailingWorker, async () => {
      const { view } = mountBatch();
      try {
        view.update();
        const shown = await waitFor(() => view.el.textContent.includes('Batch failed'));
        t.ok(shown, 'failure card is shown');
        t.ok(view.el.textContent.includes('boom'), 'message is shown');
        const bar = view.el.querySelector('.progress');
        t.ok(!bar || bar.hidden, 'progress bar is hidden');
        const count = created;
        view.update();
        view.update();
        await wait(300);
        t.same(created, count, 'a failed key is not retried on every update');
        const retry = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Retry');
        t.ok(retry, 'retry button exists');
        retry.click();
        await wait(400);
        t.ok(created > count, 'retry starts a new run');
      } finally {
        view.el.remove();
      }
    });
  });

  t.test('B15 repeated updates do not restart a running batch', async () => {
    let created = 0;
    class SilentWorker {
      constructor() { created += 1; }
      postMessage() {}
      terminate() {}
    }
    await withWorker(SilentWorker, async () => {
      const { view } = mountBatch();
      try {
        view.update();
        await wait(260);
        view.update();
        await wait(260);
        view.update();
        await wait(260);
        t.same(created, 1, 'one worker for one key');
      } finally {
        view.el.remove();
      }
    });
  });

  t.test('B5 a worker that cannot start falls back to the main thread', async () => {
    class BrokenWorker {
      constructor() { throw new Error('no workers'); }
    }
    await withWorker(BrokenWorker, async () => {
      const { view } = mountBatch();
      try {
        view.update();
        const rendered = await waitFor(() => view.el.querySelector('.results-wrap tr[data-id]'));
        t.ok(rendered, 'inline run produced results');
      } finally {
        view.el.remove();
      }
    });
  });

  t.test('B9 undo and redo report what they changed', () => {
    const ctx = makeContext();
    const { manager } = ctx;
    const rows = manager.records('facilities');
    const label = `edit to facilities (${rows.length} rows)`;
    t.ok(manager.apply({ facilities: rows.map((r, i) => (i === 0 ? { ...r, name: 'Renamed' } : r)) }).ok);
    t.same(manager.undo().label, label);
    t.same(manager.redo().label, label);
    t.same(manager.undo().label, label);
    t.same(manager.undo(), false, 'nothing left to undo');
  });

  t.test('B14 the single view restores the saved patient and reloads it after a data edit', async () => {
    const ctx = makeContext();
    const patients = ctx.manager.records('patients');
    ctx.settings.patientId = patients[12].id;
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(view.el.textContent.includes(patients[12].name), 'saved patient shown');
      const urgencyOn = () => view.el.querySelector('[aria-label="Urgency"] [aria-checked="true"]').dataset.v;
      const before = urgencyOn();
      const next = before === '2' ? 'routine' : 'urgent';
      const outcome = ctx.manager.apply({ patients: patients.map(p => (p.id === patients[12].id ? { ...p, urgency: next } : p)) });
      t.ok(outcome.ok);
      view.update();
      t.ok(urgencyOn() !== before, 'the edited urgency is picked up');
      t.ok(view.el.querySelector('.sel-btn[aria-label="More patients"]'), 'more-patients picker exists');
    } finally {
      view.el.remove();
    }
  });

  t.test('B6 counting capacity in the single view uses the batch placements', async () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'batch';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(await waitFor(() => view.el.querySelector('.results-wrap tr[data-id]'), 8000), 'batch rendered');
      view.el.querySelector('.results-wrap tr[data-id]').click();
      await wait(50);
      t.same(ctx.settings.routeMode, 'single');
      const chip = Array.from(view.el.querySelectorAll('.tag')).find(el => el.textContent.startsWith('As placed in batch'));
      t.ok(chip && !chip.hidden, 'batch chip shown');
      const toggle = Array.from(view.el.querySelectorAll('.chk')).find(el => el.textContent.includes('Count this week'));
      t.same(toggle.getAttribute('aria-checked'), 'true');
      toggle.click();
      await wait(20);
      t.ok(chip.hidden, 'chip hides when capacity counting is off');
    } finally {
      view.el.remove();
    }
  });

  const fakeStorage = initial => {
    const map = new Map(Object.entries(initial));
    return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, has: k => map.has(k), raw: k => map.get(k) };
  };

  t.test('WP9 the v2 theme key is adopted once and left in place', () => {
    const storage = fakeStorage({ 'meridian.theme': 'light' });
    t.same(loadSettings(storage).theme, 'light');
    t.ok(storage.has('meridian.theme'), 'old key kept');
    t.ok(storage.has(SETTINGS_KEY), 'v3 saved');
    const quoted = fakeStorage({ 'meridian.theme': '"dark"' });
    t.same(loadSettings(quoted).theme, 'dark');
    t.same(loadSettings(fakeStorage({ 'meridian.theme': 'sepia' })).theme, defaultSettings().theme);
    const noV3 = fakeStorage({ 'meridian.theme': 'light', [SETTINGS_KEY]: JSON.stringify({ theme: 'dark' }) });
    t.same(loadSettings(noV3).theme, 'dark', 'existing v3 settings win');
    const withV2 = fakeStorage({ 'meridian.theme': 'light', 'waymark.v2': JSON.stringify({}) });
    t.ok(loadSettings(withV2).theme !== undefined);
  });

  t.test('S5 confidence labels are sentence case and keyboard users reach heat rows', () => {
    const cfg = { marginClear: 0.08, marginModerate: 0.03 };
    t.same([confidenceLabel(null, 1, cfg), confidenceLabel(0.2, 2, cfg), confidenceLabel(0.05, 2, cfg), confidenceLabel(0.01, 2, cfg), confidenceLabel(0, 0, cfg)], ['Only option', 'Clear lead', 'Moderate lead', 'Near tie', 'None']);
    const ctx = makeContext();
    ctx.settings.clinicMode = 'single';
    const view = createClinicView(ctx);
    Object.assign(ctx.views, { clinic: view });
    document.body.append(view.el);
    try {
      view.update();
      const label = view.el.querySelector('.heat .r');
      t.same(label.getAttribute('tabindex'), '0');
      t.ok(label.getAttribute('data-tip').includes('peaks at'));
    } finally {
      view.el.remove();
    }
  });

  t.test('S5 the empty routing state points at services when only services are missing', async () => {
    const backend = createMemoryBackend();
    await backend.set('active', { version: 3, tables: { ...buildSampleTables(), services: [] }, sources: {}, files: {} });
    const ctx = makeContext({ backend });
    await ctx.manager.init();
    const view = createRouteView(ctx);
    document.body.append(view.el);
    try {
      view.update();
      t.ok(view.el.querySelector('.empty-text').textContent.includes('services'), 'message names services');
    } finally {
      view.el.remove();
    }
  });

  t.test('WP8 shortcuts switch views and cycle the theme, except while typing or with modifiers', () => {
    const press = (key, target = document.body, mods = {}) => shortcutFor({ key, target, ctrlKey: false, metaKey: false, altKey: false, ...mods }, 4);
    t.same(press('1'), { type: 'view', index: 0 });
    t.same(press('4'), { type: 'view', index: 3 });
    t.same(press('5'), null);
    t.same(press('T'), { type: 'theme' });
    const input = document.createElement('input');
    const box = document.createElement('div');
    box.className = 'dd';
    const inner = document.createElement('span');
    box.append(inner);
    document.body.append(input, box);
    t.same(press('1', input), null);
    t.same(press('t', inner), null);
    t.same(press('1', document.body, { ctrlKey: true }), null);
    t.same(press('t', document.body, { altKey: true }), null);
    input.remove();
    box.remove();
    t.same(['system', 'light', 'dark'].map(nextTheme), ['light', 'dark', 'system']);
  });

  t.test('B20 fonts are served locally: no external font hosts and every font file resolves', async () => {
    const index = await (await fetch(new URL('../../index.html', import.meta.url))).text();
    t.ok(!/googleapis|gstatic/.test(index), 'index.html has no Google Fonts links');
    const cssUrl = new URL('../../css/fonts.css', import.meta.url);
    const css = await (await fetch(cssUrl)).text();
    const urls = Array.from(css.matchAll(/url\("([^"]+)"\)/g)).map(m => m[1]);
    t.same(urls.length, 6, 'six font files declared');
    for (const rel of urls) {
      t.ok(!/^https?:/.test(rel), `${rel} is local`);
      const res = await fetch(new URL(rel, cssUrl));
      t.ok(res.ok, `${rel} loads`);
      t.ok((await res.text()).length > 5000, `${rel} is not empty`);
    }
    ['Instrument Sans', 'Fraunces', 'JetBrains Mono'].forEach(name => t.ok(css.includes(`font-family: "${name}"`), `${name} declared`));
  });

  t.test('B1 a quarantined backup can be deleted one at a time or all at once', async () => {
    const backend = createMemoryBackend();
    const bad = n => ({ version: 3, tables: { facilities: [{ id: `x${n}`, capacity_per_day: 'bad' }] }, sources: {}, files: {} });
    await backend.set('active', bad(1));
    let manager = createManager({ backend, getParams: defaultParams });
    await manager.init();
    await backend.set('active', bad(2));
    manager = createManager({ backend, getParams: defaultParams });
    await manager.init();
    t.same(manager.quarantined().length, 2);
    const [first] = manager.quarantined();
    t.same(await manager.deleteBackup('quarantine-missing'), false);
    t.same(await manager.deleteBackup(first), true);
    t.same(manager.quarantined().length, 1);
    t.same(await backend.get(first), null, 'the copy is gone from storage');
    t.same(await manager.deleteAllBackups(), 1);
    t.same(manager.quarantined(), []);
  });
};
