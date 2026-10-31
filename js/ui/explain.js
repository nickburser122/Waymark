import { REGISTRY, BY_KEY, URGENCY_NAMES } from '../core/params.js';
import { fmtNum, trimNum, fmtFixed } from '../core/stats.js';
import { routeConfig } from '../core/route.js';
import { normaliseWeights, SCORE_KEYS } from '../core/score.js';

export const STAGES = [
  { id: 1, key: 'demand', color: 'persimmon', name: 'Demand', hint: 'patients · arrivals' },
  { id: 2, key: 'capacity', color: 'saffron', name: 'Capacity', hint: 'slots · servers' },
  { id: 3, key: 'queue', color: 'sky', name: 'Queue', hint: 'wait per site' },
  { id: 4, key: 'gate', color: 'lagoon', name: 'Gate · Risk', hint: 'feasible · risk' },
  { id: 5, key: 'score', color: 'iris', name: 'Score', hint: 'weighted sum' },
  { id: 6, key: 'decision', color: 'rose', name: 'Decision', hint: 'route · fix plan' }
];

export const SCORE_META = {
  T: { name: 'Time', color: 'persimmon', long: 'Time to care' },
  C: { name: 'Cost', color: 'saffron', long: 'Cost' },
  P: { name: 'Public', color: 'lagoon', long: 'Public tier' },
  L: { name: 'Load', color: 'sky', long: 'Load balance' },
  Q: { name: 'Quality', color: 'iris', long: 'Quality' },
  K: { name: 'Continuity', color: 'rose', long: 'Continuity' }
};

export const FIX_META = {
  R: { name: 'Risk', color: 'persimmon', long: 'Risk removed' },
  O: { name: 'Overload', color: 'sky', long: 'Overload relief' },
  P: { name: 'Reach', color: 'lagoon', long: 'Patient reach' },
  B: { name: 'Breadth', color: 'iris', long: 'Breadth' }
};

const TIER_LABEL = { public: 'Public', contracted: 'Contracted', private: 'Private' };

export const explain = (row, params, urgency) => {
  const cfg = routeConfig(params);
  const wn = normaliseWeights(cfg.weights, SCORE_KEYS);
  const tau = cfg.tau[urgency];
  const f = row.facility;
  const s = row.s;
  const parts = {};
  let total = 0;
  SCORE_KEYS.forEach(k => {
    parts[k] = wn[k] * s[k];
    total += parts[k];
  });
  const plain = [
    `${fmtFixed(row.ttc, 1)} days to care → time score ${fmtFixed(s.T, 2)}`,
    `Price ×${trimNum(f.multiplier, 2)} → cost score ${fmtFixed(s.C, 2)}`,
    `${TIER_LABEL[f.tier] || f.tier} site → ${fmtFixed(s.P, 2)}`,
    `${fmtFixed(Math.min(row.load, 9.99) * 100, 0)}% of weekly slots booked → load score ${fmtFixed(s.L, 2)}`,
    `Quality ${fmtFixed(f.shrunk, 2)} after ${fmtNum(f.reviews)} reviews → ${fmtFixed(s.Q, 2)}`,
    s.K === 1 ? 'Seen here before → 1.00' : 'New to this site → 0.00'
  ];
  const w = k => trimNum(wn[k], 4);
  const body = [
    `${w('T')}·2^(−${trimNum(row.ttc, 4)}/${trimNum(tau, 4)})`,
    `${w('C')}·${trimNum(s.C, 4)}`,
    `${w('P')}·${trimNum(s.P, 4)}`,
    `${w('L')}·${trimNum(s.L, 4)}`,
    `${w('Q')}·${trimNum(s.Q, 4)}`,
    `${w('K')}·${trimNum(s.K, 4)}`
  ].join(' + ');
  const formula = `Score = 1·[${body}] = ${trimNum(total, 3)}`;
  const details = [
    `s_T = 2^(−TTC/τ) = 2^(−${trimNum(row.ttc, 3)}/${trimNum(tau, 3)}) = ${trimNum(s.T, 4)}`,
    `s_C = clamp((P90 − m)/(P90 − P10)) with m = ${trimNum(f.multiplier, 3)} → ${trimNum(s.C, 4)}`,
    `s_P = tier value of ${f.tier} = ${trimNum(s.P, 4)}`,
    `s_L = 1 − min(1, U)³ with U = ${trimNum(row.load, 3)} → ${trimNum(s.L, 4)}`,
    `s_Q = (n·q + k·q̄)/(n + k) = ${trimNum(s.Q, 4)}`,
    `s_K = 1 if previous site else 0 → ${trimNum(s.K, 0)}`
  ];
  return { plain, formula, parts, total, details, weights: wn };
};

export const explainRisk = (risk, params) => {
  const base = risk.I * risk.F * Math.sqrt(risk.P * risk.D);
  const plain = [
    `Impact ${risk.I}, frequency ${risk.F}, surprise ${risk.P}, detect ${risk.D} → base ${fmtFixed(base, 1)}`,
    `Peak load ${fmtFixed(risk.peak * 100, 0)}% → ×${fmtFixed(1 + params.kappa * risk.over, 2)}`,
    `${fmtFixed(risk.share * 100, 0)}% of patients pass here → ×${fmtFixed(1 + params.deltaShare * risk.share, 2)}`
  ];
  const formula = `R = ${risk.I}·${risk.F}·√(${risk.P}·${risk.D})·(1 + ${fmtNum(params.kappa)}·max(0, ${trimNum(risk.peak, 3)} − ${fmtNum(params.rhoStar)}))·(1 + ${fmtNum(params.deltaShare)}·${trimNum(risk.share, 3)}) = ${fmtFixed(risk.r, 1)}`;
  return { plain, formula };
};

export const explainFix = (item, params) => {
  const plain = [
    `Removes ${fmtFixed(item.dR, 1)} risk and ${fmtFixed(item.dPMW, 0)} patient-minutes of waiting`,
    `Touches ${fmtFixed(item.reach * 100, 0)}% of patients and ${item.breadth} weak points`,
    `Effort ${item.fix.effort}, cost ${fmtNum(item.fix.cost)}k`
  ];
  const formula = `Priority = V / effort^${fmtNum(params.alpha)} / (1 + ${fmtNum(item.fix.cost)}/${fmtNum(params.costRef)})^${fmtNum(params.gamma)} = ${trimNum(item.value, 4)} / ${trimNum(Math.pow(item.fix.effort, params.alpha), 4)} / ${trimNum(Math.pow(1 + item.fix.cost / params.costRef, params.gamma), 4)} = ${trimNum(item.priority, 4)}`;
  return { plain, formula };
};

const makeBlocks = params => {
  const v = key => fmtNum(params[key]);
  const per = prefix => URGENCY_NAMES.map(n => v(`${prefix}${n[0].toUpperCase()}${n.slice(1)}`)).join(', ');
  return [
    {
      id: 'travel', stage: 1, title: 'Travel to care',
      uses: ['eta', 'speed'],
      intro: ['Distance becomes road distance, then hours of travel.'],
      formula: [`road = η·d = ${v('eta')}·d`, `t_f = road / v = road / ${v('speed')} km/h`],
      latex: ['\\mathrm{road} = \\eta\\, d', 't_f = \\mathrm{road}/v'],
      legend: [['d', 'straight-line km (haversine or x–y)'], ['η', 'detour index'], ['v', 'travel speed']]
    },
    {
      id: 'capacity', stage: 2, title: 'Capacity and load',
      uses: ['horizon', 'rhoMax', 'nearFull'],
      intro: ['Each site has c slots a day and a waiting list.'],
      formula: [`ρ_f = λ_f / c_f   (must stay below ${v('rhoMax')})`, `U_f = (λ_f·H + B_f + 1) / (c_f·H),  H = ${v('horizon')} d`, `λ_f = referrals_per_day, or waitlist / H when missing`, `near full: U ≥ ${v('nearFull')}`],
      latex: ['\\rho_f = \\lambda_f / c_f', 'U_f = \\frac{\\lambda_f H + B_f + 1}{c_f H}'],
      legend: [['λ_f', 'referrals per day'], ['c_f', 'slots per day'], ['B_f', 'waitlist plus patients placed this run'], ['H', 'booking horizon']]
    },
    {
      id: 'queue', stage: 3, title: 'Queue wait',
      uses: ['caSq', 'csSq', 'waitCap', 'defaultComplexity'],
      intro: ['Wait is the backlog divided by capacity, plus a queue term.'],
      formula: [`Wq = C(c, a) / (c·μ − λ) · (c_a² + c_s²) / 2,  c_a² = ${v('caSq')}, c_s² = ${v('csSq')}`, 'C(c, a) = B / (1 − ρ(1 − B)),  B from the Erlang-B recursion', `wait = min(${v('waitCap')} d, κ_p·(B_f/c_f·β_u + Wq_u)),  κ_p = largest complexity (default ${v('defaultComplexity')})`],
      latex: ['W_q = \\frac{C(c,a)}{c\\mu - \\lambda}\\cdot\\frac{c_a^2 + c_s^2}{2}', '\\mathrm{wait} = \\kappa_p\\left(\\frac{B_f}{c_f}\\beta_u + W_{q,u}\\right)'],
      legend: [['C(c, a)', 'Erlang C waiting probability'], ['κ_p', 'largest complexity among needs'], ['β_u', 'share of backlog ahead of urgency u']]
    },
    {
      id: 'priority', stage: 3, title: 'Priority classes',
      uses: ['shareRoutine', 'shareSoon', 'shareUrgent', 'betaRoutine', 'betaSoon', 'betaUrgent'],
      intro: ['Urgent patients wait behind fewer people.'],
      formula: [`Wq_u = W0·(1 − ρ) / ((1 − σ_before)(1 − σ_u))`, `shares (routine, soon, urgent) = ${per('share')}`, `β (routine, soon, urgent) = ${per('beta')}`, 'Σ share_u·Wq_u = W0'],
      latex: ['W_{q,u} = W_0\\,\\frac{1-\\rho}{(1-\\sigma_{u^-})(1-\\sigma_u)}', '\\sigma_u = \\rho \\sum_{k \\succeq u} \\pi_k'],
      legend: [['σ_u', 'load of classes at least as urgent as u'], ['W0', 'first-come wait']]
    },
    {
      id: 'gates', stage: 4, title: 'Gates',
      uses: ['reachRoutine', 'reachSoon', 'reachUrgent', 'deadlineRoutine', 'deadlineSoon', 'deadlineUrgent'],
      intro: ['A site must pass every gate before it is scored.'],
      formula: ['G = 1[covers needs]·1[ρ < ρ_max]·1[road ≤ R_u]·1[TTC ≤ D_u]·1[U ≤ 1 in batch]', `R (routine, soon, urgent) = ${per('reach')} km`, `D (routine, soon, urgent) = ${per('deadline')} d`],
      latex: ['G = \\mathbf{1}[\\mathrm{covers}]\\,\\mathbf{1}[\\rho<\\rho_{max}]\\,\\mathbf{1}[\\mathrm{road}\\le R_u]\\,\\mathbf{1}[\\mathrm{TTC}\\le D_u]'],
      legend: [['R_u', 'reach limit by urgency'], ['D_u', 'deadline by urgency']]
    },
    {
      id: 'subscores', stage: 5, title: 'Sub-scores',
      uses: ['tauRoutine', 'tauSoon', 'tauUrgent', 'costLow', 'costHigh', 'tierPublic', 'tierContracted', 'tierPrivate', 'shrinkK', 'qualityFallback'],
      intro: ['Every sub-score runs from 0 to 1.'],
      formula: [`s_T = 2^(−TTC/τ_u),  τ (routine, soon, urgent) = ${per('tau')} d`, `s_C = clamp((P${v('costHigh')} − m)/(P${v('costHigh')} − P${v('costLow')}), 0, 1)`, `s_P = tier value: public ${v('tierPublic')}, contracted ${v('tierContracted')}, private ${v('tierPrivate')}`, 's_L = 1 − min(1, U)³', `s_Q = (n·q + k·q̄)/(n + k),  k = ${v('shrinkK')}, fallback q̄ = ${v('qualityFallback')}`, 's_K = 1 if the patient was treated there'],
      latex: ['s_T = 2^{-\\mathrm{TTC}/\\tau_u}', 's_C = \\mathrm{clamp}\\left(\\frac{P_{90}-m}{P_{90}-P_{10}},0,1\\right)', 's_L = 1-\\min(1,U)^3', 's_Q = \\frac{nq + k\\bar q}{n+k}'],
      legend: [['τ_u', 'half-life of the time score'], ['m', 'price multiplier'], ['q̄', 'review-weighted mean quality']]
    },
    {
      id: 'score', stage: 5, title: 'Score and decision',
      uses: ['wT', 'wC', 'wP', 'wL', 'wQ', 'wK', 'marginClear', 'marginModerate', 'robustStep'],
      intro: ['The best site has the highest weighted sum.'],
      formula: [`Score = G·Σ ŵ_k·s_k,  ŵ = w / Σw`, `w (T, C, P, L, Q, K) = ${['wT', 'wC', 'wP', 'wL', 'wQ', 'wK'].map(v).join(', ')}`, `lead: clear above ${v('marginClear')}, moderate above ${v('marginModerate')}`, `robustness: each weight moves ±${v('robustStep')} points`],
      latex: ['\\mathrm{Score} = G \\sum_k \\hat w_k s_k', '\\hat w_k = w_k / \\sum_j w_j'],
      legend: [['ŵ_k', 'normalised weight'], ['G', 'gate product']]
    },
    {
      id: 'batch', stage: 6, title: 'Batch placement',
      uses: ['batchOrder', 'maxStops'],
      intro: ['Urgent patients go first, then those with most to lose.'],
      formula: [`order = ${params.batchOrder === 1 ? 'as listed' : 'regret'}`, 'regret = best score − second best score', `split plan: at most ${v('maxStops')} sites, greedy by score × needs covered`],
      latex: ['\\mathrm{regret} = S_{(1)} - S_{(2)}'],
      legend: [['S(1), S(2)', 'best and second best score']]
    },
    {
      id: 'flow', stage: 1, title: 'Clinic flow',
      uses: ['bucketMin', 'season'],
      intro: ['Patients move station to station, bucket by bucket.'],
      formula: [`in_i(h) = λ_i(h) + backlog_i(h−1),  Δ = ${v('bucketMin')} min`, 'dep_i(h) = min(in_i(h), c_i(h)·Δ/s_i)', 'λ_j(h) += p_ij·[(1−φ)·dep_i(h) + φ·dep_i(h−1)],  φ = min(1, s_i/Δ)', `arrivals are scaled by ${v('season')}`],
      latex: ['\\mathrm{dep}_i(h) = \\min(\\mathrm{in}_i(h),\\, c_i(h)\\Delta/s_i)', '\\lambda_j(h) \\mathrel{+}= p_{ij}\\left[(1-\\varphi)\\mathrm{dep}_i(h) + \\varphi\\,\\mathrm{dep}_i(h-1)\\right]'],
      legend: [['φ', 'fraction of service time that spills into the next bucket'], ['p_ij', 'share sent from i to j']]
    },
    {
      id: 'variability', stage: 3, title: 'Variability links',
      uses: ['defaultServiceCv2', 'defaultArrivalCv2'],
      intro: ['Variability passes from station to station.'],
      formula: ['c_d² = 1 + (1 − ρ²)(c_a² − 1) + ρ²/√c·(c_s² − 1)', 'c_ij² = p_ij·c_d,i² + 1 − p_ij', 'c_a,j² = Σ (λ_ij/λ_j)·c_ij²', `defaults: c_s² ${v('defaultServiceCv2')}, c_a² ${v('defaultArrivalCv2')}`],
      latex: ['c_d^2 = 1 + (1-\\rho^2)(c_a^2-1) + \\frac{\\rho^2}{\\sqrt c}(c_s^2-1)'],
      legend: [['c_d²', 'departure variability'], ['c_a², c_s²', 'arrival and service variability']]
    },
    {
      id: 'waiting', stage: 3, title: 'Clinic waiting',
      uses: ['cRhoMax', 'waitMax'],
      intro: ['Waiting is counted in patient-minutes.'],
      formula: [`Wq_i(h) = [AC(λ, c, s, c_a², c_s²) if ρ < ${v('cRhoMax')}] + backlog_i(h)/cap_i(h)·Δ,  capped at ${v('waitMax')} min`, 'PMW = Σ_i Σ_h λ_i(h)·Wq_i(h)'],
      latex: ['\\mathrm{PMW} = \\sum_i \\sum_h \\lambda_i(h)\\, W_{q,i}(h)'],
      legend: [['PMW', 'patient-minutes waiting'], ['AC', 'Allen–Cunneen wait']]
    },
    {
      id: 'risk', stage: 4, title: 'Weak point risk',
      uses: ['kappa', 'rhoStar', 'deltaShare', 'rhoClip', 'riskHigh', 'riskMedium'],
      intro: ['Risk is impact times likelihood, scaled by load and exposure.'],
      formula: [`R = I·F·√(P·D)·(1 + ${v('kappa')}·max(0, ρ_peak − ${v('rhoStar')}))·(1 + ${v('deltaShare')}·share)`, `ρ_peak is capped at ${v('rhoClip')}`, `high from ${v('riskHigh')}, medium from ${v('riskMedium')}`],
      latex: ['R = I F \\sqrt{P D}\\,\\bigl(1 + \\kappa \\max(0, \\rho_{peak} - \\rho^*)\\bigr)(1 + \\delta\\, \\mathrm{share})'],
      legend: [['I, F, P, D', 'impact, frequency, unpredictability, detectability'], ['share', 'patients passing the station / patients entering']]
    },
    {
      id: 'fixes', stage: 6, title: 'Fix priority',
      uses: ['fwR', 'fwO', 'fwP', 'fwB', 'alpha', 'gamma', 'costRef', 'budget'],
      intro: ['Fixes are ranked by value per effort within budget.'],
      formula: ['V = Σ v̂_k·s_k over risk removed, overload relief, patient reach, breadth', `v (R, O, P, B) = ${['fwR', 'fwO', 'fwP', 'fwB'].map(v).join(', ')}`, `Priority = V / effort^${v('alpha')} / (1 + cost/${v('costRef')})^${v('gamma')}`, `budget B = ${v('budget')}k`],
      latex: ['\\mathrm{Priority} = \\frac{V}{\\mathrm{effort}^{\\alpha}\\,(1 + \\mathrm{cost}/C_{ref})^{\\gamma}}'],
      legend: [['V', 'weighted value of the fix'], ['C_ref', 'reference cost']]
    }
  ];
};

export const equationBlocks = params => makeBlocks(params).map(block => ({
  ...block,
  plain: block.intro.concat(block.uses.map(key => BY_KEY[key].plain(params[key])))
}));

const unitText = entry => (entry.unit && entry.unit !== 'pts' ? ` ${entry.unit}` : entry.unit === 'pts' ? ' pts' : '');

export const valueLine = (entry, params) => `${entry.symbol} = ${fmtNum(params[entry.key])}${unitText(entry)}`;

const blockValues = (block, params) => block.uses.map(key => valueLine(BY_KEY[key], params));

export const exportBlock = (block, format, params) => {
  const values = blockValues(block, params);
  if (format === 'tex') {
    const lines = block.latex.map(l => `${l} \\\\`).join('\n');
    const vals = block.uses.map(key => `${BY_KEY[key].latex} &= ${fmtNum(params[key])}\\,\\text{${BY_KEY[key].unit || ''}} \\\\`).join('\n');
    return `% ${block.title}\n\\begin{align*}\n${lines}\n${vals}\n\\end{align*}`;
  }
  if (format === 'md') {
    return [`### ${block.title}`, '', block.plain.join('\n'), '', '```text', block.formula.join('\n'), '```', '', block.legend.map(([s, m]) => `- ${s}: ${m}`).join('\n'), '', 'Values', '', values.map(l => `- ${l}`).join('\n')].join('\n');
  }
  return [block.title, '', block.plain.join('\n'), '', block.formula.map(l => `  ${l}`).join('\n'), '', block.legend.map(([s, m]) => `  ${s}: ${m}`).join('\n'), '', 'Values', values.map(l => `  ${l}`).join('\n')].join('\n');
};

const parameterSection = (format, params) => {
  const lines = REGISTRY.map(entry => valueLine(entry, params));
  if (format === 'md') return ['## Parameters', '', REGISTRY.map(entry => `- ${valueLine(entry, params)} — ${entry.label}`).join('\n')].join('\n');
  if (format === 'tex') return `% Parameters\n\\begin{align*}\n${REGISTRY.map(entry => `${entry.latex} &= ${fmtNum(params[entry.key])}\\,\\text{${entry.unit || ''}} \\\\`).join('\n')}\n\\end{align*}`;
  return `Parameters\n${lines.map(l => `  ${l}`).join('\n')}`;
};

export const exportAll = (format, params) => {
  const blocks = equationBlocks(params);
  const body = blocks.map(block => exportBlock(block, format, params));
  const head = format === 'md' ? '# Waymark equations' : format === 'tex' ? '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}' : 'Waymark equations';
  const tail = format === 'tex' ? '\\end{document}' : '';
  return [head, ...body, parameterSection(format, params), tail].filter(Boolean).join('\n\n');
};
