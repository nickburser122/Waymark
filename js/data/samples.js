import { createRng } from '../core/rng.js';

const rows = (keys, list) => list.map(values => Object.fromEntries(keys.map((key, i) => [key, values[i] === undefined || values[i] === null ? '' : String(values[i])])));

const SERVICE_ROWS = [
  ['lab', 'Lab', 12, 0.3],
  ['xray', 'X-ray', 25, 0.4],
  ['mri', 'MRI/CT', 140, 1.6],
  ['cardio', 'Cardiology', 60, 1.1],
  ['dialysis', 'Dialysis', 90, 0.5],
  ['physio', 'Physio', 22, 0.9],
  ['ortho', 'Ortho', 55, 1.2],
  ['onco', 'Oncology', 180, 1.5],
  ['mater', 'Maternity', 120, 0.7],
  ['peds', 'Pediatrics', 30, 0.5]
];

const FACILITY_ROWS = [
  ['sag', 'Sarema General', 'public', 29, 27, 'lab xray mri cardio dialysis ortho mater peds physio', 60, 51, 17, 0.95, 0.78, 900],
  ['ntg', 'Northgate Teaching', 'public', 88, 18, 'lab xray mri cardio ortho mater peds physio onco', 70, 44, 73, 1, 0.86, 1200],
  ['krh', 'Kestrel Regional', 'public', 66, 58, 'lab xray mri cardio dialysis ortho mater peds', 50, 21, 42, 0.95, 0.74, 600],
  ['bfh', 'Bramble Ford HC', 'public', 52, 42, 'lab xray peds mater physio', 24, 9, 17, 0.9, 0.66, 140],
  ['aru', 'Almond Row Unit', 'public', 12, 16, 'lab peds mater', 14, 6, 15, 0.9, 0.6, 40],
  ['fcc', 'Fenwick Clinic', 'public', 22, 56, 'lab xray physio peds', 18, 15, 6, 0.9, 0.63, 90],
  ['lcu', 'Linden Care Unit', 'public', 108, 46, 'dialysis lab cardio', 16, 7, 11, 1, 0.7, 70],
  ['pcu', 'Pebble Creek Unit', 'public', 102, 70, 'lab xray peds mater physio', 16, 5, 11, 0.9, 0.62, 50],
  ['tdu', 'Thistledown Unit', 'public', 52, 10, 'lab peds', 10, 3, 7, 0.9, 0.58, 20],
  ['hhv', 'Harbor Heart', 'contracted', 97, 27, 'cardio lab xray mri', 30, 14, 25, 1.5, 0.9, 300],
  ['shl', 'Saffron Labs', 'contracted', 82, 44, 'lab xray mri', 40, 22, 28, 1.35, 0.84, 400],
  ['wbr', 'Willow Rehab', 'contracted', 64, 29, 'physio ortho xray', 26, 10, 15, 1.4, 0.82, 160],
  ['srp', 'Sarema Renal', 'contracted', 38, 34, 'dialysis lab', 20, 9, 14, 1.55, 0.83, 120],
  ['tom', 'Tamarind Onco', 'contracted', 46, 63, 'onco mri lab xray', 24, 11, 20, 1.65, 0.88, 180],
  ['sgc', 'Sarema Grand', 'private', 39, 23, 'lab xray mri cardio ortho mater peds physio dialysis', 36, 15, 25, 2.4, 0.94, 250],
  ['mwc', 'Marigold Care', 'private', 14, 38, 'mater peds lab xray', 14, 5, 8, 2.2, 0.92, 30],
  ['kbh', 'Kestrel Bayview', 'private', 76, 64, 'cardio mri ortho onco lab xray mater', 30, 12, 21, 2.7, 0.95, 200],
  ['hiu', 'Harbor Imaging', 'private', 106, 15, 'mri xray lab', 22, 8, 12, 2.3, 0.9, 60]
];

const PLACES = [['Sarema', 34, 30], ['Oud Harbor', 92, 22], ['Kestrel', 70, 60], ['Almond Row', 12, 16], ['Marigold', 14, 38], ['Fenwick', 22, 56], ['Thistledown', 52, 10], ['Willow Bend', 64, 30], ['Bramble Ford', 52, 42], ['Saffron Hill', 82, 44], ['Linden', 108, 46], ['Quill', 110, 8], ['Pebble Creek', 102, 70], ['Cedar Nook', 32, 70], ['Tamarind', 48, 62]];

const NAMED_PATIENTS = [
  ['Ada', 3, 'cardio lab', 'routine', 'sag'],
  ['Priya', 4, 'mater lab', 'routine', ''],
  ['Mateo', 9, 'dialysis', 'soon', 'lcu'],
  ['Jonas', 6, 'peds xray', 'urgent', ''],
  ['Noor', 10, 'onco mri lab', 'soon', ''],
  ['Sam', 5, 'onco dialysis', 'soon', '']
];

const buildPatients = () => {
  const rng = createRng(7);
  const needSets = ['cardio lab', 'mater lab', 'dialysis', 'peds xray', 'onco mri lab'];
  const list = NAMED_PATIENTS.map((p, i) => [`P${String(i + 1).padStart(3, '0')}`, p[0], PLACES[p[1]][1], PLACES[p[1]][2], p[2], p[3], p[4]]);
  for (let i = NAMED_PATIENTS.length; i < 120; i++) {
    const place = PLACES[Math.floor(rng.next() * PLACES.length)];
    const needs = needSets[Math.floor(rng.next() * needSets.length)];
    const urgency = rng.next() < 0.15 ? 'urgent' : rng.next() < 0.4 ? 'soon' : 'routine';
    const x = Math.round((place[1] + rng.next() * 6 - 3) * 10) / 10;
    const y = Math.round((place[2] + rng.next() * 6 - 3) * 10) / 10;
    list.push([`P${String(i + 1).padStart(3, '0')}`, `Patient ${i + 1}`, x, y, needs, urgency, '']);
  }
  return list;
};

const STATION_ROWS = [
  ['rec', 'Reception', 1.6, 0.4],
  ['tri', 'Triage', 3, 0.6],
  ['rcd', 'Records', 4, 0.8],
  ['exm', 'GP exam', 9, 0.9],
  ['lab', 'Lab draw', 5, 0.5],
  ['img', 'Imaging', 12, 1],
  ['pha', 'Pharmacy', 3.5, 0.6],
  ['bil', 'Billing', 2.5, 0.5]
];

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

const STAFFING = {
  rec: [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1],
  tri: [2, 3, 3, 3, 2, 2, 1, 1, 2, 2, 1, 1],
  rcd: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  exm: [6, 8, 8, 8, 6, 5, 3, 4, 5, 5, 3, 2],
  lab: [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0],
  img: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  pha: [2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1],
  bil: [1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1]
};

const ARRIVALS = [42, 70, 75, 60, 45, 26, 10, 20, 30, 26, 16, 6];

const ROUTE_ROWS = [
  ['in', 'rec', 1],
  ['rec', 'tri', 0.7],
  ['rec', 'rcd', 0.3],
  ['tri', 'exm', 1],
  ['rcd', 'exm', 0.1],
  ['exm', 'lab', 0.3],
  ['exm', 'img', 0.1],
  ['exm', 'pha', 0.55],
  ['lab', 'pha', 0.2],
  ['pha', 'bil', 0.6],
  ['img', 'bil', 0.9]
];

const WEAK_ROWS = [
  ['w1', 'rec', 'Single queue for new + returning', 3, 5, 1, 2],
  ['w2', 'tri', 'Triage nurse covers ward round 10–11', 4, 4, 2, 3],
  ['w3', 'rcd', 'Paper files not found', 4, 4, 4, 4],
  ['w4', 'exm', 'Doctors start late after rounds', 4, 5, 2, 3],
  ['w5', 'lab', 'Analyser outage, no backup', 5, 2, 5, 3],
  ['w6', 'img', 'One radiographer, no cover', 5, 3, 3, 2],
  ['w7', 'pha', 'Stock-outs discovered at counter', 3, 4, 4, 4],
  ['w8', 'bil', 'Card terminal drops internet', 3, 4, 5, 3]
];

const FIX_ROWS = [
  ['f1', 'Split fast-lane for returning patients', 1, 2],
  ['f2', 'Float nurse 9–12 for triage', 2, 18],
  ['f3', 'Digitise active records', 3, 40],
  ['f4', 'Stagger ward rounds, protect clinic start', 1, 0],
  ['f5', 'Backup analyser contract', 2, 25],
  ['f6', 'Cross-train a 2nd radiographer', 2, 6],
  ['f7', 'Daily stock dashboard', 1, 3],
  ['f8', '4G failover router + cash fallback', 1, 1]
];

const EFFECT_ROWS = [
  ['f1', 'staff', 'rec', '', 1, 8, 14],
  ['f1', 'risk', 'w1', 'F', -2, '', ''],
  ['f2', 'staff', 'tri', '', 1, 8, 14],
  ['f2', 'risk', 'w2', 'F', -3, '', ''],
  ['f3', 'risk', 'w3', 'F', -3, '', ''],
  ['f3', 'risk', 'w3', 'D', -2, '', ''],
  ['f4', 'staff', 'exm', '', 1, 8, 14],
  ['f4', 'risk', 'w4', 'F', -3, '', ''],
  ['f5', 'risk', 'w5', 'I', -3, '', ''],
  ['f6', 'staff', 'img', '', 1, 8, 14],
  ['f6', 'risk', 'w6', 'I', -2, '', ''],
  ['f6', 'risk', 'w6', 'F', -1, '', ''],
  ['f7', 'risk', 'w7', 'P', -3, '', ''],
  ['f7', 'risk', 'w7', 'D', -2, '', ''],
  ['f8', 'risk', 'w8', 'I', -2, '', ''],
  ['f8', 'risk', 'w8', 'P', -1, '', '']
];

export const TABLE_ORDER = ['facilities', 'services', 'patients', 'travel', 'stations', 'staffing', 'arrivals', 'routes', 'weak_points', 'fixes', 'fix_effects'];

const FIX_NEEDS_BY_ID = { f1: 'space', f2: 'staff budget', f3: 'budget approval' };

const FIX_ALTERNATIVE_BY_ID = { f3: 'f1' };

const WEAK_CATEGORY_BY_ID = { w1: 'bottleneck', w2: 'oversight', w3: 'information' };

export const buildSampleTables = () => ({
  facilities: rows(['id', 'name', 'tier', 'x', 'y', 'services', 'capacity_per_day', 'referrals_per_day', 'waitlist', 'price_multiplier', 'quality', 'reviews'], FACILITY_ROWS.map(f => [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9], f[10], f[11]])),
  services: rows(['id', 'name', 'base_price', 'complexity'], SERVICE_ROWS),
  patients: rows(['id', 'name', 'x', 'y', 'needs', 'urgency', 'previous_site'], buildPatients()),
  travel: [],
  stations: rows(['id', 'name', 'service_min', 'service_cv2'], STATION_ROWS),
  staffing: rows(['station_id', 'hour', 'servers'], STATION_ROWS.flatMap(st => HOURS.map((h, i) => [st[0], h, STAFFING[st[0]][i]]))),
  arrivals: rows(['hour', 'arrivals', 'arrival_cv2'], HOURS.map((h, i) => [h, ARRIVALS[i], 1])),
  routes: rows(['from', 'to', 'share'], ROUTE_ROWS),
  weak_points: rows(['id', 'station_id', 'title', 'impact', 'frequency', 'unpredictability', 'detectability', 'category'], WEAK_ROWS.map(r => r.concat(WEAK_CATEGORY_BY_ID[r[0]] || ''))),
  fixes: rows(['id', 'title', 'effort', 'cost_k', 'needs', 'alternative_to'], FIX_ROWS.map(r => r.concat(FIX_NEEDS_BY_ID[r[0]] || '', FIX_ALTERNATIVE_BY_ID[r[0]] || ''))),
  fix_effects: rows(['fix_id', 'kind', 'target', 'field', 'delta', 'from_hour', 'to_hour'], EFFECT_ROWS)
});

export const SAMPLE_MAP = Object.freeze({
  places: PLACES.map((p, i) => ({ name: p[0], x: p[1], y: p[2], major: i < 3 })),
  roads: [[3, 4], [3, 0], [4, 0], [4, 5], [5, 0], [0, 6], [0, 8], [6, 7], [7, 1], [7, 8], [8, 9], [8, 14], [9, 2], [9, 10], [9, 1], [1, 11], [10, 12], [2, 12], [2, 14], [5, 13], [13, 14]]
});
