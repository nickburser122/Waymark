export const createRng = seed => {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (lo, hi) => lo + (hi - lo) * next();
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = items => items[Math.floor(next() * items.length)];
  const chance = p => next() < p;
  const shuffle = items => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  };
  const subset = (items, min) => {
    const out = items.filter(() => next() < 0.5);
    while (out.length < min) {
      const candidate = pick(items);
      if (!out.includes(candidate)) out.push(candidate);
    }
    return out;
  };
  return { next, range, int, pick, chance, shuffle, subset };
};
