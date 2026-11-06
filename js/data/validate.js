import { TABLES, TABLE_NAMES, LIMITS } from './schema.js';
import { cycleOf } from '../core/flow.js';

const TIERS = ['public', 'contracted', 'private'];
const URGENCY = { routine: 0, soon: 1, urgent: 2, 0: 0, 1: 1, 2: 2 };
const KINDS = ['staff', 'speed', 'risk'];
const FIELDS = ['I', 'F', 'P', 'D'];

export const parseNumber = value => {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

export const parseList = value => String(value || '').split(/[;,\s]+/).map(v => v.trim()).filter(Boolean);

export const SITE_DEFAULT = 'main';

const siteOf = record => (record.site || '').trim() || SITE_DEFAULT;

const createIssues = () => {
  const list = [];
  const add = (table, row, column, message, severity = 'error') => list.push({ table, row, column, message, severity });
  return { list, add };
};

const checkUnique = (add, table, records, key, label = 'id') => {
  const seen = new Map();
  records.forEach((r, i) => {
    const v = (r[key] || '').trim();
    if (v === '') return;
    if (seen.has(v)) add(table, i, key, `Duplicate ${label} "${v}" (also row ${seen.get(v) + 1})`);
    else seen.set(v, i);
  });
};

const required = (add, table, record, row, key, label) => {
  if ((record[key] || '').trim() === '') {
    add(table, row, key, `${label || key} is required`);
    return false;
  }
  return true;
};

const numberIn = (add, table, record, row, key, lo, hi, options = {}) => {
  const raw = (record[key] || '').trim();
  if (raw === '') {
    if (options.optional) return null;
    add(table, row, key, `${key} is required`);
    return null;
  }
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) {
    add(table, row, key, `${key} must be a number`);
    return null;
  }
  if (n < lo || n > hi || (options.exclusiveLow && n <= lo)) {
    add(table, row, key, `${key} must be ${options.exclusiveLow ? 'above' : 'from'} ${lo}${options.exclusiveLow ? '' : ` to ${hi}`}${options.exclusiveLow ? ` and at most ${hi}` : ''}`);
    return null;
  }
  if (options.integer && !Number.isInteger(n)) {
    add(table, row, key, `${key} must be a whole number`);
    return null;
  }
  return n;
};

const coordinates = (add, table, record, row) => {
  const has = k => (record[k] || '').trim() !== '';
  const geo = has('lat') || has('lon');
  const xy = has('x') || has('y');
  if (!geo && !xy) return { mode: null };
  if (geo && xy) {
    add(table, row, 'x', 'Use either lat+lon or x+y, not both');
    return { mode: 'bad' };
  }
  if (geo) {
    const lat = numberIn(add, table, record, row, 'lat', -90, 90);
    const lon = numberIn(add, table, record, row, 'lon', -180, 180);
    return lat === null || lon === null ? { mode: 'bad' } : { mode: 'geo', lat, lon };
  }
  const x = numberIn(add, table, record, row, 'x', -1e6, 1e6);
  const y = numberIn(add, table, record, row, 'y', -1e6, 1e6);
  return x === null || y === null ? { mode: 'bad' } : { mode: 'xy', x, y };
};

export const compileRouting = (tables, params, add) => {
  const services = tables.services || [];
  const facilities = tables.facilities || [];
  const patients = tables.patients || [];
  const travel = tables.travel || [];
  if (facilities.length > LIMITS.facilities) add('facilities', null, null, `At most ${LIMITS.facilities} facilities are supported`);
  if (patients.length > LIMITS.patients) add('patients', null, null, `At most ${LIMITS.patients} patients are supported`);

  checkUnique(add, 'services', services, 'id');
  const serviceIds = new Set(services.map(s => (s.id || '').trim()).filter(Boolean));
  const typedServices = [];
  services.forEach((s, i) => {
    const okId = required(add, 'services', s, i, 'id');
    const okName = required(add, 'services', s, i, 'name');
    const price = numberIn(add, 'services', s, i, 'base_price', 0, 1e9);
    const complexity = numberIn(add, 'services', s, i, 'complexity', 0, 20, { optional: true, exclusiveLow: true });
    if (okId && okName && price !== null) typedServices.push({ id: s.id.trim(), name: s.name.trim(), price, complexity: complexity === null ? params.defaultComplexity : complexity });
  });

  checkUnique(add, 'facilities', facilities, 'id');
  const facilityIds = new Set(facilities.map(f => (f.id || '').trim()).filter(Boolean));
  const modes = new Map();
  const typedFacilities = [];
  const offered = new Set();
  facilities.forEach((f, i) => {
    const okId = required(add, 'facilities', f, i, 'id');
    const okName = required(add, 'facilities', f, i, 'name');
    const tier = (f.tier || '').trim().toLowerCase();
    let okTier = true;
    if (!TIERS.includes(tier)) {
      add('facilities', i, 'tier', 'Tier must be public, contracted or private');
      okTier = false;
    }
    const coord = coordinates(add, 'facilities', f, i);
    if (coord.mode === null) add('facilities', i, 'x', 'Needs lat+lon or x+y');
    if (coord.mode) modes.set(i, coord.mode);
    const list = parseList(f.services);
    if (!list.length) add('facilities', i, 'services', 'List at least one service');
    list.forEach(id => { if (!serviceIds.has(id)) add('facilities', i, 'services', `Unknown service "${id}"`); else offered.add(id); });
    const capacity = numberIn(add, 'facilities', f, i, 'capacity_per_day', 0, 1e6);
    if (capacity === 0) add('facilities', i, 'capacity_per_day', 'Zero capacity: this site can never receive patients', 'warning');
    const multiplier = numberIn(add, 'facilities', f, i, 'price_multiplier', 0, 50, { exclusiveLow: true });
    const referrals = numberIn(add, 'facilities', f, i, 'referrals_per_day', 0, 1e6, { optional: true });
    const waitlist = numberIn(add, 'facilities', f, i, 'waitlist', 0, 1e7, { optional: true });
    if (referrals === null && waitlist !== null && waitlist > 0) add('facilities', i, 'referrals_per_day', 'Inflow estimated as waitlist ÷ H.', 'warning');
    const quality = numberIn(add, 'facilities', f, i, 'quality', 0, 1, { optional: true });
    const reviews = numberIn(add, 'facilities', f, i, 'reviews', 0, 1e9, { optional: true, integer: true });
    if (okId && okName && okTier && coord.mode && coord.mode !== 'bad' && list.length && capacity !== null && multiplier !== null) {
      typedFacilities.push({
        id: f.id.trim(), name: f.name.trim(), tier, lat: coord.lat, lon: coord.lon, x: coord.x, y: coord.y,
        services: list.filter(id => serviceIds.has(id)), capacity, multiplier,
        referrals, waitlist: waitlist === null ? 0 : waitlist, quality, reviews: reviews === null ? 0 : reviews
      });
    }
  });
  const distinct = new Set(modes.values());
  distinct.delete('bad');
  if (distinct.size > 1) {
    const major = [...distinct].sort((a, b) => [...modes.values()].filter(m => m === b).length - [...modes.values()].filter(m => m === a).length)[0];
    modes.forEach((mode, i) => { if (mode !== major && mode !== 'bad') add('facilities', i, mode === 'geo' ? 'lat' : 'x', `Other sites use ${major === 'geo' ? 'lat+lon' : 'x+y'}`); });
  }
  const facilityMode = distinct.size ? [...distinct][0] : null;

  checkUnique(add, 'patients', patients, 'id');
  const patientIds = new Set(patients.map(p => (p.id || '').trim()).filter(Boolean));
  const travelledPatients = new Set(travel.map(t => (t.patient_id || '').trim()));
  const typedPatients = [];
  patients.forEach((p, i) => {
    const okId = required(add, 'patients', p, i, 'id');
    const coord = coordinates(add, 'patients', p, i);
    const id = (p.id || '').trim();
    if (coord.mode === null && !travelledPatients.has(id)) add('patients', i, 'x', 'Needs lat+lon or x+y');
    if (coord.mode && coord.mode !== 'bad' && facilityMode && coord.mode !== facilityMode && !travelledPatients.has(id)) {
      add('patients', i, coord.mode === 'geo' ? 'lat' : 'x', `Facilities use ${facilityMode === 'geo' ? 'lat+lon' : 'x+y'}`);
    }
    const needs = parseList(p.needs);
    if (!needs.length) add('patients', i, 'needs', 'List at least one needed service');
    needs.forEach(n => {
      if (!serviceIds.has(n)) add('patients', i, 'needs', `Unknown service "${n}"`);
      else if (!offered.has(n)) add('patients', i, 'needs', `No facility offers "${n}"`, 'warning');
    });
    const urgencyKey = (p.urgency || '').trim().toLowerCase();
    let urgency = null;
    if (Object.prototype.hasOwnProperty.call(URGENCY, urgencyKey)) urgency = URGENCY[urgencyKey];
    else add('patients', i, 'urgency', 'Urgency must be routine, soon, urgent or 0, 1, 2');
    const previous = (p.previous_site || '').trim();
    if (previous && !facilityIds.has(previous)) add('patients', i, 'previous_site', `Unknown facility "${previous}"`);
    const requested = (p.requested_site || '').trim();
    if (requested && !facilityIds.has(requested)) add('patients', i, 'requested_site', `Unknown facility "${requested}"; the request is ignored`, 'warning');
    if (okId && coord.mode !== 'bad' && needs.length && urgency !== null) {
      typedPatients.push({
        id, name: (p.name || '').trim() || id, lat: coord.lat, lon: coord.lon, x: coord.x, y: coord.y,
        needs: needs.filter(n => serviceIds.has(n)), urgency, previous: facilityIds.has(previous) ? previous : '', requested: facilityIds.has(requested) ? requested : ''
      });
    }
  });

  const pairs = new Set();
  const typedTravel = [];
  travel.forEach((t, i) => {
    const pid = (t.patient_id || '').trim();
    const fid = (t.facility_id || '').trim();
    required(add, 'travel', t, i, 'patient_id');
    required(add, 'travel', t, i, 'facility_id');
    if (pid && !patientIds.has(pid)) add('travel', i, 'patient_id', `Unknown patient "${pid}"`);
    if (fid && !facilityIds.has(fid)) add('travel', i, 'facility_id', `Unknown facility "${fid}"`);
    const key = `${pid}\u0001${fid}`;
    if (pid && fid && pairs.has(key)) add('travel', i, 'facility_id', 'Duplicate patient and facility pair');
    pairs.add(key);
    const minutes = numberIn(add, 'travel', t, i, 'minutes', 0, 1e5);
    if (minutes !== null && pid && fid) typedTravel.push({ patient: pid, facility: fid, minutes });
  });

  return { data: { services: typedServices, facilities: typedFacilities, patients: typedPatients, travel: typedTravel }, facilityMode };
};

const groupBySite = records => {
  const map = new Map();
  records.forEach((record, row) => {
    const key = siteOf(record);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ record, row });
  });
  return map;
};

export const FIX_NEEDS = Object.freeze(['space', 'budget', 'staff', 'approval']);

export const RISK_CATEGORIES = Object.freeze(['oversight', 'information', 'alternative', 'dependency', 'bottleneck']);

const CATEGORY_CODES = Object.freeze({ ctrl: 'oversight', info: 'information', alt: 'alternative', dep: 'dependency', neck: 'bottleneck' });

const CLINIC_TABLES = ['stations', 'staffing', 'arrivals', 'routes', 'weak_points', 'fixes', 'fix_effects'];

export const compileClinic = (tables, params, add) => {
  const grouped = {};
  CLINIC_TABLES.forEach(name => { grouped[name] = groupBySite(tables[name] || []); });
  if ((tables.stations || []).length > LIMITS.stations) add('stations', null, null, `At most ${LIMITS.stations} stations are supported`);
  const siteIds = new Set();
  CLINIC_TABLES.forEach(name => grouped[name].forEach((_, key) => siteIds.add(key)));
  const sites = [];
  [...siteIds].sort((a, b) => (a === SITE_DEFAULT ? -1 : b === SITE_DEFAULT ? 1 : a < b ? -1 : 1)).forEach(siteId => {
    const part = name => grouped[name].get(siteId) || [];
    const dup = (name, key) => {
      const seen = new Map();
      part(name).forEach(({ record, row }) => {
        const v = (record[key] || '').trim();
        if (!v) return;
        if (seen.has(v)) add(name, row, key, `Duplicate ${key === 'id' ? 'id' : key} "${v}"${siteId === SITE_DEFAULT ? '' : ` in site ${siteId}`}`);
        else seen.set(v, row);
      });
    };
    dup('stations', 'id');
    dup('weak_points', 'id');
    dup('fixes', 'id');
    const stations = [];
    part('stations').forEach(({ record, row }) => {
      const okId = required(add, 'stations', record, row, 'id');
      const okName = required(add, 'stations', record, row, 'name');
      const s = numberIn(add, 'stations', record, row, 'service_min', 0, 1e4, { exclusiveLow: true });
      const cv = numberIn(add, 'stations', record, row, 'service_cv2', 0, 100, { optional: true });
      if (okId && okName && s !== null) stations.push({ id: record.id.trim(), name: record.name.trim(), serviceMin: s, csSq: cv === null ? params.defaultServiceCv2 : cv, rows: row });
    });
    const stationIds = new Set(stations.map(s => s.id));
    const arrivalsByHour = new Map();
    const hourSeen = new Map();
    part('arrivals').forEach(({ record, row }) => {
      const h = numberIn(add, 'arrivals', record, row, 'hour', 0, 47, { integer: true });
      const a = numberIn(add, 'arrivals', record, row, 'arrivals', 0, 1e6);
      const cv = numberIn(add, 'arrivals', record, row, 'arrival_cv2', 0, 100, { optional: true });
      if (h !== null) {
        if (hourSeen.has(h)) add('arrivals', row, 'hour', `Duplicate hour ${h}`);
        else hourSeen.set(h, row);
      }
      if (h !== null && a !== null && !arrivalsByHour.has(h)) arrivalsByHour.set(h, { a, cv: cv === null ? params.defaultArrivalCv2 : cv });
    });
    const present = [...arrivalsByHour.keys()].sort((a, b) => a - b);
    for (let i = 1; i < present.length; i++) {
      const from = present[i - 1] + 1;
      const to = present[i] - 1;
      if (to < from) continue;
      add('arrivals', hourSeen.get(present[i - 1]), 'hour', `Hours ${from === to ? from : `${from}–${to}`} had no row; treated as 0 arrivals.`, 'warning');
      for (let h = from; h <= to; h++) arrivalsByHour.set(h, { a: 0, cv: params.defaultArrivalCv2 });
    }
    const hours = [...arrivalsByHour.keys()].sort((a, b) => a - b);
    const servers = new Map(stations.map(s => [s.id, hours.map(() => 0)]));
    const staffSeen = new Set();
    const staffed = new Set();
    part('staffing').forEach(({ record, row }) => {
      const sid = (record.station_id || '').trim();
      required(add, 'staffing', record, row, 'station_id');
      if (sid && !stationIds.has(sid)) add('staffing', row, 'station_id', `Unknown station "${sid}"`);
      const h = numberIn(add, 'staffing', record, row, 'hour', 0, 47, { integer: true });
      const c = numberIn(add, 'staffing', record, row, 'servers', 0, 1e4, { integer: true });
      if (sid && h !== null) {
        const key = `${sid}|${h}`;
        if (staffSeen.has(key)) add('staffing', row, 'hour', `Duplicate staffing for ${sid} at hour ${h}`);
        staffSeen.add(key);
      }
      if (h !== null && hours.length && !arrivalsByHour.has(h)) add('staffing', row, 'hour', `Hour ${h} has no arrivals row`, 'warning');
      if (sid && stationIds.has(sid) && h !== null && c !== null) {
        const at = hours.indexOf(h);
        if (at >= 0) servers.get(sid)[at] = c;
        staffed.add(sid);
      }
    });
    stations.forEach(s => { if (part('staffing').length && !staffed.has(s.id)) add('stations', s.rows, 'id', `Station "${s.id}" has no staffing, so it has no servers`, 'warning'); });
    const outgoing = new Map();
    const routes = [];
    part('routes').forEach(({ record, row }) => {
      const from = (record.from || '').trim();
      const to = (record.to || '').trim();
      required(add, 'routes', record, row, 'from');
      required(add, 'routes', record, row, 'to');
      if (from && from !== 'in' && !stationIds.has(from)) add('routes', row, 'from', `Unknown station "${from}"`);
      if (to && !stationIds.has(to)) add('routes', row, 'to', `Unknown station "${to}"`);
      const share = numberIn(add, 'routes', record, row, 'share', 0, 1, { exclusiveLow: true });
      if (share !== null && from && to) {
        routes.push({ from, to, share, row });
        outgoing.set(from, (outgoing.get(from) || 0) + share);
      }
    });
    routes.forEach(r => {
      if ((outgoing.get(r.from) || 0) > 1 + 1e-9) add('routes', r.row, 'share', `Shares leaving "${r.from}" add up to ${Number((outgoing.get(r.from)).toFixed(4))}, above 1`);
    });
    const validRoutes = routes.filter(r => (r.from === 'in' || stationIds.has(r.from)) && stationIds.has(r.to));
    const cycle = cycleOf(stations.map(s => s.id), validRoutes);
    if (cycle) {
      const hit = routes.find(r => r.from === cycle[0] && r.to === cycle[1]);
      add('routes', hit ? hit.row : null, 'to', `Route cycle: ${cycle.join(' → ')}`);
    }
    if (stations.length && !routes.some(r => r.from === 'in')) add('routes', null, null, `Site ${siteId}: no route leaves "in", so no patients enter`, 'warning');
    const weakPoints = [];
    part('weak_points').forEach(({ record, row }) => {
      const okId = required(add, 'weak_points', record, row, 'id');
      const sid = (record.station_id || '').trim();
      required(add, 'weak_points', record, row, 'station_id');
      if (sid && !stationIds.has(sid)) add('weak_points', row, 'station_id', `Unknown station "${sid}"`);
      const okTitle = required(add, 'weak_points', record, row, 'title');
      const rate = key => numberIn(add, 'weak_points', record, row, key, 1, 5);
      const I = rate('impact');
      const F = rate('frequency');
      const P = rate('unpredictability');
      const D = rate('detectability');
      const rawCategory = String(record.category || '').trim().toLowerCase();
      let category = CATEGORY_CODES[rawCategory] || rawCategory;
      if (category && !RISK_CATEGORIES.includes(category)) {
        add('weak_points', row, 'category', 'Unknown category "' + record.category + '"; treated as blank', 'warning');
        category = '';
      }
      if (okId && okTitle && stationIds.has(sid) && [I, F, P, D].every(v => v !== null)) weakPoints.push({ id: record.id.trim(), station: sid, title: record.title.trim(), I, F, P, D, category });
    });
    const weakIds = new Set(part('weak_points').map(({ record }) => (record.id || '').trim()));
    const fixes = [];
    part('fixes').forEach(({ record, row }) => {
      const okId = required(add, 'fixes', record, row, 'id');
      const okTitle = required(add, 'fixes', record, row, 'title');
      const effort = numberIn(add, 'fixes', record, row, 'effort', 1, 3, { integer: true });
      const cost = numberIn(add, 'fixes', record, row, 'cost_k', 0, 1e7, { optional: true });
      const tokens = String(record.needs || '').toLowerCase().split(/[\s,;|]+/).filter(Boolean);
      const unknown = tokens.filter(token => !FIX_NEEDS.includes(token));
      if (unknown.length) add('fixes', row, 'needs', 'Unknown need ' + unknown.map(u => '"' + u + '"').join(', ') + '; use space, budget, staff or approval');
      const needs = FIX_NEEDS.filter(need => tokens.includes(need));
      const alternativeTo = String(record.alternative_to || '').trim();
      if (okId && okTitle && effort !== null) fixes.push({ id: record.id.trim(), title: record.title.trim(), effort, cost: cost === null ? 0 : cost, needs, alternativeTo });
    });
    const fixIds = new Set(part('fixes').map(({ record }) => (record.id || '').trim()));
    fixes.forEach(fix => {
      if (fix.alternativeTo && (!fixIds.has(fix.alternativeTo) || fix.alternativeTo === fix.id)) {
        const at = part('fixes').find(({ record }) => (record.id || '').trim() === fix.id);
        if (at) add('fixes', at.row, 'alternative_to', 'alternative_to "' + fix.alternativeTo + '" is not another fix at this site; ignored', 'warning');
        fix.alternativeTo = '';
      }
    });
    const effects = [];
    part('fix_effects').forEach(({ record, row }) => {
      const fix = (record.fix_id || '').trim();
      required(add, 'fix_effects', record, row, 'fix_id');
      if (fix && !fixIds.has(fix)) add('fix_effects', row, 'fix_id', `Unknown fix "${fix}"`);
      const kind = (record.kind || '').trim().toLowerCase();
      let okKind = true;
      if (!KINDS.includes(kind)) {
        add('fix_effects', row, 'kind', 'Kind must be staff, speed or risk');
        okKind = false;
      }
      const target = (record.target || '').trim();
      required(add, 'fix_effects', record, row, 'target');
      if (okKind && target) {
        if (kind === 'risk' && !weakIds.has(target)) add('fix_effects', row, 'target', `Unknown weak point "${target}"`);
        if (kind !== 'risk' && !stationIds.has(target)) add('fix_effects', row, 'target', `Unknown station "${target}"`);
      }
      const field = (record.field || '').trim().toUpperCase();
      if (kind === 'risk' && !FIELDS.includes(field)) add('fix_effects', row, 'field', 'Field must be I, F, P or D');
      const delta = numberIn(add, 'fix_effects', record, row, 'delta', -1e6, 1e6);
      if (okKind && kind === 'speed' && delta !== null && delta <= 0) add('fix_effects', row, 'delta', 'A speed change multiplies service time, so it must be above 0');
      const from = numberIn(add, 'fix_effects', record, row, 'from_hour', 0, 47, { optional: true });
      const to = numberIn(add, 'fix_effects', record, row, 'to_hour', 0, 47, { optional: true });
      if (from !== null && to !== null && from >= to) add('fix_effects', row, 'to_hour', 'to_hour must be above from_hour (to_hour is exclusive), so this effect does nothing', 'warning');
      if (okKind && fix && delta !== null && target) effects.push({ fix, kind, target, field: kind === 'risk' ? field : '', delta, from, to });
    });
    if (!stations.length && !hours.length) return;
    sites.push({
      id: siteId,
      ready: stations.length > 0 && hours.length > 0,
      hours,
      arrivals: hours.map(h => arrivalsByHour.get(h).a),
      arrivalCv2: hours.map(h => arrivalsByHour.get(h).cv),
      stations: stations.map(s => ({ id: s.id, name: s.name, serviceMin: s.serviceMin, csSq: s.csSq, servers: servers.get(s.id) })),
      routes: validRoutes.map(r => ({ from: r.from, to: r.to, share: r.share })),
      weakPoints,
      fixes,
      effects
    });
  });
  return sites;
};

export const validateTables = (tables, params) => {
  const { list, add } = createIssues();
  const routing = compileRouting(tables, params, add);
  const sites = compileClinic(tables, params, add);
  const errors = list.filter(i => i.severity === 'error');
  const warnings = list.filter(i => i.severity === 'warning');
  const byTable = {};
  TABLE_NAMES.forEach(name => {
    const mine = list.filter(i => i.table === name);
    byTable[name] = { rows: (tables[name] || []).length, errors: mine.filter(i => i.severity === 'error').length, warnings: mine.filter(i => i.severity === 'warning').length };
  });
  const routeErrors = errors.some(i => TABLES[i.table].view === 'route');
  const clinicErrors = errors.some(i => TABLES[i.table].view === 'clinic');
  return {
    issues: list,
    errors,
    warnings,
    byTable,
    ok: errors.length === 0,
    routing: { data: routing.data, ready: !routeErrors && routing.data.facilities.length > 0 && routing.data.services.length > 0, mode: routing.facilityMode },
    clinic: { sites: clinicErrors ? [] : sites.filter(s => s.ready), ready: !clinicErrors && sites.some(s => s.ready) }
  };
};

export const issuesFor = (result, table) => result.issues.filter(i => i.table === table);

export const cellIssue = (result, table, row, column) => result.issues.find(i => i.table === table && i.row === row && i.column === column) || null;
