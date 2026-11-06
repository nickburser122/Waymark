import { serve, launch, watchErrors } from './browser.mjs';

const seeds = (process.argv[2] || '123').split(',');
const { server, url } = await serve();
const browser = await launch();
const problems = [];

for (const seed of seeds) {
  const page = await browser.newPage();
  const errors = watchErrors(page);
  await page.goto(`${url}/tests.html?seed=${seed}`);
  await page.waitForFunction(() => window.waymarkTests, { timeout: 240000 });
  const out = await page.evaluate(() => ({ summary: document.getElementById('summary').textContent, failed: window.waymarkTests.results.filter(r => !r.pass).map(r => `${r.name} - ${r.message}`) }));
  console.log(out.summary);
  out.failed.forEach(f => problems.push(`seed ${seed}: ${f}`));
  errors.forEach(e => problems.push(`seed ${seed}: ${e}`));
  await page.close();
}

const page = await browser.newPage();
const errors = watchErrors(page);
const external = [];
page.on('request', r => { if (!r.url().startsWith(url) && !r.url().startsWith('data:')) external.push(r.url()); });
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${url}/index.html#route`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));

const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  return ['Instrument Sans', 'Fraunces', 'JetBrains Mono'].map(name => [name, document.fonts.check(`16px "${name}"`)]);
});
fonts.forEach(([name, ok]) => { if (!ok) problems.push(`font not loaded: ${name}`); });

const extended = await page.evaluate(async () => {
  const probe = document.createElement('div');
  probe.innerHTML = '<span style="font-family:Instrument Sans">ŵ</span><code style="font-family:JetBrains Mono">Δ ω ŵ</code>';
  document.body.append(probe);
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 600));
  probe.remove();
  return Array.from(document.fonts).filter(face => face.status === 'loaded').map(face => face.family.replace(/"/g, '') + ':' + face.unicodeRange.slice(0, 8));
});
if (!extended.some(name => name.startsWith('Instrument Sans:U+100'))) problems.push('Instrument Sans Latin Extended did not load for a character in its range');
if (!extended.some(name => name.startsWith('JetBrains Mono:U+370'))) problems.push('JetBrains Mono Greek did not load for a character in its range');

const animation = () => page.evaluate(() => {
  const edge = document.querySelector('.edge.best');
  const anim = edge && edge.getAnimations()[0];
  return anim ? { time: Number(anim.currentTime), running: anim.playState === 'running', same: edge.dataset.mark === 'kept' } : null;
});
await page.evaluate(() => { document.querySelector('.edge.best').dataset.mark = 'kept'; });
await new Promise(r => setTimeout(r, 400));
const first = await animation();
const valueBefore = await page.evaluate(() => document.querySelector('.sl-thumb').getAttribute('aria-valuenow'));
await page.evaluate(() => {
  const thumb = document.querySelector('.sl-thumb');
  thumb.focus();
  ['ArrowRight', 'ArrowRight', 'ArrowRight'].forEach(key => thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
});
await new Promise(r => setTimeout(r, 400));
const second = await animation();
const valueAfter = await page.evaluate(() => document.querySelector('.sl-thumb').getAttribute('aria-valuenow'));
if (valueBefore === valueAfter) problems.push('the weight slider did not change, so the repaint check proved nothing');
const repainted = await page.evaluate(() => document.querySelector('.decision h2, .decision .big, .decision') !== null);
if (!first || !second) problems.push('route animation not found');
else {
  if (!second.same) problems.push('the route line was re-created by a weight change');
  if (!(second.time > first.time)) problems.push(`route animation restarted (${first.time} then ${second.time})`);
  if (!second.running) problems.push('route animation is not running');
}
const tweened = await page.evaluate(async () => {
  const thumb = document.querySelector('.sl-thumb');
  thumb.focus();
  for (let i = 0; i < 6; i++) thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.matches && a.effect.target.matches('[data-tw]')).length;
});
if (tweened < 1) problems.push('score bars did not animate to their new widths');
const halo = await page.evaluate(() => { const h = document.querySelector('.halo'); return h ? h.getAnimations().length : 0; });
if (halo < 1) problems.push('patient pulse is not animating');
const focusKept = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('sl-thumb'));
if (!focusKept) problems.push('the slider lost focus after a repaint');
if (external.length) problems.push(`requests left the app: ${external.slice(0, 3).join(', ')}`);
errors.forEach(e => problems.push(e));

await browser.close();
server.close();
console.log(problems.length ? problems.join('\n') : 'browser checks ok');
process.exit(problems.length ? 1 : 0);
