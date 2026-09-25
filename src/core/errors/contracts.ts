export type {
  AmbiguousIdentifierError,
  CalcError,
  CalcErrorBase,
  CalcErrorCode,
  CancelledError,
  DivisionByZeroError,
  DomainError,
  InternalCalculationError,
  InvalidIterationError,
  PrecisionError,
  ResourceLimitError,
  SourceRange,
  SyntaxError,
  UnknownIdentifierError
} from "../api-contracts.js";

export interface RegistryConfigurationError {
  readonly kind: "registry-configuration-error";
  readonly code:
    | "DuplicateBuiltinName"
    | "DuplicateExtensionName"
    | "ReservedNameOverride"
    | "InvalidDefinition";
  readonly message: string;
  readonly registryName?: string;
}
