import type { InternalFloat, NonNegativeInternalFloat } from "../backend/contracts.js";
import type { EvaluationContext, PrecisionRequest } from "../evaluation/contracts.js";

export type Sign = -1 | 0 | 1;

export type RealValue = Rational | LazyReal;

export interface Rational {
  readonly kind: "rational";
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface LazyReal {
  readonly kind: "lazy-real";
  refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball>;
}

export interface Ball {
  readonly kind: "ball";
  readonly center: InternalFloat;
  readonly radius: NonNegativeInternalFloat;
}
