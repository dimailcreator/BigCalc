import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalFloatToRational } from "../src/core/backend/index.js";
import {
  addBall,
  applyPrecisionCutoff,
  ballToOutwardInterval,
  createAddNode,
  createEvaluationContext,
  createEvaluationGraph,
  createInternalInterval,
  createLazyRealNode,
  createRational,
  createRationalNode,
  createSubNode,
  integerRational,
  intervalToBall,
  rationalToBall,
  verifiedNumberFromBall
} from "../src/core/index.js";
import { addRational, compareRational, isZeroRational } from "../src/core/values/index.js";
import type {
  Ball,
  EvaluationContext,
  EvaluationGraphContext,
  LazyReal,
  Rational,
  VerifiedNumber
} from "../src/core/index.js";

const PRECISION_BITS = 256;

void describe("precision cutoff", () => {
  void it("rounds leading digits before the decimal point with half-away-from-zero", () => {
    const roundedDown = verifiedCutoff(createRational(123454n, 100000n), 4);
    const roundedUp = verifiedCutoff(createRational(123456n, 100000n), 4);
    const carry = verifiedCutoff(createRational(199996n, 100000n), 4);

    assertCutoffNumber(roundedDown, 1, "12345", 0n);
    assertCutoffNumber(roundedUp, 1, "12346", 0n);
    assertCutoffNumber(carry, 1, "20000", 0n);
  });

  void it("uses a fixed decimal-place cutoff when the leading digit is after the decimal point", () => {
    const roundedDown = verifiedCutoff(createRational(1234n, 1000000n), 4);
    const roundedZero = verifiedCutoff(createRational(4n, 100000n), 4);
    const roundedAway = verifiedCutoff(createRational(7n, 100000n), 4);

    assertCutoffNumber(roundedDown, 1, "12", -3n);
    assert.deepEqual(roundedZero, {
      sign: 0,
      digits: "0",
      exponent10: 0n,
      verifiedDigits: 1,
      valueExact: false,
      decimalTerminating: false,
      rounded: true,
      zeroKind: "rounded"
    });
    assertCutoffNumber(roundedAway, 1, "1", -4n);
  });

  void it("rounds negative values away from zero at half boundaries", () => {
    const rounded = verifiedCutoff(createRational(-123456n, 100000n), 4);
    const roundedAway = verifiedCutoff(createRational(-7n, 100000n), 4);

    assertCutoffNumber(rounded, -1, "12346", 0n);
    assertCutoffNumber(roundedAway, -1, "1", -4n);
  });

  void it("does not choose a side when the input ball crosses a rounding boundary", () => {
    const backend = createEvaluationContext().backend;
    const ball = ballFromRationals(
      createRational(1234449n, 1000000n),
      createRational(1234451n, 1000000n)
    );
    const cutoff = applyPrecisionCutoff(ball, 4, PRECISION_BITS, backend);
    const verified = verifiedNumberFromBall(cutoff, { significantDigits: 5 }, backend);

    assert.equal(cutoff.precisionCutoff?.ambiguousBoundary, true);
    assertBallContainsRational(cutoff, createRational(12344n, 10000n));
    assertBallContainsRational(cutoff, createRational(12345n, 10000n));
    assert.equal(verified.rounded, false);
  });

  void it("keeps RoundedZero uncertainty available for later ball propagation", () => {
    const backend = createEvaluationContext().backend;
    const originalTiny = createRational(4n, 100000n);
    const roundedZero = applyPrecisionCutoff(
      ballFromRational(originalTiny),
      4,
      PRECISION_BITS,
      backend
    );
    const propagated = addBall(
      roundedZero,
      rationalToBall(integerRational(1n), PRECISION_BITS, backend),
      PRECISION_BITS,
      backend
    );

    assert.equal(roundedZero.precisionCutoff?.ambiguousBoundary, false);
    assert.equal(isZeroRational(roundedZero.precisionCutoff.roundedCenter), true);
    assertBallContainsRational(propagated, addRational(integerRational(1n), originalTiny));
  });

  void it("applies reduced cutoff through add/sub evaluation nodes", async () => {
    const context = createEvaluationContext({ settings: { precisionCutoffDigits: 4 } });
    const left = createLazyRealNode(new FixedRationalLazyReal(createRational(123456n, 100000n)));
    const graph = createEvaluationGraph(
      createAddNode(left, createRationalNode(integerRational(0n))),
      context
    );
    const ball = await graph.refine({ significantDigits: 5 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 5 }, context.backend);

    assert.equal(ball.precisionCutoff?.cutoffDigits, 4);
    assertCutoffNumber(verified, 1, "12346", 0n);
  });

  void it("does not apply precision cutoff to exact rational add/sub refinement", async () => {
    const context = createEvaluationContext({ settings: { precisionCutoffDigits: 4 } });
    const graph = createEvaluationGraph(
      createSubNode(
        createAddNode(
          createRationalNode(createRational(1n, 3n)),
          createRationalNode(createRational(1n, 6n))
        ),
        createRationalNode(createRational(1n, 2n))
      ),
      context
    );
    const ball = await graph.refine({ significantDigits: 8 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 8 }, context.backend);

    assert.equal(ball.precisionCutoff, undefined);
    assert.equal(verified.sign, 0);
    assert.notEqual(verified.zeroKind, "rounded");
  });

  void it("keeps production 3000/3001 cutoff parameters", () => {
    const backend = createEvaluationContext().backend;
    const roundedZero = applyPrecisionCutoff(
      ballFromRational(createRational(4n, 10n ** 3001n)),
      3000,
      128,
      backend
    );
    const roundedAway = applyPrecisionCutoff(
      ballFromRational(createRational(7n, 10n ** 3001n)),
      3000,
      128,
      backend
    );
    const leadingBeforeDecimal = applyPrecisionCutoff(
      ballFromRational(addRational(integerRational(10n ** 5n), createRational(4n, 10n ** 2996n))),
      3000,
      128,
      backend
    );
    const roundedZeroCutoff = requirePrecisionCutoff(roundedZero);
    const roundedAwayCutoff = requirePrecisionCutoff(roundedAway);
    const leadingBeforeDecimalCutoff = requirePrecisionCutoff(leadingBeforeDecimal);

    assert.equal(roundedZeroCutoff.stepExponent10, -3000n);
    assert.equal(isZeroRational(roundedZeroCutoff.roundedCenter), true);
    assert.equal(roundedAwayCutoff.stepExponent10, -3000n);
    assert.deepEqual(roundedAwayCutoff.roundedCenter, createRational(1n, 10n ** 3000n));
    assert.equal(leadingBeforeDecimalCutoff.stepExponent10, -2995n);
  });
});

class FixedRationalLazyReal implements LazyReal {
  readonly kind = "lazy-real";

  constructor(private readonly value: Rational) {}

  refine(
    request: { readonly significantDigits: number },
    context: EvaluationContext
  ): Promise<Ball> {
    const graphContext = context as EvaluationGraphContext;

    return Promise.resolve(
      rationalToBall(
        this.value,
        Math.max(PRECISION_BITS, request.significantDigits),
        graphContext.backend
      )
    );
  }
}

function verifiedCutoff(value: Rational, cutoffDigits: number): VerifiedNumber {
  const backend = createEvaluationContext().backend;
  const cutoff = applyPrecisionCutoff(
    ballFromRational(value),
    cutoffDigits,
    PRECISION_BITS,
    backend
  );

  return verifiedNumberFromBall(cutoff, { significantDigits: cutoffDigits + 1 }, backend);
}

function ballFromRational(value: Rational): Ball {
  return ballFromRationals(value, value);
}

function ballFromRationals(lower: Rational, upper: Rational): Ball {
  const backend = createEvaluationContext().backend;

  return intervalToBall(
    createInternalInterval(
      backend.fromRational(lower, PRECISION_BITS, "towardNegativeInfinity"),
      backend.fromRational(upper, PRECISION_BITS, "towardPositiveInfinity"),
      backend
    ),
    PRECISION_BITS,
    backend
  );
}

function assertCutoffNumber(
  verified: VerifiedNumber,
  sign: -1 | 1,
  digits: string,
  exponent10: bigint
): void {
  assert.equal(verified.sign, sign);
  assert.equal(verified.digits, digits);
  assert.equal(verified.exponent10, exponent10);
  assert.equal(verified.verifiedDigits, digits.length);
  assert.equal(verified.rounded, true);
  assert.equal(verified.valueExact, false);
}

function assertBallContainsRational(ball: Ball, value: Rational): void {
  const backend = createEvaluationContext().backend;
  const interval = ballToOutwardInterval(ball, PRECISION_BITS, backend);
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);

  assert.equal(compareRational(lower, value) <= 0, true);
  assert.equal(compareRational(value, upper) <= 0, true);
}

function requirePrecisionCutoff(ball: Ball): NonNullable<Ball["precisionCutoff"]> {
  if (ball.precisionCutoff === undefined) {
    assert.fail("Expected precision cutoff metadata");
  }

  return ball.precisionCutoff;
}
