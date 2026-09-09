import { createCalculationHandleFromSource as createInternalCalculationHandle } from "./evaluation/lifecycle.js";
import { DEFAULT_EVALUATION_SETTINGS } from "./evaluation/context.js";
import { formatVerifiedNumber } from "./formatting/display.js";
import { CORE_PUBLIC_API_VERSION, CORE_STAGE, createCoreSmokeProbe } from "./public.js";
import type {
  CalculationHandleCreationResult,
  CalculationOptions,
  CalculationSettings
} from "./api-contracts.js";

export { CORE_PUBLIC_API_VERSION, CORE_STAGE, createCoreSmokeProbe, formatVerifiedNumber };
export type {
  AmbiguousIdentifierError,
  CalcError,
  CalcErrorBase,
  CalcErrorCode,
  CalculationHandle,
  CalculationHandleCreationResult,
  CalculationOptions,
  CalculationSettings,
  CancelledError,
  CancelledResult,
  CompletedResult,
  DivisionByZeroError,
  DomainError,
  FailedResult,
  FormattedNumber,
  InternalCalculationError,
  NumberFormatOptions,
  PausedResult,
  PrecisionError,
  PrecisionRequest,
  RefinementResult,
  ResourceLimitError,
  Sign,
  SourceRange,
  SyntaxError,
  UnknownIdentifierError,
  VerifiedNumber,
  ZeroKind
} from "./api-contracts.js";
export type { CoreSmokeProbe } from "./public.js";

export const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = Object.freeze({
  angleMode: DEFAULT_EVALUATION_SETTINGS.angleMode,
  factorialMode: DEFAULT_EVALUATION_SETTINGS.factorialMode,
  maxCalculationTimeMs: DEFAULT_EVALUATION_SETTINGS.maxCalculationTimeMs
});

export function createCalculationHandle(
  source: string,
  options: CalculationOptions = {}
): CalculationHandleCreationResult {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }
  validateCalculationSettings(options.settings);

  const created = createInternalCalculationHandle(source, {
    ...(options.settings === undefined ? {} : { settings: options.settings })
  });

  return created.ok
    ? Object.freeze({ ok: true, handle: created.handle })
    : Object.freeze({ ok: false, error: created.error });
}

function validateCalculationSettings(settings: unknown): void {
  if (settings === undefined) return;
  if (settings === null || typeof settings !== "object") {
    throw new TypeError("settings must be an object");
  }

  const runtimeSettings = settings as {
    readonly angleMode?: unknown;
    readonly factorialMode?: unknown;
    readonly maxCalculationTimeMs?: unknown;
  };

  if (
    runtimeSettings.angleMode !== undefined &&
    runtimeSettings.angleMode !== "radians" &&
    runtimeSettings.angleMode !== "degrees"
  ) {
    throw new TypeError("angleMode must be radians or degrees");
  }

  if (
    runtimeSettings.factorialMode !== undefined &&
    runtimeSettings.factorialMode !== "integer" &&
    runtimeSettings.factorialMode !== "gamma"
  ) {
    throw new TypeError("factorialMode must be integer or gamma");
  }

  if (
    runtimeSettings.maxCalculationTimeMs !== undefined &&
    (typeof runtimeSettings.maxCalculationTimeMs !== "number" ||
      !Number.isFinite(runtimeSettings.maxCalculationTimeMs) ||
      runtimeSettings.maxCalculationTimeMs < 0)
  ) {
    throw new RangeError("maxCalculationTimeMs must be a non-negative finite number");
  }
}
