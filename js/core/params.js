import { fmtNum, clamp } from './stats.js';

const entries = [];

const def = entry => {
  entries.push(Object.freeze({ group: 'advanced', unit: '', ...entry }));
};

export const ROUTE_WEIGHT_KEYS = ['wT', 'wC', 'wP', 'wL', 'wQ', 'wK'];
export const FIX_WEIGHT_KEYS = ['fwR', 'fwO', 'fwP', 'fwB'];
export const URGENCY_NAMES = ['routine', 'soon', 'urgent'];

const routeWeights = [
  ['wT', 'T', 'Time to care', 35, 'Time to care'],
  ['wC', 'C', 'Cost', 15, 'Cost'],
  ['wP', 'P', 'Public first', 10, 'Public tier preference'],
  ['wL', 'L', 'Load balance', 10, 'Load balance'],
  ['wQ', 'Q', 'Quality', 20, 'Quality'],
  ['wK', 'K', 'Continuity', 10, 'Continuity']
];

routeWeights.forEach(([key, letter, label, value, noun]) => {
  def({
    key, symbol: key, latex: `w_${letter}`, label: `${label} weight`, default: value, min: 0, max: 100, step: 1,
    unit: 'pts', group: 'basic', view: 'route',
    plain: v => `${noun} gets ${fmtNum(v)} weight points before normalising.`
  });
});

const perUrgency = (keyPrefix, symbolPrefix, latexPrefix, label, values, range, unit, plain) => {
  URGENCY_NAMES.forEach((name, index) => {
    def({
      key: keyPrefix + name[0].toUpperCase() + name.slice(1),
      symbol: `${symbolPrefix}_${name}`,
      latex: `${latexPrefix}_{\\text{${name}}}`,
      label: `${label}, ${name}`,
      default: values[index], min: range[0], max: range[1], step: range[2], unit, view: 'route',
      plain: v => plain(v, name)
    });
  });
};

perUrgency('tau', 'τ', '\\tau', 'Time half-life', [7, 2, 0.25], [0.05, 90, 0.05], 'd',
  (v, name) => `Every ${fmtNum(v)} days to care halves the ${name} time score.`);
perUrgency('deadline', 'D', 'D', 'Deadline', [42, 7, 1], [0.1, 365, 0.1], 'd',
  (v, name) => `${name[0].toUpperCase() + name.slice(1)} patients must reach care within ${fmtNum(v)} days.`);
perUrgency('reach', 'R', 'R', 'Reach', [120, 90, 60], [1, 1000, 1], 'km',
  (v, name) => `${name[0].toUpperCase() + name.slice(1)} patients travel at most ${fmtNum(v)} km by road.`);
perUrgency('share', 'share', '\\pi', 'Class share', [0.65, 0.25, 0.1], [0, 1, 0.01], '',
  (v, name) => `${fmtNum(v * 100)}% of referrals are ${name}.`);
perUrgency('beta', 'β', '\\beta', 'Backlog ahead', [1, 0.5, 0.1], [0, 1, 0.05], '',
  (v, name) => `${name[0].toUpperCase() + name.slice(1)} patients wait behind ${fmtNum(v * 100)}% of the backlog.`);

const routeEntries = [
  { key: 'eta', symbol: 'η', latex: '\\eta', label: 'Detour index', default: 1.3, min: 1, max: 3, step: 0.05, unit: '', plain: v => `Roads are ${fmtNum(v)} times longer than straight lines.` },
  { key: 'speed', symbol: 'v', latex: 'v', label: 'Travel speed', default: 45, min: 5, max: 130, step: 1, unit: 'km/h', plain: v => `Patients travel at ${fmtNum(v)} km per hour.` },
  { key: 'rhoMax', symbol: 'ρ_max', latex: '\\rho_{max}', label: 'Load limit', default: 0.98, min: 0.5, max: 0.999, step: 0.001, unit: '', plain: v => `Sites above ${fmtNum(v * 100)}% load are closed to new referrals.` },
  { key: 'horizon', symbol: 'H', latex: 'H', label: 'Booking horizon', default: 7, min: 1, max: 30, step: 1, unit: 'd', plain: v => `Slots are counted over the next ${fmtNum(v)} days.` },
  { key: 'shrinkK', symbol: 'k', latex: 'k', label: 'Quality prior weight', default: 50, min: 0, max: 1000, step: 1, unit: 'reviews', plain: v => `Sites need about ${fmtNum(v)} reviews before their own rating dominates.` },
  { key: 'caSq', symbol: 'c_a²', latex: 'c_a^2', label: 'Arrival variability', default: 1, min: 0, max: 4, step: 0.05, unit: '', plain: v => `Referral arrivals vary with squared coefficient ${fmtNum(v)}.` },
  { key: 'csSq', symbol: 'c_s²', latex: 'c_s^2', label: 'Service variability', default: 0.5, min: 0, max: 4, step: 0.05, unit: '', plain: v => `Visit lengths vary with squared coefficient ${fmtNum(v)}.` },
  { key: 'tierPublic', symbol: 'tier_public', latex: '\\text{tier}_{pub}', label: 'Public tier value', default: 1, min: 0, max: 1, step: 0.05, unit: '', plain: v => `Public sites score ${fmtNum(v)} on tier.` },
  { key: 'tierContracted', symbol: 'tier_contracted', latex: '\\text{tier}_{con}', label: 'Contracted tier value', default: 0.6, min: 0, max: 1, step: 0.05, unit: '', plain: v => `Contracted sites score ${fmtNum(v)} on tier.` },
  { key: 'tierPrivate', symbol: 'tier_private', latex: '\\text{tier}_{pri}', label: 'Private tier value', default: 0.25, min: 0, max: 1, step: 0.05, unit: '', plain: v => `Private sites score ${fmtNum(v)} on tier.` },
  { key: 'costLow', symbol: 'P_low', latex: 'P_{low}', label: 'Cost low percentile', default: 10, min: 0, max: 49, step: 1, unit: '%', plain: v => `The cheapest ${fmtNum(v)}% of prices all score 1.` },
  { key: 'costHigh', symbol: 'P_high', latex: 'P_{high}', label: 'Cost high percentile', default: 90, min: 51, max: 100, step: 1, unit: '%', plain: v => `The priciest ${fmtNum(100 - v)}% of prices all score 0.` },
  { key: 'marginClear', symbol: 'm_clear', latex: 'm_{clear}', label: 'Clear lead margin', default: 0.08, min: 0, max: 1, step: 0.01, unit: '', plain: v => `A lead above ${fmtNum(v)} counts as clear.` },
  { key: 'marginModerate', symbol: 'm_mod', latex: 'm_{mod}', label: 'Moderate lead margin', default: 0.03, min: 0, max: 1, step: 0.01, unit: '', plain: v => `A lead above ${fmtNum(v)} counts as moderate.` },
  { key: 'robustStep', symbol: 'Δw', latex: '\\Delta w', label: 'Robustness step', default: 10, min: 1, max: 50, step: 1, unit: 'pts', plain: v => `Each weight is moved by ${fmtNum(v)} points to test the winner.` },
  { key: 'nearFull', symbol: 'U_near', latex: 'U_{near}', label: 'Near-full threshold', default: 0.9, min: 0.5, max: 1, step: 0.01, unit: '', plain: v => `Sites above ${fmtNum(v * 100)}% of weekly slots count as near full.` },
  { key: 'maxStops', symbol: 'S_max', latex: 'S_{max}', label: 'Split plan stops', default: 3, min: 1, max: 6, step: 1, unit: '', plain: v => `A split plan uses at most ${fmtNum(v)} sites.` },
  { key: 'waitCap', symbol: 'W_cap', latex: 'W_{cap}', label: 'Referral wait ceiling', default: 365, min: 1, max: 3650, step: 1, unit: 'd', plain: v => `Waits are shown as at most ${fmtNum(v)} days.` },
  { key: 'qualityFallback', symbol: 'q_0', latex: 'q_{0}', label: 'Fallback quality prior', default: 0.75, min: 0, max: 1, step: 0.01, unit: '', plain: v => `Without any reviews the quality prior is ${fmtNum(v)}.` },
  { key: 'defaultComplexity', symbol: 'κ_default', latex: '\\kappa_{0}', label: 'Default complexity', default: 1, min: 0.1, max: 5, step: 0.1, unit: '', plain: v => `Services without a complexity count as ${fmtNum(v)}.` },
  { key: 'publicLock', symbol: 'L_pub', latex: 'L_{pub}', label: 'Strict public-first', default: 0, min: 0, max: 1, step: 1, unit: '', group: 'basic', view: 'route', choices: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }], plain: v => (v === 1 ? 'Private and contracted sites are used only when no public site passes every gate.' : 'All tiers compete on score.') },
  { key: 'overrideReserve', symbol: 'r_res', latex: 'r_{res}', label: 'Override slot reserve', default: 0.1, min: 0, max: 0.5, step: 0.01, unit: '', plain: v => `Overrides can't take the last ${fmtNum(v * 100)}% of a site's slots.` },
  { key: 'overrideReachMult', symbol: 'm_R', latex: 'm_R', label: 'Override reach multiplier', default: 1.5, min: 1, max: 3, step: 0.05, unit: '×', plain: v => `Patients may choose sites up to ${fmtNum(v)}× the normal reach.` },
  { key: 'overrideTolerance', symbol: 'Δ_tol', latex: '\\Delta_{tol}', label: 'Override score tolerance', default: 0.15, min: 0, max: 1, step: 0.01, unit: '', plain: v => `Choices up to ${fmtNum(v)} below the best score are approved. Larger gaps need sign-off.` },
  { key: 'batchOrder', symbol: 'order', latex: '\\text{order}', label: 'Batch order', default: 0, min: 0, max: 1, step: 1, unit: '', choices: [{ value: 0, label: 'Regret' }, { value: 1, label: 'As listed' }], plain: v => (v === 1 ? 'Patients are placed in the order listed.' : 'Patients with most to lose are placed first.') }
];

routeEntries.forEach(entry => def({ view: 'route', ...entry }));

const fixWeights = [
  ['fwR', 'vR', 'v_R', 'Risk removed weight', 40, 'Risk removed'],
  ['fwO', 'vO', 'v_O', 'Overload relief weight', 30, 'Overload relief'],
  ['fwP', 'vP', 'v_P', 'Patient reach weight', 20, 'Patient reach'],
  ['fwB', 'vB', 'v_B', 'Breadth weight', 10, 'Breadth']
];

fixWeights.forEach(([key, symbol, latex, label, value, noun]) => {
  def({
    key, symbol, latex, label, default: value, min: 0, max: 100, step: 1, unit: 'pts', group: 'basic', view: 'clinic',
    plain: v => `${noun} gets ${fmtNum(v)} weight points before normalising.`
  });
});

const clinicEntries = [
  { key: 'season', symbol: 'season', latex: '\\text{season}', label: 'Demand multiplier', default: 1, min: 0.5, max: 2, step: 0.01, unit: '×', group: 'basic', plain: v => `Arrivals are scaled by ${fmtNum(v)}.` },
  { key: 'budget', symbol: 'B', latex: 'B', label: 'Fix budget', default: Infinity, min: 0, max: 10000, step: 1, unit: 'k', group: 'basic', plain: v => (v === Infinity ? 'No budget limit applies to the plan.' : `The plan may spend up to ${fmtNum(v)}k.`) },
  { key: 'bucketMin', symbol: 'Δ', latex: '\\Delta', label: 'Time bucket', default: 60, min: 30, max: 60, step: 30, unit: 'min', choices: [{ value: 30, label: '30 min' }, { value: 60, label: '60 min' }], plain: v => `Queues are tracked in ${fmtNum(v)} minute steps.` },
  { key: 'cRhoMax', symbol: 'ρ_max,clinic', latex: '\\rho_{max}^{c}', label: 'Clinic load limit', default: 0.98, min: 0.5, max: 0.999, step: 0.001, unit: '', plain: v => `Above ${fmtNum(v * 100)}% load only the backlog term counts.` },
  { key: 'waitMax', symbol: 'W_max', latex: 'W_{max}', label: 'Clinic wait ceiling', default: 240, min: 10, max: 1440, step: 10, unit: 'min', plain: v => `Waits are capped at ${fmtNum(v)} minutes.` },
  { key: 'kappa', symbol: 'ω', latex: '\\omega', label: 'Overload risk factor', default: 2, min: 0, max: 10, step: 0.1, unit: '', plain: v => `Each point of load above the knee adds ${fmtNum(v)} to the risk factor.` },
  { key: 'rhoStar', symbol: 'ρ*', latex: '\\rho^{*}', label: 'Load knee', default: 0.85, min: 0.3, max: 1, step: 0.01, unit: '', plain: v => `Risk grows once peak load passes ${fmtNum(v * 100)}%.` },
  { key: 'deltaShare', symbol: 'δ', latex: '\\delta', label: 'Exposure factor', default: 0.5, min: 0, max: 5, step: 0.05, unit: '', plain: v => `Risk rises by ${fmtNum(v)} times the share of patients exposed.` },
  { key: 'rhoClip', symbol: 'ρ_clip', latex: '\\rho_{clip}', label: 'Load ceiling for risk', default: 2, min: 1, max: 5, step: 0.1, unit: '', plain: v => `Peak load counts as at most ${fmtNum(v * 100)}% in risk.` },
  { key: 'alpha', symbol: 'α', latex: '\\alpha', label: 'Effort exponent', default: 0.5, min: 0, max: 2, step: 0.05, unit: '', plain: v => `Effort divides priority with exponent ${fmtNum(v)}.` },
  { key: 'gamma', symbol: 'γ', latex: '\\gamma', label: 'Cost exponent', default: 0, min: 0, max: 2, step: 0.05, unit: '', plain: v => (v === 0 ? 'Cost does not change priority.' : `Cost divides priority with exponent ${fmtNum(v)}.`) },
  { key: 'costRef', symbol: 'C_ref', latex: 'C_{ref}', label: 'Reference cost', default: 10, min: 0.1, max: 1000, step: 0.1, unit: 'k', plain: v => `A fix costing ${fmtNum(v)}k halves priority when γ is 1.` },
  { key: 'riskHigh', symbol: 'band_high', latex: '\\text{band}_{high}', label: 'High risk from', default: 60, min: 1, max: 1000, step: 1, unit: '', plain: v => `Risk of ${fmtNum(v)} or more is high.` },
  { key: 'riskMedium', symbol: 'band_medium', latex: '\\text{band}_{med}', label: 'Medium risk from', default: 25, min: 1, max: 1000, step: 1, unit: '', plain: v => `Risk of ${fmtNum(v)} or more is medium.` },
  { key: 'defaultServiceCv2', symbol: 'c_s²_default', latex: 'c_{s,0}^2', label: 'Default service variability', default: 0.5, min: 0, max: 4, step: 0.05, unit: '', plain: v => `Stations without a value use ${fmtNum(v)}.` },
  { key: 'defaultArrivalCv2', symbol: 'c_a²_default', latex: 'c_{a,0}^2', label: 'Default arrival variability', default: 1, min: 0, max: 4, step: 0.05, unit: '', plain: v => `Hours without a value use ${fmtNum(v)}.` }
];

clinicEntries.forEach(entry => def({ view: 'clinic', ...entry }));

export const REGISTRY = Object.freeze(entries);

export const BY_KEY = Object.freeze(Object.fromEntries(REGISTRY.map(entry => [entry.key, entry])));

export const entriesFor = view => REGISTRY.filter(entry => !view || entry.view === view);

export const defaultParams = view => {
  const out = {};
  entriesFor(view).forEach(entry => { out[entry.key] = entry.default; });
  return out;
};

export const sanitiseValue = (entry, raw) => {
  if (raw === null || raw === undefined || raw === '') return entry.default;
  if (entry.key === 'budget' && (raw === Infinity || raw === 'unlimited')) return Infinity;
  const num = Number(raw);
  if (!Number.isFinite(num)) return entry.default;
  if (entry.choices) {
    const hit = entry.choices.find(choice => choice.value === num);
    return hit ? hit.value : entry.default;
  }
  return clamp(num, entry.min, entry.max);
};

export const sanitiseParams = (input, view) => {
  const out = defaultParams(view);
  entriesFor(view).forEach(entry => {
    if (input && Object.prototype.hasOwnProperty.call(input, entry.key)) out[entry.key] = sanitiseValue(entry, input[entry.key]);
  });
  return out;
};

export const paramsToJSON = params => {
  const out = {};
  REGISTRY.forEach(entry => {
    const value = params[entry.key];
    out[entry.key] = value === Infinity ? null : value;
  });
  return out;
};

export const paramsFromJSON = json => {
  const out = defaultParams();
  REGISTRY.forEach(entry => {
    if (json && Object.prototype.hasOwnProperty.call(json, entry.key)) {
      const raw = json[entry.key];
      out[entry.key] = entry.key === 'budget' && raw === null ? Infinity : sanitiseValue(entry, raw);
    }
  });
  return out;
};

export const paramIssues = params => {
  const issues = [];
  if (params.marginModerate > params.marginClear) issues.push({ keys: ['marginModerate', 'marginClear'], message: 'The moderate lead margin is above the clear lead margin, so no lead can count as moderate.' });
  if (params.riskMedium >= params.riskHigh) issues.push({ keys: ['riskMedium', 'riskHigh'], message: 'Medium risk starts at or above high risk, so the medium band is empty.' });
  if (params.shareRoutine + params.shareSoon + params.shareUrgent === 0) issues.push({ keys: ['shareRoutine', 'shareSoon', 'shareUrgent'], message: 'All class shares are 0, so the three urgency classes are treated as equal shares.' });
  return issues;
};

export const ROUTE_PRESETS = Object.freeze({
  Balanced: { wT: 35, wC: 15, wP: 10, wL: 10, wQ: 20, wK: 10 },
  'Urgent-safe': { wT: 55, wC: 5, wP: 5, wL: 10, wQ: 20, wK: 5 },
  'Public-first': { wT: 25, wC: 15, wP: 35, wL: 10, wQ: 10, wK: 5 },
  'Cost saver': { wT: 25, wC: 40, wP: 10, wL: 10, wQ: 10, wK: 5 }
});

export const FIX_PRESETS = Object.freeze({
  Balanced: { fwR: 40, fwO: 30, fwP: 20, fwB: 10 },
  'Risk first': { fwR: 65, fwO: 15, fwP: 15, fwB: 5 },
  'Flow first': { fwR: 20, fwO: 50, fwP: 25, fwB: 5 }
});

export const presetMatches = (preset, params, keys) => keys.every(key => preset[key] === params[key]);
