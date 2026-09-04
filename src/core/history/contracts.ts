import type { CalcError } from "../errors/contracts.js";
import type { EvaluationSettings } from "../evaluation/contracts.js";
import type {
  CalculationHandleFromSourceResult,
  CalculationHandleOptions
} from "../evaluation/lifecycle.js";

export interface HistoryEntry {
  readonly id: string;
  readonly originalExpression: string;
  readonly displayedResultText: string;
  readonly settings: EvaluationSettings;
}

export interface RecordHistoryEntryInput {
  readonly originalExpression: string;
  readonly displayedResultText: string;
  readonly settings: EvaluationSettings;
}

export interface HistoryRepository {
  record(input: RecordHistoryEntryInput): HistoryEntry;
  get(id: string): HistoryEntry | null;
  getLatest(): HistoryEntry | null;
  list(): readonly HistoryEntry[];
}

export type HistoryReevaluationOptions = Omit<CalculationHandleOptions, "settings" | "registry">;

export interface HistoryAnsCalculationOptions extends Omit<CalculationHandleOptions, "registry"> {
  readonly ansEntryId?: string;
}

export type HistoryCalculationHandleResult =
  | ({
      readonly ok: true;
      readonly entry: HistoryEntry;
    } & Omit<Extract<CalculationHandleFromSourceResult, { readonly ok: true }>, "ok">)
  | { readonly ok: false; readonly error: CalcError };

export interface HistoryService {
  recordCalculation(input: RecordHistoryEntryInput): HistoryEntry;
  getEntry(id: string): HistoryEntry | null;
  getLatestEntry(): HistoryEntry | null;
  listEntries(): readonly HistoryEntry[];
  createCalculationHandleFromHistoryEntry(
    id: string,
    options?: HistoryReevaluationOptions
  ): HistoryCalculationHandleResult;
  createCalculationHandleFromAns(
    options?: HistoryAnsCalculationOptions
  ): HistoryCalculationHandleResult;
  createCalculationHandleFromSourceWithAns(
    source: string,
    options?: HistoryAnsCalculationOptions
  ): HistoryCalculationHandleResult;
}
