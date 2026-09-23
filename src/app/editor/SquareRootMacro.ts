import { ExpressionModel, createCharacterToken } from "./ExpressionModel.js";
import type { ExpressionToken } from "./ExpressionModel.js";

const ROOT_SUFFIX = Array.from(")^(1/2)", createCharacterToken);

/** The √ key is an editor macro; Core receives only its existing power syntax. */
export function insertSquareRootMacro(model: ExpressionModel): ExpressionModel {
  const { start, end } = model.selection;
  const selected = model.tokens.slice(start, end);
  const inserted: ExpressionToken[] = [createCharacterToken("("), ...selected, ...ROOT_SUFFIX];
  const tokens = [...model.tokens.slice(0, start), ...inserted, ...model.tokens.slice(end)];
  const cursor = selected.length === 0 ? start + 1 : start + inserted.length;
  return new ExpressionModel(tokens, cursor);
}
