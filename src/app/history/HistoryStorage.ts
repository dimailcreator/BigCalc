import type { CalculationHistoryEntry } from "./CalculationHistory.js";
import type {
  CalculationExpressionSegmentDto,
  CalculationSettingsDto,
  VerifiedNumberDto
} from "../calculation/CalculationProtocol.js";

const STORAGE_KEY = "bigcalc.history.v1";

/** Versioned Stage 15 storage; Stage 16 will place this behind HistoryRepository. */
export class HistoryStorage {
  readonly #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage;
  }

  load(): readonly CalculationHistoryEntry[] {
    try {
      const raw = this.#storage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      const document: unknown = JSON.parse(raw);
      if (!isRecord(document) || document.version !== 1 || !Array.isArray(document.entries)) {
        return [];
      }
      const entries: CalculationHistoryEntry[] = [];
      const known = new Set<string>();
      for (const candidate of document.entries as unknown[]) {
        const entry = parseEntry(candidate);
        if (entry === null || known.has(entry.id)) continue;
        if (entry.expression.some((part) => part.kind === "reference" && !known.has(part.id))) {
          continue;
        }
        known.add(entry.id);
        entries.push(entry);
      }
      return Object.freeze(entries);
    } catch {
      return [];
    }
  }

  save(entries: readonly CalculationHistoryEntry[]): boolean {
    try {
      this.#storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          entries: entries.map((entry) => ({
            ...entry,
            resultValue: {
              ...entry.resultValue,
              exponent10: entry.resultValue.exponent10.toString()
            }
          }))
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

function parseEntry(value: unknown): CalculationHistoryEntry | null {
  if (!isRecord(value)) return null;
  const expression = parseExpression(value.expression);
  const settings = parseSettings(value.settings);
  const resultValue = parseResult(value.resultValue);
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isSafeInteger(value.order) ||
    (value.order as number) < 0 ||
    typeof value.originalExpressionText !== "string" ||
    typeof value.displayedResultText !== "string" ||
    expression === null ||
    settings === null ||
    resultValue === null
  )
    return null;
  return Object.freeze({
    id: value.id,
    createdAt: value.createdAt,
    order: value.order as number,
    originalExpressionText: value.originalExpressionText,
    displayedResultText: value.displayedResultText,
    expression,
    settings,
    resultValue
  });
}

function parseExpression(value: unknown): readonly CalculationExpressionSegmentDto[] | null {
  if (!Array.isArray(value)) return null;
  const segments: CalculationExpressionSegmentDto[] = [];
  for (const segment of value as unknown[]) {
    if (!isRecord(segment)) return null;
    if (segment.kind === "source" && typeof segment.source === "string") {
      segments.push(Object.freeze({ kind: "source", source: segment.source }));
    } else if (
      segment.kind === "reference" &&
      typeof segment.id === "string" &&
      segment.id.trim()
    ) {
      segments.push(Object.freeze({ kind: "reference", id: segment.id }));
    } else return null;
  }
  return Object.freeze(segments);
}

function parseSettings(value: unknown): CalculationSettingsDto | null {
  if (!isRecord(value)) return null;
  if (
    (value.angleMode !== "radians" && value.angleMode !== "degrees") ||
    (value.factorialMode !== "integer" && value.factorialMode !== "gamma") ||
    typeof value.maxCalculationTimeMs !== "number" ||
    !Number.isFinite(value.maxCalculationTimeMs) ||
    value.maxCalculationTimeMs < 0
  )
    return null;
  return Object.freeze({
    angleMode: value.angleMode,
    factorialMode: value.factorialMode,
    maxCalculationTimeMs: value.maxCalculationTimeMs
  });
}

function parseResult(value: unknown): VerifiedNumberDto | null {
  if (!isRecord(value)) return null;
  if (
    (value.sign !== -1 && value.sign !== 0 && value.sign !== 1) ||
    typeof value.digits !== "string" ||
    !/^\d*$/u.test(value.digits) ||
    typeof value.exponent10 !== "string" ||
    !/^-?\d+$/u.test(value.exponent10) ||
    !Number.isSafeInteger(value.verifiedDigits) ||
    (value.verifiedDigits as number) < 0 ||
    typeof value.valueExact !== "boolean" ||
    typeof value.decimalTerminating !== "boolean" ||
    typeof value.rounded !== "boolean" ||
    (value.zeroKind !== undefined && value.zeroKind !== "exact" && value.zeroKind !== "rounded")
  )
    return null;
  return Object.freeze({
    sign: value.sign,
    digits: value.digits,
    exponent10: BigInt(value.exponent10),
    verifiedDigits: value.verifiedDigits as number,
    valueExact: value.valueExact,
    decimalTerminating: value.decimalTerminating,
    rounded: value.rounded,
    ...(value.zeroKind === undefined ? {} : { zeroKind: value.zeroKind })
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
