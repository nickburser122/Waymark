import { MANIFEST } from './manifest.js';

const REGEX_PREFIX = '(,=:[!&|?{};+-*%<>~^';
const REGEX_WORDS = ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'];

const skipString = (s, i) => {
  const quote = s[i];
  i += 1;
  while (i < s.length && s[i] !== quote && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1;
  return i + 1;
};

const skipBraces = (s, i) => {
  let depth = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") i = skipString(s, i);
    else if (c === '`') i = skipTemplate(s, i);
    else if (c === '{') { depth += 1; i += 1; }
    else if (c === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
    } else i += 1;
  }
  return i;
};

const skipTemplate = (s, i) => {
  i += 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') i += 2;
    else if (c === '`') return i + 1;
    else if (c === '$' && s[i + 1] === '{') i = skipBraces(s, i + 2);
    else i += 1;
  }
  return i;
};

const skipRegex = (s, i) => {
  i += 1;
  let inClass = false;
  while (i < s.length && s[i] !== '\n') {
    const c = s[i];
    if (c === '\\') i += 2;
    else if (c === '[') { inClass = true; i += 1; }
    else if (c === ']') { inClass = false; i += 1; }
    else if (c === '/' && !inClass) { i += 1; break; }
    else i += 1;
  }
  while (i < s.length && /[a-z]/.test(s[i])) i += 1;
  return i;
};

const lastWord = out => {
  let end = out.length;
  while (end > 0 && out[end - 1] === ' ') end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1])) start -= 1;
  return out.slice(start, end);
};

const lastSignificant = out => {
  let end = out.length;
  while (end > 0 && (out[end - 1] === ' ' || out[end - 1] === '\n' || out[end - 1] === '\t')) end -= 1;
  return end === 0 ? '' : out[end - 1];
};

export const stripLiterals = (src, withRegex) => {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      out += ' ';
    } else if (c === '`') {
      i = skipTemplate(src, i);
      out += ' ';
    } else if (c === '/' && withRegex && src[i + 1] !== '/' && src[i + 1] !== '*') {
      const prev = lastSignificant(out);
      const word = lastWord(out);
      if (prev === '' || REGEX_PREFIX.includes(prev) || REGEX_WORDS.includes(word)) {
        i = skipRegex(src, i);
        out += ' ';
      } else {
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
};

export const findCommentMarks = (stripped, kind) => {
  const hits = [];
  const lines = stripped.split('\n');
  lines.forEach((line, n) => {
    if (kind === 'html') {
      if (line.includes('<!--')) hits.push(n + 1);
      return;
    }
    if (line.includes('/*')) hits.push(n + 1);
    let from = 0;
    for (;;) {
      const at = line.indexOf('//', from);
      if (at < 0) break;
      if (at === 0 || line[at - 1] !== ':') {
        hits.push(n + 1);
        break;
      }
      from = at + 2;
    }
  });
  return hits;
};

const kindOf = path => (path.endsWith('.html') ? 'html' : path.endsWith('.css') ? 'css' : 'js');

const NATIVE = ['<select', 'type="range"', 'type="checkbox"', '<details', 'alert(', 'confirm(', 'prompt(', ' title="'];
const PURITY = ['document', 'window', 'localStorage', 'indexedDB', 'Math.random', 'location'];
const SPOOF = ['golden', 'webdriver', '__test'];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const scan = (files, words, filter) => {
  const problems = [];
  Object.keys(files).filter(filter).forEach(path => {
    words.forEach(word => {
      let from = 0;
      for (;;) {
        const at = files[path].indexOf(word, from);
        if (at < 0) break;
        problems.push(`${path}:${lineOf(files[path], at)} ${word}`);
        from = at + word.length;
      }
    });
  });
  return problems;
};

export const register = t => {
  let cache = null;
  const load = async () => {
    if (cache) return cache;
    const files = {};
    for (const path of MANIFEST) {
      const response = await fetch(new URL(`../../${path}`, import.meta.url));
      if (!response.ok) throw new Error(`Manifest entry failed to fetch: ${path}`);
      files[path] = await response.text();
    }
    cache = files;
    return files;
  };

  t.test('L0 tokenizer finds comments and ignores literals', () => {
    const sample = ['const a = "x // y";', 'const b = `t ${"/*"} u`;', 'const r = /a\\/\\/b/;', 'const d = a / b / c;', 'const u = 1; // note', '/* block */'].join('\n');
    t.same(findCommentMarks(stripLiterals(sample, true), 'js'), [5, 6]);
    t.same(findCommentMarks(stripLiterals('<p>a</p>\n<!-- c -->', false), 'html'), [2]);
    t.same(findCommentMarks(stripLiterals('a{background:url(https://x.y/z.png)}', false), 'css'), []);
  });

  t.test('L1 no comments in any shipped file', async () => {
    const files = await load();
    const problems = [];
    Object.keys(files).forEach(path => {
      const kind = kindOf(path);
      const stripped = stripLiterals(files[path], kind === 'js');
      findCommentMarks(stripped, kind).forEach(n => problems.push(`${path}:${n}`));
    });
    t.same(problems, []);
  });

  t.test('L2 no native browser UI', async () => {
    const files = await load();
    t.same(scan(files, NATIVE, () => true), []);
    const fileInputs = scan(files, ['type="file"'], () => true);
    t.ok(fileInputs.length <= 1, `file inputs: ${fileInputs.join(', ')}`);
    t.ok(fileInputs.every(p => p.startsWith('js/ui/components.js')), `file input outside components.js: ${fileInputs.join(', ')}`);
  });

  t.test('L3 no console.log or debugger', async () => {
    const files = await load();
    t.same(scan(files, ['console.log', 'debugger'], () => true), []);
  });

  t.test('L4 engine purity inside js/core', async () => {
    const files = await load();
    t.same(scan(files, PURITY, p => p.startsWith('js/core/')), []);
  });

  t.test('L5 no test spoofing in core or ui', async () => {
    const files = await load();
    t.same(scan(files, SPOOF, p => p.startsWith('js/core/') || p.startsWith('js/ui/')), []);
  });

  t.test('L6 manifest has no duplicates and every entry loads', async () => {
    const files = await load();
    t.same(Object.keys(files).length, new Set(MANIFEST).size);
    t.ok(MANIFEST.every(p => files[p].length > 0), 'empty file in manifest');
  });
};
