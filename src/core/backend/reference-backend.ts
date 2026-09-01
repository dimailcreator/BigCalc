import type { BigFloatBackend, InternalFloat, RoundingMode } from "./contracts.js";
import {
  RATIONAL_ZERO,
  absRational,
  addRational,
  compareRational,
  createRational,
  divideRational,
  isZeroRational,
  multiplyRational,
  signOfRational,
  subtractRational
} from "../values/rational.js";
import type { Rational, Sign } from "../values/contracts.js";

const ZERO = 0n;
const ONE = 1n;

export function createReferenceBigFloatBackend(): BigFloatBackend {
  return {
    fromRational: roundRationalToInternalFloat,
    compare: compareInternalFloat,
    add(left, right, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        addRational(internalFloatToRational(left), internalFloatToRational(right)),
        precisionBits,
        roundingMode
      );
    },
    sub(left, right, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        subtractRational(internalFloatToRational(left), internalFloatToRational(right)),
        precisionBits,
        roundingMode
      );
    },
    mul(left, right, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        multiplyRational(internalFloatToRational(left), internalFloatToRational(right)),
        precisionBits,
        roundingMode
      );
    },
    div(left, right, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        divideRational(internalFloatToRational(left), internalFloatToRational(right)),
        precisionBits,
        roundingMode
      );
    },
    round(value, precisionBits, roundingMode) {
      return roundRationalToInternalFloat(
        internalFloatToRational(value),
        precisionBits,
        roundingMode
      );
    },
    negate(value) {
      if (value.sign === 0) {
        return canonicalZero();
      }

      return makeInternalFloat(
        value.sign === 1 ? -1 : 1,
        value.significand,
        value.exponent,
        value.precisionBits
      );
    },
    abs(value) {
      if (value.sign === 0) {
        return canonicalZero();
      }

      return makeInternalFloat(1, value.significand, value.exponent, value.precisionBits);
    },
    scaleByPowerOfTwo(value, exponentDelta) {
      if (value.sign === 0) {
        return canonicalZero();
      }

      return makeInternalFloat(
        value.sign,
        value.significand,
        value.exponent + exponentDelta,
        value.precisionBits
      );
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
  return compareRational(internalFloatToRational(left), internalFloatToRational(right));
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
