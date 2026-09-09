export type Sign = -1 | 0 | 1;

export interface CalculationSettings {
  readonly angleMode: "radians" | "degrees";
  readonly factorialMode: "integer" | "gamma";
  readonly maxCalculationTimeMs: number;
}

export interface CalculationOptions {
  readonly settings?: Partial<CalculationSettings>;
}

export interface PrecisionRequest {
  readonly significantDigits: number;
}

export type ZeroKind = "exact" | "rounded";

export interface VerifiedNumber {
  readonly sign: Sign;
  readonly digits: string;
  readonly exponent10: bigint;
  readonly verifiedDigits: number;
  readonly valueExact: boolean;
  readonly decimalTerminating: boolean;
  readonly rounded: boolean;
  readonly zeroKind?: ZeroKind;
}

export interface NumberFormatOptions {
  readonly decimalSeparator?: ",";
  readonly scientificNotationThreshold?: number;
  readonly ellipsis?: string;
}

export interface FormattedNumber {
  readonly text: string;
  readonly notation: "plain" | "scientific";
  readonly usedVerifiedDigits: number;
}

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type CalcError =
  | SyntaxError
  | UnknownIdentifierError
  | AmbiguousIdentifierError
  | DomainError
  | DivisionByZeroError
  | PrecisionError
  | ResourceLimitError
  | CancelledError
  | InternalCalculationError;

export interface CalcErrorBase {
  readonly kind: "calc-error";
  readonly code: CalcErrorCode;
  readonly message: string;
  readonly range?: SourceRange;
}

export type CalcErrorCode =
  | "SyntaxError"
  | "UnknownIdentifierError"
  | "AmbiguousIdentifierError"
  | "DomainError"
  | "DivisionByZeroError"
  | "PrecisionError"
  | "ResourceLimitError"
  | "CancelledError"
  | "InternalCalculationError";

export interface SyntaxError extends CalcErrorBase {
  readonly code: "SyntaxError";
}

export interface UnknownIdentifierError extends CalcErrorBase {
  readonly code: "UnknownIdentifierError";
  readonly identifier: string;
}

export interface AmbiguousIdentifierError extends CalcErrorBase {
  readonly code: "AmbiguousIdentifierError";
  readonly identifier: string;
  readonly candidates: readonly string[];
}

export interface DomainError extends CalcErrorBase {
  readonly code: "DomainError";
  readonly operation: string;
}

export interface DivisionByZeroError extends CalcErrorBase {
  readonly code: "DivisionByZeroError";
}

export interface PrecisionError extends CalcErrorBase {
  readonly code: "PrecisionError";
  readonly requestedDigits?: number;
}

export interface ResourceLimitError extends CalcErrorBase {
  readonly code: "ResourceLimitError";
  readonly resource: "hard-watchdog" | "memory" | "backend" | "other";
}

export interface CancelledError extends CalcErrorBase {
  readonly code: "CancelledError";
}

export interface InternalCalculationError extends CalcErrorBase {
  readonly code: "InternalCalculationError";
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

export type CalculationHandleCreationResult =
  | { readonly ok: true; readonly handle: CalculationHandle }
  | { readonly ok: false; readonly error: CalcError };
