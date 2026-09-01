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
  readonly precisionCutoff?: PrecisionCutoffMetadata;
}

export interface PrecisionCutoffMetadata {
  readonly kind: "precision-cutoff";
  readonly cutoffDigits: number;
  readonly stepExponent10: bigint;
  readonly roundedCenter: Rational;
  readonly roundedLower: Rational;
  readonly roundedUpper: Rational;
  readonly ambiguousBoundary: boolean;
}
