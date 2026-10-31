import { defaultParams, paramsToJSON, paramsFromJSON, sanitiseValue, BY_KEY } from '../core/params.js';

export const SETTINGS_KEY = 'waymark.v3';
export const LEGACY_KEY = 'waymark.v2';

export const defaultSettings = () => ({
  version: 3,
  view: 'route',
  routeMode: 'single',
  clinicMode: 'single',
  explain: 'plain',
  patientId: '',
  siteId: 'main',
  applied: [],
  params: defaultParams()
});

const VIEWS = ['route', 'clinic', 'data', 'eq'];

export const migrateLegacy = old => {
  const next = defaultSettings();
  if (!old || typeof old !== 'object') return next;
  if (VIEWS.includes(old.view)) next.view = old.view;
  const letters = { T: 'wT', C: 'wC', P: 'wP', L: 'wL', Q: 'wQ', K: 'wK' };
  if (old.rw && typeof old.rw === 'object') Object.keys(letters).forEach(k => {
    if (old.rw[k] !== undefined) next.params[letters[k]] = sanitiseValue(BY_KEY[letters[k]], old.rw[k]);
  });
  const fixLetters = { R: 'fwR', O: 'fwO', P: 'fwP', B: 'fwB' };
  if (old.fw && typeof old.fw === 'object') Object.keys(fixLetters).forEach(k => {
    if (old.fw[k] !== undefined) next.params[fixLetters[k]] = sanitiseValue(BY_KEY[fixLetters[k]], old.fw[k]);
  });
  if (old.season !== undefined) next.params.season = sanitiseValue(BY_KEY.season, old.season);
  if (Array.isArray(old.applied)) next.applied = old.applied.filter(id => typeof id === 'string');
  return next;
};

const readJson = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const hydrateSettings = stored => {
  const base = defaultSettings();
  if (!stored || typeof stored !== 'object') return base;
  const out = { ...base };
  if (VIEWS.includes(stored.view)) out.view = stored.view;
  if (['single', 'batch'].includes(stored.routeMode)) out.routeMode = stored.routeMode;
  if (['single', 'batch'].includes(stored.clinicMode)) out.clinicMode = stored.clinicMode;
  if (['plain', 'formula'].includes(stored.explain)) out.explain = stored.explain;
  if (typeof stored.patientId === 'string') out.patientId = stored.patientId;
  if (typeof stored.siteId === 'string') out.siteId = stored.siteId;
  if (Array.isArray(stored.applied)) out.applied = stored.applied.filter(id => typeof id === 'string');
  if (stored.params) out.params = paramsFromJSON(stored.params);
  return out;
};

export const serialiseSettings = settings => JSON.stringify({ ...settings, params: paramsToJSON(settings.params) });

export const loadSettings = storage => {
  if (!storage) return defaultSettings();
  const current = readJson(storage, SETTINGS_KEY);
  if (current) return hydrateSettings(current);
  const legacy = readJson(storage, LEGACY_KEY);
  const migrated = legacy ? migrateLegacy(legacy) : defaultSettings();
  if (legacy) {
    try { storage.setItem(SETTINGS_KEY, serialiseSettings(migrated)); } catch (e) { return migrated; }
  }
  return migrated;
};

export const saveSettings = (storage, settings) => {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, serialiseSettings(settings));
    return true;
  } catch (e) {
    return false;
  }
};
