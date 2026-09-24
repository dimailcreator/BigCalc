import { describe, expect, it } from "vitest";
import { createApplicationRepositories } from "../../../src/app/persistence/ApplicationRepositories.js";
import { SETTINGS_STORAGE_KEY } from "../../../src/app/persistence/LocalSettingsRepository.js";
import { MathModeStore } from "../../../src/app/settings/MathModeStore.js";
import { NumberScrollInertiaStore } from "../../../src/app/settings/NumberScrollInertiaStore.js";
import { DEFAULT_APP_SETTINGS } from "../../../src/app/state/AppState.js";
import type { CalculationHistoryEntry } from "../../../src/app/history/CalculationHistory.js";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const entry: CalculationHistoryEntry = Object.freeze({
  id: "saved-result",
  createdAt: "2026-09-24T12:00:00.000Z",
  order: 0,
  expression: [{ kind: "source" as const, source: "sin(30)" }],
  originalExpressionText: "sin(30)",
  displayedResultText: "0,5",
  settings: {
    angleMode: "degrees" as const,
    factorialMode: "integer" as const,
    maxCalculationTimeMs: 5000
  },
  resultValue: {
    sign: 1 as const,
    digits: "5",
    exponent10: -1n,
    verifiedDigits: 1,
    valueExact: true,
    decimalTerminating: true,
    rounded: false
  }
});

describe("application repositories", () => {
  it("returns documented defaults on a fresh install and restores only saved DTOs", () => {
    const storage = new MemoryStorage();
    const first = createApplicationRepositories(storage);
    expect(first.settings.load()).toEqual(DEFAULT_APP_SETTINGS);
    expect(first.history.load()).toEqual([]);
    expect(storage.items.size).toBe(0);
    expect(
      first.settings.save({
        angleMode: "radians",
        factorialMode: "gamma",
        maxCalculationTimeMs: 2400,
        numberScrollInertia: 2.25
      })
    ).toBe(true);
    expect(first.history.save([entry])).toBe(true);
    const restarted = createApplicationRepositories(storage);
    expect(restarted.settings.load()).toEqual({
      angleMode: "radians",
      factorialMode: "gamma",
      maxCalculationTimeMs: 2400,
      numberScrollInertia: 2.25
    });
    expect(restarted.history.load()).toEqual([entry]);
    const raw = [...storage.items.values()].join(" ");
    expect(raw).not.toMatch(
      /workerHandle|evaluationGraph|lazyState|keyboardExpanded|timeoutDialog/u
    );
  });

  it("migrates the Stage 10 and 11 settings keys into the application schema", () => {
    const storage = new MemoryStorage();
    new MathModeStore(storage).save({ angleMode: "radians", factorialMode: "gamma" });
    new NumberScrollInertiaStore(storage).save(2.5);
    const migrated = createApplicationRepositories(storage).settings.load();
    expect(migrated).toEqual({
      angleMode: "radians",
      factorialMode: "gamma",
      maxCalculationTimeMs: 5000,
      numberScrollInertia: 2.5
    });
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toMatchObject({
      schemaVersion: 1,
      angleMode: "radians",
      numberScrollInertia: 2.5
    });
    new MathModeStore(storage).save({ angleMode: "degrees", factorialMode: "integer" });
    expect(createApplicationRepositories(storage).settings.load()).toEqual(migrated);
  });

  it("rejects persisted inertia outside the Settings control range", () => {
    const storage = new MemoryStorage();
    const repositories = createApplicationRepositories(storage);
    expect(repositories.settings.save({ ...DEFAULT_APP_SETTINGS, numberScrollInertia: 4 })).toBe(
      false
    );
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        ...DEFAULT_APP_SETTINGS,
        numberScrollInertia: 4
      })
    );
    expect(repositories.settings.load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("normalizes a legacy inertia outside the Settings control range", () => {
    const storage = new MemoryStorage();
    new MathModeStore(storage).save({ angleMode: "radians", factorialMode: "gamma" });
    new NumberScrollInertiaStore(storage).save(4);
    const migrated = createApplicationRepositories(storage).settings.load();
    expect(migrated).toEqual({
      ...DEFAULT_APP_SETTINGS,
      angleMode: "radians",
      factorialMode: "gamma"
    });
    expect(createApplicationRepositories(storage).settings.load()).toEqual(migrated);
  });

  it("preserves documents from a future schema version", () => {
    const storage = new MemoryStorage();
    const futureSettings = JSON.stringify({ schemaVersion: 2, opaque: "future" });
    const futureHistory = JSON.stringify({ version: 2, opaque: "future" });
    storage.setItem(SETTINGS_STORAGE_KEY, futureSettings);
    storage.setItem("bigcalc.history.v1", futureHistory);
    const repositories = createApplicationRepositories(storage);
    expect(repositories.settings.load()).toEqual(DEFAULT_APP_SETTINGS);
    expect(repositories.history.load()).toEqual([]);
    expect(repositories.settings.save(DEFAULT_APP_SETTINGS)).toBe(false);
    expect(repositories.history.save([entry])).toBe(false);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(futureSettings);
    expect(storage.getItem("bigcalc.history.v1")).toBe(futureHistory);
  });
});
