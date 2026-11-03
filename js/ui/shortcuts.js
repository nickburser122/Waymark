export const SHORTCUT_BLOCK = 'input, textarea, select, [contenteditable], .dd, .rng';

export const THEME_CYCLE = Object.freeze(['system', 'light', 'dark']);

export const nextTheme = current => THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];

export const shortcutFor = (event, viewCount) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  if (target && target.closest && target.closest(SHORTCUT_BLOCK)) return null;
  const key = String(event.key || '');
  if (/^[1-9]$/.test(key) && Number(key) <= viewCount) return { type: 'view', index: Number(key) - 1 };
  if (key.toLowerCase() === 't') return { type: 'theme' };
  return null;
};
