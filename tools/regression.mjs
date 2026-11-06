import { serve, launch, watchErrors } from './browser.mjs';

const { server, url } = await serve();
const browser = await launch();
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };
const settle = ms => new Promise(r => setTimeout(r, ms));

const page = await browser.newPage();
const errors = watchErrors(page);
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${url}/index.html#route`, { waitUntil: 'domcontentloaded' });
await settle(1800);

const markerPos = () => page.evaluate(() => {
  const circles = document.querySelectorAll('.patient circle');
  const core = circles[circles.length - 1];
  return { x: Number(core.getAttribute('cx')), y: Number(core.getAttribute('cy')) };
});
const markerId = () => page.evaluate(() => { const m = document.querySelector('.patient'); m.dataset.probe = m.dataset.probe || String(Math.random()); return m.dataset.probe; });

const probe = await markerId();
const start = await markerPos();
const box = await page.evaluate(() => { const c = document.querySelector('.patient circle:last-child').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x + 70, box.y + 45, { steps: 8 });
await page.mouse.up();
await settle(500);
const dragged = await markerPos();
check(Math.abs(dragged.x - start.x) > 20 && Math.abs(dragged.y - start.y) > 10, `dragging the patient did not move it (${start.x},${start.y} -> ${dragged.x},${dragged.y})`);
check((await markerId()) === probe, 'the patient marker was re-created by a drag');

await page.evaluate(() => document.querySelector('.patient').focus());
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
await settle(400);
const keyed = await markerPos();
check(keyed.x > dragged.x + 3, 'the arrow keys did not move the patient');
check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('patient')), 'the patient marker lost focus while moving with the keys');

const before = await page.evaluate(() => document.querySelector('#v-route .col:last-child')?.innerText.slice(0, 80) || '');
const nodeId = await page.evaluate(() => { const nodes = Array.from(document.querySelectorAll('.fnode')); const target = nodes[3]; target.dispatchEvent(new MouseEvent('click', { bubbles: true })); return target.getAttribute('data-id'); });
await settle(500);
const after = await page.evaluate(id => ({ selected: document.querySelector(`.fnode[data-id="${id}"] .selring`)?.getAttribute('display'), text: document.body.innerText }), nodeId);
check(after.selected !== 'none', 'clicking a site did not select it on the map');
check(before !== undefined, 'unreachable');

await page.click('.stage');
await settle(600);
check(await page.evaluate(() => location.hash === '#eq'), 'a pipeline stage button did not open the equations');
await page.evaluate(() => { location.hash = '#route'; });
await settle(800);

await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Dark').click(); });
await settle(300);
const sliderBefore = await page.evaluate(() => { const t = document.querySelector('#v-route .sl-thumb'); t.focus(); for (let i = 0; i < 6; i++) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); return t.getAttribute('aria-valuenow'); });
await settle(500);
await page.evaluate(() => { Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Log decision').click(); });
await settle(600);
await page.reload({ waitUntil: 'domcontentloaded' });
await settle(1800);
const reloaded = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  slider: document.querySelector('#v-route .sl-thumb').getAttribute('aria-valuenow'),
  ledgerRows: document.querySelectorAll('#v-route table.tbl tbody tr').length
}));
check(reloaded.theme === 'dark', `the theme was not remembered after a reload (${reloaded.theme})`);
check(reloaded.slider === sliderBefore, `the weight was not remembered after a reload (${sliderBefore} -> ${reloaded.slider})`);
check(reloaded.ledgerRows >= 1, 'the logged decision was not in the ledger after a reload');

errors.forEach(e => problems.push(e));
await browser.close();
server.close();
console.log(problems.length ? problems.join('\n') : 'regression checks ok');
process.exit(problems.length ? 1 : 0);
