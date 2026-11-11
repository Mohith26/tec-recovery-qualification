import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Q from '../core/qual.js';
import * as M from '../core/model.js';

const R = JSON.parse(fs.readFileSync(new URL('../data/results.json', import.meta.url)));
const post = Q.posteriors(M.PRIOR, M.EVIDENCE);

test('special functions: incomplete beta matches closed forms and inverts', () => {
  assert.ok(Math.abs(Q.ibeta(0.3, 1, 1) - 0.3) < 1e-12);
  assert.ok(Math.abs(Q.ibeta(0.3, 2, 1) - 0.09) < 1e-12);
  assert.ok(Math.abs(Q.ibeta(0.3, 1, 3) - (1 - 0.7 ** 3)) < 1e-12);
  for (const [p, a, b] of [[0.1, 5, 2], [0.5, 0.5, 0.5], [0.9, 30, 1.5]]) assert.ok(Math.abs(Q.ibeta(Q.ibetaInv(p, a, b), a, b) - p) < 1e-9);
});

test('stage polynomials: k-of-n and dual-string formulas', () => {
  for (const x of [0, 0.3, 0.9, 1]) {
    assert.ok(Math.abs(Q.stageReliability({ kind: 'kofn', n: 4, k: 3 }, x) - (x ** 4 + 4 * x ** 3 * (1 - x))) < 1e-12);
    assert.ok(Math.abs(Q.stageReliability({ kind: 'kofn', n: 2, k: 1 }, x) - (1 - (1 - x) ** 2)) < 1e-12);
    assert.ok(Math.abs(Q.stageReliability({ kind: 'dual', beta: 0.1 }, x) - (1 - 0.1 * (1 - x) - 0.9 * (1 - x) ** 2)) < 1e-12);
  }
});

test('property: exact stage moments agree with Monte Carlo', () => {
  const rng = Q.mulberry32(4);
  for (let it = 0; it < 6; it++) {
    const p = { u: { a: 1 + rng() * 20, b: 0.5 + rng() * 3 }, v: { a: 1 + rng() * 20, b: 0.5 + rng() * 3 } };
    const st = { kind: 'kofn', n: 3, k: 2, elements: ['u', 'v'] };
    const ex = Q.stageMoments(st, p);
    let s1 = 0, s2 = 0; const N = 40000;
    for (let i = 0; i < N; i++) { const r = Q.stageReliability(st, Q.betaSample(p.u.a, p.u.b, rng) * Q.betaSample(p.v.a, p.v.b, rng)); s1 += r; s2 += r * r; }
    assert.ok(Math.abs(s1 / N - ex.m1) < 0.01 && Math.abs(s2 / N - ex.m2) < 0.01, JSON.stringify(ex));
  }
});

test('moment-matched lower bound tracks the Monte Carlo quantile near plan targets (single and dual)', () => {
  for (const dual of [false, true]) {
    const st = M.stagesFor({ dualTrigger: dual, mainsNeeded: 3, ccf: 0.1 });
    const plan = R.architectures[dual ? 'dual' : 'single'].plans['0.95'];
    const p = Q.addAllPass(post, M.TESTS, plan.counts);
    const a = Q.systemLCB(st, p, 0.9), b = Q.systemMC(st, p, 0.9, 60000, 3);
    assert.ok(Math.abs(a.mean - b.mean) < 0.002 && Math.abs(a.lcb - b.lcb) < 0.01, `${a.lcb} vs ${b.lcb}`);
  }
});

test('posteriors: weights scale evidence, disabled events are ignored', () => {
  const p = Q.posteriors({ x: { a: 1, b: 1 } }, [{ weight: 0.5, trials: { x: [4, 2] } }, { enabled: false, trials: { x: [100, 0] } }]);
  assert.deepEqual(p.x, { a: 3, b: 2 });
});

test('property: system bound rises with any passing test and falls with any failure', () => {
  const st = M.stagesFor({ dualTrigger: false, mainsNeeded: 3 });
  const base = Q.systemLCB(st, post, 0.9).lcb;
  for (const e of Object.keys(post)) {
    const up = { ...post, [e]: { a: post[e].a + 1, b: post[e].b } }, down = { ...post, [e]: { a: post[e].a, b: post[e].b + 1 } };
    assert.ok(Q.systemLCB(st, up, 0.9).lcb > base - 1e-12, e);
    assert.ok(Q.systemLCB(st, down, 0.9).lcb < base + 1e-12, e);
  }
});

test('redundancy helps: dual-string trigger and fewer mains needed raise the bound', () => {
  const s1 = Q.systemLCB(M.stagesFor({ dualTrigger: false, mainsNeeded: 3 }), post, 0.9).lcb;
  const s2 = Q.systemLCB(M.stagesFor({ dualTrigger: true, mainsNeeded: 3, ccf: 0.1 }), post, 0.9).lcb;
  const s3 = Q.systemLCB(M.stagesFor({ dualTrigger: false, mainsNeeded: 2 }), post, 0.9).lcb;
  assert.ok(s2 > s1 && s3 > s1);
});

test('probAllPass equals the product of Beta-binomial zero-failure probabilities', () => {
  const p = { x: { a: 3, b: 1 } };
  const tt = [{ trials: { x: 1 } }];
  // P(2 successes) = a(a+1)/((a+b)(a+b+1)) = 3*4/(4*5)
  assert.ok(Math.abs(Q.probAllPass(p, tt, [2]) - 12 / 20) < 1e-12);
});

test('property: cheapestPlan equals brute force on small random instances', () => {
  const rng = Q.mulberry32(17);
  for (let it = 0; it < 12; it++) {
    const pr = { u: { a: 1 + rng() * 5, b: 0.5 + rng() }, v: { a: 1 + rng() * 5, b: 0.5 + rng() }, w: { a: 1 + rng() * 5, b: 0.5 + rng() } };
    const st = [{ kind: 'kofn', n: 1, k: 1, elements: ['u'] }, { kind: 'kofn', n: 2, k: 1, elements: ['v'] }, { kind: 'kofn', n: 1, k: 1, elements: ['w'] }];
    const tests = [
      { cost: 50 + Math.round(rng() * 50), max: 6, step: 1, trials: { u: 1, v: 1, w: 1 } },
      { cost: 5 + Math.round(rng() * 10), max: 20, step: 2, trials: { v: 1 } },
      { cost: 3 + Math.round(rng() * 10), max: 30, step: 1, trials: { u: 1 } },
      { cost: 2 + Math.round(rng() * 10), max: 40, step: 1, trials: { w: 1 } },
    ];
    const target = 0.6 + rng() * 0.2;
    const a = Q.cheapestPlan(st, pr, tests, target, 0.9), b = Q.bruteForcePlan(st, pr, tests, target, 0.9);
    if (!b) { assert.equal(a.feasible, false); continue; }
    assert.ok(a.feasible && Math.abs(a.cost - b.cost) < 1e-9, `${a.cost} vs ${b.cost}`);
  }
});

test('headline: app pipeline reproduces the stored plans and the dual-string saving', () => {
  for (const key of ['single', 'dual']) {
    const A = R.architectures[key];
    const st = M.stagesFor(A.arch);
    assert.ok(Math.abs(Q.systemLCB(st, post, 0.9).lcb - A.now.lcb) < 1e-4);
    for (const [t, pl] of Object.entries(A.plans)) {
      const r = Q.cheapestPlan(st, post, M.TESTS, +t, 0.9);
      if (pl.feasible === false) { assert.equal(r.feasible, false); continue; }
      assert.equal(r.cost, pl.cost); assert.deepEqual(r.counts, pl.counts); assert.ok(r.lcb >= +t - 1e-6);
    }
  }
  const h = R.headline;
  assert.equal(h.singleCost, R.architectures.single.plans['0.95'].cost);
  assert.equal(h.dualCost, R.architectures.dual.plans['0.95'].cost);
  assert.ok(h.dualCost < h.singleCost);
  assert.ok(h.sentence.includes(`${Math.round(h.saving * 100)}% less`));
});

test('success-run rule: 230 straight successes show 99% at 90% (classic n = ln(1-C)/ln R)', () => {
  assert.equal(R.successRun.n, 230);
  assert.ok(Math.pow(0.99, 230) <= 0.1 && Math.pow(0.99, 229) > 0.1);
  // with a uniform prior, n successes give Beta(n+1,1); its 10% quantile is 0.1^(1/(n+1))
  assert.ok(Math.abs(Q.ibetaInv(0.1, 230, 1) - Math.pow(0.1, 1 / 230)) < 1e-9);
});

test('weakest link is the deploy trigger under public evidence (single-string)', () => {
  const st = M.stagesFor({ dualTrigger: false, mainsNeeded: 3 });
  assert.equal(Q.weakestLinks(st, post, 0.9)[0].e, 'trigger');
  assert.equal(R.architectures.single.weakest[0].e, 'trigger');
});
