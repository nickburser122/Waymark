import { parseCSV } from './csv.js';

const col = (key, extra = {}) => ({ key, required: false, synonyms: [], ...extra });

const GEO = [['lat', 'lon'], ['x', 'y']];

const site = col('site', { synonyms: ['clinic', 'location_id'] });

export const TABLES = Object.freeze({
  facilities: {
    view: 'route',
    label: 'Facilities',
    oneOf: GEO,
    columns: [
      col('id', { required: true, synonyms: ['facility_id', 'site_id', 'code'] }),
      col('name', { required: true, synonyms: ['facility', 'facility_name', 'site_name'] }),
      col('tier', { required: true, synonyms: ['type', 'ownership', 'sector'] }),
      col('lat', { synonyms: ['latitude'] }),
      col('lon', { synonyms: ['lng', 'long', 'longitude'] }),
      col('x'),
      col('y'),
      col('services', { required: true, synonyms: ['service', 'offers', 'services_offered'] }),
      col('capacity_per_day', { required: true, synonyms: ['capacity', 'slots', 'slots_per_day'] }),
      col('price_multiplier', { required: true, synonyms: ['price', 'cost_mult', 'price_mult', 'multiplier'] }),
      col('referrals_per_day', { synonyms: ['referrals', 'demand_per_day', 'inflow'] }),
      col('waitlist', { synonyms: ['queue', 'backlog', 'waiting'] }),
      col('quality', { synonyms: ['rating', 'score'] }),
      col('reviews', { synonyms: ['n_reviews', 'review_count', 'ratings'] })
    ]
  },
  services: {
    view: 'route',
    label: 'Services',
    columns: [
      col('id', { required: true, synonyms: ['service_id', 'code'] }),
      col('name', { required: true, synonyms: ['service', 'service_name'] }),
      col('base_price', { required: true, synonyms: ['price', 'cost', 'base_cost'] }),
      col('complexity', { synonyms: ['complexity_factor', 'difficulty'] })
    ]
  },
  patients: {
    view: 'route',
    label: 'Patients',
    oneOf: GEO,
    columns: [
      col('id', { required: true, synonyms: ['patient_id'] }),
      col('name', { synonyms: ['patient', 'patient_name'] }),
      col('lat', { synonyms: ['latitude'] }),
      col('lon', { synonyms: ['lng', 'long', 'longitude'] }),
      col('x'),
      col('y'),
      col('needs', { required: true, synonyms: ['services_needed', 'need', 'services', 'required_services'] }),
      col('urgency', { required: true, synonyms: ['priority', 'triage', 'acuity'] }),
      col('previous_site', { synonyms: ['previous', 'prev_site', 'usual_site', 'last_site'] })
    ]
  },
  travel: {
    view: 'route',
    label: 'Travel times',
    columns: [
      col('patient_id', { required: true, synonyms: ['patient'] }),
      col('facility_id', { required: true, synonyms: ['facility'] }),
      col('minutes', { required: true, synonyms: ['travel_minutes', 'time_min', 'mins'] })
    ]
  },
  stations: {
    view: 'clinic',
    label: 'Stations',
    columns: [
      col('id', { required: true, synonyms: ['station_id', 'station_code'] }),
      col('name', { required: true, synonyms: ['station'] }),
      col('service_min', { required: true, synonyms: ['service_time', 'minutes_per_patient', 'svc_min', 'service_minutes'] }),
      col('service_cv2', { synonyms: ['cv2', 'cs2', 'service_scv'] }),
      site
    ]
  },
  staffing: {
    view: 'clinic',
    label: 'Staffing',
    columns: [
      col('station_id', { required: true, synonyms: ['station', 'id'] }),
      col('hour', { required: true, synonyms: ['h', 'hr'] }),
      col('servers', { required: true, synonyms: ['staff', 'count', 'n_servers'] }),
      site
    ]
  },
  arrivals: {
    view: 'clinic',
    label: 'Arrivals',
    columns: [
      col('hour', { required: true, synonyms: ['h', 'hr'] }),
      col('arrivals', { required: true, synonyms: ['count', 'patients', 'arrivals_per_hour', 'volume'] }),
      col('arrival_cv2', { synonyms: ['cv2', 'ca2'] }),
      site
    ]
  },
  routes: {
    view: 'clinic',
    label: 'Routes',
    columns: [
      col('from', { required: true, synonyms: ['source', 'origin', 'from_station'] }),
      col('to', { required: true, synonyms: ['target', 'destination', 'to_station'] }),
      col('share', { required: true, synonyms: ['probability', 'p', 'fraction', 'split'] }),
      site
    ]
  },
  weak_points: {
    view: 'clinic',
    label: 'Weak points',
    columns: [
      col('id', { required: true, synonyms: ['weak_point_id', 'wp'] }),
      col('station_id', { required: true, synonyms: ['station'] }),
      col('title', { required: true, synonyms: ['name', 'description', 'weak_point'] }),
      col('impact', { required: true, synonyms: ['i', 'severity'] }),
      col('frequency', { required: true, synonyms: ['f', 'freq'] }),
      col('unpredictability', { required: true, synonyms: ['p', 'unpred'] }),
      col('detectability', { required: true, synonyms: ['d', 'detect'] }),
      site
    ]
  },
  fixes: {
    view: 'clinic',
    label: 'Fixes',
    columns: [
      col('id', { required: true, synonyms: ['fix_id'] }),
      col('title', { required: true, synonyms: ['name', 'fix'] }),
      col('effort', { required: true, synonyms: ['effort_level'] }),
      col('cost_k', { synonyms: ['cost', 'cost_in_k'] }),
      site
    ]
  },
  fix_effects: {
    view: 'clinic',
    label: 'Fix effects',
    columns: [
      col('fix_id', { required: true, synonyms: ['fix'] }),
      col('kind', { required: true, synonyms: ['type', 'effect'] }),
      col('target', { required: true, synonyms: ['station', 'weak_point'] }),
      col('field', { synonyms: ['rating', 'dimension'] }),
      col('delta', { required: true, synonyms: ['change', 'amount'] }),
      col('from_hour', { synonyms: ['start_hour', 'from'] }),
      col('to_hour', { synonyms: ['end_hour', 'to'] }),
      site
    ]
  }
});

export const TABLE_NAMES = Object.freeze(Object.keys(TABLES));

export const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, patients: 10000, facilities: 1000, stations: 200 });

export const normaliseHeader = header => String(header).trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('_');

export const columnKeys = table => TABLES[table].columns.map(c => c.key);

const isWideHour = header => /^h\d{1,2}$/.test(normaliseHeader(header));

export const convertWideStaffing = (headers, rows) => {
  const hourColumns = headers.map((h, i) => ({ h: normaliseHeader(h), i })).filter(x => isWideHour(x.h));
  if (!hourColumns.length) return null;
  const names = headers.map(normaliseHeader);
  const idIndex = names.findIndex(n => ['station_id', 'station', 'id'].includes(n));
  if (idIndex < 0) return null;
  const siteIndex = names.indexOf('site');
  const out = [];
  rows.forEach(row => {
    hourColumns.forEach(({ h, i }) => {
      if ((row[i] || '').trim() === '') return;
      const long = [row[idIndex], String(Number(h.slice(1))), row[i]];
      if (siteIndex >= 0) long.push(row[siteIndex]);
      out.push(long);
    });
  });
  const outHeaders = ['station_id', 'hour', 'servers'];
  if (siteIndex >= 0) outHeaders.push('site');
  return { headers: outHeaders, rows: out, converted: true };
};

export const matchHeaders = (table, headers) => {
  const spec = TABLES[table];
  const names = headers.map(normaliseHeader);
  const mapping = {};
  const used = new Set();
  const claim = (column, candidates) => {
    if (mapping[column.key] !== undefined) return;
    const at = names.findIndex((n, i) => !used.has(i) && candidates.includes(n));
    if (at >= 0) {
      mapping[column.key] = at;
      used.add(at);
    }
  };
  spec.columns.forEach(column => claim(column, [column.key]));
  spec.columns.forEach(column => claim(column, column.synonyms));
  const missing = spec.columns.filter(c => c.required && mapping[c.key] === undefined).map(c => c.key);
  const groups = [];
  if (spec.oneOf) {
    const satisfied = spec.oneOf.some(pair => pair.every(k => mapping[k] !== undefined));
    if (!satisfied) groups.push({ label: 'Location', options: spec.oneOf });
  }
  const unmatched = headers.map((name, index) => ({ name, index })).filter(h => !used.has(h.index));
  return { mapping, missing, groups, unmatched, complete: missing.length === 0 && groups.length === 0 };
};

export const toRecords = (table, rows, mapping) => {
  const keys = columnKeys(table);
  return rows
    .map(row => Object.fromEntries(keys.map(key => [key, mapping[key] === undefined ? '' : String(row[mapping[key]] === undefined ? '' : row[mapping[key]]).trim()])))
    .filter(record => keys.some(key => record[key] !== ''));
};

const cellText = value => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
};

export const recordsFromObjects = (table, list) => {
  const present = [];
  list.forEach(item => {
    if (item && typeof item === 'object') Object.keys(item).forEach(k => { if (!present.includes(k)) present.push(k); });
  });
  const match = matchHeaders(table, present);
  const rows = list.map(item => present.map(k => cellText(item && item[k])));
  return { headers: present, rows, match, records: toRecords(table, rows, match.mapping) };
};

export const qualityScaleOptions = records => {
  const values = records.map(r => r.quality).filter(v => v !== '').map(Number);
  if (!values.length || values.some(v => !Number.isFinite(v))) return [];
  if (values.every(v => v >= 0 && v <= 1)) return [];
  const options = [];
  if (values.every(v => v >= 1 && v <= 5)) options.push('five');
  if (values.every(v => v >= 0 && v <= 100)) options.push('percent');
  return options;
};

export const QUALITY_SCALE_LABELS = Object.freeze({ five: '1–5 scale', percent: '%' });

export const convertQuality = (records, scale) => records.map(r => {
  if (r.quality === '' || !Number.isFinite(Number(r.quality))) return r;
  const q = Number(r.quality);
  const converted = scale === 'five' ? (q - 1) / 4 : q / 100;
  return { ...r, quality: String(Number(converted.toFixed(6))) };
});

export const readTable = (table, text, fileName) => {
  if (new TextEncoder().encode(text).length > LIMITS.bytes) return { error: 'This file is over the 5 MB limit.' };
  const trimmed = text.trim();
  const isJson = /\.json$/i.test(fileName || '') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (isJson) {
    let value;
    try { value = JSON.parse(trimmed); } catch (e) { return { error: 'This file is not valid JSON.' }; }
    let list = null;
    if (Array.isArray(value)) list = value;
    else if (value && Array.isArray(value[table])) list = value[table];
    else if (value && value.data && Array.isArray(value.data[table])) list = value.data[table];
    if (!list) return { error: `No "${table}" rows found in this JSON.` };
    const parsed = recordsFromObjects(table, list);
    return { headers: parsed.headers, rows: parsed.rows, match: parsed.match, records: parsed.records, format: 'json' };
  }
  const parsed = parseCSV(text);
  if (!parsed.rows.length) return { error: 'This file has no rows.' };
  let headers = parsed.rows[0];
  let rows = parsed.rows.slice(1);
  let note = '';
  if (table === 'staffing') {
    const wide = convertWideStaffing(headers, rows);
    if (wide) {
      headers = wide.headers;
      rows = wide.rows;
      note = 'Wide staffing columns were converted to rows.';
    }
  }
  const match = matchHeaders(table, headers);
  return { headers, rows, match, records: match.complete ? toRecords(table, rows, match.mapping) : null, format: 'delimited', delimiter: parsed.delimiter, note };
};

export const readMultiJson = text => {
  let value;
  try { value = JSON.parse(text); } catch (e) { return null; }
  if (!value || typeof value !== 'object') return null;
  const source = value.data && typeof value.data === 'object' ? value.data : value;
  const tables = {};
  TABLE_NAMES.forEach(name => {
    if (Array.isArray(source[name])) tables[name] = recordsFromObjects(name, source[name]).records;
  });
  return Object.keys(tables).length ? { tables, params: value.params || null, version: value.version || null } : null;
};

export const tableFromFileName = name => {
  const base = normaliseHeader(String(name).replace(/\.[^.]+$/, ''));
  return TABLE_NAMES.find(t => t === base) || null;
};

export const templateRows = (table, sample) => {
  const keys = columnKeys(table).filter(k => {
    if (k === 'site') return false;
    if (TABLES[table].oneOf && (k === 'lat' || k === 'lon')) return false;
    return true;
  });
  const source = (sample && sample[table]) || [];
  let body = source.slice(0, 3).map(r => keys.map(k => r[k] || ''));
  if (!body.length) body = [keys.map(k => EXAMPLES[table] && EXAMPLES[table][k] !== undefined ? EXAMPLES[table][k] : '')];
  return [keys].concat(body);
};

const EXAMPLES = { travel: { patient_id: 'P001', facility_id: 'sag', minutes: '35' } };
