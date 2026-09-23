import { describe, expect, it } from "vitest";
import { chooseSmartBracket, insertSmartBracket } from "../../../src/app/editor/SmartBrackets.js";
import {
  ExpressionModel,
  createAnsToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";

function expression(source: string, cursor = Array.from(source).length): ExpressionModel {
  return new ExpressionModel(Array.from(source, createCharacterToken), cursor);
}

describe("smart bracket input", () => {
  it.each([
    ["", 0, "()", "("],
    ["", 0, "{}", "{"],
    ["", 0, "[]", "["],
    ["(2", 2, "()", ")"],
    ["{2", 2, "{}", "}"],
    ["[2", 2, "[]", "]"],
    ["({2", 3, "()", "("],
    ["({2", 3, "{}", "}"],
    ["([2", 3, "[]", "]"],
    ["(2)+3", 2, "()", ")"],
    ["(2)+3", 5, "()", "("],
    ["([)]", 3, "[]", "]"],
    [")]{", 2, "()", "("],
    [")]{", 3, "{}", "}"]
  ] as const)("chooses %s at cursor %s for %s", (source, cursor, pair, expected) => {
    expect(chooseSmartBracket(expression(source).tokens, cursor, pair)).toBe(expected);
  });

  it("uses the replacement start and ignores syntax characters inside Ans display", () => {
    const selected = expression("(23").setSelection(1, 3);
    const inserted = insertSmartBracket(selected, "()");
    expect(inserted.serializeDisplay()).toBe("()");
    expect(inserted.cursor).toBe(2);

    const withAns = new ExpressionModel([createAnsToken("history-1", "(123")]);
    expect(chooseSmartBracket(withAns.tokens, 1, "()")).toBe("(");
  });

  it("rejects a cursor outside token boundaries", () => {
    const tokens = expression("2").tokens;
    expect(() => chooseSmartBracket(tokens, -1, "()")).toThrow(RangeError);
    expect(() => chooseSmartBracket(tokens, 2, "()")).toThrow(RangeError);
  });
});
