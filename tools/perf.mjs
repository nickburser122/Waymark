import { serve, launch } from './browser.mjs';

const { server, url } = await serve();
const browser = await launch();
const results = [];

const measure = async (view, thumbIndex, label) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.evaluateOnNewDocument(() => {
    window.__paint = [];
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original(now => {
      const started = performance.now();
      callback(now);
      window.__paint.push(performance.now() - started);
    });
  });
  await page.goto(`${url}/index.html#${view}`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1800));
  const out = await page.evaluate(async index => {
    const thumbs = Array.from(document.querySelectorAll(`#v-${location.hash.slice(1)} .sl-thumb`));
    const thumb = thumbs[index];
    thumb.focus();
    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = now => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const longTasks = [];
    const obs = new PerformanceObserver(list => list.getEntries().forEach(e => longTasks.push(e.duration)));
    try { obs.observe({ entryTypes: ['longtask'] }); } catch (e) { longTasks.push(-1); }
    for (let i = 0; i < 40; i++) {
      thumb.dispatchEvent(new KeyboardEvent('keydown', { key: i < 20 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
      await new Promise(r => setTimeout(r, 16));
    }
    await new Promise(r => setTimeout(r, 300));
    running = false;
    frames.sort((a, b) => a - b);
    const paints = window.__paint.filter(x => x >= 0.5).sort((a, b) => a - b);
    return { paints: paints.length, paintMedian: paints[Math.floor(paints.length / 2)] || 0, paintMax: paints[paints.length - 1] || 0, frames: frames.length, median: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)], worst: frames[frames.length - 1], longTasks: longTasks.filter(x => x > 0).length, longMax: Math.max(0, ...longTasks) };
  }, thumbIndex);
  results.push({ label, ...out });
  await page.close();
};

await measure('route', 0, 'route single: weight T');
await measure('clinic', 1, 'clinic single: fix weight');
await measure('clinic', 0, 'clinic single: demand multiplier (re-runs the flow model)');
await browser.close();
server.close();
results.forEach(r => console.log(`${r.label}: repaint median ${r.paintMedian.toFixed(1)} ms, max ${r.paintMax.toFixed(1)} ms over ${r.paints} repaints; ${r.frames} frames, median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, worst ${r.worst.toFixed(1)} ms, long tasks ${r.longTasks} (max ${r.longMax.toFixed(0)} ms)`));
process.exit(0);
