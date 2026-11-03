export const createRunner = seed => {
  const tests = [];
  const api = {
    seed,
    tests,
    test: (name, fn) => tests.push({ name, fn }),
    ok: (condition, message) => {
      if (!condition) throw new Error(message || 'Assertion failed');
    },
    near: (actual, expected, tolerance, message) => {
      const tol = tolerance === undefined ? 1e-4 : tolerance;
      const same = actual === expected || Math.abs(actual - expected) <= tol;
      if (!same) throw new Error(`${message || 'Value differs'}: got ${actual}, expected ${expected} (±${tol})`);
    },
    same: (actual, expected, message) => {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`${message || 'Values differ'}: got ${a.slice(0, 300)}, expected ${b.slice(0, 300)}`);
    }
  };
  return api;
};

export const runAll = async runner => {
  const results = [];
  for (const t of runner.tests) {
    const started = performance.now();
    try {
      await t.fn();
      results.push({ name: t.name, pass: true, ms: performance.now() - started });
    } catch (error) {
      results.push({ name: t.name, pass: false, message: String(error && error.message ? error.message : error), ms: performance.now() - started });
    }
  }
  return results;
};

export const SUITES = ['./golden.js', './props.js', './safety.js', './fixes.js', './audit.js', './clinic.js', './synth.js', './polish.js', './ui.js', './lint.js'];

export const runSuite = async seed => {
  const runner = createRunner(seed);
  for (const path of SUITES) {
    const mod = await import(path);
    mod.register(runner);
  }
  const results = await runAll(runner);
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  return { seed, results, passed, failed };
};

const parseSeed = () => {
  const raw = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('seed');
  const value = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? value : Math.floor(Math.random() * 1e9);
};

const boot = async () => {
  const seed = parseSeed();
  const summary = document.getElementById('summary');
  const list = document.getElementById('list');
  summary.textContent = 'Running…';
  const outcome = await runSuite(seed);
  summary.textContent = `${outcome.passed} passed · ${outcome.failed} failed · seed ${outcome.seed}`;
  summary.dataset.state = outcome.failed ? 'fail' : 'pass';
  outcome.results.forEach(r => {
    const li = document.createElement('li');
    li.className = r.pass ? 'pass' : 'fail';
    li.textContent = r.pass ? r.name : `${r.name} — ${r.message}`;
    list.appendChild(li);
  });
  globalThis.waymarkTests = outcome;
};

if (typeof document !== 'undefined') boot();
