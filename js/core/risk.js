import { clamp } from './stats.js';

export const bandOf = (value, params) => (value >= params.riskHigh ? 'high' : value >= params.riskMedium ? 'medium' : 'low');

export const riskValue = (I, F, P, D, rhoPeak, share, params) =>
  I * F * Math.sqrt(P * D) * (1 + params.kappa * Math.max(0, rhoPeak - params.rhoStar)) * (1 + params.deltaShare * share);

export const clampRating = value => clamp(value, 1, 5);

export const weakPointRisks = (site, flow, params, adjust) => {
  const byId = new Map(flow.stations.map(st => [st.id, st]));
  return site.weakPoints.map(wp => {
    const delta = (adjust && adjust.get(wp.id)) || {};
    const I = clampRating(wp.I + (delta.I || 0));
    const F = clampRating(wp.F + (delta.F || 0));
    const P = clampRating(wp.P + (delta.P || 0));
    const D = clampRating(wp.D + (delta.D || 0));
    const station = byId.get(wp.station);
    const peak = station ? Math.min(params.rhoClip, station.peakRho) : 0;
    const share = station && flow.entryDaily > 0 ? station.daily / flow.entryDaily : 0;
    const over = Math.max(0, peak - params.rhoStar);
    const r = riskValue(I, F, P, D, peak, share, params);
    return {
      id: wp.id,
      station: wp.station,
      title: wp.title,
      I, F, P, D,
      peak,
      share,
      over,
      boost: (1 + params.kappa * over) * (1 + params.deltaShare * share),
      r,
      band: bandOf(r, params)
    };
  });
};
