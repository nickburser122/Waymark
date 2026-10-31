import { h, Select, Slider, NumberField, Disclosure, ChipGroup } from './components.js';
import { entriesFor, presetMatches } from '../core/params.js';
import { fmtNum } from '../core/stats.js';

export const money = value => `$${Math.round(value).toLocaleString('en-US')}`;

export const download = (name, text, mime = 'text/csv') => {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = h('a', { href: url, download: name, class: 'vh' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const sourcePill = (ctx, { tables, primary, unit, count, editTable }) => {
  const text = h('span', { class: 'pill-text' });
  const edit = h('button', { type: 'button', class: 'btn quiet', text: 'Edit', onClick: () => ctx.navigate('data', { table: editTable, edit: true }) });
  const replace = h('button', { type: 'button', class: 'btn quiet', text: 'Replace', onClick: () => ctx.navigate('data', { table: editTable }) });
  const el = h('div', { class: 'pill' }, text, edit, replace);
  const update = () => {
    const m = ctx.manager;
    const compiled = m.compiled();
    const source = m.sources()[primary];
    const file = m.files()[primary];
    const warnings = tables.reduce((a, t) => a + compiled.byTable[t].warnings, 0);
    const rejected = m.rejection();
    const n = count();
    const base = source === 'sample' ? `Sample · ${n} ${unit}` : `Yours · ${file ? `${file} · ` : ''}${n} ${unit}`;
    el.classList.toggle('bad', !!rejected);
    el.classList.toggle('warn', !rejected && warnings > 0);
    text.textContent = rejected ? `Upload rejected · ${rejected.message} Last valid data is active.` : warnings > 0 ? `${base} · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : base;
  };
  return { el, update };
};

export const weightPanel = (ctx, { title, keys, meta, presets, letters, kicker }) => {
  const sliders = keys.map((key, i) => {
    const letter = letters[i];
    const slider = Slider({
      label: `${meta[letter].long} weight`, min: 0, max: 100, step: 1, value: ctx.params()[key], color: `var(--${meta[letter].color})`,
      onInput: v => ctx.setParam(key, v)
    });
    const row = h('div', { class: 'wslider', style: { '--k': `var(--${meta[letter].color})` }, 'data-tip': meta[letter].long }, h('span', { class: 'wl', text: letter }), slider.el);
    return { key, slider, row };
  });
  const chips = ChipGroup({
    label: 'Policy presets', options: Object.keys(presets).map(name => ({ value: name, label: name })), selected: [],
    onChange: name => ctx.setParams(presets[name])
  });
  const el = h('div', { class: 'card' }, h('h3', {}, title, h('span', { text: kicker })), chips.el, h('div', { class: 'stack-gap' }, sliders.map(s => s.row)));
  const sync = () => {
    const p = ctx.params();
    sliders.forEach(s => s.slider.setValue(p[s.key]));
    const hit = Object.keys(presets).find(name => presetMatches(presets[name], p, keys));
    chips.setSelected(hit ? [hit] : []);
  };
  sync();
  return { el, sync };
};

export const advancedPanel = (ctx, view) => {
  const rows = entriesFor(view).filter(e => e.group === 'advanced').map(entry => {
    const code = h('code', { text: entry.symbol });
    const plain = h('small');
    let control;
    const commit = v => ctx.setParam(entry.key, v);
    if (entry.choices) {
      control = Select({ label: entry.label, options: entry.choices.map(c => ({ value: String(c.value), label: c.label })), value: String(ctx.params()[entry.key]), onChange: v => commit(Number(v)) });
    } else if (entry.key === 'budget') {
      control = NumberField({ label: entry.label, value: ctx.params()[entry.key], min: entry.min, max: entry.max, step: entry.step, unit: entry.unit, allowBlank: true, blankText: '', onChange: commit });
    } else {
      control = NumberField({ label: entry.label, value: ctx.params()[entry.key], min: entry.min, max: entry.max, step: entry.step, unit: entry.unit, onChange: commit });
    }
    const row = h('div', { class: 'adv' }, h('span', { class: 'al' }, entry.label, code), h('div', {}, control.el), plain);
    return { entry, control, code, plain, row };
  });
  const list = h('div', { class: 'adv-list' }, rows.map(r => r.row));
  const disclosure = Disclosure({ title: 'Advanced', content: list });
  const sync = () => {
    const p = ctx.params();
    const formula = ctx.explainMode() === 'formula';
    rows.forEach(r => {
      const value = p[r.entry.key];
      if (r.entry.choices) r.control.setValue(String(value));
      else r.control.setValue(value);
      r.code.hidden = !formula;
      r.plain.textContent = r.entry.plain(value);
      r.plain.hidden = formula;
    });
  };
  sync();
  return { el: disclosure.el, sync, disclosure };
};

export const tuneCard = (ctx, { view, weights }) => {
  const adv = advancedPanel(ctx, view);
  const el = h('div', { class: 'col' }, weights.el, h('div', { class: 'card' }, adv.el));
  return { el, sync: () => { weights.sync(); adv.sync(); } };
};

export const fmtDays = value => (Number.isFinite(value) ? value.toFixed(1) : '—');

export const fmtPct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;

export const plainNumber = fmtNum;
