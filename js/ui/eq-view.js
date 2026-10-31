import { h, CopyButton } from './components.js';
import { download } from './panels.js';
import { equationBlocks, exportBlock, exportAll, STAGES } from './explain.js';
import { paramsJson } from '../data/export.js';

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
    host.replaceChildren(...equationBlocks(params).map(block => {
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
