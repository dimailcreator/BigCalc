import { internalFloatToRational } from "../backend/index.js";
import type { BigFloatBackend } from "../backend/index.js";
import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint, EvaluationContext } from "../evaluation/contracts.js";
import { getLn2RationalInterval, getPiRationalInterval } from "./constants.js";
import {
  createScaledInterval,
  decimalScale,
  divScaled,
  mulScaled,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds,
  squareScaled,
  type ScaledInterval
} from "./scaled-interval.js";
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
const EXP_RECONSTRUCTION_SAFETY_DIGITS = 10;
const LN_SCALE_SAFETY_DIGITS = 8;
const MAX_EXACT_LOG_DENOMINATOR = 16;
const LOG10_TWO = Math.LOG10E * Math.log(2);
const MIN_GAMMA_STIRLING_ARGUMENT = 64;
const BERNOULLI_CACHE = new Map<number, Rational>([[0, RATIONAL_ONE]]);

export interface RationalInterval {
  readonly lower: Rational;
  readonly upper: Rational;
}

export interface ExpIntervalProfile {
  readonly reductionPower: number;
  readonly workingScaleDigits: number;
  readonly squaringSteps: number;
  readonly peakEndpointDecimalDigits: number;
  readonly resultDenominatorDecimalDigits: number;
}

export interface LnIntervalProfile {
  readonly binaryScale: number;
  readonly scaleSelectionComparisons: number;
  readonly workingDigits: number;
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
  return expRationalIntervalWithProfile(value, decimalDigits, control).interval;
}

export function expRationalIntervalWithProfile(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): { readonly interval: RationalInterval; readonly profile: ExpIntervalProfile } {
  if (isZeroRational(value)) {
    return Object.freeze({
      interval: createRationalInterval(RATIONAL_ONE, RATIONAL_ONE),
      profile: createExpIntervalProfile(0, decimalDigits, 0, 1, 1)
    });
  }

  if (signOfRational(value) < 0) {
    const positive = expRationalIntervalWithProfile(absRational(value), decimalDigits, control);
    const scaleDigits = positive.profile.workingScaleDigits;
    const scale = decimalScale(scaleDigits);
    const reciprocal = divScaled(
      createScaledInterval(scale, scale, scaleDigits),
      scaledIntervalFromRationalBounds(positive.interval, scaleDigits),
      scaleDigits
    );
    const interval = scaledIntervalToRationalInterval(reciprocal);

    return Object.freeze({
      interval,
      profile: createExpIntervalProfile(
        positive.profile.reductionPower,
        scaleDigits,
        positive.profile.squaringSteps,
        maxScaledEndpointDecimalDigits(reciprocal),
        maxRationalDenominatorDecimalDigits(interval)
      )
    });
  }

  const reduction = reduceExpArgument(value, control);
  const workingScaleDigits =
    decimalDigits + Math.ceil(reduction.power * LOG10_TWO) + EXP_RECONSTRUCTION_SAFETY_DIGITS;
  let result = expSmallNonNegativeScaledInterval(reduction.value, workingScaleDigits, control);
  let peakEndpointDecimalDigits = maxScaledEndpointDecimalDigits(result);

  for (let index = 0; index < reduction.power; index += 1) {
    control?.checkpoint();
    // Every reconstruction step is rounded outward back to the same decimal scale.
    // This prevents the denominator from being squared at every step.
    result = squareScaled(result, workingScaleDigits);
    peakEndpointDecimalDigits = Math.max(
      peakEndpointDecimalDigits,
      maxScaledEndpointDecimalDigits(result)
    );
  }

  const interval = scaledIntervalToRationalInterval(result);
  return Object.freeze({
    interval,
    profile: createExpIntervalProfile(
      reduction.power,
      workingScaleDigits,
      reduction.power,
      peakEndpointDecimalDigits,
      maxRationalDenominatorDecimalDigits(interval)
    )
  });
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
  control?: MathComputationContext
): RationalInterval {
  return lnPositiveRationalIntervalWithProfile(value, decimalDigits, control).interval;
}

export function lnPositiveRationalIntervalWithProfile(
  value: Rational,
  decimalDigits: number,
  control?: MathComputationContext
): { readonly interval: RationalInterval; readonly profile: LnIntervalProfile } {
  if (signOfRational(value) <= 0) {
    throw new InternalCalculationException("lnPositiveRationalInterval requires x > 0");
  }

  if (equalsRational(value, RATIONAL_ONE)) {
    return Object.freeze({
      interval: createRationalInterval(RATIONAL_ZERO, RATIONAL_ZERO),
      profile: createLnIntervalProfile(0, 0, decimalDigits)
    });
  }

  const reduction = reduceLnArgument(value, control);
  const reducedDigits =
    decimalDigits + decimalDigitsForIntegerMagnitude(reduction.power) + LN_SCALE_SAFETY_DIGITS;
  const reducedLog = lnReducedPositiveRationalInterval(reduction.value, reducedDigits, control);

  if (reduction.power === 0) {
    return Object.freeze({
      interval: reducedLog,
      profile: createLnIntervalProfile(
        reduction.power,
        reduction.scaleSelectionComparisons,
        reducedDigits
      )
    });
  }

  const lnTwo =
    control === undefined
      ? lnReducedPositiveRationalInterval(integerRational(TWO), reducedDigits)
      : getLn2RationalInterval(control, reducedDigits);

  const interval = addIntervals(reducedLog, scaleIntervalByInteger(lnTwo, BigInt(reduction.power)));
  return Object.freeze({
    interval,
    profile: createLnIntervalProfile(
      reduction.power,
      reduction.scaleSelectionComparisons,
      reducedDigits
    )
  });
}

export function lnPositiveInterval(
  argument: RationalInterval,
  decimalDigits: number,
  control?: MathComputationContext
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
  control?: MathComputationContext
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
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context);
  return sinRadianInterval(radians.interval, decimalDigits, context, radians.pi);
}

export function cosAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context);
  return cosRadianInterval(radians.interval, decimalDigits, context, radians.pi);
}

export function tanAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context);
  return tanRadianInterval(radians.interval, decimalDigits, context, radians.pi);
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

  const integerLog = searchExactIntegerLog(base, argument);
  if (integerLog !== null) {
    return integerLog;
  }

  if (!isCheapExactFractionalLogCandidate(base, argument)) {
    return null;
  }

  // This is intentionally a small, local exact path rather than a symbolic
  // factorisation engine: argument^q = base^p proves log_base(argument) = p/q.
  let argumentPower = argument;
  for (let denominator = 2; denominator <= MAX_EXACT_LOG_DENOMINATOR; denominator += 1) {
    argumentPower = multiplyRational(argumentPower, argument);
    const numerator = searchExactIntegerLog(base, argumentPower);
    if (numerator !== null) {
      return createRational(numerator.numerator, BigInt(denominator));
    }
  }

  return null;
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

export interface SinCosIntervals {
  readonly sinInterval: RationalInterval;
  readonly cosInterval: RationalInterval;
}

export interface TrigSeriesProfile {
  readonly rangeReductionCalls: number;
  readonly sincosIntervalEvaluations: number;
  readonly pointEvaluations: number;
  readonly sharedSquareEvaluations: number;
  readonly independentSeriesEvaluations: number;
  readonly scaleDigits: number;
  readonly peakBigIntDecimalDigits: number;
  readonly resultDenominatorDecimalDigits: number;
}

interface MutableTrigSeriesProfile {
  rangeReductionCalls: number;
  sincosIntervalEvaluations: number;
  pointEvaluations: number;
  sharedSquareEvaluations: number;
  independentSeriesEvaluations: number;
  scaleDigits: number;
  peakBigIntDecimalDigits: number;
}

interface ReducedSinCosBranch {
  readonly sin: RationalInterval;
  readonly cos: RationalInterval;
  readonly polePossible: boolean;
}

interface RadianConversion {
  readonly interval: RationalInterval;
  readonly pi?: RationalInterval;
}

function sinRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context, pi, profile);
  return branches === null ? null : hullIntervals(branches.map((branch) => branch.sin));
}

function cosRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context, pi, profile);
  return branches === null ? null : hullIntervals(branches.map((branch) => branch.cos));
}

function tanRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  const branches = evaluateReducedSinCos(argument, decimalDigits, context, pi, profile, true);
  if (branches === null) {
    return null;
  }

  const results: RationalInterval[] = [];
  for (const branch of branches) {
    context.checkpoint();
    if (branch.polePossible || intervalContainsRational(branch.cos, RATIONAL_ZERO)) {
      return null;
    }
    results.push(divideIntervals(branch.sin, branch.cos));
  }

  return hullIntervals(results);
}

function evaluateReducedSinCos(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile,
  rejectPoleBranches = false
): readonly ReducedSinCosBranch[] | null {
  if (profile !== undefined) {
    profile.rangeReductionCalls += 1;
  }
  const reduction = reduceRadianInterval(argument, decimalDigits, context, pi);
  if (reduction === null) {
    return null;
  }
  if (rejectPoleBranches && reduction.branches.some((branch) => branch.polePossible)) {
    return null;
  }

  return reduction.branches.map((branch) => {
    context.checkpoint();
    const base = sincosSmallIntervalInternal(
      branch.reducedInterval,
      decimalDigits,
      context,
      profile
    );
    const sinSource = branch.swapSinCos ? base.cosInterval : base.sinInterval;
    const cosSource = branch.swapSinCos ? base.sinInterval : base.cosInterval;

    return Object.freeze({
      sin: branch.sinSign < 0 ? negateInterval(sinSource) : sinSource,
      cos: branch.cosSign < 0 ? negateInterval(cosSource) : cosSource,
      polePossible: branch.polePossible
    });
  });
}

export function sincosSmallInterval(
  reduced: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint
): SinCosIntervals {
  return sincosSmallIntervalInternal(reduced, decimalDigits, control);
}

function sincosSmallIntervalInternal(
  reduced: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  profile?: MutableTrigSeriesProfile
): SinCosIntervals {
  if (
    compareRational(reduced.lower, integerRational(-1n)) < 0 ||
    compareRational(reduced.upper, RATIONAL_ONE) > 0
  ) {
    throw new InternalCalculationException("sincosSmallInterval requires x in [-1, 1]");
  }

  if (profile !== undefined) {
    profile.sincosIntervalEvaluations += 1;
  }
  const lower = sincosSmallPointInterval(reduced.lower, decimalDigits, control, profile);
  const upper = equalsRational(reduced.lower, reduced.upper)
    ? lower
    : sincosSmallPointInterval(reduced.upper, decimalDigits, control, profile);
  const cosineEndpoints = [
    lower.cosInterval.lower,
    lower.cosInterval.upper,
    upper.cosInterval.lower,
    upper.cosInterval.upper
  ];

  return Object.freeze({
    sinInterval: createRationalInterval(lower.sinInterval.lower, upper.sinInterval.upper),
    cosInterval: createRationalInterval(
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
): RadianConversion {
  if (angleMode === "radians") {
    return Object.freeze({ interval: argument });
  }

  const pi = getPiRationalInterval(
    context,
    decimalDigits + decimalMagnitudeUpperBound(argument) + 12
  );
  return Object.freeze({
    interval: divideIntervalByInteger(multiplyIntervals(argument, pi), 180n),
    pi
  });
}

export function reduceRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  sharedPi?: RationalInterval
): TrigRangeReduction | null {
  const pi =
    sharedPi ??
    getPiRationalInterval(context, decimalDigits + decimalMagnitudeUpperBound(argument) + 12);
  const halfPi = divideIntervalByInteger(pi, TWO);
  const safeQuarterPiMagnitude = divideRational(pi.lower, integerRational(FOUR));
  // Keeping an already-small interval unchanged avoids injecting avoidable π uncertainty.
  // Arguments outside the canonical strip use the π/2 quadrant reduction below.
  if (
    compareRational(argument.lower, negateRational(safeQuarterPiMagnitude)) >= 0 &&
    compareRational(argument.upper, safeQuarterPiMagnitude) <= 0
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

function sincosSmallPointInterval(
  value: Rational,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  profile?: MutableTrigSeriesProfile
): SinCosIntervals {
  const point = scaledIntervalFromRationalBounds(
    createRationalInterval(value, value),
    decimalDigits
  );
  const scale = decimalScale(decimalDigits);
  const one = createScaledInterval(scale, scale, decimalDigits);
  const xSquared = squareScaled(point, decimalDigits);
  let sinTerm = point;
  let cosTerm = one;
  let sinSum = point;
  let cosSum = one;

  if (profile !== undefined) {
    profile.pointEvaluations += 1;
    profile.sharedSquareEvaluations += 1;
    profile.scaleDigits = Math.max(profile.scaleDigits, decimalDigits);
    recordScaledProfilePeak(profile, point, xSquared, one);
  }

  let index = 0;
  for (;;) {
    control.checkpoint();
    const sinFirst = TWO * BigInt(index + 1);
    const cosFirst = TWO * BigInt(index) + ONE;
    const nextSinTerm = divideScaledByPositiveInteger(
      negateScaledInterval(mulScaled(sinTerm, xSquared, decimalDigits)),
      sinFirst * (sinFirst + ONE)
    );
    const nextCosTerm = divideScaledByPositiveInteger(
      negateScaledInterval(mulScaled(cosTerm, xSquared, decimalDigits)),
      cosFirst * (cosFirst + ONE)
    );
    const sinTailUnits = scaledMagnitudeUpper(nextSinTerm);
    const cosTailUnits = scaledMagnitudeUpper(nextCosTerm);

    if (profile !== undefined) {
      recordScaledProfilePeak(profile, sinTerm, cosTerm, sinSum, cosSum, nextSinTerm, nextCosTerm);
    }

    if (sinTailUnits <= TAIL_STOP_UNITS && cosTailUnits <= TAIL_STOP_UNITS) {
      return Object.freeze({
        sinInterval: scaledIntervalToRationalInterval(widenScaledInterval(sinSum, sinTailUnits)),
        cosInterval: scaledIntervalToRationalInterval(widenScaledInterval(cosSum, cosTailUnits))
      });
    }

    sinSum = addScaledIntervals(sinSum, nextSinTerm);
    cosSum = addScaledIntervals(cosSum, nextCosTerm);
    sinTerm = nextSinTerm;
    cosTerm = nextCosTerm;
    index += 1;
  }
}

export function tanAngleIntervalWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): { readonly interval: RationalInterval | null; readonly profile: TrigSeriesProfile } {
  const profile: MutableTrigSeriesProfile = {
    rangeReductionCalls: 0,
    sincosIntervalEvaluations: 0,
    pointEvaluations: 0,
    sharedSquareEvaluations: 0,
    independentSeriesEvaluations: 0,
    scaleDigits: 0,
    peakBigIntDecimalDigits: 0
  };
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context);
  const interval = tanRadianInterval(radians.interval, decimalDigits, context, radians.pi, profile);

  return Object.freeze({
    interval,
    profile: freezeTrigSeriesProfile(profile, interval)
  });
}

function reduceExpArgument(
  value: Rational,
  control?: EvaluationCheckpoint
): { readonly value: Rational; readonly power: number } {
  const limit = createRational(ONE, FOUR);
  if (compareRational(value, limit) <= 0) {
    return Object.freeze({ value, power: 0 });
  }

  control?.checkpoint();
  const binaryExponent = positiveFloorBinaryExponent(value).exponent;
  let power = binaryExponent + 2;
  if (comparePositiveRationalToPowerOfTwo(value, binaryExponent) > 0) {
    power += 1;
  }

  const reduced = scaleRationalByPowerOfTwo(value, -power);
  control?.checkpoint();
  return Object.freeze({ value: reduced, power });
}

function searchExactIntegerLog(base: Rational, argument: Rational): Rational | null {
  const baseAboveOne = compareRational(base, RATIONAL_ONE) > 0;
  const argumentAboveOne = compareRational(argument, RATIONAL_ONE) > 0;
  const exponentSign = baseAboveOne === argumentAboveOne ? 1n : -1n;
  const effectiveBase = exponentSign > ZERO ? base : divideRational(RATIONAL_ONE, base);
  const maxMagnitude = 512;
  const maxPower = powRational(effectiveBase, BigInt(maxMagnitude));
  const maxComparison = compareRational(maxPower, argument);

  if ((argumentAboveOne && maxComparison < 0) || (!argumentAboveOne && maxComparison > 0)) {
    return null;
  }

  let lower = 1;
  let upper = maxMagnitude;
  while (lower <= upper) {
    const magnitude = Math.floor((lower + upper) / 2);
    const comparison = compareRational(powRational(effectiveBase, BigInt(magnitude)), argument);
    if (comparison === 0) {
      return integerRational(exponentSign * BigInt(magnitude));
    }

    if (argumentAboveOne ? comparison < 0 : comparison > 0) {
      lower = magnitude + 1;
    } else {
      upper = magnitude - 1;
    }
  }

  return null;
}

function isCheapExactFractionalLogCandidate(base: Rational, argument: Rational): boolean {
  const componentBitLimit = 16;
  return [base.numerator, base.denominator, argument.numerator, argument.denominator].every(
    (component) => bigintBitLength(component) <= componentBitLimit
  );
}

function expSmallNonNegativeScaledInterval(
  value: Rational,
  decimalDigits: number,
  control?: EvaluationCheckpoint
): ScaledInterval {
  const scale = decimalScale(decimalDigits);
  const valueInterval = scaledIntervalFromRationalBounds(
    createRationalInterval(value, value),
    decimalDigits
  );
  const valueLower = valueInterval.lower;
  const valueUpper = valueInterval.upper;
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
      return createScaledInterval(sumLower, sumUpper + tailUpper, decimalDigits);
    }

    index += 1;
  }
}

function reduceLnArgument(
  value: Rational,
  control?: EvaluationCheckpoint
): {
  readonly value: Rational;
  readonly power: number;
  readonly scaleSelectionComparisons: number;
} {
  control?.checkpoint();
  const exponentResult = positiveFloorBinaryExponent(value);
  let power = exponentResult.exponent;
  let reduced = scaleRationalByPowerOfTwo(value, -power);
  const scaleSelectionComparisons = exponentResult.comparisons + 1;

  if (compareRational(reduced, createRational(FOUR, 3n)) > 0) {
    power += 1;
    reduced = scaleRationalByPowerOfTwo(reduced, -1);
  }

  control?.checkpoint();
  return Object.freeze({ value: reduced, power, scaleSelectionComparisons });
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

function positiveFloorBinaryExponent(value: Rational): {
  readonly exponent: number;
  readonly comparisons: number;
} {
  if (signOfRational(value) <= 0) {
    throw new InternalCalculationException("Binary exponent requires a positive rational");
  }

  let exponent = bigintBitLength(value.numerator) - bigintBitLength(value.denominator);
  let comparisons = 1;

  if (comparePositiveRationalToPowerOfTwo(value, exponent) < 0) {
    exponent -= 1;
  } else {
    comparisons += 1;
    if (comparePositiveRationalToPowerOfTwo(value, exponent + 1) >= 0) {
      exponent += 1;
    }
  }

  return Object.freeze({ exponent, comparisons });
}

function comparePositiveRationalToPowerOfTwo(value: Rational, exponent: number): -1 | 0 | 1 {
  const comparison =
    exponent >= 0
      ? value.numerator - (value.denominator << BigInt(exponent))
      : (value.numerator << BigInt(-exponent)) - value.denominator;

  return comparison < ZERO ? -1 : comparison > ZERO ? 1 : 0;
}

function scaleRationalByPowerOfTwo(value: Rational, exponent: number): Rational {
  if (!Number.isSafeInteger(exponent)) {
    throw new InternalCalculationException("Binary scale exponent must be a safe integer");
  }

  return exponent >= 0
    ? createRational(value.numerator << BigInt(exponent), value.denominator)
    : createRational(value.numerator, value.denominator << BigInt(-exponent));
}

function bigintBitLength(value: bigint): number {
  const magnitude = value < ZERO ? -value : value;
  return magnitude === ZERO ? 0 : magnitude.toString(2).length;
}

function decimalDigitsForIntegerMagnitude(value: number): number {
  const magnitude = value < 0 ? -value : value;
  return magnitude === 0 ? 0 : Math.trunc(magnitude).toString().length;
}

function scaledIntervalToRationalInterval(interval: ScaledInterval): RationalInterval {
  const bounds = scaledIntervalToRationalBounds(interval);
  return createRationalInterval(bounds.lower, bounds.upper);
}

function negateScaledInterval(interval: ScaledInterval): ScaledInterval {
  return createScaledInterval(-interval.upper, -interval.lower, interval.scaleDigits);
}

function divideScaledByPositiveInteger(interval: ScaledInterval, divisor: bigint): ScaledInterval {
  if (divisor <= ZERO) {
    throw new InternalCalculationException("Scaled series divisor must be positive");
  }

  return divScaled(interval, createScaledInterval(divisor, divisor, 0), interval.scaleDigits);
}

function addScaledIntervals(left: ScaledInterval, right: ScaledInterval): ScaledInterval {
  if (left.scaleDigits !== right.scaleDigits) {
    throw new InternalCalculationException("Scaled interval addition requires one scale");
  }

  return createScaledInterval(left.lower + right.lower, left.upper + right.upper, left.scaleDigits);
}

function scaledMagnitudeUpper(interval: ScaledInterval): bigint {
  const lowerMagnitude = interval.lower < ZERO ? -interval.lower : interval.lower;
  const upperMagnitude = interval.upper < ZERO ? -interval.upper : interval.upper;
  return lowerMagnitude > upperMagnitude ? lowerMagnitude : upperMagnitude;
}

function widenScaledInterval(interval: ScaledInterval, units: bigint): ScaledInterval {
  if (units < ZERO) {
    throw new InternalCalculationException("Scaled interval widening must be non-negative");
  }

  return createScaledInterval(interval.lower - units, interval.upper + units, interval.scaleDigits);
}

function recordScaledProfilePeak(
  profile: MutableTrigSeriesProfile,
  ...intervals: readonly ScaledInterval[]
): void {
  for (const interval of intervals) {
    profile.peakBigIntDecimalDigits = Math.max(
      profile.peakBigIntDecimalDigits,
      maxScaledEndpointDecimalDigits(interval)
    );
  }
}

function freezeTrigSeriesProfile(
  profile: MutableTrigSeriesProfile,
  result: RationalInterval | null
): TrigSeriesProfile {
  return Object.freeze({
    rangeReductionCalls: profile.rangeReductionCalls,
    sincosIntervalEvaluations: profile.sincosIntervalEvaluations,
    pointEvaluations: profile.pointEvaluations,
    sharedSquareEvaluations: profile.sharedSquareEvaluations,
    independentSeriesEvaluations: profile.independentSeriesEvaluations,
    scaleDigits: profile.scaleDigits,
    peakBigIntDecimalDigits: profile.peakBigIntDecimalDigits,
    resultDenominatorDecimalDigits:
      result === null ? 0 : maxRationalDenominatorDecimalDigits(result)
  });
}

function maxScaledEndpointDecimalDigits(interval: ScaledInterval): number {
  return Math.max(bigintDecimalDigits(interval.lower), bigintDecimalDigits(interval.upper));
}

function maxRationalDenominatorDecimalDigits(interval: RationalInterval): number {
  return Math.max(
    bigintDecimalDigits(interval.lower.denominator),
    bigintDecimalDigits(interval.upper.denominator)
  );
}

function bigintDecimalDigits(value: bigint): number {
  const magnitude = value < ZERO ? -value : value;
  return magnitude.toString().length;
}

function createExpIntervalProfile(
  reductionPower: number,
  workingScaleDigits: number,
  squaringSteps: number,
  peakEndpointDecimalDigits: number,
  resultDenominatorDecimalDigits: number
): ExpIntervalProfile {
  return Object.freeze({
    reductionPower,
    workingScaleDigits,
    squaringSteps,
    peakEndpointDecimalDigits,
    resultDenominatorDecimalDigits
  });
}

function createLnIntervalProfile(
  binaryScale: number,
  scaleSelectionComparisons: number,
  workingDigits: number
): LnIntervalProfile {
  return Object.freeze({ binaryScale, scaleSelectionComparisons, workingDigits });
}
