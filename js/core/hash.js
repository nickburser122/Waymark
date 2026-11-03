export const fnv1a = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === Infinity ? 'Infinity' : value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return `[${Array.from(value).map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
};
