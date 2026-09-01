import type {
  DomainError,
  InternalCalculationError,
  RegistryConfigurationError
} from "./contracts.js";
import { domainError, internalCalculationError, registryConfigurationError } from "./factories.js";

export class DomainException extends Error implements DomainError {
  readonly kind = "calc-error";
  readonly code = "DomainError";
  readonly operation: string;

  constructor(operation: string, message?: string) {
    const error = domainError(operation, message);
    super(error.message);
    this.name = "DomainError";
    this.operation = operation;
  }
}

export class InternalCalculationException extends Error implements InternalCalculationError {
  readonly kind = "calc-error";
  readonly code = "InternalCalculationError";

  constructor(message: string) {
    super(internalCalculationError(message).message);
    this.name = "InternalCalculationError";
  }
}

export class RegistryConfigurationException extends Error implements RegistryConfigurationError {
  readonly kind = "registry-configuration-error";
  readonly code: RegistryConfigurationError["code"];
  readonly registryName?: string;

  constructor(code: RegistryConfigurationError["code"], message: string, registryName?: string) {
    super(registryConfigurationError(code, message, registryName).message);
    this.name = "RegistryConfigurationError";
    this.code = code;

    if (registryName !== undefined) {
      this.registryName = registryName;
    }
  }
}
