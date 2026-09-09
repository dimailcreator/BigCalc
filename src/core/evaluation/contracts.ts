import type { CalculationSettings } from "../api-contracts.js";

export type {
  CalculationHandle,
  CancelledResult,
  CompletedResult,
  FailedResult,
  PausedResult,
  PrecisionRequest,
  RefinementResult
} from "../api-contracts.js";

export interface EvaluationSettings extends CalculationSettings {
  readonly precisionCutoffDigits: number;
}

export interface EvaluationContext {
  readonly settings: EvaluationSettings;
}

export interface EvaluationCheckpoint {
  checkpoint(): void;
  guardBigIntDigits?(estimatedDigits: number): void;
}
