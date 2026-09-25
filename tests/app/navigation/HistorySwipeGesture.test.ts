import { describe, expect, it } from "vitest";
import { HistorySwipeGesture } from "../../../src/app/navigation/HistorySwipeGesture.js";

const point = (pointerId: number, x: number, y: number, time: number) => ({
  pointerId,
  x,
  y,
  time
});

describe("History swipe gesture", () => {
  it("returns to idle after three successive vertical gestures", () => {
    const gesture = new HistorySwipeGesture();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      gesture.begin(point(cycle + 1, 100, 50, 0));
      gesture.move(point(cycle + 1, 102, 100, 80));
      expect(gesture.finish(point(cycle + 1, 103, 140, 120))).toBe(true);
      expect(gesture.tracking).toBe(false);
    }
  });

  it("accepts a recognized vertical gesture cancelled by native arbitration and resets", () => {
    const gesture = new HistorySwipeGesture();
    gesture.begin(point(1, 100, 50, 0));
    gesture.move(point(1, 101, 120, 100));
    expect(gesture.cancel(1)).toBe(true);
    expect(gesture.cancel(1)).toBe(false);
    gesture.begin(point(2, 100, 50, 0));
    expect(gesture.finish(point(2, 100, 130, 150))).toBe(true);
  });

  it("ignores horizontal, diagonal and short cancelled gestures", () => {
    const gesture = new HistorySwipeGesture();
    gesture.begin(point(1, 100, 50, 0));
    expect(gesture.finish(point(1, 20, 55, 60))).toBe(false);
    gesture.begin(point(2, 100, 50, 0));
    expect(gesture.finish(point(2, 20, 120, 60))).toBe(false);
    gesture.begin(point(3, 100, 50, 0));
    gesture.move(point(3, 101, 60, 100));
    expect(gesture.cancel(3)).toBe(false);
    expect(gesture.tracking).toBe(false);
  });

  it("ignores unrelated pointers and explicit navigation resets", () => {
    const gesture = new HistorySwipeGesture();
    gesture.begin(point(1, 100, 50, 0));
    gesture.move(point(2, 100, 150, 80));
    expect(gesture.finish(point(2, 100, 150, 80))).toBe(false);
    expect(gesture.tracking).toBe(true);
    gesture.reset();
    expect(gesture.finish(point(1, 100, 150, 120))).toBe(false);
    expect(gesture.tracking).toBe(false);
  });
});
