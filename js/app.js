import { loadSettings, saveSettings } from './data/migrate.js';
import { applyTheme, watchSystemTheme } from './ui/theme.js';
import { shortcutFor, nextTheme } from './ui/shortcuts.js';
import { createManager, createIndexedDbBackend, createMemoryBackend } from './data/store.js';
import { sanitiseValue, BY_KEY } from './core/params.js';
import { initTooltips, h, Segmented, Toast } from './ui/components.js';
import { STAGES } from './ui/explain.js';
import { createRouteView } from './ui/route-view.js';
import { createClinicView } from './ui/clinic-view.js';
import { createDataView } from './ui/data-view.js';
import { createEqView } from './ui/eq-view.js';

const VIEWS = ['route', 'clinic', 'data', 'eq'];

const safeStorage = () => {
  try {
    const probe = '__wm_probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    return null;
  }
};

const start = async () => {
  const storage = safeStorage();
  const settings = loadSettings(storage);
  let backend;
  try { backend = createIndexedDbBackend(); } catch (e) { backend = createMemoryBackend(); }
  const manager = createManager({ backend, getParams: () => settings.params, ledgerStorage: storage });
  await manager.init();
  initTooltips();

  let saveTimer = null;
  const flushSave = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveSettings(storage, settings);
  };
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  };
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  const views = {};
  const factories = { route: createRouteView, clinic: createClinicView, data: createDataView, eq: createEqView };
  const main = document.getElementById('main');
  const pipe = document.getElementById('pipe');
  let current = VIEWS.includes(settings.view) ? settings.view : 'route';
  let pipeValues = null;
  let paintQueued = false;

  const stageButtons = STAGES.map(stage => {
    const small = h('small');
    const button = h('button', { type: 'button', class: 'stage', style: { '--c': `var(--${stage.color})` }, 'data-tip': `Stage ${stage.id}: open its equation` }, `${stage.id} ${stage.name}`, small);
    button.addEventListener('click', () => ctx.navigate('eq', { stage: stage.id }));
    return { button, small, stage };
  });
  pipe.replaceChildren(...stageButtons.map(item => item.button));

  const paintPipe = () => {
    stageButtons.forEach((item, i) => {
      const text = pipeValues ? pipeValues[i] : item.stage.hint;
      if (item.small.textContent !== text) item.small.textContent = text;
    });
  };

  const ctx = {
    settings,
    manager,
    params: () => settings.params,
    persist,
    focus: null,
    setParam: (key, value) => {
      settings.params[key] = sanitiseValue(BY_KEY[key], value);
      persist();
      ctx.changed();
    },
    setParams: patch => {
      Object.keys(patch).forEach(key => { settings.params[key] = sanitiseValue(BY_KEY[key], patch[key]); });
      persist();
      ctx.changed();
    },
    setPipe: values => {
      pipeValues = values;
      paintPipe();
    },
    navigate: (view, focus) => {
      ctx.focus = focus || null;
      if (window.location.hash !== `#${view}`) window.location.hash = `#${view}`;
      else show(view);
    },
    changed: () => {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(() => {
        paintQueued = false;
        if (views[current]) views[current].update();
      });
    },
    explainMode: () => settings.explain
  };

  const show = view => {
    if (!VIEWS.includes(view)) view = 'route';
    current = view;
    settings.view = view;
    persist();
    document.querySelectorAll('#tabs a').forEach(a => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    VIEWS.forEach(name => {
      if (views[name]) views[name].el.hidden = name !== view;
    });
    if (!views[view]) {
      views[view] = factories[view](ctx);
      main.append(views[view].el);
    }
    views[view].el.hidden = false;
    views[view].update();
    if (ctx.focus && views[view].focus) views[view].focus(ctx.focus);
    ctx.focus = null;
    window.scrollTo(0, 0);
  };

  const explainSwitch = Segmented({
    label: 'Explanation style',
    options: [{ value: 'plain', label: 'Plain' }, { value: 'formula', label: 'Formula' }],
    value: settings.explain,
    onChange: value => {
      settings.explain = value;
      persist();
      ctx.changed();
    }
  });
  document.getElementById('explain-switch').append(explainSwitch.el);
  const themeSwitch = Segmented({
    label: 'Colour theme',
    options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
    value: settings.theme,
    onChange: value => {
      settings.theme = value;
      applyTheme(value);
      persist();
    }
  });
  document.getElementById('theme-switch').append(themeSwitch.el);
  applyTheme(settings.theme);
  watchSystemTheme();

  manager.subscribe(() => ctx.changed());

  window.addEventListener('hashchange', () => show(window.location.hash.slice(1)));
  const toast = Toast();
  document.body.append(toast.el);
  const say = toast.show;
  ctx.toast = say;

  document.addEventListener('keydown', e => {
    const action = shortcutFor(e, VIEWS.length);
    if (!action) return;
    e.preventDefault();
    if (action.type === 'view') {
      window.location.hash = VIEWS[action.index];
    } else {
      settings.theme = nextTheme(settings.theme);
      applyTheme(settings.theme);
      themeSwitch.setValue(settings.theme);
      persist();
      say(`Theme: ${settings.theme}`);
    }
  });

  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey);
    const undo = key === 'z' && !e.shiftKey;
    if (!redo && !undo) return;
    if (current !== 'data') return;
    const target = e.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable], .dd, .rng')) return;
    e.preventDefault();
    const outcome = redo ? manager.redo() : manager.undo();
    if (outcome) say(`${redo ? 'Redid' : 'Undid'}: ${outcome.label || 'edit'}`);
    else say(redo ? 'Nothing to redo' : 'Nothing to undo');
  });

  paintPipe();
  const initial = window.location.hash.slice(1);
  show(VIEWS.includes(initial) ? initial : current);
  if (window.location.hash === '') history.replaceState(null, '', `#${current}`);
};

start();
