import { buildSampleTables } from './samples.js';
import { TABLE_NAMES } from './schema.js';
import { validateTables } from './validate.js';

const DB_NAME = 'waymark';
const STORE = 'datasets';
const KEY = 'active';
const UNDO_LIMIT = 50;

export const createMemoryBackend = () => {
  const map = new Map();
  return {
    persistent: false,
    get: async key => (map.has(key) ? JSON.parse(map.get(key)) : null),
    set: async (key, value) => { map.set(key, JSON.stringify(value)); },
    remove: async key => { map.delete(key); }
  };
};

export const createIndexedDbBackend = () => {
  let opened = null;
  const open = () => {
    if (opened) return opened;
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
    return opened;
  };
  const run = (mode, action) => open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
  return {
    persistent: true,
    get: key => run('readonly', store => store.get(key)).then(v => (v === undefined ? null : v)),
    set: (key, value) => run('readwrite', store => store.put(value, key)),
    remove: key => run('readwrite', store => store.delete(key))
  };
};

const sourcesOf = kind => Object.fromEntries(TABLE_NAMES.map(name => [name, kind]));

const blankTables = () => Object.fromEntries(TABLE_NAMES.map(name => [name, []]));

export const createManager = ({ backend, getParams }) => {
  const listeners = new Set();
  let state = { tables: buildSampleTables(), sources: sourcesOf('sample'), files: {} };
  let rejection = null;
  let undoStack = [];
  let redoStack = [];
  let version = 0;
  let cache = null;
  let persisted = !!(backend && backend.persistent);
  let storageNote = '';
  const drafts = {};

  const emit = () => listeners.forEach(fn => fn(api));

  const compileKey = () => {
    const p = getParams();
    return `${version}|${p.defaultComplexity}|${p.defaultServiceCv2}|${p.defaultArrivalCv2}`;
  };

  const persist = async () => {
    if (!backend) return;
    try {
      await backend.set(KEY, { version: 3, tables: state.tables, sources: state.sources, files: state.files });
      if (backend.persistent) persisted = true;
    } catch (e) {
      persisted = false;
      storageNote = 'Not saved in this browser.';
      emit();
    }
  };

  const commit = next => {
    undoStack.push(state);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    state = next;
    version += 1;
    persist();
    emit();
  };

  const api = {
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    init: async () => {
      if (!backend) return;
      try {
        const saved = await backend.get(KEY);
        if (saved && saved.tables && saved.version === 3) {
          const tables = { ...blankTables(), ...saved.tables };
          const result = validateTables(tables, getParams());
          if (result.ok) {
            state = { tables, sources: { ...sourcesOf('yours'), ...saved.sources }, files: saved.files || {} };
            version += 1;
          }
        }
        persisted = !!backend.persistent;
      } catch (e) {
        persisted = false;
        storageNote = 'Not saved in this browser.';
      }
      emit();
    },
    tables: () => state.tables,
    records: name => state.tables[name] || [],
    sources: () => state.sources,
    files: () => state.files,
    rejection: () => rejection,
    setRejection: info => { rejection = info; emit(); },
    version: () => version,
    compiled: () => {
      const key = compileKey();
      if (!cache || cache.key !== key) cache = { key, result: validateTables(state.tables, getParams()) };
      return cache.result;
    },
    validateCandidate: patch => validateTables({ ...state.tables, ...patch }, getParams()),
    apply: (patch, source = 'yours', fileName = '') => {
      const candidate = { ...state.tables, ...patch };
      const result = validateTables(candidate, getParams());
      if (!result.ok) return { ok: false, result, issues: result.errors };
      const sources = { ...state.sources };
      const files = { ...state.files };
      Object.keys(patch).forEach(name => {
        sources[name] = source;
        if (fileName) files[name] = fileName;
        else delete files[name];
      });
      commit({ tables: candidate, sources, files });
      rejection = null;
      Object.keys(patch).forEach(name => { delete drafts[name]; });
      return { ok: true, result };
    },
    startFromSample: () => {
      commit({ tables: buildSampleTables(), sources: sourcesOf('yours'), files: {} });
      Object.keys(drafts).forEach(k => delete drafts[k]);
    },
    startBlank: () => {
      commit({ tables: blankTables(), sources: sourcesOf('yours'), files: {} });
      Object.keys(drafts).forEach(k => delete drafts[k]);
    },
    resetToSample: () => {
      commit({ tables: buildSampleTables(), sources: sourcesOf('sample'), files: {} });
      Object.keys(drafts).forEach(k => delete drafts[k]);
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => {
      if (!undoStack.length) return false;
      redoStack.push(state);
      state = undoStack.pop();
      version += 1;
      persist();
      emit();
      return true;
    },
    redo: () => {
      if (!redoStack.length) return false;
      undoStack.push(state);
      state = redoStack.pop();
      version += 1;
      persist();
      emit();
      return true;
    },
    setDraft: (name, records) => {
      const result = validateTables({ ...state.tables, [name]: records }, getParams());
      drafts[name] = { records, result };
      emit();
      return result;
    },
    draft: name => drafts[name] || null,
    clearDraft: name => {
      delete drafts[name];
      emit();
    },
    status: name => {
      const rows = (state.tables[name] || []).length;
      const draft = drafts[name];
      if (draft) {
        const mine = draft.result.issues.filter(i => i.table === name && i.severity === 'error').length;
        if (mine > 0) return { kind: 'invalid', rows: draft.records.length, issues: mine, warnings: 0 };
      }
      const compiled = api.compiled();
      return { kind: state.sources[name] === 'sample' ? 'sample' : 'yours', rows, issues: 0, warnings: compiled.byTable[name].warnings };
    },
    persisted: () => persisted,
    storageNote: () => storageNote,
    clearStorage: async () => { if (backend) await backend.remove(KEY); }
  };
  return api;
};
