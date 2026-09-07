import type { BigFloatBackend, InternalFloat, RoundingMode } from "./contracts.js";
import {
  RATIONAL_ZERO,
  absRational,
  createRational,
  divideRational,
  isZeroRational,
  signOfRational
} from "../values/rational.js";
import type { Rational, Sign } from "../values/contracts.js";

const ZERO = 0n;
const ONE = 1n;

export function createReferenceBigFloatBackend(): BigFloatBackend {
  return {
    fromRational: roundRationalToInternalFloat,
    compare: compareInternalFloat,
    add(left, right, precisionBits, roundingMode) {
      return addInternalFloats(left, right, precisionBits, roundingMode);
    },
    sub(left, right, precisionBits, roundingMode) {
      return addInternalFloats(left, negateInternalFloat(right), precisionBits, roundingMode);
    },
    mul(left, right, precisionBits, roundingMode) {
      if (left.sign === 0 || right.sign === 0) return canonicalZero();
      return roundSignedDyadic(
        BigInt(left.sign * right.sign) * left.significand * right.significand,
        left.exponent + right.exponent,
        precisionBits,
        roundingMode
      );
    },
    div(left, right, precisionBits, roundingMode) {
      if (right.sign === 0) {
        return roundRationalToInternalFloat(
          divideRational(internalFloatToRational(left), RATIONAL_ZERO),
          precisionBits,
          roundingMode
        );
      }
      if (left.sign === 0) return canonicalZero();
      const quotient = roundRationalToInternalFloat(
        createRational(BigInt(left.sign * right.sign) * left.significand, right.significand),
        precisionBits,
        roundingMode
      );
      return scaleInternalFloat(quotient, left.exponent - right.exponent);
    },
    round(value, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        internalFloatToRational(value),
        precisionBits,
        roundingMode
      );
    },
    negate(value) {
      return negateInternalFloat(value);
    },
    abs(value) {
      if (value.sign === 0) {
        return canonicalZero();
      }

      return makeInternalFloat(1, value.significand, value.exponent, value.precisionBits);
    },
    scaleByPowerOfTwo(value, exponentDelta) {
      return scaleInternalFloat(value, exponentDelta);
    }
  };
}

export function internalFloatToRational(value: InternalFloat): Rational {
  assertInternalFloat(value);

  if (value.sign === 0) {
    return RATIONAL_ZERO;
  }

  const signedSignificand = value.sign === 1 ? value.significand : -value.significand;

  if (value.exponent >= ZERO) {
    return createRational(signedSignificand * powerOfTwo(value.exponent), ONE);
  }

  return createRational(signedSignificand, powerOfTwo(-value.exponent));
}

function roundRationalToInternalFloat(
  value: Rational,
  precisionBits: number,
  roundingMode: RoundingMode
): InternalFloat {
  assertValidPrecisionBits(precisionBits);

  if (isZeroRational(value)) {
    return canonicalZero();
  }

  const sign = signOfRational(value);
  const magnitude = absRational(value);
  const highestBitExponent = floorLog2Rational(magnitude);
  let exponent = highestBitExponent - BigInt(precisionBits - 1);
  let roundedSignificand = roundScaledMagnitudeToInteger(
    magnitude,
    exponent,
    directedModeForMagnitude(sign, roundingMode)
  );

  if (roundedSignificand === ZERO) {
    return canonicalZero();
  }

  if (bitLength(roundedSignificand) > precisionBits) {
    roundedSignificand >>= ONE;
    exponent += ONE;
  }

  return makeInternalFloat(sign, roundedSignificand, exponent, precisionBits);
}

function compareInternalFloat(left: InternalFloat, right: InternalFloat): Sign {
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  if (left.sign === 0) return 0;

  const magnitudeComparison = compareInternalFloatMagnitudes(left, right);
  if (left.sign === 1 || magnitudeComparison === 0) return magnitudeComparison;
  return magnitudeComparison === 1 ? -1 : 1;
}

function compareInternalFloatMagnitudes(left: InternalFloat, right: InternalFloat): Sign {
  const leftTop = left.exponent + BigInt(bitLength(left.significand));
  const rightTop = right.exponent + BigInt(bitLength(right.significand));
  if (leftTop !== rightTop) return leftTop < rightTop ? -1 : 1;

  const commonExponent = left.exponent < right.exponent ? left.exponent : right.exponent;
  const leftMagnitude = left.significand << (left.exponent - commonExponent);
  const rightMagnitude = right.significand << (right.exponent - commonExponent);
  return leftMagnitude < rightMagnitude ? -1 : leftMagnitude > rightMagnitude ? 1 : 0;
}

function addInternalFloats(
  left: InternalFloat,
  right: InternalFloat,
  precisionBits: number,
  roundingMode: RoundingMode
): InternalFloat {
  assertValidPrecisionBits(precisionBits);
  if (left.sign === 0) return roundInternalFloat(right, precisionBits, roundingMode);
  if (right.sign === 0) return roundInternalFloat(left, precisionBits, roundingMode);

  const commonExponent = left.exponent < right.exponent ? left.exponent : right.exponent;
  const leftCoefficient =
    BigInt(left.sign) * left.significand * (ONE << (left.exponent - commonExponent));
  const rightCoefficient =
    BigInt(right.sign) * right.significand * (ONE << (right.exponent - commonExponent));
  return roundSignedDyadic(
    leftCoefficient + rightCoefficient,
    commonExponent,
    precisionBits,
    roundingMode
  );
}

function roundInternalFloat(
  value: InternalFloat,
  precisionBits: number,
  roundingMode: RoundingMode
): InternalFloat {
  if (value.sign === 0) return canonicalZero();
  return roundSignedDyadic(
    BigInt(value.sign) * value.significand,
    value.exponent,
    precisionBits,
    roundingMode
  );
}

function roundSignedDyadic(
  coefficient: bigint,
  exponent: bigint,
  precisionBits: number,
  roundingMode: RoundingMode
): InternalFloat {
  assertValidPrecisionBits(precisionBits);
  if (coefficient === ZERO) return canonicalZero();

  const sign: Sign = coefficient < ZERO ? -1 : 1;
  const magnitude = coefficient < ZERO ? -coefficient : coefficient;
  const discardedBits = bitLength(magnitude) - precisionBits;
  if (discardedBits <= 0) {
    return makeInternalFloat(sign, magnitude, exponent, precisionBits);
  }

  const shift = BigInt(discardedBits);
  let roundedSignificand = magnitude >> shift;
  const remainder = magnitude - (roundedSignificand << shift);
  const magnitudeMode = directedModeForMagnitude(sign, roundingMode);
  if (
    remainder !== ZERO &&
    (magnitudeMode === "ceil" || (magnitudeMode === "nearest" && remainder * 2n >= ONE << shift))
  ) {
    roundedSignificand += ONE;
  }

  let roundedExponent = exponent + shift;
  if (bitLength(roundedSignificand) > precisionBits) {
    roundedSignificand >>= ONE;
    roundedExponent += ONE;
  }
  return makeInternalFloat(sign, roundedSignificand, roundedExponent, precisionBits);
}

function negateInternalFloat(value: InternalFloat): InternalFloat {
  if (value.sign === 0) return canonicalZero();
  return makeInternalFloat(
    value.sign === 1 ? -1 : 1,
    value.significand,
    value.exponent,
    value.precisionBits
  );
}

function scaleInternalFloat(value: InternalFloat, exponentDelta: bigint): InternalFloat {
  if (value.sign === 0) return canonicalZero();
  return makeInternalFloat(
    value.sign,
    value.significand,
    value.exponent + exponentDelta,
    value.precisionBits
  );
}

function directedModeForMagnitude(
  sign: Sign,
  roundingMode: RoundingMode
): "floor" | "ceil" | "nearest" {
  if (roundingMode === "nearest") {
    return "nearest";
  }

  if (sign > 0) {
    return roundingMode === "towardNegativeInfinity" ? "floor" : "ceil";
  }

  return roundingMode === "towardNegativeInfinity" ? "ceil" : "floor";
}

function roundScaledMagnitudeToInteger(
  magnitude: Rational,
  exponent: bigint,
  mode: "floor" | "ceil" | "nearest"
): bigint {
  const scaled =
    exponent >= ZERO
      ? createRational(magnitude.numerator, magnitude.denominator * powerOfTwo(exponent))
      : createRational(magnitude.numerator * powerOfTwo(-exponent), magnitude.denominator);

  const quotient = scaled.numerator / scaled.denominator;
  const remainder = scaled.numerator % scaled.denominator;

  if (remainder === ZERO || mode === "floor") {
    return quotient;
  }

  if (mode === "ceil") {
    return quotient + ONE;
  }

  return remainder * 2n < scaled.denominator ? quotient : quotient + ONE;
}

function floorLog2Rational(value: Rational): bigint {
  let exponent = BigInt(bitLength(value.numerator) - bitLength(value.denominator));

  while (comparePositiveRationalToPowerOfTwo(value, exponent) < 0) {
    exponent -= ONE;
  }

  while (comparePositiveRationalToPowerOfTwo(value, exponent + ONE) >= 0) {
    exponent += ONE;
  }

  return exponent;
}

function comparePositiveRationalToPowerOfTwo(value: Rational, exponent: bigint): Sign {
  const left = exponent >= ZERO ? value.numerator : value.numerator * powerOfTwo(-exponent);
  const right = exponent >= ZERO ? value.denominator * powerOfTwo(exponent) : value.denominator;

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function makeInternalFloat(
  sign: Sign,
  significand: bigint,
  exponent: bigint,
  precisionBits: number
): InternalFloat {
  assertValidPrecisionBits(precisionBits);

  if (significand === ZERO || sign === 0) {
    return canonicalZero();
  }

  if (significand < ZERO) {
    throw new Error("InternalFloat significand must be non-negative");
  }

  return Object.freeze({
    kind: "internal-float",
    sign,
    significand,
    exponent,
    precisionBits
  });
}

function canonicalZero(): InternalFloat {
  return Object.freeze({
    kind: "internal-float",
    sign: 0,
    significand: ZERO,
    exponent: ZERO,
    precisionBits: 1
  });
}

function assertInternalFloat(value: InternalFloat): void {
  if (value.significand < ZERO) {
    throw new Error("InternalFloat significand must be non-negative");
  }

  assertValidPrecisionBits(value.precisionBits);

  if (
    value.sign === 0 &&
    (value.significand !== ZERO || value.exponent !== ZERO || value.precisionBits !== 1)
  ) {
    throw new Error("InternalFloat zero must be canonical");
  }
}

function assertValidPrecisionBits(precisionBits: number): void {
  if (!Number.isSafeInteger(precisionBits) || precisionBits < 1) {
    throw new Error("precisionBits must be a positive safe integer");
  }
}

function bitLength(value: bigint): number {
  if (value < ZERO) {
    throw new Error("bitLength requires a non-negative bigint");
  }

  return value.toString(2).length;
}

function powerOfTwo(exponent: bigint): bigint {
  if (exponent < ZERO) {
    throw new Error("powerOfTwo requires a non-negative exponent");
  }

  return ONE << exponent;
}
