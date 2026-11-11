// Recovery-qualification core: Bayesian system reliability of a capsule recovery
// chain (k-of-n redundancy, dual-string with common cause), exact posterior moments,
// a moment-matched lower credible bound, and an exact cheapest all-pass test campaign.
// Pure ES module (browser + node --test).

// ---------- special functions ----------
export function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
export const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 1e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
// regularized incomplete beta I_x(a, b)
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function ibetaInv(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
export const choose = (n, k) => Math.round(Math.exp(lchoose(n, k)));

// ---------- seeded RNG + Beta sampler (for Monte Carlo checks) ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function gammaSample(k, rng) {   // Marsaglia-Tsang
  if (k < 1) return gammaSample(k + 1, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gauss(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(a, b, rng) { const x = gammaSample(a, rng), y = gammaSample(b, rng); return x / (x + y); }

// ---------- stage polynomials ----------
// A stage has n identical paths; a path works if all its elements work (x = prod theta_e).
// kind 'kofn': stage works if >= k of n paths work.
// kind 'dual': two strings, beta-factor common cause: P(fail) = beta*q + (1-beta)*q^2, q = 1-x.
// Returns coefficients c_t with R = sum_t c_t x^t.
export function stagePoly(stage) {
  const coef = new Map();
  const add = (t, v) => coef.set(t, (coef.get(t) || 0) + v);
  if (stage.kind === 'dual') {
    const b = stage.beta ?? 0.1;
    // R = 1 - b(1-x) - (1-b)(1-x)^2 = 1 - b + b x - (1-b)(1 - 2x + x^2)
    add(0, 1 - b - (1 - b)); add(1, b + 2 * (1 - b)); add(2, -(1 - b));
  } else {
    const { n, k } = stage;
    for (let j = k; j <= n; j++) {
      // C(n,j) x^j (1-x)^(n-j) = C(n,j) sum_i C(n-j,i) (-1)^i x^(j+i)
      for (let i = 0; i <= n - j; i++) add(j + i, choose(n, j) * choose(n - j, i) * (i % 2 ? -1 : 1));
    }
  }
  return [...coef.entries()].filter(([, v]) => Math.abs(v) > 1e-15);
}
export function stageReliability(stage, x) { return stagePoly(stage).reduce((s, [t, c]) => s + c * x ** t, 0); }

// E[theta^t] under Beta(a, b)
export const betaPow = (a, b, t) => Math.exp(lgamma(a + t) - lgamma(a) + lgamma(a + b) - lgamma(a + b + t));

// exact first two moments of a stage's reliability given element posteriors post[e] = {a, b}
export function stageMoments(stage, post) {
  const poly = stagePoly(stage);
  const ex = t => stage.elements.reduce((p, e) => p * betaPow(post[e].a, post[e].b, t), 1);
  let m1 = 0, m2 = 0;
  for (const [t, c] of poly) m1 += c * ex(t);
  for (const [t, c] of poly) for (const [u, d] of poly) m2 += c * d * ex(t + u);
  return { m1, m2 };
}
// system = series of independent stages (each element belongs to one stage)
export function systemMoments(stages, post) {
  let m1 = 1, m2 = 1;
  for (const s of stages) { const r = stageMoments(s, post); m1 *= r.m1; m2 *= r.m2; }
  return { m1, m2 };
}
// moment-matched Beta lower credible bound at `conf`
export function lcbFromMoments(m1, m2, conf) {
  const v = Math.max(m2 - m1 * m1, 1e-18);
  const s = m1 * (1 - m1) / v - 1;
  if (!(s > 0)) return 0;
  return ibetaInv(1 - conf, m1 * s, (1 - m1) * s);
}
export function systemLCB(stages, post, conf) { const { m1, m2 } = systemMoments(stages, post); return { mean: m1, lcb: lcbFromMoments(m1, m2, conf) }; }

// Monte Carlo of the same quantity (used by tests to validate the moment match)
export function systemMC(stages, post, conf, n, seed) {
  const rng = mulberry32(seed), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const th = {};
    for (const e of Object.keys(post)) th[e] = betaSample(post[e].a, post[e].b, rng);
    let r = 1;
    for (const s of stages) r *= stageReliability(s, s.elements.reduce((p, e) => p * th[e], 1));
    out[i] = r;
  }
  const sorted = Float64Array.from(out).sort();
  return { mean: out.reduce((a, b) => a + b, 0) / n, lcb: sorted[Math.floor((1 - conf) * n)] };
}

// ---------- evidence -> posteriors ----------
// prior[e] = {a, b}; evidence = [{weight, trials: {e: [successes, failures]}}]
export function posteriors(prior, evidence) {
  const post = {};
  for (const e of Object.keys(prior)) post[e] = { a: prior[e].a, b: prior[e].b };
  for (const ev of evidence) {
    if (ev.enabled === false) continue;
    const w = ev.weight ?? 1;
    for (const [e, [s, f]] of Object.entries(ev.trials)) { post[e].a += w * s; post[e].b += w * f; }
  }
  return post;
}

// ---------- cheapest all-pass campaign ----------
// testTypes: [{id, cost, max, step, trials: {e: count}}]. We look for integer counts
// minimising total cost such that, if every test passes, the system LCB >= target.
// Exact over the grid: every combination is visited; the last test type with
// `binary: true` is solved by binary search (LCB is monotone in each count).
export function addAllPass(post, testTypes, counts) {
  const p = {};
  for (const e of Object.keys(post)) p[e] = { a: post[e].a, b: post[e].b };
  testTypes.forEach((tt, i) => { for (const [e, n] of Object.entries(tt.trials)) p[e].a += n * counts[i]; });
  return p;
}
export function probAllPass(post, testTypes, counts) {
  const N = {};
  testTypes.forEach((tt, i) => { for (const [e, n] of Object.entries(tt.trials)) N[e] = (N[e] || 0) + n * counts[i]; });
  let lp = 0;
  for (const [e, n] of Object.entries(N)) if (n > 0) lp += lgamma(post[e].a + n) - lgamma(post[e].a) + lgamma(post[e].a + post[e].b) - lgamma(post[e].a + post[e].b + n);
  return Math.exp(lp);
}
export function cheapestPlan(stages, post, testTypes, target, conf) {
  const K = testTypes.length;
  const grids = testTypes.map(tt => { const g = []; for (let c = 0; c <= tt.max; c += tt.step || 1) g.push(c); return g; });
  // which test types touch each stage -> memoise stage moments by those counts only
  const deps = stages.map(st => testTypes.map((tt, i) => st.elements.some(e => tt.trials[e]) ? i : -1).filter(i => i >= 0));
  const memo = stages.map(() => new Map());
  const stageM = (si, counts) => {
    const key = deps[si].map(i => counts[i]).join(',');
    let v = memo[si].get(key);
    if (!v) {
      const p = {};
      for (const e of stages[si].elements) {
        let a = post[e].a;
        deps[si].forEach(i => { a += (testTypes[i].trials[e] || 0) * counts[i]; });
        p[e] = { a, b: post[e].b };
      }
      v = stageMoments(stages[si], p);
      memo[si].set(key, v);
    }
    return v;
  };
  // feasible <=> moment-matched Beta CDF at target <= 1 - conf (no inverse needed)
  const feasible = counts => {
    let m1 = 1, m2 = 1;
    for (let si = 0; si < stages.length; si++) { const v = stageM(si, counts); m1 *= v.m1; m2 *= v.m2; }
    const vr = Math.max(m2 - m1 * m1, 1e-18), sz = m1 * (1 - m1) / vr - 1;
    if (!(sz > 0)) return false;
    return ibeta(target, m1 * sz, (1 - m1) * sz) <= 1 - conf;
  };
  const last = K - 1;
  let best = null, visited = 0;
  const counts = new Array(K).fill(0);
  const rec = (i, cost) => {
    if (best && cost >= best.cost) return;
    if (i === last) {
      const g = grids[last];
      counts[last] = g[g.length - 1]; visited++;
      if (!feasible(counts)) return;
      let lo = 0, hi = g.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; counts[last] = g[m]; visited++; if (feasible(counts)) hi = m; else lo = m + 1; }
      counts[last] = g[lo];
      const total = cost + g[lo] * testTypes[last].cost;
      if (!best || total < best.cost - 1e-9) best = { cost: total, counts: [...counts] };
      return;
    }
    for (const c of grids[i]) {
      counts[i] = c;
      if (best && cost + c * testTypes[i].cost >= best.cost) break;   // grids ascend, costs >= 0
      rec(i + 1, cost + c * testTypes[i].cost);
    }
    counts[i] = 0;
  };
  rec(0, 0);
  if (!best) return { feasible: false, visited };
  const p = addAllPass(post, testTypes, best.counts);
  const sys = systemLCB(stages, p, conf);
  return { feasible: true, visited, cost: best.cost, counts: best.counts, lcb: sys.lcb, mean: sys.mean, pAllPass: probAllPass(post, testTypes, best.counts) };
}
// brute force over the full grid (no pruning, no binary search) for tests
export function bruteForcePlan(stages, post, testTypes, target, conf) {
  const grids = testTypes.map(tt => { const g = []; for (let c = 0; c <= tt.max; c += tt.step || 1) g.push(c); return g; });
  let best = null;
  const counts = new Array(testTypes.length).fill(0);
  const rec = i => {
    if (i === testTypes.length) {
      const cost = counts.reduce((s, c, j) => s + c * testTypes[j].cost, 0);
      if (best && cost >= best.cost) return;
      if (systemLCB(stages, addAllPass(post, testTypes, counts), conf).lcb >= target) best = { cost, counts: [...counts] };
      return;
    }
    for (const c of grids[i]) { counts[i] = c; rec(i + 1); }
  };
  rec(0);
  return best;
}
// which element limits the system: LCB gain from one extra success on each element
export function weakestLinks(stages, post, conf) {
  const base = systemLCB(stages, post, conf).lcb;
  return Object.keys(post).map(e => {
    const p = { ...post, [e]: { a: post[e].a + 1, b: post[e].b } };
    const q = { ...post, [e]: { a: post[e].a, b: post[e].b + 1 } };
    return { e, gain: systemLCB(stages, p, conf).lcb - base, loss: base - systemLCB(stages, q, conf).lcb };
  }).sort((x, y) => y.gain - x.gain);
}
