import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RATIONAL_ONE,
  RATIONAL_ZERO,
  absRational,
  addRational,
  assertCanonicalRational,
  compareRational,
  createRational,
  divideRational,
  equalsRational,
  exactNthRootRational,
  integerRational,
  isDivisionByZeroError,
  isIntegerRational,
  isRational,
  isZeroRational,
  multiplyRational,
  negateRational,
  powRational,
  reciprocalRational,
  signOfRational,
  subtractRational
} from "../src/core/index.js";
import type { Rational } from "../src/core/index.js";

function assertRational(value: Rational, numerator: bigint, denominator: bigint): void {
  assertCanonicalRational(value);
  assert.equal(value.kind, "rational");
  assert.equal(value.numerator, numerator);
  assert.equal(value.denominator, denominator);
}

function assertEqualRational(left: Rational, right: Rational): void {
  assertCanonicalRational(left);
  assertCanonicalRational(right);
  assert.equal(equalsRational(left, right), true);
}

function assertThrowsDivisionByZero(action: () => unknown): void {
  try {
    action();
    assert.fail("Expected DivisionByZeroError");
  } catch (error) {
    assert.equal(isDivisionByZeroError(error), true);
  }
}

function valueAt(values: readonly Rational[], index: number): Rational {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing rational test value at index ${String(index)}`);
  }

  return value;
}

function* deterministicRationals(count: number): Generator<Rational> {
  let state = 0x1234_5678_9abc_def0_1357_2468_ace0_bdf1n;
  const mask = (1n << 160n) - 1n;

  for (let index = 0; index < count; index += 1) {
    state = (state * 0xd134_2543_de82_ef95n + 0x9e37_79b9_7f4a_7c15n) & mask;
    const numerator = state - (1n << 159n);

    state = (state * 0xd134_2543_de82_ef95n + 0x9e37_79b9_7f4a_7c15n) & mask;
    const denominator = (state < 0n ? -state : state) + 1n;

    yield createRational(numerator, denominator);
  }
}

void describe("Rational", () => {
  void it("normalizes numerator and denominator canonically", () => {
    assertRational(createRational(6n, 8n), 3n, 4n);
    assertRational(createRational(1n, -2n), -1n, 2n);
    assertRational(createRational(-1n, -2n), 1n, 2n);
    assertRational(createRational(0n, 99n), 0n, 1n);
    assert.equal(createRational(0n, -99n), RATIONAL_ZERO);
    assert.equal(createRational(12n, 12n).denominator, RATIONAL_ONE.denominator);
  });

  void it("rejects zero denominators with a typed error", () => {
    assertThrowsDivisionByZero(() => createRational(1n, 0n));
  });

  void it("reports signs and predicates", () => {
    assert.equal(signOfRational(createRational(-2n, 3n)), -1);
    assert.equal(signOfRational(createRational(0n, 3n)), 0);
    assert.equal(signOfRational(createRational(2n, 3n)), 1);

    assert.equal(isZeroRational(createRational(0n, 7n)), true);
    assert.equal(isZeroRational(createRational(1n, 7n)), false);
    assert.equal(isIntegerRational(createRational(9n, 3n)), true);
    assert.equal(isIntegerRational(createRational(10n, 3n)), false);
    assert.equal(isRational(createRational(1n, 2n)), true);
    assert.equal(isRational({ kind: "rational", numerator: 2n, denominator: 4n }), false);
    assert.equal(isRational({ kind: "rational", numerator: 1, denominator: 2 }), false);
  });

  void it("compares exact rational values", () => {
    assert.equal(compareRational(createRational(1n, 3n), createRational(2n, 6n)), 0);
    assert.equal(compareRational(createRational(-1n, 3n), createRational(0n)), -1);
    assert.equal(compareRational(createRational(7n, 5n), createRational(4n, 3n)), 1);
  });

  void it("performs exact arithmetic", () => {
    const oneThird = createRational(1n, 3n);
    const oneSixth = createRational(1n, 6n);

    assertRational(addRational(oneThird, oneSixth), 1n, 2n);
    assertRational(subtractRational(oneThird, oneSixth), 1n, 6n);
    assertRational(multiplyRational(createRational(2n, 3n), createRational(9n, 10n)), 3n, 5n);
    assertRational(divideRational(createRational(2n, 3n), createRational(4n, 5n)), 5n, 6n);
    assertRational(negateRational(createRational(2n, 3n)), -2n, 3n);
    assertRational(absRational(createRational(-2n, 3n)), 2n, 3n);
    assertRational(reciprocalRational(createRational(-2n, 3n)), -3n, 2n);
  });

  void it("types division by zero for division, reciprocal, and negative powers", () => {
    assertThrowsDivisionByZero(() => divideRational(createRational(1n), createRational(0n)));
    assertThrowsDivisionByZero(() => reciprocalRational(createRational(0n)));
    assertThrowsDivisionByZero(() => powRational(createRational(0n), -1n));
  });

  void it("supports exact integer powers", () => {
    assertRational(powRational(createRational(2n, 3n), 5n), 32n, 243n);
    assertRational(powRational(createRational(2n, 3n), -2n), 9n, 4n);
    assertRational(powRational(createRational(-2n, 3n), 3n), -8n, 27n);
    assertRational(powRational(createRational(-2n, 3n), 4n), 16n, 81n);
    assertRational(powRational(createRational(0n), 0n), 1n, 1n);
  });

  void it("checks exact rational nth roots for future fast paths", () => {
    assertRational(exactNthRootRational(createRational(4n, 9n), 2n) ?? RATIONAL_ZERO, 2n, 3n);
    assertRational(exactNthRootRational(createRational(-8n, 27n), 3n) ?? RATIONAL_ZERO, -2n, 3n);

    assert.equal(exactNthRootRational(createRational(2n, 3n), 2n), null);
    assert.equal(exactNthRootRational(createRational(-4n, 9n), 2n), null);
    assert.equal(exactNthRootRational(createRational(4n, 9n), 0n), null);
  });

  void it("keeps large bigint calculations exact and canonical", () => {
    const largeA = createRational(
      1234567890123456789012345678901234567890n,
      987654321098765432109876543210n
    );
    const largeB = createRational(
      -222222222222222222222222222222222222222n,
      333333333333333333333333333333n
    );

    const sum = addRational(largeA, largeB);
    const product = multiplyRational(largeA, largeB);
    const quotient = divideRational(largeA, largeB);

    assertCanonicalRational(sum);
    assertCanonicalRational(product);
    assertCanonicalRational(quotient);
    assertEqualRational(subtractRational(sum, largeB), largeA);
    assertEqualRational(divideRational(product, largeB), largeA);
    assertEqualRational(multiplyRational(quotient, largeB), largeA);
  });

  void it("satisfies core algebraic properties over deterministic random rationals", () => {
    const values = [...deterministicRationals(45)];

    for (let index = 0; index < values.length - 2; index += 1) {
      const a = valueAt(values, index);
      const b = valueAt(values, index + 1);
      const c = valueAt(values, index + 2);

      assertCanonicalRational(a);
      assertCanonicalRational(b);
      assertCanonicalRational(c);

      assertEqualRational(addRational(a, b), addRational(b, a));
      assertEqualRational(multiplyRational(a, b), multiplyRational(b, a));
      assertEqualRational(addRational(addRational(a, b), c), addRational(a, addRational(b, c)));
      assertEqualRational(
        multiplyRational(multiplyRational(a, b), c),
        multiplyRational(a, multiplyRational(b, c))
      );
      assertRational(subtractRational(a, a), 0n, 1n);

      if (!isZeroRational(a)) {
        assertRational(divideRational(a, a), 1n, 1n);
      }
    }
  });

  void it("creates integer rationals exactly", () => {
    assertRational(integerRational(-42n), -42n, 1n);
  });
});
