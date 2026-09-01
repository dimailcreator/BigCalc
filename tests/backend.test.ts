import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createReferenceBigFloatBackend,
  internalFloatToRational
} from "../src/core/backend/index.js";
import type { InternalFloat } from "../src/core/backend/index.js";
import { compareRational, createRational, integerRational } from "../src/core/values/index.js";
import type { Rational, Sign } from "../src/core/values/index.js";

const backend = createReferenceBigFloatBackend();

void describe("reference BigFloatBackend", () => {
  void it("directed rounding brackets non-exact rationals", () => {
    const oneThird = createRational(1n, 3n);
    const lower = backend.fromRational(oneThird, 4, "towardNegativeInfinity");
    const upper = backend.fromRational(oneThird, 4, "towardPositiveInfinity");

    assert.equal(compareFloatToRational(lower, oneThird), -1);
    assert.equal(compareFloatToRational(upper, oneThird), 1);
    assert.equal(backend.compare(lower, upper), -1);
  });

  void it("directed rounding handles negative non-exact rationals", () => {
    const negativeOneThird = createRational(-1n, 3n);
    const lower = backend.fromRational(negativeOneThird, 4, "towardNegativeInfinity");
    const upper = backend.fromRational(negativeOneThird, 4, "towardPositiveInfinity");

    assert.equal(compareFloatToRational(lower, negativeOneThird), -1);
    assert.equal(compareFloatToRational(upper, negativeOneThird), 1);
    assert.equal(backend.compare(lower, upper), -1);
  });

  void it("rounds basic operations with independent rational containment checks", () => {
    const one = backend.fromRational(integerRational(1n), 16, "nearest");
    const three = backend.fromRational(integerRational(3n), 16, "nearest");
    const quotientLower = backend.div(one, three, 5, "towardNegativeInfinity");
    const quotientUpper = backend.div(one, three, 5, "towardPositiveInfinity");
    const oneThird = createRational(1n, 3n);

    assert.equal(compareFloatToRational(quotientLower, oneThird), -1);
    assert.equal(compareFloatToRational(quotientUpper, oneThird), 1);

    const oneHalf = backend.fromRational(createRational(1n, 2n), 8, "nearest");
    const oneQuarter = backend.fromRational(createRational(1n, 4n), 8, "nearest");
    const exactSum = backend.add(oneHalf, oneQuarter, 8, "nearest");
    const exactProduct = backend.mul(oneHalf, oneQuarter, 8, "nearest");
    const exactDifference = backend.sub(oneHalf, oneQuarter, 8, "nearest");

    assertRationalEqual(internalFloatToRational(exactSum), createRational(3n, 4n));
    assertRationalEqual(internalFloatToRational(exactProduct), createRational(1n, 8n));
    assertRationalEqual(internalFloatToRational(exactDifference), createRational(1n, 4n));
  });

  void it("supports huge positive and negative binary exponents", () => {
    const one = backend.fromRational(integerRational(1n), 8, "nearest");
    const hugePositive = backend.scaleByPowerOfTwo(one, 10_000n);
    const hugeNegative = backend.scaleByPowerOfTwo(one, -10_000n);

    assert.equal(hugePositive.exponent, one.exponent + 10_000n);
    assert.equal(hugeNegative.exponent, one.exponent - 10_000n);
    assert.equal(backend.compare(hugeNegative, one), -1);
    assert.equal(backend.compare(hugePositive, one), 1);

    const smallRational = createRational(1n, 1n << 512n);
    const smallFloat = backend.fromRational(smallRational, 12, "nearest");
    assertRationalEqual(internalFloatToRational(smallFloat), smallRational);
  });

  void it("keeps zero canonical across conversions and unary operations", () => {
    const zero = backend.fromRational(integerRational(0n), 128, "towardPositiveInfinity");

    assertCanonicalZero(zero);
    assertCanonicalZero(backend.negate(zero));
    assertCanonicalZero(backend.abs(zero));
    assertCanonicalZero(backend.scaleByPowerOfTwo(zero, 99_999n));
    assertCanonicalZero(backend.round(zero, 32, "towardNegativeInfinity"));
  });

  void it("does not leak NaN, Infinity, or negative zero states", () => {
    const values = [
      backend.fromRational(createRational(1n, 3n), 7, "towardNegativeInfinity"),
      backend.fromRational(createRational(1n, 3n), 7, "towardPositiveInfinity"),
      backend.fromRational(createRational(-7n, 5n), 4, "nearest"),
      backend.negate(backend.fromRational(integerRational(0n), 4, "nearest"))
    ];

    for (const value of values) {
      assert.equal(value.kind, "internal-float");
      assert.ok(value.significand >= 0n);
      assert.ok(Number.isSafeInteger(value.precisionBits));
      assert.ok(value.precisionBits >= 1);

      if (value.sign === 0) {
        assertCanonicalZero(value);
      } else {
        assert.notEqual(value.significand, 0n);
      }
    }
  });
});

function compareFloatToRational(value: InternalFloat, rational: Rational): Sign {
  return compareRational(internalFloatToRational(value), rational);
}

function assertRationalEqual(actual: Rational, expected: Rational): void {
  assert.equal(compareRational(actual, expected), 0);
}

function assertCanonicalZero(value: InternalFloat): void {
  assert.equal(value.sign, 0);
  assert.equal(value.significand, 0n);
  assert.equal(value.exponent, 0n);
  assert.equal(value.precisionBits, 1);
  assertRationalEqual(internalFloatToRational(value), integerRational(0n));
}
