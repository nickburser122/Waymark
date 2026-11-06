import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };

export const serve = (port = 0) => new Promise(resolve => {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch (e) {
      res.writeHead(404).end('not found');
    }
  });
  server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

export const launch = async () => puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell'
});

export const watchErrors = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
  page.on('requestfailed', r => errors.push(`requestfailed ${r.url()}`));
  return errors;
};
