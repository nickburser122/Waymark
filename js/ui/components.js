let counter = 0;
export const uid = prefix => `${prefix}-${++counter}`;

const SVG_NS = 'http://www.w3.org/2000/svg';

const applyAttrs = (el, attrs) => {
  Object.keys(attrs || {}).forEach(key => {
    const v = attrs[key];
    if (v === null || v === undefined || v === false) return;
    if (key === 'class') el.setAttribute('class', v);
    else if (key === 'text') el.textContent = v;
    else if (key === 'style' && typeof v === 'object') Object.keys(v).forEach(p => el.style.setProperty(p, v[p]));
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
    else el.setAttribute(key, v === true ? '' : String(v));
  });
};

const appendKids = (el, kids) => {
  kids.flat(Infinity).forEach(kid => {
    if (kid === null || kid === undefined || kid === false) return;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  });
};

export const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendKids(el, kids);
  return el;
};

export const svgEl = (tag, attrs, ...kids) => {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendKids(el, kids);
  return el;
};

const decimals = step => {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

const snap = (value, min, max, step) => {
  const n = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(n.toFixed(decimals(step) + 2))));
};

export const Select = ({ options, value, onChange, label, placeholder = 'Select', className = '' }) => {
  let opts = options.slice();
  let current = value;
  let isOpen = false;
  let active = -1;
  let typed = '';
  let typedTimer = null;
  const id = uid('sel');
  const text = h('span', { class: 'sel-text' });
  const button = h('button', {
    type: 'button', class: 'sel-btn', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    'aria-controls': `${id}-list`, 'aria-label': label
  }, text, h('span', { class: 'sel-caret', 'aria-hidden': 'true' }));
  const list = h('ul', { id: `${id}-list`, class: 'sel-list', role: 'listbox', 'aria-label': label, tabindex: '-1' });
  const root = h('div', { class: `sel ${className}` }, button);

  const indexOfValue = v => opts.findIndex(o => o.value === v);
  const paintText = () => {
    const at = indexOfValue(current);
    text.textContent = at >= 0 ? opts[at].label : placeholder;
    text.classList.toggle('ph', at < 0);
  };
  const paintList = () => {
    list.replaceChildren(...opts.map((o, i) => h('li', {
      id: `${id}-o${i}`, role: 'option', class: `sel-opt${i === active ? ' act' : ''}${o.value === current ? ' on' : ''}`,
      'aria-selected': o.value === current ? 'true' : 'false', 'data-i': i
    }, h('span', { text: o.label }), o.hint ? h('small', { text: o.hint }) : null)));
    if (active >= 0) button.setAttribute('aria-activedescendant', `${id}-o${active}`);
    else button.removeAttribute('aria-activedescendant');
  };
  const place = () => {
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    list.style.minWidth = `${r.width}px`;
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8))}px`;
    const height = Math.min(list.scrollHeight, 280);
    if (below < height + 12 && r.top > below) {
      list.style.top = 'auto';
      list.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      list.style.bottom = 'auto';
      list.style.top = `${r.bottom + 6}px`;
    }
  };
  const scrollActive = () => {
    const el = list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  };
  const onOutside = e => { if (!root.contains(e.target) && !list.contains(e.target)) close(false); };
  const onScroll = e => { if (!list.contains(e.target)) close(false); };
  const open = () => {
    if (isOpen || !opts.length) return;
    isOpen = true;
    active = Math.max(0, indexOfValue(current));
    paintList();
    document.body.append(list);
    list.classList.add('open');
    place();
    button.setAttribute('aria-expanded', 'true');
    scrollActive();
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
  };
  const onResize = () => close(false);
  function close(refocus) {
    if (!isOpen) return;
    isOpen = false;
    list.remove();
    list.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    if (refocus) button.focus();
  }
  const choose = i => {
    if (i < 0 || i >= opts.length) return;
    const changed = opts[i].value !== current;
    current = opts[i].value;
    paintText();
    close(true);
    if (changed && onChange) onChange(current);
  };
  const move = to => {
    active = Math.min(opts.length - 1, Math.max(0, to));
    paintList();
    scrollActive();
  };
  const typeAhead = key => {
    typed += key.toLowerCase();
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => { typed = ''; }, 600);
    const from = typed.length === 1 ? active + 1 : active;
    const order = opts.map((o, i) => i).slice(Math.max(0, from)).concat(opts.map((o, i) => i).slice(0, Math.max(0, from)));
    const hit = order.find(i => opts[i].label.toLowerCase().startsWith(typed));
    if (hit !== undefined) {
      if (!isOpen) open();
      move(hit);
    }
  };

  button.addEventListener('click', () => (isOpen ? close(true) : open()));
  button.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) open();
      else move(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' && isOpen) {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End' && isOpen) {
      e.preventDefault();
      move(opts.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) choose(active);
      else open();
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab' && isOpen) {
      close(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      typeAhead(e.key);
    }
  });
  list.addEventListener('pointerdown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) choose(Number(li.dataset.i));
  });
  list.addEventListener('pointermove', e => {
    const li = e.target.closest('li[data-i]');
    if (li && Number(li.dataset.i) !== active) {
      active = Number(li.dataset.i);
      list.querySelectorAll('.act').forEach(n => n.classList.remove('act'));
      li.classList.add('act');
      button.setAttribute('aria-activedescendant', li.id);
    }
  });
  paintText();
  return {
    el: root,
    button,
    setValue: v => { current = v; paintText(); },
    setOptions: next => { opts = next.slice(); paintText(); if (isOpen) paintList(); },
    getValue: () => current,
    focus: () => button.focus()
  };
};

export const Slider = ({ min = 0, max = 100, step = 1, value = 0, onInput, onChange, label, format, color, showValue = true }) => {
  let current = snap(value, min, max, step);
  const fmt = format || (v => String(v));
  const fill = h('div', { class: 'sl-fill' });
  const thumb = h('div', {
    class: 'sl-thumb', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max
  });
  const track = h('div', { class: 'sl-track' }, fill, thumb);
  const out = showValue ? h('output', { class: 'sl-out' }) : null;
  const root = h('div', { class: 'sl', style: color ? { '--k': color } : null }, track, out);
  const paint = () => {
    const pct = max === min ? 0 : (current - min) / (max - min) * 100;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    thumb.setAttribute('aria-valuenow', current);
    thumb.setAttribute('aria-valuetext', fmt(current));
    if (out) out.textContent = fmt(current);
  };
  const setFromEvent = e => {
    const r = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    commit(snap(min + ratio * (max - min), min, max, step), false);
  };
  const commit = (next, final) => {
    const changed = next !== current;
    current = next;
    paint();
    if (changed && onInput) onInput(current);
    if (final && onChange) onChange(current);
  };
  let dragging = false;
  root.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    root.setPointerCapture(e.pointerId);
    thumb.focus();
    setFromEvent(e);
    e.preventDefault();
  });
  root.addEventListener('pointermove', e => { if (dragging) setFromEvent(e); });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    if (onChange) onChange(current);
  };
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);
  thumb.addEventListener('keydown', e => {
    const keys = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
    if (keys[e.key] !== undefined) {
      e.preventDefault();
      commit(snap(current + keys[e.key], min, max, step), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      commit(min, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      commit(max, true);
    }
  });
  paint();
  return { el: root, thumb, setValue: v => { current = snap(v, min, max, step); paint(); }, getValue: () => current };
};

export const Check = ({ label, checked = false, onChange, kind = 'check', describedBy }) => {
  let state = checked;
  const role = kind === 'switch' ? 'switch' : 'checkbox';
  const box = h('span', { class: kind === 'switch' ? 'sw-track' : 'ck-box', 'aria-hidden': 'true' }, h('i'));
  const button = h('button', { type: 'button', class: `chk ${kind}`, role, 'aria-checked': String(state), 'aria-describedby': describedBy }, box, label ? h('span', { class: 'chk-label', text: label }) : null);
  button.addEventListener('click', () => {
    state = !state;
    button.setAttribute('aria-checked', String(state));
    if (onChange) onChange(state);
  });
  return { el: button, setChecked: v => { state = !!v; button.setAttribute('aria-checked', String(state)); }, getChecked: () => state };
};

export const Disclosure = ({ title, content, open = false, onToggle, className = '' }) => {
  const id = uid('disc');
  const region = h('div', { id: `${id}-r`, class: 'disc-body', role: 'region', 'aria-labelledby': `${id}-b` }, content);
  const button = h('button', { type: 'button', id: `${id}-b`, class: 'disc-btn', 'aria-expanded': String(open), 'aria-controls': `${id}-r` }, h('span', { class: 'disc-caret', 'aria-hidden': 'true' }), h('span', { text: title }));
  region.hidden = !open;
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    region.hidden = !next;
    if (onToggle) onToggle(next);
  });
  return { el: h('div', { class: `disc ${className}` }, button, region), button, region, setOpen: v => { button.setAttribute('aria-expanded', String(v)); region.hidden = !v; } };
};

let tipReady = false;

export const initTooltips = () => {
  if (tipReady) return;
  tipReady = true;
  const tip = h('div', { id: 'wm-tip', class: 'tip', role: 'tooltip' });
  tip.hidden = true;
  document.body.append(tip);
  let timer = null;
  let target = null;
  const hide = () => {
    clearTimeout(timer);
    if (target) target.removeAttribute('aria-describedby');
    target = null;
    tip.hidden = true;
  };
  const show = el => {
    const message = el.getAttribute('data-tip');
    if (!message) return;
    tip.textContent = message;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
    const top = r.bottom + t.height + 14 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - t.height - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    el.setAttribute('aria-describedby', 'wm-tip');
    target = el;
  };
  const schedule = el => {
    hide();
    timer = setTimeout(() => show(el), 300);
  };
  const find = e => (e.target && e.target.closest ? e.target.closest('[data-tip]') : null);
  document.addEventListener('pointerover', e => {
    const el = find(e);
    if (el && el !== target) schedule(el);
  });
  document.addEventListener('pointerout', e => {
    const el = find(e);
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('focusin', e => {
    const el = find(e);
    if (el) schedule(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tip.hidden) hide(); });
};

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"]),input:not([disabled]),textarea:not([disabled])';

export const openDialog = ({ title, body, actions, dismissible = true }) => new Promise(resolve => {
  const previous = document.activeElement;
  const id = uid('dlg');
  const bodyEl = typeof body === 'string' ? h('p', { class: 'dlg-text', text: body }) : body;
  const buttons = (actions || [{ label: 'Close', value: null, kind: 'primary' }]).map(a => h('button', {
    type: 'button', class: `btn ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}`, text: a.label,
    onClick: () => finish(a.value)
  }));
  const box = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t`, tabindex: '-1' },
    h('h3', { id: `${id}-t`, text: title }), bodyEl, h('div', { class: 'dlg-actions' }, buttons));
  const overlay = h('div', { class: 'dlg-overlay' }, box);
  const app = document.getElementById('app');
  const finish = value => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (app) app.removeAttribute('inert');
    if (previous && previous.focus) previous.focus();
    resolve(value);
  };
  const onKey = e => {
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (e.key === 'Tab') {
      const nodes = Array.from(box.querySelectorAll(FOCUSABLE)).filter(n => !n.hidden && n.offsetParent !== null);
      if (!nodes.length) {
        e.preventDefault();
        box.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay && dismissible) finish(null); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  if (app) app.setAttribute('inert', '');
  const preferred = box.querySelector('[data-autofocus]') || buttons[buttons.length - 1] || box;
  preferred.focus();
});

export const askDialog = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) => openDialog({
  title,
  body: message,
  actions: [{ label: cancelLabel, value: false }, { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' }]
}).then(v => v === true);

export const DropZone = ({ label, hint, accept, multiple = false, compact = false, onFiles }) => {
  const input = document.createElement('input');
  input.type = 'file';
  if (accept) input.accept = accept;
  input.multiple = multiple;
  input.className = 'vh';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  const zone = h('div', { class: `drop${compact ? ' compact' : ''}`, role: 'button', tabindex: '0', 'aria-label': label },
    h('span', { class: 'drop-label', text: label }), hint && !compact ? h('small', { text: hint }) : null);
  const deliver = files => { if (files.length && onFiles) onFiles(files); };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    deliver(Array.from(input.files));
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, e => {
    e.preventDefault();
    zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, e => {
    e.preventDefault();
    zone.classList.remove('over');
  }));
  zone.addEventListener('drop', e => deliver(Array.from((e.dataTransfer && e.dataTransfer.files) || [])));
  return { el: h('span', { class: 'drop-wrap' }, zone, input), zone, input };
};

export const copyText = async text => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const area = h('textarea', { class: 'vh', 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }
};

export const CopyButton = ({ label = 'Copy', getText, className = '' }) => {
  const live = h('span', { class: 'vh', 'aria-live': 'polite' });
  const face = h('span', { text: label });
  const button = h('button', { type: 'button', class: `btn ${className}` }, face);
  let timer = null;
  button.addEventListener('click', async () => {
    const ok = await copyText(getText());
    face.textContent = ok ? 'Copied' : 'Copy failed';
    live.textContent = ok ? 'Copied to clipboard' : 'Copy failed';
    clearTimeout(timer);
    timer = setTimeout(() => {
      face.textContent = label;
      live.textContent = '';
    }, 1400);
  });
  return { el: h('span', { class: 'copy-wrap' }, button, live), button };
};

export const NumberField = ({ value, min = -Infinity, max = Infinity, step = 1, unit, onChange, label, format, allowBlank = false, blankText = '' }) => {
  const id = uid('nf');
  let current = value;
  const show = v => (v === null || v === undefined || v === Infinity ? blankText : format ? format(v) : String(v));
  const input = h('input', { id, class: 'nf-input', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': label, 'aria-describedby': `${id}-h` });
  const hint = h('span', { id: `${id}-h`, class: 'nf-hint', 'aria-live': 'polite' });
  const root = h('div', { class: 'nf' }, input, unit ? h('span', { class: 'nf-unit', text: unit }) : null, hint);
  const parse = text => {
    const s = text.trim();
    if (s === '') return allowBlank ? { ok: true, value: Infinity } : { ok: false };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false };
    if (n < min || n > max) return { ok: false };
    return { ok: true, value: n };
  };
  const range = () => `Enter a number from ${min} to ${max}${allowBlank ? ' or leave blank' : ''}`;
  const check = () => {
    const r = parse(input.value);
    input.setAttribute('aria-invalid', r.ok ? 'false' : 'true');
    hint.textContent = r.ok ? '' : range();
    return r;
  };
  const commit = () => {
    const r = check();
    if (!r.ok) return;
    if (r.value !== current) {
      current = r.value;
      if (onChange) onChange(current);
    }
  };
  input.value = show(current);
  input.addEventListener('input', check);
  input.addEventListener('blur', () => {
    const r = check();
    if (r.ok) {
      commit();
      input.value = show(current);
    }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      input.value = show(current);
      check();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = Number.isFinite(Number(input.value)) && input.value.trim() !== '' ? Number(input.value) : Number.isFinite(current) ? current : min;
      const next = Math.min(max, Math.max(min, base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)));
      input.value = String(Number(next.toFixed(decimals(step) + 2)));
      commit();
    }
  });
  return { el: root, input, setValue: v => { current = v; input.value = show(v); check(); }, getValue: () => current };
};

export const Segmented = ({ options, value, onChange, label, className = '' }) => {
  let current = value;
  const buttons = options.map(o => h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'data-v': o.value, text: o.label }));
  const root = h('div', { class: `seg ${className}`, role: 'radiogroup', 'aria-label': label }, buttons);
  const paint = () => buttons.forEach((b, i) => {
    const on = options[i].value === current;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
    b.classList.toggle('on', on);
  });
  const select = i => {
    const next = options[(i + options.length) % options.length].value;
    const changed = next !== current;
    current = next;
    paint();
    buttons[(i + options.length) % options.length].focus();
    if (changed && onChange) onChange(current);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        select(i + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        select(i - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        select(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        select(options.length - 1);
      }
    });
  });
  paint();
  return { el: root, setValue: v => { current = v; paint(); }, getValue: () => current };
};

export const ChipGroup = ({ options, selected = [], multi = false, onChange, label, minOne = false }) => {
  let current = Array.isArray(selected) ? selected.slice() : [selected];
  const buttons = options.map(o => h('button', {
    type: 'button', class: 'chip', 'data-v': o.value, 'aria-pressed': 'false', style: o.color ? { '--k': o.color } : null, 'data-tip': o.tip || null
  }, o.label));
  const root = h('div', { class: 'chips', role: 'group', 'aria-label': label }, buttons);
  const paint = () => buttons.forEach((b, i) => {
    const on = current.includes(options[i].value);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
  });
  buttons.forEach((b, i) => b.addEventListener('click', () => {
    const v = options[i].value;
    if (multi) {
      const next = current.includes(v) ? current.filter(x => x !== v) : current.concat(v);
      if (minOne && !next.length) return;
      current = next;
    } else {
      current = [v];
    }
    paint();
    if (onChange) onChange(multi ? current.slice() : current[0]);
  }));
  paint();
  return { el: root, setSelected: v => { current = Array.isArray(v) ? v.slice() : [v]; paint(); }, getSelected: () => current.slice() };
};

export const Toast = () => {
  const el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  el.hidden = true;
  let timer = null;
  const show = text => {
    el.textContent = text;
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { el.hidden = true; }, 3500);
  };
  return { el, show };
};
