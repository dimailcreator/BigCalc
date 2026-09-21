// A censored high-precision probe. Budget exhaustion is recorded separately from
// verified AR-0 measurements; it is never emitted as a successful timing row.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createEvaluationContext,
  createRational,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import {
  createGammaStirlingPlan,
  gammaRealBallWithProfile,
  getBernoulliCacheSnapshot
} from "../dist/core/math/elementary.js";
import { getStirlingCorrectionSnapshot } from "../dist/core/math/stirling-correction.js";

const digits = Number(process.argv[2] ?? 10000);
const budgetMs = Number(process.argv[3] ?? 60000);
const output = process.argv[4] ?? "benchmarks/results/ar-5-stirling-budget.json";
if (![digits, budgetMs].every((n) => Number.isSafeInteger(n) && n > 0))
  throw new Error("Usage: node benchmarks/stirling-budget.mjs [digits] [budgetMs] [output]");
const rows = [];
for (const family of ["legacy", "adaptive"]) {
  const exhausted = new Error("Benchmark time budget exhausted");
  let checkpoints = 0;
  const started = performance.now();
  const context = createEvaluationContext({
    checkpoint() {
      checkpoints++;
      if (performance.now() - started >= budgetMs) throw exhausted;
    }
  });
  let verifiedDigits = null,
    status = "budget-exceeded";
  try {
    const x = createRational(4n, 3n);
    const result = gammaRealBallWithProfile(
      { lower: x, upper: x },
      digits + 12,
      4 * digits + 256,
      context.backend,
      context,
      { stirlingStrategy: family }
    );
    if (result.ball === null) throw new Error("Gamma dependency unresolved");
    const verified = verifiedNumberFromBall(
      result.ball,
      { significantDigits: digits },
      context.backend
    );
    if (verified.verifiedDigits < digits) throw new Error("Insufficient verified precision");
    verifiedDigits = verified.verifiedDigits;
    status = "verified";
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  const row = {
    family,
    input: "Gamma(4/3)",
    requestedDigits: digits,
    budgetMs,
    elapsedMs: performance.now() - started,
    status,
    verifiedDigits,
    checkpoints,
    plan: createGammaStirlingPlan(digits + 12, { stirlingStrategy: family }),
    bernoulli: getBernoulliCacheSnapshot(context),
    correction: getStirlingCorrectionSnapshot(context)
  };
  rows.push(row);
  writeFileSync(
    output,
    JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 2) + "\n"
  );
  console.log(family, status, Math.round(row.elapsedMs));
}
