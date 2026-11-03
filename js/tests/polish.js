import { createRng } from '../core/rng.js';
import { placeLabels, labelCandidates } from '../ui/map.js';
import { GLOSSARY } from '../ui/explain.js';
import { curvePoints } from '../ui/curves.js';
import { timeScore } from '../core/score.js';
import { createRouteView } from '../ui/route-view.js';
import { createEqView } from '../ui/eq-view.js';
import { makeContext } from './ui.js';

const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const register = t => {
  t.test('WP8 label placement keeps labels apart and off the nodes when there is room', () => {
    for (let i = 0; i < 100; i++) {
      const rng = createRng(t.seed * 17 + i);
      const count = rng.int(2, 7);
      const items = [];
      for (let k = 0; k < count; k++) {
        const c = { x: 80 + (k % 4) * 200 + rng.range(-20, 20), y: 100 + Math.floor(k / 4) * 220 + rng.range(-20, 20) };
        items.push({ f: { name: `Site ${k}` }, c, r: 12, on: k === 0 });
      }
      const placed = placeLabels(items, { w: 880, h: 600 });
      const boxes = placed.map((p, idx) => {
        const width = Math.max(24, String(items[idx].f.name).length * 6.4);
        return labelCandidates(items[idx].c, items[idx].r, width).find(o => o.x === p.x && o.y === p.y && o.anchor === p.anchor).box;
      });
      for (let a = 0; a < boxes.length; a++) {
        t.ok(boxes[a].x >= 0 && boxes[a].y >= 0 && boxes[a].x + boxes[a].w <= 880 && boxes[a].y + boxes[a].h <= 600, 'inside the map');
        for (let b = a + 1; b < boxes.length; b++) t.ok(!hits(boxes[a], boxes[b]), 'labels do not overlap');
      }
    }
  });

  t.test('WP8 a node in the corner gets a label that stays inside the map', () => {
    const items = [{ f: { name: 'Corner site' }, c: { x: 5, y: 5 }, r: 12, on: false }];
    const placed = placeLabels(items, { w: 880, h: 600 });
    const box = labelCandidates(items[0].c, 12, Math.max(24, 'Corner site'.length * 6.4)).find(o => o.x === placed[0].x && o.y === placed[0].y).box;
    t.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 880 && box.y + box.h <= 600);
  });

  t.test('WP8 the glossary covers every term and curves match the engine functions', () => {
    ['slot', 'reach', 'tier', 'load', 'price multiplier', 'split plan', 'gate', 'weight points', 'token', 'regret', 'patient-minutes'].forEach(k => t.ok(typeof GLOSSARY[k] === 'string' && GLOSSARY[k].length > 10, k));
    const pts = curvePoints(x => timeScore(x, 7), 0, 28, 28);
    t.same(pts.length, 29);
    pts.forEach(p => t.near(p.y, Math.pow(2, -p.x / 7), 1e-12));
  });

  t.test('WP8 the Single view shows rich hover cards and a worked equation in Formula mode', async () => {
    const ctx = makeContext();
    ctx.settings.routeMode = 'single';
    ctx.settings.explain = 'formula';
    const view = createRouteView(ctx);
    Object.assign(ctx.views, { route: view });
    document.body.append(view.el);
    try {
      view.update();
      const tips = Array.from(view.el.querySelectorAll('.fnode')).map(el => el.getAttribute('data-tip'));
      t.ok(tips.length > 2 && tips.every(tip => tip.includes('services') && tip.includes('% booked')), 'hover cards carry detail');
      t.ok(tips.some(tip => tip.includes('Ruled out') || tip.includes('score')), 'verdict present');
      const worked = Array.from(view.el.querySelectorAll('h3')).find(el => el.textContent.startsWith('Worked equation'));
      t.ok(worked, 'worked equation card');
      const text = worked.parentElement.querySelector('pre').textContent;
      t.ok(text.includes('Selected') && text.includes('S = 1 ×'), 'selected line');
      ctx.settings.explain = 'plain';
      view.update();
      t.ok(!Array.from(view.el.querySelectorAll('h3')).some(el => el.textContent.startsWith('Worked equation') && !el.parentElement.hidden), 'hidden in plain mode');
      t.ok(view.el.querySelector('abbr.term[data-tip]'), 'glossary terms');
    } finally {
      view.el.remove();
    }
  });

  t.test('WP8 the Equations tab has four try-it curves that report earned points', async () => {
    const ctx = makeContext();
    const view = createEqView(ctx);
    document.body.append(view.el);
    try {
      view.update();
      t.same(view.el.querySelectorAll('.curve-card').length, 4);
      t.ok(Array.from(view.el.querySelectorAll('.curve-out')).every(o => o.textContent.includes('earns')), 'earned points');
      t.ok(view.el.querySelector('#eq-subscores').nextElementSibling.id === 'eq-curves', 'placed after sub-scores');
    } finally {
      view.el.remove();
    }
  });
};
