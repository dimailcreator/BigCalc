import type {
  CalculationRequestId,
  CalculationSessionId,
  WorkerHandleId
} from "./CalculationSession.js";

export interface CalculationSettingsDto {
  readonly angleMode: "radians" | "degrees";
  readonly factorialMode: "integer" | "gamma";
  readonly maxCalculationTimeMs: number;
}

export type CalculationExpressionSegmentDto =
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "reference"; readonly id: string };

export interface CalculationReferenceSnapshotDto {
  readonly id: string;
  readonly expression: readonly CalculationExpressionSegmentDto[];
  readonly settings: CalculationSettingsDto;
}

export interface CreateCalculationCommand {
  readonly type: "create";
  readonly sessionId: CalculationSessionId;
  readonly source: string;
  readonly settings: CalculationSettingsDto;
}

export interface CreateStructuredCalculationCommand {
  readonly type: "create-structured";
  readonly sessionId: CalculationSessionId;
  readonly expression: readonly CalculationExpressionSegmentDto[];
  readonly references: readonly CalculationReferenceSnapshotDto[];
  readonly settings: CalculationSettingsDto;
}

export interface RefineCalculationCommand {
  readonly type: "refine";
  readonly sessionId: CalculationSessionId;
  readonly requestId: CalculationRequestId;
  readonly significantDigits: number;
}

export interface ContinueCalculationCommand {
  readonly type: "continue";
  readonly sessionId: CalculationSessionId;
  readonly requestId: CalculationRequestId;
}

export interface CancelCalculationCommand {
  readonly type: "cancel";
  readonly sessionId: CalculationSessionId;
}

export interface DisposeCalculationCommand {
  readonly type: "dispose";
  readonly sessionId: CalculationSessionId;
}

export type WorkerCommand =
  | CreateCalculationCommand
  | CreateStructuredCalculationCommand
  | RefineCalculationCommand
  | ContinueCalculationCommand
  | CancelCalculationCommand
  | DisposeCalculationCommand;

export interface SourceRangeDto {
  readonly start: number;
  readonly end: number;
}

interface CalcErrorDtoBase {
  readonly kind: "calc-error";
  readonly code: CalcErrorDtoCode;
  readonly message: string;
  readonly range?: SourceRangeDto;
}

export type CalcErrorDtoCode =
  | "SyntaxError"
  | "InvalidIterationError"
  | "UnknownIdentifierError"
  | "AmbiguousIdentifierError"
  | "DomainError"
  | "DivisionByZeroError"
  | "PrecisionError"
  | "ResourceLimitError"
  | "CancelledError"
  | "InternalCalculationError";

export interface SyntaxErrorDto extends CalcErrorDtoBase {
  readonly code: "SyntaxError";
}

export interface InvalidIterationErrorDto extends CalcErrorDtoBase {
  readonly code: "InvalidIterationError";
}

export interface UnknownIdentifierErrorDto extends CalcErrorDtoBase {
  readonly code: "UnknownIdentifierError";
  readonly identifier: string;
}

export interface AmbiguousIdentifierErrorDto extends CalcErrorDtoBase {
  readonly code: "AmbiguousIdentifierError";
  readonly identifier: string;
  readonly candidates: readonly string[];
}

export interface DomainErrorDto extends CalcErrorDtoBase {
  readonly code: "DomainError";
  readonly operation: string;
}

export interface DivisionByZeroErrorDto extends CalcErrorDtoBase {
  readonly code: "DivisionByZeroError";
}

export interface PrecisionErrorDto extends CalcErrorDtoBase {
  readonly code: "PrecisionError";
  readonly requestedDigits?: number;
}

export interface ResourceLimitErrorDto extends CalcErrorDtoBase {
  readonly code: "ResourceLimitError";
  readonly resource: "hard-watchdog" | "memory" | "backend" | "other";
}

export interface CancelledErrorDto extends CalcErrorDtoBase {
  readonly code: "CancelledError";
}

export interface InternalCalculationErrorDto extends CalcErrorDtoBase {
  readonly code: "InternalCalculationError";
}

export type CalcErrorDto =
  | SyntaxErrorDto
  | InvalidIterationErrorDto
  | UnknownIdentifierErrorDto
  | AmbiguousIdentifierErrorDto
  | DomainErrorDto
  | DivisionByZeroErrorDto
  | PrecisionErrorDto
  | ResourceLimitErrorDto
  | CancelledErrorDto
  | InternalCalculationErrorDto;

export interface VerifiedNumberDto {
  readonly sign: -1 | 0 | 1;
  readonly digits: string;
  readonly exponent10: bigint;
  readonly verifiedDigits: number;
  readonly valueExact: boolean;
  readonly decimalTerminating: boolean;
  readonly rounded: boolean;
  readonly zeroKind?: "exact" | "rounded";
}

export interface CompletedResultDto {
  readonly status: "complete";
  readonly requestedDigits: number;
  readonly value: VerifiedNumberDto;
}

export interface PausedResultDto {
  readonly status: "paused";
  readonly reason: "time-limit";
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumberDto | null;
}

export interface CancelledResultDto {
  readonly status: "cancelled";
  readonly requestedDigits: number;
  readonly verifiedDigits: number;
  readonly partial: VerifiedNumberDto | null;
}

export interface FailedResultDto {
  readonly status: "failed";
  readonly error: CalcErrorDto;
  readonly requestedDigits?: number;
  readonly partial?: VerifiedNumberDto | null;
}

export type RefinementResultDto =
  CompletedResultDto | PausedResultDto | CancelledResultDto | FailedResultDto;

export interface CalculationCreatedResponse {
  readonly type: "created";
  readonly sessionId: CalculationSessionId;
  readonly workerHandleId: WorkerHandleId;
}

export interface CalculationCreateFailedResponse {
  readonly type: "create-failed";
  readonly sessionId: CalculationSessionId;
  readonly error: CalcErrorDto;
}

export interface RefinementResultResponse {
  readonly type: "refinement-result";
  readonly sessionId: CalculationSessionId;
  readonly requestId: CalculationRequestId;
  readonly result: RefinementResultDto;
}

export interface CalculationCancelledResponse {
  readonly type: "cancelled";
  readonly sessionId: CalculationSessionId;
}

export interface CalculationDisposedResponse {
  readonly type: "disposed";
  readonly sessionId: CalculationSessionId;
}

export type WorkerErrorCode =
  | "InvalidCommand"
  | "DuplicateSession"
  | "UnknownSession"
  | "SessionBusy"
  | "CoreBoundaryFailure"
  | "WorkerExecutionFailure";

export interface WorkerErrorResponse {
  readonly type: "worker-error";
  readonly code: WorkerErrorCode;
  readonly message: string;
  readonly commandType?: WorkerCommand["type"];
  readonly sessionId?: CalculationSessionId;
  readonly requestId?: CalculationRequestId;
}

export type WorkerResponse =
  | CalculationCreatedResponse
  | CalculationCreateFailedResponse
  | RefinementResultResponse
  | CalculationCancelledResponse
  | CalculationDisposedResponse
  | WorkerErrorResponse;

export type CreateCalculationResponse =
  CalculationCreatedResponse | CalculationCreateFailedResponse;
