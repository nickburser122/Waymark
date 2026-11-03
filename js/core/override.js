import { fmtNum } from './stats.js';

const serviceLabel = (model, id) => (model.services.has(id) ? model.services.get(id).name : id);

export const OUTCOMES = Object.freeze({
  same: { label: 'Same as Waymark', tone: 'ok' },
  approved: { label: 'Approved', tone: 'ok' },
  copay: { label: 'Approved with a co-pay', tone: 'warn' },
  signoff: { label: 'Needs sign-off', tone: 'warn' },
  waitlist: { label: 'Goes on the waitlist', tone: 'warn' },
  denied: { label: 'Denied', tone: 'bad' }
});

export const judgeOverride = (model, result, requestedId, options = {}) => {
  const cfg = model.cfg;
  const pp = result.pp;
  const u = pp.urgency;
  const row = result.rows.find(r => r.id === requestedId);
  if (!row) return null;
  const f = row.facility;
  const tokenUsed = !!options.tokenUsed;
  const missing = pp.needs.filter(need => !f.services.has(need)).map(need => serviceLabel(model, need));
  const slots = f.capacity * cfg.horizon;
  const free = slots - f.inflow - row.backlog;
  const reserve = Math.max(1, Math.ceil(slots * cfg.overrideReserve));
  const reachLimit = cfg.reach[u] * cfg.overrideReachMult;
  const bestScore = result.status === 'single' ? result.ranked[0].total : result.status === 'split' ? result.summary.score : null;
  const loss = bestScore === null ? 0 : Math.max(0, bestScore - row.raw);
  const copay = result.summary ? Math.max(0, pp.basePrice * f.multiplier - result.summary.cost) : 0;
  const same = result.status === 'single' && result.stops.length === 1 && result.stops[0].row.id === requestedId;
  const rules = [
    {
      id: 'fit', label: 'Clinical fit', pass: row.gates.covers, hard: true, soft: false, info: false,
      detail: row.gates.covers ? 'Offers every needed service' : `Missing ${missing.join(', ')}`
    },
    {
      id: 'deadline', label: 'Clinical deadline', pass: row.gates.deadline, hard: true, soft: false, info: false,
      detail: `${row.ttc.toFixed(1)} d of ${fmtNum(cfg.deadline[u])} d`
    },
    {
      id: 'reserve', label: 'Slot reserve', pass: free - reserve >= 1, hard: true, soft: false, info: false,
      detail: `${fmtNum(Math.round(free * 10) / 10)} free slots, ${fmtNum(reserve)} held back`
    },
    {
      id: 'reach', label: 'Override reach', pass: row.km <= reachLimit, hard: true, soft: false, info: false,
      detail: Number.isFinite(row.km) ? `${Math.round(row.km)} km of ${fmtNum(Math.round(reachLimit))} km` : 'No travel data'
    },
    {
      id: 'token', label: 'Override token', pass: !tokenUsed, hard: true, soft: false, info: false,
      detail: tokenUsed ? 'Already used this quarter' : 'Available'
    },
    {
      id: 'tolerance', label: 'Score tolerance', pass: loss <= cfg.overrideTolerance, hard: false, soft: true, info: false,
      detail: bestScore === null ? 'No engine plan' : `${loss.toFixed(2)} below the best, up to ${fmtNum(cfg.overrideTolerance)} allowed`
    },
    {
      id: 'cost', label: 'Cost gap', pass: copay <= 0.005, hard: false, soft: false, info: true,
      detail: copay > 0.005 ? `Patient pays ${copay.toFixed(0)} more` : 'No extra cost'
    }
  ];
  const failed = id => !rules.find(r => r.id === id).pass;
  let outcome;
  if (same) outcome = 'same';
  else if (failed('fit') || failed('deadline') || failed('reach') || failed('token')) outcome = 'denied';
  else if (failed('reserve')) outcome = 'waitlist';
  else if (failed('tolerance')) outcome = 'signoff';
  else if (copay > 0.005) outcome = 'copay';
  else outcome = 'approved';
  return { row, rules, outcome, copay, loss, same };
};
