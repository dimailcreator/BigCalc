import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createCalculationHandleFromSource,
  createEvaluationContext,
  createFactorialState,
  createRational,
  factorialBigIntWithProfile,
  integerRational
} from "../src/core/index.js";
import {
  createRationalInterval,
  gammaRealIntervalWithProfile,
  getBernoulliCacheSnapshot,
  planHalfIntegerGammaStrategy
} from "../src/core/math/elementary.js";

const FACTORIAL_99 =
  933262154439441526816992388562667004907159682643816214685929638952175999932299156089414639761565182862536979208272237582511852109168640000000000000000000000n;

void describe("stage 32 Gamma and exact-factorial remediation", () => {
  void it("cost-gates huge positive and negative half-integers away from linear recurrence", () => {
    const positive = createRational(2_000_000_001n, 2n);
    const negative = createRational(-1_999_999_999n, 2n);
    const small = createRational(3n, 2n);

    for (const argument of [positive, negative]) {
      const plan = planHalfIntegerGammaStrategy(createRationalInterval(argument, argument), 20);
      assert.equal(plan.strategy, "general");
      assert.equal(plan.recurrenceSteps, 1_000_000_000n);
      assert.equal(plan.estimatedRecurrenceCost > plan.estimatedGeneralCost, true);
    }

    const smallPlan = planHalfIntegerGammaStrategy(createRationalInterval(small, small), 20);
    assert.equal(smallPlan.strategy, "recurrence");
    assert.equal(smallPlan.recurrenceSteps, 1n);
  });

  void it("applies the resource guard before materializing huge half-integer Gamma output", () => {
    const stopped = new Error("guarded huge Gamma");
    let guardedDigits = 0;
    const context = createEvaluationContext({
      guardBigIntDigits(estimatedDigits): void {
        guardedDigits = estimatedDigits;
        throw stopped;
      }
    });
    const argument = createRational(2_000_000_001n, 2n);

    assert.throws(
      () => gammaRealIntervalWithProfile(createRationalInterval(argument, argument), 20, context),
      (error: unknown) => error === stopped
    );
    assert.equal(guardedDigits >= 10_000_000_000, true);
  });

  void it("computes exact factorials through a balanced product tree", () => {
    const result = factorialBigIntWithProfile(99n);

    assert.equal(result.value, FACTORIAL_99);
    assert.equal(result.profile.multiplications, 97);
    assert.equal(result.profile.treeDepth < 10, true);
    assert.equal(result.profile.checkpoints, 195);
    assert.equal(result.profile.estimatedResultDigits >= result.value.toString().length, true);
  });

  void it("resumes the exact factorial tree from every checkpoint phase", () => {
    const expected = factorialBigIntWithProfile(100n).value;

    for (const pauseAt of [1, 2, 3, 50, 100, 150]) {
      const state = createFactorialState();
      const paused = new Error("factorial paused");
      let checkpoints = 0;

      assert.throws(
        () =>
          factorialBigIntWithProfile(
            100n,
            {
              checkpoint(): void {
                checkpoints += 1;
                if (checkpoints === pauseAt) throw paused;
              }
            },
            state
          ),
        (error: unknown) => error === paused
      );

      const resumed = factorialBigIntWithProfile(100n, undefined, state);
      assert.equal(resumed.value, expected);
    }
  });

  void it("pauses and continues a large exact factorial with retained tree state", async () => {
    let ticks = 0;
    const created = createCalculationHandleFromSource("1000!", {
      now: () => ticks++,
      settings: { maxCalculationTimeMs: 100 },
      resourceLimits: { maxEstimatedBigIntDigits: 10_000 }
    });
    assert.equal(created.ok, true);

    let result = await created.handle.refine({ significantDigits: 10 });
    let pauses = 0;
    while (result.status === "paused") {
      pauses += 1;
      assert.equal(pauses < 30, true);
      ticks = 0;
      result = await created.handle.continue();
    }

    assert.equal(pauses > 0, true);
    assert.equal(result.status, "complete");
  });

  void it("cancels exact factorial work cooperatively", async () => {
    let checkpoints = 0;
    let cancel: (() => void) | null = null;
    const created = createCalculationHandleFromSource("10000!", {
      checkpoint(): void {
        checkpoints += 1;
        if (checkpoints === 10) cancel?.();
      }
    });
    assert.equal(created.ok, true);
    cancel = () => {
      created.handle.cancel();
    };

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "cancelled");
    assert.equal(checkpoints, 10);
  });

  void it("rejects an oversized factorial before building its product tree", async () => {
    const created = createCalculationHandleFromSource("100000!", {
      resourceLimits: { maxEstimatedBigIntDigits: 1_000 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
    assert.equal(result.error.resource, "memory");
  });

  void it("continues an interrupted Bernoulli integer-cache frontier", () => {
    const before = getBernoulliCacheSnapshot();
    const requestedTerms = Math.floor(before.highestEvenIndex / 2) + 8;
    const interrupted = new Error("Bernoulli generation interrupted");
    const argument = integerRational(1_000n);
    const interval = createRationalInterval(argument, argument);

    assert.throws(
      () =>
        gammaRealIntervalWithProfile(
          interval,
          10,
          createEvaluationContext({
            checkpoint(): void {
              const snapshot = getBernoulliCacheSnapshot();
              if (
                snapshot.pendingOrder !== null &&
                snapshot.generationCheckpoints > before.generationCheckpoints
              ) {
                throw interrupted;
              }
            }
          }),
          { minimumCorrectionTerms: requestedTerms }
        ),
      (error: unknown) => error === interrupted
    );

    const pending = getBernoulliCacheSnapshot();
    assert.notEqual(pending.pendingOrder, null);
    const resumed = gammaRealIntervalWithProfile(interval, 10, createEvaluationContext(), {
      minimumCorrectionTerms: requestedTerms
    });
    const completed = getBernoulliCacheSnapshot();

    assert.ok(resumed.interval !== null);
    assert.equal(resumed.profile.correctionTerms >= requestedTerms, true);
    assert.equal(completed.pendingOrder, null);
    assert.equal(completed.highestEvenIndex >= requestedTerms * 2 + 2, true);
  });

  void it("executes 257 Stirling corrections and contains an independent exact reference", () => {
    const before = getBernoulliCacheSnapshot();
    const argument = integerRational(100n);
    const result = gammaRealIntervalWithProfile(
      createRationalInterval(argument, argument),
      10,
      createEvaluationContext(),
      { minimumCorrectionTerms: 257 }
    );
    const after = getBernoulliCacheSnapshot();
    const exact = integerRational(FACTORIAL_99);

    assert.ok(result.interval !== null);
    assert.equal(result.profile.correctionTerms >= 257, true);
    assert.equal(result.profile.highestBernoulliIndex >= 516, true);
    assert.equal(compareRational(result.interval.lower, exact) <= 0, true);
    assert.equal(compareRational(result.interval.upper, exact) >= 0, true);
    assert.equal(after.highestEvenIndex >= 516, true);
    assert.equal(after.convolutionProducts >= before.convolutionProducts, true);
    assert.equal(after.pendingOrder, null);

    gammaRealIntervalWithProfile(
      createRationalInterval(argument, argument),
      10,
      createEvaluationContext(),
      { minimumCorrectionTerms: 257 }
    );
    const cached = getBernoulliCacheSnapshot();
    assert.equal(cached.convolutionProducts, after.convolutionProducts);
    assert.equal(cached.retainedBigIntDigits, after.retainedBigIntDigits);
  });

  void it("profiles balanced recurrence-product bigint retention", () => {
    const argument = createRational(4n, 3n);
    const result = gammaRealIntervalWithProfile(
      createRationalInterval(argument, argument),
      100,
      createEvaluationContext()
    );

    assert.ok(result.interval !== null);
    assert.equal(result.profile.recurrenceFactors > 100, true);
    assert.equal(result.profile.recurrenceTreeDepth < result.profile.recurrenceFactors, true);
    assert.equal(result.profile.recurrenceProductPeakBigIntDigits > 0, true);
    assert.equal(
      result.profile.recurrenceProductPeakRetainedDigits >=
        result.profile.recurrenceProductPeakBigIntDigits,
      true
    );
    assert.equal(result.profile.usedReflection, false);
  });

  void it("keeps reflection routing and near-pole containment behavior", () => {
    const argument = createRational(-1000n, 3n);
    const result = gammaRealIntervalWithProfile(
      createRationalInterval(argument, argument),
      30,
      createEvaluationContext()
    );

    assert.ok(result.interval !== null);
    assert.equal(result.profile.usedReflection, true);
    assert.equal(result.profile.recurrenceFactors, 0);
  });
});
