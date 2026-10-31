export const EARTH_RADIUS_KM = 6371.0088;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const sum = values => {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
};

export const mean = values => (values.length ? sum(values) / values.length : 0);

export const percentile = (values, p) => {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  if (n === 1) return sorted[0];
  const h = (n - 1) * clamp(p, 0, 100) / 100;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};

export const haversineKm = (lat1, lon1, lat2, lon2) => {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const euclidKm = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);

export const tieKey = value => Math.round(value * 1e12);

export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const fmtNum = value => {
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(6)));
};

export const fmtFixed = (value, digits) => {
  if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  return value.toFixed(digits);
};

export const trimNum = (value, digits) => {
  if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  return String(Number(value.toFixed(digits)));
};
