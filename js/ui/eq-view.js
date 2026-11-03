import { h, CopyButton } from './components.js';
import { download, issueNotes } from './panels.js';
import { equationBlocks, exportBlock, exportAll, STAGES } from './explain.js';
import { paramsJson } from '../data/export.js';
import { curveCard } from './curves.js';
import { timeScore, costScore, loadScore, shrinkQuality } from '../core/score.js';
import { percentile } from '../core/stats.js';
import { ROUTE_WEIGHT_KEYS } from '../core/params.js';

const FORMATS = [['txt', 'Text'], ['tex', 'LaTeX'], ['md', 'Markdown']];

export const createEqView = ctx => {
  const root = h('section', { class: 'view', id: 'v-eq', 'aria-label': 'Equations' });
  const bundle = h('div', { class: 'toolbar', style: { margin: 0 } },
    h('button', { type: 'button', class: 'btn primary', text: 'Download .md', onClick: () => download('waymark-equations.md', exportAll('md', ctx.params()), 'text/markdown') }),
    h('button', { type: 'button', class: 'btn', text: 'Download .tex', onClick: () => download('waymark-equations.tex', exportAll('tex', ctx.params()), 'application/x-tex') }),
    h('button', { type: 'button', class: 'btn', text: 'Download params.json', onClick: () => download('params.json', paramsJson(ctx.params()), 'application/json') }));
  const allCopy = FORMATS.map(([format, label]) => CopyButton({ label: `Copy all · ${label}`, getText: () => exportAll(format, ctx.params()) }).el);
  const head = h('div', { class: 'viewhead' }, h('h2', { text: 'Equations' }), bundle);
  const copyRow = h('div', { class: 'eq-actions' }, ...allCopy);
  const host = h('div');
  root.append(head, h('p', { class: 'note', text: 'Every value below comes from the same parameter registry the engine uses.' }), copyRow, host);

  const paint = () => {
    const params = ctx.params();
    const formula = ctx.explainMode() === 'formula';
    host.replaceChildren(...issueNotes(params), ...equationBlocks(params).map(block => {
      const stage = STAGES.find(s => s.id === block.stage);
      const el = h('article', { class: 'eqblock', id: `eq-${block.id}`, 'data-stage': block.stage, style: { '--c': `var(--${stage.color})` }, 'aria-labelledby': `eq-${block.id}-t` },
        h('h4', { id: `eq-${block.id}-t` }, block.title, h('span', { text: `Stage ${stage.id} · ${stage.name}` })));
      if (!formula) {
        el.append(h('ul', { class: 'sentences' }, block.plain.map(s => h('li', { text: s }))));
      } else {
        el.append(h('pre', { class: 'formula', text: block.formula.join('\n') }),
          h('div', { class: 'legendT' }, block.legend.map(([symbol, meaning]) => h('span', {}, h('b', { text: symbol }), ` ${meaning}`))));
      }
      el.append(h('div', { class: 'eq-actions' }, FORMATS.map(([format, label]) => CopyButton({ label, getText: () => exportBlock(block, format, ctx.params()) }).el)));
      return el;
    }));
    const anchor = host.querySelector('#eq-subscores');
    const curves = curvesBlock(params);
    if (anchor) anchor.after(curves); else host.append(curves);
  };

  const curvesBlock = params => {
    const compiled = ctx.manager.compiled();
    const multipliers = compiled.routing.ready ? compiled.routing.data.facilities.map(f => f.multiplier).filter(Number.isFinite) : [];
    const low = multipliers.length ? percentile(multipliers, params.costLow) : 0.8;
    const high = multipliers.length ? percentile(multipliers, params.costHigh) : 1.2;
    const span = Math.max(0.2, high - low);
    const wsum = ROUTE_WEIGHT_KEYS.reduce((a, k) => a + params[k], 0);
    const share = key => (wsum > 0 ? params[key] / wsum : 1 / ROUTE_WEIGHT_KEYS.length);
    const maxDays = Math.max(30, 4 * Math.max(params.tauRoutine, params.tauSoon, params.tauUrgent));
    return h('article', { class: 'eqblock', id: 'eq-curves', style: { '--c': 'var(--sky)' }, 'aria-labelledby': 'eq-curves-t' },
      h('h4', { id: 'eq-curves-t' }, 'Try another value', h('span', { text: 'sub-score curves' })),
      h('p', { class: 'note', text: 'Drag a slider to see how each sub-score responds. The curves use your current parameters and data.' }),
      h('div', { class: 'curve-grid' },
        curveCard({ title: 'Time score', xLabel: 'days to care', from: 0, to: maxDays, step: 0.5, value: Math.min(7, maxDays), format: v => `${v} d`, weight: share('wT'),
          lines: [{ name: 'routine', color: 'var(--lagoon)', fn: x => timeScore(x, params.tauRoutine) }, { name: 'soon', color: 'var(--saffron)', fn: x => timeScore(x, params.tauSoon) }, { name: 'urgent', color: 'var(--persimmon)', fn: x => timeScore(x, params.tauUrgent) }] }),
        curveCard({ title: 'Cost score', xLabel: 'price multiplier', from: Math.max(0, low - span / 2), to: high + span / 2, step: 0.01, value: (low + high) / 2, format: v => `×${v.toFixed(2)}`, weight: share('wC'),
          lines: [{ name: 'cost', color: 'var(--saffron)', fn: x => costScore(x, low, high) }] }),
        curveCard({ title: 'Load score', xLabel: 'booked share', from: 0, to: 1.5, step: 0.01, value: 0.6, format: v => `${Math.round(v * 100)}%`, weight: share('wL'),
          lines: [{ name: 'load', color: 'var(--sky)', fn: x => loadScore(x) }] }),
        curveCard({ title: 'Quality score', xLabel: 'reviews', from: 0, to: 500, step: 5, value: 50, format: v => String(Math.round(v)), weight: share('wQ'),
          lines: [{ name: 'shrunk 0.9 rating', color: 'var(--iris)', fn: x => shrinkQuality(x, 0.9, params.shrinkK, 0.7) }] })));
  };

  const focus = opts => {
    if (!opts || !opts.stage) return;
    const target = root.querySelector(`[data-stage="${opts.stage}"]`);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  };

  return { el: root, update: paint, focus };
};
