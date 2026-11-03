import { TABLES, TABLE_NAMES } from './schema.js';
import { defaultParams, paramsToJSON, paramsFromJSON, sanitiseValue, BY_KEY } from '../core/params.js';

export const SETTINGS_KEY = 'waymark.v3';
export const LEGACY_KEY = 'waymark.v2';

export const defaultSettings = () => ({
  version: 3,
  view: 'route',
  routeMode: 'single',
  clinicMode: 'single',
  explain: 'plain',
  theme: 'system',
  dataModel: 'route',
  dataLayout: 'cards',
  dataTable: 'facilities',
  patientId: '',
  ledgerNames: false,
  siteId: 'main',
  applied: {},
  resources: { space: true, budget: true, staff: true, approval: true },
  fixMarks: {},
  params: defaultParams()
});

const VIEWS = ['route', 'clinic', 'data', 'eq'];

export const THEMES = ['system', 'light', 'dark'];

const stringList = list => list.filter(id => typeof id === 'string');

export const hydrateApplied = (value, siteId) => {
  if (Array.isArray(value)) {
    const ids = stringList(value);
    return ids.length ? Object.fromEntries([[siteId || 'main', ids]]) : {};
  }
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value)
    .filter(([, list]) => Array.isArray(list))
    .map(([site, list]) => [site, stringList(list)])
    .filter(([, ids]) => ids.length);
  return Object.fromEntries(entries);
};

export const hydrateResources = value => {
  const out = { space: true, budget: true, staff: true, approval: true };
  if (value && typeof value === 'object') Object.keys(out).forEach(key => { if (typeof value[key] === 'boolean') out[key] = value[key]; });
  return out;
};

export const hydrateMarks = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sites = Object.entries(value)
    .filter(([, fixes]) => fixes && typeof fixes === 'object' && !Array.isArray(fixes))
    .map(([site, fixes]) => [site, Object.fromEntries(Object.entries(fixes).filter(([, mark]) => mark === 1 || mark === 2))])
    .filter(([, fixes]) => Object.keys(fixes).length);
  return Object.fromEntries(sites);
};

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
  next.applied = hydrateApplied(old.applied, 'main');
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
  if (THEMES.includes(stored.theme)) out.theme = stored.theme;
  if (['route', 'clinic'].includes(stored.dataModel)) out.dataModel = stored.dataModel;
  if (['cards', 'table'].includes(stored.dataLayout)) out.dataLayout = stored.dataLayout;
  out.dataTable = TABLE_NAMES.includes(stored.dataTable) ? stored.dataTable : TABLE_NAMES.find(name => TABLES[name].view === out.dataModel) || base.dataTable;
  if (typeof stored.patientId === 'string') out.patientId = stored.patientId;
  if (typeof stored.ledgerNames === 'boolean') out.ledgerNames = stored.ledgerNames;
  if (typeof stored.siteId === 'string') out.siteId = stored.siteId;
  out.applied = hydrateApplied(stored.applied, out.siteId);
  out.resources = hydrateResources(stored.resources);
  out.fixMarks = hydrateMarks(stored.fixMarks);
  if (stored.params) out.params = paramsFromJSON(stored.params);
  return out;
};

export const serialiseSettings = settings => JSON.stringify({ ...settings, params: paramsToJSON(settings.params) });

export const V2_THEME_KEY = 'meridian.theme';

const readOldTheme = storage => {
  try {
    const raw = storage.getItem(V2_THEME_KEY);
    if (raw === null || raw === undefined) return '';
    const value = raw === 'light' || raw === 'dark' ? raw : JSON.parse(raw);
    return value === 'light' || value === 'dark' ? value : '';
  } catch (e) {
    return '';
  }
};

export const loadSettings = storage => {
  if (!storage) return defaultSettings();
  const current = readJson(storage, SETTINGS_KEY);
  if (current) return hydrateSettings(current);
  const legacy = readJson(storage, LEGACY_KEY);
  const migrated = legacy ? migrateLegacy(legacy) : defaultSettings();
  let adopted = !!legacy;
  if (!legacy) {
    const theme = readOldTheme(storage);
    if (theme) {
      migrated.theme = theme;
      adopted = true;
    }
  }
  if (adopted) {
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
