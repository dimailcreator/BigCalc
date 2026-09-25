import { describe, expect, it } from "vitest";
import {
  ExpressionModel,
  createAnsToken,
  createAtomicIdentifierToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";
import type { ExpressionToken } from "../../../src/app/editor/ExpressionModel.js";

const character = createCharacterToken;
const identifier = createAtomicIdentifierToken;
const ans = () => createAnsToken("history-42", "0,333…");

function model(...tokens: ExpressionToken[]): ExpressionModel {
  return new ExpressionModel(tokens);
}

describe("ExpressionModel logical editing", () => {
  it.each([
    { label: "a character", tokens: [character("2"), character("+")], cursor: 2, result: "2" },
    { label: "an identifier", tokens: [character("2"), identifier("sin")], cursor: 2, result: "2" },
    {
      label: "before an identifier",
      tokens: [identifier("sin"), character("(")],
      cursor: 1,
      result: "("
    },
    {
      label: "after an identifier",
      tokens: [character("2"), identifier("sin"), character("(")],
      cursor: 2,
      result: "2("
    },
    { label: "an Ans reference", tokens: [character("2"), ans()], cursor: 2, result: "2" },
    {
      label: "the first token",
      tokens: [identifier("sin"), character("(")],
      cursor: 0,
      result: "sin("
    }
  ])("deletes $label backward as one logical token", ({ tokens, cursor, result }) => {
    const original = model(...tokens).setCursor(cursor);
    const edited = original.deleteBackward();
    expect(edited.serializeDisplay()).toBe(result);
    expect(edited.cursor).toBe(cursor === 0 ? 0 : cursor - 1);
    expect(original.serializeDisplay()).toBe(
      tokens
        .map((token) =>
          token.kind === "character"
            ? token.value
            : token.kind === "identifier"
              ? token.name
              : "Ans"
        )
        .join("")
    );
  });

  it.each([
    { start: 2, end: 3, expected: [1, 2] },
    { start: 1, end: 2, expected: [1, 2] },
    { start: 0, end: 3, expected: [0, 2] },
    { start: 3, end: 2, expected: [2, 1] },
    { start: 4, end: 1, expected: [2, 1] }
  ])("expands display selection $start..$end across an identifier", ({ start, end, expected }) => {
    const expression = model(character("2"), identifier("sin"), character("("));
    const selected = expression.setSelectionFromDisplayOffsets(start, end);
    expect([selected.anchor, selected.focus]).toEqual(expected);
    expect(selected.selection).toMatchObject({
      start: Math.min(...expected),
      end: Math.max(...expected)
    });
  });

  it("selects the whole Ans token when touching its visible number", () => {
    const selected = model(character("1"), ans(), character("+")).setSelectionFromDisplayOffsets(
      3,
      4
    );
    expect(selected.selection).toMatchObject({ start: 1, end: 2 });
    const deleted = selected.deleteBackward();
    expect(deleted.serializeDisplay()).toBe("1+");
    expect(deleted.tokens.some((token) => token.kind === "ans")).toBe(false);
  });

  it("inserts before and after Ans without changing its reference", () => {
    const original = model(ans());
    const before = original.setCursor(0).insert(character("-"));
    const after = original.insert(character("+"));
    expect(before.serializeDisplay()).toBe("-Ans");
    expect(after.serializeDisplay()).toBe("Ans+");
    expect(before.tokens[1]).toEqual({
      kind: "ans",
      historyEntryId: "history-42",
      displayText: "Ans"
    });
    expect(after.tokens[0]).toEqual(before.tokens[1]);
  });

  it("replaces several selected tokens and leaves the cursor after the inserted tokens", () => {
    const original = model(
      character("2"),
      identifier("sin"),
      character("("),
      character("3"),
      character(")")
    );
    const edited = original
      .setSelection(1, 4)
      .insertTokens([identifier("cos"), character("("), character("4")]);
    expect(edited.serializeDisplay()).toBe("2cos(4)");
    expect(edited.cursor).toBe(4);
    expect(edited.selection).toMatchObject({ start: 4, end: 4 });
    expect(original.serializeDisplay()).toBe("2sin(3)");
  });

  it("moves across whole tokens and clamps at both boundaries", () => {
    const original = model(character("2"), identifier("sin"), ans());
    const first = original.setCursor(0);
    expect(first.moveCursor(-1).cursor).toBe(0);
    expect(first.moveCursor(1).cursor).toBe(1);
    expect(first.moveCursor(1).moveCursor(1).cursor).toBe(2);
    expect(original.moveCursor(1).cursor).toBe(3);
    expect(original.setSelection(1, 3).moveCursor(-1).cursor).toBe(1);
    expect(original.setSelection(1, 3).moveCursor(1).cursor).toBe(3);
    expect(original.setSelection(1, 3).moveCursor(-1, true).selection).toMatchObject({
      anchor: 1,
      focus: 2
    });
  });

  it("snaps a cursor inside an atomic token to a boundary", () => {
    const expression = model(character("2"), identifier("sin"), character("+"));
    expect(expression.setCursorFromDisplayOffset(2).cursor).toBe(1);
    expect(expression.setCursorFromDisplayOffset(3).cursor).toBe(2);
    expect(expression.setCursorFromDisplayOffset(2, "after").cursor).toBe(2);
    expect(expression.setCursorFromDisplayOffset(3, "before").cursor).toBe(1);
    expect(expression.setSelectionFromDisplayOffsets(2, 2).selection).toMatchObject({
      start: 1,
      end: 1
    });
  });

  it("serializes plain tokens for Core and keeps Ans as an unresolved reference", () => {
    const plain = model(
      character("2"),
      identifier("sin"),
      character("("),
      character("3"),
      character(")")
    );
    expect(plain.serializeForEvaluation()).toEqual({ kind: "source", source: "2sin(3)" });
    const withAns = model(character("2"), character("+"), ans());
    expect(withAns.serializeDisplay()).toBe("2+Ans");
    expect(withAns.serializeForEvaluation()).toEqual({
      kind: "requires-ans-resolution",
      tokens: withAns.tokens
    });
    expect(JSON.stringify(withAns.serializeForEvaluation())).toContain("history-42");
  });

  it("validates token shape and position boundaries", () => {
    expect(() => character("sin")).toThrow(TypeError);
    expect(() => character("")).toThrow(TypeError);
    expect(() => identifier("s")).toThrow(TypeError);
    expect(() => createAnsToken(" ")).toThrow(TypeError);
    expect(() => new ExpressionModel([character("2")], 2)).toThrow(RangeError);
    expect(() => model(character("2")).setSelection(-1, 1)).toThrow(RangeError);
    expect(() => model(character("2")).setCursorFromDisplayOffset(2)).toThrow(RangeError);
    expect(() => model(character("2")).moveCursor(0)).toThrow(RangeError);
  });

  it("copies and freezes input tokens so external mutation cannot change its state", () => {
    const input = [character("2")];
    const expression = new ExpressionModel(input);
    input.push(character("3"));
    expect(expression.serializeDisplay()).toBe("2");
    expect(Object.isFrozen(expression.tokens)).toBe(true);
    expect(Object.isFrozen(expression.tokens[0])).toBe(true);
  });
});
