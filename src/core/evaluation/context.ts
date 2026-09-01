import type { BigFloatBackend } from "../backend/contracts.js";
import { createReferenceBigFloatBackend } from "../backend/reference-backend.js";
import type { CoreRegistry } from "../registry/contracts.js";
import { createCoreRegistry } from "../registry/registry.js";
import type { EvaluationCheckpoint, EvaluationContext, EvaluationSettings } from "./contracts.js";

export const DEFAULT_EVALUATION_SETTINGS: EvaluationSettings = Object.freeze({
  angleMode: "radians",
  factorialMode: "integer",
  maxCalculationTimeMs: 1000,
  precisionCutoffDigits: 3000
});

export interface EvaluationContextOptions {
  readonly settings?: Partial<EvaluationSettings>;
  readonly backend?: BigFloatBackend;
  readonly registry?: CoreRegistry;
  readonly checkpoint?: EvaluationCheckpoint["checkpoint"];
}

export interface EvaluationGraphContext extends EvaluationContext, EvaluationCheckpoint {
  readonly backend: BigFloatBackend;
  readonly registry: CoreRegistry;
}

export function createEvaluationSettings(
  settings: Partial<EvaluationSettings> = {}
): EvaluationSettings {
  const resolved = {
    ...DEFAULT_EVALUATION_SETTINGS,
    ...settings
  };

  if (!Number.isSafeInteger(resolved.precisionCutoffDigits) || resolved.precisionCutoffDigits < 1) {
    throw new Error("precisionCutoffDigits must be a positive safe integer");
  }

  return Object.freeze(resolved);
}

export function createEvaluationContext(
  options: EvaluationContextOptions = {}
): EvaluationGraphContext {
  const checkpoint = options.checkpoint ?? noopCheckpoint;

  return Object.freeze({
    settings: createEvaluationSettings(options.settings),
    backend: options.backend ?? createReferenceBigFloatBackend(),
    registry: options.registry ?? createCoreRegistry(),
    checkpoint
  });
}

function noopCheckpoint(): void {
  // Intentionally empty; resource lifecycle supplies a real checkpoint in a later stage.
}
