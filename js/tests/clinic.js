import { defaultParams } from '../core/params.js';
import { buildSampleTables } from '../data/samples.js';
import { validateTables } from '../data/validate.js';
import { hydrateSettings } from '../data/migrate.js';
import { plansCsv } from '../data/export.js';
import { evaluateClinic, rankFixes, autoPlan, governanceKpis, orderStability, uncoveredBottlenecks, phaseOf, downstreamOf, fixBlockers } from '../core/plan.js';
import { createClinicView } from '../ui/clinic-view.js';
import { createRng } from '../core/rng.js';
import { FIX_PRESETS } from '../core/params.js';
import { makeContext, wait } from './ui.js';

const sampleSite = (mutate = t => t) => {
  const tables = mutate(buildSampleTables());
  const result = validateTables(tables, defaultParams());
  return { site: result.clinic.sites[0], result };
};

export const register = t => {
  t.test('WP6 optional columns validate: unknown needs fail, bad alternatives and categories warn', () => {
    const { site } = sampleSite();
    t.same(site.fixes.slice(0, 3).map(f => f.needs), [['space'], ['budget', 'staff'], ['budget', 'approval']]);
    t.same(site.weakPoints.slice(0, 3).map(w => w.category), ['bottleneck', 'oversight', 'information']);
    const broken = validateTables((() => {
      const tb = buildSampleTables();
      tb.fixes = tb.fixes.map((f, i) => (i === 0 ? { ...f, needs: 'space cash' } : i === 1 ? { ...f, alternative_to: 'zzz' } : f));
      tb.weak_points = tb.weak_points.map((w, i) => (i === 0 ? { ...w, category: 'ctrl' } : i === 1 ? { ...w, category: 'nonsense' } : w));
      return tb;
    })(), defaultParams());
    t.ok(broken.issues.some(i => i.table === 'fixes' && i.column === 'needs' && i.severity === 'error'), 'unknown need is an error');
    t.ok(broken.issues.some(i => i.table === 'fixes' && i.column === 'alternative_to' && i.severity === 'warning'), 'unknown alternative warns');
    t.ok(broken.issues.some(i => i.table === 'weak_points' && i.column === 'category' && i.severity === 'warning'), 'unknown category warns');
    const old = buildSampleTables();
    old.fixes = old.fixes.map(({ id, title, effort, cost_k }) => ({ id, title, effort, cost_k }));
    old.weak_points = old.weak_points.map(({ category, ...rest }) => rest);
    t.ok(validateTables(old, defaultParams()).ok, 'old uploads without the columns stay valid');
    const coded = buildSampleTables();
    coded.weak_points = coded.weak_points.map((w, i) => (i === 0 ? { ...w, category: 'neck' } : w));
    t.same(validateTables(coded, defaultParams()).clinic.sites[0].weakPoints[0].category, 'bottleneck');
  });

  t.test('WP6 with every resource on and no marks nothing is blocked and the order is by priority', () => {
    const { site } = sampleSite();
    const params = defaultParams();
    const ranking = rankFixes(site, [], params);
    t.same(ranking.blocked.length, 0);
    t.same(ranking.items.length, site.fixes.length);
    for (let i = 1; i < ranking.items.length; i++) t.ok(ranking.items[i - 1].priority >= ranking.items[i].priority - 1e-12);
    t.ok(ranking.items.every(item => item.feasible && item.blockedBy.length === 0));
  });

  t.test('WP6 switching off a resource blocks the fixes that need it and Auto-plan skips them', () => {
    const { site } = sampleSite();
    const params = { ...defaultParams(), budget: Infinity };
    const opts = { resources: { space: true, budget: false, staff: true, approval: true }, marks: {} };
    const ranking = rankFixes(site, [], params, undefined, opts);
    t.same(ranking.blocked.map(i => i.fix.id).sort(), ['f2', 'f3']);
    t.ok(site.fixes.length >= 3);
    t.ok(ranking.blocked.every(i => i.blockedBy.some(r => r.includes('budget'))));
    const plan = autoPlan(site, [], params, opts);
    t.ok(plan.steps.every(step => !['f2', 'f3'].includes(step.fix.id)));
    t.ok(plan.steps.every(step => ['Now', 'Next', 'Later'].includes(step.phase)));
  });

  t.test('WP6 a mark blocks a fix with the matching reason', () => {
    const { site } = sampleSite();
    const marked = (value) => ({ resources: {}, marks: { [site.id]: { f1: value } } });
    t.same(fixBlockers(site, site.fixes[0], marked(0)), []);
    t.same(fixBlockers(site, site.fixes[0], marked(1)), ['Tried before, no effect']);
    t.same(fixBlockers(site, site.fixes[0], marked(2)), ['Other blocker']);
    const ranking = rankFixes(site, [], defaultParams(), undefined, marked(1));
    t.ok(ranking.blocked.some(i => i.fix.id === 'f1'));
    t.ok(!ranking.items.some(i => i.fix.id === 'f1'));
  });

  t.test('WP6 on the sample data the governance KPIs shrink from now to feasible to unlimited', () => {
    const { site } = sampleSite();
    const params = defaultParams();
    const open = governanceKpis(site, [], params, {});
    t.ok(open.riskUnlimited <= open.riskFeasible + 1e-9 && open.riskFeasible <= open.riskNow + 1e-9);
    t.near(open.lostToLimits, 0, 1e-9);
    const limited = governanceKpis(site, [], params, { resources: { budget: false } });
    t.ok(limited.riskUnlimited <= limited.riskFeasible + 1e-9 && limited.riskFeasible <= limited.riskNow + 1e-9);
    t.ok(limited.lostToLimits >= 0);
    t.same(governanceKpis(site, [], params, { resources: { budget: false } }), limited, 'cached result is identical');
  });

  t.test('WP6 phases split into terciles and order stability lists three presets', () => {
    t.same([0, 1, 2, 3, 4, 5].map(i => phaseOf(i, 6)), ['Now', 'Now', 'Next', 'Next', 'Later', 'Later']);
    t.same(phaseOf(0, 1), 'Now');
    t.same(phaseOf(1, 2), 'Next');
    const { site } = sampleSite();
    const stability = orderStability(site, [], defaultParams(), {});
    t.same(stability.presets.map(p => p.name), ['Balanced', 'Risk first', 'Flow first']);
    t.ok(stability.presets.every(p => p.top.length <= 3));
    t.same(typeof stability.same, 'boolean');
  });

  t.test('WP6 uncovered bottlenecks and downstream stations are drawn from the data', () => {
    const { site } = sampleSite();
    const params = { ...defaultParams(), season: 2 };
    const base = evaluateClinic(site, [], params);
    const untargeted = { ...site, effects: [] };
    const all = uncoveredBottlenecks(base.flow, untargeted);
    t.same(all.length, base.flow.stations.filter(st => st.peakRho >= 1).length);
    const covered = uncoveredBottlenecks(base.flow, site);
    t.ok(covered.length <= all.length);
    t.same(downstreamOf('a', [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'x', to: 'y' }]), ['b', 'c']);
  });

  t.test('WP6 plan exports carry phase, feasibility and blocked reasons', () => {
    const { site } = sampleSite();
    const plan = autoPlan(site, [], { ...defaultParams(), budget: Infinity });
    const csv = plansCsv([{ siteId: site.id, steps: plan.steps }]);
    const header = csv.replace(/^\ufeff/, '').split(/\r?\n/)[0];
    t.ok(header.endsWith('phase,feasible,blocked_by'));
  });

  t.test('WP6 settings hydrate resources and marks defensively', () => {
    t.same(hydrateSettings({}).resources, { space: true, budget: true, staff: true, approval: true });
    t.same(hydrateSettings({ resources: { budget: false, space: 'no', other: false } }).resources, { space: true, budget: false, staff: true, approval: true });
    t.same(hydrateSettings({ fixMarks: { main: { f1: 1, f2: 5, f3: 'x' }, bad: 'oops', empty: {} } }).fixMarks, { main: { f1: 1 } });
    t.same(hydrateSettings({ fixMarks: [1, 2] }).fixMarks, {});
  });

  t.test('WP6 the clinic view shows resources, KPIs, the order card and blocked fixes', async () => {
    const ctx = makeContext();
    ctx.settings.clinicMode = 'single';
    const view = createClinicView(ctx);
    Object.assign(ctx.views, { clinic: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(Array.from(view.el.querySelectorAll('small')).some(el => el.textContent === 'lost to resource limits'), 'KPI row');
      t.ok(Array.from(view.el.querySelectorAll('h3')).some(el => el.textContent.startsWith('Does the order hold?')), 'order card');
      t.ok(view.el.querySelector('.phase'), 'phase chip');
      const budget = Array.from(view.el.querySelectorAll('.chk')).find(el => el.textContent.includes('Budget available'));
      budget.click();
      await wait(30);
      t.same(ctx.settings.resources.budget, false);
      const toggle = Array.from(view.el.querySelectorAll('button')).find(b => b.textContent.startsWith('Show blocked fixes'));
      t.ok(toggle, 'blocked section is offered');
      toggle.click();
      await wait(30);
      t.ok(view.el.querySelector('.blocked-why'), 'reasons shown');
      view.el.querySelector('.mark-btn').click();
      await wait(30);
      t.ok(Object.keys(ctx.settings.fixMarks).length === 1, 'a mark was stored');
    } finally {
      view.el.remove();
    }
  });

  t.test('WP6 selecting a weak point lists the stations downstream of it', async () => {
    const ctx = makeContext();
    ctx.settings.clinicMode = 'single';
    const view = createClinicView(ctx);
    Object.assign(ctx.views, { clinic: view });
    document.body.append(view.el);
    try {
      view.update();
      view.el.querySelector('tr[data-id]').click();
      await wait(30);
      const note = Array.from(view.el.querySelectorAll('p.note')).find(p => p.textContent.startsWith('Downstream'));
      t.ok(note, 'downstream line shown');
      t.ok(note.textContent.includes('→') || note.textContent.includes('nothing comes after'), 'a list or an explicit none');
    } finally {
      view.el.remove();
    }
  });

  t.test('PERF cached clinic evaluations equal fresh ones and ignore only the fix weights', () => {
    const { site } = sampleSite();
    for (let i = 0; i < 40; i++) {
      const rng = createRng(t.seed * 97 + i);
      const params = { ...defaultParams(), season: rng.range(0.6, 1.6) };
      const ids = site.fixes.filter(() => rng.chance(0.4)).map(f => f.id);
      const cached = evaluateClinic(site, ids, params);
      const again = evaluateClinic(site, ids.slice().reverse(), params);
      t.same(again, cached, 'order of applied ids does not matter and the hit is shared');
      const fresh = evaluateClinic(structuredClone(site), ids, params);
      t.near(fresh.totR, cached.totR, 1e-9);
      t.near(fresh.pmw, cached.pmw, 1e-9);
      const reweighted = evaluateClinic(site, ids, { ...params, ...FIX_PRESETS['Risk first'] });
      t.same(reweighted, cached, 'fix weights do not change the simulation');
    }
    const params = defaultParams();
    const first = rankFixes(site, [], params).items.map(i => i.fix.id);
    const heavy = rankFixes(site, [], { ...params, ...FIX_PRESETS['Flow first'] }).items.map(i => i.fix.id);
    const freshHeavy = rankFixes(structuredClone(site), [], { ...params, ...FIX_PRESETS['Flow first'] }).items.map(i => i.fix.id);
    t.same(heavy, freshHeavy, 'reweighted ranking from the cache equals a cold run');
    t.ok(first.length === heavy.length);
    const changed = evaluateClinic(site, [], { ...params, season: params.season === 0 ? 1 : 0 });
    t.ok(changed.totR !== evaluateClinic(site, [], params).totR || changed.pmw !== evaluateClinic(site, [], params).pmw, 'a flow parameter does change the result');
  });
};
