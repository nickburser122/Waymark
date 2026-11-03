import { runFlow } from './flow.js';
import { weakPointRisks } from './risk.js';
import { normaliseWeights } from './score.js';
import { sum, tieKey, compareText } from './stats.js';
import { FIX_PRESETS, paramsToJSON } from './params.js';
import { canonical } from './hash.js';

const EPSILON = 1e-12;

export const RESOURCE_KEYS = Object.freeze(['space', 'budget', 'staff', 'approval']);

export const defaultResources = () => ({ space: true, budget: true, staff: true, approval: true });

export const MARK_LABELS = Object.freeze(['Available', 'Tried, no effect', 'Other blocker']);

const resourcesOf = opts => ({ ...defaultResources(), ...((opts && opts.resources) || {}) });

const markOf = (opts, site, fixId) => {
  const marks = (opts && opts.marks) || {};
  const forSite = Object.entries(marks).find(([key]) => key === site.id);
  const entry = forSite ? Object.entries(forSite[1] || {}).find(([key]) => key === fixId) : null;
  return entry && (entry[1] === 1 || entry[1] === 2) ? entry[1] : 0;
};

export const fixBlockers = (site, fix, opts) => {
  const resources = resourcesOf(opts);
  const reasons = (fix.needs || []).filter(need => resources[need] === false).map(need => `Needs ${need}, which is switched off`);
  const mark = markOf(opts, site, fix.id);
  if (mark === 1) reasons.push('Tried before, no effect');
  if (mark === 2) reasons.push('Other blocker');
  return reasons;
};

export const phaseOf = (index, feasibleCount) => {
  if (feasibleCount <= 0) return 'Later';
  const third = feasibleCount / 3;
  if (index < third) return 'Now';
  if (index < 2 * third) return 'Next';
  return 'Later';
};

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

export const rankFixes = (site, appliedIds, params, baseState, opts = {}) => {
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
    const hasEffect = x.dR > EPSILON || x.dPMW > EPSILON;
    const blockedBy = fixBlockers(site, x.fix, opts);
    const feasible = blockedBy.length === 0;
    if (!feasible && !hasEffect) blockedBy.push('Removes no risk or waiting');
    return { ...x, s, parts, value, priority, cost: x.fix.cost, hasEffect, feasible, blockedBy };
  });
  const order = (a, b) => (tieKey(a.priority) !== tieKey(b.priority) ? tieKey(b.priority) - tieKey(a.priority) : compareText(a.fix.id, b.fix.id));
  items.sort(order);
  return { base, items: items.filter(item => item.feasible), blocked: items.filter(item => !item.feasible) };
};

export const autoPlan = (site, appliedIds, params, opts = {}) => {
  let applied = appliedIds.slice();
  let remaining = params.budget;
  let cumulative = 0;
  const steps = [];
  for (;;) {
    const ranking = rankFixes(site, applied, params, undefined, opts);
    const pick = ranking.items.find(item => item.hasEffect && item.cost <= remaining + EPSILON);
    if (!pick) break;
    cumulative += pick.cost;
    remaining -= pick.cost;
    steps.push({
      feasible: true,
      blockedBy: [],
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
  steps.forEach((step, i) => { step.phase = phaseOf(i, steps.length); });
  return { steps, applied, totalCost: cumulative };
};

const governanceCache = new WeakMap();

export const governanceKpis = (site, appliedIds, params, opts = {}) => {
  const key = canonical({ applied: appliedIds, params: paramsToJSON(params), resources: resourcesOf(opts), marks: (opts && opts.marks) || {} });
  let perSite = governanceCache.get(site);
  if (!perSite) {
    perSite = new Map();
    governanceCache.set(site, perSite);
  }
  if (perSite.has(key)) return perSite.get(key);
  const candidates = site.fixes.filter(f => !appliedIds.includes(f.id));
  const feasibleIds = candidates.filter(f => fixBlockers(site, f, opts).length === 0).map(f => f.id);
  const riskNow = evaluateClinic(site, appliedIds, params).totR;
  const riskFeasible = evaluateClinic(site, appliedIds.concat(feasibleIds), params).totR;
  const riskUnlimited = evaluateClinic(site, appliedIds.concat(candidates.map(f => f.id)), params).totR;
  const out = { riskNow, riskFeasible, riskUnlimited, lostToLimits: riskFeasible - riskUnlimited };
  if (perSite.size > 32) perSite.clear();
  perSite.set(key, out);
  return out;
};

export const orderStability = (site, appliedIds, params, opts = {}) => {
  const presets = Object.keys(FIX_PRESETS).map(name => {
    const ranking = rankFixes(site, appliedIds, { ...params, ...FIX_PRESETS[name] }, undefined, opts);
    return { name, top: ranking.items.slice(0, 3).map(item => item.fix) };
  });
  const firsts = presets.map(p => (p.top[0] ? p.top[0].id : ''));
  return { presets, same: firsts.every(id => id === firsts[0]) };
};

export const uncoveredBottlenecks = (flow, site) => {
  const targeted = new Set();
  site.effects.forEach(e => {
    if (e.kind === 'staff' || e.kind === 'speed') targeted.add(e.target);
  });
  return flow.stations
    .filter(st => st.peakRho >= 1 && !targeted.has(st.id))
    .map(st => ({ id: st.id, name: st.name, peakRho: st.peakRho, start: st.peakStart }));
};

export const downstreamOf = (stationId, routes) => {
  const next = new Map();
  routes.forEach(r => {
    if (!next.has(r.from)) next.set(r.from, []);
    next.get(r.from).push(r.to);
  });
  const seen = new Set([stationId]);
  const queue = [stationId];
  const out = [];
  while (queue.length) {
    const current = queue.shift();
    (next.get(current) || []).forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
      queue.push(id);
    });
  }
  return out;
};
