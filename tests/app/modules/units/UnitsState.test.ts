import { describe, expect, it } from "vitest";
import {
  createUnitsState,
  serializeUnitsState,
  unitsStatePersistence
} from "../../../../src/app/modules/units/UnitsState.js";
import { createUnitsExpression } from "../../../../src/app/modules/units/UnitsExpression.js";
import { compileUnitConversion } from "../../../../src/app/modules/units/UnitConversionCompiler.js";
import { parseUnitExpression } from "../../../../src/app/modules/units/UnitParser.js";

describe("Units source-only state and expression reconstruction", () => {
  it("creates fresh immutable defaults with exactly three source strings", () => {
    const first = createUnitsState();
    expect(first).toEqual({ valueSource: "1", fromUnitText: "км/ч", toUnitText: "м/с" });
    expect(first).not.toBe(createUnitsState());
    expect(Object.isFrozen(first)).toBe(true);
    expect(unitsStatePersistence.moduleId).toBe("units");
    expect(unitsStatePersistence.revision).toBe(1);
  });
  it.each([
    ["", "", ""],
    ["1+", "(км", "м^"],
    [" π / 2 ", " киломЕтр ", "м/с"],
    ["sin(30)+log{2+3}[3](8)", "μм", "м"],
    ["Ans+1", "km", "m"],
    ["mystery(2)", "not-a-unit", "m"],
    ["1)*2+(3", "m", "cm"]
  ])("round trips raw source without trimming, coercion or validation: %s", (value, from, to) => {
    const source = createUnitsState(value, from, to);
    const encoded = serializeUnitsState(source);
    expect(encoded).toEqual(source);
    expect(encoded).not.toBe(source);
    expect(
      unitsStatePersistence.deserialize(JSON.parse(JSON.stringify(encoded)) as unknown)
    ).toEqual(source);
  });
  it.each([
    null,
    [],
    "1",
    1,
    true,
    {},
    { valueSource: "1" },
    { valueSource: "1", fromUnitText: "m" },
    { valueSource: 1, fromUnitText: "m", toUnitText: "cm" },
    { valueSource: "1", fromUnitText: null, toUnitText: "cm" },
    { valueSource: "1", fromUnitText: "m", toUnitText: [] }
  ])("rejects malformed DTO %j for Host default fallback", (input) => {
    expect(unitsStatePersistence.deserialize(input)).toBeNull();
  });
  it("ignores foreign runtime fields on both boundaries, including non-JSON state", () => {
    const source = {
      ...createUnitsState("π", "km", "m"),
      result: { digits: "999", exponent10: 0n },
      session: { dispose: () => undefined },
      expression: createUnitsExpression("999"),
      compiledSource: "999",
      dimensions: [1n],
      focus: "fromUnit",
      selection: [0, 3],
      viewportPosition: 999n,
      error: "stale"
    };
    expect(serializeUnitsState(source)).toEqual(createUnitsState("π", "km", "m"));
    expect(unitsStatePersistence.deserialize(source)).toEqual(createUnitsState("π", "km", "m"));
    expect(() => JSON.stringify(serializeUnitsState(source))).not.toThrow();
  });
  it.each([
    "",
    "1",
    "1/3",
    "π/2",
    "√2",
    "2^100",
    "sin(30)",
    "SIN(30)",
    "sinlogln(2)",
    "πE",
    "log{2+3}[3](8)",
    "180,",
    "1+",
    "1)*2+(3",
    "mystery(2)",
    "1 + 2\n",
    "Ans+1",
    "2ANS",
    "😀+2",
    "1.2",
    "2−1"
  ])("reconstructs the exact original expression %s using the existing editor model", (source) => {
    const model = createUnitsExpression(source);
    expect(model.serializeDisplay()).toBe(source);
    expect(model.serializeForEvaluation()).toEqual({ kind: "source", source });
    expect(model.tokens.every((token) => token.kind !== "ans")).toBe(true);
    expect(model.anchor).toBe(model.tokens.length);
    expect(model.focus).toBe(model.tokens.length);
    expect(model).not.toBe(createUnitsExpression(source));
  });
  it.each(["sin", "cos", "tan", "exp", "log", "ln", "abs", "SIN", "LoG"])(
    "retains registered atomic identifier %s and ordinary brackets",
    (name) => {
      const model = createUnitsExpression(`${name}(2)`);
      expect(model.tokens[0]).toEqual({ kind: "identifier", name });
      expect(model.tokens[1]).toEqual({ kind: "character", value: "(" });
      expect(model.setSelection(0, 1).deleteBackward().serializeDisplay()).toBe("(2)");
    }
  );
  it("keeps reserved Ans atomic but creates no History identity or numeric replacement", () => {
    const model = createUnitsExpression("Ans+1");
    expect(model.tokens[0]).toEqual({ kind: "identifier", name: "Ans" });
    let failure: unknown;
    try {
      compileUnitConversion(
        model.serializeForEvaluation(),
        parseUnitExpression("m"),
        parseUnitExpression("m")
      );
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "HistoryReferenceNotAllowed" });
  });
});
