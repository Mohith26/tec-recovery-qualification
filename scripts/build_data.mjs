// Deterministic build: model assumptions + public evidence -> data/results.json
// (default plans the app shows instantly; the app re-solves live when inputs change).
import fs from 'node:fs';
import * as Q from '../core/qual.js';
import * as M from '../core/model.js';

const CONF = 0.9;
const post = Q.posteriors(M.PRIOR, M.EVIDENCE);
const out = { generated: 'node scripts/build_data.mjs', conf: CONF, posteriors: post, architectures: {} };
for (const [key, arch] of Object.entries({ single: { dualTrigger: false, mainsNeeded: 3 }, dual: { dualTrigger: true, mainsNeeded: 3, ccf: 0.1 } })) {
  const st = M.stagesFor(arch);
  const now = Q.systemLCB(st, post, CONF);
  const mc = Q.systemMC(st, post, CONF, 40000, 7);
  const plans = {};
  for (const target of [0.9, 0.95, 0.97]) {
    const r = Q.cheapestPlan(st, post, M.TESTS, target, CONF);
    plans[target] = r.feasible ? { cost: r.cost, counts: r.counts, lcb: +r.lcb.toFixed(5), mean: +r.mean.toFixed(5), pAllPass: r.pAllPass, visited: r.visited } : { feasible: false };
  }
  out.architectures[key] = { arch, now: { mean: +now.mean.toFixed(5), lcb: +now.lcb.toFixed(5), mcMean: +mc.mean.toFixed(5), mcLcb: +mc.lcb.toFixed(5) },
    weakest: Q.weakestLinks(st, post, CONF).slice(0, 3).map(w => ({ ...w, gain: +w.gain.toFixed(5), loss: +w.loss.toFixed(5) })), plans };
}
const s95 = out.architectures.single.plans[0.95], d95 = out.architectures.dual.plans[0.95];
out.headline = {
  target: 0.95, conf: CONF, singleCost: s95.cost, dualCost: d95.cost, saving: +(1 - d95.cost / s95.cost).toFixed(4),
  sentence: `Making the deploy trigger dual-string cuts the cheapest all-pass campaign that demonstrates 95% recovery reliability at 90% confidence from EUR ${(s95.cost / 1000).toFixed(1)}M to EUR ${(d95.cost / 1000).toFixed(1)}M (${Math.round((1 - d95.cost / s95.cost) * 100)}% less), under the stated cost assumptions.`,
};
// classic success-run rule for one single-string element (no prior): n = ln(1-C)/ln(R)
out.successRun = { R: 0.99, C: 0.9, n: Math.ceil(Math.log(0.1) / Math.log(0.99)) };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/results.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.headline), JSON.stringify(out.architectures.single.now), JSON.stringify(out.architectures.dual.now));
