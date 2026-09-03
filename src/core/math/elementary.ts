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
const FIVE = 5n;
const TEN = 10n;
const SIXTEEN = 16n;
const TWO_HUNDRED_THIRTY_NINE = 239n;
const TAIL_STOP_UNITS = 8n;
const MAX_REDUCTION_STEPS = 8192;
const MAX_SERIES_TERMS = 20000;
const DEFAULT_INTERVAL_GUARD_DIGITS = 8;

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

export function powPositiveInterval(
  base: RationalInterval,
  exponent: RationalInterval,
  decimalDigits: number
): RationalInterval {
  if (intervalSignLower(base) <= 0) {
    throw new InternalCalculationException("powPositiveInterval requires base > 0");
  }

  const logBase = lnPositiveInterval(base, decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS);
  const scaledExponent = multiplyIntervals(logBase, exponent);

  return expBallInterval(scaledExponent, decimalDigits);
}

export function sinAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees"
): RationalInterval {
  return sinRadianInterval(toRadianInterval(argument, decimalDigits, angleMode), decimalDigits);
}

export function cosAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees"
): RationalInterval {
  return cosRadianInterval(toRadianInterval(argument, decimalDigits, angleMode), decimalDigits);
}

export function tanAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees"
): RationalInterval | null {
  return tanRadianInterval(toRadianInterval(argument, decimalDigits, angleMode), decimalDigits);
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

function sinRadianInterval(argument: RationalInterval, decimalDigits: number): RationalInterval {
  const reduced = reduceRadianIntervalNearZero(argument, decimalDigits);
  const strip = principalStrip(reduced, decimalDigits);

  if (!strip.inside) {
    return createRationalInterval(integerRational(-ONE), RATIONAL_ONE);
  }

  const lower = sinPointInterval(reduced.lower, decimalDigits);
  const upper = sinPointInterval(reduced.upper, decimalDigits);

  return createRationalInterval(lower.lower, upper.upper);
}

function cosRadianInterval(argument: RationalInterval, decimalDigits: number): RationalInterval {
  const reduced = reduceRadianIntervalNearZero(argument, decimalDigits);
  const strip = principalStrip(reduced, decimalDigits);

  if (!strip.inside) {
    return createRationalInterval(integerRational(-ONE), RATIONAL_ONE);
  }

  const lowerEndpoint = cosPointInterval(reduced.lower, decimalDigits);
  const upperEndpoint = cosPointInterval(reduced.upper, decimalDigits);
  const lower = minRational([
    lowerEndpoint.lower,
    lowerEndpoint.upper,
    upperEndpoint.lower,
    upperEndpoint.upper
  ]);
  const upper = intervalContainsRational(reduced, RATIONAL_ZERO)
    ? RATIONAL_ONE
    : maxRational([
        lowerEndpoint.lower,
        lowerEndpoint.upper,
        upperEndpoint.lower,
        upperEndpoint.upper
      ]);

  return createRationalInterval(lower, upper);
}

function tanRadianInterval(
  argument: RationalInterval,
  decimalDigits: number
): RationalInterval | null {
  const reduced = reduceRadianIntervalNearZero(argument, decimalDigits);
  const strip = principalStrip(reduced, decimalDigits);

  if (!strip.strictInside) {
    return null;
  }

  const lowerCos = cosPointInterval(reduced.lower, decimalDigits);
  const upperCos = cosPointInterval(reduced.upper, decimalDigits);

  if (
    intervalContainsRational(lowerCos, RATIONAL_ZERO) ||
    intervalContainsRational(upperCos, RATIONAL_ZERO)
  ) {
    return null;
  }

  const lower = divideIntervals(sinPointInterval(reduced.lower, decimalDigits), lowerCos);
  const upper = divideIntervals(sinPointInterval(reduced.upper, decimalDigits), upperCos);

  return createRationalInterval(
    minRational([lower.lower, lower.upper, upper.lower, upper.upper]),
    maxRational([lower.lower, lower.upper, upper.lower, upper.upper])
  );
}

function toRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees"
): RationalInterval {
  if (angleMode === "radians") {
    return argument;
  }

  const pi = piRationalInterval(decimalDigits + decimalMagnitudeUpperBound(argument) + 12);
  return divideIntervalByInteger(multiplyIntervals(argument, pi), 180n);
}

function reduceRadianIntervalNearZero(
  argument: RationalInterval,
  decimalDigits: number
): RationalInterval {
  const pi = piRationalInterval(decimalDigits + decimalMagnitudeUpperBound(argument) + 12);
  const midpoint = divideRational(
    addRational(argument.lower, argument.upper),
    integerRational(TWO)
  );
  const piMidpoint = divideRational(addRational(pi.lower, pi.upper), integerRational(TWO));
  const multiple = nearestIntegerRational(divideRational(midpoint, piMidpoint));
  const multipleOfPi = scaleIntervalByInteger(pi, multiple);

  return subtractIntervals(argument, multipleOfPi);
}

function principalStrip(
  interval: RationalInterval,
  decimalDigits: number
): { readonly inside: boolean; readonly strictInside: boolean } {
  const pi = piRationalInterval(decimalDigits + 12);
  const halfPiLower = divideRational(pi.lower, integerRational(TWO));
  const negativeHalfPiLower = createRational(-halfPiLower.numerator, halfPiLower.denominator);
  const inside =
    compareRational(interval.lower, negativeHalfPiLower) >= 0 &&
    compareRational(interval.upper, halfPiLower) <= 0;

  return Object.freeze({
    inside,
    strictInside:
      compareRational(interval.lower, negativeHalfPiLower) > 0 &&
      compareRational(interval.upper, halfPiLower) < 0
  });
}

function sinPointInterval(value: Rational, decimalDigits: number): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  }

  return alternatingTaylorPointInterval(value, decimalDigits, "sin");
}

function cosPointInterval(value: Rational, decimalDigits: number): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);
  }

  return alternatingTaylorPointInterval(value, decimalDigits, "cos");
}

function alternatingTaylorPointInterval(
  value: Rational,
  decimalDigits: number,
  operation: "sin" | "cos"
): RationalInterval {
  const xSquared = multiplyRational(value, value);
  let term = operation === "sin" ? value : RATIONAL_ONE;
  let sum = term;
  const threshold = createRational(ONE, powerOfTen(decimalDigits));

  for (let index = 0; index <= MAX_SERIES_TERMS; index += 1) {
    const first = operation === "sin" ? TWO * BigInt(index + 1) : TWO * BigInt(index) + ONE;
    const second = first + ONE;
    const nextTerm = divideRational(
      multiplyRational(createRational(-term.numerator, term.denominator), xSquared),
      integerRational(first * second)
    );
    const tail = absRational(nextTerm);

    if (compareRational(tail, threshold) <= 0) {
      return createRationalInterval(subtractRational(sum, tail), addRational(sum, tail));
    }

    term = nextTerm;
    sum = addRational(sum, term);
  }

  throw new InternalCalculationException(`${operation} series exceeded internal term limit`);
}

function piRationalInterval(decimalDigits: number): RationalInterval {
  const digits = Math.max(1, decimalDigits);
  const scale = powerOfTen(digits);
  const atanOneFifth = atanReciprocalScaledInterval(FIVE, digits + 8, scale);
  const atanOneOver239 = atanReciprocalScaledInterval(TWO_HUNDRED_THIRTY_NINE, digits + 8, scale);

  return createRationalInterval(
    createRational(SIXTEEN * atanOneFifth.lower - FOUR * atanOneOver239.upper, scale),
    createRational(SIXTEEN * atanOneFifth.upper - FOUR * atanOneOver239.lower, scale)
  );
}

function atanReciprocalScaledInterval(
  reciprocalDenominator: bigint,
  termCount: number,
  scale: bigint
): { readonly lower: bigint; readonly upper: bigint } {
  let lower = ZERO;
  let upper = ZERO;
  let powerDenominator = reciprocalDenominator;
  const denominatorStep = reciprocalDenominator * reciprocalDenominator;

  for (let index = 0; index < termCount; index += 1) {
    const termDenominator = powerDenominator * (TWO * BigInt(index) + ONE);
    const termLower = scale / termDenominator;
    const termUpper = ceilDiv(scale, termDenominator);

    if (index % 2 === 0) {
      lower += termLower;
      upper += termUpper;
    } else {
      lower -= termUpper;
      upper -= termLower;
    }

    powerDenominator *= denominatorStep;
  }

  const nextTermUpper = ceilDiv(scale, powerDenominator * (TWO * BigInt(termCount) + ONE));

  if (termCount % 2 === 0) {
    upper += nextTermUpper;
  } else {
    lower -= nextTermUpper;
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

function multiplyIntervals(left: RationalInterval, right: RationalInterval): RationalInterval {
  const candidates = [
    multiplyRational(left.lower, right.lower),
    multiplyRational(left.lower, right.upper),
    multiplyRational(left.upper, right.lower),
    multiplyRational(left.upper, right.upper)
  ];

  return createRationalInterval(minRational(candidates), maxRational(candidates));
}

function addIntervals(left: RationalInterval, right: RationalInterval): RationalInterval {
  return createRationalInterval(
    addRational(left.lower, right.lower),
    addRational(left.upper, right.upper)
  );
}

function subtractIntervals(left: RationalInterval, right: RationalInterval): RationalInterval {
  return createRationalInterval(
    subtractRational(left.lower, right.upper),
    subtractRational(left.upper, right.lower)
  );
}

function scaleIntervalByInteger(interval: RationalInterval, factor: bigint): RationalInterval {
  const lower = multiplyRational(interval.lower, integerRational(factor));
  const upper = multiplyRational(interval.upper, integerRational(factor));

  return factor >= ZERO
    ? createRationalInterval(lower, upper)
    : createRationalInterval(upper, lower);
}

function divideIntervalByInteger(interval: RationalInterval, divisor: bigint): RationalInterval {
  if (divisor === ZERO) {
    throw new InternalCalculationException("Cannot divide interval by zero");
  }

  const lower = divideRational(interval.lower, integerRational(divisor));
  const upper = divideRational(interval.upper, integerRational(divisor));

  return divisor > ZERO
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

function nearestIntegerRational(value: Rational): bigint {
  return floorRational(addRational(value, createRational(ONE, TWO)));
}

function floorRational(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;

  return remainder !== ZERO && value.numerator < ZERO ? quotient - ONE : quotient;
}

function decimalMagnitudeUpperBound(interval: RationalInterval): number {
  const magnitude = maxRational([absRational(interval.lower), absRational(interval.upper)]);

  if (isZeroRational(magnitude)) {
    return 0;
  }

  return Math.max(
    0,
    magnitude.numerator.toString().length - magnitude.denominator.toString().length + 2
  );
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
