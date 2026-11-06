import { readFile } from 'node:fs/promises';
import { serve, launch, watchErrors } from './browser.mjs';

const axeSource = await readFile(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const VIEWS = ['route', 'clinic', 'data', 'eq'];
const FAIL_ON = new Set(['serious', 'critical']);
const { server, url } = await serve();
const browser = await launch();
const found = new Map();
const problems = [];

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage();
  const errors = watchErrors(page);
  await page.setViewport({ width: 1366, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.evaluateOnNewDocument(t => { try { localStorage.setItem('waymark.v3', JSON.stringify({ theme: t })); } catch (e) { return; } }, theme);
  await page.goto(`${url}/index.html#route`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(axeSource);
  for (const view of VIEWS) {
    await page.evaluate(v => { window.location.hash = v; }, view);
    await new Promise(r => setTimeout(r, 1200));
    const result = await page.evaluate(async () => {
      const out = await window.axe.run(document, { resultTypes: ['violations'] });
      return out.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' ') })), count: v.nodes.length }));
    });
    result.forEach(v => {
      const key = `${v.id}|${v.impact}`;
      const entry = found.get(key) || { ...v, where: new Set(), samples: [] };
      entry.where.add(`${view}/${theme}`);
      if (entry.samples.length < 4) entry.samples.push(...v.nodes.slice(0, 2));
      found.set(key, entry);
      if (FAIL_ON.has(v.impact)) problems.push(`${view}/${theme}: ${v.impact} ${v.id} (${v.count})`);
    });
  }
  const click = (label, within) => page.evaluate((text, scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const target = Array.from(root.querySelectorAll('button, [role=radio], [role=tab]')).find(b => b.textContent.trim() === text);
    if (target) target.click();
    return !!target;
  }, label, within);
  const states = [
    ['route', 'formula mode', async () => { await click('Formula'); }],
    ['route', 'batch', async () => { await click('Plain'); await click('Batch', '#v-route'); await new Promise(r => setTimeout(r, 2500)); }],
    ['clinic', 'batch', async () => { await click('Batch', '#v-clinic'); await new Promise(r => setTimeout(r, 1500)); }],
    ['data', 'tables grid', async () => { await click('Tables'); await new Promise(r => setTimeout(r, 1200)); }]
  ];
  for (const [view, name, act] of states) {
    await page.evaluate(v => { window.location.hash = v; }, view);
    await new Promise(r => setTimeout(r, 800));
    await act();
    await new Promise(r => setTimeout(r, 600));
    const result = await page.evaluate(async () => {
      const out = await window.axe.run(document, { resultTypes: ['violations'] });
      return out.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' ') })) }));
    });
    result.forEach(v => {
      const key = `${v.id}|${v.impact}`;
      const entry = found.get(key) || { ...v, where: new Set(), samples: [] };
      entry.where.add(`${view} ${name}/${theme}`);
      if (entry.samples.length < 4) entry.samples.push(...v.nodes.slice(0, 2));
      found.set(key, entry);
      if (FAIL_ON.has(v.impact)) problems.push(`${view} ${name}/${theme}: ${v.impact} ${v.id} (${v.count})`);
    });
  }
  errors.forEach(e => problems.push(`${theme}: ${e}`));
  await page.close();
}
await browser.close();
server.close();
[...found.values()].sort((a, b) => b.count - a.count).forEach(v => {
  console.log(`${v.impact.toUpperCase()} ${v.id}: ${v.help} [${[...v.where].join(', ')}]`);
  v.samples.slice(0, 3).forEach(n => console.log(`   ${n.target}  ${n.summary}`));
});
console.log(problems.length ? `\n${problems.length} serious or critical findings` : '\nno serious or critical accessibility findings');
process.exit(problems.length ? 1 : 0);
