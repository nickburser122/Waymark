/* Waymark UI — renders both examples from the single engine in engine.js */
const $ = s => document.querySelector(s);
const TIERC = { public: 'var(--pub)', contracted: 'var(--con)', private: 'var(--pri)' };
const sx = x => 30 + x * 7, sy = y => 30 + y * 7;
const pct = v => (v * 100).toFixed(1);
const KEY = 'waymark.v2';
const S = Object.assign({
  view: 'route', p: { ...W.CASES[0] }, rw: { ...W.R_POLICIES.Balanced },
  season: 1, fw: { ...W.F_POLICIES.Balanced }, applied: []
}, (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const toast = t => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 1600); };
const copy = t => navigator.clipboard.writeText(t).then(() => toast('Copied'), () => { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); toast('Copied'); });

const STAGES = [
  ['#E8613C', 'Demand', 'patients / arrivals'], ['#EFAE2B', 'Capacity', 'slots · servers'], ['#3D8BD9', 'Queue', 'G/G/c wait'],
  ['#1C9C97', 'Gate · Risk', 'feasible? RPN*'], ['#7B6CF0', 'Score', 'Σ w·s'], ['#E2558A', 'Decision', 'route · fix plan']
];
function pipe(vals) {
  $('#pipe').innerHTML = STAGES.map((s, i) => `<div style="--c:${s[0]}">${i + 1} ${s[1]}<small>${vals ? vals[i] : s[2]}</small></div>`).join('');
}
function sliders(el, terms, w, onCh) {
  el.innerHTML = terms.map(t => `<div class="sl" style="--k:${t[3]}"><b>${t[0]}</b><input type="range" min="0" max="80" value="${w[t[0]]}" data-k="${t[0]}" aria-label="${t[1]}" title="${t[1]}: ${t[2]}"><output>${w[t[0]]}</output></div>`).join('');
  el.oninput = e => { const k = e.target.dataset.k; if (!k) return; w[k] = +e.target.value; e.target.nextElementSibling.textContent = w[k]; onCh(); };
}
function presets(el, P, target, after) {
  el.innerHTML = Object.keys(P).map(k => `<button class="chip" data-k="${k}">${k}</button>`).join('');
  const mark = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', JSON.stringify(P[b.dataset.k]) === JSON.stringify(target)));
  el.onclick = e => { const k = e.target.dataset.k; if (!k) return; Object.assign(target, P[k]); after(); };
  return mark;
}

/* ---------------- Example 1: referral ---------------- */
let rMark;
function initRoute() {
  $('#cases').innerHTML = W.CASES.map((c, i) => `<button class="chip" data-i="${i}" title="${c.blurb}">${c.name}</button>`).join('');
  $('#cases').onclick = e => { const i = e.target.dataset.i; if (i == null) return; S.p = { ...W.CASES[i], svc: W.CASES[i].svc.slice() }; renderRoute(); };
  $('#svc').onclick = e => { const k = e.target.dataset.k; if (!k) return; const a = S.p.svc; a.includes(k) ? a.length > 1 && a.splice(a.indexOf(k), 1) : a.push(k); renderRoute(); };
  $('#urg').onclick = e => { if (e.target.dataset.u == null) return; S.p.urg = +e.target.dataset.u; renderRoute(); };
  $('#prev').innerHTML = '<option value="">— none —</option>' + W.FAC.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  $('#prev').onchange = e => { S.p.prev = e.target.value; renderRoute(); };
  sliders($('#rw'), W.R_TERMS, S.rw, renderRoute);
  rMark = presets($('#rpol'), W.R_POLICIES, S.rw, () => { sliders($('#rw'), W.R_TERMS, S.rw, renderRoute); renderRoute(); });
  $('#map').onclick = e => { const sv = $('#map'), pt = sv.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(sv.getScreenCTM().inverse()); S.p.x = W.clamp((q.x - 30) / 7, 0, 115); S.p.y = W.clamp((q.y - 30) / 7, 0, 76); S.p.name = 'Custom'; renderRoute(); };
}
function renderRoute() {
  const p = S.p, R = W.route(p, S.rw);
  $('#cases').querySelectorAll('button').forEach(b => b.classList.toggle('on', W.CASES[b.dataset.i].name === p.name));
  $('#svc').innerHTML = Object.entries(W.SERVICES).map(([k, v]) => `<button class="chip ${p.svc.includes(k) ? 'on' : ''}" data-k="${k}">${v[0]}</button>`).join('');
  $('#urg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.u === p.urg));
  $('#prev').value = p.prev || ''; rMark();
  const best = R.plan.map(x => x.r.f.id);
  // map
  let g = W.ROADS.map(([a, b]) => `<line x1="${sx(W.PLACES[a][1])}" y1="${sy(W.PLACES[a][2])}" x2="${sx(W.PLACES[b][1])}" y2="${sy(W.PLACES[b][2])}" stroke="#E7D8C2" stroke-width="5" stroke-linecap="round"/>`).join('');
  g += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${W.RCFG.reach[p.urg] / W.RCFG.road * 7}" fill="#E8613C0d" stroke="#E8613C55" stroke-dasharray="6 6"/>`;
  g += W.PLACES.map(pl => `<text x="${sx(pl[1])}" y="${sy(pl[2]) + 26}" text-anchor="middle" font-size="${pl[3] ? 13 : 11}" fill="#A49BAE" font-weight="600">${pl[0]}</text>`).join('');
  R.plan.forEach(x => g += `<line x1="${sx(p.x)}" y1="${sy(p.y)}" x2="${sx(x.r.f.x)}" y2="${sy(x.r.f.y)}" stroke="#2B2238" stroke-width="2.5" stroke-dasharray="2 6" stroke-linecap="round"/>`);
  R.rows.forEach(r => {
    const f = r.f, cx = sx(f.x), cy = sy(f.y), on = best.includes(f.id), C = 2 * Math.PI * 13, u = Math.min(1, f.load / f.cap);
    g += `<g opacity="${r.G || on ? 1 : .35}"><title>${f.name} — ${r.G ? 'score ' + pct(r.total) : r.why}</title><circle cx="${cx}" cy="${cy}" r="13" fill="#fff" stroke="#EADFCF" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${TIERC[f.tier]}" stroke-width="4" stroke-dasharray="${C * u} ${C}" transform="rotate(-90 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${on ? 7 : 5}" fill="${TIERC[f.tier]}"/>${on ? `<circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="#2B2238" stroke-width="2"/>` : ''}</g>`;
  });
  g += `<g><circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="11" fill="#E8613C" stroke="#fff" stroke-width="3"/><circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3" fill="#fff"/></g>`;
  $('#map').innerHTML = g;
  // recommendation
  const top = R.plan[0];
  if (!top) $('#rec').innerHTML = `<div class="k">Decision</div><h2>No feasible placement</h2><p>Every facility fails a gate. Widen urgency reach or add capacity.</p>`;
  else {
    const single = R.plan.length === 1 && R.ok.length;
    const conf = R.margin == null ? 'only option' : R.margin > .08 ? 'clear winner' : R.margin > .03 ? 'moderate lead' : 'near tie — review';
    $('#rec').innerHTML = `<div class="k">Decision · ${single ? 'single stop' : 'split plan (' + R.plan.length + ' stops)'}</div><h2 class="serif">${R.plan.map(x => x.r.f.name + (single ? '' : ' <small style="font-size:14px;opacity:.7">(' + x.svc.map(s => W.SERVICES[s][0]).join(', ') + ')</small>')).join(' → ')}</h2>
    <div class="stats"><div><b>${single ? pct(top.r.total) : '—'}</b>score / 100</div><div><b>${Math.round(W.sum(R.plan.map(x => x.r.km)))} km</b>travel</div><div><b>${top.r.waitD < 1 ? Math.round(top.r.waitD * 24) + ' h' : top.r.waitD.toFixed(1) + ' d'}</b>est. queue wait</div><div><b>$${Math.round(W.sum(R.plan.map(x => W.sum(x.svc.map(s => W.SERVICES[s][1])) * x.r.f.m)))}</b>payer cost</div><div><b>${conf}</b>${R.margin != null ? 'margin ' + pct(R.margin) + ' pts' : ''}</div></div>`;
  }
  // ranking
  const ranked = R.ok.slice(0, 7), out = R.rows.filter(r => !r.G);
  $('#rank').innerHTML = `<h3>Ranking <span>${R.ok.length} feasible of ${R.rows.length}</span></h3>` + (ranked.map((r, i) => `<div class="row ${i === 0 ? 'sel' : ''}"><span class="n">${i + 1}</span><div><b>${r.f.name}</b> <span class="tag" style="--k:${TIERC[r.f.tier]}">${r.f.tier}</span><small>${Math.round(r.km)} km · wait ${r.waitD < 1 ? Math.round(r.waitD * 24) + 'h' : r.waitD.toFixed(1) + 'd'} · ρ ${(r.rho * 100).toFixed(0)}% · Q̂ ${r.qHat.toFixed(2)}</small><div class="stack">${W.R_TERMS.map(t => `<i style="--k:${t[3]};width:${r.part[t[0]] * 100}%" title="${t[1]} ${pct(r.part[t[0]])}"></i>`).join('')}</div></div><span class="sc">${pct(r.total)}</span></div>`).join('') || '<p class="note">None feasible — split plan used.</p>') +
    `<details style="margin-top:8px"><summary class="note" style="cursor:pointer">${out.length} excluded by gates</summary>${out.map(r => `<div class="out"><b>${r.f.name}</b> — ${r.why}</div>`).join('')}</details>`;
  renderCohort();
  pipe([`${p.svc.length} need(s), urgency ${['routine', 'soon', 'urgent'][p.urg]}`, `${W.SUMCAP || (W.SUMCAP = W.sum(W.FAC.map(f => f.cap)))} slots/day`, `best wait ${R.ok[0] ? (R.ok[0].waitD * 24).toFixed(0) + ' h' : '—'}`, `${R.ok.length}/${R.rows.length} pass gates`, R.ok[0] ? 'top ' + pct(R.ok[0].total) : 'split', R.plan.map(x => x.r.f.name).join(' → ') || 'none']);
  save();
}
/* cohort: same pipeline, loads accumulate as patients are placed (capacity-aware) vs naive nearest */
let cohortCache = null;
function renderCohort() {
  const key = JSON.stringify(S.rw); if (cohortCache && cohortCache.key === key) return;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pats = Array.from({ length: 120 }, () => { const c = W.CASES[Math.floor(rnd() * 5)], pl = W.PLACES[Math.floor(rnd() * W.PLACES.length)]; return { ...c, x: pl[1] + rnd() * 6 - 3, y: pl[2] + rnd() * 6 - 3, urg: rnd() < .15 ? 2 : rnd() < .4 ? 1 : 0, prev: '' }; });
  const run = smart => { const extra = {}; let km = 0, wait = 0, cost = 0, pub = 0, fail = 0, over = 0; pats.forEach(p => { const R = W.route(p, smart ? S.rw : { T: 1, C: 0, P: 0, L: 0, Q: 0, K: 0 }, extra); let pick = smart ? R.ok[0] : R.ok.slice().sort((a, b) => a.km - b.km)[0]; if (!pick) { fail++; return; } extra[pick.f.id] = (extra[pick.f.id] || 0) + 1; km += pick.km; wait += pick.waitD; cost += pick.cost; if (pick.f.tier === 'public') pub++; if (pick.rho > .9) over++; }); const n = pats.length - fail; return { km: km / n, wait: wait / n, cost: cost / n, pub: pub / n, fail, over }; };
  const a = run(false), b = run(true);
  const row = (l, x, y, f, better) => `<tr><td>${l}</td><td class="m">${f(x)}</td><td class="m"><b>${f(y)}</b></td><td class="m" style="color:${better(x, y) ? 'var(--lagoon)' : 'var(--persimmon)'}">${better(x, y) ? '▲' : '▼'}</td></tr>`;
  $('#cohort').innerHTML = `<h3>Cohort of 120 <span>stage 6 at scale</span></h3><table><tr><th></th><th>Nearest</th><th>Waymark</th><th></th></tr>` +
    row('Avg travel', a.km, b.km, v => v.toFixed(1) + ' km', (x, y) => y <= x) + row('Avg wait', a.wait, b.wait, v => (v * 24).toFixed(1) + ' h', (x, y) => y <= x) +
    row('Avg cost', a.cost, b.cost, v => '$' + v.toFixed(0), (x, y) => y <= x) + row('Public share', a.pub, b.pub, v => (v * 100).toFixed(0) + '%', (x, y) => y >= x) +
    row('Sent to ρ>90%', a.over, b.over, v => v, (x, y) => y <= x) + `</table><p class="note">Loads accumulate as each patient is placed, so the queue term pushes later patients away from saturating sites.</p>`;
  cohortCache = { key };
}

/* ---------------- Example 2: clinic ---------------- */
let fMark;
function initClinic() {
  $('#sea').value = S.season;
  $('#sea').oninput = e => { S.season = +e.target.value; renderClinic(); };
  sliders($('#fw'), W.F_TERMS, S.fw, renderClinic);
  fMark = presets($('#fpol'), W.F_POLICIES, S.fw, () => { sliders($('#fw'), W.F_TERMS, S.fw, renderClinic); renderClinic(); });
  $('#fixes').onchange = e => { const id = e.target.dataset.id; if (!id) return; e.target.checked ? S.applied.push(id) : S.applied.splice(S.applied.indexOf(id), 1); renderClinic(); };
  $('#fixes').onclick = e => { if (e.target.id === 'reset') { S.applied = []; renderClinic(); } };
}
function heatC(r) { return r < .6 ? '#D7F0EA' : r < .85 ? '#FFE9B5' : r < 1 ? '#FFC9A8' : '#F08B6E'; }
function renderClinic() {
  $('#seaO').textContent = '×' + S.season.toFixed(2); fMark();
  const M = W.prioritise(S.season, S.fw, S.applied), fl = M.flow;
  const worst = fl.reduce((a, b) => b.peakWait > a.peakWait ? b : a);
  const crit = M.risks.filter(r => r.r >= 100).length;
  $('#ckpi').innerHTML = `<div><b>${Math.round(fl[0].daily)}</b><small>patients / day</small></div><div><b>${Math.round(M.totW)}′</b><small>Σ peak wait (min)</small></div><div><b>${Math.round(M.totR)}</b><small>Σ risk RPN*</small></div><div><b>${worst.st.name}</b><small>bottleneck @ ${worst.peakH}:00</small></div>`;
  $('#heat').innerHTML = '<span class="h"></span>' + W.HOURS.map(h => `<span class="h">${h}</span>`).join('') + fl.map(x => `<span class="r">${x.st.name}</span>` + x.hrs.map((h, i) => `<span style="background:${heatC(h.rho)}" title="${x.st.name} ${W.HOURS[i]}:00 — λ ${h.lam.toFixed(0)}/h, c ${h.c}, ρ ${(h.rho * 100).toFixed(0)}%, wait ${h.wq.toFixed(0)} min">${Math.round(h.rho * 100)}</span>`).join('')).join('');
  const rk = M.risks.map((r, i) => ({ r, w: W.WEAK[i] })).sort((a, b) => b.r.r - a.r.r), mx = rk[0].r.r;
  $('#weak').innerHTML = `<tr><th>Weak point</th><th>I·F·P·√D</th><th>ρ boost</th><th>RPN*</th></tr>` + rk.map(({ r, w }) => `<tr><td><b>${w.title}</b><br><small style="color:var(--mu)">${W.ST.find(s => s.id === w.st).name}</small></td><td class="m">${r.I}·${r.F}·${r.P}·√${r.D}</td><td class="m">×${((1 + W.RCF.kappa * r.over) * (1 + W.RCF.delta * r.down)).toFixed(2)}</td><td class="m"><span class="tag" style="--k:${r.r > 120 ? '#E8613C' : r.r > 50 ? '#EFAE2B' : '#1C9C97'}">${r.r.toFixed(0)}</span><div class="stack" style="width:70px"><i style="--k:#E8613C;width:${r.r / mx * 100}%"></i></div></td></tr>`).join('');
  const done = S.applied.map(id => W.FIXES.find(f => f.id === id));
  $('#fixes').innerHTML = M.fixes.map((x, i) => `<label class="fix"><input type="checkbox" data-id="${x.f.id}"><div><b>${i + 1}. ${x.f.title}</b><small>−${x.dR.toFixed(0)} risk · −${x.dW.toFixed(0)} min peak wait · effort ${['', 'low', 'med', 'high'][x.f.effort]} · $${x.f.cost}k</small><div class="stack">${W.F_TERMS.map(t => `<i style="--k:${t[3]};width:${x.part[t[0]] * 100}%"></i>`).join('')}</div></div><span class="mono" style="font-weight:600">${pct(x.prio)}</span></label>`).join('') +
    (done.length ? `<p class="note" style="margin-top:10px">Applied: ${done.map(f => '<b>' + f.title + '</b>').join(', ')} · <button class="btn" id="reset">Reset</button></p>` : '');
  pipe([`${Math.round(fl[0].daily)} arrivals/day ×${S.season.toFixed(2)}`, `${W.ST.length} stations`, `worst ${Math.round(worst.peakWait)} min @ ${worst.st.name}`, `${crit} weak points ≥100`, M.fixes[0] ? 'top fix ' + pct(M.fixes[0].prio) : 'all applied', M.fixes[0] ? M.fixes[0].f.title : 'plan complete']);
  save();
}

/* ---------------- Equations (copyable) ---------------- */
const EQ = [
  { t: 'Shared kernel A — queue wait (stage 3, both examples)', txt: 'Wq = ( ρ^(√(2(c+1)) − 1) / (c·(1 − ρ)) ) · ((ca² + cs²) / 2) · s     with ρ = λ·s / c  (ρ < 1)\nW_total = Wq + backlog/(c·μ)   (backlog carried hour-to-hour when λ > c·μ)', tex: 'W_q=\\frac{\\rho^{\\sqrt{2(c+1)}-1}}{c(1-\\rho)}\\cdot\\frac{c_a^2+c_s^2}{2}\\cdot s,\\quad \\rho=\\frac{\\lambda s}{c}', legend: [['λ', 'arrival rate'], ['c', 'servers / slots'], ['s', 'mean service time (1/μ)'], ['ca², cs²', 'squared coeff. of variation of arrivals / service'], ['ρ', 'utilisation']] },
  { t: 'Shared kernel B — gated weighted score (stage 5, both examples)', txt: 'Score = G · Σₖ ŵₖ · sₖ        ŵₖ = wₖ / Σⱼ wⱼ ,   sₖ ∈ [0,1] ,   G ∈ {0,1}', tex: '\\text{Score}=G\\cdot\\sum_k \\hat w_k s_k,\\quad \\hat w_k=\\frac{w_k}{\\sum_j w_j}', legend: [['G', 'all hard gates pass'], ['wₖ', 'policy slider'], ['sₖ', 'normalised sub-score']] },
  { t: '① Referral routing — full equation', txt: 'Score(f) = G(f) · [ ŵT·e^(−TTC/τᵤ) + ŵC·clamp((m_max − m)/(m_max − m_min)) + ŵP·tier(f) + ŵL·(1 − ρ′³) + ŵQ·Q̂ + ŵK·1[prev = f] ]\n\nTTC   = d/v + Wq(λ = booked + 1, c = slots, s = 1 day) · svcMult · (urgent ? 0.15 : 1)      [days]\nd     = 1.3 · ‖patient − f‖   (road factor),  v = 45 km/h\nτᵤ    = {7, 2, 0.25} days for {routine, soon, urgent}\nQ̂     = (n·q + k·q₀) / (n + k),   k = 100, q₀ = 0.75   (Bayesian shrinkage of quality)\nρ′    = (booked + 1) / slots\ntier  = {public 1, contracted 0.6, private 0.25},  m_min = 0.9, m_max = 2.8\nG(f)  = 1[covers all needs] · 1[ρ′ < 0.98] · 1[d ≤ reachᵤ],  reachᵤ = {120, 90, 60} km\nIf no f has G = 1 → split plan: greedy set-cover maximising Score(f, G=1) · |needs covered|', tex: '\\text{Score}(f)=G(f)\\Big[\\hat w_T e^{-TTC/\\tau_u}+\\hat w_C\\,\\tfrac{m_{max}-m}{m_{max}-m_{min}}+\\hat w_P\\,\\text{tier}(f)+\\hat w_L(1-\\rho\'^3)+\\hat w_Q\\hat Q+\\hat w_K\\mathbb 1[\\text{prev}=f]\\Big]', legend: [['T', 'time-to-care (travel + queue) vs urgency target — replaces raw distance'], ['C', 'cost'], ['P', 'public-first'], ['L', 'load balance after this patient joins'], ['Q', 'quality, shrunk toward prior when few reviews'], ['K', 'continuity of care']] },
  { t: '② Clinic flow — demand propagation (stage 1)', txt: 'λ_j(h) = Σ_{i→j} p_ij · λ_i(h),     λ_reception(h) = A(h) · season', tex: '\\lambda_j(h)=\\sum_{i\\to j}p_{ij}\\lambda_i(h),\\quad \\lambda_{rec}(h)=A(h)\\cdot\\text{season}', legend: [['A(h)', 'hourly arrivals'], ['p_ij', 'share routed from station i to j']] },
  { t: '② Clinic flow — weak-point risk RPN* (stage 4)', txt: 'RPN* = I · F · P · √D · (1 + κ · max(0, ρ_peak − 0.85)) · (1 + δ · λ_station / λ_clinic)\nκ = 2, δ = 0.5,  I,F,P,D ∈ 1..5', tex: 'RPN^*=I\\,F\\,P\\,\\sqrt D\\,\\big(1+\\kappa\\max(0,\\rho_{peak}-0.85)\\big)\\big(1+\\delta\\,\\tfrac{\\lambda_{st}}{\\lambda_{clinic}}\\big)', legend: [['I', 'impact'], ['F', 'frequency'], ['P', 'unpredictability'], ['D', 'detectability (5 = hidden)'], ['ρ_peak', 'from the queue kernel — risk grows when the station is already saturated'], ['λ share', 'more patients exposed → higher risk']] },
  { t: '② Clinic flow — fix priority (stage 5 + 6)', txt: 'Priority(x) = Feasible · [ ŵR·ΔRPN*(x)/maxΔRPN* + ŵP·reach(x) + ŵO·ΔWait(x)/maxΔWait + ŵB·breadth(x)/max ] / √effort(x)\n\nΔRPN*(x), ΔWait(x) are MARGINAL: the whole pipeline is re-run with x added to the already-applied fixes,\nso the plan is built greedily and never double-counts overlapping fixes.', tex: '\\text{Priority}(x)=\\frac{\\hat w_R\\frac{\\Delta RPN^*}{\\max}+\\hat w_P\\,\\text{reach}+\\hat w_O\\frac{\\Delta W}{\\max}+\\hat w_B\\frac{\\text{breadth}}{\\max}}{\\sqrt{\\text{effort}}}', legend: [['R', 'risk removed'], ['P', 'patient reach'], ['O', 'overload relief (queue minutes)'], ['B', 'breadth'], ['effort', '1 low · 2 med · 3 high']] }
];
function renderEq() {
  $('#eqs').innerHTML = EQ.map((e, i) => `<h3 style="margin-top:22px">${e.t}</h3><div class="eq"><div class="cp"><button data-c="${i}" data-f="txt">Copy</button><button data-c="${i}" data-f="tex">LaTeX</button></div><pre>${e.txt.replace(/</g, '&lt;')}</pre></div><div class="legendT">${e.legend.map((l, j) => `<div style="--k:${STAGES[j % 6][0]}"><b>${l[0]}</b> — ${l[1]}</div>`).join('')}</div>`).join('') +
    `<div style="margin-top:20px"><button class="btn p" data-all="1">Copy all equations</button></div>`;
  $('#eqs').onclick = e => { const b = e.target; if (b.dataset.all) copy(EQ.map(x => '## ' + x.t + '\n' + x.txt).join('\n\n')); else if (b.dataset.c) copy(EQ[b.dataset.c][b.dataset.f]); };
}

/* ---------------- tabs ---------------- */
function show(v) {
  S.view = v; if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['route', 'clinic', 'eq'].forEach(k => $('#v-' + k).hidden = k !== v);
  v === 'route' ? renderRoute() : v === 'clinic' ? renderClinic() : (renderEq(), pipe());
  save();
}
$('#tabs').onclick = e => e.target.dataset.v && show(e.target.dataset.v);
const fromHash = () => ['route', 'clinic', 'eq'].includes(location.hash.slice(1)) ? location.hash.slice(1) : null;
window.addEventListener('hashchange', () => fromHash() && show(fromHash()));
initRoute(); initClinic(); show(fromHash() || S.view || 'route');
