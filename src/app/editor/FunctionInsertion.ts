import {
  ExpressionModel,
  createAtomicIdentifierToken,
  createCharacterToken
} from "./ExpressionModel.js";
import type { ExpressionToken } from "./ExpressionModel.js";
import type { FunctionName } from "./ClipboardParser.js";

/** A user function command inserts ordinary brackets around the current selection. */
export function insertFunctionMacro(model: ExpressionModel, name: FunctionName): ExpressionModel {
  const { start, end } = model.selection;
  const selected = model.tokens.slice(start, end);
  const inserted: ExpressionToken[] = [
    createAtomicIdentifierToken(name),
    createCharacterToken("("),
    ...selected
  ];
  if (selected.length > 0) inserted.push(createCharacterToken(")"));
  const tokens = [...model.tokens.slice(0, start), ...inserted, ...model.tokens.slice(end)];
  return new ExpressionModel(tokens, start + inserted.length);
}
