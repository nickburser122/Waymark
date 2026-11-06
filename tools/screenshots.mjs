import { mkdir } from 'node:fs/promises';
import { serve, launch, watchErrors } from './browser.mjs';

const OUT = new URL('../screenshots/', import.meta.url).pathname;
const VIEWS = ['route', 'clinic', 'data', 'eq'];
const SIZES = { desktop: { width: 1366, height: 900 }, phone: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 } };

await mkdir(OUT, { recursive: true });
const { server, url } = await serve();
const browser = await launch();
const problems = [];
for (const [sizeName, viewport] of Object.entries(SIZES)) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    const errors = watchErrors(page);
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.evaluateOnNewDocument(t => { try { localStorage.setItem('waymark.v3', JSON.stringify({ theme: t })); } catch (e) { return; } }, theme);
    await page.goto(`${url}/index.html#route`, { waitUntil: 'networkidle0' });
    for (const view of VIEWS) {
      await page.evaluate(v => { window.location.hash = v; }, view);
      await new Promise(r => setTimeout(r, 1200));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${sizeName}/${theme}/${view}: page scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: `${OUT}${view}-${sizeName}-${theme}.png`, fullPage: true });
    }
    errors.forEach(e => problems.push(`${sizeName}/${theme}: ${e}`));
    await page.close();
  }
}
await browser.close();
server.close();
console.log(problems.length ? problems.join('\n') : 'screenshots ok, no overflow or errors');
process.exit(problems.length ? 1 : 0);
