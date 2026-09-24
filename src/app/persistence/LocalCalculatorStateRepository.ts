import { APPLICATION_SCHEMA_VERSION } from "./contracts.js";
import type {
  CalculatorStateRepository,
  PersistentCalculatorState,
  StoragePort
} from "./contracts.js";

export const CALCULATOR_STATE_STORAGE_KEY = "bigcalc.app.calculator-state.v1";

interface StoredModuleState {
  readonly moduleId: string;
  readonly revision: number;
  readonly value: unknown;
}

/** Persists only data explicitly selected by a calculator's declaration. */
export class LocalCalculatorStateRepository implements CalculatorStateRepository {
  readonly #storage: StoragePort;

  constructor(storage: StoragePort) {
    this.#storage = storage;
  }

  load<T>(declaration: PersistentCalculatorState<T>): T | null {
    if (!validDeclaration(declaration)) return null;
    try {
      const document = this.#read();
      if (document?.schemaVersion !== APPLICATION_SCHEMA_VERSION) return null;
      const record = document.modules.find(
        (item) => item.moduleId === declaration.moduleId && item.revision === declaration.revision
      );
      if (record === undefined || !isJsonValue(record.value)) return null;
      return declaration.deserialize(record.value);
    } catch {
      return null;
    }
  }

  save<T>(declaration: PersistentCalculatorState<T>, value: T): boolean {
    if (!validDeclaration(declaration)) return false;
    try {
      const encoded = declaration.serialize(value);
      if (!isJsonValue(encoded)) return false;
      const document = this.#read();
      if (document !== null && document.schemaVersion !== APPLICATION_SCHEMA_VERSION) return false;
      const modules = (document?.modules ?? []).filter(
        (item) => item.moduleId !== declaration.moduleId || item.revision !== declaration.revision
      );
      modules.push({
        moduleId: declaration.moduleId,
        revision: declaration.revision,
        value: encoded
      });
      this.#storage.setItem(
        CALCULATOR_STATE_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: APPLICATION_SCHEMA_VERSION,
          modules
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  #read(): { schemaVersion: unknown; modules: StoredModuleState[] } | null {
    const raw = this.#storage.getItem(CALCULATOR_STATE_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    if (!("schemaVersion" in parsed)) return null;
    if (parsed.schemaVersion !== APPLICATION_SCHEMA_VERSION) {
      return { schemaVersion: parsed.schemaVersion, modules: [] };
    }
    if (!Array.isArray(parsed.modules)) return { schemaVersion: parsed.schemaVersion, modules: [] };
    const modules: StoredModuleState[] = [];
    for (const item of parsed.modules as unknown[]) {
      if (
        isRecord(item) &&
        typeof item.moduleId === "string" &&
        item.moduleId.trim() &&
        Number.isSafeInteger(item.revision) &&
        (item.revision as number) > 0 &&
        isJsonValue(item.value)
      )
        modules.push({
          moduleId: item.moduleId,
          revision: item.revision as number,
          value: item.value
        });
    }
    return { schemaVersion: parsed.schemaVersion, modules };
  }
}

function validDeclaration<T>(declaration: PersistentCalculatorState<T>): boolean {
  return (
    typeof declaration.moduleId === "string" &&
    declaration.moduleId.trim().length > 0 &&
    Number.isSafeInteger(declaration.revision) &&
    declaration.revision > 0
  );
}

function isJsonValue(value: unknown, visited = new Set<object>(), depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || visited.has(value)) return false;
  if (Array.isArray(value)) {
    visited.add(value);
    const valid = value.every((item: unknown) => isJsonValue(item, visited, depth + 1));
    visited.delete(value);
    return valid;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  visited.add(value);
  const valid = Object.values(value as Record<string, unknown>).every((item) =>
    isJsonValue(item, visited, depth + 1)
  );
  visited.delete(value);
  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
