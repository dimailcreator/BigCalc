import type { CalcError, CalcErrorCode, DivisionByZeroError } from "./contracts.js";

export function isCalcError(error: unknown): error is CalcError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<PropertyKey, unknown>).kind === "calc-error" &&
    typeof (error as Record<PropertyKey, unknown>).code === "string" &&
    isCalcErrorCode((error as Record<PropertyKey, unknown>).code)
  );
}

export function isDivisionByZeroError(error: unknown): error is DivisionByZeroError {
  return isCalcError(error) && error.code === "DivisionByZeroError";
}

function isCalcErrorCode(code: unknown): code is CalcErrorCode {
  switch (code) {
    case "SyntaxError":
    case "UnknownIdentifierError":
    case "AmbiguousIdentifierError":
    case "DomainError":
    case "DivisionByZeroError":
    case "PrecisionError":
    case "ResourceLimitError":
    case "CancelledError":
    case "InternalCalculationError":
      return true;
    default:
      return false;
  }
}
