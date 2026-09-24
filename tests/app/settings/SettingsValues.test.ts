import { describe, expect, it } from "vitest";
import {
  formatSettingNumber,
  parseNumberScrollInertia,
  parseTimeoutSeconds
} from "../../../src/app/settings/SettingsValues.js";

describe("settings input validation", () => {
  it("converts finite non-negative seconds to milliseconds without admitting invalid text", () => {
    expect(parseTimeoutSeconds("0")).toBe(0);
    expect(parseTimeoutSeconds("1,25")).toBe(1250);
    expect(parseTimeoutSeconds("5.001")).toBe(5001);
    for (const text of ["", "-1", "1,", "1,0001", "NaN", "Infinity", "1e3"]) {
      expect(parseTimeoutSeconds(text)).toBeNull();
    }
  });

  it("accepts the documented inertia range and formats decimal comma", () => {
    expect(parseNumberScrollInertia("0,5")).toBe(0.5);
    expect(parseNumberScrollInertia("1.6")).toBe(1.6);
    expect(parseNumberScrollInertia("3")).toBe(3);
    for (const text of ["0,49", "3,01", "-1", "1,234", "foo"]) {
      expect(parseNumberScrollInertia(text)).toBeNull();
    }
    expect(formatSettingNumber(1.6)).toBe("1,6");
  });
});
