import { clamp } from './stats.js';

export const SCORE_KEYS = ['T', 'C', 'P', 'L', 'Q', 'K'];

export const normaliseWeights = (weights, keys) => {
  const names = keys || Object.keys(weights);
  let total = 0;
  names.forEach(k => { total += weights[k]; });
  const out = {};
  names.forEach(k => { out[k] = total > 0 ? weights[k] / total : 0; });
  return out;
};

export const weightedScore = (gate, weights, subs, keys) => {
  const names = keys || Object.keys(weights);
  const w = normaliseWeights(weights, names);
  const parts = {};
  let total = 0;
  names.forEach(k => {
    parts[k] = w[k] * subs[k];
    total += parts[k];
  });
  return { total: gate ? total : 0, parts, weights: w };
};

export const timeScore = (ttcDays, halfLifeDays) => Math.pow(2, -ttcDays / halfLifeDays);

export const costScore = (multiplier, low, high) => (high === low ? 1 : clamp((high - multiplier) / (high - low), 0, 1));

export const loadScore = utilisation => 1 - Math.pow(Math.min(1, utilisation), 3);

export const shrinkQuality = (reviews, quality, k, prior) => (reviews + k > 0 ? (reviews * quality + k * prior) / (reviews + k) : prior);

export const utilisation = (lambda, backlog, servers, horizon) => (lambda * horizon + backlog + 1) / (servers * horizon);
