import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createLazyRealNode,
  createLogNode,
  createRational,
  integerRational,
  intervalToBall,
  createInternalInterval,
  negateRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational } from "../src/core/index.js";
import {
  exactLogRational,
  expRationalIntervalWithProfile,
  lnPositiveRationalIntervalWithProfile
} from "../src/core/math/elementary.js";

void describe("scalable exp, ln, and log", () => {
  void it("reconstructs exp with fixed-scale outward squaring", () => {
    const requestedDigits = 40;
    const result = expRationalIntervalWithProfile(integerRational(1024n), requestedDigits);

    assert.equal(result.profile.reductionPower, 12);
    assert.equal(result.profile.squaringSteps, result.profile.reductionPower);
    assert.equal(result.profile.workingScaleDigits, 54);
    assert.equal(
      result.profile.workingScaleDigits - requestedDigits < result.profile.reductionPower + 8,
      true
    );
    assert.equal(
      result.profile.resultDenominatorDecimalDigits <= result.profile.workingScaleDigits + 1,
      true
    );
    assert.equal(result.profile.peakEndpointDecimalDigits < 600, true);
    assert.equal(compareRationals(result.interval.lower, result.interval.upper) <= 0, true);
  });

  void it("verifies exp after many squarings for both signs", async () => {
    await assertVerifiedExpression("exp(1024)", 20, 1);
    await assertVerifiedExpression("exp(-1024)", 20, 1);
  });

  void it("selects the ln binary scale directly for huge positive and negative powers", () => {
    const power = 10_000;
    const huge = integerRational(1n << BigInt(power));
    const tiny = createRational(1n, 1n << BigInt(power));
    const positive = lnPositiveRationalIntervalWithProfile(huge, 30);
    const negative = lnPositiveRationalIntervalWithProfile(tiny, 30);

    assert.equal(positive.profile.binaryScale, power);
    assert.equal(negative.profile.binaryScale, -power);
    assert.equal(positive.profile.scaleSelectionComparisons <= 3, true);
    assert.equal(negative.profile.scaleSelectionComparisons <= 3, true);
    assert.equal(positive.profile.workingDigits, 43);
    assert.equal(negative.profile.workingDigits, 43);
    assertRationalEqual(positive.interval.lower, negateRational(negative.interval.upper));
    assertRationalEqual(positive.interval.upper, negateRational(negative.interval.lower));
  });

  void it("verifies ln(2^k) for huge positive and negative k", async () => {
    await assertVerifiedExpression("ln(2^10000)", 25, 1, 3n);
    await assertVerifiedExpression("ln(1/2^10000)", 25, -1, 3n);
  });

  void it("returns cheap exact rational logarithms", () => {
    assertRationalEqual(
      requireExactLog(integerRational(4n), integerRational(2n)),
      createRational(1n, 2n)
    );
    assertRationalEqual(
      requireExactLog(integerRational(8n), integerRational(4n)),
      createRational(2n, 3n)
    );
    assertRationalEqual(
      requireExactLog(createRational(1n, 4n), integerRational(2n)),
      createRational(-1n, 2n)
    );
  });

  void it("adaptively verifies logarithms with a base very close to one", async () => {
    const result = createEvaluationGraphFromSource("log{1+1/100000000000000000000}(2)");
    assert.equal(result.ok, true);

    const ball = await result.graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 20 },
      result.context.backend
    );
    assert.equal(verified.verifiedDigits >= 20, true);
  });

  void it("reuses one refined operand for log_x(x)", async () => {
    let refineCalls = 0;
    const sharedValue: LazyReal = Object.freeze({
      kind: "lazy-real",
      refine(
        request: Parameters<LazyReal["refine"]>[0],
        context: Parameters<LazyReal["refine"]>[1]
      ) {
        refineCalls += 1;
        const graphContext = context as EvaluationGraphContext;
        const precisionBits = Math.max(128, request.significantDigits * 4);
        const two = integerRational(2n);
        return Promise.resolve(
          intervalToBall(
            createInternalInterval(
              graphContext.backend.fromRational(two, precisionBits, "towardNegativeInfinity"),
              graphContext.backend.fromRational(two, precisionBits, "towardPositiveInfinity"),
              graphContext.backend
            ),
            precisionBits,
            graphContext.backend
          )
        );
      }
    });
    const sharedNode = createLazyRealNode(sharedValue);
    const graph = createEvaluationGraph(
      createLogNode({ base: sharedNode, argument: sharedNode, iteration: null }),
      createEvaluationContext()
    );

    const ball = await graph.refine({ significantDigits: 30 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 30 }, graph.context.backend);
    assert.equal(verified.digits.startsWith("1"), true);
    assert.equal(verified.exponent10, 0n);
    assert.equal(refineCalls, 1);
    assert.equal(sharedNode.getStateSnapshot().cacheHits, 1);
  });
});

function requireExactLog(base: Rational, argument: Rational): Rational {
  const result = exactLogRational(base, argument);
  assert.ok(result !== null);
  return result;
}

async function assertVerifiedExpression(
  source: string,
  significantDigits: number,
  sign: -1 | 1,
  exponent10?: bigint
): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);
  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  if (exponent10 !== undefined) {
    assert.equal(verified.exponent10, exponent10);
  }
}

function compareRationals(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function assertRationalEqual(actual: Rational, expected: Rational): void {
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}
