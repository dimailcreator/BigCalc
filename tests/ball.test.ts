import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createReferenceBigFloatBackend,
  internalFloatToRational
} from "../src/core/backend/index.js";
import {
  addBall,
  ballToOutwardInterval,
  containsZeroBall,
  createInternalInterval,
  definitelyNegativeBall,
  definitelyPositiveBall,
  definitelyZeroBall,
  divideBall,
  intervalToBall,
  multiplyBall,
  rationalToBall,
  subtractBall,
  widenOutwardBall,
  widenOutwardInterval
} from "../src/core/values/index.js";
import {
  addRational,
  compareRational,
  createRational,
  divideRational,
  integerRational,
  multiplyRational,
  subtractRational
} from "../src/core/values/index.js";
import type { Ball, Rational } from "../src/core/values/index.js";

const backend = createReferenceBigFloatBackend();
const PRECISION_BITS = 18;

void describe("Ball arithmetic", () => {
  void it("converts rationals to balls that contain the exact value", () => {
    const exact = createRational(1n, 3n);
    const ball = rationalToBall(exact, 5, backend);

    assert.equal(ball.kind, "ball");
    assert.ok(ball.radius.sign >= 0);
    assertBallContainsRational(ball, exact);
  });

  void it("round-trips through outward intervals conservatively", () => {
    const lower = createRational(-2n, 3n);
    const upper = createRational(5n, 7n);
    const interval = intervalFromRationals(lower, upper);
    const ball = intervalToBall(interval, PRECISION_BITS, backend);
    const outward = ballToOutwardInterval(ball, PRECISION_BITS, backend);

    assertIntervalContainsRational(outward, lower);
    assertIntervalContainsRational(outward, upper);
  });

  void it("computes sign and zero predicates from outward intervals", () => {
    assert.equal(
      definitelyPositiveBall(
        ballFromRationals(createRational(2n, 3n), integerRational(1n)),
        PRECISION_BITS,
        backend
      ),
      true
    );
    assert.equal(
      definitelyNegativeBall(
        ballFromRationals(integerRational(-3n), integerRational(-1n)),
        PRECISION_BITS,
        backend
      ),
      true
    );
    assert.equal(
      definitelyZeroBall(
        rationalToBall(integerRational(0n), PRECISION_BITS, backend),
        PRECISION_BITS,
        backend
      ),
      true
    );

    const crossingZero = ballFromRationals(createRational(-1n, 5n), createRational(1n, 7n));
    assert.equal(containsZeroBall(crossingZero, PRECISION_BITS, backend), true);
    assert.equal(definitelyPositiveBall(crossingZero, PRECISION_BITS, backend), false);
    assert.equal(definitelyNegativeBall(crossingZero, PRECISION_BITS, backend), false);
    assert.equal(definitelyZeroBall(crossingZero, PRECISION_BITS, backend), false);
  });

  void it("contains exact addition and subtraction results for points inside input balls", () => {
    const left = ballFromRationals(createRational(-1n, 3n), createRational(5n, 6n));
    const right = ballFromRationals(createRational(1n, 7n), createRational(9n, 8n));
    const leftPoint = createRational(1n, 2n);
    const rightPoint = createRational(3n, 4n);

    assertBallContainsRational(left, leftPoint);
    assertBallContainsRational(right, rightPoint);
    assertBallContainsRational(
      addBall(left, right, PRECISION_BITS, backend),
      addRational(leftPoint, rightPoint)
    );
    assertBallContainsRational(
      subtractBall(left, right, PRECISION_BITS, backend),
      subtractRational(leftPoint, rightPoint)
    );
  });

  void it("contains exact multiplication results across negative and zero-crossing ranges", () => {
    const left = ballFromRationals(createRational(-5n, 4n), createRational(3n, 2n));
    const right = ballFromRationals(createRational(-2n, 3n), createRational(7n, 5n));
    const samples = [
      [createRational(-1n, 1n), createRational(-1n, 2n)],
      [createRational(0n, 1n), createRational(4n, 5n)],
      [createRational(3n, 4n), createRational(6n, 5n)]
    ] as const;
    const product = multiplyBall(left, right, PRECISION_BITS, backend);

    for (const [leftPoint, rightPoint] of samples) {
      assertBallContainsRational(product, multiplyRational(leftPoint, rightPoint));
    }
  });

  void it("contains exact division results when denominator is proven non-zero", () => {
    const numerator = ballFromRationals(createRational(-7n, 5n), createRational(4n, 3n));
    const denominator = ballFromRationals(createRational(2n, 3n), createRational(5n, 4n));
    const quotient = divideBall(numerator, denominator, PRECISION_BITS, backend);

    assert.equal(containsZeroBall(denominator, PRECISION_BITS, backend), false);
    assertBallContainsRational(
      quotient,
      divideRational(createRational(1n, 2n), integerRational(1n))
    );
    assertBallContainsRational(
      quotient,
      divideRational(createRational(-1n, 1n), createRational(3n, 4n))
    );
  });

  void it("rejects division when denominator interval contains zero", () => {
    const numerator = ballFromRationals(integerRational(1n), integerRational(2n));
    const denominator = ballFromRationals(createRational(-1n, 10n), createRational(1n, 10n));

    assert.throws(
      () => divideBall(numerator, denominator, PRECISION_BITS, backend),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "DivisionByZeroError"
    );
  });

  void it("widens intervals and balls outward", () => {
    const interval = intervalFromRationals(integerRational(1n), integerRational(2n));
    const amount = backend.fromRational(createRational(1n, 4n), PRECISION_BITS, "nearest");
    const widenedInterval = widenOutwardInterval(interval, amount, PRECISION_BITS, backend);

    assertIntervalContainsRational(widenedInterval, createRational(3n, 4n));
    assertIntervalContainsRational(widenedInterval, createRational(9n, 4n));

    const ball = intervalToBall(interval, PRECISION_BITS, backend);
    const widenedBall = widenOutwardBall(ball, amount, PRECISION_BITS, backend);
    assertBallContainsRational(widenedBall, createRational(3n, 4n));
    assertBallContainsRational(widenedBall, createRational(9n, 4n));
  });

  void it("passes deterministic containment samples for basic arithmetic", () => {
    const ranges = [
      [createRational(-3n, 2n), createRational(-1n, 4n)],
      [createRational(-2n, 5n), createRational(3n, 7n)],
      [createRational(1n, 6n), createRational(5n, 3n)]
    ] as const;

    for (const [leftLower, leftUpper] of ranges) {
      for (const [rightLower, rightUpper] of ranges) {
        const left = ballFromRationals(leftLower, leftUpper);
        const right = ballFromRationals(rightLower, rightUpper);
        const leftPoint = midpoint(leftLower, leftUpper);
        const rightPoint = midpoint(rightLower, rightUpper);

        assertBallContainsRational(
          addBall(left, right, PRECISION_BITS, backend),
          addRational(leftPoint, rightPoint)
        );
        assertBallContainsRational(
          subtractBall(left, right, PRECISION_BITS, backend),
          subtractRational(leftPoint, rightPoint)
        );
        assertBallContainsRational(
          multiplyBall(left, right, PRECISION_BITS, backend),
          multiplyRational(leftPoint, rightPoint)
        );

        if (!containsZeroBall(right, PRECISION_BITS, backend)) {
          assertBallContainsRational(
            divideBall(left, right, PRECISION_BITS, backend),
            divideRational(leftPoint, rightPoint)
          );
        }
      }
    }
  });
});

function ballFromRationals(lower: Rational, upper: Rational): Ball {
  return intervalToBall(intervalFromRationals(lower, upper), PRECISION_BITS, backend);
}

function intervalFromRationals(lower: Rational, upper: Rational) {
  return createInternalInterval(
    backend.fromRational(lower, PRECISION_BITS, "towardNegativeInfinity"),
    backend.fromRational(upper, PRECISION_BITS, "towardPositiveInfinity"),
    backend
  );
}

function midpoint(left: Rational, right: Rational): Rational {
  return divideRational(addRational(left, right), integerRational(2n));
}

function assertBallContainsRational(ball: Ball, value: Rational): void {
  assertIntervalContainsRational(ballToOutwardInterval(ball, PRECISION_BITS, backend), value);
}

function assertIntervalContainsRational(
  interval: ReturnType<typeof createInternalInterval>,
  value: Rational
): void {
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);

  assert.ok(
    compareRational(lower, value) <= 0,
    `${formatRational(value)} below interval lower bound ${formatRational(lower)}`
  );
  assert.ok(
    compareRational(value, upper) <= 0,
    `${formatRational(value)} above interval upper bound ${formatRational(upper)}`
  );
}

function formatRational(value: Rational): string {
  return `${value.numerator.toString()}/${value.denominator.toString()}`;
}
