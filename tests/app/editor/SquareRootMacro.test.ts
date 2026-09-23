import { describe, expect, it } from "vitest";
import { insertSquareRootMacro } from "../../../src/app/editor/SquareRootMacro.js";
import {
  ExpressionModel,
  createAnsToken,
  createAtomicIdentifierToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";

const expression = (source: string): ExpressionModel =>
  new ExpressionModel(Array.from(source, createCharacterToken));

describe("square root editor macro", () => {
  it("inserts an empty operand and places the cursor inside it", () => {
    const original = expression("2+");
    const result = insertSquareRootMacro(original);
    expect(result.serializeDisplay()).toBe("2+()^(1/2)");
    expect(result.cursor).toBe(3);
    expect(result.serializeForEvaluation()).toEqual({ kind: "source", source: "2+()^(1/2)" });
    expect(original.serializeDisplay()).toBe("2+");
  });

  it("wraps a selection and leaves the cursor after the macro", () => {
    const result = insertSquareRootMacro(expression("2+3*4").setSelection(2, 5));
    expect(result.serializeDisplay()).toBe("2+(3*4)^(1/2)");
    expect(result.cursor).toBe(result.tokens.length);
  });

  it("keeps atomic selected tokens intact and never turns Ans display into source", () => {
    const original = new ExpressionModel([
      createAtomicIdentifierToken("sin"),
      createAnsToken("history-5", "0,5")
    ]).setSelection(0, 2);
    const result = insertSquareRootMacro(original);
    expect(result.tokens[1]).toEqual(original.tokens[0]);
    expect(result.tokens[2]).toEqual(original.tokens[1]);
    expect(result.serializeDisplay()).toBe("(sin0,5)^(1/2)");
    expect(result.serializeForEvaluation().kind).toBe("requires-ans-resolution");
  });
});
