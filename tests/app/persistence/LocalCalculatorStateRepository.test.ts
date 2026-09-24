import { describe, expect, it } from "vitest";
import {
  LocalCalculatorStateRepository,
  CALCULATOR_STATE_STORAGE_KEY
} from "../../../src/app/persistence/LocalCalculatorStateRepository.js";
import type { PersistentCalculatorState } from "../../../src/app/persistence/contracts.js";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

interface DeclaredState {
  readonly input: string;
}
const declaration: PersistentCalculatorState<DeclaredState> = {
  moduleId: "example",
  revision: 1,
  serialize(value) {
    return { input: value.input };
  },
  deserialize(value) {
    if (
      value !== null &&
      typeof value === "object" &&
      "input" in value &&
      typeof value.input === "string"
    ) {
      return { input: value.input };
    }
    return null;
  }
};

describe("LocalCalculatorStateRepository", () => {
  it("keeps only declared JSON data across restart", () => {
    const storage = new MemoryStorage();
    const first = new LocalCalculatorStateRepository(storage);
    expect(first.load(declaration)).toBeNull();
    expect(
      first.save(declaration, { input: "42", workerHandle: "runtime-only" } as DeclaredState)
    ).toBe(true);
    expect(new LocalCalculatorStateRepository(storage).load(declaration)).toEqual({ input: "42" });
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).not.toMatch(/workerHandle/u);
    expect(first.load({ ...declaration, revision: 2 })).toBeNull();
  });

  it("isolates corrupt modules and refuses non-JSON or future-version writes", () => {
    const storage = new MemoryStorage();
    const repository = new LocalCalculatorStateRepository(storage);
    storage.setItem(
      CALCULATOR_STATE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        modules: [
          { moduleId: "broken", revision: 1, value: { input: null } },
          { moduleId: "example", revision: 1, value: { input: "saved" } }
        ]
      })
    );
    expect(repository.load(declaration)).toEqual({ input: "saved" });
    expect(
      repository.save({ ...declaration, serialize: () => ({ graph: 1n }) }, { input: "new" })
    ).toBe(false);
    const future = JSON.stringify({ schemaVersion: 3, opaque: true });
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, future);
    expect(repository.load(declaration)).toBeNull();
    expect(repository.save(declaration, { input: "new" })).toBe(false);
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(future);
  });
});
