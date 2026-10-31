export const erlangB = (servers, offered) => {
  if (servers <= 0) return 1;
  if (offered <= 0) return 0;
  let b = 1;
  for (let k = 1; k <= servers; k++) b = offered * b / (k + offered * b);
  return b;
};

const erlangCWhole = (servers, offered) => {
  if (servers <= 0) return 1;
  const rho = offered / servers;
  if (rho >= 1) return 1;
  const b = erlangB(servers, offered);
  return b / (1 - rho * (1 - b));
};

export const erlangC = (servers, offered) => {
  const low = Math.floor(servers);
  if (low === servers) return erlangCWhole(servers, offered);
  const frac = servers - low;
  return (1 - frac) * erlangCWhole(low, offered) + frac * erlangCWhole(low + 1, offered);
};

export const waitAllenCunneen = (lambda, servers, serviceTime, caSq, csSq) => {
  if (lambda <= 0 || serviceTime <= 0) return 0;
  if (servers <= 0) return Infinity;
  const offered = lambda * serviceTime;
  if (offered >= servers) return Infinity;
  const probWait = erlangC(servers, offered);
  return probWait / (servers / serviceTime - lambda) * (caSq + csSq) / 2;
};

export const priorityWaits = (lambda, servers, serviceTime, caSq, csSq, shares) => {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const w0 = waitAllenCunneen(lambda, servers, serviceTime, caSq, csSq);
  if (!Number.isFinite(w0)) return shares.map(() => w0);
  if (w0 === 0) return shares.map(() => 0);
  const rho = lambda * serviceTime / servers;
  let ahead = 0;
  return shares.map(share => {
    const upTo = ahead + share / total * rho;
    const wait = w0 * (1 - rho) / ((1 - ahead) * (1 - upTo));
    ahead = upTo;
    return wait;
  });
};
