import { describe, expect, it } from "vitest";
import {
  LocalSettingsRepository,
  SETTINGS_STORAGE_KEY
} from "../../../src/app/persistence/LocalSettingsRepository.js";
import { APPLICATION_SCHEMA_VERSION } from "../../../src/app/persistence/contracts.js";
import { MathModeStore } from "../../../src/app/settings/MathModeStore.js";
import { NumberScrollInertiaStore } from "../../../src/app/settings/NumberScrollInertiaStore.js";
import { DEFAULT_APP_SETTINGS } from "../../../src/app/state/AppState.js";
import type { AppSettings } from "../../../src/app/state/AppState.js";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const oldSettings = {
  angleMode: "radians",
  factorialMode: "gamma",
  maxCalculationTimeMs: 2300,
  numberScrollInertia: 3.5
};

describe("appearance settings persistence", () => {
  it("loads an old v1 document with defaults, preserving its saved settings until the next save", () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify({ schemaVersion: 1, ...oldSettings });
    storage.setItem(SETTINGS_STORAGE_KEY, original);
    const repository = new LocalSettingsRepository(storage);
    const settings = repository.load();
    expect(settings).toEqual({ ...DEFAULT_APP_SETTINGS, ...oldSettings });
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(original);
    expect(repository.save(settings)).toBe(true);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toEqual({
      schemaVersion: 1,
      ...settings
    });
    expect(APPLICATION_SCHEMA_VERSION).toBe(1);
  });

  it("defaults only missing appearance fields in a partial v1 document", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ...oldSettings, palette: "rose" })
    );
    expect(new LocalSettingsRepository(storage).load()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      ...oldSettings,
      palette: "rose"
    });
  });

  it.each([
    { theme: "dark" },
    { theme: "light" },
    { palette: "lavender" },
    { palette: "blue" },
    { palette: "teal" },
    { palette: "amber" },
    { palette: "rose" },
    { palette: "liquid-glass" },
    { displaySize: "small" },
    { displaySize: "medium" },
    { displaySize: "large" }
  ] as const)("round-trips allowed appearance values: %j", (appearance) => {
    const storage = new MemoryStorage();
    const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...appearance };
    expect(new LocalSettingsRepository(storage).save(settings)).toBe(true);
    expect(new LocalSettingsRepository(storage).load()).toEqual(settings);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toEqual({
      schemaVersion: 1,
      ...settings
    });
  });

  it.each([
    ["theme", "system"],
    ["palette", "purple"],
    ["displaySize", "huge"],
    ["theme", null],
    ["palette", 1],
    ["displaySize", {}]
  ])("rejects invalid %s = %j without silently rewriting storage", (field, value) => {
    const storage = new MemoryStorage();
    const invalid = { ...DEFAULT_APP_SETTINGS, ...oldSettings, [field]: value };
    const original = JSON.stringify({ schemaVersion: 1, ...invalid });
    storage.setItem(SETTINGS_STORAGE_KEY, original);
    const repository = new LocalSettingsRepository(storage);
    expect(repository.load()).toEqual(DEFAULT_APP_SETTINGS);
    expect(repository.save(invalid as AppSettings)).toBe(false);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(original);
  });

  it("requires all appearance fields on new saves", () => {
    const storage = new MemoryStorage();
    expect(new LocalSettingsRepository(storage).save(oldSettings as AppSettings)).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it.each(["math modes", "inertia"])(
    "migrates legacy %s alone into a full settings document",
    (kind) => {
      const storage = new MemoryStorage();
      if (kind === "math modes") {
        new MathModeStore(storage).save({ angleMode: "radians", factorialMode: "gamma" });
      } else {
        new NumberScrollInertiaStore(storage).save(2.5);
      }
      const expected = {
        ...DEFAULT_APP_SETTINGS,
        ...(kind === "math modes"
          ? { angleMode: "radians", factorialMode: "gamma" }
          : { numberScrollInertia: 2.5 })
      };
      expect(new LocalSettingsRepository(storage).load()).toEqual(expected);
      expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "null")).toEqual({
        schemaVersion: 1,
        ...expected
      });
      expect(new LocalSettingsRepository(storage).load()).toEqual(expected);
    }
  );

  it("protects a future schema even when it contains valid appearance values", () => {
    const storage = new MemoryStorage();
    const future = JSON.stringify({
      schemaVersion: 2,
      ...DEFAULT_APP_SETTINGS,
      theme: "light",
      palette: "teal",
      displaySize: "large"
    });
    storage.setItem(SETTINGS_STORAGE_KEY, future);
    const repository = new LocalSettingsRepository(storage);
    expect(repository.load()).toEqual(DEFAULT_APP_SETTINGS);
    expect(repository.save(DEFAULT_APP_SETTINGS)).toBe(false);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(future);
  });
});
