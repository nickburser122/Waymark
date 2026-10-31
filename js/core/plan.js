import { runFlow } from './flow.js';
import { weakPointRisks } from './risk.js';
import { normaliseWeights } from './score.js';
import { sum, tieKey, compareText } from './stats.js';

const EPSILON = 1e-12;

export const applyFixes = (site, fixIds) => {
  const chosen = new Set(fixIds);
  const stations = site.stations.map(st => ({ ...st, servers: st.servers.slice() }));
  const byId = new Map(stations.map(st => [st.id, st]));
  const adjust = new Map();
  site.effects.filter(e => chosen.has(e.fix)).forEach(e => {
    if (e.kind === 'staff') {
      const st = byId.get(e.target);
      if (!st) return;
      site.hours.forEach((h, i) => {
        if ((e.from === null || e.from === undefined || h >= e.from) && (e.to === null || e.to === undefined || h < e.to)) {
          st.servers[i] = Math.max(0, st.servers[i] + e.delta);
        }
      });
    } else if (e.kind === 'speed') {
      const st = byId.get(e.target);
      if (st) st.serviceMin *= e.delta;
    } else if (e.kind === 'risk') {
      const current = adjust.get(e.target) || {};
      current[e.field] = (current[e.field] || 0) + e.delta;
      adjust.set(e.target, current);
    }
  });
  return { site: { ...site, stations }, adjust };
};

export const evaluateClinic = (site, fixIds, params) => {
  const applied = applyFixes(site, fixIds);
  const flow = runFlow(applied.site, params);
  const risks = weakPointRisks(applied.site, flow, params, applied.adjust);
  return { flow, risks, totR: sum(risks.map(r => r.r)), pmw: flow.pmw, site: applied.site };
};

const touchedStations = (site, fix) => {
  const out = new Set();
  const weakStation = new Map(site.weakPoints.map(wp => [wp.id, wp.station]));
  site.effects.filter(e => e.fix === fix.id).forEach(e => {
    if (e.kind === 'risk') {
      if (weakStation.has(e.target)) out.add(weakStation.get(e.target));
    } else {
      out.add(e.target);
    }
  });
  return out;
};

export const fixWeights = params => normaliseWeights({ R: params.fwR, O: params.fwO, P: params.fwP, B: params.fwB }, ['R', 'O', 'P', 'B']);

export const rankFixes = (site, appliedIds, params, baseState) => {
  const base = baseState || evaluateClinic(site, appliedIds, params);
  const wn = fixWeights(params);
  const candidates = site.fixes.filter(f => !appliedIds.includes(f.id));
  const baseRisk = new Map(base.risks.map(r => [r.id, r.r]));
  const dailyOf = new Map(base.flow.stations.map(st => [st.id, st.daily]));
  const raw = candidates.map(fix => {
    const after = evaluateClinic(site, appliedIds.concat(fix.id), params);
    const dR = base.totR - after.totR;
    const dPMW = base.pmw - after.pmw;
    const touched = touchedStations(site, fix);
    let reach = 0;
    touched.forEach(id => {
      if (base.flow.entryDaily > 0) reach = Math.max(reach, (dailyOf.get(id) || 0) / base.flow.entryDaily);
    });
    const breadth = after.risks.filter(r => Math.abs(baseRisk.get(r.id) - r.r) > 1e-9).length;
    return { fix, dR, dPMW, reach: Math.min(1, reach), breadth };
  });
  const maxR = Math.max(0, ...raw.map(x => x.dR));
  const maxO = Math.max(0, ...raw.map(x => x.dPMW));
  const maxB = Math.max(0, ...raw.map(x => x.breadth));
  const items = raw.map(x => {
    const s = {
      R: maxR > 0 ? Math.max(0, x.dR) / maxR : 0,
      O: maxO > 0 ? Math.max(0, x.dPMW) / maxO : 0,
      P: x.reach,
      B: maxB > 0 ? x.breadth / maxB : 0
    };
    const parts = { R: wn.R * s.R, O: wn.O * s.O, P: wn.P * s.P, B: wn.B * s.B };
    const value = parts.R + parts.O + parts.P + parts.B;
    const priority = value / Math.pow(x.fix.effort, params.alpha) / Math.pow(1 + x.fix.cost / params.costRef, params.gamma);
    return { ...x, s, parts, value, priority, cost: x.fix.cost, hasEffect: x.dR > EPSILON || x.dPMW > EPSILON };
  });
  items.sort((a, b) => (tieKey(a.priority) !== tieKey(b.priority) ? tieKey(b.priority) - tieKey(a.priority) : compareText(a.fix.id, b.fix.id)));
  return { base, items };
};

export const autoPlan = (site, appliedIds, params) => {
  let applied = appliedIds.slice();
  let remaining = params.budget;
  let cumulative = 0;
  const steps = [];
  for (;;) {
    const ranking = rankFixes(site, applied, params);
    const pick = ranking.items.find(item => item.hasEffect && item.cost <= remaining + EPSILON);
    if (!pick) break;
    cumulative += pick.cost;
    remaining -= pick.cost;
    steps.push({
      rank: steps.length + 1,
      fix: pick.fix,
      dR: pick.dR,
      dPMW: pick.dPMW,
      priority: pick.priority,
      effort: pick.fix.effort,
      cost: pick.cost,
      cumulative
    });
    applied = applied.concat(pick.fix.id);
  }
  return { steps, applied, totalCost: cumulative };
};
