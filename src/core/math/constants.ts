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
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";

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
  readonly lastTargetTermCount?: number;
}

export interface PiProviderStateSnapshot {
  readonly algorithm: "chudnovsky-binary-splitting";
  readonly intervalRequests: number;
  readonly cacheHits: number;
  readonly highestRequestedDigits: number;
  readonly completedTerms: number;
  readonly cachedBlocks: number;
}

export interface Ln2ProviderStateSnapshot {
  readonly intervalRequests: number;
  readonly cacheHits: number;
  readonly highestRequestedDigits: number;
  readonly completedTerms: number;
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

const contextConstants = new WeakMap<EvaluationContext, Map<string, StatefulConstantLazyReal>>();
const contextPiProviders = new WeakMap<EvaluationContext, PiProviderState>();
const contextLn2Providers = new WeakMap<object, Ln2ProviderState>();

export function createBuiltinConstantValue(name: "π" | "e", context: EvaluationContext): LazyReal {
  let constants = contextConstants.get(context);
  if (constants === undefined) {
    constants = new Map();
    contextConstants.set(context, constants);
  }

  const existing = constants.get(name);
  if (existing !== undefined) return existing;

  const created = name === "π" ? new PiLazyReal(getOrCreatePiProvider(context)) : new ELazyReal();
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
  private lastTargetTermCount = 0;

  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
    const graphContext = requireGraphLikeContext(context);
    this.refinementCalls += 1;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);
    const before = this.completedTermCount;
    let targetTailDigits = request.significantDigits + CONSTANT_GUARD_DIGITS;

    for (;;) {
      graphContext.checkpoint();
      const targetTermCount = this.estimateTargetTermCount(targetTailDigits);
      this.generateTerms(targetTermCount - this.completedTermCount, graphContext);
      while (!this.tailFits(targetTailDigits)) this.generateTerms(1, graphContext);
      this.lastTargetTermCount = this.completedTermCount;

      const precisionBits = precisionBitsForConstantDigits(request.significantDigits);
      const ball = this.currentBall(precisionBits, graphContext.backend);
      const verified = verifiedNumberFromBall(ball, request, graphContext.backend);
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
      lastTargetTermCount: this.lastTargetTermCount
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
    }
  }

  private tailFits(targetDigits: number): boolean {
    const tailDenominator = this.partialDenominator * BigInt(Math.max(1, this.completedTermCount));
    return TWO * decimalScale(targetDigits) <= tailDenominator;
  }

  private currentBall(precisionBits: number, backend: BigFloatBackend): Ball {
    const termCount = BigInt(Math.max(1, this.completedTermCount));
    const denominator = this.partialDenominator * termCount;
    const lowerNumerator = this.partialNumerator * termCount;
    return ballFromRationalInterval(
      createRational(lowerNumerator, denominator),
      createRational(lowerNumerator + TWO, denominator),
      precisionBits,
      backend
    );
  }
}

class PiLazyReal implements StatefulConstantLazyReal {
  readonly kind = "lazy-real";
  private refinementCalls = 0;
  private highestRequestedDigits = 0;

  constructor(private readonly provider: PiProviderState) {}

  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
    const graphContext = requireGraphLikeContext(context);
    this.refinementCalls += 1;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);
    const precisionBits = precisionBitsForConstantDigits(request.significantDigits);
    let decimalDigits = request.significantDigits + CONSTANT_GUARD_DIGITS;

    for (;;) {
      graphContext.checkpoint();
      const interval = this.provider.getInterval(decimalDigits, graphContext);
      const ball = ballFromRationalInterval(
        interval.lower,
        interval.upper,
        precisionBits,
        graphContext.backend
      );
      const verified = verifiedNumberFromBall(ball, request, graphContext.backend);
      if (verified.verifiedDigits >= request.significantDigits) return Promise.resolve(ball);
      decimalDigits += Math.max(
        CONSTANT_GUARD_DIGITS,
        request.significantDigits - verified.verifiedDigits
      );
    }
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    const provider = this.provider.getSnapshot();
    return Object.freeze({
      name: "π",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: Math.max(
        this.highestRequestedDigits,
        provider.highestRequestedDigits
      ),
      completedTerms: provider.completedTerms
    });
  }
}

export function getPiRationalInterval(
  context: EvaluationContext,
  decimalDigits: number
): PiRationalInterval {
  return getOrCreatePiProvider(context).getInterval(
    decimalDigits,
    requireGraphLikeContext(context)
  );
}

export function getPiProviderStateSnapshot(context: EvaluationContext): PiProviderStateSnapshot {
  return getOrCreatePiProvider(context).getSnapshot();
}

export function getLn2RationalInterval(
  context: EvaluationCheckpoint,
  decimalDigits: number
): PiRationalInterval {
  return getOrCreateLn2Provider(context).getInterval(decimalDigits, context);
}

export function getLn2ProviderStateSnapshot(
  context: EvaluationCheckpoint
): Ln2ProviderStateSnapshot {
  return getOrCreateLn2Provider(context).getSnapshot();
}

class PiProviderState {
  private intervalRequests = 0;
  private cacheHits = 0;
  private highestRequestedDigits = 0;
  private completedTermCount = 0;
  private cachedInterval: PiRationalInterval | null = null;
  private readonly cachedBlocks: CachedBinarySplit[] = [];
  private readonly splitLevels: (CachedBinarySplit | undefined)[] = [];
  private nextTermFactorNumerator = ONE;
  private nextTermFactorDenominator = ONE;

  getInterval(decimalDigits: number, context: GraphLikeEvaluationContext): PiRationalInterval {
    const digits = Math.max(1, decimalDigits);
    this.intervalRequests += 1;
    if (this.cachedInterval !== null && digits <= this.highestRequestedDigits) {
      this.cacheHits += 1;
      return this.cachedInterval;
    }

    const tailDigits = digits + CONSTANT_GUARD_DIGITS;
    while (this.completedTermCount === 0 || !this.tailFits(tailDigits)) this.appendBlock(context);

    const interval = this.computePiInterval(digits, tailDigits, context);
    this.highestRequestedDigits = digits;
    this.cachedInterval = interval;
    return interval;
  }

  getSnapshot(): PiProviderStateSnapshot {
    return Object.freeze({
      algorithm: "chudnovsky-binary-splitting",
      intervalRequests: this.intervalRequests,
      cacheHits: this.cacheHits,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTermCount,
      cachedBlocks: this.cachedBlocks.length
    });
  }

  private appendBlock(context: GraphLikeEvaluationContext): void {
    const start = this.completedTermCount;
    const end = start + CHUDNOVSKY_BLOCK_SIZE;
    const block = Object.freeze({ ...binarySplit(start, end, context), start, end });
    this.cachedBlocks.push(block);
    this.appendSplitLevel(block);

    for (let index = start; index < end; index += 1) {
      context.checkpoint();
      const nextIndex = BigInt(index + 1);
      this.nextTermFactorNumerator *=
        (6n * nextIndex - 5n) * (2n * nextIndex - ONE) * (6n * nextIndex - ONE);
      this.nextTermFactorDenominator *= nextIndex * nextIndex * nextIndex * CHUDNOVSKY_C3_OVER_24;
    }
    this.completedTermCount = end;
  }

  private appendSplitLevel(block: CachedBinarySplit): void {
    let carry = block;
    let level = 0;
    while (this.splitLevels[level] !== undefined) {
      const left = this.splitLevels[level];
      if (left === undefined) break;
      carry = Object.freeze({
        ...combineBinarySplits(left, carry),
        start: left.start,
        end: carry.end
      });
      this.splitLevels[level] = undefined;
      level += 1;
    }
    this.splitLevels[level] = carry;
  }

  private combinedSplit(): BinarySplit {
    let combined: CachedBinarySplit | null = null;
    for (let level = this.splitLevels.length - 1; level >= 0; level -= 1) {
      const split = this.splitLevels[level];
      if (split === undefined) continue;
      combined =
        combined === null
          ? split
          : Object.freeze({
              ...combineBinarySplits(combined, split),
              start: combined.start,
              end: split.end
            });
    }
    if (combined === null) {
      throw new InternalCalculationException("Chudnovsky state has no completed block");
    }
    return combined;
  }

  private tailBound(): Rational {
    const index = BigInt(this.completedTermCount);
    return createRational(
      this.nextTermFactorNumerator *
        (CHUDNOVSKY_A + CHUDNOVSKY_B * index) *
        CHUDNOVSKY_RATIO_DENOMINATOR,
      this.nextTermFactorDenominator * (CHUDNOVSKY_RATIO_DENOMINATOR - ONE)
    );
  }

  private tailFits(decimalDigits: number): boolean {
    const index = BigInt(this.completedTermCount);
    const numerator =
      this.nextTermFactorNumerator *
      (CHUDNOVSKY_A + CHUDNOVSKY_B * index) *
      CHUDNOVSKY_RATIO_DENOMINATOR;
    const denominator = this.nextTermFactorDenominator * (CHUDNOVSKY_RATIO_DENOMINATOR - ONE);
    return numerator * decimalScale(decimalDigits) <= denominator;
  }

  private computePiInterval(
    digits: number,
    workingDigits: number,
    context: GraphLikeEvaluationContext
  ): PiRationalInterval {
    const split = this.combinedSplit();
    const sum = createRational(split.t, split.q);
    const tail = this.tailBound();
    const sumLower = subtractRational(sum, tail);
    const sumUpper = addRational(sum, tail);
    if (compareRational(sumLower, integerRational(ZERO)) <= 0) {
      throw new InternalCalculationException("Chudnovsky reciprocal-pi interval crossed zero");
    }

    const sqrt = sqrtScaledInterval(CHUDNOVSKY_RADICAND, workingDigits, context);
    const factor = integerRational(CHUDNOVSKY_SQRT_FACTOR);
    const rawLower = divideRational(multiplyRational(factor, sqrt.lower), sumUpper);
    const rawUpper = divideRational(multiplyRational(factor, sqrt.upper), sumLower);
    return scaledIntervalToRationalBounds(
      scaledIntervalFromRationalBounds({ lower: rawLower, upper: rawUpper }, digits + 2)
    );
  }
}

class Ln2ProviderState {
  private intervalRequests = 0;
  private cacheHits = 0;
  private highestRequestedDigits = 0;
  private cachedInterval: PiRationalInterval | null = null;
  private readonly termDenominators: bigint[] = [];
  private nextPowerDenominator = THREE;

  getInterval(decimalDigits: number, context: EvaluationCheckpoint): PiRationalInterval {
    const digits = Math.max(1, decimalDigits);
    this.intervalRequests += 1;
    if (this.cachedInterval !== null && digits <= this.highestRequestedDigits) {
      this.cacheHits += 1;
      return this.cachedInterval;
    }

    const tailDigits = digits + 2;
    while (!this.tailFits(tailDigits)) {
      context.checkpoint();
      const index = this.termDenominators.length;
      this.termDenominators.push(this.nextPowerDenominator * (2n * BigInt(index) + ONE));
      this.nextPowerDenominator *= NINE;
    }

    const workingDigits = digits + this.termDenominators.length.toString().length + 3;
    const scale = decimalScale(workingDigits);
    let lower = ZERO;
    let upper = ZERO;
    for (const denominator of this.termDenominators) {
      context.checkpoint();
      lower += scale / denominator;
      upper += ceilDiv(scale, denominator);
    }

    const nextIndex = BigInt(this.termDenominators.length);
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
      completedTerms: this.termDenominators.length
    });
  }

  private tailFits(decimalDigits: number): boolean {
    const nextIndex = BigInt(this.termDenominators.length);
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
    binarySplit(middle, end, context)
  );
}

function combineBinarySplits(left: BinarySplit, right: BinarySplit): BinarySplit {
  return Object.freeze({
    p: left.p * right.p,
    q: left.q * right.q,
    t: left.t * right.q + left.p * right.t
  });
}

function sqrtScaledInterval(
  radicand: bigint,
  scaleDigits: number,
  context: EvaluationCheckpoint
): PiRationalInterval {
  const scale = decimalScale(scaleDigits);
  const scaledRadicand = radicand * scale * scale;
  const lower = integerSqrtFloor(scaledRadicand, context);
  const upper = lower * lower === scaledRadicand ? lower : lower + ONE;
  return scaledIntervalToRationalBounds(createScaledInterval(lower, upper, scaleDigits));
}

function integerSqrtFloor(value: bigint, context: EvaluationCheckpoint): bigint {
  if (value < ZERO)
    throw new InternalCalculationException("Cannot take sqrt of a negative integer");
  if (value < TWO) return value;

  let estimate = ONE << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    context.checkpoint();
    const next = (estimate + value / estimate) / TWO;
    if (next >= estimate) return estimate;
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

function getOrCreateLn2Provider(context: EvaluationCheckpoint): Ln2ProviderState {
  const key = context as object;
  const existing = contextLn2Providers.get(key);
  if (existing !== undefined) return existing;
  const created = new Ln2ProviderState();
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

function requireGraphLikeContext(context: EvaluationContext): GraphLikeEvaluationContext {
  const candidate = context as Partial<GraphLikeEvaluationContext>;
  if (candidate.backend === undefined || candidate.checkpoint === undefined) {
    throw new InternalCalculationException("Constants require a graph-aware evaluation context");
  }
  return candidate as GraphLikeEvaluationContext;
}
