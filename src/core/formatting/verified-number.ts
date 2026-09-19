import { internalFloatToRational } from "../backend/reference-backend.js";
import type { BigFloatBackend, InternalFloat } from "../backend/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import { ballToOutwardInterval } from "../values/ball.js";
import {
  absRational,
  compareRational,
  createRational,
  isZeroRational,
  signOfRational
} from "../values/rational.js";
import type { Ball, Rational, RealValue, Sign } from "../values/contracts.js";
import type {
  EvaluationCheckpoint,
  EvaluationGraphContext,
  PrecisionRequest
} from "../evaluation/index.js";
import type { VerifiedNumber } from "./contracts.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const FIVE = 5n;
const TEN = 10n;
const DIRECT_INTERNAL_EXPONENT_THRESHOLD = 4096n;

export function verifiedNumberFromRational(
  value: Rational,
  request: PrecisionRequest
): VerifiedNumber {
  validatePrecisionRequest(request);

  if (isZeroRational(value)) {
    return Object.freeze({
      sign: 0,
      digits: "0",
      exponent10: 0n,
      verifiedDigits: 1,
      valueExact: true,
      decimalTerminating: true,
      rounded: false,
      zeroKind: "exact"
    });
  }

  const sign = signOfRational(value);
  const magnitude = absRational(value);
  const terminating = terminatingDecimalInfo(magnitude);

  if (terminating !== null) {
    return verifiedFiniteDecimal(sign, terminating);
  }

  const exponent10 = floorLog10Rational(magnitude);
  const digits = significantDigitsPrefix(magnitude, exponent10, request.significantDigits);

  return Object.freeze({
    sign,
    digits,
    exponent10,
    verifiedDigits: digits.length,
    valueExact: true,
    decimalTerminating: false,
    rounded: false
  });
}

export function verifiedNumberFromBall(
  ball: Ball,
  request: PrecisionRequest,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): VerifiedNumber {
  validatePrecisionRequest(request);

  if (ball.precisionCutoff !== undefined && !ball.precisionCutoff.ambiguousBoundary) {
    return verifiedNumberFromPrecisionCutoffBall(ball, request);
  }

  const precisionBits = Math.max(
    precisionBitsForVerifiedDigits(request.significantDigits),
    ball.center.precisionBits,
    ball.radius.precisionBits
  );
  const interval = ballToOutwardInterval(ball, precisionBits, backend);
  if (
    absoluteBigInt(interval.lower.exponent) > DIRECT_INTERNAL_EXPONENT_THRESHOLD ||
    absoluteBigInt(interval.upper.exponent) > DIRECT_INTERNAL_EXPONENT_THRESHOLD
  ) {
    return verifiedNumberFromInternalFloatInterval(
      interval.lower,
      interval.upper,
      request,
      backend,
      control
    );
  }
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);

  if (compareRational(lower, upper) === 0) {
    const exactPoint = verifiedNumberFromRational(lower, request);

    if (exactPoint.sign === 0) {
      return Object.freeze({
        sign: exactPoint.sign,
        digits: exactPoint.digits,
        exponent10: exactPoint.exponent10,
        verifiedDigits: exactPoint.verifiedDigits,
        valueExact: false,
        decimalTerminating: false,
        rounded: exactPoint.rounded
      });
    }

    const digits =
      exactPoint.decimalTerminating && exactPoint.digits.length < request.significantDigits
        ? exactPoint.digits.padEnd(request.significantDigits, "0")
        : exactPoint.digits;

    return Object.freeze({
      ...exactPoint,
      digits,
      verifiedDigits: digits.length,
      valueExact: false,
      decimalTerminating: exactPoint.decimalTerminating
    });
  }

  return verifiedNumberFromRationalInterval(lower, upper, request);
}

function verifiedNumberFromInternalFloatInterval(
  lower: InternalFloat,
  upper: InternalFloat,
  request: PrecisionRequest,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): VerifiedNumber {
  if (lower.sign <= 0 && upper.sign >= 0) return unverifiedCrossingZero();

  const sign: Sign = lower.sign > 0 ? 1 : -1;
  const lowerMagnitude = sign > 0 ? lower : negateInternalFloatForFormatting(upper);
  const upperMagnitude = sign > 0 ? upper : negateInternalFloatForFormatting(lower);
  const lowerExponent = floorLog10InternalFloat(lowerMagnitude, backend, control);
  const upperExponent = floorLog10InternalFloat(upperMagnitude, backend, control);
  if (lowerExponent !== upperExponent) return unverifiedPrefix(sign, upperExponent);

  const lowerDigits = significantDigitsBoundsInternalFloat(
    lowerMagnitude,
    lowerExponent,
    request.significantDigits,
    backend,
    control
  ).lower;
  const upperDigits = significantDigitsBoundsInternalFloat(
    upperMagnitude,
    upperExponent,
    request.significantDigits,
    backend,
    control
  ).upper;
  const digits = commonPrefix(lowerDigits, upperDigits);
  return Object.freeze({
    sign,
    digits,
    exponent10: lowerExponent,
    verifiedDigits: digits.length,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

function floorLog10InternalFloat(
  value: InternalFloat,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): bigint {
  if (value.sign <= 0) {
    throw new InternalCalculationException("floorLog10InternalFloat requires a positive value");
  }

  const significandBits = value.significand.toString(2).length;
  const retainedBits = Math.min(53, significandBits);
  const shift = significandBits - retainedBits;
  const leading = Number(value.significand >> BigInt(shift));
  const approximate =
    (Math.log2(leading) + shift + Number(value.exponent)) * Math.LOG10E * Math.log(2);
  if (!Number.isFinite(approximate) || !Number.isSafeInteger(Math.floor(approximate))) {
    throw new InternalCalculationException(
      "Decimal formatting exponent exceeds the supported resource range"
    );
  }

  let exponent = BigInt(Math.floor(approximate));
  while (compareInternalFloatMagnitudeToPowerOfTen(value, exponent, backend, control) < 0) {
    exponent -= ONE;
  }
  while (compareInternalFloatMagnitudeToPowerOfTen(value, exponent + ONE, backend, control) >= 0) {
    exponent += ONE;
  }
  return exponent;
}

function compareInternalFloatMagnitudeToPowerOfTen(
  value: InternalFloat,
  decimalExponent: bigint,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): Sign {
  let precisionBits = compactDecimalWorkingPrecision(value, decimalExponent, 1);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const power = internalPowerOfTenInterval(decimalExponent, precisionBits, backend, control);
    if (backend.compare(value, power.lower) < 0) return -1;
    if (backend.compare(value, power.upper) >= 0) return 1;
    precisionBits *= 2;
  }

  throw new InternalCalculationException(
    "Could not separate InternalFloat from a decimal power boundary"
  );
}

interface InternalFloatBounds {
  readonly lower: InternalFloat;
  readonly upper: InternalFloat;
}

function significantDigitsBoundsInternalFloat(
  value: InternalFloat,
  exponent10: bigint,
  significantDigits: number,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): { readonly lower: string; readonly upper: string } {
  const decimalScale = BigInt(significantDigits - 1) - exponent10;
  let precisionBits = compactDecimalWorkingPrecision(value, decimalScale, significantDigits);
  let lowerFloor = ZERO;
  let upperFloor = ZERO;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = internalPowerOfTenInterval(decimalScale, precisionBits, backend, control);
    const lower = backend.mul(value, scale.lower, precisionBits, "towardNegativeInfinity");
    const upper = backend.mul(value, scale.upper, precisionBits, "towardPositiveInfinity");
    lowerFloor = floorPositiveInternalFloat(lower);
    upperFloor = floorPositiveInternalFloat(upper);
    if (lowerFloor === upperFloor) break;
    precisionBits *= 2;
  }

  return Object.freeze({
    lower: lowerFloor.toString().padStart(significantDigits, "0"),
    upper: upperFloor.toString().padStart(significantDigits, "0")
  });
}

function internalPowerOfTenInterval(
  exponent: bigint,
  precisionBits: number,
  backend: BigFloatBackend,
  control?: EvaluationCheckpoint
): InternalFloatBounds {
  const one = backend.fromRational(createRational(ONE), precisionBits, "nearest");
  if (exponent === ZERO) return Object.freeze({ lower: one, upper: one });

  const ten = backend.fromRational(createRational(TEN), precisionBits, "nearest");
  let lower = one;
  let upper = one;
  let factorLower = ten;
  let factorUpper = ten;
  let remaining = absoluteBigInt(exponent);

  while (remaining > ZERO) {
    control?.checkpoint();
    if (remaining % TWO !== ZERO) {
      lower = backend.mul(lower, factorLower, precisionBits, "towardNegativeInfinity");
      upper = backend.mul(upper, factorUpper, precisionBits, "towardPositiveInfinity");
    }

    remaining /= TWO;
    if (remaining === ZERO) break;
    factorLower = backend.mul(factorLower, factorLower, precisionBits, "towardNegativeInfinity");
    factorUpper = backend.mul(factorUpper, factorUpper, precisionBits, "towardPositiveInfinity");
  }

  if (exponent > ZERO) return Object.freeze({ lower, upper });

  return Object.freeze({
    lower: backend.div(one, upper, precisionBits, "towardNegativeInfinity"),
    upper: backend.div(one, lower, precisionBits, "towardPositiveInfinity")
  });
}

function floorPositiveInternalFloat(value: InternalFloat): bigint {
  if (value.sign <= 0) return ZERO;
  if (value.exponent >= ZERO) return value.significand << value.exponent;

  const shift = -value.exponent;
  if (shift >= BigInt(value.significand.toString(2).length)) return ZERO;
  return value.significand >> shift;
}

function compactDecimalWorkingPrecision(
  value: InternalFloat,
  decimalExponent: bigint,
  significantDigits: number
): number {
  const exponentBits = absoluteBigInt(decimalExponent).toString(2).length;

  return Math.max(
    value.precisionBits + 32 + exponentBits,
    precisionBitsForVerifiedDigits(significantDigits) + 32 + exponentBits
  );
}

function negateInternalFloatForFormatting(value: InternalFloat): InternalFloat {
  return Object.freeze({ ...value, sign: value.sign === 1 ? -1 : 1 });
}

function absoluteBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function verifiedNumberFromPrecisionCutoffBall(
  ball: Ball,
  request: PrecisionRequest
): VerifiedNumber {
  const metadata = ball.precisionCutoff;
  if (metadata === undefined) {
    throw new InternalCalculationException("Precision cutoff metadata is missing");
  }

  if (isZeroRational(metadata.roundedCenter)) {
    return Object.freeze({
      sign: 0,
      digits: "0",
      exponent10: 0n,
      verifiedDigits: 1,
      valueExact: false,
      decimalTerminating: false,
      rounded: true,
      zeroKind: "rounded"
    });
  }

  const sign = signOfRational(metadata.roundedCenter);
  const magnitude = absRational(metadata.roundedCenter);
  const exponent10 = floorLog10Rational(magnitude);
  const representedDigits = Number(exponent10 - metadata.stepExponent10 + ONE);
  const requestedDigits = Math.min(request.significantDigits, representedDigits);
  const digits = significantDigitsPrefix(magnitude, exponent10, requestedDigits);

  return Object.freeze({
    sign,
    digits,
    exponent10,
    verifiedDigits: digits.length,
    valueExact: false,
    decimalTerminating: true,
    rounded: true
  });
}

export async function verifiedNumberFromRealValue(
  value: RealValue,
  request: PrecisionRequest,
  context: EvaluationGraphContext
): Promise<VerifiedNumber> {
  if (value.kind === "rational") {
    return verifiedNumberFromRational(value, request);
  }

  return verifiedNumberFromBall(
    await value.refine(request, context),
    request,
    context.backend,
    context
  );
}

export function precisionBitsForVerifiedDigits(significantDigits: number): number {
  if (!Number.isSafeInteger(significantDigits) || significantDigits < 1) {
    throw new InternalCalculationException("significantDigits must be a positive safe integer");
  }

  return Math.max(8, Math.ceil(significantDigits * Math.log2(10)) + 8);
}

function verifiedNumberFromRationalInterval(
  lower: Rational,
  upper: Rational,
  request: PrecisionRequest
): VerifiedNumber {
  const lowerSign = signOfRational(lower);
  const upperSign = signOfRational(upper);

  if (lowerSign === 0 && upperSign === 0) {
    return unverifiedBallZero();
  }

  if (lowerSign <= 0 && upperSign >= 0) {
    return unverifiedCrossingZero();
  }

  const sign: Sign = lowerSign > 0 && upperSign > 0 ? 1 : -1;
  const lowerMagnitude = sign > 0 ? lower : absRational(upper);
  const upperMagnitude = sign > 0 ? upper : absRational(lower);
  const lowerExponent = floorLog10Rational(lowerMagnitude);
  const upperExponent = floorLog10Rational(upperMagnitude);

  if (lowerExponent !== upperExponent) {
    return unverifiedPrefix(sign, upperExponent);
  }

  const lowerDigits = significantDigitsPrefix(
    lowerMagnitude,
    lowerExponent,
    request.significantDigits
  );
  const upperDigits = significantDigitsPrefix(
    upperMagnitude,
    upperExponent,
    request.significantDigits
  );
  const digits = commonPrefix(lowerDigits, upperDigits);

  return Object.freeze({
    sign,
    digits,
    exponent10: lowerExponent,
    verifiedDigits: digits.length,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

interface TerminatingDecimalInfo {
  readonly digits: string;
  readonly exponent10: bigint;
}

function verifiedFiniteDecimal(sign: Sign, info: TerminatingDecimalInfo): VerifiedNumber {
  return Object.freeze({
    sign,
    digits: info.digits,
    exponent10: info.exponent10,
    verifiedDigits: info.digits.length,
    valueExact: true,
    decimalTerminating: true,
    rounded: false
  });
}

function terminatingDecimalInfo(value: Rational): TerminatingDecimalInfo | null {
  let denominator = value.denominator;
  let twos = ZERO;
  let fives = ZERO;

  while (denominator % TWO === ZERO) {
    denominator /= TWO;
    twos += ONE;
  }

  while (denominator % FIVE === ZERO) {
    denominator /= FIVE;
    fives += ONE;
  }

  if (denominator !== ONE) {
    return null;
  }

  const decimalPlaces = twos > fives ? twos : fives;
  const scale = powerOfTen(decimalPlaces) / value.denominator;
  const scaledInteger = value.numerator * scale;
  const digits = stripTrailingZeros(scaledInteger.toString());

  return Object.freeze({
    digits,
    exponent10: BigInt(scaledInteger.toString().length) - decimalPlaces - ONE
  });
}

function significantDigitsPrefix(
  value: Rational,
  exponent10: bigint,
  significantDigits: number
): string {
  const scaleExponent = BigInt(significantDigits - 1) - exponent10;
  const scaled =
    scaleExponent >= ZERO
      ? createRational(value.numerator * powerOfTen(scaleExponent), value.denominator)
      : createRational(value.numerator, value.denominator * powerOfTen(-scaleExponent));
  const prefix = scaled.numerator / scaled.denominator;

  return prefix.toString().padStart(significantDigits, "0");
}

function floorLog10Rational(value: Rational): bigint {
  if (value.numerator <= ZERO) {
    throw new InternalCalculationException("floorLog10Rational requires a positive rational");
  }

  let exponent = BigInt(value.numerator.toString().length - value.denominator.toString().length);

  while (comparePositiveRationalToPowerOfTen(value, exponent) < 0) {
    exponent -= ONE;
  }

  while (comparePositiveRationalToPowerOfTen(value, exponent + ONE) >= 0) {
    exponent += ONE;
  }

  return exponent;
}

function comparePositiveRationalToPowerOfTen(value: Rational, exponent: bigint): Sign {
  const left = exponent >= ZERO ? value.numerator : value.numerator * powerOfTen(-exponent);
  const right = exponent >= ZERO ? value.denominator * powerOfTen(exponent) : value.denominator;

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function unverifiedBallZero(): VerifiedNumber {
  return Object.freeze({
    sign: 0,
    digits: "",
    exponent10: 0n,
    verifiedDigits: 0,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

function unverifiedCrossingZero(): VerifiedNumber {
  return Object.freeze({
    sign: 0,
    digits: "",
    exponent10: 0n,
    verifiedDigits: 0,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

function unverifiedPrefix(sign: Sign, exponent10: bigint): VerifiedNumber {
  return Object.freeze({
    sign,
    digits: "",
    exponent10,
    verifiedDigits: 0,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

function commonPrefix(left: string, right: string): string {
  const length = Math.min(left.length, right.length);
  let index = 0;

  while (index < length && left[index] === right[index]) {
    index += 1;
  }

  return left.slice(0, index);
}

function stripTrailingZeros(value: string): string {
  let end = value.length;

  while (end > 1 && value[end - 1] === "0") {
    end -= 1;
  }

  return value.slice(0, end);
}

function powerOfTen(exponent: bigint): bigint {
  if (exponent < ZERO) {
    throw new InternalCalculationException("powerOfTen requires a non-negative exponent");
  }

  return TEN ** exponent;
}

function validatePrecisionRequest(request: PrecisionRequest): void {
  if (!Number.isSafeInteger(request.significantDigits) || request.significantDigits < 1) {
    throw new InternalCalculationException("PrecisionRequest.significantDigits must be positive");
  }
}
