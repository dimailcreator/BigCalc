import type { BigFloatBackend } from "../backend/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationContext, PrecisionRequest } from "../evaluation/contracts.js";
import { verifiedNumberFromBall } from "../formatting/verified-number.js";
import { createInternalInterval, intervalToBall } from "../values/ball.js";
import type { Ball, LazyReal, Rational } from "../values/contracts.js";
import { addRational, createRational } from "../values/rational.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const FOUR = 4n;
const FIVE = 5n;
const SIXTEEN = 16n;
const TWO_HUNDRED_THIRTY_NINE = 239n;
const DEFAULT_CONSTANT_GUARD_DIGITS = 6;
const MACHIN_DECIMAL_GUARD_DIGITS = 8;

interface GraphLikeEvaluationContext extends EvaluationContext {
  readonly backend: BigFloatBackend;
  checkpoint(): void;
}

interface ConstantLazyRealStateSnapshot {
  readonly name: "π" | "e";
  readonly refinementCalls: number;
  readonly highestRequestedDigits: number;
  readonly completedTerms: number;
}

export interface PiProviderStateSnapshot {
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

type ScaledIntegerInterval = Readonly<{
  lower: bigint;
  upper: bigint;
  scale: bigint;
}>;

const contextConstants = new WeakMap<EvaluationContext, Map<string, StatefulConstantLazyReal>>();
const contextPiProviders = new WeakMap<EvaluationContext, PiProviderState>();

export function createBuiltinConstantValue(name: "π" | "e", context: EvaluationContext): LazyReal {
  let constants = contextConstants.get(context);

  if (constants === undefined) {
    constants = new Map();
    contextConstants.set(context, constants);
  }

  const existing = constants.get(name);
  if (existing !== undefined) {
    return existing;
  }

  const created = name === "π" ? new PiLazyReal(getOrCreatePiProvider(context)) : new ELazyReal();
  constants.set(name, created);

  return created;
}

class ELazyReal implements StatefulConstantLazyReal {
  readonly kind = "lazy-real";
  private refinementCalls = 0;
  private highestRequestedDigits = 0;
  private completedTermCount = 0;
  private partialNumerator = 0n;
  private partialDenominator = 1n;

  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
    const graphContext = requireGraphLikeContext(context);
    this.refinementCalls += 1;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);

    return Promise.resolve(
      refineUntilVerified(
        request,
        graphContext,
        (count) => {
          this.generateTerms(count, graphContext);
        },
        (precisionBits) => this.currentBall(precisionBits, graphContext.backend)
      )
    );
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    return Object.freeze({
      name: "e",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTermCount
    });
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
    }
  }

  private currentBall(precisionBits: number, backend: BigFloatBackend): Ball {
    const lower = createRational(this.partialNumerator, this.partialDenominator);
    const upper = addRational(lower, this.tailBound());

    return ballFromRationalInterval(lower, upper, precisionBits, backend);
  }

  private tailBound(): Rational {
    return createRational(
      TWO,
      this.partialDenominator * BigInt(Math.max(1, this.completedTermCount))
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
    let decimalDigits = request.significantDigits + MACHIN_DECIMAL_GUARD_DIGITS;

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

      if (verified.verifiedDigits >= request.significantDigits) {
        return Promise.resolve(ball);
      }

      const missingDigits = request.significantDigits - verified.verifiedDigits;
      decimalDigits += Math.max(DEFAULT_CONSTANT_GUARD_DIGITS, missingDigits);
    }
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    return Object.freeze({
      name: "π",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: Math.max(
        this.highestRequestedDigits,
        this.provider.getSnapshot().highestRequestedDigits
      ),
      completedTerms: this.provider.getSnapshot().completedTerms
    });
  }
}

function refineUntilVerified(
  request: PrecisionRequest,
  context: GraphLikeEvaluationContext,
  generateTerms: (count: number) => void,
  createBall: (precisionBits: number, decimalDigits: number) => Ball
): Ball {
  const precisionBits = precisionBitsForConstantDigits(request.significantDigits);
  const decimalDigits = request.significantDigits + MACHIN_DECIMAL_GUARD_DIGITS;

  generateTerms(DEFAULT_CONSTANT_GUARD_DIGITS);

  for (;;) {
    context.checkpoint();
    const ball = createBall(precisionBits, decimalDigits);
    const verified = verifiedNumberFromBall(ball, request, context.backend);

    if (verified.verifiedDigits >= request.significantDigits) {
      return ball;
    }

    const missingDigits = request.significantDigits - verified.verifiedDigits;
    generateTerms(Math.max(DEFAULT_CONSTANT_GUARD_DIGITS, missingDigits));
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

class PiProviderState {
  private intervalRequests = 0;
  private cacheHits = 0;
  private highestRequestedDigits = 0;
  private completedTermCount = 0;
  private cachedInterval: PiRationalInterval | null = null;
  private readonly atanOneFifth = new AtanReciprocalState(FIVE);
  private readonly atanOneOver239 = new AtanReciprocalState(TWO_HUNDRED_THIRTY_NINE);

  getInterval(decimalDigits: number, context: GraphLikeEvaluationContext): PiRationalInterval {
    const digits = Math.max(1, decimalDigits);
    this.intervalRequests += 1;

    if (this.cachedInterval !== null && digits <= this.highestRequestedDigits) {
      this.cacheHits += 1;
      return this.cachedInterval;
    }

    const requiredTerms = digits + MACHIN_DECIMAL_GUARD_DIGITS;
    while (this.completedTermCount < requiredTerms) {
      context.checkpoint();
      this.atanOneFifth.appendTerm();
      this.atanOneOver239.appendTerm();
      this.completedTermCount += 1;
    }

    const interval = this.machinInterval(digits, context);
    this.highestRequestedDigits = digits;
    this.cachedInterval = Object.freeze({
      lower: createRational(interval.lower, interval.scale),
      upper: createRational(interval.upper, interval.scale)
    });

    return this.cachedInterval;
  }

  getSnapshot(): PiProviderStateSnapshot {
    return Object.freeze({
      intervalRequests: this.intervalRequests,
      cacheHits: this.cacheHits,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTermCount
    });
  }

  private machinInterval(
    decimalDigits: number,
    context: GraphLikeEvaluationContext
  ): ScaledIntegerInterval {
    const scale = powerOfTen(decimalDigits);
    const atanOneFifth = this.atanOneFifth.scaledInterval(scale, context);
    const atanOneOver239 = this.atanOneOver239.scaledInterval(scale, context);

    return {
      lower: SIXTEEN * atanOneFifth.lower - FOUR * atanOneOver239.upper,
      upper: SIXTEEN * atanOneFifth.upper - FOUR * atanOneOver239.lower,
      scale
    };
  }
}

function getOrCreatePiProvider(context: EvaluationContext): PiProviderState {
  const existing = contextPiProviders.get(context);
  if (existing !== undefined) {
    return existing;
  }

  const created = new PiProviderState();
  contextPiProviders.set(context, created);
  return created;
}

class AtanReciprocalState {
  private readonly termDenominators: bigint[] = [];
  private readonly denominatorStep: bigint;
  private nextPowerDenominator: bigint;

  constructor(reciprocalDenominator: bigint) {
    this.nextPowerDenominator = reciprocalDenominator;
    this.denominatorStep = reciprocalDenominator * reciprocalDenominator;
  }

  appendTerm(): void {
    const index = this.termDenominators.length;
    this.termDenominators.push(this.nextPowerDenominator * (TWO * BigInt(index) + ONE));
    this.nextPowerDenominator *= this.denominatorStep;
  }

  scaledInterval(scale: bigint, context: GraphLikeEvaluationContext): ScaledIntegerInterval {
    let lower = ZERO;
    let upper = ZERO;

    for (const [index, termDenominator] of this.termDenominators.entries()) {
      context.checkpoint();
      const termLower = scale / termDenominator;
      const termUpper = ceilDiv(scale, termDenominator);

      if (index % 2 === 0) {
        lower += termLower;
        upper += termUpper;
      } else {
        lower -= termUpper;
        upper -= termLower;
      }
    }

    const termCount = this.termDenominators.length;
    const nextTermUpper = ceilDiv(
      scale,
      this.nextPowerDenominator * (TWO * BigInt(termCount) + ONE)
    );

    if (termCount % 2 === 0) {
      upper += nextTermUpper;
    } else {
      lower -= nextTermUpper;
    }

    return { lower, upper, scale };
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder === ZERO ? quotient : quotient + ONE;
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new InternalCalculationException("powerOfTen requires a non-negative safe integer");
  }

  return 10n ** BigInt(exponent);
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
  return Math.max(
    64,
    Math.ceil((significantDigits + DEFAULT_CONSTANT_GUARD_DIGITS) * Math.log2(10)) + 64
  );
}

function requireGraphLikeContext(context: EvaluationContext): GraphLikeEvaluationContext {
  const candidate = context as Partial<GraphLikeEvaluationContext>;

  if (candidate.backend === undefined || candidate.checkpoint === undefined) {
    throw new InternalCalculationException("Constants require a graph-aware evaluation context");
  }

  return candidate as GraphLikeEvaluationContext;
}
