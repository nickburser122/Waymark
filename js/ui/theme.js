const query = () => (window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

const paint = () => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute('content', bg);
};

export const applyTheme = theme => {
  document.documentElement.setAttribute('data-theme', theme);
  paint();
};

export const watchSystemTheme = () => {
  const mq = query();
  if (mq && mq.addEventListener) mq.addEventListener('change', paint);
};
