const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = value => String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, ch => ENTITIES[ch]);

export class Safe {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export const raw = text => new Safe(String(text));

const render = value => {
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
};

export const html = (strings, ...values) => {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Safe(out);
};

export const setHtml = (el, safe) => {
  el.innerHTML = safe instanceof Safe ? safe.text : esc(safe);
};
