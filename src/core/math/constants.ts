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
const MAX_REFINEMENT_GROWTH_ATTEMPTS = 16;

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

type StatefulConstantLazyReal = LazyReal & {
  getStateSnapshot(): ConstantLazyRealStateSnapshot;
};

type ScaledIntegerInterval = Readonly<{
  lower: bigint;
  upper: bigint;
  scale: bigint;
}>;

const contextConstants = new WeakMap<EvaluationContext, Map<string, StatefulConstantLazyReal>>();

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

  const created = name === "π" ? new PiLazyReal() : new ELazyReal();
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
  private completedTermCount = 0;

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
        (precisionBits, decimalDigits) =>
          this.currentBall(precisionBits, decimalDigits, graphContext.backend)
      )
    );
  }

  getStateSnapshot(): ConstantLazyRealStateSnapshot {
    return Object.freeze({
      name: "π",
      refinementCalls: this.refinementCalls,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTermCount
    });
  }

  private generateTerms(count: number, context: GraphLikeEvaluationContext): void {
    for (let index = 0; index < count; index += 1) {
      context.checkpoint();
      this.completedTermCount += 1;
    }
  }

  private currentBall(
    precisionBits: number,
    decimalDigits: number,
    backend: BigFloatBackend
  ): Ball {
    const interval = machinPiInterval(this.completedTermCount, decimalDigits);

    return ballFromRationalInterval(
      createRational(interval.lower, interval.scale),
      createRational(interval.upper, interval.scale),
      precisionBits,
      backend
    );
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

  for (let attempt = 0; attempt < MAX_REFINEMENT_GROWTH_ATTEMPTS; attempt += 1) {
    const ball = createBall(precisionBits, decimalDigits);
    const verified = verifiedNumberFromBall(ball, request, context.backend);

    if (verified.verifiedDigits >= request.significantDigits) {
      return ball;
    }

    const missingDigits = request.significantDigits - verified.verifiedDigits;
    generateTerms(Math.max(DEFAULT_CONSTANT_GUARD_DIGITS, missingDigits));
  }

  throw new InternalCalculationException(
    `Unable to refine constant to ${String(request.significantDigits)} digits`
  );
}

function machinPiInterval(termCount: number, decimalDigits: number): ScaledIntegerInterval {
  const scale = powerOfTen(decimalDigits);
  const atanOneFifth = atanReciprocalScaledInterval(FIVE, termCount, scale);
  const atanOneOver239 = atanReciprocalScaledInterval(TWO_HUNDRED_THIRTY_NINE, termCount, scale);

  return {
    lower: SIXTEEN * atanOneFifth.lower - FOUR * atanOneOver239.upper,
    upper: SIXTEEN * atanOneFifth.upper - FOUR * atanOneOver239.lower,
    scale
  };
}

function atanReciprocalScaledInterval(
  reciprocalDenominator: bigint,
  termCount: number,
  scale: bigint
): ScaledIntegerInterval {
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

  return { lower, upper, scale };
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
