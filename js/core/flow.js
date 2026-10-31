import { waitAllenCunneen } from './queue.js';
import { sum } from './stats.js';

export const cycleOf = (ids, routes) => {
  const next = new Map(ids.map(id => [id, []]));
  routes.forEach(r => {
    if (r.from !== 'in' && next.has(r.from) && next.has(r.to)) next.get(r.from).push(r.to);
  });
  const state = new Map();
  const path = [];
  let found = null;
  const visit = id => {
    if (found) return;
    state.set(id, 1);
    path.push(id);
    for (const to of next.get(id)) {
      if (found) return;
      if (state.get(to) === 1) {
        found = path.slice(path.indexOf(to)).concat(to);
        return;
      }
      if (!state.has(to)) visit(to);
    }
    path.pop();
    state.set(id, 2);
  };
  ids.forEach(id => { if (!state.has(id) && !found) visit(id); });
  return found;
};

export const topologicalOrder = (ids, routes) => {
  const indegree = new Map(ids.map(id => [id, 0]));
  const next = new Map(ids.map(id => [id, []]));
  routes.forEach(r => {
    if (r.from === 'in' || !indegree.has(r.from) || !indegree.has(r.to)) return;
    next.get(r.from).push(r.to);
    indegree.set(r.to, indegree.get(r.to) + 1);
  });
  const queue = ids.filter(id => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    next.get(id).forEach(to => {
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    });
  }
  if (order.length !== ids.length) {
    const cycle = cycleOf(ids, routes);
    throw new Error(`Route cycle: ${(cycle || ids.filter(id => !order.includes(id))).join(' → ')}`);
  }
  return order;
};

export const runFlow = (site, params) => {
  const dt = params.bucketMin;
  const per = Math.max(1, Math.round(60 / dt));
  const buckets = site.hours.length * per;
  const stationById = new Map(site.stations.map(st => [st.id, st]));
  const order = topologicalOrder(site.stations.map(st => st.id), site.routes);
  const entry = new Float64Array(buckets);
  let arrivalWeight = 0;
  let arrivalCv = 0;
  for (let b = 0; b < buckets; b++) {
    const hi = Math.floor(b / per);
    entry[b] = site.arrivals[hi] * params.season * dt / 60;
  }
  site.hours.forEach((h, hi) => {
    const a = site.arrivals[hi];
    arrivalWeight += a;
    arrivalCv += a * (site.arrivalCv2 ? site.arrivalCv2[hi] : params.defaultArrivalCv2);
  });
  const entryCa2 = arrivalWeight > 0 ? arrivalCv / arrivalWeight : params.defaultArrivalCv2;
  const entryDaily = sum(entry);

  const lam = new Map(site.stations.map(st => [st.id, new Float64Array(buckets)]));
  const inflow = new Map(site.stations.map(st => [st.id, new Map()]));
  const addFlow = (to, from, amount) => {
    const m = inflow.get(to);
    m.set(from, (m.get(from) || 0) + amount);
  };
  site.routes.filter(r => r.from === 'in' && lam.has(r.to)).forEach(r => {
    const arr = lam.get(r.to);
    let total = 0;
    for (let b = 0; b < buckets; b++) {
      const amount = r.share * entry[b];
      arr[b] += amount;
      total += amount;
    }
    addFlow(r.to, 'in', total);
  });

  const computed = new Map();
  let lagTail = 0;
  order.forEach(id => {
    const st = stationById.get(id);
    const s = st.serviceMin;
    const arr = lam.get(id);
    const servers = new Float64Array(buckets);
    const cap = new Float64Array(buckets);
    const inn = new Float64Array(buckets);
    const dep = new Float64Array(buckets);
    const bk = new Float64Array(buckets);
    let carry = 0;
    for (let b = 0; b < buckets; b++) {
      servers[b] = st.servers[Math.floor(b / per)] || 0;
      cap[b] = servers[b] * dt / s;
      inn[b] = arr[b] + carry;
      dep[b] = Math.min(inn[b], cap[b]);
      bk[b] = inn[b] - dep[b];
      carry = bk[b];
    }
    const phi = Math.min(1, s / dt);
    site.routes.filter(r => r.from === id && lam.has(r.to)).forEach(r => {
      const target = lam.get(r.to);
      let total = 0;
      for (let b = 0; b < buckets; b++) {
        const amount = r.share * ((1 - phi) * dep[b] + phi * (b > 0 ? dep[b - 1] : 0));
        target[b] += amount;
        total += amount;
      }
      lagTail += r.share * phi * dep[buckets - 1];
      addFlow(r.to, id, total);
    });
    computed.set(id, { st, servers, cap, inn, dep, bk, lam: arr });
  });

  const cd2 = new Map();
  const ca2 = new Map();
  const rhoDaily = new Map();
  const routeShare = (from, to) => site.routes.filter(r => r.from === from && r.to === to).reduce((a, r) => a + r.share, 0);
  order.forEach(id => {
    const c = computed.get(id);
    const flows = inflow.get(id);
    let total = 0;
    flows.forEach(v => { total += v; });
    let merged = 1;
    if (total > 0) {
      merged = 0;
      flows.forEach((amount, from) => {
        const p = routeShare(from, id);
        const upstream = from === 'in' ? entryCa2 : cd2.get(from);
        merged += amount / total * (p * upstream + 1 - p);
      });
    }
    ca2.set(id, merged);
    const totalLam = sum(c.lam);
    const totalCap = sum(c.cap);
    const rho = totalCap > 0 ? Math.min(1, totalLam / totalCap) : totalLam > 0 ? 1 : 0;
    rhoDaily.set(id, rho);
    const active = Array.from(c.servers).filter(v => v > 0);
    const cBar = active.length ? sum(active) / active.length : 1;
    cd2.set(id, 1 + (1 - rho * rho) * (merged - 1) + rho * rho / Math.sqrt(cBar) * (c.st.csSq - 1));
    c.cBar = cBar;
  });

  const stations = site.stations.map(st => {
    const c = computed.get(st.id);
    const s = st.serviceMin;
    const rho = new Float64Array(buckets);
    const wq = new Float64Array(buckets);
    let pmw = 0;
    let peakRho = 0;
    let peakWait = 0;
    let peakBucket = 0;
    let peakWaitBucket = 0;
    for (let b = 0; b < buckets; b++) {
      rho[b] = c.cap[b] > 0 ? c.lam[b] / c.cap[b] : c.lam[b] > 0 ? Infinity : 0;
      const queueTerm = rho[b] < params.cRhoMax && c.servers[b] > 0 && c.lam[b] > 0
        ? waitAllenCunneen(c.lam[b] / dt, c.servers[b], s, ca2.get(st.id), st.csSq)
        : 0;
      const backlogTerm = c.cap[b] > 0 ? c.bk[b] / c.cap[b] * dt : c.bk[b] > 0 ? params.waitMax : 0;
      wq[b] = Math.min(params.waitMax, queueTerm + backlogTerm);
      pmw += c.lam[b] * wq[b];
      if (rho[b] > peakRho) {
        peakRho = rho[b];
        peakBucket = b;
      }
      if (wq[b] > peakWait) {
        peakWait = wq[b];
        peakWaitBucket = b;
      }
    }
    const daily = sum(c.lam);
    return {
      id: st.id,
      name: st.name,
      serviceMin: s,
      csSq: st.csSq,
      lam: c.lam,
      servers: c.servers,
      cap: c.cap,
      inn: c.inn,
      dep: c.dep,
      bk: c.bk,
      rho,
      wq,
      daily,
      pmw,
      peakRho,
      peakWait,
      peakStart: site.hours[Math.floor(peakBucket / per)] * 60 + (peakBucket % per) * dt,
      peakWaitStart: site.hours[Math.floor(peakWaitBucket / per)] * 60 + (peakWaitBucket % per) * dt,
      rhoDaily: rhoDaily.get(st.id),
      cBar: c.cBar,
      ca2: ca2.get(st.id),
      cd2: cd2.get(st.id),
      backlogAtClose: c.bk[buckets - 1],
      meanWait: daily > 0 ? pmw / daily : 0
    };
  });

  const bottleneck = stations.reduce((a, b) => (b.peakWait > a.peakWait ? b : a), stations[0] || null);
  return {
    dt,
    per,
    buckets,
    hours: site.hours.slice(),
    order,
    stations,
    entryDaily,
    entryCa2,
    pmw: sum(stations.map(st => st.pmw)),
    unfinished: lagTail + sum(stations.map(st => st.backlogAtClose)),
    lagTail,
    bottleneck
  };
};

export const bucketStart = (flow, b) => flow.hours[Math.floor(b / flow.per)] * 60 + (b % flow.per) * flow.dt;
