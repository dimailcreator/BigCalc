import { describe, expect, it, vi } from "vitest";
import { handleAndroidBack } from "../../../src/app/navigation/AndroidBack.js";

describe("Android Back priority", () => {
  it("closes the overlay before considering the keyboard or exit", () => {
    const navigation = { topLayer: "drawer" as const, back: vi.fn(() => true) };
    const inputs = { dismissMathKeyboard: vi.fn(() => true) };
    const exit = vi.fn();
    handleAndroidBack(navigation, inputs, exit, false);
    expect(navigation.back).toHaveBeenCalledOnce();
    expect(inputs.dismissMathKeyboard).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "dismisses the keyboard without navigating (back available: %s)",
    (backAvailable) => {
      const navigation = { topLayer: null, back: vi.fn(() => backAvailable) };
      const inputs = { dismissMathKeyboard: vi.fn(() => true) };
      const exit = vi.fn();
      handleAndroidBack(navigation, inputs, exit, false);
      expect(inputs.dismissMathKeyboard).toHaveBeenCalledOnce();
      expect(navigation.back).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    "uses the navigation stack, then exits only at its root (%s)",
    (backAvailable) => {
      const navigation = { topLayer: null, back: vi.fn(() => backAvailable) };
      const inputs = { dismissMathKeyboard: vi.fn(() => false) };
      const exit = vi.fn();
      handleAndroidBack(navigation, inputs, exit, false);
      expect(navigation.back).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledTimes(backAvailable ? 0 : 1);
    }
  );

  it.each([true, false])(
    "keeps the primary keyboard and uses navigation/exit (%s)",
    (backAvailable) => {
      const navigation = { topLayer: null, back: vi.fn(() => backAvailable) };
      const inputs = { dismissMathKeyboard: vi.fn(() => true) };
      const exit = vi.fn();
      handleAndroidBack(navigation, inputs, exit, true);
      expect(inputs.dismissMathKeyboard).not.toHaveBeenCalled();
      expect(navigation.back).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledTimes(backAvailable ? 0 : 1);
    }
  );
});
