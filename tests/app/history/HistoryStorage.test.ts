import { describe, expect, it } from "vitest";
import { CalculationHistory } from "../../../src/app/history/CalculationHistory.js";
import { HistoryStorage } from "../../../src/app/history/HistoryStorage.js";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const settings = {
  angleMode: "radians" as const,
  factorialMode: "gamma" as const,
  maxCalculationTimeMs: 5000
};
const value = {
  sign: 1 as const,
  digits: "3141592653589793",
  exponent10: 0n,
  verifiedDigits: 16,
  valueExact: false,
  decimalTerminating: false,
  rounded: false
};

describe("HistoryStorage", () => {
  it("roundtrips nested reference snapshots, bigint exponents, and original settings", () => {
    const storage = new MemoryStorage();
    const store = new HistoryStorage(storage);
    let next = 1;
    const history = new CalculationHistory(() => `entry-${String(next++)}`);
    const pi = history.record({
      expression: [{ kind: "source", source: "π" }],
      originalExpressionText: "π",
      displayedResultText: "3,141592653589793",
      settings,
      resultValue: value
    });
    const nested = history.record({
      expression: [
        { kind: "reference", id: pi.id },
        { kind: "source", source: "+1" }
      ],
      originalExpressionText: "3,141592653589793+1",
      displayedResultText: "4,141592653589793",
      settings: { ...settings, angleMode: "degrees" },
      resultValue: { ...value, digits: "4141592653589793" }
    });
    expect(store.save(history.entries)).toBe(true);
    const loaded = new CalculationHistory();
    loaded.restore(store.load());
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.get(pi.id)?.settings).toEqual(settings);
    expect(loaded.get(nested.id)?.settings.angleMode).toBe("degrees");
    expect(loaded.get(nested.id)?.expression).toEqual(nested.expression);
    expect(loaded.get(pi.id)?.resultValue.exponent10).toBe(0n);
    expect(loaded.snapshotsFor([{ kind: "reference", id: nested.id }])).toHaveLength(2);
  });

  it("isolates corrupted entries and rejects an incompatible version", () => {
    const storage = new MemoryStorage();
    const store = new HistoryStorage(storage);
    const history = new CalculationHistory(() => "valid");
    history.record({
      expression: [{ kind: "source", source: "π" }],
      originalExpressionText: "π",
      displayedResultText: "3,14",
      settings,
      resultValue: value
    });
    store.save(history.entries);
    const key = "bigcalc.history.v1";
    const saved: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (
      saved === null ||
      typeof saved !== "object" ||
      !("entries" in saved) ||
      !Array.isArray(saved.entries)
    )
      throw new Error("Expected a saved history document");
    const entries = saved.entries as unknown[];
    entries.push({ id: "bad", expression: [{ kind: "reference", id: "missing" }] });
    storage.setItem(key, JSON.stringify(saved));
    expect(store.load()).toHaveLength(1);
    storage.setItem(key, JSON.stringify({ ...saved, version: 2 }));
    expect(store.load()).toEqual([]);
  });
});
