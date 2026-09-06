import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createEvaluationContext,
  createRational,
  integerRational,
  multiplyRational
} from "../src/core/index.js";
import {
  getPiProviderStateSnapshot,
  getPiRationalInterval,
  getPiTailBoundSnapshot
} from "../src/core/math/constants.js";
import type { LazyReal, Rational } from "../src/core/index.js";

const CHUDNOVSKY_A = 13_591_409n;
const CHUDNOVSKY_B = 545_140_134n;
const CHUDNOVSKY_C3_OVER_24 = 10_939_058_860_032_000n;
const CHUDNOVSKY_RATIO_DENOMINATOR = 1_000_000_000_000n;

void describe("stage 28 constant state and scaling remediation", () => {
  void it("continues context-scoped sqrt(10005) refinement inside the pi provider", () => {
    const context = createEvaluationContext();
    let previous: { readonly lower: Rational; readonly upper: Rational } | null = null;
    let previousSqrt: { readonly lower: Rational; readonly upper: Rational } | null = null;

    for (const [index, digits] of [30, 120, 400].entries()) {
      const interval = getPiRationalInterval(context, digits, digits);
      const snapshot = getPiProviderStateSnapshot(context);

      assert.equal(snapshot.userRequestedDigits, digits);
      assert.equal(snapshot.providerWorkingDigits, digits + 8);
      assert.equal(snapshot.highestUserRequestedDigits, digits);
      assert.equal(snapshot.highestProviderWorkingDigits, digits + 8);
      assert.equal(snapshot.sqrtRefinementCalls, index + 1);
      assert.equal(snapshot.sqrtReuseCount, index);
      assert.equal(snapshot.sqrtWorkingDigits, digits + 8);
      assert.equal(snapshot.sqrtNewtonIterations > 0, true);
      assert.ok(snapshot.sqrtInterval !== null);

      if (previous !== null) {
        assert.equal(compareRational(interval.lower, previous.lower) >= 0, true);
        assert.equal(compareRational(interval.upper, previous.upper) <= 0, true);
      }
      if (previousSqrt !== null) {
        assert.equal(compareRational(snapshot.sqrtInterval.lower, previousSqrt.lower) >= 0, true);
        assert.equal(compareRational(snapshot.sqrtInterval.upper, previousSqrt.upper) <= 0, true);
      }
      previous = interval;
      previousSqrt = snapshot.sqrtInterval;
    }

    const independentContext = createEvaluationContext();
    getPiRationalInterval(independentContext, 120, 120);
    assert.equal(getPiProviderStateSnapshot(independentContext).sqrtReuseCount, 0);
  });

  void it("derives the rigorous Chudnovsky tail from retained split state", () => {
    const context = createEvaluationContext();
    getPiRationalInterval(context, 300, 300);
    const state = getPiProviderStateSnapshot(context);
    const tail = getPiTailBoundSnapshot(context);
    const independent = independentChudnovskyTailBound(tail.completedTerms);

    assert.equal(tail.coefficientSource, "split-levels");
    assert.equal(compareRational(tail.bound, independent), 0);
    assert.equal(state.tailCoefficientSource, "split-levels");
    assert.equal(state.tailStateBigIntCount, 0);
  });

  void it("retains only logarithmically many Chudnovsky split nodes", () => {
    const context = createEvaluationContext();

    for (const digits of [100, 500, 1500]) {
      getPiRationalInterval(context, digits, digits);
      const snapshot = getPiProviderStateSnapshot(context);
      const maximumBinaryCounterNodes = Math.floor(Math.log2(snapshot.completedBlocks)) + 1;

      assert.equal(snapshot.completedBlocks * 4, snapshot.completedTerms);
      assert.equal(snapshot.retainedSplitNodes <= maximumBinaryCounterNodes, true);
      assert.equal(snapshot.splitStateBigIntCount, snapshot.retainedSplitNodes * 3);
      assert.equal(snapshot.cachedBigIntDigits >= snapshot.splitStateBigIntDigits, true);
      assert.equal(snapshot.peakBigIntDigits > 0, true);
      assert.equal("cachedBlocks" in snapshot, false);
    }
  });

  void it("extends the e factorial series without recalculating its prefix", async () => {
    const context = createEvaluationContext();
    const definition = context.registry.getConstant("e");
    assert.ok(definition !== null);
    const value = definition.createValue(context);
    assert.equal(value.kind, "lazy-real");
    let previousTerms = 0;

    for (const digits of [100, 300, 1000]) {
      await value.refine({ significantDigits: digits }, context);
      const snapshot = eStateSnapshot(value);

      assert.equal(snapshot.lastRefinementReusedTerms, previousTerms);
      assert.equal(snapshot.lastRefinementAddedTerms, snapshot.completedTerms - previousTerms);
      assert.equal(snapshot.completedTerms > previousTerms, true);
      assert.equal(snapshot.peakBigIntDigits > 0, true);
      assert.equal(snapshot.cachedBigIntDigits >= snapshot.peakBigIntDigits, true);
      previousTerms = snapshot.completedTerms;
    }

    await value.refine({ significantDigits: 500 }, context);
    const repeated = eStateSnapshot(value);
    assert.equal(repeated.completedTerms, previousTerms);
    assert.equal(repeated.lastRefinementReusedTerms, previousTerms);
    assert.equal(repeated.lastRefinementAddedTerms, 0);
  });
});

function independentChudnovskyTailBound(completedTerms: number): Rational {
  let coefficient = integerRational(1n);
  for (let term = 1n; term <= BigInt(completedTerms); term += 1n) {
    const numerator = (6n * term - 5n) * (2n * term - 1n) * (6n * term - 1n);
    const denominator = term * term * term * CHUDNOVSKY_C3_OVER_24;
    coefficient = multiplyRational(coefficient, createRational(numerator, denominator));
  }

  const index = BigInt(completedTerms);
  const nextTerm = multiplyRational(
    coefficient,
    integerRational(CHUDNOVSKY_A + CHUDNOVSKY_B * index)
  );
  return multiplyRational(
    nextTerm,
    createRational(CHUDNOVSKY_RATIO_DENOMINATOR, CHUDNOVSKY_RATIO_DENOMINATOR - 1n)
  );
}

function eStateSnapshot(value: LazyReal): {
  readonly completedTerms: number;
  readonly lastRefinementAddedTerms: number;
  readonly lastRefinementReusedTerms: number;
  readonly peakBigIntDigits: number;
  readonly cachedBigIntDigits: number;
} {
  const snapshot = (
    value as LazyReal & {
      getStateSnapshot(): {
        readonly completedTerms: number;
        readonly lastRefinementAddedTerms?: number;
        readonly lastRefinementReusedTerms?: number;
        readonly peakBigIntDigits?: number;
        readonly cachedBigIntDigits?: number;
      };
    }
  ).getStateSnapshot();
  assert.ok(snapshot.lastRefinementAddedTerms !== undefined);
  assert.ok(snapshot.lastRefinementReusedTerms !== undefined);
  assert.ok(snapshot.peakBigIntDigits !== undefined);
  assert.ok(snapshot.cachedBigIntDigits !== undefined);
  return {
    completedTerms: snapshot.completedTerms,
    lastRefinementAddedTerms: snapshot.lastRefinementAddedTerms,
    lastRefinementReusedTerms: snapshot.lastRefinementReusedTerms,
    peakBigIntDigits: snapshot.peakBigIntDigits,
    cachedBigIntDigits: snapshot.cachedBigIntDigits
  };
}
