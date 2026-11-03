import { SCORE_KEYS } from '../core/score.js';
import { gateReasons } from '../core/route.js';
import { ENGINE_VERSION } from '../core/version.js';
import { URGENCY_NAMES } from '../core/params.js';
import { fmtNum } from '../core/stats.js';

export const mdCell = s => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

const serviceLabel = (model, id) => (model.services.has(id) ? model.services.get(id).name : id);

const num = (value, digits = 2) => (Number.isFinite(value) ? Number(value).toFixed(digits) : '—');

export const decisionRecord = ({ model, result, patient, params, runId, fingerprint, generatedAt, override = null, robustness = null, presetName = 'Custom', decisive = '', publicLock = '' }) => {
  const cfg = model.cfg;
  const wn = result.wn;
  const u = result.pp.urgency;
  const lines = [];
  lines.push(`# Referral decision — ${mdCell(patient.name || patient.id)}`);
  lines.push('');
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Engine version: ${ENGINE_VERSION}`);
  lines.push(`- Run ID: \`${runId}\``);
  lines.push(`- Data fingerprint: \`${fingerprint}\``);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- Patient: ${mdCell(patient.id)}`);
  lines.push(`- Needs: ${result.pp.needs.map(n => mdCell(serviceLabel(model, n))).join(', ') || 'none'}`);
  lines.push(`- Urgency: ${URGENCY_NAMES[u]}`);
  const located = Number.isFinite(patient.lat) && Number.isFinite(patient.lon)
    ? `${num(patient.lat, 4)}, ${num(patient.lon, 4)}`
    : Number.isFinite(patient.x) && Number.isFinite(patient.y) ? `${num(patient.x, 1)}, ${num(patient.y, 1)} km` : 'travel table';
  lines.push(`- Location: ${located}`);
  lines.push(`- Previously treated at: ${patient.previous ? mdCell(patient.previous) : 'none'}`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push(`- Preset: ${mdCell(presetName)}`);
  lines.push(`- Weights T·C·P·L·Q·K: ${SCORE_KEYS.map(k => num(wn[k], 3)).join(' · ')}`);
  lines.push(`- Reach R: ${fmtNum(cfg.reach[u])} km, deadline D: ${fmtNum(cfg.deadline[u])} d, half-life τ: ${fmtNum(cfg.tau[u])} d`);
  lines.push(`- Load limit ρ_max: ${fmtNum(cfg.rhoMax)}, horizon H: ${fmtNum(cfg.horizon)} d`);
  lines.push(`- Public lock: ${publicLock || 'off'}`);
  lines.push('');
  lines.push('## Outcome');
  lines.push('');
  lines.push(`- Status: ${result.status}`);
  if (result.summary) {
    lines.push(`- Site: ${result.stops.map(s => mdCell(s.row.facility.name)).join(' + ')}`);
    lines.push(`- Time to care: ${num(result.summary.ttc, 1)} d`);
    lines.push(`- Wait: ${num(result.summary.wait, 1)} d`);
    lines.push(`- Road: ${Math.round(result.summary.km)} km`);
    lines.push(`- Cost: ${num(result.summary.cost, 0)}`);
    lines.push(`- Score: ${num(result.summary.score, 3)}`);
  } else {
    lines.push(`- Reason: ${mdCell(result.blocked ? result.blocked.reason : 'No site passes the gates')}`);
  }
  lines.push(`- Margin: ${result.margin === null ? '—' : num(result.margin, 3)}`);
  lines.push(`- Confidence: ${result.confidence}`);
  if (robustness) {
    lines.push(`- Robustness: ${robustness.only ? 'only option' : robustness.holds ? `holds under ±${fmtNum(cfg.robustStep)} point shifts` : `flips to ${mdCell(robustness.flip.to.name)} if ${robustness.flip.name} ${robustness.flip.direction > 0 ? '+' : '−'}${fmtNum(robustness.flip.step)}`}`);
  }
  if (decisive) lines.push(`- Decisive term: ${mdCell(decisive)}`);
  if (override) {
    lines.push('');
    lines.push('## Override');
    lines.push('');
    lines.push(`- Verdict: ${mdCell(override.verdict)}`);
    (override.rules || []).forEach(rule => lines.push(`- ${rule.ok ? 'Pass' : 'Fail'}: ${mdCell(rule.label)} (${mdCell(rule.detail)})`));
  }
  lines.push('');
  lines.push('## Ranking');
  lines.push('');
  lines.push('| # | Site | Tier | Score | T | C | P | L | Q | K | km | TTC |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  result.ranked.slice(0, 10).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${mdCell(r.facility.name)} | ${mdCell(r.facility.tier)} | ${num(r.total, 3)} | ${SCORE_KEYS.map(k => num(r.s[k], 2)).join(' | ')} | ${Math.round(r.km)} | ${num(r.ttc, 1)} |`);
  });
  if (!result.ranked.length) lines.push('| — | No site passes every gate | | | | | | | | | | |');
  lines.push('');
  lines.push('## Excluded');
  lines.push('');
  lines.push('| Site | Reasons |');
  lines.push('| --- | --- |');
  const excluded = result.rows.filter(r => !r.G);
  excluded.forEach(r => lines.push(`| ${mdCell(r.facility.name)} | ${mdCell(gateReasons(model, result.pp, r).join('; '))} |`));
  if (!excluded.length) lines.push('| — | None |');
  lines.push('');
  return lines.join('\n');
};
