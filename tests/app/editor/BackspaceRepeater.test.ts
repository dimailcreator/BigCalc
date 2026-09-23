import { afterEach, describe, expect, it, vi } from "vitest";
import { BackspaceRepeater } from "../../../src/app/editor/BackspaceRepeater.js";
import {
  ExpressionModel,
  createAtomicIdentifierToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";

afterEach(() => vi.useRealTimers());

describe("Backspace hold", () => {
  it("deletes once immediately, then repeats after the hold delay", () => {
    vi.useFakeTimers();
    let model = new ExpressionModel([
      createCharacterToken("2"),
      createAtomicIdentifierToken("sin"),
      createCharacterToken("3")
    ]);
    const repeater = new BackspaceRepeater(
      () => {
        model = model.deleteBackward();
      },
      400,
      70
    );
    repeater.start();
    expect(model.serializeDisplay()).toBe("2sin");
    vi.advanceTimersByTime(399);
    expect(model.serializeDisplay()).toBe("2sin");
    vi.advanceTimersByTime(1);
    expect(model.serializeDisplay()).toBe("2");
    vi.advanceTimersByTime(70);
    expect(model.serializeDisplay()).toBe("");
    repeater.stop();
    vi.advanceTimersByTime(500);
    expect(model.serializeDisplay()).toBe("");
  });

  it("short press deletes the entire selection without another deletion", () => {
    vi.useFakeTimers();
    let model = new ExpressionModel([
      createCharacterToken("2"),
      createAtomicIdentifierToken("sin"),
      createCharacterToken("3")
    ]).setSelection(1, 3);
    const repeater = new BackspaceRepeater(
      () => {
        model = model.deleteBackward();
      },
      400,
      70
    );
    repeater.start();
    repeater.stop();
    vi.advanceTimersByTime(1_000);
    expect(model.serializeDisplay()).toBe("2");
    expect(model.cursor).toBe(1);
  });

  it("does not schedule twice for repeated start and validates timing", () => {
    vi.useFakeTimers();
    const deleted = vi.fn();
    const repeater = new BackspaceRepeater(deleted, 100, 50);
    repeater.start();
    repeater.start();
    expect(deleted).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(deleted).toHaveBeenCalledTimes(2);
    repeater.stop();
    expect(() => new BackspaceRepeater(deleted, -1, 50)).toThrow(RangeError);
    expect(() => new BackspaceRepeater(deleted, 100, 0)).toThrow(RangeError);
  });
});
