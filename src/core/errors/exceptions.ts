import type { InternalCalculationError, RegistryConfigurationError } from "./contracts.js";
import { internalCalculationError, registryConfigurationError } from "./factories.js";

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
