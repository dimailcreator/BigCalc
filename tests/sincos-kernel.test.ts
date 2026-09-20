import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRational,
  integerRational,
  absRational,
  addRational,
  subtractRational,
  multiplyRational,
  divideRational,
  negateRational,
  compareRational,
  createEvaluationContext,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall,
  createCalculationHandle,
  createCalculationHandleFromSource,
  createLazyRealNode,
  createEvaluationGraphFromSource
} from "../src/core/index.js";
import type { Rational, EvaluationGraphContext } from "../src/core/index.js";
import { SinCosKernel } from "../src/core/math/sincos-kernel.js";
import { BitBurstSinCosKernel } from "../src/core/math/sincos-bit-burst.js";
import { getSinCosCacheSnapshot, routedSmallSinCos } from "../src/core/math/sincos-router.js";
import {
  legacySinCosSmallPointInterval,
  sincosSmallInterval,
  sinAngleIntervalWithProfile,
  cosAngleIntervalWithProfile,
  tanAngleIntervalWithProfile
} from "../src/core/math/elementary.js";
import { scaledIntervalToRationalBounds } from "../src/core/math/scaled-interval.js";
import type { RationalBounds, ScaledInterval } from "../src/core/math/scaled-interval.js";
import { getPiProviderStateSnapshot } from "../src/core/math/constants.js";

const synchronous = {
  checkpoint() {
    /* Direct mathematical comparison without timeout. */
  }
};
function contains(outer: RationalBounds, inner: RationalBounds) {
  assert.ok(compareRational(outer.lower, inner.lower) <= 0);
  assert.ok(compareRational(outer.upper, inner.upper) >= 0);
}
function bounds(value: ScaledInterval | null) {
  assert.ok(value !== null);
  return scaledIntervalToRationalBounds(value);
}
function prefix(value: ScaledInterval | null, digits: number): string {
  const interval = bounds(value),
    { backend } = createEvaluationContext(),
    bits = 4 * digits + 256;
  const verified = verifiedNumberFromBall(
    intervalToBall(
      createInternalInterval(
        backend.fromRational(interval.lower, bits, "towardNegativeInfinity"),
        backend.fromRational(interval.upper, bits, "towardPositiveInfinity"),
        backend
      ),
      bits,
      backend
    ),
    { significantDigits: digits },
    backend
  );
  assert.ok(verified.verifiedDigits >= digits);
  return verified.digits;
}
// Independent exact Rational arithmetic: no fixed-point powers, coefficient
// blocks, dyadic reconstruction or production kernel. Its next-term bound
// rigorously encloses the infinite alternating series on [-1,1].
function exactReference(value: Rational, kind: "sin" | "cos"): RationalBounds {
  const square = multiplyRational(value, value);
  let term = kind === "sin" ? value : integerRational(1n),
    sum = term;
  const targetScale = 10n ** 360n;
  for (let n = 0; ; n++) {
    const a = BigInt(2 * n + (kind === "sin" ? 2 : 1));
    term = divideRational(
      negateRational(multiplyRational(term, square)),
      integerRational(a * (a + 1n))
    );
    const tail = absRational(term);
    if (tail.numerator * targetScale <= tail.denominator)
      return { lower: subtractRational(sum, tail), upper: addRational(sum, tail) };
    sum = addRational(sum, term);
  }
}
void describe("AR-4 sincos kernels", () => {
  void it("contains the unreduced reference and preserves prefixes through 10000 digits", () => {
    const argument = createRational(1n, 10n),
      control = createEvaluationContext();
    const kernels = [
      new SinCosKernel(argument, "both", "rectangular"),
      new SinCosKernel(argument, "both", "binary"),
      new SinCosKernel(argument, "sin", "binary"),
      new SinCosKernel(argument, "cos", "binary"),
      new BitBurstSinCosKernel(argument)
    ];
    const previous = kernels.map(() => ({ sin: "", cos: "" }));
    for (const digits of [100, 300, 1000, 3000, 10000]) {
      const reference = legacySinCosSmallPointInterval(argument, digits + 30, control, {
        needSin: true,
        needCos: true
      });
      assert.ok(reference.sinInterval !== null && reference.cosInterval !== null);
      kernels.forEach((kernel, i) => {
        const result = kernel.getInterval(digits + 12, control),
          old = previous[i];
        assert.ok(old !== undefined);
        for (const kind of ["sin", "cos"] as const)
          if (result[kind] !== null) {
            const ref = kind === "sin" ? reference.sinInterval : reference.cosInterval;
            assert.ok(ref !== null);
            contains(bounds(result[kind]), ref);
            const text = prefix(result[kind], digits);
            assert.ok(text.startsWith(old[kind]));
            old[kind] = text;
          }
      });
    }
  });
  void it("contains exact Rational series on signed boundary and random inputs", () => {
    const values = [
      createRational(-1n, 1n),
      createRational(0n, 1n),
      createRational(1n, 1n),
      createRational(1n, 10n ** 50n)
    ];
    for (let i = 1; i <= 20; i++) values.push(createRational(BigInt(((i * 73) % 199) - 99), 100n));
    for (const value of values) {
      const reference = { sin: exactReference(value, "sin"), cos: exactReference(value, "cos") };
      for (const digits of [1, 3, 100])
        for (const mode of ["sin", "cos", "both"] as const)
          for (const layout of ["sequential", "rectangular", "binary"] as const) {
            const kernel = new SinCosKernel(value, mode, layout),
              result = kernel.getInterval(digits, synchronous);
            if (result.sin !== null) contains(bounds(result.sin), reference.sin);
            if (result.cos !== null) contains(bounds(result.cos), reference.cos);
            assert.equal(kernel.getSnapshot().sinSeriesEvaluations, mode === "cos" ? 0 : 1);
            assert.equal(kernel.getSnapshot().cosSeriesEvaluations, mode === "sin" ? 0 : 1);
            assert.equal(kernel.getSnapshot().sharedSquareEvaluations, 1);
          }
      const burst = new BitBurstSinCosKernel(value).getInterval(100, synchronous);
      contains(bounds(burst.sin), reference.sin);
      contains(bounds(burst.cos), reference.cos);
    }
  });
  void it("retains rigorous tails with different dyadic choices and shared/selective paths", () => {
    const value = createRational(3n, 4n),
      reference = { sin: exactReference(value, "sin"), cos: exactReference(value, "cos") };
    for (const s of [0, 1, 8, 32])
      for (const layout of ["rectangular", "binary"] as const)
        for (const mode of ["cos", "both"] as const) {
          const result = new SinCosKernel(value, mode, layout, s).getInterval(100, synchronous);
          if (result.sin !== null) contains(bounds(result.sin), reference.sin);
          contains(bounds(result.cos), reference.cos);
        }
    assert.throws(() => new SinCosKernel(value, "sin", "binary", 1));
  });
  void it("preserves every committed term and double-angle step through interruption", () => {
    for (const mode of ["sin", "cos", "both"] as const)
      for (const phase of mode === "sin" ? ["sum"] : ["sum", "double"]) {
        const kernel = new SinCosKernel(createRational(3n, 4n), mode, "binary"),
          stop = new Error("pause");
        let paused = false;
        const control = {
          checkpoint() {
            const state = kernel.getSnapshot();
            if (
              !paused &&
              state.pendingPhase === phase &&
              (phase === "sum" ? state.termCount >= 3 : state.doubleAngleCount >= 2)
            ) {
              paused = true;
              throw stop;
            }
          }
        };
        assert.throws(
          () => kernel.getInterval(300, control),
          (e) => e === stop
        );
        const actual = kernel.getInterval(300, control),
          fresh = new SinCosKernel(kernel.argument, mode, "binary");
        assert.deepEqual(actual, fresh.getInterval(300, synchronous));
        assert.equal(kernel.getSnapshot().passes, 1);
        assert.equal(kernel.getSnapshot().termCount, fresh.getSnapshot().termCount);
        assert.equal(kernel.getSnapshot().doubleAngleCount, fresh.getSnapshot().doubleAngleCount);
      }
  });
  void it("handles typed timeout and cancellation inside combines and reconstruction", async () => {
    for (const phase of ["sum", "double"])
      for (const cancel of [false, true]) {
        const kernel = new SinCosKernel(createRational(1n, 10n), "both", "binary");
        let clock = 0,
          stop = true;
        const node = createLazyRealNode({
          kind: "lazy-real",
          refine(request, context) {
            const control = context as EvaluationGraphContext,
              interval = bounds(kernel.getInterval(request.significantDigits + 12, control).sin),
              bits = 4 * request.significantDigits + 128;
            return Promise.resolve(
              intervalToBall(
                createInternalInterval(
                  control.backend.fromRational(interval.lower, bits, "towardNegativeInfinity"),
                  control.backend.fromRational(interval.upper, bits, "towardPositiveInfinity"),
                  control.backend
                ),
                bits,
                control.backend
              )
            );
          }
        });
        const handle = createCalculationHandle(node, {
          now: () => clock,
          settings: { maxCalculationTimeMs: 10 },
          checkpoint() {
            const state = kernel.getSnapshot();
            if (
              stop &&
              state.pendingPhase === phase &&
              (phase === "sum"
                ? state.termCount >= 3 && state.treePhase === "combine"
                : state.doubleAngleCount >= 2)
            ) {
              stop = false;
              if (cancel) handle.cancel();
              else clock = 10;
            }
          }
        });
        assert.equal(
          (await handle.refine({ significantDigits: 300 })).status,
          cancel ? "cancelled" : "paused"
        );
        assert.equal(kernel.pending, true);
        clock = 0;
        assert.equal((await handle.continue()).status, cancel ? "cancelled" : "complete");
        assert.equal(kernel.getSnapshot().passes, 1);
      }
  });
  void it("resumes bit-burst chunks without recomputing committed terms", () => {
    const value = createRational(-123456789n, 200000000n),
      kernel = new BitBurstSinCosKernel(value),
      stop = new Error("pause");
    let calls = 0;
    assert.throws(
      () =>
        kernel.getInterval(300, {
          checkpoint() {
            if (++calls === 100) throw stop;
          }
        }),
      (e) => e === stop
    );
    const result = kernel.getInterval(300, synchronous),
      fresh = new BitBurstSinCosKernel(value);
    assert.deepEqual(result, fresh.getInterval(300, synchronous));
    assert.equal(kernel.getSnapshot().termCount, fresh.getSnapshot().termCount);
  });
  void it("finishes pending endpoints before route changes and bounds context-local storage", () => {
    const stop = new Error("pause");
    let calls = 0,
      enabled = true;
    const control = {
      checkpoint() {
        if (enabled && ++calls === 50) throw stop;
      }
    };
    assert.throws(
      () => routedSmallSinCos(createRational(1n, 10n), 300, "both", control),
      (e) => e === stop
    );
    assert.equal(getSinCosCacheSnapshot(control).pending, 1);
    enabled = false;
    routedSmallSinCos(createRational(3n, 10n), 500, "sin", control);
    assert.equal(getSinCosCacheSnapshot(control).pending, 0);
    for (let i = 1; i <= 12; i++)
      routedSmallSinCos(createRational(BigInt(i), 20n), 20, "cos", control);
    assert.ok(getSinCosCacheSnapshot(control).entries <= 8);
    assert.equal(getSinCosCacheSnapshot(synchronous).entries, 0);
    const kernel = new SinCosKernel(createRational(1n, 2n));
    assert.throws(
      () =>
        kernel.getInterval(1000, {
          ...synchronous,
          guardBigIntDigits() {
            throw stop;
          }
        }),
      (e) => e === stop
    );
    assert.equal(kernel.getSnapshot().passes, 0);
  });
  void it("preserves interval extrema, endpoint tan containment and standalone selectivity", () => {
    const context = createEvaluationContext(),
      argument = { lower: createRational(-1n, 10n), upper: createRational(1n, 5n) };
    const result = sincosSmallInterval(argument, 300, context);
    contains(result.sinInterval, exactReference(argument.lower, "sin"));
    contains(result.sinInterval, exactReference(argument.upper, "sin"));
    assert.equal(compareRational(result.cosInterval.upper, integerRational(1n)), 0);
    const before = getPiProviderStateSnapshot(context);
    for (const [operation, call] of [
      ["sin", sinAngleIntervalWithProfile],
      ["cos", cosAngleIntervalWithProfile]
    ] as const) {
      const value = call(argument, 300, "radians", context);
      assert.ok(value.interval !== null);
      assert.equal(value.profile.piRequestedDigits, 0);
      assert.equal(
        value.profile[operation === "sin" ? "cosSeriesEvaluations" : "sinSeriesEvaluations"],
        0
      );
    }
    assert.equal(getPiProviderStateSnapshot(context).intervalRequests, before.intervalRequests);
    const tangent = tanAngleIntervalWithProfile(argument, 300, "radians", context);
    assert.ok(tangent.interval !== null);
    assert.equal(tangent.profile.tanEndpointHullEvaluations, 1);
    for (const point of [argument.lower, argument.upper]) {
      const sin = exactReference(point, "sin"),
        cos = exactReference(point, "cos");
      const candidates = [
        divideRational(sin.lower, cos.lower),
        divideRational(sin.lower, cos.upper),
        divideRational(sin.upper, cos.lower),
        divideRational(sin.upper, cos.upper)
      ].sort(compareRational);
      const lower = candidates[0],
        upper = candidates.at(-1);
      assert.ok(lower !== undefined && upper !== undefined);
      contains(tangent.interval, { lower, upper });
    }
  });
  void it("keeps production prefixes, near-pole signs and handle resource semantics", async () => {
    for (const source of [
      "sin(1/10)",
      "cos(1/10)",
      "tan(1/10)",
      "sin(4)",
      "cos(4)",
      "tan(π/2+1/1000000)"
    ]) {
      const created = createEvaluationGraphFromSource(source);
      assert.ok(created.ok);
      let previous = "";
      for (const significantDigits of [100, 300]) {
        const result = verifiedNumberFromBall(
          await created.graph.refine({ significantDigits }),
          { significantDigits },
          created.context.backend
        );
        assert.ok(result.verifiedDigits >= significantDigits);
        assert.ok(result.digits.startsWith(previous));
        previous = result.digits;
      }
    }
    let clock = 0;
    const created = createCalculationHandleFromSource("tan(1/10)", {
      now: () => clock++,
      settings: { maxCalculationTimeMs: 150 }
    });
    assert.ok(created.ok);
    let result = await created.handle.refine({ significantDigits: 1000 });
    assert.equal(result.status, "paused");
    for (let i = 0; i < 1000 && result.status === "paused"; i++)
      result = await created.handle.continue();
    assert.equal(result.status, "complete");
    const hard = createCalculationHandleFromSource("sin(1/10)", {
      resourceLimits: { maxEstimatedBigIntDigits: 3000 }
    });
    assert.ok(hard.ok);
    const failure = await hard.handle.refine({ significantDigits: 1000 });
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.code, "ResourceLimitError");
  });
});
