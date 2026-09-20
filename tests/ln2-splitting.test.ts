import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareRational,
  createEvaluationContext,
  createRational,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall,
  createCalculationHandleFromSource,
  createCalculationHandle,
  createLazyRealNode
} from "../src/core/index.js";
import type { EvaluationGraphContext } from "../src/core/index.js";
import { SequentialLn2Provider } from "../src/core/math/constants.js";
import { SplittingLn2Provider } from "../src/core/math/ln2-splitting.js";
import type { RationalBounds } from "../src/core/math/scaled-interval.js";

// Independent expansion: -log(1-z)=sum z^k/k at z=1/2.
// Floor each exact term at scale S. The omitted tail is <= 1/((n+1)*2^n).
// It does not use the production atanh series, block layout, or interval helpers.
function reference(digits: number): RationalBounds {
  const scale = 10n ** BigInt(digits + 15);
  const terms = 4 * (digits + 15);
  let sum = 0n;
  let power = scale;
  for (let k = 1; k <= terms; k += 1) {
    power /= 2n;
    sum += power / BigInt(k);
  }
  const denominator = BigInt(terms + 1) * (1n << BigInt(terms));
  const tail = (scale + denominator - 1n) / denominator;
  return {
    lower: createRational(sum, scale),
    upper: createRational(sum + BigInt(terms) + tail, scale)
  };
}

function contains(outer: RationalBounds, inner: RationalBounds): void {
  assert.ok(compareRational(outer.lower, inner.lower) <= 0);
  assert.ok(compareRational(outer.upper, inner.upper) >= 0);
}

function prefix(bounds: RationalBounds, digits: number): string {
  const { backend } = createEvaluationContext();
  const bits = digits * 4 + 64;
  const interval = createInternalInterval(
    backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
    backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
    backend
  );
  const value = verifiedNumberFromBall(
    intervalToBall(interval, bits, backend),
    { significantDigits: digits },
    backend
  );
  assert.ok(value.verifiedDigits >= digits);
  return value.digits;
}

void describe("AR-1 ln2 splitting", () => {
  void it("contains an independent series through 10000 digits, preserving sequential prefixes", () => {
    const context = createEvaluationContext();
    const providers = ["rectangular", "binary"].flatMap((layout) =>
      (["persistent", "rebuild"] as const).map(
        (retention) => new SplittingLn2Provider(layout as "rectangular" | "binary", retention)
      )
    );
    const old = new SequentialLn2Provider();
    let previous = "";
    for (const digits of [100, 300, 1000, 3000, 10000]) {
      const truth = reference(digits + 4);
      const expected = prefix(truth, digits);
      assert.ok(expected.startsWith(previous));
      for (const provider of providers) {
        const bounds = provider.getInterval(digits + 4, context);
        contains(bounds, truth);
        assert.equal(prefix(bounds, digits), expected);
        assert.equal(provider.getInterval(1, context), bounds);
      }
      // Full old/new 10000 comparison also runs in the AR-0 benchmark grid;
      // avoid repeating the slow legacy 10000 summation in every normal test run.
      if (digits <= 1000) {
        const legacy = old.getInterval(digits + 4, context);
        contains(legacy, truth);
        assert.equal(prefix(legacy, digits), expected);
      }
      previous = expected;
    }
  });

  void it("keeps bounds valid at tiny precision and across block layouts and boundaries", () => {
    const context = createEvaluationContext();
    for (const blockSize of [1, 3, 17, 32, 64]) {
      for (const digits of [1, 2, 3, 15, 31, 32, 33, 64]) {
        const truth = reference(digits);
        let first: RationalBounds | null = null;
        for (const layout of ["rectangular", "binary"] as const) {
          const provider = new SplittingLn2Provider(layout, "rebuild", blockSize);
          const bounds = provider.getInterval(digits, context);
          contains(bounds, truth);
          if (first !== null) assert.deepEqual(bounds, first);
          first = bounds;
        }
      }
    }
  });

  void it("resumes a binary combine without recomputing completed leaves or blocks", () => {
    for (const retention of ["persistent", "rebuild"] as const) {
      const provider = new SplittingLn2Provider("binary", retention);
      const paused = new Error("test checkpoint pause");
      let stop = true;
      const context = createEvaluationContext({
        checkpoint() {
          const state = provider.getSnapshot();
          if (stop && state.pendingPhase === "combine" && state.combineCount >= 3) {
            stop = false;
            throw paused;
          }
        }
      });
      assert.throws(
        () => provider.getInterval(100, context),
        (error: unknown) => error === paused
      );
      const partial = provider.getSnapshot();
      assert.ok(partial.termCount > 0);
      assert.ok(partial.pendingStackDepth > 0);
      const resumed = provider.getInterval(100, context);
      const fresh = new SplittingLn2Provider("binary", retention);
      assert.deepEqual(resumed, fresh.getInterval(100, createEvaluationContext()));
      assert.equal(provider.getSnapshot().termCount, fresh.getSnapshot().termCount);
      assert.equal(provider.getSnapshot().combineCount, fresh.getSnapshot().combineCount);
      assert.equal(provider.getSnapshot().summationPasses, 1);
    }
  });

  void it("makes progress under repeated interruption in every layout and retention policy", () => {
    for (const layout of ["rectangular", "binary"] as const) {
      for (const retention of ["persistent", "rebuild"] as const) {
        const provider = new SplittingLn2Provider(layout, retention);
        const interrupted = new Error("pause");
        let checkpoints = 0;
        const control = {
          checkpoint() {
            if (++checkpoints % 7 === 0) throw interrupted;
          }
        };
        let result: RationalBounds | undefined;
        for (let attempts = 0; attempts < 1000 && result === undefined; attempts += 1) {
          try {
            result = provider.getInterval(100, control);
          } catch (error) {
            assert.equal(error, interrupted);
          }
        }
        assert.ok(result !== undefined);
        contains(result, reference(100));
        assert.equal(provider.getSnapshot().termCount, provider.getSnapshot().completedTerms);
        assert.equal(provider.getSnapshot().summationPasses, 1);
      }
    }
  });

  void it("honors real lifecycle timeout and cancellation at a pending binary combine", async () => {
    for (const cancel of [false, true]) {
      const provider = new SplittingLn2Provider();
      let clock = 0;
      let stop = true;
      const node = createLazyRealNode({
        kind: "lazy-real",
        refine(request, context) {
          const control = context as EvaluationGraphContext;
          const bounds = provider.getInterval(request.significantDigits + 4, control);
          const bits = request.significantDigits * 4 + 64;
          return Promise.resolve(
            intervalToBall(
              createInternalInterval(
                control.backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
                control.backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
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
          const state = provider.getSnapshot();
          if (stop && state.pendingPhase === "combine" && state.combineCount >= 3) {
            stop = false;
            if (cancel) handle.cancel();
            else clock = 10;
          }
        }
      });
      const result = await handle.refine({ significantDigits: 100 });
      assert.equal(result.status, cancel ? "cancelled" : "paused");
      assert.ok(provider.getSnapshot().pendingStackDepth > 0);
      clock = 0;
      const continued = await handle.continue();
      assert.equal(continued.status, cancel ? "cancelled" : "complete");
      if (!cancel) {
        assert.equal(provider.getSnapshot().termCount, provider.getSnapshot().completedTerms);
        assert.equal(provider.getSnapshot().summationPasses, 1);
      }
    }
  });

  void it("retains blocks only under the persistent policy and bounds rebuilding memory", () => {
    const context = createEvaluationContext();
    for (const retention of ["persistent", "rebuild"] as const) {
      const provider = new SplittingLn2Provider("binary", retention);
      provider.getInterval(100, context);
      provider.getInterval(1000, context);
      const state = provider.getSnapshot();
      assert.equal(state.reusedBlocks > 0, retention === "persistent");
      if (retention === "rebuild") assert.ok(state.cachedBigIntDigits < 7000);
      assert.ok(state.largeDivisions < state.termCount / 4);
    }
  });

  void it("preserves a pending job across cache hits and a larger replacement request", () => {
    const provider = new SplittingLn2Provider();
    const context = createEvaluationContext();
    const first = provider.getInterval(10, context);
    let calls = 0;
    const paused = new Error("pause");
    assert.throws(
      () =>
        provider.getInterval(100, {
          checkpoint() {
            if (++calls === 20) throw paused;
          }
        }),
      (error: unknown) => error === paused
    );
    const partial = provider.getSnapshot();
    assert.equal(provider.getInterval(5, context), first);
    assert.equal(provider.getSnapshot().pendingTerms, partial.pendingTerms);
    contains(provider.getInterval(200, context), reference(200));
    assert.equal(provider.getSnapshot().summationPasses, 3);
    assert.equal(provider.getSnapshot().highestRequestedDigits, 200);
  });

  void it("guards memory before allocation and propagates hard failure without publishing a result", () => {
    const provider = new SplittingLn2Provider();
    const failure = new Error("hard memory limit");
    const control = {
      checkpoint() {
        /* This test exercises the allocation guard. */
      },
      guardBigIntDigits() {
        throw failure;
      }
    };
    assert.throws(
      () => provider.getInterval(10000, control),
      (error: unknown) => error === failure
    );
    assert.equal(provider.getSnapshot().termCount, 0);
    assert.equal(provider.getSnapshot().highestRequestedDigits, 0);
  });

  void it("production ln2 pauses, continues, cancels and separates hard resource failure", async () => {
    let clock = 0;
    let advance = false;
    const created = createCalculationHandleFromSource("ln(2)", {
      settings: { maxCalculationTimeMs: 20 },
      now: () => (advance ? clock++ : clock)
    });
    assert.ok(created.ok);
    const first = await created.handle.refine({ significantDigits: 10 });
    assert.equal(first.status, "complete");
    advance = true;
    let result = await created.handle.refine({ significantDigits: 300 });
    assert.equal(result.status, "paused");
    assert.ok(result.partial !== null);
    for (let n = 0; n < 1000 && result.status === "paused"; n += 1)
      result = await created.handle.continue();
    assert.equal(result.status, "complete");
    assert.ok(result.value.digits.startsWith(first.value.digits));

    const cancelled = createCalculationHandleFromSource("ln(2)", {
      now: () => clock++,
      settings: { maxCalculationTimeMs: 2 }
    });
    assert.ok(cancelled.ok);
    assert.equal((await cancelled.handle.refine({ significantDigits: 100 })).status, "paused");
    cancelled.handle.cancel();
    assert.equal((await cancelled.handle.continue()).status, "cancelled");

    const hard = createCalculationHandleFromSource("ln(2)", {
      resourceLimits: { maxEstimatedBigIntDigits: 500 },
      now: () => 0
    });
    assert.ok(hard.ok);
    const failure = await hard.handle.refine({ significantDigits: 1000 });
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.code, "ResourceLimitError");
  });
});
