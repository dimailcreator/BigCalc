import { internalFloatToRational } from "../backend/index.js";
import type { BigFloatBackend } from "../backend/index.js";
import { InternalCalculationException } from "../errors/index.js";
import { ballToOutwardInterval, createInternalInterval, intervalToBall } from "../values/ball.js";
import type { Ball, Rational, Sign } from "../values/contracts.js";
import {
  RATIONAL_ONE,
  RATIONAL_ZERO,
  absRational,
  addRational,
  compareRational,
  createRational,
  divideRational,
  equalsRational,
  integerRational,
  isZeroRational,
  multiplyRational,
  reciprocalRational,
  signOfRational,
  subtractRational
} from "../values/rational.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const FOUR = 4n;
const TEN = 10n;
const TAIL_STOP_UNITS = 8n;
const MAX_REDUCTION_STEPS = 8192;
const MAX_SERIES_TERMS = 20000;

export interface RationalInterval {
  readonly lower: Rational;
  readonly upper: Rational;
}

export function rationalIntervalFromBall(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): RationalInterval {
  const interval = ballToOutwardInterval(ball, precisionBits, backend);

  return createRationalInterval(
    internalFloatToRational(interval.lower),
    internalFloatToRational(interval.upper)
  );
}

export function intervalToRoundedBall(
  interval: RationalInterval,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  return intervalToBall(
    createInternalInterval(
      backend.fromRational(interval.lower, precisionBits, "towardNegativeInfinity"),
      backend.fromRational(interval.upper, precisionBits, "towardPositiveInfinity"),
      backend
    ),
    precisionBits,
    backend
  );
}

export function expRationalInterval(value: Rational, decimalDigits: number): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);
  }

  if (signOfRational(value) < 0) {
    const positive = expRationalInterval(absRational(value), decimalDigits);

    return createRationalInterval(
      reciprocalRational(positive.upper),
      reciprocalRational(positive.lower)
    );
  }

  const reduction = reduceExpArgument(value);
  let result = expSmallNonNegativeInterval(reduction.value, decimalDigits + reduction.power + 8);

  for (let index = 0; index < reduction.power; index += 1) {
    result = multiplyPositiveIntervals(result, result);
  }

  return result;
}

export function expBallInterval(
  argument: RationalInterval,
  decimalDigits: number
): RationalInterval {
  const lower = expRationalInterval(argument.lower, decimalDigits);
  const upper = expRationalInterval(argument.upper, decimalDigits);

  return createRationalInterval(lower.lower, upper.upper);
}

export function lnPositiveRationalInterval(
  value: Rational,
  decimalDigits: number
): RationalInterval {
  if (signOfRational(value) <= 0) {
    throw new InternalCalculationException("lnPositiveRationalInterval requires x > 0");
  }

  if (equalsRational(value, RATIONAL_ONE)) {
    return createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  }

  const reduction = reduceLnArgument(value);
  const reducedDigits = decimalDigits + absNumber(reduction.power) + 8;
  const reducedLog = lnReducedPositiveRationalInterval(reduction.value, reducedDigits);

  if (reduction.power === 0) {
    return reducedLog;
  }

  const lnTwo = lnReducedPositiveRationalInterval(integerRational(TWO), reducedDigits);

  return addIntervals(reducedLog, scaleIntervalByInteger(lnTwo, BigInt(reduction.power)));
}

export function lnPositiveInterval(
  argument: RationalInterval,
  decimalDigits: number
): RationalInterval {
  const lower = lnPositiveRationalInterval(argument.lower, decimalDigits);
  const upper = lnPositiveRationalInterval(argument.upper, decimalDigits);

  return createRationalInterval(lower.lower, upper.upper);
}

export function divideIntervals(
  numerator: RationalInterval,
  denominator: RationalInterval
): RationalInterval {
  if (intervalContainsRational(denominator, RATIONAL_ZERO)) {
    throw new InternalCalculationException("Cannot divide by an interval containing zero");
  }

  const candidates = [
    divideRational(numerator.lower, denominator.lower),
    divideRational(numerator.lower, denominator.upper),
    divideRational(numerator.upper, denominator.lower),
    divideRational(numerator.upper, denominator.upper)
  ];

  return createRationalInterval(minRational(candidates), maxRational(candidates));
}

export function intervalContainsRational(interval: RationalInterval, value: Rational): boolean {
  return compareRational(interval.lower, value) <= 0 && compareRational(interval.upper, value) >= 0;
}

export function intervalSignUpper(interval: RationalInterval): Sign {
  return signOfRational(interval.upper);
}

export function intervalSignLower(interval: RationalInterval): Sign {
  return signOfRational(interval.lower);
}

export function exactLogRational(base: Rational, argument: Rational): Rational | null {
  if (signOfRational(argument) <= 0) {
    throw new InternalCalculationException(
      "log argument domain must be checked before exactLogRational"
    );
  }

  if (signOfRational(base) <= 0 || equalsRational(base, RATIONAL_ONE)) {
    throw new InternalCalculationException(
      "log base domain must be checked before exactLogRational"
    );
  }

  if (equalsRational(argument, RATIONAL_ONE)) {
    return RATIONAL_ZERO;
  }

  return searchExactIntegerLog(base, argument);
}

export function createRationalInterval(lower: Rational, upper: Rational): RationalInterval {
  if (compareRational(lower, upper) > 0) {
    throw new InternalCalculationException(
      "Rational interval lower bound must not exceed upper bound"
    );
  }

  return Object.freeze({ lower, upper });
}

function reduceExpArgument(value: Rational): { readonly value: Rational; readonly power: number } {
  let reduced = value;
  let power = 0;
  const limit = createRational(ONE, FOUR);

  while (compareRational(reduced, limit) > 0) {
    if (power >= MAX_REDUCTION_STEPS) {
      throw new InternalCalculationException("exp argument reduction exceeded internal limit");
    }

    reduced = divideRational(reduced, integerRational(TWO));
    power += 1;
  }

  return Object.freeze({ value: reduced, power });
}

function searchExactIntegerLog(base: Rational, argument: Rational): Rational | null {
  const baseAboveOne = compareRational(base, RATIONAL_ONE) > 0;
  const argumentAboveOne = compareRational(argument, RATIONAL_ONE) > 0;
  let current = RATIONAL_ONE;

  for (let magnitude = 1; magnitude <= 512; magnitude += 1) {
    current =
      baseAboveOne === argumentAboveOne
        ? multiplyRational(current, base)
        : divideRational(current, base);

    const comparison = compareRational(current, argument);
    if (comparison === 0) {
      return integerRational(
        baseAboveOne === argumentAboveOne ? BigInt(magnitude) : -BigInt(magnitude)
      );
    }

    if (baseAboveOne === argumentAboveOne) {
      if ((baseAboveOne && comparison > 0) || (!baseAboveOne && comparison < 0)) {
        return null;
      }
    } else if ((baseAboveOne && comparison < 0) || (!baseAboveOne && comparison > 0)) {
      return null;
    }
  }

  return null;
}

function expSmallNonNegativeInterval(value: Rational, decimalDigits: number): RationalInterval {
  const scale = powerOfTen(decimalDigits);
  const valueLower = rationalToScaledFloor(value, scale);
  const valueUpper = rationalToScaledCeil(value, scale);
  let sumLower = scale;
  let sumUpper = scale;
  let termLower = scale;
  let termUpper = scale;

  for (let index = 1; index <= MAX_SERIES_TERMS; index += 1) {
    const divisor = BigInt(index);
    termLower = (termLower * valueLower) / scale / divisor;
    termUpper = ceilDiv(ceilDiv(termUpper * valueUpper, scale), divisor);
    sumLower += termLower;
    sumUpper += termUpper;

    const nextTermUpper = ceilDiv(ceilDiv(termUpper * valueUpper, scale), BigInt(index + 1));
    const tailUpper = TWO * nextTermUpper;

    if (tailUpper <= TAIL_STOP_UNITS) {
      return createRationalInterval(
        createRational(sumLower, scale),
        createRational(sumUpper + tailUpper, scale)
      );
    }
  }

  throw new InternalCalculationException("exp series exceeded internal term limit");
}

function reduceLnArgument(value: Rational): { readonly value: Rational; readonly power: number } {
  let reduced = value;
  let power = 0;
  const half = createRational(ONE, TWO);
  const two = integerRational(TWO);

  while (compareRational(reduced, two) > 0) {
    if (power >= MAX_REDUCTION_STEPS) {
      throw new InternalCalculationException("ln argument reduction exceeded internal limit");
    }

    reduced = divideRational(reduced, two);
    power += 1;
  }

  while (compareRational(reduced, half) < 0) {
    if (power <= -MAX_REDUCTION_STEPS) {
      throw new InternalCalculationException("ln argument reduction exceeded internal limit");
    }

    reduced = multiplyRational(reduced, two);
    power -= 1;
  }

  return Object.freeze({ value: reduced, power });
}

function lnReducedPositiveRationalInterval(
  value: Rational,
  decimalDigits: number
): RationalInterval {
  const z = divideRational(subtractRational(value, RATIONAL_ONE), addRational(value, RATIONAL_ONE));

  if (isZeroRational(z)) {
    return createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  }

  const sign = signOfRational(z);
  const zMagnitude = absRational(z);
  const scale = powerOfTen(decimalDigits);
  const zLower = rationalToScaledFloor(zMagnitude, scale);
  const zUpper = rationalToScaledCeil(zMagnitude, scale);
  const zSquared = multiplyScaledPositiveIntervals(
    { lower: zLower, upper: zUpper },
    { lower: zLower, upper: zUpper },
    scale
  );
  let power = { lower: zLower, upper: zUpper };
  let sumLower = ZERO;
  let sumUpper = ZERO;

  for (let index = 0; index <= MAX_SERIES_TERMS; index += 1) {
    const denominator = TWO * BigInt(index) + ONE;
    sumLower += power.lower / denominator;
    sumUpper += ceilDiv(power.upper, denominator);

    const nextPower = multiplyScaledPositiveIntervals(power, zSquared, scale);
    const nextDenominator = TWO * BigInt(index + 1) + ONE;
    const tailUpper = FOUR * ceilDiv(nextPower.upper, nextDenominator);

    if (tailUpper <= TAIL_STOP_UNITS) {
      const lowerMagnitude = TWO * sumLower;
      const upperMagnitude = TWO * sumUpper + tailUpper;

      return sign > 0
        ? createRationalInterval(
            createRational(lowerMagnitude, scale),
            createRational(upperMagnitude, scale)
          )
        : createRationalInterval(
            createRational(-upperMagnitude, scale),
            createRational(-lowerMagnitude, scale)
          );
    }

    power = nextPower;
  }

  throw new InternalCalculationException("ln series exceeded internal term limit");
}

function multiplyPositiveIntervals(
  left: RationalInterval,
  right: RationalInterval
): RationalInterval {
  return createRationalInterval(
    multiplyRational(left.lower, right.lower),
    multiplyRational(left.upper, right.upper)
  );
}

function addIntervals(left: RationalInterval, right: RationalInterval): RationalInterval {
  return createRationalInterval(
    addRational(left.lower, right.lower),
    addRational(left.upper, right.upper)
  );
}

function scaleIntervalByInteger(interval: RationalInterval, factor: bigint): RationalInterval {
  const lower = multiplyRational(interval.lower, integerRational(factor));
  const upper = multiplyRational(interval.upper, integerRational(factor));

  return factor >= ZERO
    ? createRationalInterval(lower, upper)
    : createRationalInterval(upper, lower);
}

function rationalToScaledFloor(value: Rational, scale: bigint): bigint {
  return (value.numerator * scale) / value.denominator;
}

function rationalToScaledCeil(value: Rational, scale: bigint): bigint {
  return ceilDiv(value.numerator * scale, value.denominator);
}

function multiplyScaledPositiveIntervals(
  left: { readonly lower: bigint; readonly upper: bigint },
  right: { readonly lower: bigint; readonly upper: bigint },
  scale: bigint
): { readonly lower: bigint; readonly upper: bigint } {
  return Object.freeze({
    lower: (left.lower * right.lower) / scale,
    upper: ceilDiv(left.upper * right.upper, scale)
  });
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder === ZERO ? quotient : quotient + ONE;
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 1) {
    throw new InternalCalculationException("powerOfTen requires positive safe digits");
  }

  return TEN ** BigInt(exponent);
}

function minRational(values: readonly Rational[]): Rational {
  const first = values[0];
  if (first === undefined) {
    throw new InternalCalculationException("minRational requires values");
  }

  let result = first;

  for (const value of values.slice(1)) {
    if (compareRational(value, result) < 0) {
      result = value;
    }
  }

  return result;
}

function maxRational(values: readonly Rational[]): Rational {
  const first = values[0];
  if (first === undefined) {
    throw new InternalCalculationException("maxRational requires values");
  }

  let result = first;

  for (const value of values.slice(1)) {
    if (compareRational(value, result) > 0) {
      result = value;
    }
  }

  return result;
}

function absNumber(value: number): number {
  return value < 0 ? -value : value;
}
