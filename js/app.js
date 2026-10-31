import { loadSettings, saveSettings } from './data/migrate.js';
import { createManager, createIndexedDbBackend, createMemoryBackend } from './data/store.js';
import { sanitiseValue, BY_KEY } from './core/params.js';
import { initTooltips, h, Segmented } from './ui/components.js';
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
  const manager = createManager({ backend, getParams: () => settings.params });
  await manager.init();
  initTooltips();

  const persist = () => saveSettings(storage, settings);
  const views = {};
  const factories = { route: createRouteView, clinic: createClinicView, data: createDataView, eq: createEqView };
  const main = document.getElementById('main');
  const pipe = document.getElementById('pipe');
  let current = VIEWS.includes(settings.view) ? settings.view : 'route';
  let pipeValues = null;

  const paintPipe = () => {
    pipe.replaceChildren(...STAGES.map((stage, i) => {
      const button = h('button', { type: 'button', class: 'stage', role: 'listitem', style: { '--c': `var(--${stage.color})` }, 'data-tip': `Stage ${stage.id}: open its equation` },
        `${stage.id} ${stage.name}`, h('small', { text: pipeValues ? pipeValues[i] : stage.hint }));
      button.addEventListener('click', () => ctx.navigate('eq', { stage: stage.id }));
      return button;
    }));
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
      if (views[current]) views[current].update();
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

  manager.subscribe(() => {
    if (views[current]) views[current].update();
  });

  window.addEventListener('hashchange', () => show(window.location.hash.slice(1)));
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.shiftKey) manager.redo();
    else manager.undo();
  });

  paintPipe();
  const initial = window.location.hash.slice(1);
  show(VIEWS.includes(initial) ? initial : current);
  if (window.location.hash === '') history.replaceState(null, '', `#${current}`);
};

start();
