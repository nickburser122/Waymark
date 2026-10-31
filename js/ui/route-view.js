import { h, Segmented, ChipGroup, Select, NumberField } from './components.js';
import { html, setHtml } from './escape.js';
import { createMap, looksLikeSample } from './map.js';
import { sourcePill, weightPanel, tuneCard, money, download, fmtDays, fmtPct } from './panels.js';
import { explain, SCORE_META } from './explain.js';
import { ROUTE_PRESETS, ROUTE_WEIGHT_KEYS, URGENCY_NAMES } from '../core/params.js';
import { prepareRouting, routePatient, robustness, gateReasons } from '../core/route.js';
import { routeBatch, slimBatch } from '../core/batch.js';
import { SCORE_KEYS } from '../core/score.js';
import { batchCsv } from '../data/export.js';
import { fmtNum } from '../core/stats.js';

const URGENCY_LABEL = ['Routine', 'Soon', 'Urgent'];
const GATE_NOTE = { covers: 'missing a service', load: 'too full', reach: 'too far', deadline: 'too slow', capacity: 'no free slots' };
const ROW_HEIGHT = 38;
const VIRTUAL_FROM = 200;

const barSegments = (parts, total) => SCORE_KEYS.map(k => html`<i style="width:${(total > 0 ? parts[k] : 0) * 100}%;--k:var(--${SCORE_META[k].color})"></i>`);

export const createRouteView = ctx => {
  const { manager, settings } = ctx;
  const root = h('section', { class: 'view', id: 'v-route', 'aria-label': 'Routing' });
  const modeSwitch = Segmented({
    label: 'Routing mode', options: [{ value: 'single', label: 'Single' }, { value: 'batch', label: 'Batch' }], value: settings.routeMode,
    onChange: v => { settings.routeMode = v; ctx.persist(); update(); }
  });
  root.append(h('div', { class: 'viewhead' }, h('h2', { text: 'Routing' }), modeSwitch.el));

  const empty = h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { text: 'No facilities yet.' }),
    h('button', { type: 'button', class: 'btn', text: 'Add rows', onClick: () => ctx.navigate('data', { table: 'facilities', edit: true }) }),
    h('button', { type: 'button', class: 'btn', text: 'Upload CSV', onClick: () => ctx.navigate('data', { table: 'facilities' }) })));
  root.append(empty);

  const pill = sourcePill(ctx, {
    tables: ['facilities', 'services', 'patients', 'travel'], primary: 'facilities', unit: 'sites', editTable: 'facilities',
    count: () => manager.records('facilities').length
  });
  const batchPill = sourcePill(ctx, {
    tables: ['facilities', 'services', 'patients', 'travel'], primary: 'facilities', unit: 'sites', editTable: 'facilities',
    count: () => manager.records('facilities').length
  });
  const weights = weightPanel(ctx, { title: 'Policy weights', kicker: 'stage 5', keys: ROUTE_WEIGHT_KEYS, letters: SCORE_KEYS, meta: SCORE_META, presets: ROUTE_PRESETS });
  const tune = tuneCard(ctx, { view: 'route', weights });

  const state = {
    patient: null,
    selected: '',
    modelKey: '',
    model: null,
    dataVersion: -1,
    batch: null,
    batchKey: '',
    batchRunning: false,
    progress: 0,
    worker: null,
    timer: 0,
    token: 0,
    addNote: ''
  };

  const casesBox = h('div', { class: 'chips-host' });
  const needsBox = h('div', { class: 'chips-host' });
  const locBox = h('div', { class: 'rowline' });
  const prevHost = h('div');
  const addNote = h('p', { class: 'hint-line', 'aria-live': 'polite' });
  let casesChips = null;
  let needsChips = null;
  let prevSelect = null;
  const urgency = Segmented({
    label: 'Urgency', options: URGENCY_LABEL.map((label, i) => ({ value: String(i), label })), value: '0',
    onChange: v => { state.patient.urgency = Number(v); state.patient.id = 'custom'; update(); }
  });

  const addButton = h('button', { type: 'button', class: 'btn', text: 'Add to batch', onClick: () => addToBatch() });
  const patientCard = h('div', { class: 'card' }, h('h3', {}, 'Patient', h('span', { text: 'stage 1' })),
    h('span', { class: 'field-label', text: 'Cases' }), casesBox,
    h('span', { class: 'lbl', text: 'Needs' }), needsBox,
    h('span', { class: 'lbl', text: 'Urgency' }), urgency.el,
    h('span', { class: 'lbl', text: 'Previously treated at' }), prevHost,
    h('span', { class: 'lbl', text: 'Location' }), locBox,
    h('div', { class: 'toolbar' }, addButton), addNote);

  const map = createMap({
    hint: 'Drag the patient · click a site to set continuity',
    onPatientMove: place => {
      const p = state.patient;
      if (place.lat !== undefined) { p.lat = Number(place.lat.toFixed(5)); p.lon = Number(place.lon.toFixed(5)); }
      else { p.x = Number(place.x.toFixed(1)); p.y = Number(place.y.toFixed(1)); }
      p.id = 'custom';
      p.name = 'Custom';
      update();
    },
    onFacilityToggle: id => {
      state.patient.previous = state.patient.previous === id ? '' : id;
      state.patient.id = 'custom';
      update();
    }
  });
  const decision = h('div', { class: 'card decision', 'aria-live': 'polite' });
  const rankCard = h('div', { class: 'card' });
  const whyCard = h('div', { class: 'card' });
  const explainCard = h('div', { class: 'card' });

  const singlePane = h('div', { class: 'grid g3' },
    h('div', { class: 'col' }, pill.el, patientCard, tune.el),
    h('div', { class: 'col' }, map.el, decision),
    h('div', { class: 'col' }, rankCard, explainCard, whyCard));

  const batchMap = createMap({ hint: 'Line weight = patients sent to each site' });
  const batchHead = h('div', { class: 'card' });
  const batchCompare = h('div', { class: 'card' });
  const batchLoads = h('div', { class: 'card' });
  const batchTable = h('div', { class: 'card' });
  const batchInfo = h('div', { class: 'card' });
  const batchLeft = h('div', { class: 'col' }, batchPill.el, batchInfo);
  const batchPane = h('div', {},
    h('div', { class: 'grid g3' }, batchLeft, h('div', { class: 'col' }, batchMap.el, batchHead, batchCompare), h('div', { class: 'col' }, batchLoads)),
    h('div', { class: 'stack-gap' }, batchTable));

  root.append(singlePane, batchPane);

  const getModel = compiled => {
    const key = `${manager.version()}|${JSON.stringify(ctx.params())}`;
    if (state.modelKey !== key) {
      state.model = prepareRouting(compiled.routing.data, ctx.params());
      state.modelKey = key;
    }
    return state.model;
  };

  const defaultPatient = data => {
    const first = data.patients[0];
    if (first) return { ...first };
    const f = data.facilities;
    const geo = f.length && Number.isFinite(f[0].lat);
    const avg = key => (f.length ? f.reduce((a, x) => a + x[key], 0) / f.length : 0);
    return geo
      ? { id: 'custom', name: 'New patient', lat: Number(avg('lat').toFixed(4)), lon: Number(avg('lon').toFixed(4)), needs: [data.services[0].id], urgency: 0, previous: '' }
      : { id: 'custom', name: 'New patient', x: Number(avg('x').toFixed(1)), y: Number(avg('y').toFixed(1)), needs: [data.services[0].id], urgency: 0, previous: '' };
  };

  const rebuildControls = compiled => {
    const data = compiled.routing.data;
    const serviceIds = new Set(data.services.map(s => s.id));
    const facilityIds = new Set(data.facilities.map(f => f.id));
    const mode = compiled.routing.mode;
    let p = state.patient;
    const stale = !p || p.needs.some(n => !serviceIds.has(n)) || (p.previous && !facilityIds.has(p.previous)) ||
      (mode === 'geo' ? !Number.isFinite(p.lat) : !Number.isFinite(p.x));
    if (stale) p = state.patient = defaultPatient(data);
    casesChips = ChipGroup({
      label: 'Cases', options: data.patients.slice(0, 8).map(x => ({ value: x.id, label: x.name })), selected: [p.id],
      onChange: id => {
        const found = ctx.manager.compiled().routing.data.patients.find(x => x.id === id);
        if (found) { state.patient = { ...found, needs: found.needs.slice() }; state.selected = ''; update(); }
      }
    });
    casesBox.replaceChildren(data.patients.length ? casesChips.el : h('span', { class: 'hint-line', text: 'No patients yet.' }));
    needsChips = ChipGroup({
      label: 'Needs', multi: true, minOne: true, options: data.services.map(s => ({ value: s.id, label: s.name })), selected: p.needs,
      onChange: list => { state.patient.needs = list; state.patient.id = 'custom'; update(); }
    });
    needsBox.replaceChildren(needsChips.el);
    prevSelect = Select({
      label: 'Previously treated at', options: [{ value: '', label: 'None' }].concat(data.facilities.map(f => ({ value: f.id, label: f.name }))), value: p.previous || '',
      onChange: v => { state.patient.previous = v; state.patient.id = 'custom'; update(); }
    });
    prevHost.replaceChildren(prevSelect.el);
    const field = (label, key, min, max, step) => {
      const nf = NumberField({ label, value: p[key], min, max, step, onChange: v => { state.patient[key] = v; state.patient.id = 'custom'; update(); } });
      nf.key = key;
      return h('div', {}, h('span', { class: 'field-label', text: label }), nf.el);
    };
    locBox.replaceChildren(...(mode === 'geo' ? [field('Latitude', 'lat', -90, 90, 0.01), field('Longitude', 'lon', -180, 180, 0.01)] : [field('x (km)', 'x', -1e6, 1e6, 1), field('y (km)', 'y', -1e6, 1e6, 1)]));
    state.dataVersion = manager.version();
  };

  const syncPatientControls = () => {
    const p = state.patient;
    casesChips.setSelected([p.id]);
    needsChips.setSelected(p.needs);
    urgency.setValue(String(p.urgency));
    prevSelect.setValue(p.previous || '');
    const inputs = locBox.querySelectorAll('input');
    const keys = Number.isFinite(p.lat) ? ['lat', 'lon'] : ['x', 'y'];
    inputs.forEach((input, i) => {
      if (document.activeElement !== input) input.value = String(Number(Number(p[keys[i]]).toFixed(4)));
    });
  };

  const addToBatch = () => {
    const p = state.patient;
    const records = manager.records('patients');
    let n = records.length + 1;
    const ids = new Set(records.map(r => r.id));
    while (ids.has(`P${String(n).padStart(3, '0')}`)) n += 1;
    const id = `P${String(n).padStart(3, '0')}`;
    const geo = Number.isFinite(p.lat);
    const record = {
      id, name: p.name === 'Custom' || p.name === 'New patient' ? `Patient ${n}` : p.name,
      lat: geo ? String(p.lat) : '', lon: geo ? String(p.lon) : '', x: geo ? '' : String(p.x), y: geo ? '' : String(p.y),
      needs: p.needs.join(' '), urgency: URGENCY_NAMES[p.urgency], previous_site: p.previous || ''
    };
    const outcome = manager.apply({ patients: records.concat(record) }, manager.sources().patients === 'sample' ? 'yours' : 'yours', manager.files().patients || '');
    addNote.textContent = outcome.ok ? `Added ${id} to the patients table.` : `Could not add: ${outcome.issues[0].message}`;
  };

  const mapFacilities = (model, data) => model.facilities.map(f => ({
    id: f.id, name: f.name, tier: f.tier, x: f.x, y: f.y, lat: f.lat, lon: f.lon,
    load: f.capacity > 0 ? (f.lambda * model.cfg.horizon + f.waitlist) / (f.capacity * model.cfg.horizon) : 1
  }));

  const paintSingle = (compiled, model) => {
    const p = state.patient;
    const params = ctx.params();
    const result = routePatient(model, p);
    const formula = ctx.explainMode() === 'formula';
    const geo = compiled.routing.mode === 'geo';
    const bestIds = result.stops.map(s => s.row.id);
    const dim = new Set(result.rows.filter(r => !r.G).map(r => r.id));
    map.render({
      decorative: !geo && looksLikeSample(manager.records('facilities').map(r => ({ id: r.id, x: Number(r.x), y: Number(r.y) }))),
      mode: geo ? 'geo' : 'xy', facilities: mapFacilities(model), patient: p, reachKm: model.cfg.reach[p.urgency], eta: model.cfg.eta,
      best: bestIds, stops: bestIds, dim, previous: p.previous, patientText: geo ? `${p.lat}, ${p.lon}` : `${p.x}, ${p.y} km`
    });

    let head;
    if (result.status === 'none') head = `${p.name} → No feasible plan · ${result.blocked ? result.blocked.reason : 'No site passes the gates'}`;
    else head = `${p.name} → ${result.stops.map(s => s.row.facility.name).join(' + ')} · ${fmtDays(result.summary.ttc)} days to care · ${money(result.summary.cost)} · ${result.confidence}`;
    const winner = result.status === 'single' ? result.ranked[0] : null;
    const rob = robustness(model, result);
    const robText = rob === null ? '' : rob.only ? 'Only option.' : rob.holds ? `Holds under ±${fmtNum(model.cfg.robustStep)} shifts.` : `Flips to ${rob.flip.to.name} if ${rob.flip.name} ${rob.flip.direction > 0 ? '+' : '−'}${fmtNum(rob.flip.step)}.`;
    const wexp = winner ? explain(winner, params, p.urgency) : null;
    setHtml(decision, html`
      <div class="kicker">Decision</div>
      <p class="headline">${head}</p>
      ${result.summary ? html`<div class="stats">
        <div><b>${fmtDays(result.summary.ttc)} d</b>time to care</div>
        <div><b>${money(result.summary.cost)}</b>cost</div>
        <div><b>${Math.round(result.summary.km)} km</b>road</div>
        ${winner ? html`<div><b>${winner.total.toFixed(2)}</b>score${result.margin !== null ? html` · lead ${result.margin.toFixed(2)}` : ''}</div>` : ''}
      </div>` : ''}
      ${wexp ? html`<div class="bars"><div class="stackbar" role="img" aria-label="Contribution of each term to the score">${barSegments(wexp.parts, wexp.total)}</div>
        <div class="partlist">${SCORE_KEYS.map(k => html`<span style="--k:var(--${SCORE_META[k].color})">${SCORE_META[k].name} <b>${wexp.parts[k].toFixed(2)}</b></span>`)}</div></div>` : ''}
      ${robText ? html`<p class="robust"><b>Robustness</b> · ${robText}</p>` : ''}`);

    if (result.status === 'split') {
      setHtml(rankCard, html`<h3>Split plan <span>${result.stops.length} sites</span></h3>${result.stops.map((s, i) => html`
        <div class="rank-row" style="cursor:default"><span class="n">${i + 1}</span>
        <div><b>${s.row.facility.name}</b> <span class="tag" style="--k:var(--${s.row.facility.tier === 'public' ? 'pub' : s.row.facility.tier === 'contracted' ? 'con' : 'pri'})">${s.row.facility.tier}</span>
        <small>${s.needs.map(n => model.services.has(n) ? model.services.get(n).name : n).join(', ')} · ${fmtDays(s.row.ttc)} d · ${Math.round(s.row.km)} km</small></div>
        <span class="sc">${money(s.needs.reduce((a, n) => a + (model.services.has(n) ? model.services.get(n).price : 0), 0) * s.row.facility.multiplier)}</span></div>`)}`);
      setHtml(explainCard, html`<h3>Why a split plan</h3><p class="note">No single site passes every gate for all needs, so needs are covered by the best sites in turn.</p>`);
    } else {
      if (!state.selected || !result.ranked.some(r => r.id === state.selected)) state.selected = result.ranked.length ? result.ranked[0].id : '';
      setHtml(rankCard, html`<h3>Ranking <span>${result.ranked.length} of ${result.rows.length} sites pass</span></h3>
        ${result.ranked.length ? '' : html`<div class="empty">No site passes every gate.</div>`}
        ${result.ranked.map((r, i) => html`<button type="button" class="rank-row${r.id === state.selected ? ' sel' : ''}" data-id="${r.id}" aria-pressed="${r.id === state.selected ? 'true' : 'false'}">
          <span class="n">${i + 1}</span>
          <span><b>${r.facility.name}</b> <span class="tag" style="--k:var(--${r.facility.tier === 'public' ? 'pub' : r.facility.tier === 'contracted' ? 'con' : 'pri'})">${r.facility.tier}</span>
          <small>${fmtDays(r.ttc)} d · ${Math.round(r.km)} km · ${money(r.cost)} · ${fmtPct(Math.min(1, r.load))} booked</small>
          <span class="mini">${barSegments(r.parts, r.total)}</span></span>
          <span class="sc">${r.total.toFixed(2)}</span></button>`)}`);
      const row = result.ranked.find(r => r.id === state.selected);
      if (row) {
        const ex = explain(row, params, p.urgency);
        setHtml(explainCard, html`<h3>${row.facility.name} <span>${formula ? 'formula' : 'plain'}</span></h3>
          ${formula ? html`<pre class="formula">${ex.formula}</pre><ul class="formula explain-box" style="list-style:none;padding:8px 12px">${ex.details.map(d => html`<li>${d}</li>`)}</ul>` : html`<div class="explain-box"><ul>${ex.plain.map(s => html`<li>${s}</li>`)}</ul></div>`}`);
      } else setHtml(explainCard, html`<h3>Score</h3><p class="note">Nothing to score.</p>`);
    }
    rankCard.querySelectorAll('.rank-row[data-id]').forEach(btn => btn.addEventListener('click', () => { state.selected = btn.dataset.id; paintSingle(compiled, model); }));

    const failing = result.rows.filter(r => !r.G).sort((a, b) => (a.facility.name < b.facility.name ? -1 : 1));
    setHtml(whyCard, html`<h3>Why not <span>${failing.length}</span></h3>${failing.length ? html`<ul class="why">${failing.map(r => html`<li><b>${r.facility.name}</b> — ${gateReasons(model, result.pp, r).join('; ')}</li>`)}</ul>` : html`<p class="note">Every site passes.</p>`}`);

    ctx.setPipe([
      `1 patient · ${p.needs.length} ${p.needs.length === 1 ? 'need' : 'needs'}`,
      `${model.facilities.length} sites · ${fmtNum(model.facilities.reduce((a, f) => a + f.capacity, 0))} slots/day`,
      winner ? `wait ${fmtDays(winner.wait)} d at top site` : 'no site in reach',
      `${result.ranked.length}/${result.rows.length} sites pass`,
      winner ? `score ${winner.total.toFixed(2)}` : '—',
      result.stops.length ? `→ ${result.stops.map(s => s.row.facility.name).join(' + ')}` : 'no plan'
    ]);
  };

  const paintBatchStatic = (compiled, model) => {
    const data = compiled.routing.data;
    const counts = [0, 0, 0];
    data.patients.forEach(p => { counts[p.urgency] += 1; });
    setHtml(batchInfo, html`<h3>Patients <span>stage 1</span></h3>
      <div class="kpi" style="grid-template-columns:1fr 1fr 1fr"><div><b>${data.patients.length}</b><small>total</small></div><div><b>${counts[2]}</b><small>urgent</small></div><div><b>${counts[1]}</b><small>soon</small></div></div>
      ${data.patients.length ? '' : html`<div class="empty">No patients yet.</div>`}
      <p class="note">Patients come from the patients table. Urgent cases are placed first.</p>`);
    const actions = h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn', text: 'Add rows', onClick: () => ctx.navigate('data', { table: 'patients', edit: true }) }),
      h('button', { type: 'button', class: 'btn', text: 'Upload CSV', onClick: () => ctx.navigate('data', { table: 'patients' }) }));
    batchInfo.append(actions);
    if (!batchLeft.contains(tune.el)) batchLeft.append(tune.el);
    return model;
  };

  const schedule = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(runBatch, 180);
  };

  const finishBatch = (token, batch) => {
    if (token !== state.token) return;
    state.batch = batch;
    state.batchRunning = false;
    state.progress = 1;
    paintBatchResult();
    paintProgress();
  };

  const runBatch = () => {
    const compiled = manager.compiled();
    if (!compiled.routing.ready) return;
    const key = `${manager.version()}|${JSON.stringify(ctx.params())}`;
    if (key === state.batchKey && state.batch) return;
    state.batchKey = key;
    const token = ++state.token;
    if (state.worker) state.worker.terminate();
    state.worker = null;
    state.batchRunning = true;
    state.progress = 0;
    paintProgress();
    const data = compiled.routing.data;
    const patients = data.patients;
    if (!patients.length) {
      state.batch = null;
      state.batchRunning = false;
      paintBatchResult();
      return;
    }
    const inline = () => {
      setTimeout(() => {
        const model = prepareRouting(data, ctx.params());
        finishBatch(token, slimBatch(model, routeBatch(model, patients)));
      }, 0);
    };
    try {
      const worker = new Worker(new URL('../worker/batch-worker.js', import.meta.url), { type: 'module' });
      state.worker = worker;
      worker.onmessage = e => {
        if (token !== state.token) return;
        if (e.data.type === 'progress') {
          state.progress = e.data.done / e.data.total;
          paintProgress();
        } else if (e.data.type === 'result') {
          finishBatch(token, e.data.batch);
          worker.terminate();
        } else {
          inline();
        }
      };
      worker.onerror = () => inline();
      worker.postMessage({ data, params: ctx.params(), patients });
    } catch (e) {
      inline();
    }
  };

  const progressBar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Batch progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i'));
  const paintProgress = () => {
    progressBar.firstChild.style.width = `${Math.round(state.progress * 100)}%`;
    progressBar.setAttribute('aria-valuenow', Math.round(state.progress * 100));
    progressBar.hidden = !state.batchRunning;
  };

  let virtualScroll = null;
  const paintTable = batch => {
    const rows = batch.results;
    const virtual = rows.length > VIRTUAL_FROM;
    const head = html`<thead><tr><th>Patient</th><th>Urgency</th><th>Site(s)</th><th>Time to care</th><th>Cost</th><th>Score</th><th>Notes</th></tr></thead>`;
    const rowHtml = r => {
      const notes = [r.reason].concat(Object.keys(r.excluded || {}).slice(0, 2).map(g => `${r.excluded[g]} ${GATE_NOTE[g]}`)).filter(Boolean).join(' · ');
      return html`<tr class="clickable vrow" tabindex="0" data-id="${r.id}" style="height:${ROW_HEIGHT}px"><td><b>${r.name}</b> <span class="mono" style="color:var(--mu)">${r.id}</span></td>
        <td>${URGENCY_LABEL[r.urgency]}</td><td>${r.stops.length ? r.stops.map(s => s.name).join(' → ') : '—'}</td>
        <td class="m">${r.summary ? `${fmtDays(r.summary.ttc)} d` : '—'}</td><td class="m">${r.summary ? money(r.summary.cost) : '—'}</td>
        <td class="m">${r.summary && r.status === 'single' ? r.summary.score.toFixed(2) : '—'}</td><td>${notes}</td></tr>`;
    };
    const wrap = h('div', { class: 'results-wrap', tabindex: '0', role: 'region', 'aria-label': 'Batch results' });
    const table = h('table');
    wrap.append(table);
    const draw = () => {
      if (!virtual) {
        setHtml(table, html`${head}<tbody>${rows.map(rowHtml)}</tbody>`);
        return;
      }
      const top = Math.max(0, Math.floor(wrap.scrollTop / ROW_HEIGHT) - 8);
      const count = Math.ceil(wrap.clientHeight / ROW_HEIGHT) + 16;
      const slice = rows.slice(top, top + count);
      setHtml(table, html`${head}<tbody><tr style="height:${top * ROW_HEIGHT}px"><td colspan="7" style="padding:0;border:0"></td></tr>${slice.map(rowHtml)}<tr style="height:${Math.max(0, rows.length - top - slice.length) * ROW_HEIGHT}px"><td colspan="7" style="padding:0;border:0"></td></tr></tbody>`);
    };
    let pending = 0;
    if (virtual) wrap.addEventListener('scroll', () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(); }); });
    const open = id => {
      const found = ctx.manager.compiled().routing.data.patients.find(x => x.id === id);
      if (!found) return;
      state.patient = { ...found, needs: found.needs.slice() };
      settings.routeMode = 'single';
      modeSwitch.setValue('single');
      ctx.persist();
      update();
    };
    wrap.addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) open(tr.dataset.id); });
    wrap.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(tr.dataset.id); } });
    draw();
    return wrap;
  };

  const paintBatchResult = () => {
    const compiled = manager.compiled();
    if (!compiled.routing.ready) return;
    const model = getModel(compiled);
    const batch = state.batch;
    const geo = compiled.routing.mode === 'geo';
    const data = compiled.routing.data;
    const counts = {};
    const flows = {};
    if (batch) {
      const byId = new Map(data.patients.map(p => [p.id, p]));
      batch.results.forEach(r => r.stops.forEach(s => {
        counts[s.id] = (counts[s.id] || 0) + 1;
        const p = byId.get(r.id);
        const f = flows[s.id] || (flows[s.id] = { count: 0, sum: { x: 0, y: 0, lat: 0, lon: 0 } });
        f.count += 1;
        ['x', 'y', 'lat', 'lon'].forEach(k => { f.sum[k] += Number.isFinite(p[k]) ? p[k] : 0; });
      }));
      Object.values(flows).forEach(f => { f.centroid = { x: f.sum.x / f.count, y: f.sum.y / f.count, lat: f.sum.lat / f.count, lon: f.sum.lon / f.count }; });
    }
    const loadMap = new Map((batch ? batch.loads : []).map(l => [l.id, l]));
    batchMap.render({
      decorative: !geo && looksLikeSample(manager.records('facilities').map(r => ({ id: r.id, x: Number(r.x), y: Number(r.y) }))),
      mode: geo ? 'geo' : 'xy', patients: data.patients, batch: { counts, flows },
      facilities: model.facilities.map(f => ({ id: f.id, name: f.name, tier: f.tier, x: f.x, y: f.y, lat: f.lat, lon: f.lon, load: loadMap.has(f.id) ? loadMap.get(f.id).after : 0, note: `${counts[f.id] || 0} placed` })),
      hint: 'Line weight = patients sent to each site'
    });
    batchHead.replaceChildren();
    batchCompare.replaceChildren();
    batchLoads.replaceChildren();
    batchTable.replaceChildren();
    if (!batch) {
      setHtml(batchHead, html`<h3>Results</h3><div class="empty">No patients yet.</div>`);
      ctx.setPipe(['0 patients', `${model.facilities.length} sites`, '—', '—', '—', 'no placements']);
      return;
    }
    const s = batch.summary;
    const b = batch.baseline.summary;
    const split = batch.results.filter(r => r.status === 'split').length;
    const bar = h('div', { class: 'toolbar' });
    const exportBtn = h('button', { type: 'button', class: 'btn primary', text: 'Export CSV', onClick: () => download('waymark-routing.csv', batchCsv(batch)) });
    bar.append(exportBtn);
    setHtml(batchHead, html`<h3>Placement <span>stage 6</span></h3>
      <div class="kpi"><div><b>${s.placed - split}</b><small>placed</small></div><div><b>${split}</b><small>split plans</small></div><div><b>${s.unplaced}</b><small>unplaced</small></div><div><b>${fmtDays(s.avgTtc)} d</b><small>avg time to care</small></div></div>`);
    batchHead.append(progressBar, bar);
    const cell = (a, bv, lowerBetter, fmt) => {
      const better = lowerBetter ? a < bv - 1e-9 : a > bv + 1e-9;
      const worse = lowerBetter ? a > bv + 1e-9 : a < bv - 1e-9;
      return { a: fmt(a), b: fmt(bv), cls: better ? 'a' : worse ? 'b' : '' };
    };
    const lines = [
      ['Avg travel', cell(s.avgKm, b.avgKm, true, v => `${v.toFixed(1)} km`)],
      ['Avg time to care', cell(s.avgTtc, b.avgTtc, true, v => `${v.toFixed(2)} d`)],
      ['Avg cost', cell(s.avgCost, b.avgCost, true, money)],
      ['Public share', cell(s.publicShare, b.publicShare, false, v => fmtPct(v))],
      [`Placed at sites ≥${fmtNum(model.cfg.nearFull * 100)}% full`, cell(s.nearFull, b.nearFull, true, v => String(v))],
      ['Unplaced', cell(s.unplaced, b.unplaced, true, v => String(v))]
    ];
    setHtml(batchCompare, html`<h3>Against nearest feasible <span>same order</span></h3><div class="table-scroll"><table class="compare"><thead><tr><th></th><th>Waymark</th><th>Nearest</th></tr></thead><tbody>
      ${lines.map(([label, c]) => html`<tr><td>${label}</td><td class="m ${c.cls === 'a' ? 'better' : ''}">${c.a}</td><td class="m ${c.cls === 'b' ? 'better' : ''}">${c.b}</td></tr>`)}</tbody></table></div>`);
    const rings = batch.loads.map(l => {
      const f = model.facilities.find(x => x.id === l.id);
      const u = Math.min(1, l.after);
      const c = 2 * Math.PI * 15;
      return html`<div class="ringcard"><svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="15" stroke="var(--line)"/><circle cx="19" cy="19" r="15" stroke="var(--${f.tier === 'public' ? 'pub' : f.tier === 'contracted' ? 'con' : 'pri'})" stroke-dasharray="${(c * u).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 19 19)" stroke-linecap="round"/></svg>
        <span><b>${f.name}</b>${l.assigned} placed · ${fmtPct(l.before)} → ${fmtPct(l.after)}</span></div>`;
    });
    setHtml(batchLoads, html`<h3>Site load <span>booked before → after</span></h3><div class="rings">${rings}</div>`);
    batchTable.append(h('h3', { class: 'serif', style: { 'font-size': '18px', 'margin-bottom': '10px' }, text: `Results · ${batch.results.length} patients` }), paintTable(batch));
    ctx.setPipe([
      `${data.patients.length} patients`,
      `${model.facilities.length} sites · ${fmtNum(model.facilities.reduce((a, f) => a + f.capacity, 0))} slots/day`,
      `avg ${fmtDays(s.avgTtc)} d to care`,
      `${s.unplaced} unplaced`,
      `${s.placed - split} single · ${split} split`,
      `${s.placed} placed`
    ]);
  };

  const paintBatch = (compiled, model) => {
    paintBatchStatic(compiled, model);
    if (state.batch && state.batchKey === `${manager.version()}|${JSON.stringify(ctx.params())}`) paintBatchResult();
    else {
      state.batchRunning = true;
      paintProgress();
      schedule();
    }
  };

  const update = () => {
    const compiled = manager.compiled();
    const ready = compiled.routing.ready;
    empty.hidden = ready;
    const mode = settings.routeMode;
    singlePane.hidden = !ready || mode !== 'single';
    batchPane.hidden = !ready || mode !== 'batch';
    modeSwitch.setValue(mode);
    if (!ready) {
      ctx.setPipe(['—', '—', '—', '—', '—', '—']);
      return;
    }
    const model = getModel(compiled);
    pill.update();
    batchPill.update();
    tune.sync();
    if (mode === 'single') {
      if (!singlePane.querySelector('.col:first-child').contains(tune.el)) singlePane.querySelector('.col:first-child').append(tune.el);
      if (state.dataVersion !== manager.version() || !state.patient) rebuildControls(compiled);
      syncPatientControls();
      paintSingle(compiled, model);
    } else {
      paintBatch(compiled, model);
    }
  };

  return { el: root, update, focus: () => {} };
};
