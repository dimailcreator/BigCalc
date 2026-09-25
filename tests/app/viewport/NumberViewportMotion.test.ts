import { describe, expect, it } from "vitest";
import {
  dragDigitSteps,
  momentumDigitSteps,
  momentumProgress
} from "../../../src/app/viewport/NumberViewportMotion.js";

describe("discrete number motion", () => {
  it("maps the same drag to whole digit positions for 1.0, 1.6, and 2.0 inertia", () => {
    expect(dragDigitSteps(80, 20, 1)).toBe(4);
    expect(dragDigitSteps(80, 20, 1.6)).toBe(6);
    expect(dragDigitSteps(80, 20, 2)).toBe(8);
    expect(dragDigitSteps(-80, 20, 1.6)).toBe(-6);
    expect(dragDigitSteps(5, 20, 1)).toBe(0);
  });

  it("adds bounded momentum only for a fast swipe", () => {
    expect(momentumDigitSteps(-0.1, 20, 1.6, 18)).toBe(0);
    expect(momentumDigitSteps(-1, 20, 1, 18)).toBe(12);
    expect(momentumDigitSteps(-1, 20, 1.6, 18)).toBe(19);
    expect(momentumDigitSteps(-1, 20, 2, 18)).toBe(24);
    expect(momentumDigitSteps(100, 20, 2, 18)).toBe(-72);
  });

  it("continues after release and slows monotonically", () => {
    const [start, first, second, third, finish] = [0, 80, 160, 240, 320].map(momentumProgress);
    expect(start).toBe(0);
    expect(finish).toBe(1);
    expect(first).toBeGreaterThan(0);
    expect((second ?? 0) - (first ?? 0)).toBeLessThan((first ?? 0) - (start ?? 0));
    expect((third ?? 0) - (second ?? 0)).toBeLessThan((second ?? 0) - (first ?? 0));
  });

  it("keeps an extreme but finite setting within safe integer steps", () => {
    expect(dragDigitSteps(80, 20, Number.MAX_VALUE)).toBe(Number.MAX_SAFE_INTEGER);
    expect(momentumDigitSteps(-1, 20, Number.MAX_VALUE, 18)).toBe(72);
  });
});
