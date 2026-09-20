import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addRational,
  compareRational,
  createRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall,
  createCalculationHandleFromSource
} from "../src/core/index.js";
import type { Rational } from "../src/core/index.js";
import { AtanhLogKernel } from "../src/core/math/atanh-blocks.js";
import { AgmLogKernel } from "../src/core/math/log-agm.js";
import {
  ReducedLogProvider,
  routedReducedLog,
  getLogCacheSnapshot,
  selectLogLayout
} from "../src/core/math/log-router.js";
import {
  lnPositiveRationalIntervalWithProfile,
  reduceLnArgument
} from "../src/core/math/elementary.js";
import type { RationalBounds } from "../src/core/math/scaled-interval.js";

// Independent log(1+t) expansion, not atanh or AGM. Exact rational t is used
// for each outward power step; the remaining absolute tail is <= 2*|t|^(n+1)/(n+1).
function reference(value: Rational, digits: number): RationalBounds {
  if (value.numerator === 2n * value.denominator) {
    const half = reference(createRational(1n, 2n), digits);
    return {
      lower: createRational(-half.upper.numerator, half.upper.denominator),
      upper: createRational(-half.lower.numerator, half.lower.denominator)
    };
  }
  const negative = value.numerator < value.denominator;
  const numerator = negative
    ? value.denominator - value.numerator
    : value.numerator - value.denominator;
  assert.ok(2n * numerator <= value.denominator);
  const scale = 10n ** BigInt(digits + 30);
  let powerLo = scale,
    powerHi = scale,
    sumLo = 0n,
    sumHi = 0n;
  const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
  for (let k = 1; ; k += 1) {
    powerLo = (powerLo * numerator) / value.denominator;
    powerHi = ceil(powerHi * numerator, value.denominator);
    const lo = powerLo / BigInt(k),
      hi = ceil(powerHi, BigInt(k));
    if (negative || k % 2 === 0) {
      sumLo -= hi;
      sumHi -= lo;
    } else {
      sumLo += lo;
      sumHi += hi;
    }
    const next = ceil(powerHi * numerator, value.denominator);
    const tail = ceil(2n * next, BigInt(k + 1));
    if (tail <= 2n)
      return {
        lower: createRational(sumLo - tail, scale),
        upper: createRational(sumHi + tail, scale)
      };
  }
}
function contains(outer: RationalBounds, inner: RationalBounds): void {
  assert.ok(compareRational(outer.lower, inner.lower) <= 0);
  assert.ok(compareRational(outer.upper, inner.upper) >= 0);
}
function verified(bounds: RationalBounds, digits: number): string {
  const { backend } = createEvaluationContext();
  const bits = 4 * digits + 128;
  const ball = intervalToBall(
    createInternalInterval(
      backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
      backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
      backend
    ),
    bits,
    backend
  );
  const result = verifiedNumberFromBall(ball, { significantDigits: digits }, backend);
  assert.ok(result.verifiedDigits >= digits);
  return `${String(result.sign)}:${String(result.exponent10)}:${result.digits}`;
}

void describe("AR-2 logarithm kernels and routing", () => {
  void it("uses measured route bands and a near-one cost fast path", () => {
    const ordinary = createRational(3n, 4n);
    assert.equal(selectLogLayout(127, ordinary), "sequential");
    assert.equal(selectLogLayout(128, ordinary), "rectangular");
    assert.equal(selectLogLayout(4095, ordinary), "rectangular");
    assert.equal(selectLogLayout(4096, ordinary), "binary");
    const scale = 10n ** 50n;
    assert.equal(selectLogLayout(300, createRational(scale + 1n, scale)), "sequential");
    const zero = new AgmLogKernel(createRational(1n, 1n)).getInterval(
      100,
      createEvaluationContext()
    );
    assert.deepEqual(zero, { lower: createRational(0n, 1n), upper: createRational(0n, 1n) });
  });

  void it("contains independent logarithms through 10000 digits for both block layouts", () => {
    const value = createRational(3n, 4n);
    const kernels = [new AtanhLogKernel(value, "rectangular"), new AtanhLogKernel(value, "binary")];
    const context = createEvaluationContext();
    let previous = "";
    for (const digits of [100, 300, 1000, 3000, 10000]) {
      const truth = reference(value, digits + 4);
      const expected = verified(truth, digits);
      assert.ok(expected.startsWith(previous));
      for (const kernel of kernels) {
        const result = kernel.getInterval(digits + 4, context);
        contains(result, truth);
        assert.equal(verified(result, digits), expected);
      }
      previous = expected;
    }
  });

  void it("covers signs, near-one cancellation, tiny precision, and block boundaries", () => {
    const scale = 10n ** 50n;
    const context = createEvaluationContext();
    for (const value of [
      createRational(2n, 3n),
      createRational(4n, 3n),
      createRational(9n, 8n),
      createRational(2n, 1n),
      createRational(scale - 1n, scale),
      createRational(scale + 1n, scale)
    ]) {
      const truth = reference(value, 100);
      for (const layout of ["sequential", "rectangular", "binary"] as const) {
        for (const width of [1, 3, 16, 31]) {
          const kernel = new AtanhLogKernel(value, layout, width);
          for (const digits of [1, 3, 16, 33, 80])
            contains(kernel.getInterval(digits, context), truth);
        }
      }
    }
  });

  void it("certifies table-factor reduction and route changes without changing the value", () => {
    const context = createEvaluationContext();
    for (const value of [
      createRational(2n, 3n),
      createRational(113n, 100n),
      createRational(4n, 3n)
    ]) {
      const provider = new ReducedLogProvider(value, true);
      for (const digits of [20, 150, 1000])
        contains(provider.getInterval(digits, context), reference(value, digits));
    }
  });

  void it("contains a deterministic spread of rational arguments in every layout", () => {
    let seed = 17;
    const context = createEvaluationContext();
    for (let n = 0; n < 40; n += 1) {
      seed = (seed * 48271) % 2147483647;
      const denominator = 1000n;
      const value = createRational(BigInt(667 + (seed % 667)), denominator);
      const truth = reference(value, 80);
      for (const layout of ["sequential", "rectangular", "binary"] as const) {
        contains(new AtanhLogKernel(value, layout).getInterval(50, context), truth);
      }
    }
  });

  void it("resumes exact coefficient combines rather than rebuilding a paused block", () => {
    const kernel = new AtanhLogKernel(createRational(3n, 4n), "binary");
    const paused = new Error("pause");
    let stop = true;
    const context = createEvaluationContext({
      checkpoint() {
        if (
          stop &&
          kernel.getSnapshot().pendingPhase === "combine" &&
          kernel.getSnapshot().combineCount >= 2
        ) {
          stop = false;
          throw paused;
        }
      }
    });
    assert.throws(
      () => kernel.getInterval(150, context),
      (error: unknown) => error === paused
    );
    const result = kernel.getInterval(150, context);
    const fresh = new AtanhLogKernel(createRational(3n, 4n), "binary");
    assert.deepEqual(result, fresh.getInterval(150, createEvaluationContext()));
    assert.equal(kernel.getSnapshot().termCount, fresh.getSnapshot().termCount);
    assert.equal(kernel.getSnapshot().passes, 1);
  });

  void it("keeps suspended cache entries while bounding completed entries and separating owners", () => {
    let calls = 0,
      stop = true;
    const paused = new Error("pause");
    const context = createEvaluationContext({
      checkpoint() {
        if (stop && ++calls === 20) {
          stop = false;
          throw paused;
        }
      }
    });
    const value = createRational(3n, 4n);
    assert.throws(
      () => routedReducedLog(value, 150, context),
      (error: unknown) => error === paused
    );
    assert.equal(getLogCacheSnapshot(context).pending, 1);
    for (let n = 101; n <= 115; n += 1)
      routedReducedLog(createRational(BigInt(n), 100n), 20, context);
    assert.equal(getLogCacheSnapshot(context).pending, 1);
    assert.ok(getLogCacheSnapshot(context).entries <= 9);
    contains(routedReducedLog(value, 1000, context), reference(value, 1000));
    assert.equal(getLogCacheSnapshot(context).pending, 0);
    assert.ok(getLogCacheSnapshot(context).entries <= 8);
    assert.equal(getLogCacheSnapshot(createEvaluationContext()).entries, 0);
  });

  void it("keeps AGM sqrt state, and budgets the tiny initial modulus rounding error", () => {
    const provider = new AgmLogKernel(createRational(3n, 4n));
    let calls = 0,
      stop = true;
    const paused = new Error("pause");
    const context = createEvaluationContext({
      checkpoint() {
        calls += 1;
        // Regression: the original experiment stalled after losing digits in u.
        assert.ok(calls < 10000);
        if (stop && provider.getSnapshot().pendingRoot) {
          stop = false;
          throw paused;
        }
      }
    });
    assert.throws(
      () => provider.getInterval(100, context),
      (error: unknown) => error === paused
    );
    const result = provider.getInterval(100, context);
    contains(result, reference(createRational(3n, 4n), 100));
    assert.equal(verified(result, 90), verified(reference(createRational(3n, 4n), 100), 90));
  });

  void it("bounds AGM approximation error for both signs and near one", () => {
    for (const value of [
      createRational(2n, 3n),
      createRational(2n, 1n),
      createRational(1000001n, 1000000n)
    ]) {
      const provider = new AgmLogKernel(value);
      const context = createEvaluationContext();
      for (const digits of [20, 100, 300])
        contains(provider.getInterval(digits, context), reference(value, digits));
    }
  });

  void it("preserves direct huge-exponent reduction and interval endpoint monotonicity", async () => {
    const context = createEvaluationContext();
    for (const exponent of [-100000, 100000]) {
      const value =
        exponent > 0
          ? createRational(3n << BigInt(exponent), 2n)
          : createRational(3n, 2n << BigInt(-exponent));
      const reduction = reduceLnArgument(value, context);
      assert.ok(reduction.scaleSelectionComparisons <= 3);
      const result = lnPositiveRationalIntervalWithProfile(value, 40, context);
      assert.ok(result.profile.workingDigits < 60);
      const reduced = reference(reduction.value, 80),
        ln2 = reference(createRational(2n, 1n), 80);
      const scaleBound = (v: Rational) =>
        createRational(v.numerator * BigInt(reduction.power), v.denominator);
      const truth =
        reduction.power > 0
          ? {
              lower: addRational(reduced.lower, scaleBound(ln2.lower)),
              upper: addRational(reduced.upper, scaleBound(ln2.upper))
            }
          : {
              lower: addRational(reduced.lower, scaleBound(ln2.upper)),
              upper: addRational(reduced.upper, scaleBound(ln2.lower))
            };
      contains(result.interval, truth);
    }
    const graph = createEvaluationGraphFromSource("ln(1+1/10^50)");
    assert.ok(graph.ok);
    const ball = await graph.graph.refine({ significantDigits: 50 });
    const result = verifiedNumberFromBall(ball, { significantDigits: 50 }, graph.context.backend);
    assert.equal(result.exponent10, -51n);
    assert.equal(result.digits, "9".repeat(50));
  });

  void it("production ln pauses and continues with partial verified digits; cancel and hard failure stay distinct", async () => {
    let clock = 0,
      advance = false;
    const created = createCalculationHandleFromSource("ln(3)", {
      now: () => (advance ? clock++ : clock),
      settings: { maxCalculationTimeMs: 50 }
    });
    assert.ok(created.ok);
    const first = await created.handle.refine({ significantDigits: 10 });
    assert.equal(first.status, "complete");
    advance = true;
    let result = await created.handle.refine({ significantDigits: 1000 });
    assert.equal(result.status, "paused");
    assert.ok(result.partial !== null);
    for (let n = 0; n < 1000 && result.status === "paused"; n += 1)
      result = await created.handle.continue();
    assert.equal(result.status, "complete");
    assert.ok(result.value.digits.startsWith(first.value.digits));
    const cancelled = createCalculationHandleFromSource("ln(3)", {
      now: () => clock++,
      settings: { maxCalculationTimeMs: 2 }
    });
    assert.ok(cancelled.ok);
    assert.equal((await cancelled.handle.refine({ significantDigits: 300 })).status, "paused");
    cancelled.handle.cancel();
    assert.equal((await cancelled.handle.continue()).status, "cancelled");
    const hard = createCalculationHandleFromSource("ln(3)", {
      now: () => 0,
      resourceLimits: { maxEstimatedBigIntDigits: 3000 }
    });
    assert.ok(hard.ok);
    const failure = await hard.handle.refine({ significantDigits: 1000 });
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.code, "ResourceLimitError");
  });
});
