import { createRng } from '../core/rng.js';

const tokens = text => String(text || '').split(/[\s,;|]+/).filter(Boolean);

const weightedIndex = (rng, weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(rng.next() * weights.length);
  let at = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    at -= weights[i];
    if (at < 0) return i;
  }
  return weights.length - 1;
};

const hasGeo = facilities => facilities.some(f => String(f.lat || '').trim() !== '' && String(f.lon || '').trim() !== '');

export const generatePatients = ({ facilities, services, n, seed, mode }) => {
  const rng = createRng(seed);
  const geo = mode ? mode === 'geo' : hasGeo(facilities);
  const count = Math.max(0, Math.floor(Number(n) || 0));
  const offered = new Map();
  facilities.forEach(f => tokens(f.services).forEach(id => offered.set(id, (offered.get(id) || 0) + 1)));
  const serviceIds = services.map(s => String(s.id || '').trim()).filter(id => offered.has(id));
  const capacities = facilities.map(f => {
    const c = Number(f.capacity_per_day);
    return Number.isFinite(c) && c > 0 ? c : 1;
  });
  const rows = [];
  for (let i = 0; i < count; i++) {
    const at = facilities.length ? facilities[weightedIndex(rng, capacities)] : {};
    let place;
    if (geo) {
      const lat = Number(at.lat);
      const lon = Number(at.lon);
      place = { lat: ((Number.isFinite(lat) ? lat : 0) + rng.range(-0.1, 0.1)).toFixed(4), lon: ((Number.isFinite(lon) ? lon : 0) + rng.range(-0.1, 0.1)).toFixed(4) };
    } else {
      const x = Number(at.x);
      const y = Number(at.y);
      place = { x: ((Number.isFinite(x) ? x : 0) + rng.range(-5, 5)).toFixed(1), y: ((Number.isFinite(y) ? y : 0) + rng.range(-5, 5)).toFixed(1) };
    }
    const want = Math.min(rng.int(1, 3), serviceIds.length);
    const pool = serviceIds.slice();
    const chosen = [];
    while (chosen.length < want) {
      const index = weightedIndex(rng, pool.map(id => offered.get(id)));
      chosen.push(pool[index]);
      pool.splice(index, 1);
    }
    const roll = rng.next();
    const urgency = roll < 0.7 ? 'routine' : roll < 0.93 ? 'soon' : 'urgent';
    const number = String(i + 1);
    rows.push({ id: `S${number.padStart(4, '0')}`, name: `Synthetic ${number}`, ...place, needs: chosen.join(' '), urgency, previous_site: '' });
  }
  return rows;
};
