import type { CalcError } from "../errors/contracts.js";
import type { VerifiedNumber } from "../formatting/contracts.js";

export interface PrecisionRequest {
  readonly significantDigits: number;
}

export interface EvaluationSettings {
  readonly angleMode: "radians" | "degrees";
  readonly factorialMode: "integer" | "gamma";
  readonly maxCalculationTimeMs: number;
}

export interface EvaluationContext {
  readonly settings: EvaluationSettings;
}

export interface EvaluationCheckpoint {
  checkpoint(): void;
}

export type RefinementResult = CompletedResult | PausedResult | CancelledResult | FailedResult;

export interface CompletedResult {
  readonly status: "complete";
  readonly requestedDigits: number;
  readonly value: VerifiedNumber;
}

export interface PausedResult {
  readonly status: "paused";
  readonly reason: "time-limit";
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumber | null;
}

export interface CancelledResult {
  readonly status: "cancelled";
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumber | null;
}

export interface FailedResult {
  readonly status: "failed";
  readonly error: CalcError;
  readonly requestedDigits?: number;
  readonly partial?: VerifiedNumber | null;
}

export interface CalculationHandle {
  refine(request: PrecisionRequest): Promise<RefinementResult>;
  continue(): Promise<RefinementResult>;
  cancel(): void;
}
