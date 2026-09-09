import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createCalculationHandleFromSource,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  evaluateExpressionToRealValue,
  integerRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { Rational, RealValue } from "../src/core/index.js";
import { getPiProviderStateSnapshot } from "../src/core/math/constants.js";
import {
  cosAngleIntervalWithProfile,
  createRationalInterval,
  reduceDegreeInterval,
  sinAngleIntervalWithProfile,
  tanAngleIntervalWithProfile
} from "../src/core/math/elementary.js";

void describe("stage 29 trigonometry post-stabilization", () => {
  void it("skips pi construction for a provably small radian interval", () => {
    const context = createEvaluationContext();
    const before = getPiProviderStateSnapshot(context);
    const result = sinAngleIntervalWithProfile(
      createRationalInterval(createRational(-1n, 10n), createRational(1n, 10n)),
      300,
      "radians",
      context
    );
    const after = getPiProviderStateSnapshot(context);

    assert.ok(result.interval !== null);
    assert.equal(result.profile.smallRadianFastPaths, 1);
    assert.equal(result.profile.piRequestedDigits, 0);
    assert.equal(after.intervalRequests, before.intervalRequests);
  });

  void it("reduces huge exact degree arguments before requesting pi", async () => {
    const powerOfTen = 10n ** 100_000n;
    const hugeDegrees = integerRational(360n * powerOfTen + 1n);
    const exactReduced = reduceDegreeInterval(
      createRationalInterval(hugeDegrees, hugeDegrees),
      360n
    );
    assertRationalEqual(exactReduced.lower, integerRational(1n));
    assertRationalEqual(exactReduced.upper, integerRational(1n));

    const profileContext = createEvaluationContext({ settings: { angleMode: "degrees" } });
    const profiled = sinAngleIntervalWithProfile(
      createRationalInterval(hugeDegrees, hugeDegrees),
      50,
      "degrees",
      profileContext
    );
    assert.ok(profiled.interval !== null);
    assert.equal(profiled.profile.degreeReductionCalls, 1);
    assert.equal(profiled.profile.degreeOriginalMagnitudeDigits >= 100_000, true);
    assert.equal(profiled.profile.degreeReducedMagnitudeDigits <= 2, true);
    assert.equal(profiled.profile.piRequestedDigits < 100, true);
    assert.equal(profiled.profile.peakBigIntDecimalDigits >= 100_000, true);

    const literal = `1${"0".repeat(100_000)}`;
    const exactFastPath = evaluateExpressionToRealValue(`sin(360*${literal}+30)`, {
      settings: { angleMode: "degrees" }
    });
    assert.equal(exactFastPath.ok, true);
    assertRationalValue(exactFastPath.value, createRational(1n, 2n));

    const graph = createEvaluationGraphFromSource(`sin(360*${literal}+1)`, {
      settings: { angleMode: "degrees" }
    });
    assert.equal(graph.ok, true);
    const ball = await graph.graph.refine({ significantDigits: 10 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 10 }, graph.context.backend);
    const piState = getPiProviderStateSnapshot(graph.context);

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, -2n);
    assert.equal(verified.digits.startsWith("1745240643"), true);
    assert.equal(piState.highestProviderWorkingDigits < 100, true);
    assert.equal(graph.graph.root.getStateSnapshot().childRequests.length, 0);
  });

  void it("runs only the standalone series selected after quadrant swapping", () => {
    const context = createEvaluationContext();
    const one = createRationalInterval(integerRational(1n), integerRational(1n));
    const sine = sinAngleIntervalWithProfile(one, 80, "radians", context);
    const cosine = cosAngleIntervalWithProfile(one, 80, "radians", context);

    assert.ok(sine.interval !== null);
    assert.equal(sine.profile.selectiveIntervalEvaluations, 1);
    assert.equal(sine.profile.sinSeriesEvaluations, 0);
    assert.equal(sine.profile.cosSeriesEvaluations > 0, true);
    assert.equal(sine.profile.independentSeriesEvaluations, sine.profile.pointEvaluations);

    assert.ok(cosine.interval !== null);
    assert.equal(cosine.profile.selectiveIntervalEvaluations, 1);
    assert.equal(cosine.profile.sinSeriesEvaluations > 0, true);
    assert.equal(cosine.profile.cosSeriesEvaluations, 0);
    assert.equal(cosine.profile.independentSeriesEvaluations, cosine.profile.pointEvaluations);
  });

  void it("uses a monotone endpoint hull for tan intervals", () => {
    const context = createEvaluationContext();
    const argument = createRationalInterval(createRational(1n, 10n), createRational(1n, 5n));
    const result = tanAngleIntervalWithProfile(argument, 70, "radians", context);
    assert.ok(result.interval !== null);

    assert.equal(result.profile.tanEndpointHullEvaluations, 1);
    assert.equal(result.profile.tanIntervalDivisionEvaluations, 0);
    assert.equal(result.profile.pointEvaluations, 2);
    assert.equal(result.profile.sinSeriesEvaluations, 2);
    assert.equal(result.profile.cosSeriesEvaluations, 2);
    assertEndpointMatchesPrefix(result.interval.lower, "100334672085450545058080045781111536819");
    assertEndpointMatchesPrefix(result.interval.upper, "202710035508672483321358271647534482626");

    const point = tanAngleIntervalWithProfile(
      createRationalInterval(createRational(1n, 10n), createRational(1n, 10n)),
      70,
      "radians",
      context
    );
    assert.ok(point.interval !== null);
    assert.equal(point.profile.tanEndpointHullEvaluations, 0);
    assert.equal(point.profile.tanIntervalDivisionEvaluations, 1);
  });

  void it("finishes cheap rational multiples of pi exactly or with a typed pole error", async () => {
    assertExpressionRational("sin(π)", integerRational(0n));
    assertExpressionRational("sin(2π)", integerRational(0n));
    assertExpressionRational("cos(π)", integerRational(-1n));
    assertExpressionRational("tan(π)", integerRational(0n));
    assertExpressionError("tan(π/2)", "DomainError");
    assertExpressionError("tan(3π/2)", "DomainError");

    const degreePi = evaluateExpressionToRealValue("sin(π)", {
      settings: { angleMode: "degrees" }
    });
    assert.equal(degreePi.ok, true);
    assert.equal(degreePi.value.kind, "lazy-real");

    const calculation = createCalculationHandleFromSource("tan(π/2)");
    assert.equal(calculation.ok, true);
    const result = await calculation.handle.refine({ significantDigits: 50 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "DomainError");
  });
});

function assertEndpointMatchesPrefix(value: Rational, digits: string): void {
  const denominator = 10n ** BigInt(digits.length);
  const lower = createRational(BigInt(digits), denominator);
  const upper = createRational(BigInt(digits) + 1n, denominator);
  assert.equal(compareRational(value, lower) >= 0, true);
  assert.equal(compareRational(value, upper) <= 0, true);
}

function assertExpressionRational(source: string, expected: Rational): void {
  const result = evaluateExpressionToRealValue(source);
  assert.equal(result.ok, true);
  assertRationalValue(result.value, expected);
}

function assertExpressionError(source: string, expectedCode: "DomainError"): void {
  const result = evaluateExpressionToRealValue(source);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expectedCode);
}

function assertRationalValue(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assertRationalEqual(actual, expected);
}

function assertRationalEqual(actual: Rational, expected: Rational): void {
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}
