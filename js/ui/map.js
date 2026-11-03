import { svgEl, h } from './components.js';
import { SAMPLE_MAP } from '../data/samples.js';
import { EARTH_RADIUS_KM } from '../core/stats.js';

const W = 880;
const H = 600;

const LABEL_H = 12;

export const labelCandidates = (c, r, width) => {
  const gap = 4;
  return [
    { x: c.x, y: c.y + r + gap + LABEL_H, anchor: 'middle', box: { x: c.x - width / 2, y: c.y + r + gap, w: width, h: LABEL_H } },
    { x: c.x, y: c.y - r - gap, anchor: 'middle', box: { x: c.x - width / 2, y: c.y - r - gap - LABEL_H, w: width, h: LABEL_H } },
    { x: c.x + r + gap, y: c.y + 4, anchor: 'start', box: { x: c.x + r + gap, y: c.y - LABEL_H / 2, w: width, h: LABEL_H } },
    { x: c.x - r - gap, y: c.y + 4, anchor: 'end', box: { x: c.x - r - gap - width, y: c.y - LABEL_H / 2, w: width, h: LABEL_H } },
    { x: c.x + r, y: c.y + r + gap + LABEL_H, anchor: 'start', box: { x: c.x + r, y: c.y + r + gap, w: width, h: LABEL_H } },
    { x: c.x - r, y: c.y + r + gap + LABEL_H, anchor: 'end', box: { x: c.x - r - width, y: c.y + r + gap, w: width, h: LABEL_H } },
    { x: c.x + r, y: c.y - r - gap, anchor: 'start', box: { x: c.x + r, y: c.y - r - gap - LABEL_H, w: width, h: LABEL_H } },
    { x: c.x - r, y: c.y - r - gap, anchor: 'end', box: { x: c.x - r - width, y: c.y - r - gap - LABEL_H, w: width, h: LABEL_H } }
  ];
};

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const placeLabels = (items, bounds) => {
  const nodes = items.map(item => ({ x: item.c.x - item.r - 4, y: item.c.y - item.r - 4, w: (item.r + 4) * 2, h: (item.r + 4) * 2 }));
  const placed = [];
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => (b.item.on - a.item.on) || (a.index - b.index));
  const out = new Array(items.length);
  ordered.forEach(({ item, index }) => {
    const width = Math.max(24, String(item.f.name).length * 6.4);
    const options = labelCandidates(item.c, item.r, width);
    const free = options.find(option => {
      const box = option.box;
      if (box.x < 0 || box.y < 0 || box.x + box.w > bounds.w || box.y + box.h > bounds.h) return false;
      if (nodes.some((node, ni) => ni !== index && overlaps(box, node))) return false;
      return !placed.some(other => overlaps(box, other));
    }) || options[0];
    placed.push(free.box);
    out[index] = { f: item.f, x: free.x, y: free.y, anchor: free.anchor };
  });
  return out;
};
const KM_PER_DEG = EARTH_RADIUS_KM * Math.PI / 180;
const TIER_COLOR = { public: 'var(--pub)', contracted: 'var(--con)', private: 'var(--pri)' };

const curve = (a, b, bend) => {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${(mx - dy * bend).toFixed(1)} ${(my + dx * bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

export const looksLikeSample = facilities => {
  if (facilities.length !== 18) return false;
  const known = new Map([['sag', [29, 27]], ['ntg', [88, 18]], ['krh', [66, 58]], ['hhv', [97, 27]], ['sgc', [39, 23]]]);
  return Array.from(known.entries()).every(([id, xy]) => {
    const f = facilities.find(x => x.id === id);
    return f && f.x === xy[0] && f.y === xy[1];
  });
};

const projection = ({ mode, decorative, points }) => {
  if (decorative) return { toPx: p => ({ x: 30 + p.x * 7, y: 30 + p.y * 7 }), fromPx: p => ({ x: (p.x - 30) / 7, y: (p.y - 30) / 7 }), pxPerKm: 7, toKm: p => p, fromKm: p => p };
  const valid = points.filter(p => Number.isFinite(p.a) && Number.isFinite(p.b));
  const lat0 = mode === 'geo' && valid.length ? valid.reduce((a, p) => a + p.a, 0) / valid.length : 0;
  const toKm = p => (mode === 'geo' ? { x: p.lon * KM_PER_DEG * Math.cos(lat0 * Math.PI / 180), y: -p.lat * KM_PER_DEG } : { x: p.x, y: p.y });
  const fromKm = k => (mode === 'geo' ? { lon: k.x / (KM_PER_DEG * Math.cos(lat0 * Math.PI / 180)), lat: -k.y / KM_PER_DEG } : { x: k.x, y: k.y });
  const ks = valid.map(p => (mode === 'geo' ? toKm({ lat: p.a, lon: p.b }) : toKm({ x: p.a, y: p.b })));
  const xs = ks.map(k => k.x);
  const ys = ks.map(k => k.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const pad = 70;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = (W - spanX * scale) / 2 - minX * scale;
  const oy = (H - spanY * scale) / 2 - minY * scale;
  return {
    toPx: k => ({ x: ox + k.x * scale, y: oy + k.y * scale }),
    fromPx: p => ({ x: (p.x - ox) / scale, y: (p.y - oy) / scale }),
    pxPerKm: scale,
    toKm,
    fromKm
  };
};

const staticLayer = () => {
  const px = p => ({ x: 30 + p.x * 7, y: 30 + p.y * 7 });
  const P = SAMPLE_MAP.places.map(p => px(p));
  const layer = svgEl('g', { class: 'decor', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  [['gA', '#6FA39C', 0.14], ['gB', '#C98A72', 0.12]].forEach(([id, color, opacity]) => {
    defs.append(svgEl('radialGradient', { id },
      svgEl('stop', { offset: '0', 'stop-color': color, 'stop-opacity': opacity }),
      svgEl('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' })));
  });
  layer.append(defs);
  [[34, 30, 190, 'gA', 1], [92, 22, 170, 'gB', 1], [70, 60, 160, 'gA', 0.8]].forEach(([x, y, r, g, o]) => {
    const c = px({ x, y });
    layer.append(svgEl('circle', { cx: c.x, cy: c.y, r, fill: `url(#${g})`, opacity: o }));
  });
  layer.append(svgEl('path', { class: 'river', d: 'M-30 170C150 100 250 270 430 240S650 390 720 340 860 440 940 400' }));
  SAMPLE_MAP.roads.forEach(([a, b], i) => layer.append(svgEl('path', { class: 'road', d: curve(P[a], P[b], (i % 2 ? 1 : -1) * 0.07) })));
  SAMPLE_MAP.places.forEach((place, i) => {
    if (place.major) {
      layer.append(svgEl('text', { class: 'wm', x: P[i].x, y: P[i].y + 42, text: place.name }), svgEl('circle', { class: 'sdot', cx: P[i].x, cy: P[i].y, r: 4 }));
    } else {
      layer.append(svgEl('circle', { class: 'sdot', cx: P[i].x, cy: P[i].y, r: 2.4 }), svgEl('text', { class: 'stl', x: P[i].x, y: P[i].y + 30, text: place.name }));
    }
  });
  return layer;
};

export const createMap = ({ onPatientMove, onFacilityToggle, onFacilityFocus, hint }) => {
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Region map' });
  const legend = h('div', { class: 'legend' },
    ['public', 'contracted', 'private'].map(tier => h('span', {}, h('i', { style: { '--c': TIER_COLOR[tier] } }), tier[0].toUpperCase() + tier.slice(1))));
  const hintEl = h('div', { class: 'hint', text: hint || '' });
  const el = h('div', { class: 'map' }, legend, svg, hintEl);
  let decor = null;
  let proj = null;
  let dragging = false;
  let frame = 0;

  const svgPoint = e => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  const moveTo = e => {
    if (!proj || !onPatientMove) return;
    const km = proj.fromPx(svgPoint(e));
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onPatientMove(proj.fromKm(km));
    });
  };
  svg.addEventListener('pointerdown', e => {
    if (!onPatientMove || e.target.closest('.fnode')) return;
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    moveTo(e);
  });
  svg.addEventListener('pointermove', e => { if (dragging) moveTo(e); });
  const release = () => { dragging = false; };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  const pool = new Map();

  const apply = (node, attrs) => {
    Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (k === 'text') { if (node.textContent !== String(v)) node.textContent = String(v); return; }
      if (v === null || v === undefined) node.removeAttribute(k);
      else if (node.getAttribute(k) !== String(v)) node.setAttribute(k, String(v));
    });
    return node;
  };

  const syncChildren = (parent, nodes) => {
    nodes.forEach((node, i) => {
      if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] || null);
    });
    while (parent.children.length > nodes.length) parent.removeChild(parent.lastElementChild);
  };

  const buildNode = id => {
    const parts = {
      hit: svgEl('circle', { fill: 'transparent', r: 22 }),
      sel: svgEl('circle', { class: 'selring' }),
      bg: svgEl('circle', { class: 'ring-bg' }),
      ring: svgEl('circle', { class: 'ring' }),
      body: svgEl('circle', { class: 'body' }),
      dot: svgEl('circle', {}),
      known: svgEl('circle', { r: 4, fill: 'var(--rose)', stroke: 'var(--card)', 'stroke-width': 2 })
    };
    const g = svgEl('g', { class: 'fnode', 'data-id': id, tabindex: '0', role: 'button' }, parts.hit, parts.sel, parts.bg, parts.ring, parts.body, parts.dot, parts.known);
    g.addEventListener('click', () => onFacilityToggle && onFacilityToggle(id));
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (onFacilityToggle) onFacilityToggle(id);
      }
    });
    g.addEventListener('focus', () => onFacilityFocus && onFacilityFocus(id));
    return { g, parts };
  };

  const buildMarker = () => {
    const parts = {
      halo1: svgEl('circle', { class: 'halo', r: 12 }),
      halo2: svgEl('circle', { class: 'halo h2', r: 12 }),
      core: svgEl('circle', { r: 9, fill: 'var(--persimmon-ink)', stroke: 'var(--card)', 'stroke-width': 3 })
    };
    const g = svgEl('g', { class: 'patient', tabindex: '0', role: 'slider', 'aria-label': 'Patient location, arrow keys move it' }, parts.halo1, parts.halo2, parts.core);
    g.addEventListener('keydown', e => {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d || !onPatientMove || !currentPatient) return;
      e.preventDefault();
      const k = proj.toKm(currentPatient);
      onPatientMove(proj.fromKm({ x: k.x + d[0], y: k.y + d[1] }));
    });
    return { g, parts };
  };

  let currentPatient = null;

  const keyed = (key, make) => {
    let item = pool.get(key);
    if (!item) {
      item = make();
      pool.set(key, item);
    }
    return item;
  };

  const render = view => {
    const decorative = !!view.decorative;
    const points = view.facilities.map(f => ({ a: view.mode === 'geo' ? f.lat : f.x, b: view.mode === 'geo' ? f.lon : f.y }));
    if (view.patient) points.push({ a: view.mode === 'geo' ? view.patient.lat : view.patient.x, b: view.mode === 'geo' ? view.patient.lon : view.patient.y });
    (view.patients || []).forEach(p => points.push({ a: view.mode === 'geo' ? p.lat : p.x, b: view.mode === 'geo' ? p.lon : p.y }));
    proj = projection({ mode: view.mode, decorative, points: points.map(p => (view.mode === 'geo' ? { a: p.a, b: p.b } : p)) });
    const pos = e => proj.toPx(proj.toKm(e));
    currentPatient = view.patient || null;
    const used = new Set();
    const order = [];
    const take = (key, make, attrs) => {
      const item = keyed(key, make);
      used.add(key);
      if (attrs) apply(item.el || item.g, attrs);
      order.push(item.el || item.g);
      return item;
    };
    const plain = (key, tag) => take(key, () => ({ el: svgEl(tag, {}) }), null);
    if (decorative) {
      decor = decor || staticLayer();
      used.add('decor');
      order.push(decor);
    }
    const best = new Set(view.best || []);
    if (view.patient && view.reachKm) {
      const me = pos(view.patient);
      apply(plain('reach', 'circle').el, { class: 'reach', cx: me.x, cy: me.y, r: view.reachKm / view.eta * proj.pxPerKm });
    }
    if (view.batch) {
      const maxCount = Math.max(1, ...Object.values(view.batch.counts));
      (view.patients || []).forEach((p, i) => {
        const c = pos(p);
        apply(plain(`pdot:${i}`, 'circle').el, { class: 'pdot', cx: c.x, cy: c.y, r: 2.2 });
      });
      view.facilities.forEach(f => {
        const info = view.batch.flows[f.id];
        if (!info || !info.count) return;
        const a = pos(info.centroid);
        const b = pos(f);
        const width = 1.5 + 9 * Math.sqrt(info.count / maxCount);
        apply(plain(`flow:${f.id}`, 'path').el, { class: 'edge flowline', d: curve(a, b, 0.1), 'stroke-width': width.toFixed(1) });
      });
    } else if (view.patient && view.stops) {
      const me = pos(view.patient);
      view.stops.forEach((id, i) => {
        const f = view.facilities.find(x => x.id === id);
        if (!f) return;
        const d = curve(me, pos(f), i % 2 ? 0.12 : -0.12);
        apply(plain(`glow:${i}`, 'path').el, { class: 'edge glow', d });
        apply(plain(`best:${i}`, 'path').el, { class: 'edge best', d });
      });
    }
    if (view.patient && view.requested && !view.batch) {
      const target = view.facilities.find(x => x.id === view.requested);
      if (target && !(view.stops || []).includes(target.id)) apply(plain('requested', 'path').el, { class: 'edge requested', d: curve(pos(view.patient), pos(target), 0.18) });
    }
    const pending = [];
    view.facilities.forEach(f => {
      const c = pos(f);
      const on = best.has(f.id);
      const r = on ? 15 : 12;
      const circumference = 2 * Math.PI * r;
      const load = Math.min(1, Math.max(0, f.load));
      const dim = view.dim && view.dim.has(f.id) && !on;
      const item = take(`node:${f.id}`, () => buildNode(f.id), {
        class: `fnode${dim ? ' dim' : ''}`,
        'aria-label': `${f.name}, ${f.tier}, ${Math.round(load * 100)}% booked${view.previous === f.id ? ', known here' : ''}`,
        'data-tip': f.tip || `${f.name} · ${f.tier} · ${Math.round(load * 100)}% booked${view.previous === f.id ? ' · known here' : ''}${f.note ? ` · ${f.note}` : ''}`
      });
      const parts = item.parts;
      apply(parts.hit, { cx: c.x, cy: c.y });
      apply(parts.sel, { cx: c.x, cy: c.y, r: r + 8, display: on ? null : 'none' });
      apply(parts.bg, { cx: c.x, cy: c.y, r });
      apply(parts.ring, { cx: c.x, cy: c.y, r, stroke: TIER_COLOR[f.tier] || 'var(--mu)', 'stroke-dasharray': `${(circumference * load).toFixed(1)} ${circumference.toFixed(1)}`, transform: `rotate(-90 ${c.x} ${c.y})` });
      apply(parts.body, { cx: c.x, cy: c.y, r: r - 4 });
      apply(parts.dot, { cx: c.x, cy: c.y, r: on ? 5 : 3.5, fill: TIER_COLOR[f.tier] || 'var(--mu)' });
      apply(parts.known, { cx: c.x + r - 2, cy: c.y - r + 2, display: view.previous === f.id ? null : 'none' });
      if (!decorative || on) pending.push({ f, c, r, on });
    });
    placeLabels(pending, { w: W, h: H }).forEach(item => {
      apply(plain(`label:${item.f.id}`, 'text').el, { class: 'flabel', x: item.x, y: item.y, 'text-anchor': item.anchor, text: item.f.name });
    });
    if (view.patient) {
      const me = pos(view.patient);
      const marker = take('patient', buildMarker, { 'aria-valuetext': view.patientText || '' });
      ['halo1', 'halo2', 'core'].forEach(k => apply(marker.parts[k], { cx: me.x, cy: me.y }));
    }
    Array.from(pool.keys()).forEach(key => { if (!used.has(key)) pool.delete(key); });
    syncChildren(svg, order);
    legend.hidden = false;
    hintEl.textContent = view.hint === undefined ? hint || '' : view.hint;
    el.classList.toggle('real', !decorative);
  };
  return { el, render };
};
