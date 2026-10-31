import { h } from './components.js';
import { TABLES, columnKeys } from '../data/schema.js';
import { parseCSV } from '../data/csv.js';

const PAGE = 200;

export const createGrid = ({ manager, table, records, onApply, onCancel }) => {
  const keys = columnKeys(table);
  const required = new Set(TABLES[table].columns.filter(c => c.required).map(c => c.key));
  let rows = records.map(r => ({ ...r }));
  let page = 0;
  let result = manager.setDraft(table, rows);
  let timer = 0;

  const summary = h('p', { class: 'summary-line', 'aria-live': 'polite' });
  const issueList = h('ul', { class: 'issue-list' });
  const body = h('tbody');
  const head = h('thead', {}, h('tr', {}, h('th', { text: '#' }), keys.map(k => h('th', { text: required.has(k) ? `${k} *` : k, scope: 'col' })), h('th', { class: 'del', 'aria-label': 'Delete row' })));
  const wrap = h('div', { class: 'gridwrap', role: 'region', 'aria-label': `${TABLES[table].label} grid`, tabindex: '-1' }, h('table', { class: 'gridtable' }, head, body));
  const pager = h('div', { class: 'toolbar' });
  const apply = h('button', { type: 'button', class: 'btn primary', text: 'Apply', onClick: () => onApply(rows.map(r => ({ ...r }))) });
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel', onClick: () => onCancel() });
  const addRow = h('button', { type: 'button', class: 'btn', text: 'Add row', onClick: () => {
    rows.push(Object.fromEntries(keys.map(k => [k, ''])));
    page = Math.floor((rows.length - 1) / PAGE);
    validate(true);
    draw();
    const inputs = body.querySelectorAll('tr:last-child .gcell');
    if (inputs[0]) inputs[0].focus();
  } });
  const el = h('div', {}, h('div', { class: 'panel-title' }, h('h3', { text: `${TABLES[table].label} · edit` }), h('div', { class: 'toolbar', style: { margin: 0 } }, addRow, cancel, apply)), summary, wrap, pager, issueList);

  const issuesByCell = () => {
    const map = new Map();
    result.issues.filter(i => i.table === table && i.row !== null).forEach(i => {
      const key = `${i.row}|${i.column}`;
      if (!map.has(key)) map.set(key, i);
    });
    return map;
  };

  const paintSummary = () => {
    const mine = result.issues.filter(i => i.table === table && i.severity === 'error');
    const others = result.errors.filter(i => i.table !== table);
    const warnings = result.issues.filter(i => i.table === table && i.severity === 'warning').length;
    const parts = [];
    if (mine.length) parts.push(`${mine.length} ${mine.length === 1 ? 'cell needs' : 'cells need'} fixing`);
    if (others.length) parts.push(`${others.length} ${others.length === 1 ? 'problem' : 'problems'} in other tables`);
    if (!parts.length) parts.push(warnings ? `No errors · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : 'No issues');
    summary.textContent = parts.join(' · ');
    summary.classList.toggle('bad', mine.length > 0 || others.length > 0);
    apply.disabled = !result.ok;
    issueList.replaceChildren(...result.errors.slice(0, 6).map(i => h('li', { text: `${TABLES[i.table].label}${i.row !== null ? ` row ${i.row + 1}` : ''}: ${i.message}` })));
  };

  const paintMarks = () => {
    const map = issuesByCell();
    body.querySelectorAll('tr').forEach(tr => {
      const r = Number(tr.dataset.r);
      tr.querySelectorAll('td[data-k]').forEach(td => {
        const issue = map.get(`${r}|${td.dataset.k}`);
        td.classList.toggle('bad', !!issue && issue.severity === 'error');
        td.classList.toggle('warn', !!issue && issue.severity === 'warning');
        if (issue) td.setAttribute('data-tip', issue.message);
        else td.removeAttribute('data-tip');
        const input = td.querySelector('input');
        if (issue && issue.severity === 'error') input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      });
    });
  };

  function validate(now) {
    clearTimeout(timer);
    const run = () => {
      result = manager.setDraft(table, rows);
      paintSummary();
      paintMarks();
    };
    if (now) run();
    else timer = setTimeout(run, 120);
  }

  const focusCell = (r, c) => {
    const target = body.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (target) {
      target.focus();
      target.select();
      return true;
    }
    return false;
  };

  const writeBlock = (startR, startC, matrix) => {
    matrix.forEach((line, i) => {
      const r = startR + i;
      while (rows.length <= r) rows.push(Object.fromEntries(keys.map(k => [k, ''])));
      line.forEach((value, j) => {
        const c = startC + j;
        if (c < keys.length) rows[r][keys[c]] = value;
      });
    });
    validate(true);
    draw();
    focusCell(startR, startC);
  };

  const onKey = (e, r, c) => {
    const maxR = rows.length - 1;
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = r + (e.shiftKey ? -1 : 1);
      if (next >= 0 && next <= maxR) {
        if (Math.floor(next / PAGE) !== page) { page = Math.floor(next / PAGE); draw(); }
        focusCell(next, c);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(r + (e.key === 'ArrowDown' ? 1 : -1), c);
    } else if (e.key === 'Tab') {
      const nextC = c + (e.shiftKey ? -1 : 1);
      if (nextC >= 0 && nextC < keys.length) {
        e.preventDefault();
        focusCell(r, nextC);
      } else if (!e.shiftKey && r < maxR) {
        e.preventDefault();
        focusCell(r + 1, 0);
      } else if (e.shiftKey && r > 0) {
        e.preventDefault();
        focusCell(r - 1, keys.length - 1);
      }
    }
  };

  function draw() {
    const start = page * PAGE;
    const slice = rows.slice(start, start + PAGE);
    body.replaceChildren(...slice.map((record, i) => {
      const r = start + i;
      const tds = keys.map((k, c) => {
        const input = h('input', { class: 'gcell', value: record[k], 'data-r': r, 'data-c': c, 'aria-label': `${k}, row ${r + 1}`, spellcheck: 'false', autocomplete: 'off' });
        input.addEventListener('input', () => { rows[r][k] = input.value; validate(false); });
        input.addEventListener('keydown', e => onKey(e, r, c));
        input.addEventListener('paste', e => {
          const text = (e.clipboardData || window.clipboardData).getData('text');
          if (!/[\t\n\r]/.test(text)) return;
          e.preventDefault();
          writeBlock(r, c, parseCSV(text, '\t').rows);
        });
        return h('td', { 'data-k': k }, input);
      });
      const del = h('button', { type: 'button', 'aria-label': `Delete row ${r + 1}`, text: '×', onClick: () => {
        rows.splice(r, 1);
        if (page > 0 && page * PAGE >= rows.length) page -= 1;
        validate(true);
        draw();
      } });
      return h('tr', { 'data-r': r }, h('td', { class: 'rn', text: String(r + 1) }), tds, h('td', { class: 'del' }, del));
    }));
    if (!rows.length) body.append(h('tr', {}, h('td', { colspan: keys.length + 2 }, h('div', { class: 'empty', text: 'No rows yet. Use Add row or paste cells.' }))));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    pager.replaceChildren();
    if (pages > 1) {
      pager.append(
        h('button', { type: 'button', class: 'btn', text: 'Previous', disabled: page === 0, onClick: () => { page -= 1; draw(); } }),
        h('span', { class: 'status-line', text: `Rows ${start + 1}–${Math.min(rows.length, start + PAGE)} of ${rows.length}` }),
        h('button', { type: 'button', class: 'btn', text: 'Next', disabled: page >= pages - 1, onClick: () => { page += 1; draw(); } }));
    }
    paintSummary();
    paintMarks();
  }

  draw();
  return { el, focusFirst: () => { if (!focusCell(0, 0)) addRow.focus(); } };
};
