import { InternalCalculationException } from "../errors/index.js";
import type { Rational } from "../values/contracts.js";
import { compareRational, createRational } from "../values/rational.js";

const ZERO = 0n;
const TEN = 10n;

/** An outward integer interval representing [lower / 10^scaleDigits, upper / 10^scaleDigits]. */
export interface ScaledInterval {
  readonly lower: bigint;
  readonly upper: bigint;
  readonly scaleDigits: number;
}

export interface RationalBounds {
  readonly lower: Rational;
  readonly upper: Rational;
}

export function createScaledInterval(
  lower: bigint,
  upper: bigint,
  scaleDigits: number
): ScaledInterval {
  assertScaleDigits(scaleDigits);
  if (lower > upper) {
    throw new InternalCalculationException("Scaled interval lower bound exceeds upper bound");
  }

  return Object.freeze({ lower, upper, scaleDigits });
}

export function scaledIntervalFromRationalBounds(
  bounds: RationalBounds,
  scaleDigits: number
): ScaledInterval {
  if (compareRational(bounds.lower, bounds.upper) > 0) {
    throw new InternalCalculationException("Rational bounds are reversed");
  }

  const scale = decimalScale(scaleDigits);
  return createScaledInterval(
    floorDiv(bounds.lower.numerator * scale, bounds.lower.denominator),
    ceilDiv(bounds.upper.numerator * scale, bounds.upper.denominator),
    scaleDigits
  );
}

export function scaledIntervalToRationalBounds(interval: ScaledInterval): RationalBounds {
  const scale = decimalScale(interval.scaleDigits);
  return Object.freeze({
    lower: createRational(interval.lower, scale),
    upper: createRational(interval.upper, scale)
  });
}

export function rescaleScaled(interval: ScaledInterval, targetScaleDigits: number): ScaledInterval {
  assertScaleDigits(targetScaleDigits);
  if (targetScaleDigits === interval.scaleDigits) {
    return interval;
  }

  if (targetScaleDigits > interval.scaleDigits) {
    const factor = decimalScale(targetScaleDigits - interval.scaleDigits);
    return createScaledInterval(
      interval.lower * factor,
      interval.upper * factor,
      targetScaleDigits
    );
  }

  const divisor = decimalScale(interval.scaleDigits - targetScaleDigits);
  return createScaledInterval(
    floorDiv(interval.lower, divisor),
    ceilDiv(interval.upper, divisor),
    targetScaleDigits
  );
}

export function mulScaled(
  left: ScaledInterval,
  right: ScaledInterval,
  targetScaleDigits: number
): ScaledInterval {
  const products = [
    left.lower * right.lower,
    left.lower * right.upper,
    left.upper * right.lower,
    left.upper * right.upper
  ];
  const exactProductScale = left.scaleDigits + right.scaleDigits;
  const exactProduct = createScaledInterval(
    minBigInt(products),
    maxBigInt(products),
    exactProductScale
  );

  return rescaleScaled(exactProduct, targetScaleDigits);
}

export function squareScaled(interval: ScaledInterval, targetScaleDigits: number): ScaledInterval {
  if (interval.lower <= ZERO && interval.upper >= ZERO) {
    const magnitude = maxBigInt([absBigInt(interval.lower), absBigInt(interval.upper)]);
    return rescaleScaled(
      createScaledInterval(ZERO, magnitude * magnitude, interval.scaleDigits * 2),
      targetScaleDigits
    );
  }

  const lowerMagnitude = minBigInt([absBigInt(interval.lower), absBigInt(interval.upper)]);
  const upperMagnitude = maxBigInt([absBigInt(interval.lower), absBigInt(interval.upper)]);
  return rescaleScaled(
    createScaledInterval(
      lowerMagnitude * lowerMagnitude,
      upperMagnitude * upperMagnitude,
      interval.scaleDigits * 2
    ),
    targetScaleDigits
  );
}

export function divScaled(
  numerator: ScaledInterval,
  denominator: ScaledInterval,
  targetScaleDigits: number
): ScaledInterval {
  assertScaleDigits(targetScaleDigits);
  if (denominator.lower <= ZERO && denominator.upper >= ZERO) {
    throw new InternalCalculationException("Cannot divide by a scaled interval containing zero");
  }

  const targetScale = decimalScale(targetScaleDigits);
  const numeratorScale = decimalScale(numerator.scaleDigits);
  const denominatorScale = decimalScale(denominator.scaleDigits);
  const endpoints = [
    [numerator.lower, denominator.lower],
    [numerator.lower, denominator.upper],
    [numerator.upper, denominator.lower],
    [numerator.upper, denominator.upper]
  ] as const;
  const lowerCandidates: bigint[] = [];
  const upperCandidates: bigint[] = [];

  for (const [numeratorEndpoint, denominatorEndpoint] of endpoints) {
    let scaledNumerator = numeratorEndpoint * denominatorScale * targetScale;
    let scaledDenominator = denominatorEndpoint * numeratorScale;
    if (scaledDenominator < ZERO) {
      scaledNumerator = -scaledNumerator;
      scaledDenominator = -scaledDenominator;
    }
    lowerCandidates.push(floorDiv(scaledNumerator, scaledDenominator));
    upperCandidates.push(ceilDiv(scaledNumerator, scaledDenominator));
  }

  return createScaledInterval(
    minBigInt(lowerCandidates),
    maxBigInt(upperCandidates),
    targetScaleDigits
  );
}

export function decimalScale(scaleDigits: number): bigint {
  assertScaleDigits(scaleDigits);
  return TEN ** BigInt(scaleDigits);
}

export function floorDiv(numerator: bigint, positiveDenominator: bigint): bigint {
  if (positiveDenominator <= ZERO) {
    throw new InternalCalculationException("floorDiv requires a positive denominator");
  }

  const quotient = numerator / positiveDenominator;
  const remainder = numerator % positiveDenominator;
  return remainder !== ZERO && numerator < ZERO ? quotient - 1n : quotient;
}

export function ceilDiv(numerator: bigint, positiveDenominator: bigint): bigint {
  if (positiveDenominator <= ZERO) {
    throw new InternalCalculationException("ceilDiv requires a positive denominator");
  }

  const quotient = numerator / positiveDenominator;
  const remainder = numerator % positiveDenominator;
  return remainder !== ZERO && numerator > ZERO ? quotient + 1n : quotient;
}

function assertScaleDigits(scaleDigits: number): void {
  if (!Number.isSafeInteger(scaleDigits) || scaleDigits < 0) {
    throw new InternalCalculationException("Scaled interval digits must be non-negative and safe");
  }
}

function minBigInt(values: readonly bigint[]): bigint {
  const first = values[0];
  if (first === undefined) {
    throw new InternalCalculationException("minBigInt requires at least one value");
  }
  let result = first;
  for (const value of values.slice(1)) {
    if (value < result) result = value;
  }
  return result;
}

function maxBigInt(values: readonly bigint[]): bigint {
  const first = values[0];
  if (first === undefined) {
    throw new InternalCalculationException("maxBigInt requires at least one value");
  }
  let result = first;
  for (const value of values.slice(1)) {
    if (value > result) result = value;
  }
  return result;
}

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}
