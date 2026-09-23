import { describe, expect, it } from "vitest";
import { MathModeStore } from "../../../src/app/settings/MathModeStore.js";

describe("math mode storage", () => {
  it("uses documented defaults and persists only angle and factorial modes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    };
    const first = new MathModeStore(storage);
    expect(first.load()).toEqual({ angleMode: "degrees", factorialMode: "integer" });
    const modes = {
      angleMode: "radians",
      factorialMode: "gamma",
      maxCalculationTimeMs: 5_000
    } as const;
    expect(first.save(modes)).toBe(true);
    expect(new MathModeStore(storage).load()).toEqual({
      angleMode: "radians",
      factorialMode: "gamma"
    });
    const stored = JSON.parse([...values.values()][0] ?? "null") as Record<string, unknown>;
    expect(stored).toEqual({ version: 1, angleMode: "radians", factorialMode: "gamma" });
    expect(stored).not.toHaveProperty("expanded");
  });

  it("isolates malformed or future-version data and unavailable storage", () => {
    let raw = "{broken";
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      }
    };
    const store = new MathModeStore(storage);
    expect(store.load()).toEqual({ angleMode: "degrees", factorialMode: "integer" });
    raw = JSON.stringify({ version: 2, angleMode: "radians", factorialMode: "gamma" });
    expect(store.load()).toEqual({ angleMode: "degrees", factorialMode: "integer" });
    const unavailable = new MathModeStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(unavailable.load()).toEqual({ angleMode: "degrees", factorialMode: "integer" });
    expect(unavailable.save({ angleMode: "radians", factorialMode: "gamma" })).toBe(false);
  });
});
