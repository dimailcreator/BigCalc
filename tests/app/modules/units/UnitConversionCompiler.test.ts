import { describe, expect, it } from "vitest";
import {
  compileUnitConversion,
  UnitConversionError
} from "../../../../src/app/modules/units/UnitConversionCompiler.js";
import { parseUnitExpression } from "../../../../src/app/modules/units/UnitParser.js";

const compile = (value: string, from: string, to: string) =>
  compileUnitConversion(value, parseUnitExpression(from), parseUnitExpression(to));

function rejects(operation: () => unknown, code: string): void {
  let failure: unknown;
  try {
    operation();
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(UnitConversionError);
  expect(failure).toMatchObject({ code });
}

describe("exact conversion source compiler", () => {
  it.each(["1", "π", "√2", "1+2", "-2^2", "2^50%", "5!%", "log{2+3}[3](8)"])(
    "preserves and contains mathematical source %s without interpreting it",
    (value) => {
      const result = compile(value, "km", "m");
      expect(result.source).toBe(`(${value})*(((10)^(3))*(1))/(1)`);
      expect(result.valueSource).toBe(value);
      expect(result.requiresValueSyntaxCheck).toBe(false);
      expect(result).toEqual(compile(value, "km", "m"));
      expect(Object.isFrozen(result)).toBe(true);
    }
  );
  it("keeps fractional and symbolic scales exact", () => {
    expect(compile("1", "km/h", "m/s").source).toBe("(1)*((((10)^(3))*(1))/(3600))/(1)");
    expect(compile("1", "°", "rad").source).toContain("π");
    expect(compile("1", "J/W", "s").kind).toBe("linear");
    expect(compile("1", "km^2", "m^2").source).toContain("^(2)");
  });
  it.each([
    ["25", "°C", "K"],
    ["0", "K", "°C"],
    ["32", "°F", "°C"],
    ["212", "°F", "K"],
    ["0", "°R", "K"]
  ])("compiles affine %s %s → %s through exact offsets", (value, from, to) => {
    const result = compile(value, from, to);
    expect(result.kind).toBe("affine");
    expect(result.factorSource).toBeNull();
    expect(result.source).toMatch(/^\(\(\(/);
    expect(result.source).toContain(`(${value})`);
    expect(result.source).not.toMatch(/273\.15|459\.67/);
    expect(result).toEqual(compile(value, from, to));
  });
  it("provides only exact factor source, never displayed numeric metadata", () => {
    expect(compile("π", "km", "m").factorSource).toBe("(((10)^(3))*(1))/(1)");
  });
  it.each([
    ["m", "s", "DimensionMismatch"],
    ["°C", "K*m/m", "AffineCounterpart"],
    ["K^1", "°F", "AffineCounterpart"],
    ["°R", "K^0*K", "AffineCounterpart"]
  ])("rejects %s → %s before mathematical compilation", (from, to, code) => {
    rejects(() => compile("1", from, to), code);
  });
  it("accepts grouped standalone temperature, and Kelvin compounds only in linear conversions", () => {
    expect(compile("25", "(°C)", "((K))").kind).toBe("affine");
    expect(compile("25", "K*m/m", "K^1").kind).toBe("linear");
  });
  it.each(["Ans", "2Ans", "Ans+1", "ans", "ANS", "πAns", "Ansπ", "sin(Ans)"])(
    "rejects raw reserved History reference %s",
    (value) => {
      rejects(() => compile(value, "m", "m"), "HistoryReferenceNotAllowed");
    }
  );
  it("rejects structured History identity regardless of displayed text", () => {
    rejects(
      () =>
        compileUnitConversion(
          { kind: "requires-ans-resolution", tokens: [] },
          parseUnitExpression("m"),
          parseUnitExpression("m")
        ),
      "HistoryReferenceNotAllowed"
    );
  });
  it.each(["1)*2+(3", "(1+2", "log{2](3)", "sin[2(3)", "1)"])(
    "never repairs unbalanced source %s with conversion wrappers",
    (value) => {
      const result = compile(value, "km", "m");
      expect(result.source).toBe(value);
      expect(result.requiresValueSyntaxCheck).toBe(true);
    }
  );
  it("leaves unknown mathematical identifiers to Core", () => {
    expect(compile("mystery(2)", "m", "m").valueSource).toBe("mystery(2)");
  });
});
