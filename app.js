import * as Q from './core/qual.js';
import * as M from './core/model.js';

const $ = s => document.querySelector(s);
const LS = 'tec.recoveryQual.v1';
const TARGETS = [0.9, 0.95, 0.97], CHART_T = [0.8, 0.9, 0.95], CONFS = [0.8, 0.9, 0.95];
const saved = JSON.parse(localStorage.getItem(LS) || '{}');
const state = { target: 0.95, conf: 0.9, dual: false, mains: 3, stage: null, ev: saved.ev || {}, logged: saved.logged || [] };
let R, plan = null, chartData = null, solveTimer = null;

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const eur = k => k >= 1000 ? `€${(k / 1000).toFixed(1)}M` : `€${Math.round(k)}k`;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 2200); }
function persist() {
  localStorage.setItem(LS, JSON.stringify({ ev: state.ev, logged: state.logged }));
  const h = new URLSearchParams({ target: state.target, conf: state.conf, trig: state.dual ? 'dual' : 'single', mains: state.mains });
  if (state.stage) h.set('stage', state.stage);
  history.replaceState(null, '', '#' + h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (TARGETS.includes(+h.get('target'))) state.target = +h.get('target');
  if (CONFS.includes(+h.get('conf'))) state.conf = +h.get('conf');
  if (h.get('trig')) state.dual = h.get('trig') === 'dual';
  if (['2', '3', '4'].includes(h.get('mains'))) state.mains = +h.get('mains');
  if (h.get('stage')) state.stage = h.get('stage');
}
const arch = (dual = state.dual) => ({ dualTrigger: dual, mainsNeeded: state.mains, ccf: 0.1 });
const stages = (dual) => M.stagesFor(arch(dual));
function evidence() {
  const base = M.EVIDENCE.map(e => ({ ...e, weight: state.ev[e.id]?.weight ?? e.weight, enabled: state.ev[e.id]?.enabled ?? true }));
  return base.concat(state.logged.map(l => ({ ...l, weight: 1, enabled: true })));
}
const post = () => Q.posteriors(M.PRIOR, evidence());

// ---------- render ----------
function seg(id, opts, cur, onPick) {
  const el = $(id);
  el.setAttribute('role', 'radiogroup');
  el.innerHTML = opts.map(([v, l]) => `<button role="radio" aria-checked="${v === cur}" data-v="${v}">${l}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => onPick(opts.find(o => String(o[0]) === b.dataset.v)[0]));
}
function renderControls() {
  seg('#segTarget', TARGETS.map(t => [t, pct(t, 0)]), state.target, v => { state.target = v; changed(); });
  seg('#segConf', CONFS.map(c => [c, pct(c, 0)]), state.conf, v => { state.conf = v; changed(true); });
  seg('#segArch', [[false, 'Single-string'], [true, 'Dual-string']], state.dual, v => { state.dual = v; changed(); });
  seg('#segMains', [[2, '2 of 4'], [3, '3 of 4'], [4, '4 of 4']], state.mains, v => { state.mains = v; changed(true); });
}
function renderHero() {
  const p = post(), st = stages(state.dual);
  const now = Q.systemLCB(st, p, state.conf);
  $('#heroTitle').innerHTML = `Today's evidence demonstrates <em>${pct(now.lcb)}</em> recovery reliability at ${pct(state.conf, 0)} confidence.`;
  $('#heroSub').textContent = `Bayesian roll-up of the Nyx recovery chain (deploy trigger, drogues, disreef cutters, drogue-to-main handover, four mains, splashdown) from Mission Possible, the Rome splashdown campaign and the Mojave drop test, with ${state.dual ? 'a dual-string' : 'a single-string'} deploy trigger. The planner finds the cheapest test campaign that, if every test passes, demonstrates the target.`;
  $('#statNow').textContent = pct(now.lcb);
  $('#statNowSub').textContent = `lower ${pct(state.conf, 0)} credible bound · posterior mean ${pct(now.mean)}`;
}
function renderChain() {
  const p = post(), st = stages(state.dual);
  const weak = Q.weakestLinks(st, p, state.conf)[0].e;
  $('#chain').innerHTML = st.map((s, i) => {
    const sm = Q.stageMoments(s, p);
    const lcb = Q.lcbFromMoments(sm.m1, sm.m2, state.conf);
    const archTxt = s.kind === 'dual' ? `2 strings, β = ${s.beta}` : s.n > 1 ? `${s.k} of ${s.n} needed` : 'single-string';
    return `<div class="stage${s.id === state.stage ? ' sel' : ''}${s.elements.includes(weak) ? ' weak' : ''}" role="option" tabindex="0" aria-selected="${s.id === state.stage}" data-id="${s.id}">
      <div class="n">0${i + 1}</div><div class="t">${s.label}</div><div class="arch">${archTxt}</div>
      <div class="v">${pct(lcb)}</div><div class="vs">lower bound · mean ${pct(sm.m1)}</div>
      <div class="meter"><b style="left:${lcb * 100}%;width:${Math.max(0, sm.m1 - lcb) * 100}%"></b><i style="width:${lcb * 100}%"></i></div></div>`;
  }).join('');
  $('#chain').querySelectorAll('.stage').forEach(el => { el.onclick = () => openStage(el.dataset.id); el.onkeydown = e => { if (e.key === 'Enter') openStage(el.dataset.id); }; });
}
function renderPlan() {
  const body = $('#planBody');
  $('#planTitle').textContent = `Cheapest campaign to ${pct(state.target, 0)} at ${pct(state.conf, 0)}`;
  if (!plan) { body.innerHTML = '<p class="fine">Solving…</p>'; return; }
  if (!plan.feasible) {
    $('#planTag').className = 'tag no'; $('#planTag').textContent = 'Not reachable with this test menu';
    $('#statPlan').textContent = 'Out of reach'; $('#statPlanSub').textContent = 'within the test menu limits';
    body.innerHTML = `<p class="fine">No combination within the menu limits reaches ${pct(state.target, 0)} at ${pct(state.conf, 0)}. A single-string element with no heritage needs ${R.successRun.n} consecutive successes to show ${pct(R.successRun.R, 0)} at ${pct(R.successRun.C, 0)} (n = ln(1−C)/ln R), so high targets need redundancy or heritage, not only more tests.</p>`;
    return;
  }
  $('#planTag').className = 'tag ok'; $('#planTag').textContent = `${plan.visited.toLocaleString()} plans checked`;
  $('#statPlan').textContent = eur(plan.cost);
  $('#statPlanSub').textContent = `${plan.counts.reduce((a, b) => a + b, 0)} tests · if all pass, lower bound ${pct(plan.lcb, 2)}`;
  const rows = M.TESTS.map((t, i) => plan.counts[i] ? `<tr><td>${t.name}<div class="sub">${Object.entries(t.trials).map(([e, n]) => `${n}× ${M.ELEMENTS[e].name.toLowerCase()}`).join(', ')}</div></td><td class="num">${plan.counts[i]}</td><td class="num">${eur(t.cost)}</td><td class="num">${eur(plan.counts[i] * t.cost)}</td></tr>` : '').join('');
  body.innerHTML = `<table class="tbl"><tr><th>Test</th><th class="num">Count</th><th class="num">Unit (assumed)</th><th class="num">Cost</th></tr>${rows}
    <tr class="total"><td>Total</td><td class="num">${plan.counts.reduce((a, b) => a + b, 0)}</td><td></td><td class="num">${eur(plan.cost)}</td></tr></table>
    <div class="kv"><div><span>If all pass</span><b>${pct(plan.lcb, 2)}</b></div><div><span>Posterior mean</span><b>${pct(plan.mean, 2)}</b></div><div><span>Clean sweep odds</span><b>${plan.pAllPass < 0.001 ? plan.pAllPass.toExponential(1) : pct(plan.pAllPass)}</b></div></div>
    <p class="fine">Exact over the grid: every combination of the first five test types is enumerated (pruned by cost) and the trigger end-to-end count is found by binary search, using the fact that the bound only rises with more passing tests. "Clean sweep odds" is the posterior predictive chance every test passes; a small value means expect failures, so fix-and-retest on the weakest link before a demonstration campaign.</p>`;
}
function renderChart() {
  const svg = $('#costChart');
  if (!chartData) { svg.innerHTML = '<text x="20" y="40">Solving…</text>'; return; }
  const W = 520, H = 260, L = 56, B = 34, T = 14;
  const all = [...chartData.single, ...chartData.dual].filter(d => d.cost != null);
  const ymax = Math.max(1000, ...all.map(d => d.cost)) * 1.15;
  const x = i => L + 40 + i * ((W - L - 80) / (CHART_T.length - 1));
  const y = v => T + (1 - v / ymax) * (H - T - B);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; g += `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e0dc"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${eur(v)}</text>`; }
  CHART_T.forEach((t, i) => { g += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${pct(t, 0)}</text>`; });
  const series = (arr, color, label, dy) => {
    const pts = arr.map((d, i) => d.cost != null ? [x(i), y(d.cost)] : null);
    let s = '', path = '';
    pts.forEach(p => { if (p) path += `${path ? 'L' : 'M'}${p[0]},${p[1]}`; });
    s += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2"/>`;
    pts.forEach((p, i) => { if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${color}"/><text x="${p[0] + 8}" y="${p[1] + dy}">${eur(arr[i].cost)}</text>`; else s += `<text x="${x(i) - 14}" y="${T + 30 + dy}" style="fill:${color}">out of reach</text>`; });
    return s;
  };
  g += series(chartData.single, '#0e0e0e', 'Single', -8) + series(chartData.dual, '#c9a900', 'Dual', 16);
  g += `<rect x="${L + 6}" y="${T}" width="10" height="3" fill="#0e0e0e"/><text x="${L + 20}" y="${T + 4}">Single-string trigger</text><rect x="${L + 150}" y="${T}" width="10" height="3" fill="#c9a900"/><text x="${L + 164}" y="${T + 4}">Dual-string (β = 0.1)</text>`;
  svg.innerHTML = g;
  const s = chartData.single[2], d = chartData.dual[2];
  $('#costNote').textContent = s.cost != null && d.cost != null ? `At ${pct(CHART_T[1], 0)} / ${pct(state.conf, 0)}, the dual-string trigger saves ${eur(s.cost - d.cost)} (${Math.round((1 - d.cost / s.cost) * 100)}%). Costs are assumed unit prices; the ranking is what matters.` : 'Some targets are out of reach with this test menu.';
}
function renderEvidence() {
  const ev = evidence();
  $('#evTable').innerHTML = `<tr><th>Use</th><th>Event</th><th>Counts as</th><th class="num">Weight</th></tr>` + ev.map(e => {
    const counts = Object.entries(e.trials).map(([el, [s, f]]) => `${M.ELEMENTS[el].name}: ${s} pass${f ? `, ${f} fail` : ''}`).join('<br>');
    const user = !!e.user;
    return `<tr class="${user ? 'user-row' : ''}"><td><input type="checkbox" ${e.enabled ? 'checked' : ''} data-id="${e.id}" aria-label="Use ${e.title}" ${user ? 'disabled' : ''}></td>
      <td><b>${e.title}</b> <span class="sub">· ${e.date}</span><div class="sub">${e.summary || ''} ${e.source ? `<a href="${e.source}" target="_blank" rel="noopener">source</a>` : ''}</div></td>
      <td class="sub">${counts}</td>
      <td class="num">${user ? '1.00' : `<input type="range" min="0" max="1" step="0.05" value="${e.weight}" data-w="${e.id}" aria-label="Weight for ${e.title}"> ${e.weight.toFixed(2)}`}</td></tr>`;
  }).join('');
  $('#evTable').querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = () => { state.ev[c.dataset.id] = { ...(state.ev[c.dataset.id] || {}), enabled: c.checked }; changed(true); });
  $('#evTable').querySelectorAll('input[type=range]').forEach(r => r.onchange = () => { state.ev[r.dataset.w] = { ...(state.ev[r.dataset.w] || {}), weight: +r.value }; changed(true); });
}
function openStage(id) {
  state.stage = id; persist();
  const p = post(), st = stages(state.dual), s = st.find(x => x.id === id);
  const sm = Q.stageMoments(s, p);
  const links = Q.weakestLinks(st, p, state.conf).filter(w => s.elements.includes(w.e));
  // Beta posterior density plot per element
  const plot = s.elements.map(e => {
    const { a, b } = p[e];
    let path = '';
    const xs = [];
    for (let i = 1; i < 200; i++) xs.push(i / 200);
    const dens = xs.map(x => Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - Q.lbeta(a, b)));
    const dmax = Math.max(...dens);
    xs.forEach((x, i) => { path += `${i ? 'L' : 'M'}${(10 + x * 380).toFixed(1)},${(110 - dens[i] / dmax * 95).toFixed(1)}`; });
    const lc = Q.ibetaInv(1 - state.conf, a, b);
    return `<div style="margin-top:16px"><div class="label dark">${M.ELEMENTS[e].name} · Beta(${a.toFixed(2)}, ${b.toFixed(2)})</div>
      <svg class="chart" viewBox="0 0 400 120"><line x1="10" x2="390" y1="110" y2="110" stroke="#d9d4ce"/><path d="${path}" fill="none" stroke="#0e0e0e" stroke-width="2"/>
      <line x1="${10 + lc * 380}" x2="${10 + lc * 380}" y1="10" y2="110" stroke="#c9a900" stroke-dasharray="4 3"/><text x="${Math.min(300, 14 + lc * 380)}" y="20">${pct(state.conf, 0)} bound ${pct(lc)}</text>
      <text x="10" y="119">0</text><text x="378" y="119">1</text></svg>
      <p class="fine">${M.ELEMENTS[e].note}</p></div>`;
  }).join('');
  $('#drawer').innerHTML = `<button class="pill outline close" id="drClose">Close</button><div class="label dark">Stage</div><h3>${s.label}</h3>
    <div class="kv"><div><span>Lower bound</span><b>${pct(Q.lcbFromMoments(sm.m1, sm.m2, state.conf))}</b></div><div><span>Mean</span><b>${pct(sm.m1)}</b></div><div><span>Redundancy</span><b style="font-size:20px">${s.kind === 'dual' ? '2 strings' : `${s.k} of ${s.n}`}</b></div></div>
    ${links.map(w => `<p class="fine">One more pass on <b>${M.ELEMENTS[w.e].name.toLowerCase()}</b> lifts the system bound by ${pct(w.gain, 2)}; one failure drops it by ${pct(w.loss, 2)}.</p>`).join('')}
    ${plot}`;
  $('#drawer').classList.remove('hidden');
  $('#drClose').onclick = closeStage;
  renderChain();
}
function closeStage() { state.stage = null; $('#drawer').classList.add('hidden'); persist(); renderChain(); }

// ---------- solve ----------
function solve() {
  plan = null; renderPlan();
  clearTimeout(solveTimer);
  solveTimer = setTimeout(() => {
    const p = post();
    plan = Q.cheapestPlan(stages(state.dual), p, M.TESTS, state.target, state.conf);
    renderPlan(); persist();
  }, 30);
}
function solveChart() {
  chartData = null; renderChart();
  setTimeout(() => {
    const p = post();
    const run = dual => CHART_T.map(t => { const r = Q.cheapestPlan(stages(dual), p, M.TESTS, t, state.conf); return { target: t, cost: r.feasible ? r.cost : null }; });
    chartData = { single: run(false), dual: run(true) };
    renderChart();
  }, 60);
}
function changed(chartToo = false) {
  renderControls(); renderHero(); renderChain(); renderEvidence();
  if (state.stage) openStage(state.stage);
  solve();
  if (chartToo || !chartData) solveChart(); else renderChart();
  persist();
}

// ---------- actions ----------
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportPlan() {
  if (!plan || !plan.feasible) { toast('No feasible plan to export'); return; }
  const out = { target: state.target, confidence: state.conf, architecture: arch(), evidence: evidence().filter(e => e.enabled).map(({ id, title, date, weight, trials }) => ({ id, title, date, weight, trials })),
    priors: M.PRIOR, tests: M.TESTS.map((t, i) => ({ ...t, count: plan.counts[i] })), totalCostEURk: plan.cost, lcbIfAllPass: plan.lcb, meanIfAllPass: plan.mean, pAllPass: plan.pAllPass,
    note: 'Unofficial concept demo. Priors, architecture and costs are assumptions.' };
  download(`nyx-recovery-plan-${Math.round(state.target * 100)}-${Math.round(state.conf * 100)}.json`, JSON.stringify(out, null, 2), 'application/json');
  toast('Plan exported (JSON)');
}
function exportCsv() {
  if (!plan || !plan.feasible) { toast('No feasible plan to export'); return; }
  const rows = M.TESTS.map((t, i) => [t.id, JSON.stringify(t.name), plan.counts[i], t.cost, plan.counts[i] * t.cost].join(','));
  download('nyx-recovery-plan.csv', ['test,name,count,unit_cost_eur_k,cost_eur_k', ...rows].join('\n'), 'text/csv');
  toast('Plan exported (CSV)');
}
function bindForm() {
  $('#addType').innerHTML = M.TESTS.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const syncFail = () => {
    const t = M.TESTS.find(x => x.id === $('#addType').value);
    $('#addFailEl').innerHTML = Object.keys(t.trials).map(e => `<option value="${e}">${M.ELEMENTS[e].name} failed</option>`).join('');
    $('#failElLabel').classList.toggle('hidden', $('#addOutcome').value === 'pass');
  };
  $('#addType').onchange = syncFail; $('#addOutcome').onchange = syncFail; syncFail();
  $('#addForm').onsubmit = e => {
    e.preventDefault();
    const t = M.TESTS.find(x => x.id === $('#addType').value), fail = $('#addOutcome').value === 'fail' ? $('#addFailEl').value : null;
    const trials = {};
    for (const [el, n] of Object.entries(t.trials)) trials[el] = el === fail ? [n - 1, 1] : [n, 0];
    state.logged.push({ id: `u${Date.now()}`, user: true, date: new Date().toISOString().slice(0, 10), title: `${t.name}${fail ? ' (failure)' : ''}`, summary: 'Logged in this browser.', trials });
    toast(`Logged ${t.name.toLowerCase()}${fail ? ' with a failure' : ''}; plan re-solved`);
    changed(true);
  };
  $('#btnReset').onclick = () => { state.ev = {}; state.logged = []; toast('Reset to public evidence'); changed(true); };
}

async function boot() {
  try {
    const r = await fetch('data/results.json'); if (!r.ok) throw new Error(`results.json HTTP ${r.status}`);
    R = await r.json();
    readHash();
    $('#btnExport').onclick = exportPlan; $('#btnCsv').onclick = exportCsv; $('#btnSolve').onclick = solve;
    bindForm();
    document.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
      const ids = stages(state.dual).map(s => s.id), i = ids.indexOf(state.stage);
      if (e.key === 'Escape') closeStage();
      else if (e.key === 'ArrowRight') { openStage(ids[Math.min(ids.length - 1, i + 1)]); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { openStage(ids[Math.max(0, i - 1)]); e.preventDefault(); }
      else if (e.key === 'd' || e.key === 'D') { state.dual = !state.dual; changed(); }
      else if (e.key === 'e' || e.key === 'E') exportPlan();
    });
    changed(true);
    $('#loading').classList.add('hidden');
  } catch (err) {
    console.error(err);
    $('#loading').classList.add('hidden'); $('#errorText').textContent = `Could not load the model (${err.message}).`; $('#error').classList.remove('hidden');
  }
}
boot();
