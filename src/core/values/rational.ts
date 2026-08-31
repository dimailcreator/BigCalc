import { divisionByZeroError } from "../errors/index.js";
import type { DivisionByZeroError } from "../errors/index.js";
import type { Rational, Sign } from "./contracts.js";

const ZERO = 0n;
const ONE = 1n;

export const RATIONAL_ZERO: Rational = Object.freeze({
  kind: "rational",
  numerator: ZERO,
  denominator: ONE
});

export const RATIONAL_ONE: Rational = Object.freeze({
  kind: "rational",
  numerator: ONE,
  denominator: ONE
});

export function createRational(numerator: bigint, denominator: bigint = ONE): Rational {
  if (denominator === ZERO) {
    throwDivisionByZeroError("Rational denominator cannot be zero");
  }

  if (numerator === ZERO) {
    return RATIONAL_ZERO;
  }

  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;

  if (normalizedDenominator < ZERO) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }

  const divisor = gcd(absBigInt(normalizedNumerator), normalizedDenominator);

  return Object.freeze({
    kind: "rational",
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor
  });
}

export function integerRational(value: bigint): Rational {
  return createRational(value, ONE);
}

export function isRational(value: unknown): value is Rational {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<PropertyKey, unknown>;

  return (
    candidate.kind === "rational" &&
    typeof candidate.numerator === "bigint" &&
    typeof candidate.denominator === "bigint" &&
    isCanonicalRationalShape(candidate.numerator, candidate.denominator)
  );
}

export function isZeroRational(value: Rational): boolean {
  return value.numerator === ZERO;
}

export function isIntegerRational(value: Rational): boolean {
  return value.denominator === ONE;
}

export function signOfRational(value: Rational): Sign {
  if (value.numerator === ZERO) {
    return 0;
  }

  return value.numerator < ZERO ? -1 : 1;
}

export function compareRational(left: Rational, right: Rational): Sign {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;

  if (difference === ZERO) {
    return 0;
  }

  return difference < ZERO ? -1 : 1;
}

export function equalsRational(left: Rational, right: Rational): boolean {
  return compareRational(left, right) === 0;
}

export function negateRational(value: Rational): Rational {
  return createRational(-value.numerator, value.denominator);
}

export function absRational(value: Rational): Rational {
  return createRational(absBigInt(value.numerator), value.denominator);
}

export function addRational(left: Rational, right: Rational): Rational {
  return createRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

export function subtractRational(left: Rational, right: Rational): Rational {
  return createRational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return createRational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function reciprocalRational(value: Rational): Rational {
  if (isZeroRational(value)) {
    throwDivisionByZeroError("Cannot take reciprocal of zero");
  }

  return createRational(value.denominator, value.numerator);
}

export function divideRational(left: Rational, right: Rational): Rational {
  if (isZeroRational(right)) {
    throwDivisionByZeroError();
  }

  return createRational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function powRational(base: Rational, exponent: bigint): Rational {
  if (exponent === ZERO) {
    return RATIONAL_ONE;
  }

  if (exponent < ZERO) {
    return powRational(reciprocalRational(base), -exponent);
  }

  return createRational(base.numerator ** exponent, base.denominator ** exponent);
}

export function exactNthRootRational(value: Rational, degree: bigint): Rational | null {
  if (degree <= ZERO) {
    return null;
  }

  if (degree === ONE) {
    return createRational(value.numerator, value.denominator);
  }

  const numeratorSign = signOfRational(value);

  if (numeratorSign < 0 && degree % 2n === 0n) {
    return null;
  }

  const numeratorRoot = exactNthRootBigInt(absBigInt(value.numerator), degree);
  if (numeratorRoot === null) {
    return null;
  }

  const denominatorRoot = exactNthRootBigInt(value.denominator, degree);
  if (denominatorRoot === null) {
    return null;
  }

  return createRational(numeratorSign < 0 ? -numeratorRoot : numeratorRoot, denominatorRoot);
}

export function assertCanonicalRational(value: Rational): void {
  if (value.denominator <= ZERO) {
    throw new Error("Rational denominator must be positive");
  }

  if (value.numerator === ZERO && value.denominator !== ONE) {
    throw new Error("Rational zero must be represented as 0/1");
  }

  if (gcd(absBigInt(value.numerator), value.denominator) !== ONE) {
    throw new Error("Rational numerator and denominator must be coprime");
  }
}

class DivisionByZeroException extends Error implements DivisionByZeroError {
  readonly kind = "calc-error";
  readonly code = "DivisionByZeroError";

  constructor(message?: string) {
    super(divisionByZeroError(message).message);
    this.name = "DivisionByZeroError";
  }
}

function throwDivisionByZeroError(message?: string): never {
  throw new DivisionByZeroException(message);
}

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;

  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

function isCanonicalRationalShape(numerator: bigint, denominator: bigint): boolean {
  return (
    denominator > ZERO &&
    (numerator !== ZERO || denominator === ONE) &&
    gcd(absBigInt(numerator), denominator) === ONE
  );
}

function exactNthRootBigInt(value: bigint, degree: bigint): bigint | null {
  if (value < ZERO || degree <= ZERO) {
    return null;
  }

  if (degree === ONE || value < 2n) {
    return value;
  }

  let low = ONE;
  let high = value;

  while (low <= high) {
    const mid = (low + high) / 2n;
    const comparison = comparePowerToLimit(mid, degree, value);

    if (comparison === 0) {
      return mid;
    }

    if (comparison < 0) {
      low = mid + ONE;
    } else {
      high = mid - ONE;
    }
  }

  return null;
}

function comparePowerToLimit(base: bigint, exponent: bigint, limit: bigint): Sign {
  let product = ONE;
  let remaining = exponent;

  while (remaining > ZERO) {
    product *= base;

    if (product > limit) {
      return 1;
    }

    remaining -= ONE;
  }

  if (product === limit) {
    return 0;
  }

  return product < limit ? -1 : 1;
}
