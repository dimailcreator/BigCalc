import type { CalcError } from "../errors/contracts.js";
import type { EvaluationSettings } from "../evaluation/contracts.js";
import type { CalculationResourceLimits } from "../evaluation/lifecycle.js";

export interface WorkerCalculationOptionsDto {
  readonly settings?: Partial<EvaluationSettings>;
  readonly resourceLimits?: CalculationResourceLimits;
}

export type WorkerTransportCommand =
  | CreateCalculationCommandDto
  | RefineCalculationCommandDto
  | ContinueCalculationCommandDto
  | CancelCalculationCommandDto
  | DisposeCalculationCommandDto;

export interface CreateCalculationCommandDto {
  readonly type: "create";
  readonly handleId: string;
  readonly source: string;
  readonly options?: WorkerCalculationOptionsDto;
}

export interface RefineCalculationCommandDto {
  readonly type: "refine";
  readonly handleId: string;
  readonly significantDigits: number;
}

export interface ContinueCalculationCommandDto {
  readonly type: "continue";
  readonly handleId: string;
}

export interface CancelCalculationCommandDto {
  readonly type: "cancel";
  readonly handleId: string;
}

export interface DisposeCalculationCommandDto {
  readonly type: "dispose";
  readonly handleId: string;
}

export type WorkerTransportResponse =
  CreatedCalculationResponseDto | DisposedCalculationResponseDto | WorkerRefinementResultDto;

export interface CreatedCalculationResponseDto {
  readonly type: "created";
  readonly handleId: string;
}

export interface DisposedCalculationResponseDto {
  readonly type: "disposed";
  readonly handleId: string;
}

export type WorkerRefinementResultDto =
  | WorkerCompletedResultDto
  | WorkerPausedResultDto
  | WorkerCancelledResultDto
  | WorkerFailedResultDto;

export interface WorkerCompletedResultDto {
  readonly type: "complete";
  readonly handleId: string;
  readonly requestedDigits: number;
  readonly value: VerifiedNumberDto;
}

export interface WorkerPausedResultDto {
  readonly type: "paused";
  readonly handleId: string;
  readonly reason: "time-limit";
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumberDto | null;
}

export interface WorkerCancelledResultDto {
  readonly type: "cancelled";
  readonly handleId: string;
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumberDto | null;
}

export interface WorkerFailedResultDto {
  readonly type: "failed";
  readonly handleId: string;
  readonly error: CalcError;
  readonly requestedDigits?: number;
  readonly partial?: VerifiedNumberDto | null;
}

export interface VerifiedNumberDto {
  readonly sign: -1 | 0 | 1;
  readonly digits: string;
  readonly exponent10: string;
  readonly verifiedDigits: number;
  readonly valueExact: boolean;
  readonly decimalTerminating: boolean;
  readonly rounded: boolean;
  readonly zeroKind?: "exact" | "rounded";
}

export interface WorkerTransportHost {
  handleCommand(command: WorkerTransportCommand): Promise<WorkerTransportResponse>;
  readonly activeHandleCount: number;
}

export interface WorkerTransportHostOptions {
  readonly now?: () => number;
}
