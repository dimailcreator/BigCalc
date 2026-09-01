import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createInternalInterval,
  createRational,
  intervalToBall,
  subtractRational,
  verifiedNumberFromBall,
  verifiedNumberFromRational
} from "../src/core/index.js";
import { createReferenceBigFloatBackend } from "../src/core/backend/index.js";
import type { Ball, Rational, VerifiedNumber } from "../src/core/index.js";

const backend = createReferenceBigFloatBackend();
const PRECISION_BITS = 96;

void describe("verified decimal digits", () => {
  void it("formats terminating rationals exactly without padding past the finite decimal", () => {
    assert.deepEqual(verifiedNumberFromRational(createRational(1n, 8n), digits(20)), {
      sign: 1,
      digits: "125",
      exponent10: -1n,
      verifiedDigits: 3,
      valueExact: true,
      decimalTerminating: true,
      rounded: false
    });

    assert.deepEqual(verifiedNumberFromRational(createRational(1200n), digits(20)), {
      sign: 1,
      digits: "12",
      exponent10: 3n,
      verifiedDigits: 2,
      valueExact: true,
      decimalTerminating: true,
      rounded: false
    });
  });

  void it("returns exact periodic rational prefixes for the requested significant digits", () => {
    assert.deepEqual(verifiedNumberFromRational(createRational(1n, 3n), digits(12)), {
      sign: 1,
      digits: "333333333333",
      exponent10: -1n,
      verifiedDigits: 12,
      valueExact: true,
      decimalTerminating: false,
      rounded: false
    });
  });

  void it("handles values below one and negative values", () => {
    assert.deepEqual(verifiedNumberFromRational(createRational(1n, 2500n), digits(20)), {
      sign: 1,
      digits: "4",
      exponent10: -4n,
      verifiedDigits: 1,
      valueExact: true,
      decimalTerminating: true,
      rounded: false
    });

    assert.deepEqual(verifiedNumberFromRational(createRational(-22n, 7n), digits(8)), {
      sign: -1,
      digits: "31428571",
      exponent10: 0n,
      verifiedDigits: 8,
      valueExact: true,
      decimalTerminating: false,
      rounded: false
    });
  });

  void it("handles large decimal exponents without converting user values to number", () => {
    assert.deepEqual(
      verifiedNumberFromRational(createRational(123456789n * 10n ** 80n), digits(9)),
      {
        sign: 1,
        digits: "123456789",
        exponent10: 88n,
        verifiedDigits: 9,
        valueExact: true,
        decimalTerminating: true,
        rounded: false
      }
    );
  });

  void it("computes only the common decimal prefix for a ball crossing a later digit boundary", () => {
    const ball = ballFromRationals(
      createRational(123449n, 100000n),
      createRational(123451n, 100000n)
    );
    const verified = verifiedNumberFromBall(ball, digits(6), backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 0n);
    assert.equal(verified.digits, "1234");
    assert.equal(verified.verifiedDigits, 4);
    assert.equal(verified.valueExact, false);
    assert.equal(verified.decimalTerminating, false);
  });

  void it("uses the ball internal precision when extracting verified digits", () => {
    const precisionBits = 220;
    const center = addRational(createRational(10n ** 50n), createRational(1n, 3n));
    const uncertainty = createRational(1n, 10n ** 40n);
    const ball = intervalToBall(
      createInternalInterval(
        backend.fromRational(
          subtractRational(center, uncertainty),
          precisionBits,
          "towardNegativeInfinity"
        ),
        backend.fromRational(
          addRational(center, uncertainty),
          precisionBits,
          "towardPositiveInfinity"
        ),
        backend
      ),
      precisionBits,
      backend
    );
    const verified = verifiedNumberFromBall(ball, digits(20), backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 50n);
    assert.equal(verified.digits, "10000000000000000000");
    assert.equal(verified.verifiedDigits, 20);
  });

  void it("does not invent a digit when a ball crosses a sign or power-of-ten boundary", () => {
    assert.deepEqual(
      pickPublicFields(
        verifiedNumberFromBall(
          ballFromRationals(createRational(-1n, 100n), createRational(1n, 100n)),
          digits(5),
          backend
        )
      ),
      {
        sign: 0,
        digits: "",
        exponent10: 0n,
        verifiedDigits: 0
      }
    );

    assert.deepEqual(
      pickPublicFields(
        verifiedNumberFromBall(
          ballFromRationals(createRational(9999n, 1000n), createRational(10001n, 1000n)),
          digits(5),
          backend
        )
      ),
      {
        sign: 1,
        digits: "",
        exponent10: 1n,
        verifiedDigits: 0
      }
    );
  });

  void it("keeps old verified prefixes stable under monotonic refinement", () => {
    const value = createRational(1n, 7n);
    const first = verifiedNumberFromRational(value, digits(10));
    const refined = verifiedNumberFromRational(value, digits(30));

    assert.equal(refined.digits.startsWith(first.digits), true);
    assert.equal(refined.exponent10, first.exponent10);
    assert.equal(refined.sign, first.sign);

    const ball = ballFromRationals(
      createRational(3141592n, 1000000n),
      createRational(3141593n, 1000000n)
    );
    const ballFirst = verifiedNumberFromBall(ball, digits(4), backend);
    const ballRefined = verifiedNumberFromBall(ball, digits(12), backend);

    assert.equal(ballRefined.digits.startsWith(ballFirst.digits), true);
    assert.equal(ballRefined.exponent10, ballFirst.exponent10);
  });
});

function digits(significantDigits: number) {
  return { significantDigits };
}

function ballFromRationals(lower: Rational, upper: Rational): Ball {
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

function pickPublicFields(value: VerifiedNumber) {
  return {
    sign: value.sign,
    digits: value.digits,
    exponent10: value.exponent10,
    verifiedDigits: value.verifiedDigits
  };
}
