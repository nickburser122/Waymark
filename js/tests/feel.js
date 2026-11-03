import { createMap } from '../ui/map.js';
import { keepState, h } from '../ui/components.js';
import { createRouteView } from '../ui/route-view.js';
import { createClinicView } from '../ui/clinic-view.js';
import { generatePatients } from '../data/synth.js';
import { makeContext, wait, waitFor } from './ui.js';

const mapView = (x, load = 0.4) => ({
  mode: 'xy', eta: 1, decorative: false, hint: '',
  facilities: [
    { id: 'a', name: 'Alpha', tier: 'public', x: 10, y: 10, load },
    { id: 'b', name: 'Beta', tier: 'private', x: 80, y: 60, load: 0.8 }
  ],
  patient: { x, y: 30 }, stops: ['a'], best: ['a'], reachKm: 40, patientText: 'at 10, 30'
});

export const register = t => {
  t.test('FEEL the map keeps its animated edge, pulse and site nodes across renders', () => {
    const map = createMap({ onFacilityToggle: () => {}, onPatientMove: () => {} });
    document.body.append(map.el);
    try {
      map.render(mapView(20));
      const grab = () => ({
        edge: map.el.querySelector('.edge.best'),
        halo: map.el.querySelector('.halo'),
        node: map.el.querySelector('.fnode[data-id="a"]'),
        marker: map.el.querySelector('.patient'),
        label: map.el.querySelector('.flabel')
      });
      const before = grab();
      map.render(mapView(35, 0.9));
      const after = grab();
      Object.keys(before).forEach(k => t.ok(before[k] && before[k] === after[k], `${k} is the same element`));
      t.ok(after.edge.getAttribute('d') !== null, 'edge path was updated in place');
      const ring = after.node.querySelector('.ring');
      t.ok(ring.getAttribute('stroke-dasharray').startsWith('84'), 'ring reflects the new load');
      after.node.focus();
      map.render(mapView(50, 0.2));
      t.same(document.activeElement, after.node, 'a focused site node keeps focus');
      const nodes = map.el.querySelectorAll('.fnode').length;
      map.render({ ...mapView(50), facilities: mapView(50).facilities.slice(0, 1) });
      t.same(map.el.querySelectorAll('.fnode').length, 1, 'removed sites leave the map');
      t.ok(nodes === 2);
      map.render(mapView(50));
      t.same(map.el.querySelectorAll('.fnode').length, 2, 'and come back');
    } finally {
      map.el.remove();
    }
  });

  t.test('FEEL keepState restores focus onto the equivalent control and keeps inner scroll', () => {
    const host = h('div', {}, h('div', { class: 'table-wrap' }, h('p', { text: 'long' })), h('button', { type: 'button', text: 'Save' }), h('button', { type: 'button', text: 'Delete' }));
    document.body.append(host);
    try {
      host.children[0].scrollTop = 40;
      const second = host.children[2];
      second.focus();
      keepState(host, () => {
        const scroll = h('div', { class: 'table-wrap' }, h('p', { text: 'long' }));
        host.replaceChildren(scroll, h('button', { type: 'button', text: 'Save' }), h('button', { type: 'button', text: 'Delete' }));
      });
      t.same(document.activeElement.textContent, 'Delete', 'focus returns to the same control');
      t.ok(document.activeElement !== second, 'it is the rebuilt node');
      t.same(host.children[0].scrollTop, 40, 'scroll position is restored');
      const outside = h('button', { type: 'button', text: 'Outside' });
      document.body.append(outside);
      outside.focus();
      keepState(host, () => host.replaceChildren());
      t.same(document.activeElement, outside, 'focus outside the view is left alone');
      outside.remove();
    } finally {
      host.remove();
    }
  });

  t.test('FEEL toggling a switch in the Single view keeps focus and the route animation', async () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'single';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      const edge = view.el.querySelector('.edge.best');
      const halo = view.el.querySelector('.halo');
      t.ok(edge && halo, 'animated elements exist');
      const toggle = Array.from(view.el.querySelectorAll('.chk')).find(el => el.textContent.includes('Explain this to the patient'));
      toggle.focus();
      toggle.click();
      await wait(30);
      t.same(document.activeElement.textContent, toggle.textContent, 'focus stays on the switch');
      t.ok(view.el.querySelector('.explain-box'), 'the note appeared');
      t.same(view.el.querySelector('.edge.best'), edge, 'the animated edge is the same element');
      t.same(view.el.querySelector('.halo'), halo, 'the pulse is the same element');
      ctx.settings.params.wT = 90;
      ctx.changed();
      view.update();
      t.same(view.el.querySelector('.halo'), halo, 'still the same after a weight change');
    } finally {
      view.el.remove();
    }
  });

  t.test('FEEL ticking a fix in the clinic view keeps focus on the row control', async () => {
    const ctx = makeContext();
    ctx.settings.clinicMode = 'single';
    const view = createClinicView(ctx);
    Object.assign(ctx.views, { clinic: view });
    document.body.append(view.el);
    try {
      view.update();
      const first = view.el.querySelector('.fixrow .chk');
      const label = first.textContent;
      first.focus();
      first.click();
      await wait(30);
      t.ok(document.activeElement && document.activeElement.classList.contains('chk'), 'focus is on a switch');
      t.same(document.activeElement.textContent, label, 'the same fix keeps focus');
    } finally {
      view.el.remove();
    }
  });

  t.test('FEEL a tooltip hides when its element is replaced and follows an in-place text change', async () => {
    const { initTooltips } = await import('../ui/components.js');
    initTooltips();
    const host = h('div', {}, h('button', { type: 'button', text: 'Hover me', 'data-tip': 'first text' }));
    document.body.append(host);
    try {
      const tip = document.getElementById('wm-tip');
      const button = host.firstChild;
      button.dispatchEvent(new window.Event('focusin', { bubbles: true }));
      await wait(380);
      t.ok(!tip.hidden && tip.textContent === 'first text', 'tip shown');
      button.setAttribute('data-tip', 'second text');
      await wait(260);
      t.same(tip.textContent, 'second text', 'tip follows the attribute');
      host.replaceChildren(h('button', { type: 'button', text: 'New', 'data-tip': 'first text' }));
      await wait(260);
      t.ok(tip.hidden, 'tip is hidden once its element is gone');
    } finally {
      host.remove();
    }
  });

  t.test('FEEL the long batch table does not redraw while the visible window is unchanged', async () => {
    const ctx = makeContext();
    const patients = generatePatients({ facilities: ctx.manager.records('facilities'), services: ctx.manager.records('services'), n: 260, seed: 3 });
    t.ok(ctx.manager.apply({ patients }).ok);
    ctx.settings.routeMode = 'batch';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      t.ok(await waitFor(() => view.el.querySelector('.results-wrap tr[data-id]'), 15000), 'rows drawn');
      const wrap = view.el.querySelector('.results-wrap');
      const first = wrap.querySelector('tr[data-id]');
      wrap.dispatchEvent(new window.Event('scroll'));
      await wait(60);
      t.same(wrap.querySelector('tr[data-id]'), first, 'rows untouched by a scroll that moves nothing');
      wrap.scrollTop = 40 * 40;
      wrap.dispatchEvent(new window.Event('scroll'));
      await wait(60);
      t.ok(wrap.querySelector('tr[data-id]') !== first, 'rows change once the window moves');
    } finally {
      view.el.remove();
    }
  });
};
