import { defaultSettings } from '../data/migrate.js';
import { createManager, createMemoryBackend } from '../data/store.js';
import { buildSampleTables } from '../data/samples.js';
import { sanitiseValue, BY_KEY } from '../core/params.js';
import { createRouteView } from '../ui/route-view.js';
import { createClinicView } from '../ui/clinic-view.js';
import { createDataView } from '../ui/data-view.js';
import { createEqView } from '../ui/eq-view.js';

const PAYLOAD = '<img src=x onerror="window.__pwn=1">';

export const hostileTables = () => {
  const t = buildSampleTables();
  const rename = (list, key) => list.map(r => ({ ...r, [key]: `${PAYLOAD} ${r[key]}` }));
  return {
    ...t,
    facilities: rename(t.facilities, 'name'),
    services: rename(t.services, 'name'),
    patients: rename(t.patients, 'name'),
    stations: rename(t.stations, 'name'),
    weak_points: rename(t.weak_points, 'title'),
    fixes: rename(t.fixes, 'title')
  };
};

export const memoryStorage = () => {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: key => { map.delete(key); } };
};

export const durableBackend = () => ({ ...createMemoryBackend(), persistent: true });

export const makeContext = (options = {}) => {
  const settings = defaultSettings();
  const manager = createManager({ backend: options.backend || createMemoryBackend(), getParams: () => settings.params, ledgerStorage: options.ledgerStorage || memoryStorage() });
  const views = {};
  const ctx = {
    settings,
    manager,
    params: () => settings.params,
    persist: () => {},
    focus: null,
    setParam: (key, value) => { settings.params[key] = sanitiseValue(BY_KEY[key], value); ctx.changed(); },
    setParams: patch => { Object.keys(patch).forEach(k => { settings.params[k] = sanitiseValue(BY_KEY[k], patch[k]); }); ctx.changed(); },
    setPipe: () => {},
    navigate: () => {},
    changed: () => Object.values(views).forEach(v => v.update()),
    explainMode: () => settings.explain,
    toast: () => {},
    views
  };
  return ctx;
};

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const waitFor = async (probe, limit = 6000) => {
  const started = performance.now();
  while (performance.now() - started < limit) {
    if (probe()) return true;
    await wait(40);
  }
  return false;
};

export const register = t => {
  t.test('S1 hostile names render as text in every view and never run', async () => {
    delete window.__pwn;
    const ctx = makeContext();
    const outcome = ctx.manager.apply(hostileTables());
    t.ok(outcome.ok, 'hostile dataset is valid');
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:-9999px;width:1200px';
    document.body.append(stage);
    try {
      const route = createRouteView(ctx);
      const clinic = createClinicView(ctx);
      const data = createDataView(ctx);
      const eq = createEqView(ctx);
      Object.assign(ctx.views, { route, clinic, data, eq });
      [route, clinic, data, eq].forEach(v => stage.append(v.el));

      ctx.settings.routeMode = 'single';
      route.update();
      t.ok(route.el.textContent.includes(PAYLOAD), 'single routing shows the text');

      ctx.settings.routeMode = 'batch';
      route.update();
      const rendered = await waitFor(() => route.el.querySelector('.results-wrap tr[data-id]'));
      t.ok(rendered, 'batch results rendered');
      t.ok(route.el.textContent.includes(PAYLOAD), 'batch routing shows the text');

      ctx.settings.clinicMode = 'single';
      clinic.update();
      t.ok(clinic.el.textContent.includes(PAYLOAD), 'clinic single shows the text');
      ctx.settings.clinicMode = 'batch';
      clinic.update();

      data.update();
      data.focus({ table: 'facilities', edit: true });
      const cell = Array.from(data.el.querySelectorAll('input.gcell')).find(input => input.value.includes(PAYLOAD));
      t.ok(cell, 'grid keeps the text as a value');
      data.update();
      eq.update();
      await wait(150);
      t.ok(window.__pwn === undefined, 'no injected handler ran');
      t.ok(stage.querySelectorAll('img').length === 0, 'no injected element exists');
    } finally {
      stage.remove();
    }
  });

  t.test('S1 hostile text inside SVG labels and tooltips stays text', async () => {
    delete window.__pwn;
    const ctx = makeContext();
    ctx.manager.apply(hostileTables());
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:-9999px;width:1200px';
    document.body.append(stage);
    try {
      const route = createRouteView(ctx);
      Object.assign(ctx.views, { route });
      stage.append(route.el);
      route.update();
      const label = Array.from(stage.querySelectorAll('svg text')).find(n => n.textContent.includes(PAYLOAD));
      t.ok(label, 'map label shows the text');
      const node = stage.querySelector('.fnode');
      t.ok(node.getAttribute('data-tip').includes(PAYLOAD), 'tooltip text carries the raw string');
      t.ok(stage.querySelectorAll('img').length === 0, 'no injected element');
      t.ok(window.__pwn === undefined, 'no handler ran');
    } finally {
      stage.remove();
    }
  });
};
