import { csvText } from './export.js';

export const LEDGER_KEY = 'waymark.ledger.v1';
export const LEDGER_MAX = 200;

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
