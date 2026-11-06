import { csvText } from './export.js';

export const LEDGER_KEY = 'waymark.ledger.v1';
export const LEDGER_MAX = 5000;

export const loadLedger = storage => {
  try {
    const raw = storage.getItem(LEDGER_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(item => item && typeof item === 'object' && typeof item.id === 'string').slice(0, LEDGER_MAX) : [];
  } catch (e) {
    return [];
  }
};

export const saveLedger = (storage, items) => {
  try {
    storage.setItem(LEDGER_KEY, JSON.stringify(items.slice(0, LEDGER_MAX)));
    return true;
  } catch (e) {
    return false;
  }
};

export const addEntry = (items, entry) => {
  if (items.some(item => item.id === entry.id)) return { items, added: false };
  return { items: [entry, ...items].slice(0, LEDGER_MAX), added: true };
};

const HEADER = ['run_id', 'time', 'engine', 'patient_id', 'patient_name', 'needs', 'urgency', 'preset', 'plan', 'score', 'km', 'ttc_days', 'cost', 'confidence', 'override'];

export const ledgerCsv = items => csvText([HEADER, ...items.map(e => [
  e.id, e.t, e.engine, e.patientId, e.patientName || '', (e.needs || []).join(' '), e.urgency, e.preset, (e.plan || []).join(' + '),
  e.score, e.km, e.ttc, e.cost, e.confidence, e.override || ''
])], { bom: true });

export const ledgerJson = items => JSON.stringify(items, null, 2);

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

const finite = value => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : 0);

export const sanitiseEntry = entry => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const id = text(entry.id).trim();
  const when = text(entry.t);
  if (!id || Number.isNaN(Date.parse(when))) return null;
  const clean = {
    id,
    t: new Date(when).toISOString(),
    engine: text(entry.engine),
    patientId: text(entry.patientId),
    needs: Array.isArray(entry.needs) ? entry.needs.filter(n => typeof n === 'string') : [],
    urgency: text(entry.urgency),
    preset: text(entry.preset),
    plan: Array.isArray(entry.plan) ? entry.plan.filter(n => typeof n === 'string') : [],
    score: finite(entry.score),
    km: finite(entry.km),
    ttc: finite(entry.ttc),
    cost: finite(entry.cost),
    confidence: text(entry.confidence)
  };
  if (typeof entry.patientName === 'string') clean.patientName = entry.patientName;
  return clean;
};

const byNewest = (a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0);

export const normaliseLedger = list => {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach(raw => {
    const entry = sanitiseEntry(raw);
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  });
  return out.sort(byNewest).slice(0, LEDGER_MAX);
};

export const parseLedgerJson = source => {
  let data;
  try { data = JSON.parse(source); } catch (e) { return { items: [], skipped: 0, error: 'That file is not valid JSON.' }; }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.entries) ? data.entries : null;
  if (!list) return { items: [], skipped: 0, error: 'That file does not look like a Waymark ledger export.' };
  const items = normaliseLedger(list);
  return { items, skipped: list.length - items.length, error: '' };
};

export const mergeLedgers = (existing, incoming) => {
  const known = new Set(existing.map(e => e.id));
  const fresh = incoming.filter(e => !known.has(e.id));
  const items = existing.concat(fresh).sort(byNewest).slice(0, LEDGER_MAX);
  return { items, added: fresh.length, duplicates: incoming.length - fresh.length };
};
