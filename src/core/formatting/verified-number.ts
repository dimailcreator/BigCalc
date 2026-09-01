import { internalFloatToRational } from "../backend/reference-backend.js";
import type { BigFloatBackend } from "../backend/contracts.js";
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
import type { EvaluationGraphContext, PrecisionRequest } from "../evaluation/index.js";
import type { VerifiedNumber } from "./contracts.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const FIVE = 5n;
const TEN = 10n;

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
    return verifiedFiniteDecimal(sign, terminating, request.significantDigits);
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
  backend: BigFloatBackend
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

  return verifiedNumberFromBall(await value.refine(request, context), request, context.backend);
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

function verifiedFiniteDecimal(
  sign: Sign,
  info: TerminatingDecimalInfo,
  requestedDigits: number
): VerifiedNumber {
  const digits =
    info.digits.length > requestedDigits ? info.digits.slice(0, requestedDigits) : info.digits;

  return Object.freeze({
    sign,
    digits,
    exponent10: info.exponent10,
    verifiedDigits: digits.length,
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
