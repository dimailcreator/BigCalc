import type { BigFloatBackend } from "../backend/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import type {
  EvaluationCheckpoint,
  EvaluationContext,
  PrecisionRequest
} from "../evaluation/contracts.js";
import { verifiedNumberFromBall } from "../formatting/verified-number.js";
import { createInternalInterval, intervalToBall } from "../values/ball.js";
import type { Ball, LazyReal, Rational } from "../values/contracts.js";
import {
  addRational,
  compareRational,
  createRational,
  divideRational,
  integerRational,
  multiplyRational,
  subtractRational
} from "../values/rational.js";
import {
  ceilDiv,
  createScaledInterval,
  decimalScale,
  rescaleScaled,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";
import type { ScaledInterval } from "./scaled-interval.js";
import { SplittingLn2Provider } from "./ln2-splitting.js";
import { piProduct, countPiSqrt } from "./pi-instrumentation.js";
import { AgmPiProvider } from "./pi-agm.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const THREE = 3n;
const FOUR = 4n;
const NINE = 9n;
const CHUDNOVSKY_A = 13_591_409n;
const CHUDNOVSKY_B = 545_140_134n;
const CHUDNOVSKY_C3_OVER_24 = 10_939_058_860_032_000n;
const CHUDNOVSKY_SQRT_FACTOR = 426_880n;
const CHUDNOVSKY_RADICAND = 10_005n;
// For consecutive absolute Chudnovsky terms, the three factorial ratios are
// < 6*2*6 and the linear coefficient ratio is < 42. Their product divided by
// C^3/24 is < 10^-12, so nextTerm/(1-10^-12) is a rigorous total-tail bound.
const CHUDNOVSKY_RATIO_DENOMINATOR = 1_000_000_000_000n;
const CHUDNOVSKY_BLOCK_SIZE = 4;
const CONSTANT_GUARD_DIGITS = 8;

interface GraphLikeEvaluationContext extends EvaluationContext, EvaluationCheckpoint {
  readonly backend: BigFloatBackend;
}

interface ConstantLazyRealStateSnapshot {
  readonly name: "π" | "e";
  readonly refinementCalls: number;
  readonly highestRequestedDigits: number;
  readonly completedTerms: number;
  readonly lastRefinementAddedTerms?: number;
  readonly lastRefinementReusedTerms?: number;
  readonly lastTargetTermCount?: number;
  readonly peakBigIntDigits?: number;
  readonly cachedBigIntDigits?: number;
}

export interface PiProviderStateSnapshot {
  readonly algorithm: "chudnovsky-binary-splitting";
  readonly intervalRequests: number;
  readonly cacheHits: number;
  readonly userRequestedDigits: number | null;
  readonly providerWorkingDigits: number;
  readonly highestUserRequestedDigits: number;
  readonly highestProviderWorkingDigits: number;
  readonly completedTerms: number;
  readonly completedBlocks: number;
  readonly retainedSplitNodes: number;
  readonly splitStateBigIntCount: number;
  readonly splitStateBigIntDigits: number;
  readonly tailCoefficientSource: "split-levels";
  readonly tailStateBigIntCount: 0;
  readonly sqrtRefinementCalls: number;
  readonly sqrtReuseCount: number;
  readonly sqrtWorkingDigits: number;
  readonly sqrtNewtonIterations: number;
  readonly sqrtInterval: PiRationalInterval | null;
  readonly peakBigIntDigits: number;
  readonly cachedBigIntDigits: number;
}

export interface PiTailBoundSnapshot {
  readonly completedTerms: number;
  readonly coefficientSource: "split-levels";
  readonly bound: Rational;
}

export interface Ln2ProviderStateSnapshot {
  readonly intervalRequests: number;
  readonly cacheHits: number;
  readonly highestRequestedDigits: number;
  readonly completedTerms: number;
  readonly lastRefinementAddedTerms: number;
  readonly summationPasses: number;
  readonly retainedGrowingDenominators: 0;
  readonly recurrenceStateBigIntCount: 1;
  readonly peakBigIntDigits: number;
  readonly cachedBigIntDigits: number;
}

export interface PiRationalInterval {
  readonly lower: Rational;
  readonly upper: Rational;
}

type StatefulConstantLazyReal = LazyReal & {
  getStateSnapshot(): ConstantLazyRealStateSnapshot;
};

interface BinarySplit {
  readonly p: bigint;
  readonly q: bigint;
  readonly t: bigint;
}

interface CachedBinarySplit extends BinarySplit {
  readonly start: number;
  readonly end: number;
}

interface ChudnovskyTailBound {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface SqrtStateSnapshot {
  readonly refinementCalls: number;
  readonly reuseCount: number;
  readonly workingDigits: number;
  readonly totalNewtonIterations: number;
  readonly interval: PiRationalInterval | null;
  readonly peakBigIntDigits: number;
  readonly cachedBigIntDigits: number;
}

const contextConstants = new WeakMap<EvaluationContext, Map<string, StatefulConstantLazyReal>>();
const contextPiProviders = new WeakMap<EvaluationContext, PiProviderState>();
const contextAgmPiProviders = new WeakMap<EvaluationContext, AgmPiProvider>();
const piSelection = new WeakMap<EvaluationContext, "chudnovsky" | "agm">();
// Measured AR-7 crossover; requests below this keep the established baseline.
export const AGM_PI_THRESHOLD = 3000;
const contextLn2Providers = new WeakMap<object, SplittingLn2Provider>();

export function createBuiltinConstantValue(name: "π" | "e", context: EvaluationContext): LazyReal {
  let constants = contextConstants.get(context);
  if (constants === undefined) {
    constants = new Map();
    contextConstants.set(context, constants);
  }

  const existing = constants.get(name);
  if (existing !== undefined) return existing;

  const created = name === "π" ? new PiLazyReal(context) : new ELazyReal();
  constants.set(name, created);
  return created;
}

class ELazyReal implements StatefulConstantLazyReal {
  readonly kind = "lazy-real";
  private refinementCalls = 0;
  private highestRequestedDigits = 0;
  private completedTermCount = 0;
  private partialNumerator = ZERO;
  private partialDenominator = ONE;
  private log10CompletedFactorial = 0;
  private lastRefinementAddedTerms = 0;
  private lastRefinementReusedTerms = 0;
  private lastTargetTermCount = 0;
  private peakBigIntDigits = 1;

  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
    const graphContext = requireGraphLikeContext(context);
    this.refinementCalls += 1;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);
    const before = this.completedTermCount;
    this.lastRefinementReusedTerms = before;
    let targetTailDigits = request.significantDigits + CONSTANT_GUARD_DIGITS;

    for (;;) {
      graphContext.checkpoint();
      const targetTermCount = this.estimateTargetTermCount(targetTailDigits);
      this.generateTerms(targetTermCount - this.completedTermCount, graphContext);
      while (!this.tailFits(targetTailDigits)) this.generateTerms(1, graphContext);
      this.lastTargetTermCount = this.completedTermCount;

      const precisionBits = precisionBitsForConstantDigits(request.significantDigits);
      const ball = this.currentBall(precisionBits, graphContext.backend);
      const verified = verifiedNumberFromBall(ball, request, graphContext.backend, graphContext);
      this.lastRefinementAddedTerms = this.completedTermCount - before;
      if (verified.verifiedDigits >= request.significantDigits) return Promise.resolve(ball);

      targetTailDigits += Math.max(
        CONSTANT_GUARD_DIGITS,
        request.significantDigits - verified.verifiedDigits
      );
    }
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    return Object.freeze({
      name: "e",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTermCount,
      lastRefinementAddedTerms: this.lastRefinementAddedTerms,
      lastRefinementReusedTerms: this.lastRefinementReusedTerms,
      lastTargetTermCount: this.lastTargetTermCount,
      peakBigIntDigits: this.peakBigIntDigits,
      cachedBigIntDigits:
        bigintDecimalDigits(this.partialNumerator) + bigintDecimalDigits(this.partialDenominator)
    });
  }

  private estimateTargetTermCount(targetTailDigits: number): number {
    // Logs choose a useful extension chunk only; tailFits performs the exact bigint proof.
    let candidate = this.completedTermCount;
    let log10Factorial = this.log10CompletedFactorial;
    const target = targetTailDigits + Math.log10(2);
    while (log10Factorial < target) {
      candidate += 1;
      log10Factorial += Math.log10(candidate);
    }
    return candidate;
  }

  private generateTerms(count: number, context: GraphLikeEvaluationContext): void {
    for (let index = 0; index < count; index += 1) {
      context.checkpoint();
      const termIndex = BigInt(this.completedTermCount);
      if (termIndex === ZERO) {
        this.partialNumerator = ONE;
      } else {
        this.partialDenominator *= termIndex;
        this.partialNumerator = this.partialNumerator * termIndex + ONE;
      }
      this.completedTermCount += 1;
      this.log10CompletedFactorial += Math.log10(this.completedTermCount);
      this.peakBigIntDigits = Math.max(
        this.peakBigIntDigits,
        bigintDecimalDigits(this.partialNumerator),
        bigintDecimalDigits(this.partialDenominator)
      );
    }
  }

  private tailFits(targetDigits: number): boolean {
    const tailDenominator = this.partialDenominator * BigInt(Math.max(1, this.completedTermCount));
    const targetScale = TWO * decimalScale(targetDigits);
    this.recordPeak(tailDenominator, targetScale);
    return targetScale <= tailDenominator;
  }

  private currentBall(precisionBits: number, backend: BigFloatBackend): Ball {
    const termCount = BigInt(Math.max(1, this.completedTermCount));
    const denominator = this.partialDenominator * termCount;
    const lowerNumerator = this.partialNumerator * termCount;
    this.recordPeak(denominator, lowerNumerator, lowerNumerator + TWO);
    return ballFromRationalInterval(
      createRational(lowerNumerator, denominator),
      createRational(lowerNumerator + TWO, denominator),
      precisionBits,
      backend
    );
  }

  private recordPeak(...values: readonly bigint[]): void {
    for (const value of values) {
      this.peakBigIntDigits = Math.max(this.peakBigIntDigits, bigintDecimalDigits(value));
    }
  }
}

class PiLazyReal implements StatefulConstantLazyReal {
  readonly kind = "lazy-real";
  private refinementCalls = 0;
  private highestRequestedDigits = 0;

  constructor(private readonly owner: EvaluationContext) {}

  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
    const graphContext = requireGraphLikeContext(context);
    this.refinementCalls += 1;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);
    const precisionBits = precisionBitsForConstantDigits(request.significantDigits);
    let decimalDigits = request.significantDigits + CONSTANT_GUARD_DIGITS;

    for (;;) {
      graphContext.checkpoint();
      const interval = getPiRationalInterval(
        graphContext,
        decimalDigits,
        request.significantDigits
      );
      const ball = ballFromRationalInterval(
        interval.lower,
        interval.upper,
        precisionBits,
        graphContext.backend
      );
      const verified = verifiedNumberFromBall(ball, request, graphContext.backend, graphContext);
      if (verified.verifiedDigits >= request.significantDigits) return Promise.resolve(ball);
      decimalDigits += Math.max(
        CONSTANT_GUARD_DIGITS,
        request.significantDigits - verified.verifiedDigits
      );
    }
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    const provider = getPiComputationSnapshot(this.owner);
    return Object.freeze({
      name: "π",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: provider.termCount
    });
  }
}

export function getPiRationalInterval(
  context: EvaluationContext,
  decimalDigits: number,
  userRequestedDigits: number | null = null
): PiRationalInterval {
  let agm = contextAgmPiProviders.get(context);
  if (decimalDigits >= AGM_PI_THRESHOLD || agm?.canServe(decimalDigits)) {
    if (agm === undefined) {
      agm = new AgmPiProvider();
      contextAgmPiProviders.set(context, agm);
    }
    const control = requireGraphLikeContext(context);
    // A strategy switch retains the old split tree and pending carry.
    control.guardBigIntDigits?.(
      96 * Math.max(decimalDigits + 32, agm.getSnapshot().workingDigits) +
        agm.getSnapshot().retainedBigIntDigits +
        (contextPiProviders.get(context)?.getSnapshot().cachedBigIntDigits ?? 0)
    );
    piSelection.set(context, "agm");
    return agm.getInterval(decimalDigits, control);
  }
  piSelection.set(context, "chudnovsky");
  return getChudnovskyPiRationalInterval(context, decimalDigits, userRequestedDigits);
}

/** Explicit baseline entrypoint for differential tests and algorithm experiments. */
export function getChudnovskyPiRationalInterval(
  context: EvaluationContext,
  decimalDigits: number,
  userRequestedDigits: number | null = null
): PiRationalInterval {
  return getOrCreatePiProvider(context).getInterval(
    decimalDigits,
    requireGraphLikeContext(context),
    userRequestedDigits
  );
}

/** Selected production strategy, with metrics kept distinct from baseline diagnostics. */
export function getPiComputationSnapshot(context: EvaluationContext) {
  const chudnovsky = contextPiProviders.get(context)?.getSnapshot();
  const agm = contextAgmPiProviders.get(context)?.getSnapshot();
  const retainedBigIntDigits =
    (chudnovsky?.cachedBigIntDigits ?? 0) + (agm?.retainedBigIntDigits ?? 0);
  // Cumulative work units cannot decrease when the selected family changes.
  const termCount = (chudnovsky?.completedTerms ?? 0) + (agm?.iterations ?? 0);
  const peakBigIntDigits = Math.max(chudnovsky?.peakBigIntDigits ?? 0, agm?.peakBigIntDigits ?? 0);
  if (piSelection.get(context) === "agm" && agm !== undefined)
    return {
      algorithm: "gauss-legendre-agm" as const,
      workingDigits: agm.workingDigits,
      termCount,
      blockCount: null,
      peakBigIntDigits,
      retainedBigIntDigits,
      stateReuse: agm.cacheHits
    };
  return {
    algorithm: "chudnovsky-binary-splitting" as const,
    workingDigits: chudnovsky?.highestProviderWorkingDigits ?? 0,
    termCount,
    blockCount: chudnovsky?.completedBlocks ?? 0,
    peakBigIntDigits,
    retainedBigIntDigits,
    stateReuse: chudnovsky?.sqrtReuseCount ?? 0
  };
}

export function getPiProviderStateSnapshot(context: EvaluationContext): PiProviderStateSnapshot {
  return getOrCreatePiProvider(context).getSnapshot();
}

export function getPiTailBoundSnapshot(context: EvaluationContext): PiTailBoundSnapshot {
  return getOrCreatePiProvider(context).getTailBoundSnapshot(requireGraphLikeContext(context));
}

export function getLn2RationalInterval(
  context: EvaluationCheckpoint,
  decimalDigits: number
): PiRationalInterval {
  return getOrCreateLn2Provider(context).getInterval(decimalDigits, context);
}

export function getLn2ProviderStateSnapshot(
  context: EvaluationCheckpoint
): ReturnType<SplittingLn2Provider["getSnapshot"]> {
  return getOrCreateLn2Provider(context).getSnapshot();
}

class PiProviderState {
  private intervalRequests = 0;
  private cacheHits = 0;
  private userRequestedDigits: number | null = null;
  private providerWorkingDigits = 0;
  private highestUserRequestedDigits = 0;
  private highestProviderWorkingDigits = 0;
  private highestOutputDigits = 0;
  private completedTermCount = 0;
  private completedBlockCount = 0;
  private cachedInterval: PiRationalInterval | null = null;
  private readonly splitLevels: (CachedBinarySplit | undefined)[] = [];
  private pendingCarry: CachedBinarySplit | null = null;
  private pendingLevel = 0;
  private readonly sqrtState = new ScaledSqrtState();
  private peakBigIntDigits = 1;

  getInterval(
    decimalDigits: number,
    context: GraphLikeEvaluationContext,
    userRequestedDigits: number | null = null
  ): PiRationalInterval {
    const digits = Math.max(1, decimalDigits);
    const workingDigits = digits + CONSTANT_GUARD_DIGITS;
    this.intervalRequests += 1;
    this.userRequestedDigits = userRequestedDigits;
    this.providerWorkingDigits = workingDigits;
    this.highestUserRequestedDigits = Math.max(
      this.highestUserRequestedDigits,
      userRequestedDigits ?? 0
    );
    this.highestProviderWorkingDigits = Math.max(this.highestProviderWorkingDigits, workingDigits);

    if (this.cachedInterval !== null && digits <= this.highestOutputDigits) {
      this.cacheHits += 1;
      return this.cachedInterval;
    }

    let split: BinarySplit;
    let tail: ChudnovskyTailBound;
    for (;;) {
      if (this.completedTermCount === 0) this.appendBlock(context);
      split = this.combinedSplit(context);
      tail = this.tailBoundFromSplit(split);
      if (this.tailFits(tail, workingDigits, context)) break;
      this.appendBlock(context);
    }

    const interval = this.computePiInterval(digits, workingDigits, split, tail, context);
    this.highestOutputDigits = digits;
    this.cachedInterval = interval;
    return interval;
  }

  getSnapshot(): PiProviderStateSnapshot {
    const retainedSplits = this.splitLevels.filter(
      (split): split is CachedBinarySplit => split !== undefined
    );
    const splitStateBigIntDigits = retainedSplits.reduce(
      (total, split) =>
        total +
        bigintDecimalDigits(split.p) +
        bigintDecimalDigits(split.q) +
        bigintDecimalDigits(split.t),
      0
    );
    const pendingDigits =
      this.pendingCarry === null
        ? 0
        : bigintDecimalDigits(this.pendingCarry.p) +
          bigintDecimalDigits(this.pendingCarry.q) +
          bigintDecimalDigits(this.pendingCarry.t);
    const sqrt = this.sqrtState.getSnapshot();
    const cachedIntervalDigits = rationalIntervalBigIntDigits(this.cachedInterval);

    return Object.freeze({
      algorithm: "chudnovsky-binary-splitting",
      intervalRequests: this.intervalRequests,
      cacheHits: this.cacheHits,
      userRequestedDigits: this.userRequestedDigits,
      providerWorkingDigits: this.providerWorkingDigits,
      highestUserRequestedDigits: this.highestUserRequestedDigits,
      highestProviderWorkingDigits: this.highestProviderWorkingDigits,
      completedTerms: this.completedTermCount,
      completedBlocks: this.completedBlockCount,
      retainedSplitNodes: retainedSplits.length,
      splitStateBigIntCount: retainedSplits.length * 3,
      splitStateBigIntDigits,
      tailCoefficientSource: "split-levels",
      tailStateBigIntCount: 0,
      sqrtRefinementCalls: sqrt.refinementCalls,
      sqrtReuseCount: sqrt.reuseCount,
      sqrtWorkingDigits: sqrt.workingDigits,
      sqrtNewtonIterations: sqrt.totalNewtonIterations,
      sqrtInterval: sqrt.interval,
      peakBigIntDigits: Math.max(this.peakBigIntDigits, sqrt.peakBigIntDigits),
      cachedBigIntDigits:
        splitStateBigIntDigits + pendingDigits + sqrt.cachedBigIntDigits + cachedIntervalDigits
    });
  }

  getTailBoundSnapshot(context: EvaluationCheckpoint): PiTailBoundSnapshot {
    if (this.completedTermCount === 0) {
      throw new InternalCalculationException("Chudnovsky tail is unavailable before refinement");
    }
    const split = this.combinedSplit(context);
    const tail = this.tailBoundFromSplit(split);
    return Object.freeze({
      completedTerms: this.completedTermCount,
      coefficientSource: "split-levels",
      bound: this.tailBoundRational(tail)
    });
  }

  private appendBlock(context: GraphLikeEvaluationContext): void {
    const start = this.completedTermCount;
    const end = start + CHUDNOVSKY_BLOCK_SIZE;
    if (this.pendingCarry === null) {
      this.pendingCarry = Object.freeze({ ...binarySplit(start, end, context), start, end });
      this.pendingLevel = 0;
      this.recordPeak(this.pendingCarry.p, this.pendingCarry.q, this.pendingCarry.t);
    }
    this.appendSplitLevel(context);
    this.completedTermCount = end;
    this.completedBlockCount += 1;
  }

  private appendSplitLevel(context: EvaluationCheckpoint): void {
    let carry = this.pendingCarry;
    if (carry === null) throw new InternalCalculationException("Missing Chudnovsky carry");
    while (this.splitLevels[this.pendingLevel] !== undefined) {
      context.checkpoint();
      const left = this.splitLevels[this.pendingLevel];
      if (left === undefined) break;
      carry = Object.freeze({
        ...combineBinarySplits(left, carry, context),
        start: left.start,
        end: carry.end
      });
      this.recordPeak(carry.p, carry.q, carry.t);
      // Retain both the old committed tree and the resumable new carry.
      // Publishing a partially cleared tree would corrupt the sum after pause.
      this.pendingCarry = carry;
      this.pendingLevel += 1;
    }
    for (let level = 0; level < this.pendingLevel; level++) this.splitLevels[level] = undefined;
    this.splitLevels[this.pendingLevel] = carry;
    this.pendingCarry = null;
    this.pendingLevel = 0;
  }

  private combinedSplit(context: EvaluationCheckpoint): BinarySplit {
    let combined: CachedBinarySplit | null = null;
    for (let level = this.splitLevels.length - 1; level >= 0; level -= 1) {
      const split = this.splitLevels[level];
      if (split === undefined) continue;
      context.checkpoint();
      combined =
        combined === null
          ? split
          : Object.freeze({
              ...combineBinarySplits(combined, split, context),
              start: combined.start,
              end: split.end
            });
      this.recordPeak(combined.p, combined.q, combined.t);
    }
    if (combined === null) {
      throw new InternalCalculationException("Chudnovsky state has no completed block");
    }
    return combined;
  }

  private tailBoundFromSplit(split: BinarySplit): ChudnovskyTailBound {
    const index = BigInt(this.completedTermCount);
    const nextP = (6n * index - 5n) * (2n * index - ONE) * (6n * index - ONE);
    const nextQ = index * index * index * CHUDNOVSKY_C3_OVER_24;
    const numerator =
      split.p * nextP * (CHUDNOVSKY_A + CHUDNOVSKY_B * index) * CHUDNOVSKY_RATIO_DENOMINATOR;
    const denominator = split.q * nextQ * (CHUDNOVSKY_RATIO_DENOMINATOR - ONE);
    this.recordPeak(numerator, denominator);
    return Object.freeze({ numerator, denominator });
  }

  private tailBoundRational(tail: ChudnovskyTailBound): Rational {
    return createRational(tail.numerator, tail.denominator);
  }

  private tailFits(
    tail: ChudnovskyTailBound,
    decimalDigits: number,
    context: EvaluationCheckpoint
  ): boolean {
    const scaledNumerator = piProduct(tail.numerator, decimalScale(decimalDigits), context);
    this.recordPeak(scaledNumerator);
    return scaledNumerator <= tail.denominator;
  }

  private recordPeak(...values: readonly bigint[]): void {
    for (const value of values) {
      this.peakBigIntDigits = Math.max(this.peakBigIntDigits, bigintDecimalDigits(value));
    }
  }

  private computePiInterval(
    digits: number,
    workingDigits: number,
    split: BinarySplit,
    tailData: ChudnovskyTailBound,
    context: GraphLikeEvaluationContext
  ): PiRationalInterval {
    const sum = createRational(split.t, split.q);
    const tail = this.tailBoundRational(tailData);
    const sumLower = subtractRational(sum, tail);
    const sumUpper = addRational(sum, tail);
    if (compareRational(sumLower, integerRational(ZERO)) <= 0) {
      throw new InternalCalculationException("Chudnovsky reciprocal-pi interval crossed zero");
    }

    const sqrt = this.sqrtState.refine(CHUDNOVSKY_RADICAND, workingDigits, context);
    const factor = integerRational(CHUDNOVSKY_SQRT_FACTOR);
    const rawLower = divideRational(multiplyRational(factor, sqrt.lower), sumUpper);
    const rawUpper = divideRational(multiplyRational(factor, sqrt.upper), sumLower);
    return scaledIntervalToRationalBounds(
      scaledIntervalFromRationalBounds({ lower: rawLower, upper: rawUpper }, digits + 2)
    );
  }
}

// Kept as an independent summation layout for AR-1 differential benchmarks.
export class SequentialLn2Provider {
  private intervalRequests = 0;
  private cacheHits = 0;
  private highestRequestedDigits = 0;
  private completedTerms = 0;
  private lastRefinementAddedTerms = 0;
  private summationPasses = 0;
  private peakBigIntDigits = 1;
  private cachedInterval: PiRationalInterval | null = null;
  private nextPowerDenominator = THREE;

  getInterval(decimalDigits: number, context: EvaluationCheckpoint): PiRationalInterval {
    const digits = Math.max(1, decimalDigits);
    this.intervalRequests += 1;
    if (this.cachedInterval !== null && digits <= this.highestRequestedDigits) {
      this.cacheHits += 1;
      this.lastRefinementAddedTerms = 0;
      return this.cachedInterval;
    }

    const tailDigits = digits + 2;
    const previousCompletedTerms = this.completedTerms;
    while (!this.tailFits(tailDigits)) {
      context.checkpoint();
      this.nextPowerDenominator *= NINE;
      this.completedTerms += 1;
    }
    this.lastRefinementAddedTerms = this.completedTerms - previousCompletedTerms;

    const workingDigits = digits + this.completedTerms.toString().length + 3;
    const scale = decimalScale(workingDigits);
    let lower = ZERO;
    let upper = ZERO;
    let powerDenominator = THREE;
    this.summationPasses += 1;
    for (let index = 0; index < this.completedTerms; index += 1) {
      context.checkpoint();
      const denominator = powerDenominator * (TWO * BigInt(index) + ONE);
      lower += scale / denominator;
      upper += ceilDiv(scale, denominator);
      powerDenominator *= NINE;
      this.peakBigIntDigits = Math.max(
        this.peakBigIntDigits,
        bigintDecimalDigits(denominator),
        bigintDecimalDigits(lower),
        bigintDecimalDigits(upper)
      );
    }

    const nextIndex = BigInt(this.completedTerms);
    const tailUpper = ceilDiv(
      NINE * scale,
      FOUR * this.nextPowerDenominator * (TWO * nextIndex + ONE)
    );
    const raw = scaledIntervalToRationalBounds(
      createScaledInterval(TWO * lower, TWO * upper + tailUpper, workingDigits)
    );
    this.cachedInterval = scaledIntervalToRationalBounds(
      scaledIntervalFromRationalBounds(raw, digits + 2)
    );
    this.highestRequestedDigits = digits;
    return this.cachedInterval;
  }

  getSnapshot(): Ln2ProviderStateSnapshot {
    return Object.freeze({
      intervalRequests: this.intervalRequests,
      cacheHits: this.cacheHits,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTerms,
      lastRefinementAddedTerms: this.lastRefinementAddedTerms,
      summationPasses: this.summationPasses,
      retainedGrowingDenominators: 0,
      recurrenceStateBigIntCount: 1,
      peakBigIntDigits: this.peakBigIntDigits,
      cachedBigIntDigits:
        bigintDecimalDigits(this.nextPowerDenominator) +
        rationalIntervalBigIntDigits(this.cachedInterval)
    });
  }

  private tailFits(decimalDigits: number): boolean {
    const nextIndex = BigInt(this.completedTerms);
    // ln(2)=2*sum(1/((2k+1)3^(2k+1))); bounding later odd denominators by
    // the first omitted one turns the remaining powers into a geometric 1/9 tail.
    const denominator = FOUR * this.nextPowerDenominator * (TWO * nextIndex + ONE);
    return NINE * decimalScale(decimalDigits) <= denominator;
  }
}

function binarySplit(start: number, end: number, context: EvaluationCheckpoint): BinarySplit {
  context.checkpoint();
  if (end - start === 1) {
    if (start === 0) return Object.freeze({ p: ONE, q: ONE, t: CHUDNOVSKY_A });
    const k = BigInt(start);
    const p = (6n * k - 5n) * (2n * k - ONE) * (6n * k - ONE);
    const q = k * k * k * CHUDNOVSKY_C3_OVER_24;
    const magnitude = p * (CHUDNOVSKY_A + CHUDNOVSKY_B * k);
    return Object.freeze({ p, q, t: start % 2 === 0 ? magnitude : -magnitude });
  }

  const middle = Math.floor((start + end) / 2);
  return combineBinarySplits(
    binarySplit(start, middle, context),
    binarySplit(middle, end, context),
    context
  );
}

function combineBinarySplits(
  left: BinarySplit,
  right: BinarySplit,
  context: EvaluationCheckpoint
): BinarySplit {
  return Object.freeze({
    p: piProduct(left.p, right.p, context),
    q: piProduct(left.q, right.q, context),
    t: piProduct(left.t, right.q, context) + piProduct(left.p, right.t, context)
  });
}

class ScaledSqrtState {
  private interval: ScaledInterval | null = null;
  private refinementCalls = 0;
  private reuseCount = 0;
  private workingDigits = 0;
  private totalNewtonIterations = 0;
  private peakBigIntDigits = 1;

  refine(radicand: bigint, scaleDigits: number, context: EvaluationCheckpoint): PiRationalInterval {
    this.refinementCalls += 1;
    if (this.interval !== null && scaleDigits <= this.workingDigits) {
      this.reuseCount += 1;
      return scaledIntervalToRationalBounds(this.interval);
    }

    const previous = this.interval === null ? null : rescaleScaled(this.interval, scaleDigits);
    if (previous !== null) this.reuseCount += 1;

    const scale = decimalScale(scaleDigits);
    countPiSqrt(context);
    const scaledRadicand = piProduct(radicand * scale, scale, context);
    const result = integerSqrtFloor(scaledRadicand, context, previous?.upper);
    const computedUpper =
      piProduct(result.root, result.root, context) === scaledRadicand
        ? result.root
        : result.root + ONE;
    const lower = previous === null ? result.root : maxBigInt(result.root, previous.lower);
    const upper = previous === null ? computedUpper : minBigInt(computedUpper, previous.upper);
    this.interval = createScaledInterval(lower, upper, scaleDigits);
    this.workingDigits = scaleDigits;
    this.totalNewtonIterations += result.iterations;
    this.peakBigIntDigits = Math.max(
      this.peakBigIntDigits,
      bigintDecimalDigits(scaledRadicand),
      bigintDecimalDigits(lower),
      bigintDecimalDigits(upper)
    );
    return scaledIntervalToRationalBounds(this.interval);
  }

  getSnapshot(): SqrtStateSnapshot {
    return Object.freeze({
      refinementCalls: this.refinementCalls,
      reuseCount: this.reuseCount,
      workingDigits: this.workingDigits,
      totalNewtonIterations: this.totalNewtonIterations,
      interval: this.interval === null ? null : scaledIntervalToRationalBounds(this.interval),
      peakBigIntDigits: this.peakBigIntDigits,
      cachedBigIntDigits:
        this.interval === null
          ? 0
          : bigintDecimalDigits(this.interval.lower) + bigintDecimalDigits(this.interval.upper)
    });
  }
}

function integerSqrtFloor(
  value: bigint,
  context: EvaluationCheckpoint,
  initialUpper?: bigint
): { readonly root: bigint; readonly iterations: number } {
  if (value < ZERO)
    throw new InternalCalculationException("Cannot take sqrt of a negative integer");
  if (value < TWO) return Object.freeze({ root: value, iterations: 0 });

  let estimate =
    initialUpper !== undefined &&
    initialUpper > ZERO &&
    piProduct(initialUpper, initialUpper, context) >= value
      ? initialUpper
      : ONE << BigInt(Math.ceil(value.toString(2).length / 2));
  let iterations = 0;
  for (;;) {
    context.checkpoint();
    iterations += 1;
    const next = (estimate + value / estimate) / TWO;
    if (next >= estimate) return Object.freeze({ root: estimate, iterations });
    estimate = next;
  }
}

function getOrCreatePiProvider(context: EvaluationContext): PiProviderState {
  const existing = contextPiProviders.get(context);
  if (existing !== undefined) return existing;
  const created = new PiProviderState();
  contextPiProviders.set(context, created);
  return created;
}

function getOrCreateLn2Provider(context: EvaluationCheckpoint): SplittingLn2Provider {
  const key = context as object;
  const existing = contextLn2Providers.get(key);
  if (existing !== undefined) return existing;
  const created = new SplittingLn2Provider();
  contextLn2Providers.set(key, created);
  return created;
}

function ballFromRationalInterval(
  lower: Rational,
  upper: Rational,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  return intervalToBall(
    createInternalInterval(
      backend.fromRational(lower, precisionBits, "towardNegativeInfinity"),
      backend.fromRational(upper, precisionBits, "towardPositiveInfinity"),
      backend
    ),
    precisionBits,
    backend
  );
}

function precisionBitsForConstantDigits(significantDigits: number): number {
  return Math.max(64, Math.ceil((significantDigits + CONSTANT_GUARD_DIGITS) * Math.log2(10)) + 64);
}

function rationalIntervalBigIntDigits(interval: PiRationalInterval | null): number {
  if (interval === null) return 0;
  return (
    bigintDecimalDigits(interval.lower.numerator) +
    bigintDecimalDigits(interval.lower.denominator) +
    bigintDecimalDigits(interval.upper.numerator) +
    bigintDecimalDigits(interval.upper.denominator)
  );
}

function bigintDecimalDigits(value: bigint): number {
  return (value < ZERO ? -value : value).toString().length;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function requireGraphLikeContext(context: EvaluationContext): GraphLikeEvaluationContext {
  const candidate = context as Partial<GraphLikeEvaluationContext>;
  if (candidate.backend === undefined || candidate.checkpoint === undefined) {
    throw new InternalCalculationException("Constants require a graph-aware evaluation context");
  }
  return candidate as GraphLikeEvaluationContext;
}
