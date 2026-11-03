import { h, Segmented, ChipGroup, Select, NumberField, Check, CopyButton } from './components.js';
import { html, setHtml } from './escape.js';
import { createMap, looksLikeSample } from './map.js';
import { sourcePill, weightPanel, tuneCard, money, download, fmtDays, fmtPct } from './panels.js';
import { explain, SCORE_META, patientNote, GLOSSARY, workedEquation } from './explain.js';
import { ROUTE_PRESETS, ROUTE_WEIGHT_KEYS, URGENCY_NAMES, presetMatches } from '../core/params.js';
import { prepareRouting, routePatient, robustness, gateReasons, runId, integrityChecks, contributionGap, flipThresholds, nearestFeasible, gateFunnel, firstFailingGate, GATE_ORDER } from '../core/route.js';
import { judgeOverride, OUTCOMES } from '../core/override.js';
import { ENGINE_VERSION } from '../core/version.js';
import { decisionRecord } from '../data/record.js';
import { loadLedger, saveLedger, addEntry, ledgerCsv, ledgerJson } from '../data/ledger.js';
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

  const emptyTable = () => (ctx.manager.records('facilities').length === 0 ? 'facilities' : 'services');
  const empty = h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'empty-text' }),
    h('button', { type: 'button', class: 'btn', text: 'Add rows', onClick: () => ctx.navigate('data', { table: emptyTable(), edit: true }) }),
    h('button', { type: 'button', class: 'btn', text: 'Upload CSV', onClick: () => ctx.navigate('data', { table: emptyTable() }) })));
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
  const lockCheck = Check({
    label: 'Strict public-first', checked: ctx.params().publicLock === 1,
    onChange: on => ctx.setParams({ publicLock: on ? 1 : 0 })
  });
  const lockCard = h('div', { class: 'card' }, lockCheck.el,
    h('p', { class: 'note', text: 'Private and contracted sites are used only when no public site passes every gate. Tip: pair it with the Public-first preset.' }));
  tune.el.insertBefore(lockCard, tune.el.children[1]);

  const state = {
    patient: null,
    selected: '',
    modelKey: '',
    model: null,
    dataVersion: -1,
    batch: null,
    batchKey: '',
    batchRunning: false,
    runningKey: '',
    failedKey: '',
    batchError: '',
    progress: 0,
    progressText: '',
    worker: null,
    timer: 0,
    token: 0,
    addNote: '',
    countCapacity: false,
    fromBatch: false,
    requested: '',
    tokenUsed: false,
    noteOn: false,
    ledger: null,
    confirmClear: false,
    audit: null
  };

  const casesBox = h('div', { class: 'chips-host' });
  const needsBox = h('div', { class: 'chips-host' });
  const locBox = h('div', { class: 'rowline' });
  const prevHost = h('div');
  const moreHost = h('div');
  const requestHost = h('div');
  const noteCheck = Check({ label: 'Explain this to the patient', checked: false, onChange: on => { state.noteOn = on; update(); } });
  const tokenCheck = Check({ label: 'Override token used this quarter', checked: false, onChange: on => { state.tokenUsed = on; update(); } });
  const batchChip = h('span', { class: 'tag', style: { '--k': 'var(--lagoon)' }, text: 'As placed in batch (other placements counted)' });
  batchChip.hidden = true;
  const capCheck = Check({
    label: 'Count this week\'s capacity', checked: false,
    onChange: on => { state.countCapacity = on; if (!on) state.fromBatch = false; update(); }
  });
  const addNote = h('p', { class: 'hint-line', 'aria-live': 'polite' });
  let casesChips = null;
  let needsChips = null;
  let prevSelect = null;
  let moreSelect = null;
  let requestSelect = null;
  const urgency = Segmented({
    label: 'Urgency', options: URGENCY_LABEL.map((label, i) => ({ value: String(i), label })), value: '0',
    onChange: v => { state.patient.urgency = Number(v); state.patient.id = 'custom'; update(); }
  });

  const addButton = h('button', { type: 'button', class: 'btn', text: 'Add to batch', onClick: () => addToBatch() });
  const patientCard = h('div', { class: 'card' }, h('h3', {}, 'Patient', h('span', { text: 'stage 1' })),
    h('span', { class: 'field-label', text: 'Cases' }), casesBox, moreHost,
    h('span', { class: 'lbl', text: 'Needs' }), needsBox,
    h('span', { class: 'lbl', text: 'Urgency' }), urgency.el,
    h('span', { class: 'lbl', text: 'Previously treated at' }), prevHost,
    h('span', { class: 'lbl', text: 'Patient asks for' }), requestHost, tokenCheck.el,
    h('span', { class: 'lbl', text: 'Location' }), locBox,
    h('div', { class: 'toolbar' }, addButton), addNote,
    h('div', { class: 'stack-gap' }, capCheck.el, batchChip));

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
  const overrideCard = h('div', { class: 'card' });
  overrideCard.hidden = true;
  const rankCard = h('div', { class: 'card' });
  const whyCard = h('div', { class: 'card' });
  const auditCard = h('div', { class: 'card' });
  const gapCard = h('div', { class: 'card' });
  const workedCard = h('div', { class: 'card' });
  workedCard.hidden = true;
  const flipCard = h('div', { class: 'card' });
  flipCard.hidden = true;
  const explainCard = h('div', { class: 'card' });

  const singlePane = h('div', { class: 'grid g3' },
    h('div', { class: 'col' }, pill.el, patientCard, tune.el),
    h('div', { class: 'col' }, map.el, decision, overrideCard),
    h('div', { class: 'col' }, rankCard, explainCard, workedCard, gapCard, flipCard, whyCard, auditCard));

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

  const choosePatient = found => {
    state.patient = { ...found, needs: found.needs.slice() };
    state.selected = '';
    state.fromBatch = false;
    settings.patientId = found.id;
    ctx.persist();
    update();
  };

  const rebuildControls = compiled => {
    const data = compiled.routing.data;
    const serviceIds = new Set(data.services.map(s => s.id));
    const facilityIds = new Set(data.facilities.map(f => f.id));
    const mode = compiled.routing.mode;
    const clone = x => ({ ...x, needs: x.needs.slice() });
    let p = state.patient;
    if (!p && settings.patientId) {
      const saved = data.patients.find(x => x.id === settings.patientId);
      if (saved) p = state.patient = clone(saved);
    } else if (p && p.id !== 'custom') {
      const fresh = data.patients.find(x => x.id === p.id);
      if (fresh) p = state.patient = clone(fresh);
    }
    const stale = !p || (p.id !== 'custom' && !data.patients.some(x => x.id === p.id)) || p.needs.some(n => !serviceIds.has(n)) || (p.previous && !facilityIds.has(p.previous)) ||
      (mode === 'geo' ? !Number.isFinite(p.lat) : !Number.isFinite(p.x));
    if (stale) p = state.patient = defaultPatient(data);
    casesChips = ChipGroup({
      label: 'Cases', options: data.patients.slice(0, 8).map(x => ({ value: x.id, label: x.name })), selected: [p.id],
      onChange: id => {
        const found = ctx.manager.compiled().routing.data.patients.find(x => x.id === id);
        if (found) { choosePatient(found); }
      }
    });
    casesBox.replaceChildren(data.patients.length ? casesChips.el : h('span', { class: 'hint-line', text: 'No patients yet.' }));
    const rest = data.patients.slice(8, 2008);
    moreSelect = Select({
      label: 'More patients', placeholder: 'More patients…', options: rest.map(x => ({ value: x.id, label: x.name, hint: x.id })), value: rest.some(x => x.id === p.id) ? p.id : '',
      onChange: id => {
        const found = ctx.manager.compiled().routing.data.patients.find(x => x.id === id);
        if (found) choosePatient(found);
      }
    });
    moreHost.replaceChildren(...(rest.length ? [moreSelect.el] : []));
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
    const tierOrder = { public: 0, contracted: 1, private: 2 };
    const ordered = data.facilities.slice().sort((a, b) => (tierOrder[a.tier] - tierOrder[b.tier]) || (data.facilities.indexOf(a) - data.facilities.indexOf(b)));
    if (state.requested && !facilityIds.has(state.requested)) state.requested = '';
    requestSelect = Select({
      label: 'Patient asks for', options: [{ value: '', label: 'None — follow Waymark' }].concat(ordered.map(f => ({ value: f.id, label: f.name, hint: f.tier }))), value: state.requested,
      onChange: v => { state.requested = v; update(); }
    });
    requestHost.replaceChildren(requestSelect.el);
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
    if (moreSelect) moreSelect.setValue(p.id);
    if (requestSelect) requestSelect.setValue(state.requested);
    tokenCheck.setChecked(state.tokenUsed);
    capCheck.setChecked(state.countCapacity);
    batchChip.hidden = !(state.countCapacity && state.fromBatch && batchIsFresh());
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
    const outcome = manager.apply({ patients: records.concat(record) }, 'yours', manager.files().patients || '');
    addNote.textContent = outcome.ok ? `Added ${id} to the patients table.` : `Could not add: ${outcome.issues[0].message}`;
  };

  const term = name => h('abbr', { class: 'term', tabindex: '0', 'data-tip': GLOSSARY[name], text: name });

  const hoverTip = (result, model, id) => {
    const row = result.rows.find(r => r.id === id);
    if (!row) return '';
    const f = row.facility;
    const needs = result.pp.needs;
    const services = Array.from(f.services).map(sid => {
      const name = model.services.has(sid) ? model.services.get(sid).name : sid;
      return needs.includes(sid) ? `[${name}]` : name;
    }).join(', ');
    const ranked = result.ranked.find(r => r.id === id);
    const verdict = row.G ? (ranked ? `score ${ranked.total.toFixed(2)}` : 'held back by the lock') : `Ruled out: ${gateReasons(model, result.pp, row).join('; ')}`;
    return [f.name, f.tier, `${Number.isFinite(row.km) ? Math.round(row.km) : '—'} km`, `services ${services}`, `${Math.round(Math.min(row.load, 9.99) * 100)}% booked`, `price ×${f.multiplier}`, `quality ${f.shrunk.toFixed(2)}`, Number.isFinite(row.wait) ? `wait ${row.wait.toFixed(1)} d` : '', verdict].filter(Boolean).join(' · ');
  };

  const mapFacilities = (model, data) => model.facilities.map(f => ({
    id: f.id, name: f.name, tier: f.tier, x: f.x, y: f.y, lat: f.lat, lon: f.lon,
    load: f.capacity > 0 ? (f.inflow + f.waitlist) / (f.capacity * model.cfg.horizon) : 1
  }));

  const paintOverride = judgement => {
    overrideCard.hidden = !judgement;
    if (!judgement) { overrideCard.replaceChildren(); return; }
    const meta = OUTCOMES[judgement.outcome];
    const tone = { ok: 'var(--moss)', warn: 'var(--saffron)', bad: 'var(--persimmon)' }[meta.tone];
    overrideCard.replaceChildren(
      h('h3', {}, 'Override', h('span', { text: judgement.row.facility.name })),
      h('p', { class: 'note' }, 'Judged against the held-back ', term('slot'), ' reserve, the ', term('reach'), ' multiplier and the ', term('token'), '.'),
      h('p', {}, h('span', { class: 'tag', style: { '--k': tone }, text: meta.label }),
        judgement.copay > 0.005 ? h('span', { class: 'note', text: ` Patient pays ${money(judgement.copay)} more.` }) : null),
      h('ul', { class: 'audit-checks' }, judgement.rules.map(r => h('li', { class: `audit-check ${r.pass ? 'ok' : r.hard || r.soft ? 'bad' : 'info'}` },
        h('span', { class: 'mark', 'aria-hidden': 'true', text: r.pass ? '✓' : r.info ? 'i' : '✕' }),
        h('span', { class: 'vh', text: r.pass ? 'Passed: ' : r.info ? 'Note: ' : 'Failed: ' }),
        h('span', { text: r.label }), h('small', { text: r.detail })))));
  };

  const paintFlips = (result, formula) => {
    const all = result.status === 'single' ? SCORE_KEYS.map(k => flipThresholds(result, result.wn, k)) : [];
    flipCard.hidden = !all.length || all.every(x => x === null);
    if (flipCard.hidden) { flipCard.replaceChildren(); return; }
    const byChanges = all.slice().sort((a, b) => b.changes - a.changes);
    const most = byChanges[0];
    const least = byChanges[byChanges.length - 1];
    const head = most.changes === 0
      ? 'No single weight change flips the winner.'
      : `Most sensitive weight: ${SCORE_META[most.key].name} (${most.changes} ${most.changes === 1 ? 'change' : 'changes'}). Least sensitive: ${SCORE_META[least.key].name} (${least.changes}).`;
    const tierVar = { public: 'var(--pub)', contracted: 'var(--con)', private: 'var(--pri)' };
    const lines = all.map(info => {
      const name = SCORE_META[info.key].name;
      const first = info.runs.slice(1).find(r => r.from > info.now) || info.runs[1];
      const text = info.changes === 0 ? `${name}: the winner never changes.` : `${name}: flips to ${first.facility.name} at ${first.from.toFixed(1)} pts (now ${fmtNum(Math.round(info.now * 10) / 10)}).`;
      const strip = h('div', { class: 'flip-strip', role: 'img', 'aria-label': text },
        info.runs.map(r => {
          const width = r.to - r.from;
          return h('span', { class: 'flip-run', tabindex: '0', 'data-tip': `${r.facility.name}, ${r.from.toFixed(1)} to ${r.to.toFixed(1)} pts`, style: { left: `${r.from}%`, width: `${width}%`, background: tierVar[r.facility.tier] || 'var(--paper2)' }, text: width >= 14 ? r.facility.name : '' });
        }),
        h('span', { class: 'flip-now', style: { left: `${info.now}%` } }));
      return h('div', { class: 'flip-row' }, h('span', { class: 'flip-name', text: name }), strip, h('small', { text }));
    });
    flipCard.replaceChildren(h('h3', {}, 'Rank-flip thresholds', h('span', { text: formula ? 'exact lines' : 'plain' })), h('p', { class: 'note', text: head }), ...lines);
  };

  const paintGap = (gap, formula) => {
    gapCard.hidden = !gap;
    if (!gap) { gapCard.replaceChildren(); return; }
    const scale = Math.max(1e-9, ...gap.terms.map(t => Math.abs(t.delta)));
    const sorted = gap.terms.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const A = gap.winner.facility.name;
    const B = gap.runnerUp.facility.name;
    const rows = sorted.map(t => {
      const meta = SCORE_META[t.key];
      const width = `${(Math.abs(t.delta) / scale) * 50}%`;
      const bar = h('i', { class: t.delta >= 0 ? 'gap-pos' : 'gap-neg', style: { width, '--k': t.delta >= 0 ? `var(--${meta.color})` : 'var(--persimmon-ink)' } });
      return h('div', { class: 'gap-row' },
        h('span', { class: 'gap-name', text: meta.name }),
        h('span', { class: 'gap-track', role: 'img', tabindex: '0', 'data-tip': `${meta.name}: ${t.delta >= 0 ? A : B} ahead by ${Math.abs(t.delta).toFixed(3)}`, 'aria-label': `${meta.name}: ${t.delta >= 0 ? 'favours' : 'favours'} ${t.delta >= 0 ? A : B} by ${Math.abs(t.delta).toFixed(3)}` }, bar),
        h('span', { class: 'gap-val', text: `${t.delta >= 0 ? '+' : '−'}${Math.abs(t.delta).toFixed(3)}` }));
    });
    gapCard.replaceChildren(
      h('h3', {}, 'Why this one and not that one', h('span', { text: formula ? 'formula' : 'plain' })),
      h('p', { class: 'note' }, `${A} leads ${B} by ${gap.margin.toFixed(2)}; the bars add up to that gap. Biggest gap: ${SCORE_META[gap.decisive.key].name}. Each bar is in `, term('weight points'), ' terms.'),
      h('div', { class: 'gap-axis' }, h('span', { text: `← favours ${B}` }), h('span', { text: `favours ${A} →` })),
      ...rows,
      formula ? h('pre', { class: 'formula', text: 'Δ_k = ŵ_k·(s_k,A − s_k,B)\n' + sorted.map(t => `Δ_${t.key} = ${t.delta.toFixed(4)}`).join('\n') + `\nΣ Δ_k = ${gap.margin.toFixed(4)}` }) : null);
  };

  const ledgerItems = () => {
    if (!state.ledger) state.ledger = loadLedger(window.localStorage);
    return state.ledger;
  };

  const logDecision = () => {
    const a = state.audit;
    if (!a || !a.result.summary) { ctx.toast('Nothing to log'); return; }
    const entry = {
      id: a.id,
      t: new Date().toISOString(),
      engine: ENGINE_VERSION,
      patientId: a.patient.id,
      needs: a.result.pp.needs.slice(),
      urgency: URGENCY_NAMES[a.result.pp.urgency],
      preset: a.presetName,
      plan: a.result.stops.map(s => s.row.id),
      score: Number(a.result.summary.score.toFixed(4)),
      km: Math.round(a.result.summary.km),
      ttc: Number(a.result.summary.ttc.toFixed(2)),
      cost: Math.round(a.result.summary.cost),
      confidence: a.result.confidence
    };
    if (settings.ledgerNames) entry.patientName = a.patient.name;
    const outcome = addEntry(ledgerItems(), entry);
    state.ledger = outcome.items;
    if (outcome.added) saveLedger(window.localStorage, state.ledger);
    ctx.toast(outcome.added ? 'Logged' : 'Already in the ledger');
    paintAudit();
  };

  const paintAudit = () => {
    const a = state.audit;
    if (!a) { auditCard.replaceChildren(); return; }
    const checks = integrityChecks(a.model, a.result, a.options);
    const items = ledgerItems();
    const namesCheck = Check({ label: 'Store patient names in the ledger', checked: !!settings.ledgerNames, onChange: on => { settings.ledgerNames = on; ctx.persist(); } });
    const exportRow = h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn', text: 'Export CSV', disabled: !items.length, onClick: () => download('waymark-ledger.csv', ledgerCsv(items), 'text/csv') }),
      h('button', { type: 'button', class: 'btn', text: 'Export JSON', disabled: !items.length, onClick: () => download('waymark-ledger.json', ledgerJson(items), 'application/json') }),
      state.confirmClear
        ? h('span', { class: 'confirm-row' }, h('span', { text: `Clear all ${items.length} entries?` }),
          h('button', { type: 'button', class: 'btn danger', text: 'Clear', onClick: () => { state.ledger = []; saveLedger(window.localStorage, []); state.confirmClear = false; paintAudit(); } }),
          h('button', { type: 'button', class: 'btn quiet', text: 'Keep', onClick: () => { state.confirmClear = false; paintAudit(); } }))
        : h('button', { type: 'button', class: 'btn quiet', text: 'Clear', disabled: !items.length, onClick: () => { state.confirmClear = true; paintAudit(); } }));
    const table = items.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Time', 'Patient', 'Plan', 'Score'].map(c => h('th', { scope: 'col', text: c })))),
        h('tbody', {}, items.slice(0, 20).map(e => h('tr', {},
          h('td', { text: e.t.slice(0, 16).replace('T', ' ') }),
          h('td', { text: e.patientName || e.patientId }),
          h('td', { text: (e.plan || []).join(' + ') }),
          h('td', { text: Number(e.score).toFixed(2) }))))))
      : h('p', { class: 'note', text: 'No logged decisions yet.' });
    auditCard.replaceChildren(
      h('h3', {}, 'Audit', h('span', { text: 'stage 6' })),
      h('div', { class: 'runid' }, h('span', { class: 'lbl', text: 'Run ID' }), h('code', { text: a.id }), CopyButton({ label: 'Copy', getText: () => a.id }).el, h('small', { text: `engine ${ENGINE_VERSION}` })),
      h('ul', { class: 'audit-checks' }, checks.map(c => h('li', { class: `audit-check ${c.ok ? 'ok' : 'bad'}` },
        h('span', { class: 'mark', 'aria-hidden': 'true', text: c.ok ? '✓' : '✕' }),
        h('span', { class: 'vh', text: c.ok ? 'Passed: ' : 'Failed: ' }),
        h('span', { text: c.label }), h('small', { text: c.detail })))),
      h('p', { class: 'note', text: `Evaluated in ${a.evalMs.toFixed(1)} ms` }),
      namesCheck.el, exportRow, table);
  };

  const batchIsFresh = () => !!state.batch && state.batchKey === currentBatchKey();

  const singleOptions = p => {
    if (!state.countCapacity) return {};
    const assigned = {};
    if (batchIsFresh()) {
      state.batch.loads.forEach(load => { assigned[load.id] = load.assigned; });
      const own = state.batch.results.find(r => r.id === p.id);
      if (own) own.stops.forEach(stop => { assigned[stop.id] = Math.max(0, (assigned[stop.id] || 0) - 1); });
    }
    return { capacityGate: true, assigned };
  };

  const paintSingle = (compiled, model) => {
    const p = state.patient;
    const params = ctx.params();
    const options = singleOptions(p);
    const started = performance.now();
    const result = routePatient(model, p, options);
    const evalMs = performance.now() - started;
    const formula = ctx.explainMode() === 'formula';
    const geo = compiled.routing.mode === 'geo';
    const bestIds = result.stops.map(s => s.row.id);
    const dim = new Set(result.rows.filter(r => !r.G).map(r => r.id));
    map.render({
      decorative: !geo && looksLikeSample(manager.records('facilities').map(r => ({ id: r.id, x: Number(r.x), y: Number(r.y) }))),
      mode: geo ? 'geo' : 'xy', facilities: mapFacilities(model).map(f => ({ ...f, tip: hoverTip(result, model, f.id) })), patient: p, reachKm: model.cfg.reach[p.urgency], eta: model.cfg.eta,
      best: bestIds, stops: bestIds, requested: state.requested, dim, previous: p.previous, patientText: geo ? `${p.lat}, ${p.lon}` : `${p.x}, ${p.y} km`
    });

    let head;
    if (result.status === 'none') head = `${p.name} → No feasible plan · ${result.blocked ? result.blocked.reason : 'No site passes the gates'}`;
    else head = `${p.name} → ${result.stops.map(s => s.row.facility.name).join(' + ')} · ${fmtDays(result.summary.ttc)} days to care · ${money(result.summary.cost)} · ${result.confidence}`;
    const winner = result.status === 'single' ? result.ranked[0] : null;
    const rob = robustness(model, result);
    const robText = rob === null ? '' : rob.only ? 'Only option.' : rob.holds ? `Holds under ±${fmtNum(model.cfg.robustStep)} shifts.` : `Flips to ${rob.flip.to.name} if ${rob.flip.name} ${rob.flip.direction > 0 ? '+' : '−'}${fmtNum(rob.flip.step)}.`;
    const wexp = winner ? explain(winner, params, p.urgency) : null;
    const gap = contributionGap(result);
    const decisiveText = gap ? `Decisive term: ${SCORE_META[gap.decisive.key].name} (+${gap.decisive.delta.toFixed(2)} over ${gap.runnerUp.facility.name}).` : '';
    const nearest = nearestFeasible(result);
    let nearestText = '';
    if (winner && nearest) {
      if (nearest.fi === winner.fi) nearestText = 'Nearest feasible is also best.';
      else {
        const dCost = result.summary.cost - nearest.cost;
        const dKm = winner.km - nearest.km;
        const dTtc = winner.ttc - nearest.ttc;
        nearestText = `Nearest feasible: ${nearest.facility.name} at ${Math.round(nearest.km)} km for ${money(nearest.cost)}. Waymark's pick ${dCost <= 0 ? `saves ${money(-dCost)}` : `costs ${money(dCost)} more`}; the trip is ${Math.round(Math.abs(dKm))} km ${dKm > 0 ? 'longer' : 'shorter'}; time to care ${dTtc >= 0 ? '+' : '−'}${Math.abs(dTtc).toFixed(1)} d.`;
      }
    }
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
      ${robText ? html`<p class="robust"><b>Robustness</b> · ${robText}</p>` : ''}
      ${decisiveText ? html`<p class="robust"><b>Decisive</b> · ${decisiveText}</p>` : ''}
      ${nearestText ? html`<p class="robust"><b>Nearest</b> · ${nearestText}</p>` : ''}`);
    const presetName = Object.keys(ROUTE_PRESETS).find(name => presetMatches(ROUTE_PRESETS[name], params, ROUTE_WEIGHT_KEYS)) || 'Custom';
    const fingerprint = manager.fingerprint();
    const judgement = state.requested ? judgeOverride(model, result, state.requested, { tokenUsed: state.tokenUsed }) : null;
    const id = runId(result.pp, params, fingerprint, { capacity: state.countCapacity ? options.assigned : null, request: state.requested, tokenUsed: state.requested ? state.tokenUsed : false });
    paintOverride(judgement);
    const overrideInfo = judgement ? { verdict: `${OUTCOMES[judgement.outcome].label}: ${judgement.row.facility.name}`, rules: judgement.rules.map(r => ({ ok: r.pass, label: r.label, detail: r.detail })) } : null;
    state.audit = { id, result, model, patient: p, params, fingerprint, presetName, rob, evalMs, options };
    const makeRecord = () => decisionRecord({ model, result, patient: p, params, runId: id, fingerprint, generatedAt: new Date().toISOString(), robustness: rob, presetName, override: overrideInfo, publicLock: model.cfg.publicLock ? 'on' : '', decisive: gap ? `${SCORE_META[gap.decisive.key].name} (+${gap.decisive.delta.toFixed(3)} over ${gap.runnerUp.facility.name})` : '' });
    decision.append(h('div', { class: 'toolbar' },
      CopyButton({ label: 'Copy decision record', getText: makeRecord }).el,
      h('button', { type: 'button', class: 'btn', text: 'Log decision', onClick: () => logDecision() }),
      noteCheck.el));
    if (state.noteOn) {
      const note = patientNote(result, model, p);
      decision.append(h('div', { class: 'explain-box' }, h('p', { text: note }), CopyButton({ label: 'Copy patient note', getText: () => note }).el));
    }

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
          <span><b>${r.facility.name}</b> <span class="tag" style="--k:var(--${r.facility.tier === 'public' ? 'pub' : r.facility.tier === 'contracted' ? 'con' : 'pri'})">${r.facility.tier}</span>${r.load >= model.cfg.nearFull ? html` <span class="tag warn" style="--k:var(--saffron)">Near full</span>` : ''}
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

    paintAudit();
    paintGap(gap, formula);
    workedCard.hidden = !formula;
    if (formula) {
      const worked = workedEquation(result, params, row => gateReasons(model, result.pp, row));
      workedCard.replaceChildren(h('h3', {}, 'Worked equation', h('span', { text: 'S = G × [ŵ·s …]' })), h('pre', { class: 'formula', text: worked.lines.join('\n') || 'No sites to show.' }));
    } else workedCard.replaceChildren();
    paintFlips(result, formula);
    const gateRank = row => { const g = firstFailingGate(row); return g === 'lock' ? GATE_ORDER.length : GATE_ORDER.indexOf(g); };
    const failing = result.rows.filter(r => !r.G || r.lockedOut).sort((a, b) => (gateRank(a) - gateRank(b)) || (a.km - b.km) || (a.fi - b.fi));
    const funnel = gateFunnel(result);
    const CHIP = { covers: 'missing', deadline: 'too slow', reach: 'too far', load: 'too full', capacity: 'no slots', lock: 'held back' };
    const funnelEl = h('p', { class: 'funnel' }, funnel.map((step, i) => h('span', { class: 'funnel-step' }, i ? '→ ' : '', h('b', { text: String(step.count) }), ` ${step.label}`)));
    const whyList = failing.length
      ? h('ul', { class: 'why' }, failing.map(r => h('li', { 'data-tip': gateReasons(model, result.pp, r).join('; ') },
        h('b', { text: r.facility.name }), ' ',
        h('span', { class: `rchip k-${firstFailingGate(r)}`, text: CHIP[firstFailingGate(r)] || 'blocked' }),
        h('small', { text: ` ${Number.isFinite(r.km) ? Math.round(r.km) : '—'} km — ${gateReasons(model, result.pp, r).join('; ')}` }))))
      : h('p', { class: 'note', text: 'Every site passes.' });
    whyCard.replaceChildren(h('h3', {}, 'Why not', h('span', { text: String(failing.length) })), h('p', { class: 'note' }, 'A ', term('gate'), ' is a pass or fail rule; the funnel shows how many sites survive each one.'), funnelEl, whyList);

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

  const currentBatchKey = () => `${manager.version()}|${JSON.stringify(ctx.params())}`;

  const stopWorker = () => {
    if (state.worker) state.worker.terminate();
    state.worker = null;
  };

  const finishBatch = (token, batch) => {
    if (token !== state.token) return;
    stopWorker();
    state.batch = batch;
    state.batchRunning = false;
    state.runningKey = '';
    state.batchError = '';
    state.failedKey = '';
    state.progress = 1;
    paintBatchResult();
    paintProgress();
  };

  const failBatch = (token, message) => {
    if (token !== state.token) return;
    stopWorker();
    state.batch = null;
    state.batchRunning = false;
    state.runningKey = '';
    state.batchError = message || 'The batch could not be completed.';
    state.failedKey = state.batchKey;
    paintProgress();
    paintBatchResult();
  };

  const retryBatch = () => {
    state.batchError = '';
    state.failedKey = '';
    state.batchKey = '';
    state.batchRunning = true;
    paintProgress();
    schedule();
  };

  const runBatch = () => {
    const compiled = manager.compiled();
    if (!compiled.routing.ready) return;
    const key = currentBatchKey();
    if (key === state.batchKey && state.batch) return;
    if (state.batchRunning && key === state.runningKey) return;
    if (state.batchError && key === state.failedKey) return;
    state.batchKey = key;
    state.runningKey = key;
    const token = ++state.token;
    stopWorker();
    state.batchRunning = true;
    state.batchError = '';
    state.failedKey = '';
    state.progress = 0;
    state.progressText = '';
    paintProgress();
    const data = compiled.routing.data;
    const patients = data.patients;
    if (!patients.length) {
      state.batch = null;
      state.batchRunning = false;
      state.runningKey = '';
      paintProgress();
      paintBatchResult();
      return;
    }
    const inline = () => {
      setTimeout(() => {
        if (token !== state.token) return;
        try {
          const model = prepareRouting(data, ctx.params());
          finishBatch(token, slimBatch(model, routeBatch(model, patients)));
        } catch (error) {
          failBatch(token, String(error && error.message ? error.message : error));
        }
      }, 0);
    };
    let heard = false;
    try {
      const worker = new Worker(new URL('../worker/batch-worker.js', import.meta.url), { type: 'module' });
      state.worker = worker;
      worker.onmessage = e => {
        if (token !== state.token) return;
        heard = true;
        if (e.data.type === 'progress') {
          state.progress = e.data.done / e.data.total;
          state.progressText = `Placed ${e.data.done.toLocaleString('en-US')} of ${e.data.total.toLocaleString('en-US')}`;
          paintProgress();
        } else if (e.data.type === 'result') {
          finishBatch(token, e.data.batch);
        } else {
          failBatch(token, e.data.message);
        }
      };
      worker.onerror = () => {
        if (token !== state.token) return;
        stopWorker();
        if (heard) failBatch(token, 'The batch worker stopped unexpectedly.');
        else inline();
      };
      worker.postMessage({ data, params: ctx.params(), patients });
    } catch (e) {
      stopWorker();
      inline();
    }
  };

  const updatingChip = h('span', { class: 'tag', style: { '--k': 'var(--saffron)' }, text: 'Updating…', role: 'status' });
  updatingChip.hidden = true;
  const progressBar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Batch progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i'));
  const paintProgress = () => {
    progressBar.firstChild.style.width = `${Math.round(state.progress * 100)}%`;
    progressBar.setAttribute('aria-valuenow', Math.round(state.progress * 100));
    progressBar.setAttribute('aria-valuetext', state.progressText || `${Math.round(state.progress * 100)}%`);
    progressBar.hidden = !state.batchRunning;
    const updating = state.batchRunning && !!state.batch;
    updatingChip.hidden = !updating;
    [batchCompare, batchLoads, batchTable].forEach(el => el.classList.toggle('is-stale', updating));
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
      state.countCapacity = true;
      state.fromBatch = true;
      settings.patientId = found.id;
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
    if (state.batchError && state.failedKey === currentBatchKey()) {
      setHtml(batchHead, html`<h3>Batch failed</h3><p class="note">${state.batchError}</p>`);
      batchHead.append(h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn primary', text: 'Retry', onClick: retryBatch })));
      ctx.setPipe(['—', `${model.facilities.length} sites`, '—', '—', '—', 'batch failed']);
      return;
    }
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
    batchHead.append(updatingChip, progressBar, bar);
    const cell = (a, bv, lowerBetter, fmt) => {
      const better = lowerBetter ? a < bv - 1e-9 : a > bv + 1e-9;
      const worse = lowerBetter ? a > bv + 1e-9 : a < bv - 1e-9;
      return { a: fmt(a), b: fmt(bv), cls: better ? 'a' : worse ? 'b' : '' };
    };
    const lines = [
      ['Avg travel', cell(s.avgKm, b.avgKm, true, v => `${v.toFixed(1)} km`)],
      ['Avg time to care', cell(s.avgTtc, b.avgTtc, true, v => `${v.toFixed(2)} d`)],
      ['Avg cost', cell(s.avgCost, b.avgCost, true, money)],
      ['Total cost', cell(s.totalCost, b.totalCost, true, money)],
      ['Public share', cell(s.publicShare, b.publicShare, false, v => fmtPct(v))],
      ['Public room used', cell(s.publicSlotsUsed, b.publicSlotsUsed, false, v => fmtPct(v))],
      ['Load spread (sd)', cell(s.loadSpread, b.loadSpread, true, v => v.toFixed(3))],
      [`Placed at sites ≥${fmtNum(model.cfg.nearFull * 100)}% full`, cell(s.nearFull, b.nearFull, true, v => String(v))],
      ['Unplaced', cell(s.unplaced, b.unplaced, true, v => String(v))],
      ['Split plans', { a: String(s.split), b: String(b.split), cls: '' }]
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
      `${s.placed - split} single · ${split} split${model.cfg.publicLock ? ' · lock on' : ''}`,
      `${s.placed} placed`
    ]);
  };

  const paintBatch = (compiled, model) => {
    paintBatchStatic(compiled, model);
    const key = currentBatchKey();
    if (state.batch && state.batchKey === key) paintBatchResult();
    else if (state.batchError && state.failedKey === key) {
      state.batchRunning = false;
      paintProgress();
      paintBatchResult();
    } else {
      state.batchRunning = true;
      paintProgress();
      schedule();
    }
  };

  const update = () => {
    const compiled = manager.compiled();
    const ready = compiled.routing.ready;
    empty.hidden = ready;
    if (!ready) empty.querySelector('.empty-text').textContent = ctx.manager.records('facilities').length === 0 ? 'No facilities yet.' : 'No services yet. Routing needs both facilities and services.';
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
    lockCheck.setChecked(ctx.params().publicLock === 1);
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
