import { paramsToJSON, paramsFromJSON, defaultParams } from '../core/params.js';
import { serialiseCSV } from './csv.js';
import { SCORE_KEYS } from '../core/score.js';

export const guardCell = value => {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
};

const round = (value, digits = 4) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : value === Infinity ? '' : value);

export const csvText = (rows, options) => serialiseCSV(rows.map(row => row.map(guardCell)), options);

const URGENCY_NAMES = ['routine', 'soon', 'urgent'];

const gatesText = excluded => Object.keys(excluded || {}).map(g => `${g} ${excluded[g]}`).join('; ');

export const batchCsv = batch => {
  const header = ['patient_id', 'name', 'urgency', 'plan', 'ttc_days', 'travel_km', 'wait_days', 'cost', 'score', 'margin']
    .concat(SCORE_KEYS.map(k => `s_${k}`), SCORE_KEYS.map(k => `p_${k}`), ['gates_failed', 'blocked_needs', 'reason']);
  const rows = batch.results.map(r => {
    const s = r.summary;
    const subs = SCORE_KEYS.map(k => (r.s ? round(r.s[k]) : ''));
    const parts = SCORE_KEYS.map(k => (r.parts ? round(r.parts[k]) : ''));
    return [
      r.id, r.name, URGENCY_NAMES[r.urgency], r.stops.map(stop => stop.id).join('→'),
      s ? round(s.ttc) : '', s ? round(s.km, 1) : '', s ? round(s.wait) : '', s ? round(s.cost, 2) : '',
      s ? round(s.score) : '', r.margin === null || r.margin === undefined ? '' : round(r.margin),
      ...subs, ...parts, gatesText(r.excluded), r.blocked && r.blocked.needs ? r.blocked.needs.join(' ') : '', r.reason
    ];
  });
  return csvText([header, ...rows], { bom: true });
};

const PLAN_HEADER = ['site', 'rank', 'fix_id', 'title', 'delta_R', 'delta_PMW', 'effort', 'cost_k', 'priority', 'cumulative_cost_k', 'phase', 'feasible', 'blocked_by'];

export const plansCsv = plans => {
  const rows = [];
  plans.forEach(({ siteId, steps }) => steps.forEach(step => rows.push([siteId, step.rank, step.fix.id, step.fix.title, round(step.dR, 3), round(step.dPMW, 1), step.effort, step.cost, round(step.priority, 4), step.cumulative, step.phase || '', step.feasible === false ? 'no' : 'yes', (step.blockedBy || []).join('; ')])));
  return csvText([PLAN_HEADER, ...rows], { bom: true });
};

export const planCsv = (siteId, steps) => plansCsv([{ siteId, steps }]);

export const paramsJson = params => JSON.stringify(paramsToJSON(params), null, 2);

export const bundleJson = ({ tables, params, results }) => JSON.stringify({ version: 3, data: tables, params: paramsToJSON(params), results: results || null }, null, 2);

export const parseParamsFile = text => {
  let value;
  try { value = JSON.parse(text); } catch (e) { return { error: 'This file is not valid JSON.' }; }
  if (!value || typeof value !== 'object') return { error: 'This file has no parameters.' };
  const source = value.params && typeof value.params === 'object' ? value.params : value;
  const registryKeys = Object.keys(paramsToJSON(defaultParams()));
  const known = Object.keys(source).filter(k => registryKeys.includes(k));
  if (!known.length) return { error: 'No Waymark parameters were found in this file.' };
  return { params: paramsFromJSON(source) };
};
