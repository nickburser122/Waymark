import { generatePatients } from '../data/synth.js';
import { buildSampleTables } from '../data/samples.js';
import { validateTables } from '../data/validate.js';
import { defaultParams } from '../core/params.js';
import { createDataView } from '../ui/data-view.js';
import { makeContext, wait } from './ui.js';

const GOLDEN = [
  { id: 'S0001', name: 'Synthetic 1', x: '77.0', y: '44.3', needs: 'peds xray physio', urgency: 'soon', previous_site: '' },
  { id: 'S0002', name: 'Synthetic 2', x: '26.9', y: '55.6', needs: 'lab cardio', urgency: 'routine', previous_site: '' },
  { id: 'S0003', name: 'Synthetic 3', x: '87.9', y: '13.7', needs: 'onco xray', urgency: 'routine', previous_site: '' }
];

export const register = t => {
  t.test('WP7 the same seed gives the same patients and a different seed gives others', () => {
    const base = buildSampleTables();
    const a = generatePatients({ facilities: base.facilities, services: base.services, n: 3, seed: 1 });
    t.same(a, GOLDEN);
    t.same(generatePatients({ facilities: base.facilities, services: base.services, n: 3, seed: 1 }), a);
    t.ok(JSON.stringify(generatePatients({ facilities: base.facilities, services: base.services, n: 3, seed: 2 })) !== JSON.stringify(a));
  });

  t.test('WP7 every generated row passes validation and needs are offered somewhere', () => {
    const tables = buildSampleTables();
    tables.patients = generatePatients({ facilities: tables.facilities, services: tables.services, n: 300, seed: 7 });
    const result = validateTables(tables, defaultParams());
    t.ok(result.ok, 'valid');
    const offered = new Set(tables.facilities.flatMap(f => f.services.split(/\s+/)));
    tables.patients.forEach(p => t.ok(p.needs.split(' ').every(id => offered.has(id)) && p.needs.split(' ').length <= 3));
    const mix = { routine: 0, soon: 0, urgent: 0 };
    tables.patients.forEach(p => { mix[p.urgency] += 1; });
    t.ok(mix.routine > mix.soon && mix.soon > mix.urgent, 'urgency mix follows 70/23/7');
  });

  t.test('WP7 geographic facilities give geographic patients near them', () => {
    const facilities = [
      { id: 'a', services: 'x', capacity_per_day: '10', lat: '10', lon: '20' },
      { id: 'b', services: 'x', capacity_per_day: '1', lat: '11', lon: '21' }
    ];
    const rows = generatePatients({ facilities, services: [{ id: 'x' }], n: 50, seed: 3 });
    t.ok(rows.every(r => r.lat !== undefined && r.x === undefined));
    t.ok(rows.every(r => Math.abs(Number(r.lat) - 10) <= 1.2 && Math.abs(Number(r.lon) - 20) <= 1.2));
    t.ok(rows.filter(r => Math.abs(Number(r.lat) - 10) <= 0.11).length > 25, 'weighted toward the larger site');
  });

  t.test('WP7 ten thousand patients are generated and accepted', () => {
    const tables = buildSampleTables();
    const started = performance.now();
    tables.patients = generatePatients({ facilities: tables.facilities, services: tables.services, n: 10000, seed: 11 });
    t.same(tables.patients.length, 10000);
    t.ok(validateTables(tables, defaultParams()).ok);
    t.ok(performance.now() - started < 20000);
  });

  t.test('WP7 the Data tab generates, appends with fresh ids and undoes in one step', async () => {
    const ctx = makeContext();
    ctx.settings.dataModel = 'route';
    ctx.settings.dataTable = 'patients';
    ctx.settings.dataLayout = 'table';
    const view = createDataView(ctx);
    document.body.append(view.el);
    try {
      view.update();
      const open = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Generate patients…');
      t.ok(open, 'button on the patients table');
      open.click();
      await wait(20);
      const run = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent === 'Generate');
      run.click();
      await wait(50);
      const rows = ctx.manager.records('patients');
      t.same(rows.length, 100);
      t.same(rows[0].id, 'S0001');
      t.ok(ctx.manager.canUndo());
      ctx.manager.undo();
      t.ok(ctx.manager.records('patients').length !== 100, 'undo restores the previous patients');
    } finally {
      view.el.remove();
    }
  });
};
