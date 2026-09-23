import { describe, expect, it } from "vitest";
import {
  COMPACT_ROWS,
  EXPANDED_ROWS,
  KEY_LABELS
} from "../../../src/app/keyboard/KeyboardLayout.js";

describe("calculator keyboard layouts", () => {
  it("has the specified four columns and six or nine rows", () => {
    expect(COMPACT_ROWS).toHaveLength(6);
    expect(EXPANDED_ROWS).toHaveLength(9);
    expect([...COMPACT_ROWS, ...EXPANDED_ROWS].map((row) => row.length)).toEqual(Array(15).fill(4));
  });

  it("keeps the reserved A1 slot non-interactive and all compact rows in expanded mode", () => {
    expect(COMPACT_ROWS[0]).toEqual(["expand", "angle", "factorial", "reserved"]);
    expect(EXPANDED_ROWS[0]).toEqual(COMPACT_ROWS[0]);
    expect(EXPANDED_ROWS.slice(4)).toEqual(COMPACT_ROWS.slice(1));
    expect(KEY_LABELS.reserved).toBe("");
  });

  it("places the math rows in the documented order", () => {
    expect(EXPANDED_ROWS.slice(1, 4).map((row) => row.map((key) => KEY_LABELS[key]))).toEqual([
      ["√", "π", "^", "!"],
      ["[]", "sin", "cos", "tan"],
      ["{}", "e", "ln", "log"]
    ]);
  });
});
