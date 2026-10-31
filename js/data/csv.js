const CANDIDATES = [',', ';', '\t'];

export const stripBom = text => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export const detectDelimiter = input => {
  const text = stripBom(input);
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted) {
      if (c === '\n' || c === '\r') break;
      if (counts[c] !== undefined) counts[c] += 1;
    }
  }
  let best = ',';
  CANDIDATES.forEach(d => { if (counts[d] > counts[best]) best = d; });
  return best;
};

export const parseCSV = (input, forced) => {
  const text = stripBom(input);
  const delimiter = forced || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field !== '' || row.length) endRow();
  return { delimiter, rows: rows.filter(r => r.some(cell => cell !== '')) };
};

const encodeField = (value, delimiter, alone) => {
  const v = value === null || value === undefined ? '' : String(value);
  const needs = v.includes(delimiter) || v.includes('"') || v.includes('\n') || v.includes('\r') || (alone && v === '');
  return needs ? `"${v.split('"').join('""')}"` : v;
};

export const serialiseCSV = (rows, options = {}) => {
  const delimiter = options.delimiter || ',';
  const eol = options.eol || '\r\n';
  const body = rows.map(row => row.map(cell => encodeField(cell, delimiter, row.length === 1)).join(delimiter)).join(eol);
  return (options.bom ? '\ufeff' : '') + body + (rows.length ? eol : '');
};
