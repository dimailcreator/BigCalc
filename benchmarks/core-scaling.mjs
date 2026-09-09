import { performance } from "node:perf_hooks";

import {
  ballToOutwardInterval,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createInternalInterval,
  createRational,
  intervalToBall,
  precisionBitsForRequest,
  rationalToBall,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import {
  getLn2ProviderStateSnapshot,
  getPiProviderStateSnapshot
} from "../dist/core/math/constants.js";
import { getBernoulliCacheSnapshot } from "../dist/core/math/elementary.js";

const full = process.argv.includes("--full");
const json = process.argv.includes("--json");
const precisionGrid = full ? [100, 300, 1_000, 3_000, 10_000] : [100, 300, 1_000];
const cases = [
  { name: "pi", source: "π", fullMax: 10_000 },
  { name: "e", source: "e", fullMax: 3_000 },
  { name: "small-sin", source: "sin(1/10)", fullMax: 10_000 },
  { name: "sincos-tan", source: "tan(1/10)", fullMax: 3_000 },
  { name: "large-radian-sin", source: "sin(1000000)", fullMax: 1_000 },
  { name: "exp", source: "exp(1)", fullMax: 3_000 },
  { name: "ln-reduction", source: "ln(3)", fullMax: 3_000 },
  { name: "ln2", source: "ln(2)", fullMax: 10_000 },
  { name: "nth-root-power", source: "2^(1/2)", fullMax: 10_000 },
  {
    name: "gamma",
    source: "(1/3)!",
    settings: { factorialMode: "gamma" },
    quickMax: 300,
    fullMax: 1_000
  },
  {
    name: "gamma-reflection",
    source: "(-4/3)!",
    settings: { factorialMode: "gamma" },
    quickMax: 300,
    fullMax: 1_000
  }
];

const rows = [];
for (const benchmarkCase of cases) {
  const limit = full ? benchmarkCase.fullMax : (benchmarkCase.quickMax ?? 1_000);
  const digits = precisionGrid.filter((value) => value <= limit);
  await benchmarkExpression(benchmarkCase, digits, "sequential");
  await benchmarkExpression(benchmarkCase, [digits.at(-1)], "direct");
}

benchmarkConversions(precisionGrid);
benchmarkRationalToBall(precisionGrid);
benchmarkRationalNormalization(precisionGrid);

if (json) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  console.table(rows);
  process.stdout.write(
    "Memory columns are post-GC retained-process observations, not deterministic pass/fail thresholds.\n"
  );
}

async function benchmarkExpression(benchmarkCase, digits, mode) {
  let checkpoints = 0;
  const created = createEvaluationGraphFromSource(benchmarkCase.source, {
    settings: benchmarkCase.settings,
    checkpoint() {
      checkpoints += 1;
    }
  });
  if (!created.ok) throw new Error(`${benchmarkCase.name}: ${created.error.message}`);

  for (const significantDigits of digits) {
    collectGarbage();
    const before = process.memoryUsage();
    const checkpointsBefore = checkpoints;
    const started = performance.now();
    const ball = await created.graph.refine({ significantDigits });
    const refineMs = performance.now() - started;
    const extractionStarted = performance.now();
    const verified = verifiedNumberFromBall(ball, { significantDigits }, created.context.backend);
    const extractionMs = performance.now() - extractionStarted;
    collectGarbage();
    const after = process.memoryUsage();
    const checkpointDelta = checkpoints - checkpointsBefore;
    const structural = structuralSnapshot(benchmarkCase.name, created, checkpointDelta, ball);

    if (verified.verifiedDigits < significantDigits) {
      throw new Error(
        `${benchmarkCase.name}: insufficient verified digits at ${significantDigits}`
      );
    }

    rows.push({
      operation: benchmarkCase.name,
      mode,
      digits: significantDigits,
      timeMs: rounded(refineMs),
      extractionMs: rounded(extractionMs),
      heapMiB: mebibytes(after.heapUsed),
      rssMiB: mebibytes(after.rss),
      heapDeltaKiB: kibibytes(after.heapUsed - before.heapUsed),
      checkpoints: checkpointDelta,
      termCount: structural.termCount,
      termMetric: structural.termMetric,
      peakBigIntDigits: structural.peakBigIntDigits,
      peakMetric: structural.peakMetric,
      retainedBigIntDigits: structural.retainedBigIntDigits,
      stateReuse: structural.stateReuse
    });
  }
}

function structuralSnapshot(name, created, checkpointDelta, ball) {
  if (name === "pi") {
    const snapshot = getPiProviderStateSnapshot(created.context);
    return {
      termCount: snapshot.completedTerms,
      termMetric: "series-terms",
      peakBigIntDigits: snapshot.peakBigIntDigits,
      peakMetric: "working-state",
      retainedBigIntDigits: snapshot.cachedBigIntDigits,
      stateReuse: snapshot.sqrtReuseCount
    };
  }

  if (name === "ln2") {
    const snapshot = getLn2ProviderStateSnapshot(created.context);
    return {
      termCount: snapshot.completedTerms,
      termMetric: "series-terms",
      peakBigIntDigits: snapshot.peakBigIntDigits,
      peakMetric: "working-state",
      retainedBigIntDigits: snapshot.cachedBigIntDigits,
      stateReuse: snapshot.cacheHits
    };
  }

  if (name === "e") {
    const value = created.graph.evaluate();
    const snapshot = typeof value.getStateSnapshot === "function" ? value.getStateSnapshot() : {};
    return {
      termCount: snapshot.completedTerms ?? null,
      termMetric: "series-terms",
      peakBigIntDigits: snapshot.peakBigIntDigits ?? null,
      peakMetric: "working-state",
      retainedBigIntDigits: snapshot.cachedBigIntDigits ?? null,
      stateReuse: snapshot.lastRefinementReusedTerms ?? 0
    };
  }

  if (name === "gamma" || name === "gamma-reflection") {
    const snapshot = getBernoulliCacheSnapshot(created.context);
    return {
      termCount: snapshot.tangentNumbers,
      termMetric: "cached-coefficients",
      peakBigIntDigits: Math.max(snapshot.retainedBigIntDigits, ballComponentDigits(ball)),
      peakMetric: "retained-state/result",
      retainedBigIntDigits: snapshot.retainedBigIntDigits,
      stateReuse: snapshot.cachedBernoulliNumbers
    };
  }

  const graphSnapshot = created.graph.root.getStateSnapshot();
  return {
    // Some algorithms do not expose a literal series-term counter. Cooperative
    // checkpoints are their stable work-unit proxy and keep the scaling trend
    // observable without coupling the benchmark to private mutable state.
    termCount: checkpointDelta,
    termMetric: "checkpoints",
    peakBigIntDigits: ballComponentDigits(ball),
    peakMetric: "result-ball",
    retainedBigIntDigits: null,
    stateReuse: graphSnapshot.cacheHits
  };
}

function benchmarkConversions(digits) {
  for (const significantDigits of digits) {
    const context = createEvaluationContext();
    const precisionBits = precisionBitsForRequest({ significantDigits });
    const lower = context.backend.scaleByPowerOfTwo(
      context.backend.fromRational(createRational(1n, 3n), precisionBits, "towardNegativeInfinity"),
      1_000_000n
    );
    const upper = context.backend.scaleByPowerOfTwo(
      context.backend.fromRational(createRational(2n, 3n), precisionBits, "towardPositiveInfinity"),
      1_000_000n
    );
    const interval = createInternalInterval(lower, upper, context.backend);
    const repetitions = significantDigits <= 1_000 ? 100 : 20;
    collectGarbage();
    const before = process.memoryUsage();
    const started = performance.now();
    let ball;
    for (let index = 0; index < repetitions; index += 1) {
      ball = intervalToBall(interval, precisionBits, context.backend);
      ballToOutwardInterval(ball, precisionBits, context.backend);
    }
    const elapsed = performance.now() - started;
    collectGarbage();
    const after = process.memoryUsage();

    rows.push({
      operation: "interval-ball-conversion",
      mode: `${repetitions}x`,
      digits: significantDigits,
      timeMs: rounded(elapsed),
      extractionMs: null,
      heapMiB: mebibytes(after.heapUsed),
      rssMiB: mebibytes(after.rss),
      heapDeltaKiB: kibibytes(after.heapUsed - before.heapUsed),
      checkpoints: 0,
      termCount: repetitions,
      termMetric: "conversions",
      peakBigIntDigits: Math.ceil(
        ball.center.significand.toString(2).length * Math.LOG10E * Math.LN2
      ),
      peakMetric: "result-ball",
      retainedBigIntDigits: null,
      stateReuse: repetitions - 1
    });
  }
}

function benchmarkRationalToBall(digits) {
  for (const significantDigits of digits) {
    const context = createEvaluationContext();
    const precisionBits = precisionBitsForRequest({ significantDigits });
    const scale = 10n ** BigInt(significantDigits);
    const value = createRational(scale - 1n, scale + 7n);
    const repetitions = significantDigits <= 1_000 ? 100 : 20;
    collectGarbage();
    const before = process.memoryUsage();
    const started = performance.now();
    let ball;
    for (let index = 0; index < repetitions; index += 1) {
      ball = rationalToBall(value, precisionBits, context.backend);
    }
    const elapsed = performance.now() - started;
    collectGarbage();
    const after = process.memoryUsage();

    rows.push({
      operation: "rational-ball-conversion",
      mode: `${repetitions}x`,
      digits: significantDigits,
      timeMs: rounded(elapsed),
      extractionMs: null,
      heapMiB: mebibytes(after.heapUsed),
      rssMiB: mebibytes(after.rss),
      heapDeltaKiB: kibibytes(after.heapUsed - before.heapUsed),
      checkpoints: 0,
      termCount: repetitions,
      termMetric: "conversions",
      peakBigIntDigits: ballComponentDigits(ball),
      peakMetric: "result-ball",
      retainedBigIntDigits: value.numerator.toString().length + value.denominator.toString().length,
      stateReuse: repetitions - 1
    });
  }
}

function benchmarkRationalNormalization(digits) {
  for (const significantDigits of digits) {
    const commonFactor = 10n ** BigInt(significantDigits) - 1n;
    const started = performance.now();
    const normalized = createRational(commonFactor * 12_345n, commonFactor * 67_890n);
    const elapsed = performance.now() - started;
    rows.push({
      operation: "rational-normalization",
      mode: "direct",
      digits: significantDigits,
      timeMs: rounded(elapsed),
      extractionMs: null,
      heapMiB: mebibytes(process.memoryUsage().heapUsed),
      rssMiB: mebibytes(process.memoryUsage().rss),
      heapDeltaKiB: null,
      checkpoints: 0,
      termCount: 1,
      termMetric: "normalizations",
      peakBigIntDigits: significantDigits + 5,
      peakMetric: "input-rational",
      retainedBigIntDigits:
        normalized.numerator.toString().length + normalized.denominator.toString().length,
      stateReuse: 0
    });
  }
}

function collectGarbage() {
  globalThis.gc?.();
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function mebibytes(bytes) {
  return rounded(bytes / 1024 / 1024);
}

function kibibytes(bytes) {
  return rounded(bytes / 1024);
}

function ballComponentDigits(ball) {
  return Math.max(
    ball.center.significand.toString().replace("-", "").length,
    ball.radius.significand.toString().length
  );
}
