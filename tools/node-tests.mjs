import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const seed = Number(process.argv[2] || 123);
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="summary"></div><ul id="list"></ul></body></html>', { url: `http://localhost/tests.html?seed=${seed}`, pretendToBeVisual: true });
const w = dom.window;
const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
['document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'HTMLElement', 'Node', 'Element', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'SVGElement', 'MutationObserver', 'Blob', 'URL'].forEach(k => {
  if (w[k] !== undefined) define(k, w[k]);
});
define('window', w);
define('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
define('CSS', { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`) });
define('fetch', async target => {
  const path = target instanceof URL ? fileURLToPath(target) : String(target);
  const text = readFileSync(path, 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
});

await import(pathToFileURL(`${ROOT}js/tests/runner.js`).href);
while (!globalThis.waymarkTests) await new Promise(resolve => setTimeout(resolve, 100));
const out = globalThis.waymarkTests;
console.log(`${out.passed} passed, ${out.failed} failed, seed ${out.seed}`);
out.results.filter(r => !r.pass).forEach(r => console.log('FAIL', r.name, '-', r.message));
process.exit(out.failed ? 1 : 0);
