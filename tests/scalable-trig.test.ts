import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  absRational,
  addRational,
  compareRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  divideRational,
  integerRational,
  multiplyRational,
  negateRational,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { Rational } from "../src/core/index.js";
import { getPiProviderStateSnapshot, getPiRationalInterval } from "../src/core/math/constants.js";
import {
  createRationalInterval,
  reduceRadianInterval,
  sincosSmallInterval,
  tanAngleIntervalWithProfile,
  type RationalInterval
} from "../src/core/math/elementary.js";

void describe("stage 26 scalable trigonometry", () => {
  void it("reduces into the canonical [-pi/4, pi/4] strip with quadrant metadata", () => {
    const context = createEvaluationContext();
    const argument = createRationalInterval(integerRational(1n), integerRational(1n));
    const reduction = reduceRadianInterval(argument, 50, context);
    assert.ok(reduction !== null);
    assert.equal(reduction.branches.length, 1);

    const branch = reduction.branches[0];
    assert.ok(branch !== undefined);
    assert.equal(branch.quadrant, 1);
    assert.equal(branch.sinSign, 1);
    assert.equal(branch.cosSign, -1);
    assert.equal(branch.swapSinCos, true);

    const pi = getPiRationalInterval(context, 70);
    const quarterPiUpper = divideRational(pi.upper, integerRational(4n));
    assert.equal(
      compareRational(branch.reducedInterval.lower, negateRational(quarterPiUpper)) >= 0,
      true
    );
    assert.equal(compareRational(branch.reducedInterval.upper, quarterPiUpper) <= 0, true);
  });

  void it("matches an independent exact-Rational Taylor reference on the small strip", () => {
    const context = createEvaluationContext();
    const point = createRational(3n, 4n);
    const reduced = createRationalInterval(point, point);
    const actual = sincosSmallInterval(reduced, 80, context);
    const referenceSin = referenceTaylorInterval(point, "sin", 40);
    const referenceCos = referenceTaylorInterval(point, "cos", 40);

    assert.equal(intervalsOverlap(actual.sinInterval, referenceSin), true);
    assert.equal(intervalsOverlap(actual.cosInterval, referenceCos), true);
  });

  void it("uses one joint sincos evaluation for tan", () => {
    const context = createEvaluationContext();
    const argument = createRationalInterval(integerRational(1n), integerRational(1n));
    const result = tanAngleIntervalWithProfile(argument, 100, "radians", context);

    assert.ok(result.interval !== null);
    assert.equal(result.profile.rangeReductionCalls, 1);
    assert.equal(result.profile.sincosIntervalEvaluations, 1);
    assert.equal(result.profile.pointEvaluations, 2);
    assert.equal(result.profile.sharedSquareEvaluations, 2);
    assert.equal(result.profile.independentSeriesEvaluations, 0);
    assert.equal(result.profile.resultDenominatorDecimalDigits <= 102, true);
  });

  void it("uses pole metadata before starting tan series", () => {
    const context = createEvaluationContext();
    const pi = getPiRationalInterval(context, 80);
    const halfPi = createRationalInterval(
      divideRational(pi.lower, integerRational(2n)),
      divideRational(pi.upper, integerRational(2n))
    );
    const reduction = reduceRadianInterval(halfPi, 60, context, pi);
    assert.ok(reduction !== null);
    assert.equal(
      reduction.branches.some((branch) => branch.polePossible),
      true
    );

    const result = tanAngleIntervalWithProfile(halfPi, 60, "radians", context);
    assert.equal(result.interval, null);
    assert.equal(result.profile.sincosIntervalEvaluations, 0);
    assert.equal(result.profile.pointEvaluations, 0);
  });

  void it("reuses the same cached pi interval for degree conversion and reduction", () => {
    const context = createEvaluationContext({ settings: { angleMode: "degrees" } });
    const before = getPiProviderStateSnapshot(context);
    const degrees = createRationalInterval(integerRational(100n), integerRational(100n));
    const result = tanAngleIntervalWithProfile(degrees, 80, "degrees", context);
    const after = getPiProviderStateSnapshot(context);

    assert.ok(result.interval !== null);
    assert.equal(after.intervalRequests - before.intervalRequests, 1);
    assert.equal(result.profile.rangeReductionCalls, 1);
  });

  void it("keeps fixed-point bigint sizes bounded at high precision", () => {
    const radiansContext = createEvaluationContext();
    const radians = tanAngleIntervalWithProfile(
      createRationalInterval(integerRational(1_000_000n), integerRational(1_000_000n)),
      300,
      "radians",
      radiansContext
    );
    const degreesContext = createEvaluationContext({ settings: { angleMode: "degrees" } });
    const degrees = tanAngleIntervalWithProfile(
      createRationalInterval(integerRational(100n), integerRational(100n)),
      300,
      "degrees",
      degreesContext
    );

    for (const result of [radians, degrees]) {
      assert.ok(result.interval !== null);
      assert.equal(result.profile.scaleDigits, 300);
      assert.equal(result.profile.peakBigIntDecimalDigits <= 302, true);
      assert.equal(result.profile.resultDenominatorDecimalDigits <= 302, true);
    }
  });

  void it("verifies both sides of a radian tan pole and a large argument", async () => {
    await assertVerifiedSign("tan(π/2-1/100000000000000000000)", 10, 1);
    await assertVerifiedSign("tan(π/2+1/100000000000000000000)", 10, -1);
    await assertVerifiedSign("sin(1000000000000000000000000000000)", 10, -1);
  });
});

function referenceTaylorInterval(
  value: Rational,
  operation: "sin" | "cos",
  termCount: number
): RationalInterval {
  const squared = multiplyRational(value, value);
  let term = operation === "sin" ? value : integerRational(1n);
  let sum = term;

  for (let index = 0; index < termCount; index += 1) {
    const first = operation === "sin" ? 2n * BigInt(index + 1) : 2n * BigInt(index) + 1n;
    term = divideRational(
      negateRational(multiplyRational(term, squared)),
      integerRational(first * (first + 1n))
    );
    sum = addRational(sum, term);
  }

  const nextIndex = termCount;
  const first = operation === "sin" ? 2n * BigInt(nextIndex + 1) : 2n * BigInt(nextIndex) + 1n;
  const nextTerm = divideRational(
    negateRational(multiplyRational(term, squared)),
    integerRational(first * (first + 1n))
  );
  const tail = absRational(nextTerm);
  return createRationalInterval(subtractRational(sum, tail), addRational(sum, tail));
}

function intervalsOverlap(left: RationalInterval, right: RationalInterval): boolean {
  return (
    compareRational(left.lower, right.upper) <= 0 && compareRational(left.upper, right.lower) >= 0
  );
}

async function assertVerifiedSign(
  source: string,
  significantDigits: number,
  sign: -1 | 1
): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);
  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
}
