import { h, svgEl, Slider } from './components.js';

const W = 220;
const H = 90;
const PAD = 6;

export const curvePoints = (fn, from, to, count = 60) => {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const x = from + ((to - from) * i) / count;
    pts.push({ x, y: Math.max(0, Math.min(1, fn(x))) });
  }
  return pts;
};

const pathOf = (pts, from, to) => pts.map((p, i) => {
  const px = PAD + ((p.x - from) / (to - from || 1)) * (W - PAD * 2);
  const py = H - PAD - p.y * (H - PAD * 2);
  return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
}).join(' ');

export const curveCard = ({ title, xLabel, from, to, step, value, lines, format, weight = null }) => {
  const paths = lines.map(line => svgEl('path', { d: pathOf(curvePoints(line.fn, from, to), from, to), fill: 'none', stroke: line.color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const dots = lines.map(line => svgEl('circle', { r: 4, fill: line.color, stroke: 'var(--card)', 'stroke-width': 2 }));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve-svg', role: 'img', 'aria-label': `${title}: ${lines.map(l => l.name).join(', ')}` },
    svgEl('line', { x1: PAD, y1: H - PAD, x2: W - PAD, y2: H - PAD, stroke: 'var(--line2)' }), ...paths, ...dots);
  const readout = h('output', { class: 'curve-out', 'aria-live': 'polite' });
  const paint = x => {
    lines.forEach((line, i) => {
      const y = Math.max(0, Math.min(1, line.fn(x)));
      dots[i].setAttribute('cx', (PAD + ((x - from) / (to - from || 1)) * (W - PAD * 2)).toFixed(1));
      dots[i].setAttribute('cy', (H - PAD - y * (H - PAD * 2)).toFixed(1));
    });
    const earned = weight === null ? '' : ` · earns ${(100 * weight * Math.max(0, Math.min(1, lines[0].fn(x)))).toFixed(1)} of ${(100 * weight).toFixed(1)} points`;
    readout.textContent = `${xLabel} ${format ? format(x) : x}: ${lines.map(line => `${line.name} ${Math.max(0, Math.min(1, line.fn(x))).toFixed(2)}`).join(' · ')}${earned}`;
  };
  const slider = Slider({ min: from, max: to, step, value, label: `Try a value for ${xLabel}`, format, onInput: paint, onChange: paint });
  paint(value);
  return h('div', { class: 'curve-card' }, h('h5', { text: title }), svg, slider.el, readout);
};
