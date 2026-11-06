import { h, Segmented, Select, Slider, NumberField, Check, ChipGroup, keepState } from './components.js';
import { html, setHtml } from './escape.js';
import { sourcePill, weightPanel, advancedPanel, download, fmtPct } from './panels.js';
import { explainRisk, explainFix, FIX_META, RISK_ANCHORS } from './explain.js';
import { FIX_PRESETS, FIX_WEIGHT_KEYS } from '../core/params.js';
import { evaluateClinic, rankFixes, autoPlan, downstreamOf, governanceKpis, orderStability, uncoveredBottlenecks, phaseOf, MARK_LABELS, RESOURCE_KEYS } from '../core/plan.js';
import { RISK_CATEGORIES } from '../data/validate.js';
import { plansCsv } from '../data/export.js';
import { fmtNum } from '../core/stats.js';

const TIME = (flow, b) => {
  const minutes = flow.hours[Math.floor(b / flow.per)] * 60 + (b % flow.per) * flow.dt;
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return flow.dt === 60 ? String(hh) : `${hh}:${String(mm).padStart(2, '0')}`;
};

const clockText = minutes => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

const heatColor = rho => (rho < 0.6 ? 'var(--heat0)' : rho < 0.85 ? 'var(--heat1)' : rho < 1 ? 'var(--heat2)' : 'var(--heat3)');

const siteLabel = id => (id === 'main' ? 'Main clinic' : id);

export const createClinicView = ctx => {
  const { manager, settings } = ctx;
  const root = h('section', { class: 'view', id: 'v-clinic', 'aria-label': 'Clinic' });
  const modeSwitch = Segmented({
    label: 'Clinic mode', options: [{ value: 'single', label: 'Single' }, { value: 'batch', label: 'Batch' }], value: settings.clinicMode,
    onChange: v => { settings.clinicMode = v; ctx.persist(); update(); }
  });
  root.append(h('div', { class: 'viewhead' }, h('h2', { text: 'Clinic' }), modeSwitch.el));
  const empty = h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { text: 'No clinic data yet.' }),
    h('button', { type: 'button', class: 'btn', text: 'Add rows', onClick: () => ctx.navigate('data', { table: 'stations', edit: true }) }),
    h('button', { type: 'button', class: 'btn', text: 'Upload CSV', onClick: () => ctx.navigate('data', { table: 'stations' }) })));
  root.append(empty);

  const state = { selectedRisk: '', openFix: '', planShown: false, focusFix: '', category: '', showBlocked: false };
  const pill = sourcePill(ctx, {
    tables: ['stations', 'staffing', 'arrivals', 'routes', 'weak_points', 'fixes', 'fix_effects'], primary: 'stations', unit: 'stations', editTable: 'stations',
    count: () => manager.records('stations').length
  });
  const siteHost = h('div');
  let siteSelect = null;
  let siteSignature = '';
  const seasonSlider = Slider({ label: 'Demand multiplier', min: 0.5, max: 2, step: 0.01, value: ctx.params().season, format: v => `×${v.toFixed(2)}`, color: 'var(--persimmon)', onInput: v => ctx.setParam('season', v) });
  const budgetField = NumberField({ label: 'Budget in thousands', value: ctx.params().budget, min: 0, max: 10000, step: 1, unit: 'k', allowBlank: true, blankText: '', onChange: v => ctx.setParam('budget', v) });
  budgetField.input.setAttribute('placeholder', 'No limit');
  const controlCard = h('div', { class: 'card' }, h('h3', {}, 'Season and budget', h('span', { text: 'stage 1 + 6' })),
    h('span', { class: 'lbl', text: 'Site' }), siteHost,
    h('span', { class: 'lbl', text: 'Demand multiplier' }), seasonSlider.el,
    h('span', { class: 'lbl', text: 'Budget for Auto-plan' }), budgetField.el);
  const weights = weightPanel(ctx, { title: 'Fix priority weights', kicker: 'stage 5', keys: FIX_WEIGHT_KEYS, letters: ['R', 'O', 'P', 'B'], meta: FIX_META, presets: FIX_PRESETS });
  const advanced = advancedPanel(ctx, 'clinic');
  const advCard = h('div', { class: 'card' }, advanced.el);

  const resChecks = RESOURCE_KEYS.map(key => Check({
    label: `${key[0].toUpperCase()}${key.slice(1)} available`, checked: settings.resources[key] !== false,
    onChange: on => { settings.resources = { ...settings.resources, [key]: on }; state.planShown = false; ctx.persist(); update(); }
  }));
  const resCard = h('div', { class: 'card' }, h('h3', {}, 'Resources', h('span', { text: 'stage 6' })),
    h('p', { class: 'note', text: 'Switch off a resource to block every fix that needs it.' }), h('div', { class: 'res-list' }, resChecks.map(c => c.el)));
  const categoryChips = ChipGroup({
    label: 'Weak point category', selected: [''],
    options: [{ value: '', label: 'All' }].concat(RISK_CATEGORIES.map(c => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))),
    onChange: v => { state.category = v; update(); }
  });
  const orderCard = h('div', { class: 'card' });
  const uncoveredCard = h('div', { class: 'card' });
  uncoveredCard.hidden = true;
  const kpiCard = h('div', { class: 'card' });
  const heatCard = h('div', { class: 'card' });
  const weakCard = h('div', { class: 'card' });
  const fixCard = h('div', { class: 'card' });
  const singleRight = h('div', { class: 'col' }, kpiCard, heatCard, h('div', { class: 'grid g2' }, weakCard, fixCard), orderCard, uncoveredCard);
  const singleLeft = h('div', { class: 'col' }, pill.el);
  const singlePane = h('div', { class: 'grid gclinic' }, singleLeft, singleRight);
  const batchPill = sourcePill(ctx, {
    tables: ['stations', 'staffing', 'arrivals', 'routes', 'weak_points', 'fixes', 'fix_effects'], primary: 'stations', unit: 'stations', editTable: 'stations',
    count: () => manager.records('stations').length
  });
  const batchCard = h('div', { class: 'card' });
  const batchLeft = h('div', { class: 'col' }, batchPill.el);
  const batchPane = h('div', { class: 'grid gclinic' }, batchLeft, batchCard);
  root.append(singlePane, batchPane);

  const sitesOf = compiled => compiled.clinic.sites;
  const currentSite = compiled => {
    const sites = sitesOf(compiled);
    return sites.find(s => s.id === settings.siteId) || sites[0];
  };
  const appliedFor = site => {
    const stored = Object.entries(settings.applied).find(([key]) => key === site.id);
    return (stored ? stored[1] : []).filter(id => site.fixes.some(f => f.id === id));
  };
  const clinicOpts = () => ({ resources: settings.resources, marks: settings.fixMarks });
  const markOf = (site, fixId) => {
    const forSite = Object.entries(settings.fixMarks).find(([key]) => key === site.id);
    const found = forSite ? Object.entries(forSite[1]).find(([key]) => key === fixId) : null;
    return found ? found[1] : 0;
  };
  const cycleMark = (site, fixId) => {
    const next = (markOf(site, fixId) + 1) % 3;
    const sites = Object.entries(settings.fixMarks).filter(([key]) => key !== site.id);
    const own = Object.entries((Object.entries(settings.fixMarks).find(([key]) => key === site.id) || [null, {}])[1]).filter(([key]) => key !== fixId);
    if (next) own.push([fixId, next]);
    if (own.length) sites.push([site.id, Object.fromEntries(own)]);
    settings.fixMarks = Object.fromEntries(sites);
    state.planShown = false;
    ctx.persist();
    update();
  };
  const setApplied = (site, ids) => {
    const entries = Object.entries(settings.applied).filter(([key]) => key !== site.id);
    if (ids.length) entries.push([site.id, ids]);
    settings.applied = Object.fromEntries(entries);
  };

  const syncSite = compiled => {
    const sites = sitesOf(compiled);
    const signature = sites.map(s => s.id).join('|');
    if (signature !== siteSignature) {
      siteSignature = signature;
      siteSelect = Select({ label: 'Site', options: sites.map(s => ({ value: s.id, label: siteLabel(s.id) })), value: currentSite(compiled).id, onChange: id => { settings.siteId = id; state.planShown = false; ctx.persist(); update(); } });
      siteHost.replaceChildren(siteSelect.el);
    }
    siteSelect.setValue(currentSite(compiled).id);
  };

  const paintSingle = compiled => {
    const site = currentSite(compiled);
    const params = ctx.params();
    const applied = appliedFor(site);
    const base = evaluateClinic(site, applied, params);
    const opts = clinicOpts();
    const ranking = rankFixes(site, applied, params, base, opts);
    const kpis = governanceKpis(site, applied, params, opts);
    const flow = base.flow;
    const formula = ctx.explainMode() === 'formula';
    const bottleneck = flow.bottleneck;
    const high = base.risks.filter(r => r.band === 'high').length;
    setHtml(kpiCard, html`<h3>Clinic health <span>live from the pipeline</span></h3><div class="kpi">
      <div><b>${Math.round(flow.entryDaily)}</b><small>patients per day</small></div>
      <div><b>${Math.round(base.pmw).toLocaleString('en-US')}</b><small>patient-minutes waiting</small></div>
      <div><b>${base.totR.toFixed(0)}</b><small>total risk · ${high} high</small></div>
      <div><b>${bottleneck ? bottleneck.name : '—'}</b><small>${bottleneck ? `bottleneck at ${clockText(bottleneck.peakWaitStart)}` : 'bottleneck'}</small></div></div>
      <div class="kpi"><div><b>${kpis.riskNow.toFixed(0)}</b><small>risk now</small></div>
      <div><b>${kpis.riskFeasible.toFixed(0)}</b><small>after feasible fixes</small></div>
      <div><b>${kpis.riskUnlimited.toFixed(0)}</b><small>with unlimited resources</small></div>
      <div><b>${kpis.lostToLimits.toFixed(0)}</b><small>lost to resource limits</small></div></div>
      <p class="note">Ticking a fix re-runs the pipeline. Remaining fixes are re-ranked against the new baseline.</p>`);

    const cols = flow.buckets;
    const cells = [html`<span class="h"></span>`].concat(Array.from({ length: cols }, (_, b) => html`<span class="h">${TIME(flow, b)}</span>`));
    flow.stations.forEach(st => {
      cells.push(html`<span class="r" tabindex="0" data-tip="${st.name} · peaks at ${Math.min(st.peakRho, 9.99) > 2 ? '>200' : Math.round(st.peakRho * 100)}% at ${clockText(st.peakStart)} · longest wait ${Math.round(st.peakWait)} min">${st.name}</span>`);
      for (let b = 0; b < cols; b++) {
        const rho = st.rho[b];
        const text = !Number.isFinite(rho) || rho > 2 ? '>200' : String(Math.round(rho * 100));
        cells.push(html`<span style="background:${heatColor(rho)}" data-tip="${st.name} · ${TIME(flow, b)} · load ${text}% · wait ${Math.round(st.wq[b])} min">${text}</span>`);
      }
    });
    setHtml(heatCard, html`<h3>Queue heatmap — load by hour <span>% of capacity · stage 2 + 3</span></h3><div class="heat-scroll"><div class="heat" style="grid-template-columns:110px repeat(${cols},minmax(34px,1fr))">${cells}</div></div>`);

    const stationName = new Map(flow.stations.map(s => [s.id, s.name]));
    if (!base.risks.some(r => r.id === state.selectedRisk)) state.selectedRisk = '';
    const sel = base.risks.find(r => r.id === state.selectedRisk);
    const rex = sel ? explainRisk(sel, params) : null;
    const stationNames = new Map(base.flow.stations.map(st => [st.id, st.name]));
    const downstream = sel ? downstreamOf(sel.station, site.routes).map(id => stationNames.get(id) || id) : [];
    const categoryOf = new Map(site.weakPoints.map(w => [w.id, w.category || '']));
    const shown = state.category ? base.risks.filter(r => categoryOf.get(r.id) === state.category) : base.risks;
    const tip = key => RISK_ANCHORS[key].join(' | ');
    const weakHeadings = html`<span data-tip="${tip('I')}" tabindex="0">I</span> <span data-tip="${tip('F')}" tabindex="0">F</span> <span data-tip="${tip('P')}" tabindex="0">P</span> <span data-tip="${tip('D')}" tabindex="0">D</span>`;
    setHtml(weakCard, html`<h3>Weak points <span>stage 4 · risk</span></h3>
      ${shown.length ? html`<div class="table-scroll"><table><thead><tr><th>Weak point</th><th>${weakHeadings}</th><th>Peak</th><th>Risk</th></tr></thead><tbody>
      ${shown.slice().sort((a, b) => b.r - a.r).map(r => html`<tr class="clickable" tabindex="0" data-id="${r.id}" style="cursor:pointer${r.id === state.selectedRisk ? ';background:var(--paper)' : ''}">
        <td>${categoryOf.get(r.id) ? html`<span class="catdot c-${categoryOf.get(r.id)}" data-tip="${categoryOf.get(r.id)}"></span>` : ''}<b>${r.title}</b><br><small style="color:var(--mu)">${stationName.get(r.station) || r.station}</small></td>
        <td class="m">${r.I} ${r.F} ${r.P} ${r.D}</td><td class="m">${fmtPct(Math.min(r.peak, 9.99))}</td>
        <td><span class="band ${r.band}">${r.r.toFixed(0)} ${r.band}</span></td></tr>`)}</tbody></table></div>` : html`<div class="empty">No weak points yet.</div>`}
      ${rex ? html`<div class="explain-box">${formula ? html`<pre class="formula">${rex.formula}</pre>` : html`<ul>${rex.plain.map(s => html`<li>${s}</li>`)}</ul>`}</div>
      <p class="note"><b>Downstream</b> · ${downstream.length ? downstream.join(' → ') : 'nothing comes after this station.'}</p>` : html`<p class="note">Select a row to see how its risk is built.</p>`}`);
    categoryChips.setSelected([state.category]);
    const weakHead = weakCard.querySelector('h3');
    if (weakHead) weakHead.after(categoryChips.el);
    weakCard.querySelectorAll('tr[data-id]').forEach(tr => {
      const choose = () => { state.selectedRisk = tr.dataset.id; paintSingle(compiled); };
      tr.addEventListener('click', choose);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    });

    const appliedFixes = site.fixes.filter(f => applied.includes(f.id));
    const plan = state.planShown ? autoPlan(site, applied, params, opts) : null;
    const budgetText = params.budget === Infinity ? 'no limit' : `${fmtNum(params.budget)}k`;
    fixCard.replaceChildren();
    const head = h('h3', {}, 'Fix plan', h('span', { text: 'stage 5 + 6 · value per effort' }));
    const list = h('div');
    const feasibleTitles = new Set(ranking.items.map(item => item.fix.id).concat(applied));
    const addRow = (fix, item, isApplied, index = 0, blocked = false) => {
      const check = Check({ label: '', checked: isApplied, onChange: on => {
        const next = new Set(appliedFor(site));
        if (on) next.add(fix.id); else next.delete(fix.id);
        setApplied(site, Array.from(next));
        state.focusFix = fix.id;
        ctx.persist();
        ctx.changed();
      } });
      check.el.setAttribute('aria-label', `${isApplied ? 'Undo' : 'Apply'} ${fix.title}`);
      check.el.dataset.fix = fix.id;
      const detail = isApplied ? 'Applied' : `risk −${item.dR.toFixed(1)} · waiting −${Math.round(item.dPMW)} min`;
      const why = h('button', { type: 'button', class: 'why-btn', text: state.openFix === fix.id ? 'Hide' : 'Why', 'aria-expanded': String(state.openFix === fix.id), onClick: () => { state.openFix = state.openFix === fix.id ? '' : fix.id; paintSingle(compiled); } });
      const label = h('div', {}, h('b', { text: fix.title }), h('small', { text: `Effort ${fix.effort} · ${fix.cost}k · ${detail}` }));
      const right = h('div', { class: 'pr' }, isApplied ? '✓' : item.priority.toFixed(2));
      const row = h('div', { class: 'fixrow' }, check.el, label, right);
      if (!isApplied && !blocked) label.append(h('span', { class: `phase phase-${phaseOf(index, ranking.items.length).toLowerCase()}`, text: phaseOf(index, ranking.items.length) }));
      if (blocked) {
        check.el.disabled = true;
        check.el.setAttribute('aria-disabled', 'true');
        label.append(h('small', { class: 'blocked-why', text: item.blockedBy.join('; ') }));
        const altFix = fix.alternativeTo ? site.fixes.find(f => f.id === fix.alternativeTo) : site.fixes.find(f => f.alternativeTo === fix.id);
        if (altFix && feasibleTitles.has(altFix.id)) label.append(h('small', { class: 'blocked-why', text: `Instead: ${altFix.title}` }));
      }
      list.append(row);
      if (!isApplied) {
        const mark = markOf(site, fix.id);
        label.append(h('button', { type: 'button', class: `mark-btn mark-${mark}`, text: MARK_LABELS[mark], 'aria-label': `Mark ${fix.title}: ${MARK_LABELS[mark]}. Activate to change.`, onClick: () => cycleMark(site, fix.id) }));
      }
      if (!isApplied && state.openFix === fix.id) {
        const ex = explainFix(item, params);
        list.append(h('div', { class: 'explain-box' }, formula ? h('pre', { class: 'formula', text: ex.formula }) : h('ul', {}, ex.plain.map(s => h('li', { text: s })))));
      }
      if (!isApplied && !blocked) row.append(why);
    };
    appliedFixes.forEach(f => addRow(f, null, true));
    ranking.items.forEach((item, i) => addRow(item.fix, item, false, i));
    if (ranking.blocked.length) {
      list.append(h('button', { type: 'button', class: 'btn quiet', text: `${state.showBlocked ? 'Hide' : 'Show'} blocked fixes (${ranking.blocked.length})`, 'aria-expanded': String(state.showBlocked), onClick: () => { state.showBlocked = !state.showBlocked; paintSingle(compiled); } }));
      if (state.showBlocked) ranking.blocked.forEach(item => addRow(item.fix, item, false, 0, true));
    }
    if (!site.fixes.length) list.append(h('div', { class: 'empty', text: 'No fixes yet.' }));
    const toolbar = h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn primary', text: 'Auto-plan', onClick: () => { state.planShown = true; paintSingle(compiled); } }),
      h('button', { type: 'button', class: 'btn quiet', text: 'Clear applied', onClick: () => { setApplied(site, []); state.planShown = false; ctx.persist(); update(); } }));
    fixCard.append(head, list, toolbar);
    if (plan) {
      const box = h('div', { class: 'plan-steps' });
      setHtml(box, html`<b>Plan within ${budgetText}</b>${plan.steps.length ? html`<ol>${plan.steps.map(s => html`<li>${s.phase} · ${s.fix.title} · ${s.cost}k · risk −${s.dR.toFixed(1)} · total ${s.cumulative}k</li>`)}</ol>` : html`<p class="note">Nothing fits.</p>`}`);
      const acts = h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn', text: 'Apply plan', onClick: () => { setApplied(site, Array.from(new Set(applied.concat(plan.steps.map(s => s.fix.id))))); state.planShown = false; ctx.persist(); update(); } }),
        h('button', { type: 'button', class: 'btn', text: 'Export CSV', onClick: () => download('waymark-plan.csv', plansCsv([{ siteId: site.id, steps: plan.steps }])) }));
      box.append(acts);
      fixCard.append(box);
    }
    if (state.focusFix) {
      const target = fixCard.querySelector(`[data-fix="${CSS.escape(state.focusFix)}"]`) || fixCard.querySelector('.chk');
      if (target) target.focus();
      state.focusFix = '';
    }
    const stability = orderStability(site, applied, params, opts);
    orderCard.replaceChildren(
      h('h3', {}, 'Does the order hold?', h('span', { text: stability.same ? 'same top fix under every preset' : 'top fix changes with the preset' })),
      ...stability.presets.map(preset => h('div', { class: 'order-row' },
        h('b', { text: preset.name }),
        h('span', { text: preset.top.length ? preset.top.map((f, i) => `${i + 1}. ${f.title}`).join('  ') : 'No feasible fixes' }),
        h('button', { type: 'button', class: 'chip', text: 'Use', 'aria-label': `Use the ${preset.name} weights`, onClick: () => ctx.setParams(FIX_PRESETS[preset.name]) }))));
    const uncovered = uncoveredBottlenecks(flow, site);
    uncoveredCard.hidden = !uncovered.length;
    uncoveredCard.replaceChildren(...(uncovered.length ? [h('h3', {}, 'Uncovered bottlenecks', h('span', { text: String(uncovered.length) })),
      ...uncovered.map(u => h('p', { class: 'note', text: `${u.name} peaks at ${u.peakRho > 2 ? '>200%' : fmtPct(u.peakRho)} at ${clockText(u.start)}; no fix in the list targets it.` }))] : []));
    const top = ranking.items[0];
    ctx.setPipe([
      `${Math.round(flow.entryDaily)} patients/day`,
      `${site.stations.length} stations · ${fmtNum(site.stations.reduce((a, s) => a + s.servers.reduce((x, y) => x + y, 0), 0))} server-hours`,
      `${Math.round(base.pmw).toLocaleString('en-US')} patient-min waiting`,
      `total risk ${base.totR.toFixed(0)} · ${high} high`,
      top ? `top priority ${top.priority.toFixed(2)}` : 'no fixes left',
      top ? `next: ${top.fix.title}` : 'plan complete'
    ]);
  };

  const paintBatch = compiled => {
    const params = ctx.params();
    const rows = sitesOf(compiled).map(site => {
      const applied = appliedFor(site);
      const base = evaluateClinic(site, applied, params);
      const opts = clinicOpts();
      const ranking = rankFixes(site, applied, params, base, opts);
      return { site, base, top: ranking.items[0] || null, blocked: ranking.blocked.length, kpis: governanceKpis(site, applied, params, opts), plan: autoPlan(site, applied, params, opts) };
    });
    setHtml(batchCard, html`<h3>All sites <span>${rows.length} ${rows.length === 1 ? 'site' : 'sites'}</span></h3>
      <div class="table-scroll"><table><thead><tr><th>Site</th><th>Patients/day</th><th>Patient-min waiting</th><th>Total risk</th><th>Bottleneck</th><th>Top fix</th><th>Blocked fixes</th><th>Lost to limits</th></tr></thead><tbody>
      ${rows.map(r => html`<tr class="clickable" tabindex="0" data-id="${r.site.id}" style="cursor:pointer"><td><b>${siteLabel(r.site.id)}</b></td><td class="m">${Math.round(r.base.flow.entryDaily)}</td>
        <td class="m">${Math.round(r.base.pmw).toLocaleString('en-US')}</td><td class="m">${r.base.totR.toFixed(0)}</td>
        <td>${r.base.flow.bottleneck ? r.base.flow.bottleneck.name : '—'}</td><td>${r.top ? r.top.fix.title : '—'}</td><td class="m">${r.blocked}</td><td class="m">${r.kpis.lostToLimits.toFixed(0)}</td></tr>`)}</tbody></table></div>
      <p class="note">Select a site to open it in Single.</p>`);
    batchCard.querySelectorAll('tr[data-id]').forEach(tr => {
      const open = () => { settings.siteId = tr.dataset.id; settings.clinicMode = 'single'; state.planShown = false; ctx.persist(); update(); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    const bar = h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn primary', text: 'Export plan CSV', onClick: () => download('waymark-plans.csv', plansCsv(rows.map(r => ({ siteId: r.site.id, steps: r.plan.steps })))) }));
    batchCard.append(bar);
    const total = rows.reduce((a, r) => a + r.base.flow.entryDaily, 0);
    ctx.setPipe([`${Math.round(total)} patients/day`, `${rows.length} sites`, `${Math.round(rows.reduce((a, r) => a + r.base.pmw, 0)).toLocaleString('en-US')} patient-min waiting`, `total risk ${rows.reduce((a, r) => a + r.base.totR, 0).toFixed(0)}`, '—', 'select a site']);
  };

  const update = () => keepState(root, paintAll);

  const paintAll = () => {
    const compiled = manager.compiled();
    const ready = compiled.clinic.ready;
    empty.hidden = ready;
    const mode = settings.clinicMode;
    singlePane.hidden = !ready || mode !== 'single';
    batchPane.hidden = !ready || mode !== 'batch';
    modeSwitch.setValue(mode);
    if (!ready) {
      ctx.setPipe(['—', '—', '—', '—', '—', '—']);
      return;
    }
    pill.update();
    batchPill.update();
    (mode === 'single' ? singleLeft : batchLeft).append(controlCard, resCard, weights.el, advCard);
    resChecks.forEach((c, i) => c.setChecked(settings.resources[RESOURCE_KEYS[i]] !== false));
    weights.sync();
    advanced.sync();
    seasonSlider.setValue(ctx.params().season);
    budgetField.setValue(ctx.params().budget);
    syncSite(compiled);
    if (mode === 'single') paintSingle(compiled);
    else paintBatch(compiled);
  };

  return { el: root, update, focus: () => {} };
};
