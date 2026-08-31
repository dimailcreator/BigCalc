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

export interface RegistryConfigurationError {
  readonly kind: "registry-configuration-error";
  readonly code:
    | "DuplicateBuiltinName"
    | "DuplicateExtensionName"
    | "ReservedNameOverride"
    | "InvalidDefinition";
  readonly message: string;
  readonly name?: string;
}
