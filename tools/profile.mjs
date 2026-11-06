import { serve, launch } from './browser.mjs';

const view = process.argv[2] || 'route';
const thumbIndex = Number(process.argv[3] || 0);
const { server, url } = await serve();
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${url}/index.html#${view}`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2000));
const client = await page.createCDPSession();
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => { document.querySelectorAll('.sl-thumb')[0]; });
await client.send('Profiler.start');
await page.evaluate(async index => {
  const thumb = document.querySelectorAll(`#v-${location.hash.slice(1)} .sl-thumb`)[index];
  thumb.focus();
  for (let i = 0; i < 40; i++) {
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: i < 20 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
    await new Promise(r => setTimeout(r, 16));
  }
  await new Promise(r => setTimeout(r, 300));
}, thumbIndex);
const { profile } = await client.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const node = byId.get(id);
  const f = node.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, v]) => console.log(`${(v / 1000).toFixed(0).padStart(5)} ms ${(100 * v / total).toFixed(0).padStart(3)}%  ${k}`));
await browser.close(); server.close(); process.exit(0);
