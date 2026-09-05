import { internalFloatToRational } from "../backend/index.js";
import type { BigFloatBackend } from "../backend/index.js";
import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint, EvaluationContext } from "../evaluation/contracts.js";
import { getPiRationalInterval } from "./constants.js";
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
  negateRational,
  powRational,
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
const DEFAULT_INTERVAL_GUARD_DIGITS = 8;
const MIN_GAMMA_STIRLING_ARGUMENT = 64;
const BERNOULLI_CACHE = new Map<number, Rational>([[0, RATIONAL_ONE]]);

export interface RationalInterval {
  readonly lower: Rational;
  readonly upper: Rational;
}

type MathComputationContext = EvaluationContext & EvaluationCheckpoint;

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

export function expRationalInterval(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);
  }

  if (signOfRational(value) < 0) {
    const positive = expRationalInterval(absRational(value), decimalDigits, control);

    return createRationalInterval(
      reciprocalRational(positive.upper),
      reciprocalRational(positive.lower)
    );
  }

  const reduction = reduceExpArgument(value, control);
  let result = expSmallNonNegativeInterval(
    reduction.value,
    decimalDigits + reduction.power + 8,
    control
  );

  for (let index = 0; index < reduction.power; index += 1) {
    control?.checkpoint();
    result = multiplyPositiveIntervals(result, result);
  }

  return result;
}

export function expBallInterval(
  argument: RationalInterval,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  const lower = expRationalInterval(argument.lower, decimalDigits, control);
  const upper = expRationalInterval(argument.upper, decimalDigits, control);

  return createRationalInterval(lower.lower, upper.upper);
}

export function lnPositiveRationalInterval(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  if (signOfRational(value) <= 0) {
    throw new InternalCalculationException("lnPositiveRationalInterval requires x > 0");
  }

  if (equalsRational(value, RATIONAL_ONE)) {
    return createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  }

  const reduction = reduceLnArgument(value, control);
  const reducedDigits = decimalDigits + absNumber(reduction.power) + 8;
  const reducedLog = lnReducedPositiveRationalInterval(reduction.value, reducedDigits, control);

  if (reduction.power === 0) {
    return reducedLog;
  }

  const lnTwo = lnReducedPositiveRationalInterval(integerRational(TWO), reducedDigits, control);

  return addIntervals(reducedLog, scaleIntervalByInteger(lnTwo, BigInt(reduction.power)));
}

export function lnPositiveInterval(
  argument: RationalInterval,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  const lower = lnPositiveRationalInterval(argument.lower, decimalDigits, control);
  const upper = lnPositiveRationalInterval(argument.upper, decimalDigits, control);

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
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  if (intervalSignLower(base) <= 0) {
    throw new InternalCalculationException("powPositiveInterval requires base > 0");
  }

  const logBase = lnPositiveInterval(base, decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS, control);
  const scaledExponent = multiplyIntervals(logBase, exponent);

  return expBallInterval(scaledExponent, decimalDigits, control);
}

export function gammaRealInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  const halfInteger = exactHalfIntegerGammaInterval(argument, decimalDigits, context);
  if (halfInteger !== null) {
    return halfInteger;
  }

  if (containsGammaPole(argument)) {
    return null;
  }

  const shift = gammaShiftToPositiveStirlingArgument(argument, decimalDigits);
  const shiftedArgument = addIntervalInteger(argument, BigInt(shift));
  let logGamma = logGammaPositiveStirlingInterval(shiftedArgument, decimalDigits, context);
  let recurrenceSign = 1;

  if (shift > 0) {
    let recurrenceMagnitude = createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);

    for (let index = 0; index < shift; index += 1) {
      context.checkpoint();
      const factor = addIntervalInteger(argument, BigInt(index));
      if (intervalContainsRational(factor, RATIONAL_ZERO)) {
        return null;
      }

      if (intervalSignUpper(factor) < 0) {
        recurrenceSign *= -1;
      }

      recurrenceMagnitude = multiplyIntervals(recurrenceMagnitude, absNonZeroInterval(factor));
    }

    const recurrenceLog = lnPositiveInterval(
      recurrenceMagnitude,
      decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS,
      context
    );
    logGamma = subtractIntervals(logGamma, recurrenceLog);
  }

  const magnitude = expBallInterval(logGamma, decimalDigits, context);

  return recurrenceSign > 0 ? magnitude : negateInterval(magnitude);
}

export function sinAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  return sinRadianInterval(
    toRadianInterval(argument, decimalDigits, angleMode, context),
    decimalDigits,
    context
  );
}

export function cosAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  return cosRadianInterval(
    toRadianInterval(argument, decimalDigits, angleMode, context),
    decimalDigits,
    context
  );
}

export function tanAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  return tanRadianInterval(
    toRadianInterval(argument, decimalDigits, angleMode, context),
    decimalDigits,
    context
  );
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

type TrigQuadrant = 0 | 1 | 2 | 3;

export interface TrigRangeReductionBranch {
  readonly reducedInterval: RationalInterval;
  readonly quadrant: TrigQuadrant;
  readonly sinSign: -1 | 1;
  readonly cosSign: -1 | 1;
  readonly swapSinCos: boolean;
  readonly polePossible: boolean;
}

export interface TrigRangeReduction {
  readonly branches: readonly TrigRangeReductionBranch[];
  readonly crossesQuadrantBoundary: boolean;
}

function sinRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context);
  return branches === null ? null : hullIntervals(branches.map((branch) => branch.sin));
}

function cosRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context);
  return branches === null ? null : hullIntervals(branches.map((branch) => branch.cos));
}

function tanRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context);
  if (branches === null) {
    return null;
  }

  const results: RationalInterval[] = [];
  for (const branch of branches) {
    context.checkpoint();
    if (intervalContainsRational(branch.cos, RATIONAL_ZERO)) {
      return null;
    }
    results.push(divideIntervals(branch.sin, branch.cos));
  }

  return hullIntervals(results);
}

function evaluateReducedSinCos(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): readonly { readonly sin: RationalInterval; readonly cos: RationalInterval }[] | null {
  const reduction = reduceRadianInterval(argument, decimalDigits, context);
  if (reduction === null) {
    return null;
  }

  return reduction.branches.map((branch) => {
    context.checkpoint();
    const base = sinCosCanonicalInterval(branch.reducedInterval, decimalDigits, context);
    const sinSource = branch.swapSinCos ? base.cos : base.sin;
    const cosSource = branch.swapSinCos ? base.sin : base.cos;

    return Object.freeze({
      sin: branch.sinSign < 0 ? negateInterval(sinSource) : sinSource,
      cos: branch.cosSign < 0 ? negateInterval(cosSource) : cosSource
    });
  });
}

function sinCosCanonicalInterval(
  reduced: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint
): { readonly sin: RationalInterval; readonly cos: RationalInterval } {
  const lowerSin = sinPointInterval(reduced.lower, decimalDigits, control);
  const upperSin = sinPointInterval(reduced.upper, decimalDigits, control);
  const lowerCos = cosPointInterval(reduced.lower, decimalDigits, control);
  const upperCos = cosPointInterval(reduced.upper, decimalDigits, control);
  const cosineEndpoints = [lowerCos.lower, lowerCos.upper, upperCos.lower, upperCos.upper];

  return Object.freeze({
    sin: createRationalInterval(lowerSin.lower, upperSin.upper),
    cos: createRationalInterval(
      minRational(cosineEndpoints),
      intervalContainsRational(reduced, RATIONAL_ZERO) ? RATIONAL_ONE : maxRational(cosineEndpoints)
    )
  });
}

function toRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval {
  if (angleMode === "radians") {
    return argument;
  }

  const pi = getPiRationalInterval(
    context,
    decimalDigits + decimalMagnitudeUpperBound(argument) + 12
  );
  return divideIntervalByInteger(multiplyIntervals(argument, pi), 180n);
}

export function reduceRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): TrigRangeReduction | null {
  const pi = getPiRationalInterval(
    context,
    decimalDigits + decimalMagnitudeUpperBound(argument) + 12
  );
  const halfPi = divideIntervalByInteger(pi, TWO);
  const safeHalfPiMagnitude = halfPi.lower;
  // Keeping an already-small interval unchanged avoids injecting avoidable π uncertainty.
  // Arguments outside this principal strip use the canonical π/2 quadrant reduction below.
  if (
    compareRational(argument.lower, negateRational(safeHalfPiMagnitude)) >= 0 &&
    compareRational(argument.upper, safeHalfPiMagnitude) <= 0
  ) {
    return Object.freeze({
      branches: Object.freeze([
        Object.freeze({
          reducedInterval: argument,
          quadrant: 0,
          sinSign: 1,
          cosSign: 1,
          swapSinCos: false,
          polePossible: false
        })
      ]),
      crossesQuadrantBoundary: false
    });
  }

  const quotient = divideIntervals(argument, halfPi);
  const half = createRational(ONE, TWO);
  const firstCandidate = ceilRational(subtractRational(quotient.lower, half));
  const lastCandidate = floorRational(addRational(quotient.upper, half));

  if (lastCandidate < firstCandidate || lastCandidate - firstCandidate > FOUR) {
    return null;
  }

  const quarterPiMagnitude = divideRational(pi.upper, integerRational(FOUR));
  const canonicalDomain = createRationalInterval(
    negateRational(quarterPiMagnitude),
    quarterPiMagnitude
  );
  const branches: TrigRangeReductionBranch[] = [];

  for (let multiple = firstCandidate; multiple <= lastCandidate; multiple += ONE) {
    context.checkpoint();
    const rawReduced = subtractIntervals(argument, scaleIntervalByInteger(halfPi, multiple));
    const reducedInterval = intersectIntervals(rawReduced, canonicalDomain);
    if (reducedInterval === null) {
      continue;
    }

    const quadrant = Number(moduloBigInt(multiple, FOUR)) as TrigQuadrant;
    const metadata = quadrantMetadata(quadrant);
    branches.push(
      Object.freeze({
        reducedInterval,
        quadrant,
        ...metadata,
        polePossible:
          (quadrant === 1 || quadrant === 3) &&
          intervalContainsRational(reducedInterval, RATIONAL_ZERO)
      })
    );
  }

  if (branches.length === 0) {
    return null;
  }

  return Object.freeze({
    branches: Object.freeze(branches),
    crossesQuadrantBoundary: branches.length > 1
  });
}

function quadrantMetadata(
  quadrant: TrigQuadrant
): Pick<TrigRangeReductionBranch, "sinSign" | "cosSign" | "swapSinCos"> {
  switch (quadrant) {
    case 0:
      return Object.freeze({ sinSign: 1, cosSign: 1, swapSinCos: false });
    case 1:
      return Object.freeze({ sinSign: 1, cosSign: -1, swapSinCos: true });
    case 2:
      return Object.freeze({ sinSign: -1, cosSign: -1, swapSinCos: false });
    case 3:
      return Object.freeze({ sinSign: -1, cosSign: 1, swapSinCos: true });
  }
}

function logGammaPositiveStirlingInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval {
  if (intervalSignLower(argument) <= 0) {
    throw new InternalCalculationException("logGammaPositiveStirlingInterval requires z > 0");
  }

  const workingDigits = decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS;
  const half = createRational(ONE, TWO);
  const oneHalfLnTwoPi = divideIntervalByInteger(
    lnPositiveInterval(
      scaleIntervalByInteger(getPiRationalInterval(context, workingDigits + 8), TWO),
      workingDigits,
      context
    ),
    TWO
  );
  const logArgument = lnPositiveInterval(argument, workingDigits, context);
  let logGamma = addIntervals(
    subtractIntervals(
      multiplyIntervals(subtractIntervalRational(argument, half), logArgument),
      argument
    ),
    oneHalfLnTwoPi
  );
  const series = stirlingCorrectionInterval(argument, workingDigits, context);
  logGamma = addIntervals(logGamma, series.sum);
  logGamma = widenInterval(logGamma, series.remainder);

  return logGamma;
}

function exactHalfIntegerGammaInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  if (!equalsRational(argument.lower, argument.upper)) {
    return null;
  }

  const doubled = multiplyRational(argument.lower, integerRational(TWO));
  if (doubled.denominator !== ONE || doubled.numerator % TWO === 0n) {
    return null;
  }

  const half = createRational(ONE, TWO);
  let current = argument.lower;
  let multiplier = RATIONAL_ONE;

  while (compareRational(current, half) > 0) {
    context.checkpoint();
    current = subtractRational(current, RATIONAL_ONE);
    multiplier = multiplyRational(multiplier, current);
  }

  while (compareRational(current, half) < 0) {
    context.checkpoint();
    multiplier = divideRational(multiplier, current);
    current = addRational(current, RATIONAL_ONE);
  }

  const sqrtPi = powPositiveInterval(
    getPiRationalInterval(context, decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS),
    createRationalInterval(half, half),
    decimalDigits,
    context
  );

  return multiplyIntervalByRational(sqrtPi, multiplier);
}

function stirlingCorrectionInterval(
  argument: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint
): { readonly sum: RationalInterval; readonly remainder: Rational } {
  let sum = createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  const threshold = createRational(ONE, powerOfTen(decimalDigits));
  let index = 1;

  for (;;) {
    control.checkpoint();
    const bernoulli = bernoulliNumber(2 * index);
    const denominator = BigInt(2 * index * (2 * index - 1));
    const coefficient = divideRational(bernoulli, integerRational(denominator));
    const power = 2 * index - 1;

    sum = addIntervals(sum, divideIntervalByPositivePower(coefficient, argument, power));

    const nextIndex = index + 1;
    const nextBernoulli = absRational(bernoulliNumber(2 * nextIndex));
    const nextDenominator = BigInt(2 * nextIndex * (2 * nextIndex - 1));
    const nextPower = 2 * nextIndex - 1;
    const remainder = divideRational(
      nextBernoulli,
      multiplyRational(
        integerRational(nextDenominator),
        powRational(argument.lower, BigInt(nextPower))
      )
    );

    if (compareRational(remainder, threshold) <= 0) {
      return Object.freeze({ sum, remainder });
    }

    index += 1;
  }
}

function sinPointInterval(
  value: Rational,
  decimalDigits: number,
  control: EvaluationCheckpoint
): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO);
  }

  return alternatingTaylorPointInterval(value, decimalDigits, "sin", control);
}

function cosPointInterval(
  value: Rational,
  decimalDigits: number,
  control: EvaluationCheckpoint
): RationalInterval {
  if (isZeroRational(value)) {
    return createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);
  }

  return alternatingTaylorPointInterval(value, decimalDigits, "cos", control);
}

function alternatingTaylorPointInterval(
  value: Rational,
  decimalDigits: number,
  operation: "sin" | "cos",
  control: EvaluationCheckpoint
): RationalInterval {
  const xSquared = multiplyRational(value, value);
  let term = operation === "sin" ? value : RATIONAL_ONE;
  let sum = term;
  const threshold = createRational(ONE, powerOfTen(decimalDigits));

  let index = 0;
  for (;;) {
    control.checkpoint();
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
    index += 1;
  }
}

function reduceExpArgument(
  value: Rational,
  control?: EvaluationCheckpoint
): { readonly value: Rational; readonly power: number } {
  let reduced = value;
  let power = 0;
  const limit = createRational(ONE, FOUR);

  while (compareRational(reduced, limit) > 0) {
    control?.checkpoint();
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

function expSmallNonNegativeInterval(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): RationalInterval {
  const scale = powerOfTen(decimalDigits);
  const valueLower = rationalToScaledFloor(value, scale);
  const valueUpper = rationalToScaledCeil(value, scale);
  let sumLower = scale;
  let sumUpper = scale;
  let termLower = scale;
  let termUpper = scale;

  let index = 1;
  for (;;) {
    control?.checkpoint();
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

    index += 1;
  }
}

function reduceLnArgument(
  value: Rational,
  control?: EvaluationCheckpoint
): { readonly value: Rational; readonly power: number } {
  let reduced = value;
  let power = 0;
  const half = createRational(ONE, TWO);
  const two = integerRational(TWO);

  while (compareRational(reduced, two) > 0) {
    control?.checkpoint();
    reduced = divideRational(reduced, two);
    power += 1;
  }

  while (compareRational(reduced, half) < 0) {
    control?.checkpoint();
    reduced = multiplyRational(reduced, two);
    power -= 1;
  }

  return Object.freeze({ value: reduced, power });
}

function lnReducedPositiveRationalInterval(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
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

  let index = 0;
  for (;;) {
    control?.checkpoint();
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
    index += 1;
  }
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

function intersectIntervals(
  left: RationalInterval,
  right: RationalInterval
): RationalInterval | null {
  const lower = maxRational([left.lower, right.lower]);
  const upper = minRational([left.upper, right.upper]);

  return compareRational(lower, upper) <= 0 ? createRationalInterval(lower, upper) : null;
}

function hullIntervals(intervals: readonly RationalInterval[]): RationalInterval {
  if (intervals.length === 0) {
    throw new InternalCalculationException("Cannot create an interval hull without branches");
  }

  return createRationalInterval(
    minRational(intervals.map((interval) => interval.lower)),
    maxRational(intervals.map((interval) => interval.upper))
  );
}

function negateInterval(interval: RationalInterval): RationalInterval {
  return createRationalInterval(negateRational(interval.upper), negateRational(interval.lower));
}

function absNonZeroInterval(interval: RationalInterval): RationalInterval {
  if (intervalContainsRational(interval, RATIONAL_ZERO)) {
    throw new InternalCalculationException("Cannot take absolute interval across zero");
  }

  return intervalSignUpper(interval) < 0 ? negateInterval(interval) : interval;
}

function scaleIntervalByInteger(interval: RationalInterval, factor: bigint): RationalInterval {
  const lower = multiplyRational(interval.lower, integerRational(factor));
  const upper = multiplyRational(interval.upper, integerRational(factor));

  return factor >= ZERO
    ? createRationalInterval(lower, upper)
    : createRationalInterval(upper, lower);
}

function multiplyIntervalByRational(
  interval: RationalInterval,
  factor: Rational
): RationalInterval {
  const lower = multiplyRational(interval.lower, factor);
  const upper = multiplyRational(interval.upper, factor);

  return signOfRational(factor) >= 0
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

function addIntervalInteger(interval: RationalInterval, value: bigint): RationalInterval {
  return addIntervals(
    interval,
    createRationalInterval(integerRational(value), integerRational(value))
  );
}

function subtractIntervalRational(interval: RationalInterval, value: Rational): RationalInterval {
  return subtractIntervals(interval, createRationalInterval(value, value));
}

function widenInterval(interval: RationalInterval, radius: Rational): RationalInterval {
  if (signOfRational(radius) < 0) {
    throw new InternalCalculationException("Cannot widen interval by a negative radius");
  }

  return createRationalInterval(
    subtractRational(interval.lower, radius),
    addRational(interval.upper, radius)
  );
}

function divideIntervalByPositivePower(
  numerator: Rational,
  denominator: RationalInterval,
  exponent: number
): RationalInterval {
  if (intervalSignLower(denominator) <= 0) {
    throw new InternalCalculationException("Positive-power interval denominator must be positive");
  }

  const denominatorLowerPower = powRational(denominator.lower, BigInt(exponent));
  const denominatorUpperPower = powRational(denominator.upper, BigInt(exponent));

  if (signOfRational(numerator) >= 0) {
    return createRationalInterval(
      divideRational(numerator, denominatorUpperPower),
      divideRational(numerator, denominatorLowerPower)
    );
  }

  return createRationalInterval(
    divideRational(numerator, denominatorLowerPower),
    divideRational(numerator, denominatorUpperPower)
  );
}

function gammaShiftToPositiveStirlingArgument(
  argument: RationalInterval,
  decimalDigits: number
): number {
  const target = BigInt(Math.max(MIN_GAMMA_STIRLING_ARGUMENT, decimalDigits + 8));
  const lowerFloor = floorRational(argument.lower);
  const shift = target - lowerFloor;

  if (shift <= ZERO) {
    return 0;
  }

  if (shift > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InternalCalculationException("Gamma argument shift exceeds safe internal bounds");
  }

  return Number(shift);
}

function containsGammaPole(interval: RationalInterval): boolean {
  if (compareRational(interval.lower, RATIONAL_ZERO) > 0) {
    return false;
  }

  return ceilRational(interval.lower) <= floorRational(interval.upper);
}

function bernoulliNumber(index: number): Rational {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new InternalCalculationException("Bernoulli index must be a non-negative safe integer");
  }

  const cached = BERNOULLI_CACHE.get(index);
  if (cached !== undefined) {
    return cached;
  }

  const coefficients: Rational[] = [];

  for (let outer = 0; outer <= index; outer += 1) {
    coefficients[outer] = createRational(ONE, BigInt(outer + 1));

    for (let inner = outer; inner >= 1; inner -= 1) {
      const left = coefficients[inner - 1];
      const right = coefficients[inner];
      if (left === undefined || right === undefined) {
        throw new InternalCalculationException("Bernoulli coefficient is missing");
      }

      coefficients[inner - 1] = multiplyRational(
        integerRational(BigInt(inner)),
        subtractRational(left, right)
      );
    }
  }

  const result = coefficients[0];
  if (result === undefined) {
    throw new InternalCalculationException("Bernoulli result is missing");
  }

  BERNOULLI_CACHE.set(index, result);

  return result;
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

function floorRational(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;

  return remainder !== ZERO && value.numerator < ZERO ? quotient - ONE : quotient;
}

function moduloBigInt(value: bigint, modulus: bigint): bigint {
  const remainder = value % modulus;

  return remainder < ZERO ? remainder + modulus : remainder;
}

function ceilRational(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;

  return remainder !== ZERO && value.numerator > ZERO ? quotient + ONE : quotient;
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
