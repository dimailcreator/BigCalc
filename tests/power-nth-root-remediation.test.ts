import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCalculationHandleFromSource,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  createRationalPowerState,
  exactNthRootRationalWithProfile,
  integerRational,
  powRationalWithState,
  verifiedNumberFromBall
} from "../src/core/index.js";
import {
  createNthRootRefinementState,
  createRationalInterval,
  nthRootPositiveIntervalWithProfile,
  planNthRootStrategy,
  powRationalViaNthRootInterval
} from "../src/core/math/elementary.js";

void describe("stage 31 power and nth-root remediation", () => {
  void it("finds large perfect roots with scalable Newton and fast power checks", () => {
    const value = 1n << 100_000n;
    const result = exactNthRootRationalWithProfile(integerRational(value), 100_000n);

    assert.deepEqual(result.root, integerRational(2n));
    assert.equal(result.profile.initialBoundBits, 2);
    assert.equal(result.profile.newtonIterations < 10, true);
    assert.equal(result.profile.powerCheckMultiplications < 200, true);
    assert.equal(result.profile.peakBigIntDecimalDigits >= 30_000, true);
  });

  void it("rejects a large non-perfect root without a linear-degree power loop", () => {
    const value = (1n << 100_000n) + 1n;
    const result = exactNthRootRationalWithProfile(integerRational(value), 100_000n);

    assert.equal(result.root, null);
    assert.equal(result.profile.newtonIterations < 10, true);
    assert.equal(result.profile.powerCheckMultiplications < 200, true);
    assert.equal(result.profile.earlyAbortedPowerChecks > 0, true);
  });

  void it("routes large q away from the O(N*q)-digit direct representation", () => {
    const plan = planNthRootStrategy(
      1_000n,
      1_000,
      createRationalInterval(integerRational(2n), integerRational(2n))
    );
    const state = createNthRootRefinementState();
    const direct = powRationalViaNthRootInterval(
      integerRational(2n),
      createRational(1n, 1_000n),
      1_000,
      createEvaluationContext(),
      state
    );

    assert.equal(plan.strategy, "ln-exp");
    assert.equal(plan.reason, "nq-allocation");
    assert.equal(plan.estimatedNqAllocationDigits, 1_000_000n);
    assert.equal(plan.fallbackLnExpCost > 0n, true);
    assert.equal(direct, null);
    assert.equal(state.interval, null);
  });

  void it("profiles bounded direct nthRoot working size", () => {
    const context = createEvaluationContext();
    const result = nthRootPositiveIntervalWithProfile(
      createRationalInterval(integerRational(2n), integerRational(2n)),
      3n,
      100,
      context
    );

    assert.equal(result.profile.estimatedNqAllocationDigits, 300n);
    assert.equal(result.profile.peakBigIntDecimalDigits < 400, true);
    assert.equal(result.profile.newtonIterations > 0, true);
  });

  void it("switches a refinement state from direct root to ln+exp without an internal error", () => {
    const context = createEvaluationContext();
    const state = createNthRootRefinementState();
    const exponent = createRational(1n, 20n);
    const first = powRationalViaNthRootInterval(integerRational(2n), exponent, 10, context, state);
    const second = powRationalViaNthRootInterval(
      integerRational(2n),
      exponent,
      100,
      context,
      state
    );

    assert.ok(first !== null);
    assert.equal(second, null);
    assert.equal(state.strategy, "ln-exp");
    assert.equal(state.strategyChanges, 1);
  });

  void it("preserves verified prefixes when graph refinement uses the fallback route", async () => {
    const created = createEvaluationGraphFromSource("2^(1/1000)");
    assert.equal(created.ok, true);
    let prefix = "";

    for (const significantDigits of [10, 30]) {
      const ball = await created.graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, created.context.backend);
      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(prefix), true);
      prefix = verified.digits;
    }
  });

  void it("pauses and resumes a heavy exact integer power with retained state", async () => {
    let ticks = 0;
    const created = createCalculationHandleFromSource("2^100000", {
      now: () => ticks++,
      settings: { maxCalculationTimeMs: 5 },
      resourceLimits: { maxEstimatedBigIntDigits: 100_000 }
    });
    assert.equal(created.ok, true);

    let result = await created.handle.refine({ significantDigits: 10 });
    let pauses = 0;
    while (result.status === "paused") {
      pauses += 1;
      assert.equal(pauses < 20, true);
      ticks = 0;
      result = await created.handle.continue();
    }

    assert.equal(pauses > 0, true);
    assert.equal(result.status, "complete");
  });

  void it("rejects an oversized exact power before allocating its result", async () => {
    const created = createCalculationHandleFromSource("2^100000", {
      resourceLimits: { maxEstimatedBigIntDigits: 1_000 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
    assert.equal(result.error.resource, "memory");
  });

  void it("cancels a running exact power at a cooperative checkpoint", async () => {
    let checkpoints = 0;
    let cancel: (() => void) | null = null;
    const created = createCalculationHandleFromSource("3^100000", {
      checkpoint(): void {
        checkpoints += 1;
        if (checkpoints === 5) cancel?.();
      }
    });
    assert.equal(created.ok, true);
    cancel = () => {
      created.handle.cancel();
    };

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "cancelled");
    assert.equal(checkpoints, 5);
  });

  void it("makes exact root work cooperatively interruptible", () => {
    const interrupted = new Error("root interrupted");
    let checkpoints = 0;

    assert.throws(
      () =>
        exactNthRootRationalWithProfile(integerRational(1n << 100_000n), 100_000n, {
          checkpoint(): void {
            checkpoints += 1;
            if (checkpoints === 5) throw interrupted;
          }
        }),
      (error: unknown) => error === interrupted
    );
    assert.equal(checkpoints, 5);
  });

  void it("resumes checkpointed exponentiation-by-squaring without losing exactness", () => {
    const expected = integerRational(3n ** 1_000n);

    for (let pauseAt = 1; pauseAt <= 14; pauseAt += 1) {
      const state = createRationalPowerState();
      const paused = new Error("power paused");
      let checkpoints = 0;

      assert.throws(
        () =>
          powRationalWithState(integerRational(3n), 1_000n, state, {
            checkpoint(): void {
              checkpoints += 1;
              if (checkpoints === pauseAt) throw paused;
            }
          }),
        (error: unknown) => error === paused
      );

      const resumed = powRationalWithState(integerRational(3n), 1_000n, state);
      assert.deepEqual(resumed, expected);
      assert.equal(state.totalMultiplications < 20, true);
      assert.equal(state.estimatedResultDigits > 400, true);
    }
  });

  void it("preserves negative-base odd-denominator real semantics", async () => {
    const created = createEvaluationGraphFromSource("(-2)^(5/101)");
    assert.equal(created.ok, true);

    const ball = await created.graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 20 },
      created.context.backend
    );
    assert.equal(verified.sign, -1);
    assert.equal(verified.verifiedDigits >= 20, true);
  });
});
