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
import {
  ballToOutwardInterval,
  createBall,
  createInternalInterval,
  intervalToBall
} from "../values/ball.js";
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
const BERNOULLI_STATE_BY_OWNER = new WeakMap<EvaluationCheckpoint, BernoulliCacheState>();

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

export interface ExpBinaryReconstructionProfile {
  readonly binaryExponent: bigint;
  readonly ln2RequestedDigits: number;
  readonly reductionRetries: number;
  readonly mantissaScaleDigits: number;
  readonly mantissaPeakDecimalDigits: number;
  readonly resultSignificandBits: number;
  readonly resultExponentMagnitude: bigint;
}

export interface ExactLogProfile {
  readonly estimatedExponent: bigint | null;
  readonly candidateCount: number;
  readonly exactPowerChecks: number;
  readonly earlyAbortedPowerChecks: number;
  readonly powerMultiplications: number;
  readonly peakPowerComponentDigits: number;
  readonly matchedExponent: bigint | null;
}

export interface ExactLogRationalState {
  baseNumerator: bigint | null;
  baseDenominator: bigint | null;
  argumentNumerator: bigint | null;
  argumentDenominator: bigint | null;
  phase: "integer" | "fractional" | "complete";
  integerSearch: ExactIntegerLogSearchState;
  fractionalSearch: ExactIntegerLogSearchState;
  fractionalDenominator: number;
  fractionalPowerDenominator: number;
  fractionalArgumentPower: Rational | null;
  candidateCount: number;
  exactPowerChecks: number;
  earlyAbortedPowerChecks: number;
  powerMultiplications: number;
  peakPowerComponentDigits: number;
  value: Rational | null;
  estimatedExponent: bigint | null;
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
  strategy: NthRootStrategy | null;
  strategyChanges: number;
}

export interface NthRootProfile {
  readonly degree: bigint;
  readonly scaleDigits: number;
  readonly newtonIterations: number;
  readonly reusedPreviousInterval: boolean;
  readonly peakBigIntDecimalDigits: number;
  readonly estimatedNqAllocationDigits: bigint;
}

export type NthRootStrategy = "direct" | "ln-exp";

export interface NthRootStrategyPlan {
  readonly strategy: NthRootStrategy;
  readonly degree: bigint;
  readonly requestedDigits: number;
  readonly estimatedNqAllocationDigits: bigint;
  readonly estimatedPeakBigIntDigits: bigint;
  readonly expectedNewtonPowerCost: bigint;
  readonly numeratorMagnitude: bigint;
  readonly estimatedResultMagnitudeDigits: bigint;
  readonly estimatedNumeratorPowerCost: bigint;
  readonly fallbackLnExpCost: bigint;
  readonly reason:
    | "direct-cost-bounded"
    | "fallback-cost"
    | "nq-allocation"
    | "unsafe-degree"
    | "result-magnitude"
    | "numerator-power";
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
  readonly halfIntegerStrategy: HalfIntegerGammaStrategy;
  readonly halfIntegerRecurrenceSteps: bigint;
  readonly recurrenceProductPeakBigIntDigits: number;
  readonly recurrenceProductPeakRetainedDigits: number;
  readonly resultSignificandBits: number;
  readonly resultExponentMagnitude: bigint;
}

export type HalfIntegerGammaStrategy = "not-half-integer" | "recurrence" | "general";

export interface HalfIntegerGammaPlan {
  readonly strategy: HalfIntegerGammaStrategy;
  readonly recurrenceSteps: bigint;
  readonly recurrenceBudget: bigint;
  readonly estimatedRecurrenceCost: bigint;
  readonly estimatedGeneralCost: bigint;
}

export interface BernoulliCacheSnapshot {
  readonly highestEvenIndex: number;
  readonly tangentNumbers: number;
  readonly cachedBernoulliNumbers: number;
  readonly convolutionProducts: number;
  readonly generationCheckpoints: number;
  readonly retainedBigIntDigits: number;
  readonly pendingOrder: number | null;
}

interface PendingTangentNumber {
  readonly order: number;
  index: number;
  binomial: bigint;
  sum: bigint;
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

/**
 * Production exp path. The small exp series is evaluated only for the reduced
 * mantissa; the potentially huge 2^k factor stays in InternalFloat.exponent.
 */
export function expIntervalBall(
  argument: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  control: MathComputationContext
): Ball | null {
  return expIntervalBallWithProfile(argument, decimalDigits, precisionBits, backend, control).ball;
}

export function expIntervalBallWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  control: MathComputationContext
): { readonly ball: Ball | null; readonly profile: ExpBinaryReconstructionProfile | null } {
  const reduction = reduceExpIntervalByLn2(argument, decimalDigits, control);
  if (reduction === null) {
    return Object.freeze({ ball: null, profile: null });
  }

  const mantissaScaleDigits = decimalDigits + EXP_RECONSTRUCTION_SAFETY_DIGITS;
  const lower = expSmallNonNegativeScaledInterval(
    reduction.remainder.lower,
    mantissaScaleDigits,
    control
  );
  const upper = expSmallNonNegativeScaledInterval(
    reduction.remainder.upper,
    mantissaScaleDigits,
    control
  );
  const mantissaInterval = createRationalInterval(
    scaledIntervalToRationalBounds(lower).lower,
    scaledIntervalToRationalBounds(upper).upper
  );
  const mantissaBall = intervalToRoundedBall(mantissaInterval, precisionBits, backend);
  const center = backend.scaleByPowerOfTwo(mantissaBall.center, reduction.binaryExponent);
  const radius = backend.scaleByPowerOfTwo(mantissaBall.radius, reduction.binaryExponent);
  const ball = createBall(center, radius);
  const resultSignificandBits = Math.max(
    bigintBitLength(center.significand),
    bigintBitLength(radius.significand)
  );
  const resultExponentMagnitude = center.exponent < ZERO ? -center.exponent : center.exponent;

  return Object.freeze({
    ball,
    profile: Object.freeze({
      binaryExponent: reduction.binaryExponent,
      ln2RequestedDigits: reduction.ln2RequestedDigits,
      reductionRetries: reduction.reductionRetries,
      mantissaScaleDigits,
      mantissaPeakDecimalDigits: Math.max(
        maxScaledEndpointDecimalDigits(lower),
        maxScaledEndpointDecimalDigits(upper)
      ),
      resultSignificandBits,
      resultExponentMagnitude
    })
  });
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

interface BernoulliCacheState {
  readonly bernoulliCache: (Rational | undefined)[];
  readonly tangentNumberCache: bigint[];
  pendingTangentNumber: PendingTangentNumber | null;
  convolutionProducts: number;
  generationCheckpoints: number;
  retainedBigIntDigits: number;
}

export function powPositiveBall(
  base: RationalInterval,
  exponent: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  control: MathComputationContext
): Ball | null {
  if (intervalSignLower(base) <= 0) {
    throw new InternalCalculationException("powPositiveBall requires base > 0");
  }

  const logBase = lnPositiveInterval(base, decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS, control);
  const scaledExponent = multiplyIntervals(logBase, exponent);
  return expIntervalBall(scaledExponent, decimalDigits, precisionBits, backend, control);
}

export function createNthRootRefinementState(): NthRootRefinementState {
  return {
    degree: null,
    argumentLower: null,
    argumentUpper: null,
    interval: null,
    highestDigits: 0,
    totalNewtonIterations: 0,
    strategy: null,
    strategyChanges: 0
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
        peakBigIntDecimalDigits: maxRationalEndpointDecimalDigits(argument),
        estimatedNqAllocationDigits: BigInt(decimalDigits)
      })
    });
  }
  if (degree > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InternalCalculationException("nthRoot degree exceeds the direct algorithm range");
  }

  const strategyPlan = planNthRootStrategy(degree, decimalDigits, argument);
  const estimatedPeakDigits = bigintToGuardDigits(strategyPlan.estimatedPeakBigIntDigits);
  control.guardBigIntDigits?.(estimatedPeakDigits);

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
      peakBigIntDecimalDigits: Math.max(
        maxScaledEndpointDecimalDigits(scaled),
        lowerResult.peakBigIntDecimalDigits,
        upperResult.peakBigIntDecimalDigits
      ),
      estimatedNqAllocationDigits: strategyPlan.estimatedNqAllocationDigits
    })
  });
}

export function planNthRootStrategy(
  degree: bigint,
  decimalDigits: number,
  argument?: RationalInterval,
  numeratorMagnitude: bigint = ONE
): NthRootStrategyPlan {
  const requestedDigits = Math.max(1, decimalDigits);
  const estimatedNqAllocationDigits = degree * BigInt(requestedDigits);
  const inputDigits =
    argument === undefined ? 1n : BigInt(maxRationalEndpointDecimalDigits(argument));
  const estimatedPeakBigIntDigits = estimatedNqAllocationDigits + inputDigits + 8n;
  const fallbackLnExpCost = BigInt(requestedDigits) * BigInt(requestedDigits + 64);
  const degreeBits = degree > ZERO ? BigInt(degree.toString(2).length) : ZERO;
  const expectedNewtonPowerCost =
    estimatedPeakBigIntDigits * degreeBits * BigInt(Math.max(2, requestedDigits.toString().length));
  const normalizedNumeratorMagnitude =
    numeratorMagnitude < ZERO ? -numeratorMagnitude : numeratorMagnitude;
  const estimatedResultMagnitudeDigits =
    (normalizedNumeratorMagnitude * inputDigits) / (degree > ZERO ? degree : ONE) + ONE;
  const numeratorBits =
    normalizedNumeratorMagnitude > ZERO
      ? BigInt(normalizedNumeratorMagnitude.toString(2).length)
      : ZERO;
  const estimatedNumeratorPowerCost = estimatedResultMagnitudeDigits * (numeratorBits + ONE);
  const linearMemoryBudget = BigInt(requestedDigits * 16 + 256);
  const unsafeDegree = degree <= ONE || degree > BigInt(Number.MAX_SAFE_INTEGER);
  const strategy =
    !unsafeDegree &&
    estimatedPeakBigIntDigits <= linearMemoryBudget &&
    expectedNewtonPowerCost <= fallbackLnExpCost * 32n &&
    estimatedResultMagnitudeDigits <= linearMemoryBudget &&
    estimatedNumeratorPowerCost <= fallbackLnExpCost * 32n
      ? "direct"
      : "ln-exp";

  return Object.freeze({
    strategy,
    degree,
    requestedDigits,
    estimatedNqAllocationDigits,
    estimatedPeakBigIntDigits,
    expectedNewtonPowerCost,
    numeratorMagnitude: normalizedNumeratorMagnitude,
    estimatedResultMagnitudeDigits,
    estimatedNumeratorPowerCost,
    fallbackLnExpCost,
    reason: unsafeDegree
      ? "unsafe-degree"
      : estimatedPeakBigIntDigits > linearMemoryBudget
        ? "nq-allocation"
        : estimatedResultMagnitudeDigits > linearMemoryBudget
          ? "result-magnitude"
          : estimatedNumeratorPowerCost > fallbackLnExpCost * 32n
            ? "numerator-power"
            : strategy === "ln-exp"
              ? "fallback-cost"
              : "direct-cost-bounded"
  });
}

export function shouldUseDirectNthRoot(
  degree: bigint,
  decimalDigits: number,
  argument?: RationalInterval
): boolean {
  return planNthRootStrategy(degree, decimalDigits, argument).strategy === "direct";
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
  const plan = planNthRootStrategy(
    exponent.denominator,
    decimalDigits,
    createRationalInterval(base, base),
    exponent.numerator
  );
  if (state !== undefined) {
    if (state.strategy === null) {
      state.strategy = plan.strategy;
    } else if (state.strategy === "direct" && plan.strategy === "ln-exp") {
      state.strategy = "ln-exp";
      state.strategyChanges += 1;
    }
  }
  if ((state?.strategy ?? plan.strategy) !== "direct") {
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
  const halfIntegerPlan = planHalfIntegerGammaStrategy(argument, decimalDigits);
  const halfInteger =
    halfIntegerPlan.strategy === "recurrence"
      ? exactHalfIntegerGammaInterval(argument, decimalDigits, context)
      : null;
  if (halfInteger !== null) {
    return Object.freeze({
      interval: halfInteger,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, true, false, halfIntegerPlan)
    });
  }

  if (containsGammaPole(argument)) {
    return Object.freeze({
      interval: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, false, halfIntegerPlan)
    });
  }

  const directShift = gammaShiftToPositiveStirlingArgument(argument, plan.shiftTarget);
  if (shouldUseGammaReflection(argument, directShift, plan.shiftTarget, decimalDigits)) {
    const reflected = reflectedGammaInterval(argument, decimalDigits, context, options);
    return withHalfIntegerPlan(reflected, halfIntegerPlan);
  }
  const shift = safeGammaShiftNumber(directShift);
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
  let recurrenceProductPeakBigIntDigits = 0;
  let recurrenceProductPeakRetainedDigits = 0;

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
            false,
            false,
            halfIntegerPlan
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
    recurrenceProductPeakBigIntDigits = recurrence.peakBigIntDigits;
    recurrenceProductPeakRetainedDigits = recurrence.peakRetainedDigits;

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
      false,
      false,
      halfIntegerPlan,
      recurrenceProductPeakBigIntDigits,
      recurrenceProductPeakRetainedDigits
    )
  });
}

export function gammaRealBall(
  argument: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  context: MathComputationContext,
  options: GammaComputationOptions = {}
): Ball | null {
  return gammaRealBallWithProfile(argument, decimalDigits, precisionBits, backend, context, options)
    .ball;
}

export function gammaRealBallWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  context: MathComputationContext,
  options: GammaComputationOptions = {}
): { readonly ball: Ball | null; readonly profile: GammaComputationProfile } {
  const plan = createGammaStirlingPlan(decimalDigits, options);
  const halfIntegerPlan = planHalfIntegerGammaStrategy(argument, decimalDigits);
  const halfInteger =
    halfIntegerPlan.strategy === "recurrence"
      ? exactHalfIntegerGammaInterval(argument, decimalDigits, context)
      : null;
  if (halfInteger !== null) {
    const ball = intervalToRoundedBall(halfInteger, precisionBits, backend);
    return Object.freeze({
      ball,
      profile: withGammaBallMagnitude(
        createGammaProfile(decimalDigits, 0, 0, 0, 0, true, false, halfIntegerPlan),
        ball
      )
    });
  }

  if (containsGammaPole(argument)) {
    return Object.freeze({
      ball: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, false, halfIntegerPlan)
    });
  }

  const directShift = gammaShiftToPositiveStirlingArgument(argument, plan.shiftTarget);
  if (shouldUseGammaReflection(argument, directShift, plan.shiftTarget, decimalDigits)) {
    return reflectedGammaBall(
      argument,
      decimalDigits,
      precisionBits,
      backend,
      context,
      options,
      halfIntegerPlan
    );
  }

  const shift = safeGammaShiftNumber(directShift);
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
  let recurrenceProductPeakBigIntDigits = 0;
  let recurrenceProductPeakRetainedDigits = 0;

  if (shift > 0) {
    const recurrenceFactors: RationalInterval[] = [];
    for (let index = 0; index < shift; index += 1) {
      context.checkpoint();
      const factor = addIntervalInteger(argument, BigInt(index));
      if (intervalContainsRational(factor, RATIONAL_ZERO)) {
        return Object.freeze({
          ball: null,
          profile: createGammaProfile(
            decimalDigits,
            shift,
            index,
            0,
            stirling.correctionTerms,
            false,
            false,
            halfIntegerPlan
          )
        });
      }
      if (intervalSignUpper(factor) < 0) recurrenceSign *= -1;
      recurrenceFactors.push(absNonZeroInterval(factor));
    }

    const recurrence = balancedProductIntervals(recurrenceFactors, context);
    recurrenceTreeDepth = recurrence.treeDepth;
    recurrenceProductPeakBigIntDigits = recurrence.peakBigIntDigits;
    recurrenceProductPeakRetainedDigits = recurrence.peakRetainedDigits;
    const recurrenceLog = lnPositiveInterval(
      recurrence.interval,
      decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS,
      context
    );
    logGamma = subtractIntervals(logGamma, recurrenceLog);
  }

  const magnitude = expIntervalBall(logGamma, decimalDigits, precisionBits, backend, context);
  if (magnitude === null) {
    return Object.freeze({
      ball: null,
      profile: createGammaProfile(
        decimalDigits,
        shift,
        shift,
        recurrenceTreeDepth,
        stirling.correctionTerms,
        false,
        false,
        halfIntegerPlan,
        recurrenceProductPeakBigIntDigits,
        recurrenceProductPeakRetainedDigits
      )
    });
  }
  const ball = recurrenceSign > 0 ? magnitude : negateCompactBall(magnitude, backend);
  const profile = withGammaBallMagnitude(
    createGammaProfile(
      decimalDigits,
      shift,
      shift,
      recurrenceTreeDepth,
      stirling.correctionTerms,
      false,
      false,
      halfIntegerPlan,
      recurrenceProductPeakBigIntDigits,
      recurrenceProductPeakRetainedDigits
    ),
    ball
  );
  return Object.freeze({ ball, profile });
}

export function planHalfIntegerGammaStrategy(
  argument: RationalInterval,
  decimalDigits: number
): HalfIntegerGammaPlan {
  if (!equalsRational(argument.lower, argument.upper)) {
    return createHalfIntegerGammaPlan("not-half-integer", ZERO, decimalDigits);
  }

  const doubled = multiplyRational(argument.lower, integerRational(TWO));
  if (doubled.denominator !== ONE || doubled.numerator % TWO === ZERO) {
    return createHalfIntegerGammaPlan("not-half-integer", ZERO, decimalDigits);
  }

  const recurrenceSteps =
    doubled.numerator >= ONE ? (doubled.numerator - ONE) / TWO : (ONE - doubled.numerator) / TWO;
  const recurrenceBudget = BigInt(Math.max(32, decimalDigits * 2 + 32));
  const magnitudeDigits = BigInt(recurrenceSteps.toString().length);
  const estimatedRecurrenceCost =
    recurrenceSteps * (BigInt(Math.max(1, decimalDigits)) + magnitudeDigits);
  const estimatedGeneralCost =
    BigInt(Math.max(1, decimalDigits)) * BigInt(decimalDigits + 64) + magnitudeDigits * 32n;
  // This is a route-selection heuristic only. It never changes whether the
  // half-integer belongs to Gamma's real domain.
  const strategy =
    recurrenceSteps <= recurrenceBudget && estimatedRecurrenceCost <= estimatedGeneralCost * FOUR
      ? "recurrence"
      : "general";

  return Object.freeze({
    strategy,
    recurrenceSteps,
    recurrenceBudget,
    estimatedRecurrenceCost,
    estimatedGeneralCost
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

function reflectedGammaBall(
  argument: RationalInterval,
  decimalDigits: number,
  precisionBits: number,
  backend: BigFloatBackend,
  context: MathComputationContext,
  options: GammaComputationOptions,
  halfIntegerPlan: HalfIntegerGammaPlan
): { readonly ball: Ball | null; readonly profile: GammaComputationProfile } {
  const workingDigits = decimalDigits + DEFAULT_INTERVAL_GUARD_DIGITS;
  const workingBits = Math.max(
    precisionBits,
    Math.ceil((workingDigits + DEFAULT_INTERVAL_GUARD_DIGITS) * Math.log2(10)) + 8
  );
  const pi = getPiRationalInterval(
    context,
    workingDigits + decimalMagnitudeUpperBound(argument) + 12
  );
  const piArgument = multiplyIntervals(pi, argument);
  const sine = sinRadianInterval(piArgument, workingDigits, context, pi);
  if (sine === null || intervalContainsRational(sine, RATIONAL_ZERO)) {
    return Object.freeze({
      ball: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true, halfIntegerPlan)
    });
  }

  const reflectedArgument = subtractIntervals(
    createRationalInterval(RATIONAL_ONE, RATIONAL_ONE),
    argument
  );
  const reflected = gammaRealBallWithProfile(
    reflectedArgument,
    workingDigits,
    workingBits,
    backend,
    context,
    options
  );
  if (reflected.ball === null) {
    return Object.freeze({
      ball: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true, halfIntegerPlan)
    });
  }

  const piBall = intervalToRoundedBall(pi, workingBits, backend);
  const sineBall = intervalToRoundedBall(sine, workingBits, backend);
  const denominator = multiplyCompactBalls(sineBall, reflected.ball, workingBits, backend);
  const denominatorInterval = ballToOutwardInterval(denominator, workingBits, backend);
  if (denominatorInterval.lower.sign <= 0 && denominatorInterval.upper.sign >= 0) {
    return Object.freeze({
      ball: null,
      profile: createGammaProfile(decimalDigits, 0, 0, 0, 0, false, true, halfIntegerPlan)
    });
  }

  const ball = divideCompactBalls(piBall, denominator, precisionBits, backend);
  return Object.freeze({
    ball,
    profile: withGammaBallMagnitude(
      Object.freeze({
        ...reflected.profile,
        workingDigits: decimalDigits,
        usedHalfIntegerPath: false,
        usedReflection: true,
        halfIntegerStrategy: halfIntegerPlan.strategy,
        halfIntegerRecurrenceSteps: halfIntegerPlan.recurrenceSteps
      }),
      ball
    )
  });
}

function multiplyCompactBalls(
  left: Ball,
  right: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const leftInterval = ballToOutwardInterval(left, precisionBits, backend);
  const rightInterval = ballToOutwardInterval(right, precisionBits, backend);
  const lowerCandidates = [
    backend.mul(leftInterval.lower, rightInterval.lower, precisionBits, "towardNegativeInfinity"),
    backend.mul(leftInterval.lower, rightInterval.upper, precisionBits, "towardNegativeInfinity"),
    backend.mul(leftInterval.upper, rightInterval.lower, precisionBits, "towardNegativeInfinity"),
    backend.mul(leftInterval.upper, rightInterval.upper, precisionBits, "towardNegativeInfinity")
  ];
  const upperCandidates = [
    backend.mul(leftInterval.lower, rightInterval.lower, precisionBits, "towardPositiveInfinity"),
    backend.mul(leftInterval.lower, rightInterval.upper, precisionBits, "towardPositiveInfinity"),
    backend.mul(leftInterval.upper, rightInterval.lower, precisionBits, "towardPositiveInfinity"),
    backend.mul(leftInterval.upper, rightInterval.upper, precisionBits, "towardPositiveInfinity")
  ];
  return compactInternalIntervalToBall(
    minimumInternalFloat(lowerCandidates, backend),
    maximumInternalFloat(upperCandidates, backend),
    precisionBits,
    backend
  );
}

function divideCompactBalls(
  numerator: Ball,
  denominator: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const left = ballToOutwardInterval(numerator, precisionBits, backend);
  const right = ballToOutwardInterval(denominator, precisionBits, backend);
  if (right.lower.sign <= 0 && right.upper.sign >= 0) {
    throw new InternalCalculationException("Compact ball division denominator contains zero");
  }
  const lowerCandidates = [
    backend.div(left.lower, right.lower, precisionBits, "towardNegativeInfinity"),
    backend.div(left.lower, right.upper, precisionBits, "towardNegativeInfinity"),
    backend.div(left.upper, right.lower, precisionBits, "towardNegativeInfinity"),
    backend.div(left.upper, right.upper, precisionBits, "towardNegativeInfinity")
  ];
  const upperCandidates = [
    backend.div(left.lower, right.lower, precisionBits, "towardPositiveInfinity"),
    backend.div(left.lower, right.upper, precisionBits, "towardPositiveInfinity"),
    backend.div(left.upper, right.lower, precisionBits, "towardPositiveInfinity"),
    backend.div(left.upper, right.upper, precisionBits, "towardPositiveInfinity")
  ];
  return compactInternalIntervalToBall(
    minimumInternalFloat(lowerCandidates, backend),
    maximumInternalFloat(upperCandidates, backend),
    precisionBits,
    backend
  );
}

function compactInternalIntervalToBall(
  lower: ReturnType<BigFloatBackend["fromRational"]>,
  upper: ReturnType<BigFloatBackend["fromRational"]>,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const midpointLower = backend.scaleByPowerOfTwo(
    backend.add(lower, upper, precisionBits + 4, "towardNegativeInfinity"),
    -ONE
  );
  const radius = backend.sub(upper, midpointLower, precisionBits, "towardPositiveInfinity");
  return createBall(midpointLower, backend.abs(radius));
}

function minimumInternalFloat<T extends ReturnType<BigFloatBackend["fromRational"]>>(
  values: readonly T[],
  backend: BigFloatBackend
): T {
  const first = values[0];
  if (first === undefined) throw new InternalCalculationException("Missing interval candidates");
  return values
    .slice(1)
    .reduce((minimum, value) => (backend.compare(value, minimum) < 0 ? value : minimum), first);
}

function maximumInternalFloat<T extends ReturnType<BigFloatBackend["fromRational"]>>(
  values: readonly T[],
  backend: BigFloatBackend
): T {
  const first = values[0];
  if (first === undefined) throw new InternalCalculationException("Missing interval candidates");
  return values
    .slice(1)
    .reduce((maximum, value) => (backend.compare(value, maximum) > 0 ? value : maximum), first);
}

function negateCompactBall(ball: Ball, backend: BigFloatBackend): Ball {
  return createBall(backend.negate(ball.center), ball.radius);
}

function shouldUseGammaReflection(
  argument: RationalInterval,
  directShift: bigint,
  shiftTarget: number,
  decimalDigits: number
): boolean {
  if (intervalSignUpper(argument) >= 0) {
    return false;
  }

  const reflected = subtractIntervals(createRationalInterval(RATIONAL_ONE, RATIONAL_ONE), argument);
  const reflectedShift = gammaShiftToPositiveStirlingArgument(reflected, shiftTarget);
  const reflectionOverhead = BigInt(Math.max(16, Math.ceil(decimalDigits / 3)));
  return directShift > reflectedShift + reflectionOverhead;
}

export function sinAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context, 360n);
  return sinRadianInterval(radians.interval, decimalDigits, context, radians.pi);
}

export function cosAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context, 360n);
  return cosRadianInterval(radians.interval, decimalDigits, context, radians.pi);
}

export function tanAngleInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): RationalInterval | null {
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context, 180n);
  return tanRadianInterval(radians.interval, decimalDigits, context, radians.pi);
}

export function sinAngleIntervalWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): { readonly interval: RationalInterval | null; readonly profile: TrigSeriesProfile } {
  return standaloneTrigAngleIntervalWithProfile("sin", argument, decimalDigits, angleMode, context);
}

export function cosAngleIntervalWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): { readonly interval: RationalInterval | null; readonly profile: TrigSeriesProfile } {
  return standaloneTrigAngleIntervalWithProfile("cos", argument, decimalDigits, angleMode, context);
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

export function createExactLogRationalState(): ExactLogRationalState {
  return {
    baseNumerator: null,
    baseDenominator: null,
    argumentNumerator: null,
    argumentDenominator: null,
    phase: "integer",
    integerSearch: createExactIntegerLogSearchState(),
    fractionalSearch: createExactIntegerLogSearchState(),
    fractionalDenominator: 2,
    fractionalPowerDenominator: 1,
    fractionalArgumentPower: null,
    candidateCount: 0,
    exactPowerChecks: 0,
    earlyAbortedPowerChecks: 0,
    powerMultiplications: 0,
    peakPowerComponentDigits: 0,
    value: null,
    estimatedExponent: null
  };
}

export function exactLogRational(
  base: Rational,
  argument: Rational,
  control?: EvaluationCheckpoint,
  state: ExactLogRationalState = createExactLogRationalState()
): Rational | null {
  return exactLogRationalWithProfile(base, argument, control, state).value;
}

export function exactLogRationalWithProfile(
  base: Rational,
  argument: Rational,
  control?: EvaluationCheckpoint,
  state: ExactLogRationalState = createExactLogRationalState()
): { readonly value: Rational | null; readonly profile: ExactLogProfile } {
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
    return exactLogProfileResult(RATIONAL_ZERO, null, 0, 0, 0, 0, 0);
  }

  initializeExactLogRationalState(state, base, argument);
  if (state.phase === "complete") {
    return exactLogResultFromState(state);
  }

  if (state.phase === "integer") {
    const integerLog = searchExactIntegerLog(base, argument, control, state.integerSearch);
    addExactIntegerLogMetrics(state, integerLog);
    state.estimatedExponent = integerLog.estimatedExponent;
    if (integerLog.value !== null) {
      state.value = integerLog.value;
      state.phase = "complete";
      return exactLogResultFromState(state);
    }

    if (!isCheapExactFractionalLogCandidate(base, argument)) {
      state.phase = "complete";
      return exactLogResultFromState(state);
    }

    state.phase = "fractional";
    state.fractionalArgumentPower = argument;
    state.fractionalPowerDenominator = 1;
  }

  // This is intentionally a small, local exact path rather than a symbolic
  // factorisation engine: argument^q = base^p proves log_base(argument) = p/q.
  while (state.fractionalDenominator <= MAX_EXACT_LOG_DENOMINATOR) {
    if (state.fractionalPowerDenominator < state.fractionalDenominator) {
      control?.checkpoint();
      const previousPower = state.fractionalArgumentPower;
      if (previousPower === null) {
        throw new InternalCalculationException("Exact logarithm fractional state is missing");
      }
      guardRationalProduct(previousPower, argument, control);
      state.fractionalArgumentPower = multiplyRational(previousPower, argument);
      state.fractionalPowerDenominator += 1;
    }

    const argumentPower = state.fractionalArgumentPower;
    if (argumentPower === null) {
      throw new InternalCalculationException("Exact logarithm fractional state is missing");
    }

    const numerator = searchExactIntegerLog(base, argumentPower, control, state.fractionalSearch);
    addExactIntegerLogMetrics(state, numerator);
    if (numerator.value !== null) {
      state.value = createRational(numerator.value.numerator, BigInt(state.fractionalDenominator));
      state.estimatedExponent = numerator.estimatedExponent;
      state.phase = "complete";
      return exactLogResultFromState(state);
    }

    state.fractionalDenominator += 1;
    state.fractionalSearch = createExactIntegerLogSearchState();
  }

  state.phase = "complete";
  return exactLogResultFromState(state);
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
  readonly degreeReductionCalls: number;
  readonly degreeOriginalMagnitudeDigits: number;
  readonly degreeReducedMagnitudeDigits: number;
  readonly piRequestedDigits: number;
  readonly sincosIntervalEvaluations: number;
  readonly selectiveIntervalEvaluations: number;
  readonly pointEvaluations: number;
  readonly sharedSquareEvaluations: number;
  readonly sinSeriesEvaluations: number;
  readonly cosSeriesEvaluations: number;
  readonly independentSeriesEvaluations: number;
  readonly tanEndpointHullEvaluations: number;
  readonly tanIntervalDivisionEvaluations: number;
  readonly poleRejections: number;
  readonly scaleDigits: number;
  readonly peakBigIntDecimalDigits: number;
  readonly resultDenominatorDecimalDigits: number;
}

interface MutableTrigSeriesProfile {
  rangeReductionCalls: number;
  degreeReductionCalls: number;
  degreeOriginalMagnitudeDigits: number;
  degreeReducedMagnitudeDigits: number;
  piRequestedDigits: number;
  sincosIntervalEvaluations: number;
  selectiveIntervalEvaluations: number;
  pointEvaluations: number;
  sharedSquareEvaluations: number;
  sinSeriesEvaluations: number;
  cosSeriesEvaluations: number;
  independentSeriesEvaluations: number;
  tanEndpointHullEvaluations: number;
  tanIntervalDivisionEvaluations: number;
  poleRejections: number;
  scaleDigits: number;
  peakBigIntDecimalDigits: number;
}

interface ReducedSinCosBranch {
  readonly sin: RationalInterval;
  readonly cos: RationalInterval;
  readonly polePossible: boolean;
}

interface SelectiveSinCosIntervals {
  readonly sinInterval: RationalInterval | null;
  readonly cosInterval: RationalInterval | null;
}

interface TrigKernelNeeds {
  readonly needSin: boolean;
  readonly needCos: boolean;
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
  return evaluateReducedStandaloneTrig("sin", argument, decimalDigits, context, pi, profile);
}

function cosRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  return evaluateReducedStandaloneTrig("cos", argument, decimalDigits, context, pi, profile);
}

function tanRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  if (profile !== undefined) profile.rangeReductionCalls += 1;
  const reduction = reduceRadianInterval(argument, decimalDigits, context, pi);
  if (reduction === null) {
    return null;
  }
  const poleBranches = reduction.branches.filter((branch) => branch.polePossible).length;
  if (poleBranches > 0) {
    if (profile !== undefined) profile.poleRejections += poleBranches;
    return null;
  }

  const results: RationalInterval[] = [];
  for (const branch of reduction.branches) {
    context.checkpoint();
    if (profile !== undefined) profile.sincosIntervalEvaluations += 1;

    if (equalsRational(branch.reducedInterval.lower, branch.reducedInterval.upper)) {
      if (profile !== undefined) profile.tanIntervalDivisionEvaluations += 1;
      const mapped = evaluateMappedSinCosInterval(
        branch.reducedInterval,
        branch,
        decimalDigits,
        context,
        profile
      );
      if (intervalContainsRational(mapped.cos, RATIONAL_ZERO)) {
        if (profile !== undefined) profile.poleRejections += 1;
        return null;
      }
      results.push(divideIntervals(mapped.sin, mapped.cos));
      continue;
    }

    // tan'(x)=sec^2(x)>0 on this pole-free branch, so endpoint enclosures
    // avoid the interval-correlation loss of dividing sin([a,b]) by cos([a,b]).
    if (profile !== undefined) profile.tanEndpointHullEvaluations += 1;
    const lower = evaluateMappedSinCosPoint(
      branch.reducedInterval.lower,
      branch,
      decimalDigits,
      context,
      profile
    );
    const upper = equalsRational(branch.reducedInterval.lower, branch.reducedInterval.upper)
      ? lower
      : evaluateMappedSinCosPoint(
          branch.reducedInterval.upper,
          branch,
          decimalDigits,
          context,
          profile
        );
    if (
      intervalContainsRational(lower.cos, RATIONAL_ZERO) ||
      intervalContainsRational(upper.cos, RATIONAL_ZERO)
    ) {
      if (profile !== undefined) profile.poleRejections += 1;
      return null;
    }

    const lowerTangent = divideIntervals(lower.sin, lower.cos);
    const upperTangent = divideIntervals(upper.sin, upper.cos);
    results.push(createRationalInterval(lowerTangent.lower, upperTangent.upper));
  }

  return hullIntervals(results);
}

function evaluateMappedSinCosInterval(
  reduced: RationalInterval,
  branch: TrigRangeReductionBranch,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  profile?: MutableTrigSeriesProfile
): ReducedSinCosBranch {
  const base = selectiveSinCosSmallIntervalInternal(
    reduced,
    decimalDigits,
    control,
    { needSin: true, needCos: true },
    profile
  );
  if (base.sinInterval === null || base.cosInterval === null) {
    throw new InternalCalculationException("Joint trigonometric kernel omitted a result");
  }
  const sinSource = branch.swapSinCos ? base.cosInterval : base.sinInterval;
  const cosSource = branch.swapSinCos ? base.sinInterval : base.cosInterval;
  return Object.freeze({
    sin: branch.sinSign < 0 ? negateInterval(sinSource) : sinSource,
    cos: branch.cosSign < 0 ? negateInterval(cosSource) : cosSource,
    polePossible: branch.polePossible
  });
}

function evaluateReducedStandaloneTrig(
  operation: "sin" | "cos",
  argument: RationalInterval,
  decimalDigits: number,
  context: MathComputationContext,
  pi?: RationalInterval,
  profile?: MutableTrigSeriesProfile
): RationalInterval | null {
  if (profile !== undefined) {
    profile.rangeReductionCalls += 1;
  }
  const reduction = reduceRadianInterval(argument, decimalDigits, context, pi);
  if (reduction === null) {
    return null;
  }

  const results = reduction.branches.map((branch) => {
    context.checkpoint();
    const needSin = branch.swapSinCos ? operation === "cos" : operation === "sin";
    const base = selectiveSinCosSmallIntervalInternal(
      branch.reducedInterval,
      decimalDigits,
      context,
      { needSin, needCos: !needSin },
      profile
    );
    const source = needSin ? base.sinInterval : base.cosInterval;
    if (source === null) {
      throw new InternalCalculationException("Selective trigonometric kernel omitted its result");
    }
    const sign = operation === "sin" ? branch.sinSign : branch.cosSign;
    return sign < 0 ? negateInterval(source) : source;
  });

  return hullIntervals(results);
}

function evaluateMappedSinCosPoint(
  point: Rational,
  branch: TrigRangeReductionBranch,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  profile?: MutableTrigSeriesProfile
): ReducedSinCosBranch {
  const base = selectiveSinCosSmallPointInterval(
    point,
    decimalDigits,
    control,
    { needSin: true, needCos: true },
    profile
  );
  if (base.sinInterval === null || base.cosInterval === null) {
    throw new InternalCalculationException("Joint trigonometric kernel omitted a result");
  }
  const sinSource = branch.swapSinCos ? base.cosInterval : base.sinInterval;
  const cosSource = branch.swapSinCos ? base.sinInterval : base.cosInterval;

  return Object.freeze({
    sin: branch.sinSign < 0 ? negateInterval(sinSource) : sinSource,
    cos: branch.cosSign < 0 ? negateInterval(cosSource) : cosSource,
    polePossible: branch.polePossible
  });
}

export function sincosSmallInterval(
  reduced: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint
): SinCosIntervals {
  const result = selectiveSinCosSmallIntervalInternal(reduced, decimalDigits, control, {
    needSin: true,
    needCos: true
  });
  if (result.sinInterval === null || result.cosInterval === null) {
    throw new InternalCalculationException("Joint trigonometric kernel omitted a result");
  }
  return Object.freeze({ sinInterval: result.sinInterval, cosInterval: result.cosInterval });
}

function selectiveSinCosSmallIntervalInternal(
  reduced: RationalInterval,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  needs: TrigKernelNeeds,
  profile?: MutableTrigSeriesProfile
): SelectiveSinCosIntervals {
  if (
    compareRational(reduced.lower, integerRational(-1n)) < 0 ||
    compareRational(reduced.upper, RATIONAL_ONE) > 0
  ) {
    throw new InternalCalculationException("sincosSmallInterval requires x in [-1, 1]");
  }

  if (!needs.needSin && !needs.needCos) {
    throw new InternalCalculationException("Trigonometric kernel requires at least one series");
  }
  if (profile !== undefined && needs.needSin !== needs.needCos) {
    profile.selectiveIntervalEvaluations += 1;
  }
  const lower = selectiveSinCosSmallPointInterval(
    reduced.lower,
    decimalDigits,
    control,
    needs,
    profile
  );
  const upper = equalsRational(reduced.lower, reduced.upper)
    ? lower
    : selectiveSinCosSmallPointInterval(reduced.upper, decimalDigits, control, needs, profile);
  const sinInterval =
    lower.sinInterval === null || upper.sinInterval === null
      ? null
      : createRationalInterval(lower.sinInterval.lower, upper.sinInterval.upper);
  const cosineEndpoints =
    lower.cosInterval === null || upper.cosInterval === null
      ? null
      : [
          lower.cosInterval.lower,
          lower.cosInterval.upper,
          upper.cosInterval.lower,
          upper.cosInterval.upper
        ];

  return Object.freeze({
    sinInterval,
    cosInterval:
      cosineEndpoints === null
        ? null
        : createRationalInterval(
            minRational(cosineEndpoints),
            intervalContainsRational(reduced, RATIONAL_ZERO)
              ? RATIONAL_ONE
              : maxRational(cosineEndpoints)
          )
  });
}

function toRadianInterval(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext,
  degreePeriod: 180n | 360n,
  profile?: MutableTrigSeriesProfile
): RadianConversion {
  if (angleMode === "radians") {
    return Object.freeze({ interval: argument });
  }

  const reduced = reduceDegreeInterval(argument, degreePeriod);
  const piDigits = decimalDigits + decimalMagnitudeUpperBound(reduced) + 12;
  if (profile !== undefined) {
    profile.degreeReductionCalls += 1;
    profile.degreeOriginalMagnitudeDigits = Math.max(
      profile.degreeOriginalMagnitudeDigits,
      maxRationalEndpointDecimalDigits(argument)
    );
    profile.degreeReducedMagnitudeDigits = Math.max(
      profile.degreeReducedMagnitudeDigits,
      maxRationalEndpointDecimalDigits(reduced)
    );
    profile.piRequestedDigits = Math.max(profile.piRequestedDigits, piDigits);
    profile.peakBigIntDecimalDigits = Math.max(
      profile.peakBigIntDecimalDigits,
      profile.degreeOriginalMagnitudeDigits
    );
  }
  const pi = getPiRationalInterval(context, piDigits);
  return Object.freeze({
    interval: divideIntervalByInteger(multiplyIntervals(reduced, pi), 180n),
    pi
  });
}

export function reduceDegreeInterval(
  argument: RationalInterval,
  period: 180n | 360n
): RationalInterval {
  // Translate the whole interval by one exact period multiple chosen from its
  // lower endpoint. This preserves every function value without involving π.
  const periodRational = integerRational(period);
  const quotient = floorRational(divideRational(argument.lower, periodRational));
  return subtractIntervalRational(argument, integerRational(quotient * period));
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

function selectiveSinCosSmallPointInterval(
  value: Rational,
  decimalDigits: number,
  control: EvaluationCheckpoint,
  needs: TrigKernelNeeds,
  profile?: MutableTrigSeriesProfile
): SelectiveSinCosIntervals {
  const point = scaledIntervalFromRationalBounds(
    createRationalInterval(value, value),
    decimalDigits
  );
  const scale = decimalScale(decimalDigits);
  const one = createScaledInterval(scale, scale, decimalDigits);
  const xSquared = squareScaled(point, decimalDigits);

  if (profile !== undefined) {
    profile.pointEvaluations += 1;
    profile.sharedSquareEvaluations += 1;
    profile.sinSeriesEvaluations += needs.needSin ? 1 : 0;
    profile.cosSeriesEvaluations += needs.needCos ? 1 : 0;
    profile.independentSeriesEvaluations += needs.needSin === needs.needCos ? 0 : 1;
    profile.scaleDigits = Math.max(profile.scaleDigits, decimalDigits);
    recordScaledProfilePeak(profile, point, xSquared, one);
  }

  return Object.freeze({
    sinInterval: needs.needSin
      ? scaledIntervalToRationalInterval(
          evaluateSmallTrigSeries(point, xSquared, decimalDigits, "sin", control, profile)
        )
      : null,
    cosInterval: needs.needCos
      ? scaledIntervalToRationalInterval(
          evaluateSmallTrigSeries(one, xSquared, decimalDigits, "cos", control, profile)
        )
      : null
  });
}

function evaluateSmallTrigSeries(
  initialTerm: ScaledInterval,
  xSquared: ScaledInterval,
  decimalDigits: number,
  operation: "sin" | "cos",
  control: EvaluationCheckpoint,
  profile?: MutableTrigSeriesProfile
): ScaledInterval {
  let term = initialTerm;
  let sum = initialTerm;
  let index = 0;
  for (;;) {
    control.checkpoint();
    const first = operation === "sin" ? TWO * BigInt(index + 1) : TWO * BigInt(index) + ONE;
    const nextTerm = divideScaledByPositiveInteger(
      negateScaledInterval(mulScaled(term, xSquared, decimalDigits)),
      first * (first + ONE)
    );
    const tailUnits = scaledMagnitudeUpper(nextTerm);

    if (profile !== undefined) {
      recordScaledProfilePeak(profile, term, sum, nextTerm);
    }

    if (tailUnits <= TAIL_STOP_UNITS) {
      return widenScaledInterval(sum, tailUnits);
    }

    sum = addScaledIntervals(sum, nextTerm);
    term = nextTerm;
    index += 1;
  }
}

export function tanAngleIntervalWithProfile(
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): { readonly interval: RationalInterval | null; readonly profile: TrigSeriesProfile } {
  const profile = createMutableTrigSeriesProfile();
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context, 180n, profile);
  const interval = tanRadianInterval(radians.interval, decimalDigits, context, radians.pi, profile);

  return Object.freeze({
    interval,
    profile: freezeTrigSeriesProfile(profile, interval)
  });
}

function standaloneTrigAngleIntervalWithProfile(
  operation: "sin" | "cos",
  argument: RationalInterval,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: MathComputationContext
): { readonly interval: RationalInterval | null; readonly profile: TrigSeriesProfile } {
  const profile = createMutableTrigSeriesProfile();
  const radians = toRadianInterval(argument, decimalDigits, angleMode, context, 360n, profile);
  const interval =
    operation === "sin"
      ? sinRadianInterval(radians.interval, decimalDigits, context, radians.pi, profile)
      : cosRadianInterval(radians.interval, decimalDigits, context, radians.pi, profile);

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

function reduceExpIntervalByLn2(
  argument: RationalInterval,
  decimalDigits: number,
  control: MathComputationContext
): {
  readonly binaryExponent: bigint;
  readonly remainder: RationalInterval;
  readonly ln2RequestedDigits: number;
  readonly reductionRetries: number;
} | null {
  if (
    equalsRational(argument.lower, RATIONAL_ZERO) &&
    equalsRational(argument.upper, RATIONAL_ZERO)
  ) {
    return Object.freeze({
      binaryExponent: ZERO,
      remainder: argument,
      ln2RequestedDigits: 0,
      reductionRetries: 0
    });
  }

  const exactArgument = equalsRational(argument.lower, argument.upper);
  let ln2RequestedDigits =
    decimalDigits + decimalMagnitudeUpperBound(argument) + EXP_RECONSTRUCTION_SAFETY_DIGITS;
  let reductionRetries = 0;

  for (;;) {
    control.checkpoint();
    const lnTwo = getLn2RationalInterval(control, ln2RequestedDigits);
    const quotient = divideIntervals(argument, lnTwo);
    const lowerExponent = floorRational(quotient.lower);
    const upperExponent = floorRational(quotient.upper);

    // A boundary-straddling quotient is still safe: choosing the proven lower
    // integer keeps r non-negative and below roughly 2*ln(2). This avoids an
    // infinite refinement loop when the true argument is exactly k*ln(2).
    if (upperExponent === lowerExponent || upperExponent === lowerExponent + ONE) {
      const remainder = subtractIntervals(argument, scaleIntervalByInteger(lnTwo, lowerExponent));
      if (intervalSignLower(remainder) < 0) {
        throw new InternalCalculationException("exp ln(2) reduction produced a negative remainder");
      }

      return Object.freeze({
        binaryExponent: lowerExponent,
        remainder,
        ln2RequestedDigits,
        reductionRetries
      });
    }

    if (!exactArgument) {
      return null;
    }

    reductionRetries += 1;
    ln2RequestedDigits = Math.max(ln2RequestedDigits + 16, ln2RequestedDigits * 2);
  }
}

interface ExactIntegerLogSearchResult {
  readonly value: Rational | null;
  readonly estimatedExponent: bigint;
  readonly candidateCount: number;
  readonly exactPowerChecks: number;
  readonly earlyAbortedPowerChecks: number;
  readonly powerMultiplications: number;
  readonly peakPowerComponentDigits: number;
}

interface ExactIntegerLogSearchState {
  baseNumerator: bigint | null;
  baseDenominator: bigint | null;
  argumentNumerator: bigint | null;
  argumentDenominator: bigint | null;
  exponentSign: bigint;
  estimatedExponent: bigint;
  candidates: readonly bigint[];
  candidateIndex: number;
  comparison: BoundedRationalPowerComparisonState;
  exactPowerChecks: number;
  earlyAbortedPowerChecks: number;
  powerMultiplications: number;
  peakPowerComponentDigits: number;
  completed: boolean;
  value: Rational | null;
}

interface BoundedRationalPowerComparisonState {
  baseNumerator: bigint | null;
  baseDenominator: bigint | null;
  exponent: bigint | null;
  limitNumerator: bigint | null;
  limitDenominator: bigint | null;
  result: Rational;
  factor: Rational | null;
  remaining: bigint;
  phase: "multiply-result" | "square-factor";
  multiplications: number;
  peakComponentDigits: number;
  completed: boolean;
  comparison: -1 | 0 | 1;
  earlyAborted: boolean;
}

function createExactIntegerLogSearchState(): ExactIntegerLogSearchState {
  return {
    baseNumerator: null,
    baseDenominator: null,
    argumentNumerator: null,
    argumentDenominator: null,
    exponentSign: ONE,
    estimatedExponent: ONE,
    candidates: Object.freeze([]),
    candidateIndex: 0,
    comparison: createBoundedRationalPowerComparisonState(),
    exactPowerChecks: 0,
    earlyAbortedPowerChecks: 0,
    powerMultiplications: 0,
    peakPowerComponentDigits: 0,
    completed: false,
    value: null
  };
}

function createBoundedRationalPowerComparisonState(): BoundedRationalPowerComparisonState {
  return {
    baseNumerator: null,
    baseDenominator: null,
    exponent: null,
    limitNumerator: null,
    limitDenominator: null,
    result: RATIONAL_ONE,
    factor: null,
    remaining: ZERO,
    phase: "multiply-result",
    multiplications: 0,
    peakComponentDigits: 1,
    completed: false,
    comparison: 0,
    earlyAborted: false
  };
}

function searchExactIntegerLog(
  base: Rational,
  argument: Rational,
  control?: EvaluationCheckpoint,
  state: ExactIntegerLogSearchState = createExactIntegerLogSearchState()
): ExactIntegerLogSearchResult {
  initializeExactIntegerLogSearchState(state, base, argument, control);

  while (!state.completed && state.candidateIndex < state.candidates.length) {
    const magnitude = state.candidates[state.candidateIndex];
    if (magnitude === undefined) {
      throw new InternalCalculationException("Exact logarithm candidate is missing");
    }

    const comparison = compareRationalPowerToLimit(
      effectiveExactLogBase(base),
      magnitude,
      effectiveExactLogArgument(argument),
      control,
      state.comparison
    );
    state.exactPowerChecks += 1;
    state.powerMultiplications += state.comparison.multiplications;
    state.peakPowerComponentDigits = Math.max(
      state.peakPowerComponentDigits,
      state.comparison.peakComponentDigits
    );
    if (state.comparison.earlyAborted) {
      state.earlyAbortedPowerChecks += 1;
    }

    if (comparison === 0) {
      state.value = integerRational(state.exponentSign * magnitude);
      state.completed = true;
      break;
    }

    state.candidateIndex += 1;
    state.comparison = createBoundedRationalPowerComparisonState();
  }

  if (state.candidateIndex >= state.candidates.length) {
    state.completed = true;
  }

  return Object.freeze({
    value: state.value,
    estimatedExponent: state.estimatedExponent,
    candidateCount: state.candidates.length,
    exactPowerChecks: state.exactPowerChecks,
    earlyAbortedPowerChecks: state.earlyAbortedPowerChecks,
    powerMultiplications: state.powerMultiplications,
    peakPowerComponentDigits: state.peakPowerComponentDigits
  });
}

function initializeExactIntegerLogSearchState(
  state: ExactIntegerLogSearchState,
  base: Rational,
  argument: Rational,
  control?: EvaluationCheckpoint
): void {
  if (
    state.baseNumerator === base.numerator &&
    state.baseDenominator === base.denominator &&
    state.argumentNumerator === argument.numerator &&
    state.argumentDenominator === argument.denominator
  ) {
    return;
  }

  control?.checkpoint();
  guardRationalComparison(base, argument, control);
  const baseAboveOne = compareRational(base, RATIONAL_ONE) > 0;
  const argumentAboveOne = compareRational(argument, RATIONAL_ONE) > 0;
  const effectiveBase = baseAboveOne ? base : positiveRationalReciprocal(base);
  const effectiveArgument = argumentAboveOne ? argument : positiveRationalReciprocal(argument);
  const estimatedExponent = estimateIntegerPowerExponent(
    effectiveBase.numerator,
    effectiveArgument.numerator
  );

  state.baseNumerator = base.numerator;
  state.baseDenominator = base.denominator;
  state.argumentNumerator = argument.numerator;
  state.argumentDenominator = argument.denominator;
  state.exponentSign = baseAboveOne === argumentAboveOne ? ONE : -ONE;
  state.estimatedExponent = estimatedExponent;
  state.candidates = nearbyPositiveIntegerCandidates(estimatedExponent);
  state.candidateIndex = 0;
  state.comparison = createBoundedRationalPowerComparisonState();
  state.exactPowerChecks = 0;
  state.earlyAbortedPowerChecks = 0;
  state.powerMultiplications = 0;
  state.peakPowerComponentDigits = 0;
  state.completed = false;
  state.value = null;
}

function effectiveExactLogBase(base: Rational): Rational {
  return compareRational(base, RATIONAL_ONE) > 0 ? base : positiveRationalReciprocal(base);
}

function effectiveExactLogArgument(argument: Rational): Rational {
  return compareRational(argument, RATIONAL_ONE) > 0
    ? argument
    : positiveRationalReciprocal(argument);
}

function positiveRationalReciprocal(value: Rational): Rational {
  // The input is already canonical and positive, so swapping its coprime
  // components preserves Rational invariants without an uncheckpointed gcd.
  return Object.freeze({
    kind: "rational",
    numerator: value.denominator,
    denominator: value.numerator
  });
}

function compareRationalPowerToLimit(
  base: Rational,
  exponent: bigint,
  limit: Rational,
  control: EvaluationCheckpoint | undefined,
  state: BoundedRationalPowerComparisonState
): -1 | 0 | 1 {
  initializeBoundedRationalPowerComparisonState(state, base, exponent, limit);
  if (state.completed) return state.comparison;

  while (state.remaining > ZERO) {
    if (state.phase === "multiply-result") {
      if (state.remaining % TWO !== ZERO) {
        control?.checkpoint();
        const factor = state.factor;
        if (factor === null) {
          completeBoundedPowerComparison(state, 1, true);
          return state.comparison;
        }

        if (compareRationalProductToLimit(state.result, factor, limit, control) > 0) {
          completeBoundedPowerComparison(state, 1, true);
          return state.comparison;
        }

        guardRationalProduct(state.result, factor, control);
        state.result = multiplyRational(state.result, factor);
        state.multiplications += 1;
        recordBoundedPowerMagnitude(state, state.result);
      }

      state.remaining /= TWO;
      state.phase = "square-factor";
    }

    if (state.remaining > ZERO) {
      control?.checkpoint();
      const factor = state.factor;
      if (factor === null || compareRationalProductToLimit(factor, factor, limit, control) > 0) {
        completeBoundedPowerComparison(state, 1, true);
        return state.comparison;
      }

      guardRationalProduct(factor, factor, control);
      state.factor = multiplyRational(factor, factor);
      state.multiplications += 1;
      recordBoundedPowerMagnitude(state, state.factor);
    }
    state.phase = "multiply-result";
  }

  guardRationalComparison(state.result, limit, control);
  completeBoundedPowerComparison(state, compareRational(state.result, limit), false);
  return state.comparison;
}

function initializeBoundedRationalPowerComparisonState(
  state: BoundedRationalPowerComparisonState,
  base: Rational,
  exponent: bigint,
  limit: Rational
): void {
  if (
    state.baseNumerator === base.numerator &&
    state.baseDenominator === base.denominator &&
    state.exponent === exponent &&
    state.limitNumerator === limit.numerator &&
    state.limitDenominator === limit.denominator
  ) {
    return;
  }

  state.baseNumerator = base.numerator;
  state.baseDenominator = base.denominator;
  state.exponent = exponent;
  state.limitNumerator = limit.numerator;
  state.limitDenominator = limit.denominator;
  state.result = RATIONAL_ONE;
  state.factor = base;
  state.remaining = exponent;
  state.phase = "multiply-result";
  state.multiplications = 0;
  state.peakComponentDigits = maxRationalComponentDigits(base);
  state.completed = false;
  state.comparison = 0;
  state.earlyAborted = false;
}

function completeBoundedPowerComparison(
  state: BoundedRationalPowerComparisonState,
  comparison: -1 | 0 | 1,
  earlyAborted: boolean
): void {
  state.comparison = comparison;
  state.earlyAborted = earlyAborted;
  state.completed = true;
}

function compareRationalProductToLimit(
  left: Rational,
  right: Rational,
  limit: Rational,
  control?: EvaluationCheckpoint
): -1 | 0 | 1 {
  const leftBits =
    bigintBitLength(left.numerator) +
    bigintBitLength(right.numerator) +
    bigintBitLength(limit.denominator);
  const rightBits =
    bigintBitLength(limit.numerator) +
    bigintBitLength(left.denominator) +
    bigintBitLength(right.denominator);
  guardBigIntBits(Math.max(leftBits, rightBits), control);

  const leftProduct = left.numerator * right.numerator * limit.denominator;
  const rightProduct = limit.numerator * left.denominator * right.denominator;
  return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
}

function guardRationalProduct(
  left: Rational,
  right: Rational,
  control?: EvaluationCheckpoint
): void {
  const numeratorBits = bigintBitLength(left.numerator) + bigintBitLength(right.numerator);
  const denominatorBits = bigintBitLength(left.denominator) + bigintBitLength(right.denominator);
  guardBigIntBits(Math.max(numeratorBits, denominatorBits), control);
}

function guardRationalComparison(
  left: Rational,
  right: Rational,
  control?: EvaluationCheckpoint
): void {
  const firstBits = bigintBitLength(left.numerator) + bigintBitLength(right.denominator);
  const secondBits = bigintBitLength(right.numerator) + bigintBitLength(left.denominator);
  guardBigIntBits(Math.max(firstBits, secondBits), control);
}

function guardBigIntBits(bits: number, control?: EvaluationCheckpoint): void {
  const decimalDigits = Math.ceil(bits * LOG10_TWO) + 1;
  control?.guardBigIntDigits?.(decimalDigits);
}

function recordBoundedPowerMagnitude(
  state: BoundedRationalPowerComparisonState,
  value: Rational
): void {
  state.peakComponentDigits = Math.max(
    state.peakComponentDigits,
    maxRationalComponentDigits(value)
  );
}

function maxRationalComponentDigits(value: Rational): number {
  return Math.max(bigintDecimalDigits(value.numerator), bigintDecimalDigits(value.denominator));
}

function estimateIntegerPowerExponent(base: bigint, argument: bigint): bigint {
  const estimate = Math.round(approximateLog2BigInt(argument) / approximateLog2BigInt(base));
  return BigInt(Math.max(1, estimate));
}

function approximateLog2BigInt(value: bigint): number {
  const bitLength = bigintBitLength(value);
  const retainedBits = Math.min(53, bitLength);
  const shift = bitLength - retainedBits;
  const leading = Number(value >> BigInt(shift));
  return Math.log2(leading) + shift;
}

function nearbyPositiveIntegerCandidates(estimate: bigint): readonly bigint[] {
  const candidates: bigint[] = [estimate];
  for (let distance = ONE; distance <= 3n; distance += ONE) {
    const lower = estimate - distance;
    if (lower > ZERO) candidates.push(lower);
    candidates.push(estimate + distance);
  }
  return Object.freeze(candidates);
}

function exactLogProfileResult(
  value: Rational | null,
  estimatedExponent: bigint | null,
  candidateCount: number,
  exactPowerChecks: number,
  earlyAbortedPowerChecks: number,
  powerMultiplications: number,
  peakPowerComponentDigits: number
): { readonly value: Rational | null; readonly profile: ExactLogProfile } {
  return Object.freeze({
    value,
    profile: Object.freeze({
      estimatedExponent,
      candidateCount,
      exactPowerChecks,
      earlyAbortedPowerChecks,
      powerMultiplications,
      peakPowerComponentDigits,
      matchedExponent: value?.denominator === ONE ? value.numerator : null
    })
  });
}

function initializeExactLogRationalState(
  state: ExactLogRationalState,
  base: Rational,
  argument: Rational
): void {
  if (
    state.baseNumerator === base.numerator &&
    state.baseDenominator === base.denominator &&
    state.argumentNumerator === argument.numerator &&
    state.argumentDenominator === argument.denominator
  ) {
    return;
  }

  const fresh = createExactLogRationalState();
  state.baseNumerator = base.numerator;
  state.baseDenominator = base.denominator;
  state.argumentNumerator = argument.numerator;
  state.argumentDenominator = argument.denominator;
  state.phase = fresh.phase;
  state.integerSearch = fresh.integerSearch;
  state.fractionalSearch = fresh.fractionalSearch;
  state.fractionalDenominator = fresh.fractionalDenominator;
  state.fractionalPowerDenominator = fresh.fractionalPowerDenominator;
  state.fractionalArgumentPower = fresh.fractionalArgumentPower;
  state.candidateCount = fresh.candidateCount;
  state.exactPowerChecks = fresh.exactPowerChecks;
  state.earlyAbortedPowerChecks = fresh.earlyAbortedPowerChecks;
  state.powerMultiplications = fresh.powerMultiplications;
  state.peakPowerComponentDigits = fresh.peakPowerComponentDigits;
  state.value = fresh.value;
  state.estimatedExponent = fresh.estimatedExponent;
}

function addExactIntegerLogMetrics(
  state: ExactLogRationalState,
  search: ExactIntegerLogSearchResult
): void {
  state.candidateCount += search.candidateCount;
  state.exactPowerChecks += search.exactPowerChecks;
  state.earlyAbortedPowerChecks += search.earlyAbortedPowerChecks;
  state.powerMultiplications += search.powerMultiplications;
  state.peakPowerComponentDigits = Math.max(
    state.peakPowerComponentDigits,
    search.peakPowerComponentDigits
  );
}

function exactLogResultFromState(state: ExactLogRationalState): {
  readonly value: Rational | null;
  readonly profile: ExactLogProfile;
} {
  return exactLogProfileResult(
    state.value,
    state.estimatedExponent,
    state.candidateCount,
    state.exactPowerChecks,
    state.earlyAbortedPowerChecks,
    state.powerMultiplications,
    state.peakPowerComponentDigits
  );
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
): {
  readonly interval: RationalInterval;
  readonly treeDepth: number;
  readonly peakBigIntDigits: number;
  readonly peakRetainedDigits: number;
} {
  if (factors.length === 0) {
    return Object.freeze({
      interval: createRationalInterval(RATIONAL_ONE, RATIONAL_ONE),
      treeDepth: 0,
      peakBigIntDigits: 1,
      peakRetainedDigits: 2
    });
  }

  let level = [...factors];
  let treeDepth = 0;
  let peakBigIntDigits = maxIntervalComponentDigits(level);
  let peakRetainedDigits = retainedIntervalDigits(level);
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
    peakBigIntDigits = Math.max(peakBigIntDigits, maxIntervalComponentDigits(level));
    peakRetainedDigits = Math.max(peakRetainedDigits, retainedIntervalDigits(level));
  }

  const interval = level[0];
  if (interval === undefined) {
    throw new InternalCalculationException("Balanced product result is missing");
  }
  return Object.freeze({ interval, treeDepth, peakBigIntDigits, peakRetainedDigits });
}

function maxIntervalComponentDigits(intervals: readonly RationalInterval[]): number {
  let maximum = 0;
  for (const interval of intervals) {
    maximum = Math.max(
      maximum,
      bigintDecimalDigits(interval.lower.numerator),
      bigintDecimalDigits(interval.lower.denominator),
      bigintDecimalDigits(interval.upper.numerator),
      bigintDecimalDigits(interval.upper.denominator)
    );
  }
  return maximum;
}

function retainedIntervalDigits(intervals: readonly RationalInterval[]): number {
  let total = 0;
  for (const interval of intervals) {
    total +=
      bigintDecimalDigits(interval.lower.numerator) +
      bigintDecimalDigits(interval.lower.denominator) +
      bigintDecimalDigits(interval.upper.numerator) +
      bigintDecimalDigits(interval.upper.denominator);
  }
  return total;
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
): bigint {
  const target = BigInt(shiftTarget);
  const lowerFloor = floorRational(argument.lower);
  const shift = target - lowerFloor;

  if (shift <= ZERO) {
    return ZERO;
  }

  return shift;
}

function safeGammaShiftNumber(shift: bigint): number {
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

function bernoulliNumber(index: number, control: EvaluationCheckpoint): Rational {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new InternalCalculationException("Bernoulli index must be a non-negative safe integer");
  }

  const state = getBernoulliCacheState(control);
  const cached = state.bernoulliCache[index];
  if (cached !== undefined) {
    return cached;
  }

  if (index > 1 && index % 2 === 1) {
    state.bernoulliCache[index] = RATIONAL_ZERO;
    state.retainedBigIntDigits += 2;
    return RATIONAL_ZERO;
  }

  const tangentOrder = index / 2;
  ensureTangentNumbers(state, tangentOrder, control);
  const tangent = state.tangentNumberCache[tangentOrder];
  if (tangent === undefined) {
    throw new InternalCalculationException("Tangent-number cache result is missing");
  }

  control.checkpoint();
  const order = BigInt(tangentOrder);
  const estimatedCoefficientDigits =
    retainedBernoulliBigIntDigits(state) +
    bigintDecimalDigits(tangent) +
    Math.ceil(index * LOG10_TWO) * 2 +
    8;
  control.guardBigIntDigits?.(estimatedCoefficientDigits);
  const powerOfTwo = ONE << BigInt(index);
  // Exact tangent-number identity:
  // B_(2n) = (-1)^(n-1) n*T_n / (2^(2n-1) * (2^(2n)-1)).
  const numerator = order % TWO === ONE ? order * tangent : -(order * tangent);
  const denominator = (powerOfTwo / TWO) * (powerOfTwo - ONE);
  const result = createRational(numerator, denominator);
  state.bernoulliCache[index] = result;
  state.retainedBigIntDigits +=
    bigintDecimalDigits(result.numerator) + bigintDecimalDigits(result.denominator);
  return result;
}

function ensureTangentNumbers(
  state: BernoulliCacheState,
  order: number,
  control: EvaluationCheckpoint
): void {
  while (state.tangentNumberCache.length <= order) {
    const currentOrder = state.tangentNumberCache.length;
    if (state.pendingTangentNumber === null) {
      state.pendingTangentNumber = {
        order: currentOrder,
        index: 1,
        binomial: BigInt(2 * currentOrder - 2),
        sum: ZERO
      };
      state.retainedBigIntDigits += bigintDecimalDigits(state.pendingTangentNumber.binomial) + 1;
    }

    const pending = state.pendingTangentNumber;
    if (pending.order !== currentOrder) {
      throw new InternalCalculationException("Tangent-number generation frontier is inconsistent");
    }

    while (pending.index < currentOrder) {
      // The pending convolution fields are updated only after this checkpoint,
      // so a soft timeout resumes at the same exact integer term.
      control.checkpoint();
      state.generationCheckpoints += 1;
      const left = state.tangentNumberCache[pending.index];
      const right = state.tangentNumberCache[currentOrder - pending.index];
      if (left === undefined || right === undefined) {
        throw new InternalCalculationException("Tangent-number cache prefix is incomplete");
      }

      const pendingProductDigits =
        bigintDecimalDigits(pending.binomial) +
        bigintDecimalDigits(left) +
        bigintDecimalDigits(right) +
        2;
      control.guardBigIntDigits?.(retainedBernoulliBigIntDigits(state) + pendingProductDigits);
      const previousPendingDigits =
        bigintDecimalDigits(pending.binomial) + bigintDecimalDigits(pending.sum);
      pending.sum += pending.binomial * left * right;
      state.convolutionProducts += 1;
      const binomialIndex = 2 * pending.index - 1;
      pending.index += 1;
      if (pending.index < currentOrder) {
        const total = 2 * currentOrder - 2;
        pending.binomial =
          (pending.binomial * BigInt(total - binomialIndex) * BigInt(total - binomialIndex - 1)) /
          BigInt((binomialIndex + 1) * (binomialIndex + 2));
      }
      state.retainedBigIntDigits +=
        bigintDecimalDigits(pending.binomial) +
        bigintDecimalDigits(pending.sum) -
        previousPendingDigits;
    }

    control.checkpoint();
    control.guardBigIntDigits?.(
      retainedBernoulliBigIntDigits(state) + bigintDecimalDigits(pending.sum)
    );
    state.tangentNumberCache.push(pending.sum);
    state.retainedBigIntDigits -= bigintDecimalDigits(pending.binomial);
    state.pendingTangentNumber = null;
  }
}

export function getBernoulliCacheSnapshot(control: EvaluationCheckpoint): BernoulliCacheSnapshot {
  const state = getBernoulliCacheState(control);
  return createBernoulliCacheSnapshot(state);
}

function createBernoulliCacheSnapshot(state: BernoulliCacheState): BernoulliCacheSnapshot {
  return Object.freeze({
    highestEvenIndex: (state.tangentNumberCache.length - 1) * 2,
    tangentNumbers: state.tangentNumberCache.length - 1,
    cachedBernoulliNumbers: state.bernoulliCache.reduce(
      (count, value) => count + (value === undefined ? 0 : 1),
      0
    ),
    convolutionProducts: state.convolutionProducts,
    generationCheckpoints: state.generationCheckpoints,
    retainedBigIntDigits: retainedBernoulliBigIntDigits(state),
    pendingOrder: state.pendingTangentNumber?.order ?? null
  });
}

function retainedBernoulliBigIntDigits(state: BernoulliCacheState): number {
  return state.retainedBigIntDigits;
}

function getBernoulliCacheState(control: EvaluationCheckpoint): BernoulliCacheState {
  const existing = BERNOULLI_STATE_BY_OWNER.get(control);
  if (existing !== undefined) return existing;
  const created: BernoulliCacheState = {
    bernoulliCache: [RATIONAL_ONE, createRational(-ONE, TWO), createRational(ONE, 6n)],
    tangentNumberCache: [ZERO, ONE],
    pendingTangentNumber: null,
    convolutionProducts: 0,
    generationCheckpoints: 0,
    retainedBigIntDigits: 8
  };
  BERNOULLI_STATE_BY_OWNER.set(control, created);
  return created;
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

function scaledNthRootFloor(
  value: Rational,
  degree: number,
  scaleDigits: number,
  initialUpper: bigint | undefined,
  control: EvaluationCheckpoint
): {
  readonly floor: bigint;
  readonly exact: boolean;
  readonly iterations: number;
  readonly peakBigIntDecimalDigits: number;
} {
  const scaledExponent = scaleDigits * degree;
  if (!Number.isSafeInteger(scaledExponent)) {
    throw new InternalCalculationException("nthRoot scaled exponent exceeds safe internal bounds");
  }

  const scaledNumerator = value.numerator * TEN ** BigInt(scaledExponent);
  const target = scaledNumerator / value.denominator;
  const peakBigIntDecimalDigits = Math.max(
    bigintDecimalDigits(scaledNumerator),
    bigintDecimalDigits(target)
  );
  if (target === ZERO) {
    return Object.freeze({
      floor: ZERO,
      exact: scaledNumerator === ZERO,
      iterations: 0,
      peakBigIntDecimalDigits
    });
  }

  const degreeBigInt = BigInt(degree);
  let current: bigint;
  if (
    initialUpper !== undefined &&
    initialUpper > ZERO &&
    compareBigIntPowerToLimit(initialUpper, degreeBigInt, target, control) >= 0
  ) {
    current = initialUpper;
  } else {
    const initialBits = Math.ceil(bigintBitLength(target) / degree);
    current = ONE << BigInt(initialBits);
  }

  let iterations = 0;
  for (;;) {
    control.checkpoint();
    iterations += 1;
    const divisorPower = bigIntPowerToLimit(current, degreeBigInt - ONE, target, control);
    const quotient = divisorPower === null ? ZERO : target / divisorPower;
    const next: bigint = ((degreeBigInt - ONE) * current + quotient) / degreeBigInt;
    if (next >= current) {
      break;
    }
    current = next;
  }

  while (compareBigIntPowerToLimit(current, degreeBigInt, target, control) > 0) {
    control.checkpoint();
    current -= ONE;
  }
  while (compareBigIntPowerToLimit(current + ONE, degreeBigInt, target, control) <= 0) {
    control.checkpoint();
    current += ONE;
  }

  const exactPower = bigIntPowerToLimit(current, degreeBigInt, target, control);
  return Object.freeze({
    floor: current,
    exact: exactPower !== null && exactPower * value.denominator === scaledNumerator,
    iterations,
    peakBigIntDecimalDigits
  });
}

function compareBigIntPowerToLimit(
  base: bigint,
  exponent: bigint,
  limit: bigint,
  control: EvaluationCheckpoint
): -1 | 0 | 1 {
  const value = bigIntPowerToLimit(base, exponent, limit, control);
  return value === null ? 1 : value < limit ? -1 : value > limit ? 1 : 0;
}

function bigIntPowerToLimit(
  base: bigint,
  exponent: bigint,
  limit: bigint,
  control: EvaluationCheckpoint
): bigint | null {
  let result = ONE;
  let factor = base;
  let remaining = exponent;

  while (remaining > ZERO) {
    control.checkpoint();
    if (remaining % TWO === ONE) {
      if (factor !== ZERO && result > limit / factor) return null;
      result *= factor;
    }
    remaining /= TWO;
    if (remaining > ZERO) {
      if (factor !== ZERO && factor > limit / factor) factor = limit + ONE;
      else factor *= factor;
    }
  }
  return result;
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
    degreeReductionCalls: profile.degreeReductionCalls,
    degreeOriginalMagnitudeDigits: profile.degreeOriginalMagnitudeDigits,
    degreeReducedMagnitudeDigits: profile.degreeReducedMagnitudeDigits,
    piRequestedDigits: profile.piRequestedDigits,
    sincosIntervalEvaluations: profile.sincosIntervalEvaluations,
    selectiveIntervalEvaluations: profile.selectiveIntervalEvaluations,
    pointEvaluations: profile.pointEvaluations,
    sharedSquareEvaluations: profile.sharedSquareEvaluations,
    sinSeriesEvaluations: profile.sinSeriesEvaluations,
    cosSeriesEvaluations: profile.cosSeriesEvaluations,
    independentSeriesEvaluations: profile.independentSeriesEvaluations,
    tanEndpointHullEvaluations: profile.tanEndpointHullEvaluations,
    tanIntervalDivisionEvaluations: profile.tanIntervalDivisionEvaluations,
    poleRejections: profile.poleRejections,
    scaleDigits: profile.scaleDigits,
    peakBigIntDecimalDigits: profile.peakBigIntDecimalDigits,
    resultDenominatorDecimalDigits:
      result === null ? 0 : maxRationalDenominatorDecimalDigits(result)
  });
}

function createMutableTrigSeriesProfile(): MutableTrigSeriesProfile {
  return {
    rangeReductionCalls: 0,
    degreeReductionCalls: 0,
    degreeOriginalMagnitudeDigits: 0,
    degreeReducedMagnitudeDigits: 0,
    piRequestedDigits: 0,
    sincosIntervalEvaluations: 0,
    selectiveIntervalEvaluations: 0,
    pointEvaluations: 0,
    sharedSquareEvaluations: 0,
    sinSeriesEvaluations: 0,
    cosSeriesEvaluations: 0,
    independentSeriesEvaluations: 0,
    tanEndpointHullEvaluations: 0,
    tanIntervalDivisionEvaluations: 0,
    poleRejections: 0,
    scaleDigits: 0,
    peakBigIntDecimalDigits: 0
  };
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

function bigintToGuardDigits(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
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
  usedReflection = false,
  halfIntegerPlan: HalfIntegerGammaPlan = createHalfIntegerGammaPlan(
    "not-half-integer",
    ZERO,
    workingDigits
  ),
  recurrenceProductPeakBigIntDigits = 0,
  recurrenceProductPeakRetainedDigits = 0
): GammaComputationProfile {
  return Object.freeze({
    workingDigits,
    shift,
    recurrenceFactors,
    recurrenceTreeDepth,
    correctionTerms,
    highestBernoulliIndex: correctionTerms === 0 ? 0 : 2 * (correctionTerms + 1),
    usedHalfIntegerPath,
    usedReflection,
    halfIntegerStrategy: halfIntegerPlan.strategy,
    halfIntegerRecurrenceSteps: halfIntegerPlan.recurrenceSteps,
    recurrenceProductPeakBigIntDigits,
    recurrenceProductPeakRetainedDigits,
    resultSignificandBits: 0,
    resultExponentMagnitude: ZERO
  });
}

function withGammaBallMagnitude(
  profile: GammaComputationProfile,
  ball: Ball
): GammaComputationProfile {
  const exponentMagnitude =
    ball.center.exponent < ZERO ? -ball.center.exponent : ball.center.exponent;
  return Object.freeze({
    ...profile,
    resultSignificandBits: Math.max(
      bigintBitLength(ball.center.significand),
      bigintBitLength(ball.radius.significand)
    ),
    resultExponentMagnitude: exponentMagnitude
  });
}

function createHalfIntegerGammaPlan(
  strategy: HalfIntegerGammaStrategy,
  recurrenceSteps: bigint,
  decimalDigits: number
): HalfIntegerGammaPlan {
  const recurrenceBudget = BigInt(Math.max(32, decimalDigits * 2 + 32));
  return Object.freeze({
    strategy,
    recurrenceSteps,
    recurrenceBudget,
    estimatedRecurrenceCost: ZERO,
    estimatedGeneralCost: BigInt(Math.max(1, decimalDigits)) * BigInt(decimalDigits + 64)
  });
}

function withHalfIntegerPlan(
  result: { readonly interval: RationalInterval | null; readonly profile: GammaComputationProfile },
  plan: HalfIntegerGammaPlan
): { readonly interval: RationalInterval | null; readonly profile: GammaComputationProfile } {
  return Object.freeze({
    interval: result.interval,
    profile: Object.freeze({
      ...result.profile,
      usedHalfIntegerPath: false,
      halfIntegerStrategy: plan.strategy,
      halfIntegerRecurrenceSteps: plan.recurrenceSteps
    })
  });
}
