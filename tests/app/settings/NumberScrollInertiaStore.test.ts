import { describe, expect, it } from "vitest";
import { NumberScrollInertiaStore } from "../../../src/app/settings/NumberScrollInertiaStore.js";

describe("number scroll inertia storage", () => {
  it("starts at 1.6 and persists a numeric setting across instances", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    };
    const first = new NumberScrollInertiaStore(storage);
    expect(first.load()).toBe(1.6);
    expect(first.save(2)).toBe(true);
    expect(new NumberScrollInertiaStore(storage).load()).toBe(2);
    expect([...values.values()].map((raw): unknown => JSON.parse(raw) as unknown)).toEqual([
      { version: 1, value: 2 }
    ]);
  });

  it("uses the default for invalid, future, or inaccessible storage", () => {
    let raw = "{broken";
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      }
    };
    const store = new NumberScrollInertiaStore(storage);
    expect(store.load()).toBe(1.6);
    raw = JSON.stringify({ version: 2, value: 2 });
    expect(store.load()).toBe(1.6);
    expect(store.save(Number.NaN)).toBe(false);
    expect(store.save(0)).toBe(false);
    expect(store.save(0.09)).toBe(false);
    expect(store.save(100.01)).toBe(false);
    const unavailable = new NumberScrollInertiaStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(unavailable.load()).toBe(1.6);
    expect(unavailable.save(1)).toBe(false);
  });

  it.each([0.1, 100])("round-trips the new inclusive boundary %s", (value) => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, text: string) => {
        values.set(key, text);
      }
    };
    expect(new NumberScrollInertiaStore(storage).save(value)).toBe(true);
    expect(new NumberScrollInertiaStore(storage).load()).toBe(value);
  });
});
