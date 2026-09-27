import { describe, expect, it } from "vitest";
import { ButtonPressState } from "../../../src/app/interaction/ButtonPress.js";

describe("ButtonPressState", () => {
  it("activates on release even when no click follows and consumes a later pointer click", () => {
    const press = new ButtonPressState();
    expect(press.begin(1, 20, 30)).toBe(true);
    expect(press.tracks(1)).toBe(true);
    expect(press.end(1, 20, 30, true)).toBe(true);
    expect(press.acceptClick(1)).toBe(false);
    expect(press.acceptClick(1)).toBe(true);
  });

  it("cancels a pointer and suppresses a stray pointer click", () => {
    const press = new ButtonPressState();
    press.begin(3, 0, 0);
    expect(press.cancel(3)).toBe(true);
    expect(press.end(3, 0, 0, true)).toBe(false);
    expect(press.acceptClick(1)).toBe(false);
    expect(press.cancel(3)).toBe(false);
  });

  it("cancels a drag and an out-of-bounds release", () => {
    const press = new ButtonPressState();
    press.begin(4, 0, 0);
    expect(press.move(4, 13, 0)).toBe(true);
    expect(press.end(4, 13, 0, true)).toBe(false);
    expect(press.acceptClick(1)).toBe(false);
    expect(press.begin(5, 0, 0)).toBe(true);
    expect(press.end(5, 0, 0, false)).toBe(false);
    expect(press.acceptClick(1)).toBe(false);
  });

  it("accepts keyboard clicks after any pointer sequence", () => {
    const press = new ButtonPressState();
    expect(press.acceptClick(0)).toBe(true);
    press.begin(6, 1, 1);
    expect(press.end(6, 1, 1, true)).toBe(true);
    expect(press.acceptClick(0)).toBe(true);
    expect(press.acceptClick(1)).toBe(false);
    expect(press.begin(7, 1, 1)).toBe(true);
    expect(press.end(7, 1, 1, true)).toBe(true);
  });
});
