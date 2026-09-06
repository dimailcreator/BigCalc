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
  rescaleScaled,
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
const BERNOULLI_CACHE: Rational[] = [RATIONAL_ONE];

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

export interface NthRootRefinementState {
  degree: bigint | null;
  argumentLower: Rational | null;
  argumentUpper: Rational | null;
  interval: ScaledInterval | null;
  highestDigits: number;
  totalNewtonIterations: number;
}

export interface NthRootProfile {
  readonly degree: bigint;
  readonly scaleDigits: number;
  readonly newtonIterations: number;
  readonly reusedPreviousInterval: boolean;
  readonly peakBigIntDecimalDigits: number;
}

export interface GammaComputationOptions {
  readonly minimumCorrectionTerms?: number;
  readonly minimumShiftTarget?: number;
}

export interface GammaComputationProfile {
  readonly workingDigits: number;
  readonly shift: number;
  readonly recurrenceFactors: number;
  readonly recurrenceTreeDepth: number;
  readonly correctionTerms: number;
  readonly highestBernoulliIndex: number;
  readonly usedHalfIntegerPath: boolean;
  readonly usedReflection: boolean;
}

export interface GammaStirlingPlan {
  readonly shiftTarget: number;
  readonly minimumCorrectionTerms: number;
  readonly maximumCorrectionTerms: null;
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

export function createNthRootRefinementState(): NthRootRefinementState {
  return {
    degree: null,
    argumentLower: null,
    argumentUpper: null,
    interval: null,
    highestDigits: 0,
    totalNewtonIterations: 0
  };
}

export function nthRootPositiveInterval(
  argument: RationalInterval,
  degree: bigint,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  state?: NthRootRefinementState
): RationalInterval {
  return nthRootPositiveIntervalWithProfile(argument, degree, decimalDigits, control, state)
    .interval;
}

export function nthRootPositiveIntervalWithProfile(
  argument: RationalInterval,
  degree: bigint,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  state?: NthRootRefinementState
): { readonly interval: RationalInterval; readonly profile: NthRootProfile } {
  if (degree <= ZERO) {
    throw new InternalCalculationException("nthRoot degree must be positive");
  }
  if (intervalSignLower(argument) < 0) {
    throw new InternalCalculationException("nthRootPositiveInterval requires a >= 0");
  }
  if (degree === ONE) {
    return Object.freeze({
      interval: argument,
      profile: Object.freeze({
        degree,
        scaleDigits: decimalDigits,
        newtonIterations: 0,
        reusedPreviousInterval: false,
        peakBigIntDecimalDigits: maxRationalEndpointDecimalDigits(argument)
      })
    });
  }
  if (degree > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InternalCalculationException("nthRoot degree exceeds the direct algorithm range");
  }

  const reusableState =
    state?.degree === degree &&
    state.argumentLower !== null &&
    state.argumentUpper !== null &&
    equalsRational(state.argumentLower, argument.lower) &&
    equalsRational(state.argumentUpper, argument.upper) &&
    state.interval !== null &&
    state.highestDigits < decimalDigits
      ? state
      : null;
  const previousInterval = reusableState?.interval;
  const previous = previousInterval ? rescaleScaled(previousInterval, decimalDigits) : null;
  const sameState = reusableState !== null;
  const degreeNumber = Number(degree);
  const lowerResult = scaledNthRootFloor(
    argument.lower,
    degreeNumber,
    decimalDigits,
    previous?.upper,
    control
  );
  const upperResult = equalsRational(argument.lower, argument.upper)
    ? lowerResult
    : scaledNthRootFloor(argument.upper, degreeNumber, decimalDigits, previous?.upper, control);
  const upper = upperResult.exact ? upperResult.floor : upperResult.floor + ONE;
  const scaled = createScaledInterval(lowerResult.floor, upper, decimalDigits);
  const interval = scaledIntervalToRationalInterval(scaled);
  const newtonIterations = lowerResult.iterations + upperResult.iterations;

  if (state !== undefined) {
    state.degree = degree;
    state.argumentLower = argument.lower;
    state.argumentUpper = argument.upper;
    state.interval = scaled;
    state.highestDigits = Math.max(state.highestDigits, decimalDigits);
    state.totalNewtonIterations += newtonIterations;
  }

  return Object.freeze({
    interval,
    profile: Object.freeze({
      degree,
      scaleDigits: decimalDigits,
      newtonIterations,
      reusedPreviousInterval: sameState,
      peakBigIntDecimalDigits: maxScaledEndpointDecimalDigits(scaled)
    })
  });
}

export function shouldUseDirectNthRoot(degree: bigint, decimalDigits: number): boolean {
  if (degree <= ONE || degree > BigInt(Number.MAX_SAFE_INTEGER)) {
    return false;
  }

  const degreeNumber = Number(degree);
  const estimatedScaledDigits = degreeNumber * Math.max(1, decimalDigits);
  const workBudget = decimalDigits * (decimalDigits + 64);
  return (
    Number.isSafeInteger(estimatedScaledDigits) &&
    Number.isSafeInteger(workBudget) &&
    estimatedScaledDigits <= workBudget
  );
}

export function powRationalViaNthRootInterval(
  base: Rational,
  exponent: Rational,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  state?: NthRootRefinementState
): RationalInterval | null {
  if (signOfRational(base) <= 0 || exponent.denominator === ONE) {
    return null;
  }
  if (!shouldUseDirectNthRoot(exponent.denominator, decimalDigits)) {
    return null;
  }

  const root = nthRootPositiveInterval(
    createRationalInterval(base, base),
    exponent.denominator,
    decimalDigits,
    control,
    state
  );
  let powered = powScaledInterval(
    scaledIntervalFromRationalBounds(root, decimalDigits),
    exponent.numerator < ZERO ? -exponent.numerator : exponent.numerator,
    decimalDigits,
    control
  );

  if (exponent.numerator < ZERO) {
    const scale = decimalScale(decimalDigits);
    powered = divScaled(createScaledInterval(scale, scale, decimalDigits), powered, decimalDigits);
  }

  return scaledIntervalToRationalInterval(powered);
}

export function gammaRealInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext
): RationalInterval | null {
  return gammaRealIntervalWithProfile(argument, decimalDigits, context).interval;
}

export function gammaRealIntervalWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  options: GammaComputationOptions = {}
): { readonly interval: RationalInterval | null; readonly profile: GammaComputationProfile } {
  const plan = createGammaStirlingPlan(decimalDigits, options);
  const halfInteger = exactHalfIntegerGammaInterval(argument, decimalDigits, context);
  if (halfInteger !== null) {
    return Object.freeze({
      interval: halfInteger,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, true)
    });
  }

  if (containsGammaPole(argument)) {
    return Object.freeze({
      interval: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false)
    });
  }

  const shift = gammaShiftToPositiveStirlingArgument(argument, plan.shiftTarget);
  if (shouldUseGammaReflection(argument, shift, plan.shiftTarget, decimalDigits)) {
    return reflectedGammaInterval(argument, decimalDigits, context, options);
  }
  const shiftedArgument = addIntervalInteger(argument, BigInt(shift));
  const stirling = logGammaPositiveStirlingInterval(
    shiftedArgument,
    decimalDigits,
    context,
    plan.minimumCorrectionTerms
  );
  let logGamma = stirling.interval;
  let recurrenceSign = 1;
  let recurrenceTreeDepth = 0;

  if (shift > 0) {
    const recurrenceFactors: RationalInterval[] = [];

    for (let index = 0; index < shift; index += 1) {
      context.checkpoint();
      const factor = addIntervalInteger(argument, BigInt(index));
      if (intervalContainsRational(factor, RATIONAL_ZERO)) {
        return Object.freeze({
          interval: null,
          profile: createGammaProfile(
            decimalDigits,
            shift,
            index,
            0,
            stirling.correctionTerms,
            false
          )
        });
      }

      if (intervalSignUpper(factor) < 0) {
        recurrenceSign *= -1;
      }

      recurrenceFactors.push(absNonZeroInterval(factor));
    }

    const recurrence = balancedProductIntervals(recurrenceFactors, context);
    const recurrenceMagnitude = recurrence.interval;
    recurrenceTreeDepth = recurrence.treeDepth;

    const recurrenceLog = lnPositiveInterval(
      recurrenceMagnitude,
      decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS,
      context
    );
    logGamma = subtractIntervals(logGamma, recurrenceLog);
  }

  const magnitude = expBallInterval(logGamma, decimalDigits, context);
  const interval = recurrenceSign > 0 ? magnitude : negateInterval(magnitude);

  return Object.freeze({
    interval,
    profile: createGammaProfile(
      decimalDigits,
      shift,
      shift,
      recurrenceTreeDepth,
      stirling.correctionTerms,
      false
    )
  });
}

export function createGammaStirlingPlan(
  decimalDigits: number,
  options: GammaComputationOptions = {}
): GammaStirlingPlan {
  if (!Number.isSafeInteger(decimalDigits) || decimalDigits < 1) {
    throw new InternalCalculationException("Gamma precision must be a positive safe integer");
  }
  const minimumCorrectionTerms = options.minimumCorrectionTerms ?? 0;
  const minimumShiftTarget = options.minimumShiftTarget ?? MIN_GAMMA_STIRLING_ARGUMENT;
  if (!Number.isSafeInteger(minimumCorrectionTerms) || minimumCorrectionTerms < 0) {
    throw new InternalCalculationException("Gamma minimum correction terms are invalid");
  }
  if (!Number.isSafeInteger(minimumShiftTarget) || minimumShiftTarget < 1) {
    throw new InternalCalculationException("Gamma minimum shift target is invalid");
  }

  return Object.freeze({
    shiftTarget: Math.max(MIN_GAMMA_STIRLING_ARGUMENT, decimalDigits + 16, minimumShiftTarget),
    minimumCorrectionTerms,
    maximumCorrectionTerms: null
  });
}

function reflectedGammaInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  options: GammaComputationOptions
): { readonly interval: RationalInterval | null; readonly profile: GammaComputationProfile } {
  const workingDigits = decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS;
  const pi = getPiRationalInterval(
    context,
    workingDigits + decimalMagnitudeUpperBound(argument) + 12
  );
  const piArgument = multiplyIntervals(pi, argument);
  const sine = sinRadianInterval(piArgument, workingDigits, context, pi);
  if (sine === null || intervalContainsRational(sine, RATIONAL_ZERO)) {
    return Object.freeze({
      interval: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true)
    });
  }

  const reflectedArgument = subtractIntervals(
    createRationalInterval(RATIONAL_ONE, RATIONAL_ONE),
    argument
  );
  const reflected = gammaRealIntervalWithProfile(
    reflectedArgument,
    workingDigits,
    context,
    options
  );
  if (reflected.interval === null) {
    return Object.freeze({
      interval: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true)
    });
  }

  const denominator = multiplyIntervals(sine, reflected.interval);
  if (intervalContainsRational(denominator, RATIONAL_ZERO)) {
    return Object.freeze({
      interval: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true)
    });
  }

  return Object.freeze({
    interval: divideIntervals(pi, denominator),
    profile: Object.freeze({
      ...reflected.profile,
      workingDigits: decimalDigits,
      usedHalfIntegerPath: false,
      usedReflection: true
    })
  });
}

function shouldUseGammaReflection(
  argument: RationalInterval,
  directShift: number,
  shiftTarget: number,
  decimalDigits: number
): boolean {
  if (intervalSignUpper(argument) >= 0) {
    return false;
  }

  const reflected = subtractIntervals(createRationalInterval(RATIONAL_ONE, RATIONAL_ONE), argument);
  const reflectedShift = gammaShiftToPositiveStirlingArgument(reflected, shiftTarget);
  const reflectionOverhead = Math.max(16, Math.ceil(decimalDigits / 3));
  return directShift > reflectedShift + reflectionOverhead;
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
  context: MathComputationContext,
  minimumCorrectionTerms: number
): { readonly interval: RationalInterval; readonly correctionTerms: number } {
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
  const series = stirlingCorrectionInterval(
    argument,
    workingDigits,
    context,
    minimumCorrectionTerms
  );
  logGamma = addIntervals(logGamma, series.sum);
  logGamma = widenInterval(logGamma, series.remainder);

  return Object.freeze({ interval: logGamma, correctionTerms: series.terms });
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

  const sqrtPi = nthRootPositiveInterval(
    getPiRationalInterval(context, decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS),
    TWO,
    decimalDigits,
    context
  );

  return multiplyIntervalByRational(sqrtPi, multiplier);
}

function stirlingCorrectionInterval(
  argument: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  minimumTerms: number
): { readonly sum: RationalInterval; readonly remainder: Rational; readonly terms: number } {
  // Bernoulli coefficients grow rapidly while z^-(2k-1) shrinks. Extra fixed-point
  // guard keeps the latter from rounding to a one-unit interval before multiplication.
  const scaleDigits = 2 * decimalDigits + 32 + minimumTerms * 4;
  const scale = decimalScale(scaleDigits);
  let sum = createScaledInterval(ZERO, ZERO, scaleDigits);
  const one = createRationalInterval(RATIONAL_ONE, RATIONAL_ONE);
  const inverse = scaledIntervalFromRationalBounds(divideIntervals(one, argument), scaleDigits);
  const inverseSquared = mulScaled(inverse, inverse, scaleDigits);
  let inversePower = inverse;
  const thresholdUnits = TEN ** BigInt(scaleDigits - decimalDigits);
  let index = 1;

  for (;;) {
    control.checkpoint();
    const bernoulli = bernoulliNumber(2 * index, control);
    const denominator = BigInt(2 * index * (2 * index - 1));
    const coefficient = divideRational(bernoulli, integerRational(denominator));
    const coefficientScaled = scaledIntervalFromRationalBounds(
      createRationalInterval(coefficient, coefficient),
      scaleDigits
    );
    sum = addScaledIntervals(sum, mulScaled(coefficientScaled, inversePower, scaleDigits));

    const nextIndex = index + 1;
    const nextBernoulli = absRational(bernoulliNumber(2 * nextIndex, control));
    const nextDenominator = BigInt(2 * nextIndex * (2 * nextIndex - 1));
    const nextPower = mulScaled(inversePower, inverseSquared, scaleDigits);
    const nextCoefficient = divideRational(nextBernoulli, integerRational(nextDenominator));
    const nextCoefficientScaled = scaledIntervalFromRationalBounds(
      createRationalInterval(nextCoefficient, nextCoefficient),
      scaleDigits
    );
    const remainderUnits = scaledMagnitudeUpper(
      mulScaled(nextCoefficientScaled, nextPower, scaleDigits)
    );

    if (index >= minimumTerms && remainderUnits <= thresholdUnits) {
      return Object.freeze({
        sum: scaledIntervalToRationalInterval(sum),
        remainder: createRational(remainderUnits, scale),
        terms: index
      });
    }

    inversePower = nextPower;
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

function balancedProductIntervals(
  factors: readonly RationalInterval[],
  control: EvaluationCheckpoint
): { readonly interval: RationalInterval; readonly treeDepth: number } {
  if (factors.length === 0) {
    return Object.freeze({
      interval: createRationalInterval(RATIONAL_ONE, RATIONAL_ONE),
      treeDepth: 0
    });
  }

  let level = [...factors];
  let treeDepth = 0;
  while (level.length > 1) {
    const next: RationalInterval[] = [];
    for (let index = 0; index < level.length; index += 2) {
      control.checkpoint();
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined) {
        throw new InternalCalculationException("Balanced product factor is missing");
      }
      next.push(right === undefined ? left : multiplyIntervals(left, right));
    }
    level = next;
    treeDepth += 1;
  }

  const interval = level[0];
  if (interval === undefined) {
    throw new InternalCalculationException("Balanced product result is missing");
  }
  return Object.freeze({ interval, treeDepth });
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

function gammaShiftToPositiveStirlingArgument(
  argument: RationalInterval,
  shiftTarget: number
): number {
  const target = BigInt(shiftTarget);
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

function bernoulliNumber(index: number, control?: EvaluationCheckpoint): Rational {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new InternalCalculationException("Bernoulli index must be a non-negative safe integer");
  }

  const cached = BERNOULLI_CACHE[index];
  if (cached !== undefined) {
    return cached;
  }

  for (let currentIndex = BERNOULLI_CACHE.length; currentIndex <= index; currentIndex += 1) {
    control?.checkpoint();
    if (currentIndex > 1 && currentIndex % 2 === 1) {
      BERNOULLI_CACHE.push(RATIONAL_ZERO);
      continue;
    }

    const order = BigInt(currentIndex + 1);
    const terms: Rational[] = [RATIONAL_ONE];
    const first = BERNOULLI_CACHE[1];
    if (first !== undefined) {
      terms.push(multiplyRational(integerRational(order), first));
    }

    let binomial = (order * BigInt(currentIndex)) / TWO;
    for (let priorIndex = 2; priorIndex < currentIndex; priorIndex += 2) {
      control?.checkpoint();
      const prior = BERNOULLI_CACHE[priorIndex];
      if (prior === undefined) {
        throw new InternalCalculationException("Bernoulli cache prefix is incomplete");
      }
      terms.push(multiplyRational(integerRational(binomial), prior));
      binomial =
        (binomial * BigInt(currentIndex + 1 - priorIndex) * BigInt(currentIndex - priorIndex)) /
        (BigInt(priorIndex + 1) * BigInt(priorIndex + 2));
    }

    const sum = balancedSumRationals(terms);
    BERNOULLI_CACHE.push(divideRational(negateRational(sum), integerRational(order)));
  }

  const result = BERNOULLI_CACHE[index];
  if (result === undefined) {
    throw new InternalCalculationException("Bernoulli cache result is missing");
  }

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

function balancedSumRationals(values: readonly Rational[]): Rational {
  if (values.length === 0) {
    return RATIONAL_ZERO;
  }

  let level = [...values];
  while (level.length > 1) {
    const next: Rational[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined) {
        throw new InternalCalculationException("Balanced Rational sum term is missing");
      }
      next.push(right === undefined ? left : addRational(left, right));
    }
    level = next;
  }

  const result = level[0];
  if (result === undefined) {
    throw new InternalCalculationException("Balanced Rational sum result is missing");
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

function scaledNthRootFloor(
  value: Rational,
  degree: number,
  scaleDigits: number,
  initialUpper: bigint | undefined,
  control: EvaluationCheckpoint
): { readonly floor: bigint; readonly exact: boolean; readonly iterations: number } {
  const scaledExponent = scaleDigits * degree;
  if (!Number.isSafeInteger(scaledExponent)) {
    throw new InternalCalculationException("nthRoot scaled exponent exceeds safe internal bounds");
  }

  const scaledNumerator = value.numerator * TEN ** BigInt(scaledExponent);
  const target = scaledNumerator / value.denominator;
  if (target === ZERO) {
    return Object.freeze({ floor: ZERO, exact: scaledNumerator === ZERO, iterations: 0 });
  }

  const degreeBigInt = BigInt(degree);
  let current: bigint;
  if (initialUpper !== undefined && initialUpper > ZERO && initialUpper ** degreeBigInt >= target) {
    current = initialUpper;
  } else {
    const initialBits = Math.ceil(bigintBitLength(target) / degree);
    current = ONE << BigInt(initialBits);
  }

  let iterations = 0;
  for (;;) {
    control.checkpoint();
    iterations += 1;
    const divisorPower = current ** BigInt(degree - 1);
    const next: bigint = ((degreeBigInt - ONE) * current + target / divisorPower) / degreeBigInt;
    if (next >= current) {
      break;
    }
    current = next;
  }

  while (current ** degreeBigInt > target) {
    control.checkpoint();
    current -= ONE;
  }
  while ((current + ONE) ** degreeBigInt <= target) {
    control.checkpoint();
    current += ONE;
  }

  return Object.freeze({
    floor: current,
    exact: current ** degreeBigInt * value.denominator === scaledNumerator,
    iterations
  });
}

function powScaledInterval(
  base: ScaledInterval,
  exponent: bigint,
  scaleDigits: number,
  control: EvaluationCheckpoint
): ScaledInterval {
  if (exponent < ZERO) {
    throw new InternalCalculationException("Scaled interval exponent must be non-negative");
  }

  const scale = decimalScale(scaleDigits);
  let result = createScaledInterval(scale, scale, scaleDigits);
  let factor = base;
  let remaining = exponent;

  while (remaining > ZERO) {
    control.checkpoint();
    if (remaining % TWO === ONE) {
      result = mulScaled(result, factor, scaleDigits);
    }
    remaining /= TWO;
    if (remaining > ZERO) {
      factor = squareScaled(factor, scaleDigits);
    }
  }

  return result;
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

function maxRationalEndpointDecimalDigits(interval: RationalInterval): number {
  return Math.max(
    bigintDecimalDigits(interval.lower.numerator),
    bigintDecimalDigits(interval.lower.denominator),
    bigintDecimalDigits(interval.upper.numerator),
    bigintDecimalDigits(interval.upper.denominator)
  );
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

function createGammaProfile(
  workingDigits: number,
  shift: number,
  recurrenceFactors: number,
  recurrenceTreeDepth: number,
  correctionTerms: number,
  usedHalfIntegerPath: boolean,
  usedReflection = false
): GammaComputationProfile {
  return Object.freeze({
    workingDigits,
    shift,
    recurrenceFactors,
    recurrenceTreeDepth,
    correctionTerms,
    highestBernoulliIndex: correctionTerms === 0 ? 0 : 2 * (correctionTerms + 1),
    usedHalfIntegerPath,
    usedReflection
  });
}
