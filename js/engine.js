const W = {};

W.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
W.sum = a => a.reduce((x, y) => x + y, 0);
W.queueWait = (lam, c, s, ca2 = 1, cs2 = 0.5) => {
  if (c <= 0) return lam > 0 ? Infinity : 0;
  const rho = lam * s / c;
  if (rho >= 0.98) return Infinity;
  return Math.pow(rho, Math.sqrt(2 * (c + 1)) - 1) / (c * (1 - rho)) * (ca2 + cs2) / 2 * s;
};
W.normW = w => { const t = W.sum(Object.values(w)) || 1; const o = {}; for (const k in w) o[k] = w[k] / t; return o; };
W.score = (gate, w, s) => { let tot = 0; const part = {}; for (const k in w) { part[k] = w[k] * s[k]; tot += part[k]; } return { total: gate ? tot : 0, part }; };

W.SERVICES = { lab: ['Lab', 12, .3], xray: ['X-ray', 25, .4], mri: ['MRI/CT', 140, 1.6], cardio: ['Cardiology', 60, 1.1], dialysis: ['Dialysis', 90, .5], physio: ['Physio', 22, .9], ortho: ['Ortho', 55, 1.2], onco: ['Oncology', 180, 1.5], mater: ['Maternity', 120, .7], peds: ['Pediatrics', 30, .5] };
W.PLACES = [['Sarema', 34, 30, 1], ['Oud Harbor', 92, 22, 1], ['Kestrel', 70, 60, 1], ['Almond Row', 12, 16], ['Marigold', 14, 38], ['Fenwick', 22, 56], ['Thistledown', 52, 10], ['Willow Bend', 64, 30], ['Bramble Ford', 52, 42], ['Saffron Hill', 82, 44], ['Linden', 108, 46], ['Quill', 110, 8], ['Pebble Creek', 102, 70], ['Cedar Nook', 32, 70], ['Tamarind', 48, 62]];
W.ROADS = [[3, 4], [3, 0], [4, 0], [4, 5], [5, 0], [0, 6], [0, 8], [6, 7], [7, 1], [7, 8], [8, 9], [8, 14], [9, 2], [9, 10], [9, 1], [1, 11], [10, 12], [2, 12], [2, 14], [5, 13], [13, 14]];
W.FAC = [
  ['sag', 'Sarema General', 'public', 29, 27, 'lab xray mri cardio dialysis ortho mater peds physio', 60, 51, .95, .78, 900],
  ['ntg', 'Northgate Teaching', 'public', 88, 18, 'lab xray mri cardio ortho mater peds physio onco', 70, 44, 1, .86, 1200],
  ['krh', 'Kestrel Regional', 'public', 66, 58, 'lab xray mri cardio dialysis ortho mater peds', 50, 21, .95, .74, 600],
  ['bfh', 'Bramble Ford HC', 'public', 52, 42, 'lab xray peds mater physio', 24, 9, .9, .66, 140],
  ['aru', 'Almond Row Unit', 'public', 12, 16, 'lab peds mater', 14, 6, .9, .6, 40],
  ['fcc', 'Fenwick Clinic', 'public', 22, 56, 'lab xray physio peds', 18, 15, .9, .63, 90],
  ['lcu', 'Linden Care Unit', 'public', 108, 46, 'dialysis lab cardio', 16, 7, 1, .7, 70],
  ['pcu', 'Pebble Creek Unit', 'public', 102, 70, 'lab xray peds mater physio', 16, 5, .9, .62, 50],
  ['tdu', 'Thistledown Unit', 'public', 52, 10, 'lab peds', 10, 3, .9, .58, 20],
  ['hhv', 'Harbor Heart', 'contracted', 97, 27, 'cardio lab xray mri', 30, 14, 1.5, .9, 300],
  ['shl', 'Saffron Labs', 'contracted', 82, 44, 'lab xray mri', 40, 22, 1.35, .84, 400],
  ['wbr', 'Willow Rehab', 'contracted', 64, 29, 'physio ortho xray', 26, 10, 1.4, .82, 160],
  ['srp', 'Sarema Renal', 'contracted', 38, 34, 'dialysis lab', 20, 9, 1.55, .83, 120],
  ['tom', 'Tamarind Onco', 'contracted', 46, 63, 'onco mri lab xray', 24, 11, 1.65, .88, 180],
  ['sgc', 'Sarema Grand', 'private', 39, 23, 'lab xray mri cardio ortho mater peds physio dialysis', 36, 15, 2.4, .94, 250],
  ['mwc', 'Marigold Care', 'private', 14, 38, 'mater peds lab xray', 14, 5, 2.2, .92, 30],
  ['kbh', 'Kestrel Bayview', 'private', 76, 64, 'cardio mri ortho onco lab xray mater', 30, 12, 2.7, .95, 200],
  ['hiu', 'Harbor Imaging', 'private', 106, 15, 'mri xray lab', 22, 8, 2.3, .9, 60]
].map(a => ({ id: a[0], name: a[1], tier: a[2], x: a[3], y: a[4], svc: a[5].split(' '), cap: a[6], load: a[7], m: a[8], q: a[9], n: a[10] }));
W.CASES = [
  ['Ada', 'Cardiac follow-up', 3, ['cardio', 'lab'], 0, 'sag'], ['Priya', 'Maternity check', 4, ['mater', 'lab'], 0, ''],
  ['Mateo', 'Dialysis session', 9, ['dialysis'], 1, 'lcu'], ['Jonas', 'Child, wheeze', 6, ['peds', 'xray'], 2, ''],
  ['Noor', 'Oncology work-up', 10, ['onco', 'mri', 'lab'], 1, ''], ['Sam', 'Two rare needs', 5, ['onco', 'dialysis'], 1, '']
].map(a => ({ name: a[0], blurb: a[1], x: W.PLACES[a[2]][1], y: W.PLACES[a[2]][2], svc: a[3], urg: a[4], prev: a[5] }));
W.R_TERMS = [
  ['T', 'Time-to-care', 'travel + queue wait vs. urgency target', '#D4704E'],
  ['C', 'Cost', 'price multiplier, cheaper scores higher', '#CFA24F'],
  ['P', 'Public-first', 'tier preference of the payer', '#4F978F'],
  ['L', 'Load balance', 'headroom after this patient joins', '#618BB0'],
  ['Q', 'Quality', 'Bayesian-shrunk outcome rating', '#857DBE'],
  ['K', 'Continuity', 'patient already known there', '#C27C93']
];
W.R_POLICIES = { Balanced: { T: 30, C: 15, P: 15, L: 15, Q: 15, K: 10 }, 'Urgent-safe': { T: 50, C: 5, P: 5, L: 15, Q: 20, K: 5 }, 'Public-first': { T: 20, C: 15, P: 35, L: 15, Q: 10, K: 5 }, 'Cost saver': { T: 20, C: 40, P: 15, L: 10, Q: 10, K: 5 } };
W.RCFG = { road: 1.3, speed: 45, tier: { public: 1, contracted: .6, private: .25 }, mMin: .9, mMax: 2.8, target: [7, 2, .25], reach: [120, 90, 60], qPrior: .75, qK: 100, cs2: .5 };

W.route = (p, wRaw, extraLoad = {}) => {
  const C = W.RCFG, u = p.urg, w = W.normW(wRaw);
  const rows = W.FAC.map(f => {
    const load = f.load + (extraLoad[f.id] || 0), lamDay = load + 1;
    const km = Math.hypot(p.x - f.x, p.y - f.y) * C.road;
    const travelH = km / C.speed;
    const sMult = Math.max(...p.svc.map(s => W.SERVICES[s][2]));
    const rho = lamDay / f.cap;
    const waitD = W.queueWait(lamDay, f.cap, 1, 1, C.cs2) * sMult * (u === 2 ? .15 : 1);
    const ttc = travelH / 24 + waitD;
    const covers = p.svc.every(s => f.svc.includes(s));
    const gates = { covers, seat: rho < .98, reach: km <= C.reach[u] };
    const G = gates.covers && gates.seat && gates.reach;
    const qHat = (f.n * f.q + C.qK * C.qPrior) / (f.n + C.qK);
    const s = {
      T: Math.exp(-ttc / C.target[u]),
      C: W.clamp((C.mMax - f.m) / (C.mMax - C.mMin), 0, 1),
      P: C.tier[f.tier],
      L: 1 - Math.pow(Math.min(rho, 1), 3),
      Q: qHat,
      K: p.prev === f.id ? 1 : 0
    };
    const sc = W.score(G, w, s);
    const cost = W.sum(p.svc.map(x => W.SERVICES[x][0] && W.SERVICES[x][1])) * f.m;
    return { f, km, travelH, rho, waitD, ttc, gates, G, s, qHat, ...sc, cost, why: !gates.covers ? 'missing ' + p.svc.filter(s => !f.svc.includes(s)).map(s => W.SERVICES[s][0]).join(', ') : !gates.seat ? 'no free slot' : !gates.reach ? Math.round(km) + ' km > reach ' + C.reach[u] : '' };
  });
  const ok = rows.filter(r => r.G).sort((a, b) => b.total - a.total);
  let plan = ok.length ? [{ r: ok[0], svc: p.svc }] : [];
  if (!ok.length) {
    let rem = p.svc.slice(); const used = new Set();
    while (rem.length) {
      let best = null, bv = 0;
      rows.forEach(r => { if (used.has(r.f.id) || !r.gates.seat || !r.gates.reach) return; const g = rem.filter(s => r.f.svc.includes(s)); const v = W.score(1, w, r.s).total * g.length; if (v > bv) { bv = v; best = { r, svc: g }; } });
      if (!best) break; used.add(best.r.f.id); plan.push(best); rem = rem.filter(s => !best.svc.includes(s));
    }
  }
  const margin = ok.length > 1 ? ok[0].total - ok[1].total : null;
  return { rows, ok, plan, w, margin };
};

W.HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
W.ARR = [42, 70, 75, 60, 45, 26, 10, 20, 30, 26, 16, 6];
W.ST = [
  ['rec', 'Reception', [['in', 1]], [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1], 1.6, .4],
  ['tri', 'Triage', [['rec', .85]], [2, 3, 3, 3, 2, 2, 1, 1, 2, 2, 1, 1], 3, .6],
  ['rcd', 'Records', [['rec', .35]], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0], 4, .8],
  ['exm', 'GP exam', [['tri', 1], ['rcd', .1]], [6, 8, 8, 8, 6, 5, 3, 4, 5, 5, 3, 2], 9, .9],
  ['lab', 'Lab draw', [['exm', .38]], [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0], 5, .5],
  ['img', 'Imaging', [['exm', .14]], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0], 12, 1],
  ['pha', 'Pharmacy', [['exm', .72], ['lab', .2]], [2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1], 3.5, .6],
  ['bil', 'Billing', [['pha', .6], ['img', .9]], [1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1], 2.5, .5]
].map(a => ({ id: a[0], name: a[1], from: a[2], c: a[3], s: a[4], cs2: a[5] }));
W.WEAK = [
  ['w1', 'rec', 'Single queue for new + returning', 3, 5, 1, 2], ['w2', 'tri', 'Triage nurse covers ward round 10–11', 4, 4, 2, 3],
  ['w3', 'rcd', 'Paper files not found', 4, 4, 4, 4], ['w4', 'exm', 'Doctors start late after rounds', 4, 5, 2, 3],
  ['w5', 'lab', 'Analyser outage, no backup', 5, 2, 5, 3], ['w6', 'img', 'One radiographer, no cover', 5, 3, 3, 2],
  ['w7', 'pha', 'Stock-outs discovered at counter', 3, 4, 4, 4], ['w8', 'bil', 'Card terminal drops internet', 3, 4, 5, 3]
].map(a => ({ id: a[0], st: a[1], title: a[2], I: a[3], F: a[4], P: a[5], D: a[6] }));
W.FIXES = [
  ['f1', 'Split fast-lane for returning patients', 1, 2, { w1: { F: -2 } }, { rec: 1 }],
  ['f2', 'Float nurse 9–12 for triage', 2, 18, { w2: { F: -3 } }, { tri: 1 }],
  ['f3', 'Digitise active records', 3, 40, { w3: { F: -3, D: -2 } }, {}],
  ['f4', 'Stagger ward rounds, protect clinic start', 1, 0, { w4: { F: -3 } }, { exm: 1 }],
  ['f5', 'Backup analyser contract', 2, 25, { w5: { I: -3 } }, {}],
  ['f6', 'Cross-train a 2nd radiographer', 2, 6, { w6: { I: -2, F: -1 } }, { img: 1 }],
  ['f7', 'Daily stock dashboard', 1, 3, { w7: { P: -3, D: -2 } }, {}],
  ['f8', '4G failover router + cash fallback', 1, 1, { w8: { I: -2, P: -1 } }, {}]
].map(a => ({ id: a[0], title: a[1], effort: a[2], cost: a[3], adj: a[4], add: a[5] }));
W.F_TERMS = [
  ['R', 'Risk removed', 'ΔRPN of the weak points it fixes, scaled', '#D4704E'],
  ['P', 'Patient reach', 'share of daily patients passing its station', '#618BB0'],
  ['O', 'Overload relief', 'peak wait minutes it removes, scaled', '#4F978F'],
  ['B', 'Breadth', 'weak points it touches, scaled', '#857DBE']
];
W.F_POLICIES = { Balanced: { R: 40, P: 20, O: 30, B: 10 }, 'Risk first': { R: 65, P: 15, O: 15, B: 5 }, 'Flow first': { R: 20, P: 25, O: 50, B: 5 } };

W.flow = (season = 1, extra = {}) => {
  const lam = {}; const res = [];
  W.ST.forEach(st => {
    lam[st.id] = W.HOURS.map((_, h) => W.sum(st.from.map(([f, sh]) => (f === 'in' ? W.ARR[h] * season : lam[f][h]) * sh)));
    let back = 0;
    const hrs = W.HOURS.map((_, h) => {
      const c = st.c[h] + (extra[st.id] && h < 6 ? extra[st.id] : 0);
      const mu = 60 / st.s, capH = c * mu, inn = lam[st.id][h] + back;
      const rho = capH ? lam[st.id][h] / capH : (inn ? 2 : 0);
      back = Math.max(0, inn - capH);
      const wq = (rho < .98 && c ? W.queueWait(lam[st.id][h] / 60, c, st.s, 1, st.cs2) : 0) + (capH ? back / capH * 60 : back ? 240 : 0);
      return { lam: lam[st.id][h], c, rho, wq: Math.min(240, wq) };
    });
    const pk = hrs.reduce((a, b) => b.rho > a.rho ? b : a);
    res.push({ st, hrs, daily: W.sum(lam[st.id]), peakRho: pk.rho, peakWait: Math.max(...hrs.map(x => x.wq)), peakH: W.HOURS[hrs.indexOf(pk)] });
  });
  return res;
};
W.RCF = { kappa: 2, delta: .5 };
W.risk = (wk, fl, adj = {}) => {
  const I = Math.max(1, wk.I + (adj.I || 0)), F = Math.max(1, wk.F + (adj.F || 0)), P = Math.max(1, wk.P + (adj.P || 0)), D = Math.max(1, wk.D + (adj.D || 0));
  const s = fl.find(x => x.st.id === wk.st), tot = fl[0].daily;
  const over = Math.max(0, s.peakRho - .85), down = s.daily / tot;
  const base = I * F * P;
  return { I, F, P, D, base, over, down, r: base * Math.sqrt(D) * (1 + W.RCF.kappa * over) * (1 + W.RCF.delta * down) };
};
W.prioritise = (season, wRaw, applied) => {
  const w = W.normW(wRaw);
  const extraOf = ids => { const e = {}; ids.forEach(id => { const f = W.FIXES.find(x => x.id === id); for (const k in f.add) e[k] = (e[k] || 0) + f.add[k]; }); return e; };
  const adjOf = ids => { const a = {}; ids.forEach(id => { const f = W.FIXES.find(x => x.id === id); for (const k in f.adj) { a[k] = a[k] || {}; for (const d in f.adj[k]) a[k][d] = (a[k][d] || 0) + f.adj[k][d]; } }); return a; };
  const base = W.flow(season, extraOf(applied)), adjB = adjOf(applied);
  const riskOf = (fl, adj) => W.WEAK.map(wk => W.risk(wk, fl, adj[wk.id]));
  const R0 = riskOf(base, adjB), totR0 = W.sum(R0.map(r => r.r)), totW0 = W.sum(base.map(x => x.peakWait));
  const raw = W.FIXES.filter(f => !applied.includes(f.id)).map(f => {
    const ids = applied.concat(f.id), fl = W.flow(season, extraOf(ids)), R1 = riskOf(fl, adjOf(ids));
    const dR = totR0 - W.sum(R1.map(r => r.r)), dW = totW0 - W.sum(fl.map(x => x.peakWait));
    const sts = new Set(Object.keys(f.add).concat(Object.keys(f.adj).map(k => W.WEAK.find(w => w.id === k).st)));
    const reach = Math.max(...[...sts].map(id => base.find(x => x.st.id === id).daily)) / base[0].daily;
    return { f, dR, dW, reach: Math.min(1, reach), breadth: Object.keys(f.adj).length };
  });
  const mR = Math.max(1e-9, ...raw.map(x => x.dR)), mW = Math.max(1e-9, ...raw.map(x => x.dW)), mB = Math.max(1, ...raw.map(x => x.breadth));
  raw.forEach(x => { x.s = { R: Math.max(0, x.dR) / mR, P: x.reach, O: Math.max(0, x.dW) / mW, B: x.breadth / mB }; const sc = W.score(1, w, x.s); x.part = sc.part; x.value = sc.total; x.prio = sc.total / Math.sqrt(x.f.effort); });
  raw.sort((a, b) => b.prio - a.prio);
  return { flow: base, risks: R0, totR: totR0, totW: totW0, fixes: raw, w };
};
