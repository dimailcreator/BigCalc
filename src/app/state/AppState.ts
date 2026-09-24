import type { CalculatorUiState } from "./CalculatorState.js";
import { createInitialCalculatorUiState } from "./CalculatorState.js";
import type { CalculationHistoryEntry } from "../history/CalculationHistory.js";
import type { UiState } from "./UiState.js";
import { DEFAULT_UI_STATE } from "./UiState.js";

export interface EvaluationSettingsSnapshot {
  readonly angleMode: "radians" | "degrees";
  readonly factorialMode: "integer" | "gamma";
  readonly maxCalculationTimeMs: number;
}

export interface AppSettings extends EvaluationSettingsSnapshot {
  readonly numberScrollInertia: number;
}

export type HistoryEntry = CalculationHistoryEntry;

export interface CalculatorModuleState<TState = unknown> {
  readonly moduleId: string;
  readonly revision: number;
  readonly value: TState;
}

export interface AppState {
  readonly settings: AppSettings;
  readonly calculator: CalculatorUiState;
  readonly ui: UiState;
  readonly history: readonly HistoryEntry[];
  readonly calculatorModules: readonly CalculatorModuleState[];
  readonly activeCalculatorModuleId: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  angleMode: "degrees",
  factorialMode: "integer",
  maxCalculationTimeMs: 5_000,
  numberScrollInertia: 1.6
});

export function createInitialAppState(): AppState {
  return Object.freeze({
    settings: DEFAULT_APP_SETTINGS,
    calculator: createInitialCalculatorUiState(),
    ui: DEFAULT_UI_STATE,
    history: Object.freeze([]),
    calculatorModules: Object.freeze([]),
    activeCalculatorModuleId: "bigcalc"
  });
}
