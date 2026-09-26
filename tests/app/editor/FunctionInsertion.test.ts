import { describe, expect, it } from "vitest";
import { FUNCTION_NAMES, parseEditorText } from "../../../src/app/editor/ClipboardParser.js";
import {
  ExpressionModel,
  createAnsToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";
import { insertFunctionMacro } from "../../../src/app/editor/FunctionInsertion.js";
import { insertSmartBracket } from "../../../src/app/editor/SmartBrackets.js";

const expression = (source: string): ExpressionModel =>
  new ExpressionModel(Array.from(source, createCharacterToken));

describe("function insertion command", () => {
  it.each(FUNCTION_NAMES)(
    "inserts %s as an atomic name followed by an ordinary bracket",
    (name) => {
      const inserted = insertFunctionMacro(new ExpressionModel(), name);
      expect(inserted.tokens).toEqual([
        { kind: "identifier", name },
        { kind: "character", value: "(" }
      ]);
      expect(inserted.serializeDisplay()).toBe(`${name}(`);
      expect(inserted.cursor).toBe(2);
      expect(inserted.serializeForEvaluation()).toEqual({ kind: "source", source: `${name}(` });
    }
  );

  it("keeps the bracket separately deletable and the name atomic", () => {
    const inserted = insertFunctionMacro(new ExpressionModel(), "sin");
    expect(inserted.deleteBackward().serializeDisplay()).toBe("sin");
    expect(inserted.deleteBackward().deleteBackward().serializeDisplay()).toBe("");
    expect(inserted.setCursorFromDisplayOffset(1).cursor).toBe(0);
    expect(inserted.setCursorFromDisplayOffset(2).cursor).toBe(1);
  });

  it("lets the smart bracket key close the inserted opening bracket", () => {
    const inserted = insertFunctionMacro(new ExpressionModel(), "sin").insertTokens([
      createCharacterToken("3"),
      createCharacterToken("0")
    ]);
    const closed = insertSmartBracket(inserted, "()");
    expect(closed.serializeForEvaluation()).toEqual({ kind: "source", source: "sin(30)" });
  });

  it("wraps a selection and places the cursor after the closing bracket", () => {
    const selected = expression("x+1").setSelection(0, 3);
    const wrapped = insertFunctionMacro(selected, "sin");
    expect(wrapped.serializeDisplay()).toBe("sin(x+1)");
    expect(wrapped.tokens[0]).toEqual({ kind: "identifier", name: "sin" });
    expect(wrapped.tokens[1]).toEqual({ kind: "character", value: "(" });
    expect(wrapped.tokens.at(-1)).toEqual({ kind: "character", value: ")" });
    expect(wrapped.cursor).toBe(wrapped.tokens.length);
    expect(wrapped.selection.start).toBe(wrapped.selection.end);
  });

  it("preserves selected Ans references and leaves parsed text untouched", () => {
    const ans = createAnsToken("history-17");
    const wrapped = insertFunctionMacro(new ExpressionModel([ans]).setSelection(0, 1), "abs");
    expect(wrapped.tokens[2]).toEqual(ans);
    expect(wrapped.serializeForEvaluation().kind).toBe("requires-ans-resolution");
    const pasted = new ExpressionModel(parseEditorText("sin(30)"));
    expect(pasted.serializeDisplay()).toBe("sin(30)");
    expect(pasted.tokens[1]).toEqual({ kind: "character", value: "(" });
  });
});
