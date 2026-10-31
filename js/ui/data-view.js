import { h, DropZone, ChipGroup, Select, openDialog, askDialog } from './components.js';
import { html, setHtml } from './escape.js';
import { download } from './panels.js';
import { TABLES, TABLE_NAMES, readTable, readMultiJson, tableFromFileName, templateRows, toRecords, qualityScaleOptions, convertQuality, QUALITY_SCALE_LABELS, columnKeys } from '../data/schema.js';
import { serialiseCSV } from '../data/csv.js';
import { buildSampleTables } from '../data/samples.js';
import { parseParamsFile } from '../data/export.js';
import { createGrid } from './grid.js';

const GROUPS = [['route', 'Routing tables'], ['clinic', 'Clinic tables']];

export const createDataView = ctx => {
  const { manager } = ctx;
  const root = h('section', { class: 'view', id: 'v-data', 'aria-label': 'Data' });
  const state = { grid: null, gridTable: '', pending: null, report: null, note: '' };

  const undoBtn = h('button', { type: 'button', class: 'btn', text: 'Undo', onClick: () => manager.undo() });
  const redoBtn = h('button', { type: 'button', class: 'btn', text: 'Redo', onClick: () => manager.redo() });
  const startSample = h('button', { type: 'button', class: 'btn primary', text: 'Start from sample', onClick: () => guarded('Start from the sample data?', 'Your tables are replaced with an editable copy of the sample. You can undo this.', () => manager.startFromSample()) });
  const startBlank = h('button', { type: 'button', class: 'btn', text: 'Start blank', onClick: () => guarded('Start with empty tables?', 'Every table is emptied. You can undo this.', () => manager.startBlank()) });
  const resetSample = h('button', { type: 'button', class: 'btn quiet', text: 'Reset to sample', onClick: () => guarded('Reset to the sample?', 'All tables go back to the original sample. You can undo this.', () => manager.resetToSample(), true) });
  const importZone = DropZone({ label: 'Import files', accept: '.csv,.tsv,.json,.txt', multiple: true, compact: true, onFiles: files => importMany(files) });
  const storageLine = h('span', { class: 'status-line', 'aria-live': 'polite' });
  const toolbar = h('div', { class: 'toolbar', style: { 'margin-top': 0 } }, startSample, startBlank, importZone.el, undoBtn, redoBtn, resetSample, storageLine);
  const head = h('div', { class: 'viewhead' }, h('h2', { text: 'Data' }));
  const reportBox = h('div', { 'aria-live': 'polite' });
  const gridHost = h('div', { class: 'card', hidden: true });
  const cardsHost = h('div');
  root.append(head, toolbar, h('div', { class: 'stack-gap' }, reportBox), gridHost, cardsHost);

  const hasUserData = () => TABLE_NAMES.some(t => manager.sources()[t] === 'yours' && manager.records(t).length);

  const guarded = async (title, message, action, always) => {
    if (always || hasUserData()) {
      const ok = await askDialog({ title, message, confirmLabel: 'Continue', danger: true });
      if (!ok) return;
    }
    closeGrid();
    state.report = null;
    state.pending = null;
    action();
  };

  const closeGrid = () => {
    if (state.gridTable) manager.clearDraft(state.gridTable);
    state.grid = null;
    state.gridTable = '';
    gridHost.hidden = true;
    gridHost.replaceChildren();
  };

  const openGrid = (table, records) => {
    closeGrid();
    state.gridTable = table;
    state.grid = createGrid({
      manager, table, records: records || manager.records(table),
      onCancel: () => { closeGrid(); paint(); },
      onApply: rowsOut => {
        const outcome = manager.apply({ [table]: rowsOut }, 'yours', manager.files()[table] || '');
        if (outcome.ok) { closeGrid(); state.report = { kind: 'ok', text: `${TABLES[table].label} updated.` }; paint(); }
      }
    });
    gridHost.hidden = false;
    gridHost.replaceChildren(state.grid.el);
    paint();
    state.grid.focusFirst();
  };

  const reject = (table, message, issues, records) => {
    manager.setRejection({ table, message });
    state.report = { kind: 'bad', table, text: message, issues: issues || [], records: records || null };
    paint();
  };

  const finish = (table, records, fileName, note) => {
    const outcome = manager.apply({ [table]: records }, 'yours', fileName);
    if (outcome.ok) {
      state.pending = null;
      state.report = { kind: 'ok', text: `${TABLES[table].label}: ${records.length} rows imported${fileName ? ` from ${fileName}` : ''}.${note ? ` ${note}` : ''}` };
      paint();
      return;
    }
    const mine = outcome.issues.filter(i => i.table === table).length;
    reject(table, `${TABLES[table].label} has ${outcome.issues.length} ${outcome.issues.length === 1 ? 'error' : 'errors'}${mine === outcome.issues.length ? '.' : ` (${mine} here).`}`, outcome.issues, records);
  };

  const consume = (table, read, fileName) => {
    if (read.error) {
      reject(table, read.error);
      return;
    }
    const needsMapping = !read.match.complete;
    const records = read.records;
    const provisional = records || (table === 'facilities' ? toRecords(table, read.rows, read.match.mapping) : null);
    const scales = provisional ? qualityScaleOptions(provisional) : [];
    if (needsMapping || scales.length) {
      state.pending = { table, read, fileName, choice: {}, scale: scales[0] || null, scales };
      state.report = null;
      paint();
      return;
    }
    finish(table, records, fileName, read.note);
  };

  const importText = async (table, file) => {
    const text = await file.text();
    consume(table, readTable(table, text, file.name), file.name);
  };

  const importMany = async files => {
    const patch = {};
    let params = null;
    const names = [];
    for (const file of files) {
      const text = await file.text();
      const table = tableFromFileName(file.name);
      if (table) {
        const read = readTable(table, text, file.name);
        if (read.error || !read.match.complete) {
          if (files.length === 1) { consume(table, read, file.name); return; }
          reject(table, read.error || `${TABLES[table].label}: columns could not be matched.`);
          return;
        }
        patch[table] = read.records;
        names.push(file.name);
      } else {
        const multi = readMultiJson(text);
        if (multi) {
          Object.assign(patch, multi.tables);
          if (multi.params) params = multi.params;
          names.push(file.name);
        } else {
          const parsed = parseParamsFile(text);
          if (parsed.params) {
            params = parsed.params;
            names.push(file.name);
          } else {
            reject('facilities', `${file.name} does not match a table name.`);
            return;
          }
        }
      }
    }
    if (Object.keys(patch).length) {
      const outcome = manager.apply(patch, 'yours', names.join(', '));
      if (!outcome.ok) {
        reject(Object.keys(patch)[0], `${outcome.issues.length} ${outcome.issues.length === 1 ? 'error' : 'errors'} in the uploaded files.`, outcome.issues);
        return;
      }
    }
    if (params) ctx.setParams(params);
    state.pending = null;
    state.report = { kind: 'ok', text: `Imported ${names.join(', ')}.` };
    paint();
  };

  const pasteInto = async table => {
    const area = h('textarea', { class: 'paste-area', 'aria-label': `Cells for ${TABLES[table].label}`, placeholder: columnKeys(table).join('\t'), spellcheck: 'false' });
    const body = h('div', {}, h('p', { class: 'dlg-text', text: 'Paste cells copied from Excel or Sheets. The first row holds the column names.' }), area);
    const choice = await openDialog({ title: `Paste into ${TABLES[table].label}`, body, actions: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, kind: 'primary' }] });
    if (choice !== true || !area.value.trim()) return;
    consume(table, readTable(table, area.value, 'pasted.tsv'), 'pasted cells');
  };

  const mapperBox = () => {
    const p = state.pending;
    const box = h('div', { class: 'mapper' });
    const match = p.read.match;
    const unmatched = [{ value: '', label: 'Not in file' }].concat(p.read.headers.map((name, index) => ({ value: String(index), label: name || `column ${index + 1}` })));
    const title = [];
    const rows = [];
    const addSelect = key => {
      const sel = Select({ label: `Column for ${key}`, options: unmatched, value: p.choice[key] !== undefined ? p.choice[key] : match.mapping[key] !== undefined ? String(match.mapping[key]) : '', onChange: v => { p.choice[key] = v; } });
      rows.push(h('div', { class: 'maprow' }, h('span', { text: key }), sel.el));
    };
    if (match.missing.length) title.push(`Match ${match.missing.length === 1 ? 'one column' : 'these columns'} to continue.`);
    match.missing.forEach(addSelect);
    match.groups.forEach(g => {
      title.push('Location needs lat and lon, or x and y.');
      ['lat', 'lon', 'x', 'y'].forEach(addSelect);
    });
    box.append(h('b', { text: title.join(' ') || 'Check the quality scale.' }), ...rows);
    if (p.scales.length) {
      box.append(h('p', { class: 'note', text: 'Quality must run from 0 to 1. Pick the scale used in the file.' }));
      const chips = ChipGroup({ label: 'Quality scale', options: p.scales.map(s => ({ value: s, label: QUALITY_SCALE_LABELS[s] })), selected: [p.scale], onChange: v => { p.scale = v; } });
      box.append(chips.el);
    }
    box.append(h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn primary', text: 'Import', onClick: () => {
        const mapping = { ...match.mapping };
        Object.keys(p.choice).forEach(key => {
          if (p.choice[key] === '') delete mapping[key];
          else mapping[key] = Number(p.choice[key]);
        });
        const spec = TABLES[p.table];
        const missing = spec.columns.filter(c => c.required && mapping[c.key] === undefined).map(c => c.key);
        const groupOk = !spec.oneOf || spec.oneOf.some(pair => pair.every(k => mapping[k] !== undefined));
        if (missing.length || !groupOk) {
          reject(p.table, `Still missing ${missing.concat(groupOk ? [] : ['location']).join(', ')}.`);
          return;
        }
        let records = toRecords(p.table, p.read.rows, mapping);
        if (p.scale && qualityScaleOptions(records).includes(p.scale)) records = convertQuality(records, p.scale);
        finish(p.table, records, p.fileName, p.read.note);
      } }),
      h('button', { type: 'button', class: 'btn', text: 'Cancel', onClick: () => { state.pending = null; paint(); } })));
    return box;
  };

  const paintReport = () => {
    reportBox.replaceChildren();
    if (state.pending) {
      reportBox.append(h('div', { class: 'card' }, h('h3', { text: `Import into ${TABLES[state.pending.table].label}` }), mapperBox()));
      return;
    }
    const r = state.report;
    if (!r) return;
    const box = h('div', { class: `pill ${r.kind === 'bad' ? 'bad' : ''}` }, h('span', { class: 'pill-text', text: r.text }),
      h('button', { type: 'button', class: 'btn quiet', text: 'Dismiss', onClick: () => { state.report = null; manager.setRejection(null); paint(); } }));
    if (r.kind === 'bad' && r.records) box.append(h('button', { type: 'button', class: 'btn', text: 'Fix in grid', onClick: () => openGrid(r.table, r.records) }));
    reportBox.append(box);
    if (r.issues && r.issues.length) {
      setHtml(reportBox.appendChild(h('div')), html`<ul class="issue-list">${r.issues.slice(0, 8).map(i => html`<li>${TABLES[i.table].label}${i.row !== null ? html` row ${i.row + 1}` : ''}: ${i.message}</li>`)}</ul>${r.issues.length > 8 ? html`<p class="note">And ${r.issues.length - 8} more.</p>` : ''}`);
    }
  };

  const cardFor = name => {
    const spec = TABLES[name];
    const status = manager.status(name);
    const file = manager.files()[name];
    const label = status.kind === 'invalid' ? `Invalid (${status.issues} ${status.issues === 1 ? 'issue' : 'issues'})` : status.kind === 'sample' ? 'Sample' : 'Yours';
    const kindColor = status.kind === 'invalid' ? 'var(--persimmon)' : status.kind === 'sample' ? 'var(--sky)' : 'var(--lagoon)';
    const required = spec.columns.filter(c => c.required).map(c => c.key).join(', ');
    const rowsText = `${status.rows} ${status.rows === 1 ? 'row' : 'rows'}${file ? ` · ${file}` : ''}`;
    const upload = DropZone({ label: 'Upload', accept: '.csv,.tsv,.json,.txt', compact: true, onFiles: files => importText(name, files[0]) });
    upload.zone.dataset.table = name;
    const card = h('div', { class: `dcard${status.kind === 'invalid' ? ' invalid' : ''}`, id: `card-${name}`, role: 'group', 'aria-label': spec.label },
      h('h3', {}, spec.label, h('span', { class: 'tag', style: { '--k': kindColor }, text: label })),
      h('span', { class: 'meta', text: rowsText }),
      h('span', { class: 'meta', text: `Needs: ${required}${spec.oneOf ? ', lat+lon or x+y' : ''}` }),
      status.warnings ? h('span', { class: 'meta', text: `${status.warnings} ${status.warnings === 1 ? 'warning' : 'warnings'}` }) : null,
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn', text: 'Template', onClick: () => download(`${name}-template.csv`, serialiseCSV(templateRows(name, buildSampleTables()), { eol: '\n' })) }),
        upload.el,
        h('button', { type: 'button', class: 'btn', text: 'Paste', onClick: () => pasteInto(name) }),
        h('button', { type: 'button', class: 'btn', text: 'Edit', onClick: () => openGrid(name) })));
    return card;
  };

  const paint = () => {
    undoBtn.disabled = !manager.canUndo();
    redoBtn.disabled = !manager.canRedo();
    storageLine.textContent = manager.storageNote() || (manager.persisted() ? 'Saved in this browser.' : '');
    paintReport();
    cardsHost.replaceChildren(...GROUPS.map(([view, title]) => h('div', { class: 'stack-gap' },
      h('h3', { class: 'serif', style: { 'font-size': '19px', 'margin-bottom': '10px' }, text: title }),
      h('div', { class: 'cards' }, TABLE_NAMES.filter(t => TABLES[t].view === view).map(cardFor)))));
  };

  const update = () => {
    if (state.gridTable) {
      undoBtn.disabled = !manager.canUndo();
      redoBtn.disabled = !manager.canRedo();
      return;
    }
    paint();
  };

  const focus = opts => {
    if (!opts || !opts.table) return;
    if (opts.edit) {
      openGrid(opts.table);
      return;
    }
    const card = root.querySelector(`#card-${opts.table}`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      const zone = card.querySelector('.drop');
      if (zone) zone.focus();
    }
  };

  return { el: root, update, focus };
};
