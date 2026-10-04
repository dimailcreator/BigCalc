import { describe, expect, it } from "vitest";
import {
  calculateBmi,
  classifyBmi,
  deriveBmiResult,
  formatBmi,
  parseBmiInput
} from "../../../../src/app/modules/bmi/BmiModel.js";
import type { BmiCategory } from "../../../../src/app/modules/bmi/BmiModel.js";

describe("BMI input parsing", () => {
  it.each([
    ["180", 180],
    ["180,5", 180.5],
    ["180.5", 180.5],
    ["0,5", 0.5],
    ["00075.00", 75],
    [" 180,5 ", 180.5],
    ["0.000001", 0.000001],
    ["1000000", 1000000]
  ])("accepts positive decimal input %s without physiological limits", (text, value) => {
    expect(parseBmiInput(text)).toEqual({ status: "valid", value });
  });

  it.each(["", " ", "\t\n"])("recognizes empty input %j", (text) => {
    expect(parseBmiInput(text)).toEqual({ status: "empty" });
  });

  it.each(["180,", "180.", "0,", "0."])("leaves unfinished decimals %s incomplete", (text) => {
    expect(parseBmiInput(text)).toEqual({ status: "incomplete" });
  });

  it.each(["0", "0,00", "-0", "-0.0", "-180", "-75,5"])(
    "rejects completed nonpositive input %s",
    (text) => {
      expect(parseBmiInput(text)).toEqual({ status: "invalid", reason: "nonPositive" });
    }
  );

  it.each([
    "height",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e3",
    "0x10",
    "1 000",
    "1_000",
    "1,000.5",
    "1.000,5",
    "180..5",
    "180,,5",
    "180kg",
    "180\n75",
    "+180",
    ".",
    ","
  ])("rejects invalid decimal syntax %j", (text) => {
    expect(parseBmiInput(text)).toEqual({ status: "invalid", reason: "invalidSyntax" });
  });

  it("rejects decimal input that overflows instead of leaking Infinity", () => {
    expect(parseBmiInput("9".repeat(400))).toEqual({ status: "invalid", reason: "nonFinite" });
  });
});

describe("BMI calculation", () => {
  it.each([
    [180, 75, 75 / 3.24],
    [200, 100, 25],
    [150, 45, 20],
    [50, 1, 4]
  ])("calculates BMI for %s cm and %s kg", (height, weight, expected) => {
    expect(calculateBmi(height, weight)).toBeCloseTo(expected, 12);
  });

  it.each([0, -0, -1, NaN, Infinity, -Infinity])("rejects invalid height or weight %s", (value) => {
    expect(calculateBmi(value, 75)).toBeNull();
    expect(calculateBmi(180, value)).toBeNull();
  });

  it("rejects overflow and unrepresentable zero without a result or category", () => {
    expect(calculateBmi(Number.MIN_VALUE, Number.MAX_VALUE)).toBeNull();
    expect(calculateBmi(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
  });

  it("keeps representable results when squaring the height would overflow or underflow", () => {
    expect(calculateBmi(1e200, 1e308)).toBeCloseTo(1e-88, 100);
    const bmi = calculateBmi(1e-200, 1e-308);
    expect(bmi).not.toBeNull();
    if (bmi === null) throw new Error("Representable BMI was rejected");
    expect(bmi / 1e96).toBeCloseTo(1, 12);
  });
});

describe("BMI classification", () => {
  const cases: readonly (readonly [number, BmiCategory])[] = [
    [10, "Недостаточная масса"],
    [18.5, "Норма"],
    [25, "Избыточная масса"],
    [30, "Ожирение I степени"],
    [35, "Ожирение II степени"],
    [40, "Ожирение III степени"],
    [18.499999999999996, "Недостаточная масса"],
    [24.999999999999996, "Норма"],
    [29.999999999999996, "Избыточная масса"],
    [34.99999999999999, "Ожирение I степени"],
    [39.99999999999999, "Ожирение II степени"],
    [1000, "Ожирение III степени"]
  ];
  it.each(cases)("classifies unrounded BMI %s as %s", (bmi, category) => {
    expect(classifyBmi(bmi)).toBe(category);
  });

  it.each([0, -0, -1, NaN, Infinity, -Infinity])("does not classify an invalid value %s", (bmi) => {
    expect(classifyBmi(bmi)).toBeNull();
  });
});

describe("BMI formatting", () => {
  it.each([
    [23.154321, "23,15"],
    [23.156, "23,16"],
    [25, "25"],
    [18.5, "18,5"],
    [29.996, "30"],
    [1234.5, "1234,5"],
    [0.001, "0"],
    [1e21, "1" + "0".repeat(21)],
    [Number.MAX_VALUE, "17976931348623157" + "0".repeat(292)]
  ])("formats %s as %s without grouping or a locale-dependent separator", (bmi, text) => {
    expect(formatBmi(bmi)).toBe(text);
  });

  it.each([0, -0, -1, NaN, Infinity, -Infinity])("does not display invalid BMI %s", (bmi) => {
    expect(formatBmi(bmi)).toBeNull();
  });
});

describe("BMI derivation", () => {
  it("derives the metric base case", () => {
    const derived = deriveBmiResult("180", "75");
    expect(derived.height).toEqual({ status: "valid", value: 180 });
    expect(derived.weight).toEqual({ status: "valid", value: 75 });
    expect(derived.result).toMatchObject({
      status: "valid",
      formattedBmi: "23,15",
      category: "Норма"
    });
    if (derived.result.status !== "valid") throw new Error("Base case has no result");
    expect(derived.result.rawBmi).toBeCloseTo(75 / 3.24, 12);
  });

  it("derives the same result from comma and dot inputs", () => {
    expect(deriveBmiResult("180,5", "75,5")).toEqual(deriveBmiResult("180.5", "75.5"));
    expect(deriveBmiResult("180,5", "75.5").result.status).toBe("valid");
  });

  it.each([
    ["", "empty"],
    ["180,", "incomplete"],
    ["invalid", "invalid"],
    ["0", "invalid"],
    ["9".repeat(400), "invalid"]
  ])("withholds the result when either field is %s", (text, status) => {
    const invalidHeight = deriveBmiResult(text, "75");
    expect(invalidHeight.height.status).toBe(status);
    expect(invalidHeight.result).toEqual({ status: "unavailable" });
    const invalidWeight = deriveBmiResult("180", text);
    expect(invalidWeight.weight.status).toBe(status);
    expect(invalidWeight.result).toEqual({ status: "unavailable" });
  });

  it("classifies raw 29.996 as overweight even though it displays 30", () => {
    expect(deriveBmiResult("100", "29,996").result).toEqual({
      status: "valid",
      rawBmi: 29.996,
      formattedBmi: "30",
      category: "Избыточная масса"
    });
  });

  it.each([
    ["18,5", "Норма"],
    ["25", "Избыточная масса"],
    ["30", "Ожирение I степени"],
    ["35", "Ожирение II степени"],
    ["40", "Ожирение III степени"]
  ])("preserves classification at the exact %s boundary", (weight, category) => {
    expect(deriveBmiResult("100", weight).result).toEqual({
      status: "valid",
      rawBmi: Number(weight.replace(",", ".")),
      formattedBmi: weight,
      category
    });
  });

  it("reports calculation overflow separately from otherwise valid inputs", () => {
    const heightText = "0," + "0".repeat(199) + "1";
    const weightText = "1" + "0".repeat(308);
    const derived = deriveBmiResult(heightText, weightText);
    expect(derived.height.status).toBe("valid");
    expect(derived.weight.status).toBe("valid");
    expect(derived.result).toEqual({ status: "invalid", reason: "unrepresentableResult" });
  });

  it("does not present calculation underflow as a zero BMI", () => {
    const derived = deriveBmiResult("1" + "0".repeat(308), "0," + "0".repeat(307) + "1");
    expect(derived.height.status).toBe("valid");
    expect(derived.weight.status).toBe("valid");
    expect(derived.result).toEqual({ status: "invalid", reason: "unrepresentableResult" });
  });
});
