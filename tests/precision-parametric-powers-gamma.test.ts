import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  integerRational,
  multiplyRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import {
  createGammaStirlingPlan,
  createNthRootRefinementState,
  createRationalInterval,
  gammaRealIntervalWithProfile,
  nthRootPositiveIntervalWithProfile,
  powRationalViaNthRootInterval,
  shouldUseDirectNthRoot
} from "../src/core/math/elementary.js";

const THIRD_FACTORIAL_PREFIX = "8929795115692492112185643136582258813762";
const NEGATIVE_THIRD_GAMMA_PREFIX = "4062353818279201250835864084463541356557";

void describe("stage 27 precision-parametric powers and Gamma", () => {
  void it("computes rigorous nth roots with Newton and outward containment", () => {
    const context = createEvaluationContext();
    const two = integerRational(2n);
    const result = nthRootPositiveIntervalWithProfile(
      createRationalInterval(two, two),
      2n,
      60,
      context
    );

    assert.equal(
      compareRational(multiplyRational(result.interval.lower, result.interval.lower), two) <= 0,
      true
    );
    assert.equal(
      compareRational(multiplyRational(result.interval.upper, result.interval.upper), two) >= 0,
      true
    );
    assert.equal(result.profile.newtonIterations > 0, true);
    assert.equal(result.profile.peakBigIntDecimalDigits <= 61, true);
  });

  void it("continues nth-root refinement from its previous interval", () => {
    const context = createEvaluationContext();
    const state = createNthRootRefinementState();
    const two = integerRational(2n);
    const argument = createRationalInterval(two, two);
    const first = nthRootPositiveIntervalWithProfile(argument, 2n, 20, context, state);
    const second = nthRootPositiveIntervalWithProfile(argument, 2n, 80, context, state);

    assert.equal(first.profile.reusedPreviousInterval, false);
    assert.equal(second.profile.reusedPreviousInterval, true);
    assert.equal(state.highestDigits, 80);
    assert.equal(compareRational(second.interval.lower, first.interval.lower) >= 0, true);
    assert.equal(compareRational(second.interval.upper, first.interval.upper) <= 0, true);
  });

  void it("routes practical rational powers through nthRoot without a mathematical q cap", async () => {
    const context = createEvaluationContext();
    const direct = powRationalViaNthRootInterval(
      integerRational(2n),
      createRational(5n, 3n),
      60,
      context
    );
    assert.ok(direct !== null);
    assert.equal(shouldUseDirectNthRoot(80n, 10), false);
    assert.equal(shouldUseDirectNthRoot(80n, 40), true);

    await assertVerified("2^(5/3)", 50, 1);
    await assertVerified("(-2)^(5/3)", 50, -1);
  });

  void it("matches independent high-precision Gamma references on both sides of zero", async () => {
    await assertVerifiedPrefix("(1/3)!", THIRD_FACTORIAL_PREFIX, 40, 1);
    await assertVerifiedPrefix("(-4/3)!", NEGATIVE_THIRD_GAMMA_PREFIX, 40, -1);
  });

  void it("keeps Gamma domain refinement valid extremely close to poles", async () => {
    await assertVerified("(-1+1/100000000000000000000)!", 15, 1);
    await assertVerified("(-1-1/100000000000000000000)!", 15, -1);
  });

  void it("preserves verified Gamma prefixes over sequential refinement", async () => {
    const result = createEvaluationGraphFromSource("(1/3)!", {
      settings: { factorialMode: "gamma" }
    });
    assert.equal(result.ok, true);
    let prefix = "";

    for (const significantDigits of [20, 50, 100, 300]) {
      const ball = await result.graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(prefix), true);
      prefix = verified.digits;
    }
  });

  void it("has no fixed Stirling correction ceiling and profiles balanced reduction", () => {
    const beyondLegacyLimit = createGammaStirlingPlan(300, {
      minimumCorrectionTerms: 257,
      minimumShiftTarget: 1000
    });
    assert.equal(beyondLegacyLimit.minimumCorrectionTerms, 257);
    assert.equal(beyondLegacyLimit.maximumCorrectionTerms, null);
    assert.equal(beyondLegacyLimit.shiftTarget, 1000);

    const context = createEvaluationContext();
    const fourThirds = createRational(4n, 3n);
    const result = gammaRealIntervalWithProfile(
      createRationalInterval(fourThirds, fourThirds),
      100,
      context
    );
    assert.ok(result.interval !== null);
    assert.equal(result.profile.shift >= 100, true);
    assert.equal(result.profile.recurrenceFactors, result.profile.shift);
    assert.equal(result.profile.recurrenceTreeDepth < result.profile.recurrenceFactors, true);
    assert.equal(result.profile.correctionTerms > 0, true);
    assert.equal(result.profile.highestBernoulliIndex > result.profile.correctionTerms, true);
  });

  void it("selects reflection by recurrence cost for large negative arguments", () => {
    const context = createEvaluationContext();
    const argument = createRational(-1000n, 3n);
    const result = gammaRealIntervalWithProfile(
      createRationalInterval(argument, argument),
      40,
      context
    );

    assert.ok(result.interval !== null);
    assert.equal(result.profile.usedReflection, true);
    assert.equal(result.profile.recurrenceFactors, 0);
  });
});

async function assertVerified(
  source: string,
  significantDigits: number,
  sign: -1 | 1
): Promise<void> {
  const result = createEvaluationGraphFromSource(source, { settings: { factorialMode: "gamma" } });
  assert.equal(result.ok, true);
  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
}

async function assertVerifiedPrefix(
  source: string,
  prefix: string,
  significantDigits: number,
  sign: -1 | 1
): Promise<void> {
  const result = createEvaluationGraphFromSource(source, { settings: { factorialMode: "gamma" } });
  assert.equal(result.ok, true);
  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  assert.equal(verified.digits.startsWith(prefix.slice(0, significantDigits)), true);
}
