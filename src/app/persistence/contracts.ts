import type { CalculationHistoryEntry } from "../history/CalculationHistory.js";
import type { AppSettings } from "../state/AppState.js";

export const APPLICATION_SCHEMA_VERSION = 1;

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsRepository {
  load(): AppSettings;
  save(settings: AppSettings): boolean;
}

export interface HistoryRepository {
  load(): readonly CalculationHistoryEntry[];
  save(entries: readonly CalculationHistoryEntry[]): boolean;
}

/** A module declares precisely which JSON data survives restart. */
export interface PersistentCalculatorState<T> {
  readonly moduleId: string;
  readonly revision: number;
  serialize(value: T): unknown;
  deserialize(value: unknown): T | null;
}

export interface CalculatorStateRepository {
  load<T>(declaration: PersistentCalculatorState<T>): T | null;
  save<T>(declaration: PersistentCalculatorState<T>, value: T): boolean;
}
