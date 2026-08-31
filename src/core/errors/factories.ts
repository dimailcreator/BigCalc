import type {
  AmbiguousIdentifierError,
  CancelledError,
  DivisionByZeroError,
  DomainError,
  InternalCalculationError,
  PrecisionError,
  RegistryConfigurationError,
  ResourceLimitError,
  SourceRange,
  SyntaxError,
  UnknownIdentifierError
} from "./contracts.js";

function withRange<T extends { readonly range?: SourceRange }>(
  error: Omit<T, "range">,
  range: SourceRange | undefined
): T {
  return (range === undefined ? error : { ...error, range }) as T;
}

export function syntaxError(message: string, range?: SourceRange): SyntaxError {
  return withRange({ kind: "calc-error", code: "SyntaxError", message }, range);
}

export function unknownIdentifierError(
  identifier: string,
  message = `Unknown identifier: ${identifier}`,
  range?: SourceRange
): UnknownIdentifierError {
  return withRange(
    { kind: "calc-error", code: "UnknownIdentifierError", message, identifier },
    range
  );
}

export function ambiguousIdentifierError(
  identifier: string,
  candidates: readonly string[],
  message = `Ambiguous identifier: ${identifier}`,
  range?: SourceRange
): AmbiguousIdentifierError {
  return withRange(
    {
      kind: "calc-error",
      code: "AmbiguousIdentifierError",
      message,
      identifier,
      candidates
    },
    range
  );
}

export function domainError(
  operation: string,
  message = `Value is outside the domain of ${operation}`,
  range?: SourceRange
): DomainError {
  return withRange({ kind: "calc-error", code: "DomainError", message, operation }, range);
}

export function divisionByZeroError(
  message = "Division by zero",
  range?: SourceRange
): DivisionByZeroError {
  return withRange({ kind: "calc-error", code: "DivisionByZeroError", message }, range);
}

export function precisionError(
  message: string,
  requestedDigits?: number,
  range?: SourceRange
): PrecisionError {
  if (requestedDigits === undefined) {
    return withRange({ kind: "calc-error", code: "PrecisionError", message }, range);
  }

  return withRange({ kind: "calc-error", code: "PrecisionError", message, requestedDigits }, range);
}

export function resourceLimitError(
  resource: ResourceLimitError["resource"],
  message: string,
  range?: SourceRange
): ResourceLimitError {
  return withRange({ kind: "calc-error", code: "ResourceLimitError", message, resource }, range);
}

export function cancelledError(
  message = "Calculation cancelled",
  range?: SourceRange
): CancelledError {
  return withRange({ kind: "calc-error", code: "CancelledError", message }, range);
}

export function internalCalculationError(
  message: string,
  range?: SourceRange
): InternalCalculationError {
  return withRange({ kind: "calc-error", code: "InternalCalculationError", message }, range);
}

export function registryConfigurationError(
  code: RegistryConfigurationError["code"],
  message: string,
  name?: string
): RegistryConfigurationError {
  return name === undefined
    ? { kind: "registry-configuration-error", code, message }
    : { kind: "registry-configuration-error", code, message, name };
}
