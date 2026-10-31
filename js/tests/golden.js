import { erlangC, waitAllenCunneen, priorityWaits } from '../core/queue.js';
import { timeScore, costScore, shrinkQuality } from '../core/score.js';
import { percentile, haversineKm } from '../core/stats.js';
import { defaultParams } from '../core/params.js';
import { prepareRouting, routePatient } from '../core/route.js';
import { riskValue } from '../core/risk.js';
import { runFlow } from '../core/flow.js';

const baseService = id => ({ id, name: id, price: 100, complexity: 1 });

const baseFacility = (id, over) => ({
  id, name: id, tier: 'public', x: 0, y: 0, services: ['svc'], capacity: 50, multiplier: 1,
  referrals: 0, waitlist: 0, quality: 0.8, reviews: 100, ...over
});

export const register = t => {
  t.test('G1 Erlang C c=1 a=0.5 and M/M/1 wait', () => {
    t.near(erlangC(1, 0.5), 0.5);
    t.near(waitAllenCunneen(0.5, 1, 1, 1, 1), 1.0);
  });

  t.test('G2 Erlang C c=2 a=1.6 and wait', () => {
    t.near(erlangC(2, 1.6), 0.71111);
    t.near(waitAllenCunneen(1.6, 2, 1, 1, 1), 1.77778);
    const rho = 0.8;
    t.near(2 * rho * rho / (1 + rho), 0.71111);
  });

  t.test('G3 Allen-Cunneen c=2 a=1.6 ca2=1 cs2=0.5', () => {
    t.near(waitAllenCunneen(1.6, 2, 1, 1, 0.5), 1.33333);
  });

  t.test('G4 priority waits conserve FCFS wait', () => {
    const w = priorityWaits(0.5, 1, 1, 1, 1, [0.2, 0.8]);
    t.near(w[0], 0.55556);
    t.near(w[1], 1.11111);
    t.near(0.2 * w[0] + 0.8 * w[1], 1.0);
  });

  t.test('G5 half-life time score', () => {
    t.near(timeScore(3.7, 3.7), 0.5, 1e-12);
    t.near(timeScore(0, 3.7), 1, 1e-12);
  });

  t.test('G6 travel to time-to-care and time score', () => {
    const params = defaultParams('route');
    const data = {
      services: [baseService('svc')],
      facilities: [baseFacility('f1', { x: 34.61538, y: 0 })],
      patients: [],
      travel: []
    };
    const model = prepareRouting(data, params);
    const patient = { id: 'p', name: 'p', x: 0, y: 0, needs: ['svc'], urgency: 1, previous: '' };
    const result = routePatient(model, patient);
    const row = result.rows[0];
    t.near(row.km, 45, 1e-4);
    t.near(row.ttc, 0.041667);
    t.near(row.s.T, 0.985663);
  });

  t.test('G7 haversine one degree of longitude at the equator', () => {
    t.near(haversineKm(0, 0, 0, 1), 111.1951, 1e-3);
  });

  t.test('G8 cost scaling with P10 and P90', () => {
    const multipliers = [1, 1.5, 2];
    const low = percentile(multipliers, 10);
    const high = percentile(multipliers, 90);
    t.near(low, 1.1);
    t.near(high, 1.9);
    t.same(multipliers.map(m => costScore(m, low, high)), [1, 0.5, 0]);
  });

  t.test('G9 micro routing with cost and public weights only', () => {
    const params = { ...defaultParams('route'), wT: 0, wC: 50, wP: 50, wL: 0, wQ: 0, wK: 0 };
    const data = {
      services: [baseService('svc')],
      facilities: [
        baseFacility('A', { tier: 'public', multiplier: 1 }),
        baseFacility('B', { tier: 'contracted', multiplier: 1.5 }),
        baseFacility('C', { tier: 'private', multiplier: 2 })
      ],
      patients: [],
      travel: []
    };
    const model = prepareRouting(data, params);
    const result = routePatient(model, { id: 'p', name: 'p', x: 0, y: 0, needs: ['svc'], urgency: 0, previous: '' });
    const byId = Object.fromEntries(result.rows.map(r => [r.id, r.total]));
    t.near(byId.A, 1.0);
    t.near(byId.B, 0.55);
    t.near(byId.C, 0.125);
    t.same(result.ranked[0].id, 'A');
    t.near(result.margin, 0.45);
  });

  t.test('G10 quality shrinkage', () => {
    t.near(shrinkQuality(50, 0.9, 50, 0.8), 0.85);
    t.near(shrinkQuality(0, 0.9, 50, 0.8), 0.8);
  });

  t.test('G11 weak point risk value', () => {
    const params = defaultParams('clinic');
    t.near(riskValue(4, 5, 4, 1, 0.95, 0.5, params), 60.0, 1e-9);
  });

  t.test('G12 fluid station backlog and downstream arrivals', () => {
    const params = { ...defaultParams('clinic'), bucketMin: 60, season: 1 };
    const site = {
      id: 'g12',
      hours: [8, 9, 10, 11],
      arrivals: [3, 3, 0, 0],
      arrivalCv2: [1, 1, 1, 1],
      stations: [
        { id: 'a', name: 'a', serviceMin: 30, csSq: 0.5, servers: [1, 1, 1, 1] },
        { id: 'b', name: 'b', serviceMin: 1, csSq: 0.5, servers: [50, 50, 50, 50] }
      ],
      routes: [{ from: 'in', to: 'a', share: 1 }, { from: 'a', to: 'b', share: 1 }],
      weakPoints: [],
      fixes: [],
      effects: []
    };
    const flow = runFlow(site, params);
    const a = flow.stations.find(s => s.id === 'a');
    const b = flow.stations.find(s => s.id === 'b');
    t.same(Array.from(a.dep), [2, 2, 2, 0]);
    t.same(Array.from(a.bk), [1, 2, 0, 0]);
    t.same(Array.from(b.lam), [1, 2, 2, 1]);
    t.near(Array.from(b.lam).reduce((x, y) => x + y, 0), 6, 1e-12);
  });
};
