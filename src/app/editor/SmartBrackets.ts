import { createCharacterToken } from "./ExpressionModel.js";
import type { ExpressionModel, ExpressionToken } from "./ExpressionModel.js";

export type SmartBracketPair = "()" | "{}" | "[]";

const OPEN_TO_CLOSE = { "(": ")", "{": "}", "[": "]" } as const;
const CLOSE_TO_OPEN = { ")": "(", "}": "{", "]": "[" } as const;
type OpeningBracket = keyof typeof OPEN_TO_CLOSE;
type ClosingBracket = keyof typeof CLOSE_TO_OPEN;

/** Inspect only the prefix at the insertion point, keeping malformed input safe. */
export function chooseSmartBracket(
  tokens: readonly ExpressionToken[],
  insertionIndex: number,
  pair: SmartBracketPair
): string {
  if (
    !Number.isSafeInteger(insertionIndex) ||
    insertionIndex < 0 ||
    insertionIndex > tokens.length
  ) {
    throw new RangeError("Invalid smart bracket insertion index");
  }
  const stack: OpeningBracket[] = [];
  for (const token of tokens.slice(0, insertionIndex)) {
    if (token.kind !== "character") continue;
    const symbol = token.value;
    if (symbol in OPEN_TO_CLOSE) {
      stack.push(symbol as OpeningBracket);
    } else if (
      symbol in CLOSE_TO_OPEN &&
      stack.at(-1) === CLOSE_TO_OPEN[symbol as ClosingBracket]
    ) {
      stack.pop();
    }
  }
  const opening = pair[0] as OpeningBracket;
  return stack.at(-1) === opening ? OPEN_TO_CLOSE[opening] : opening;
}

export function insertSmartBracket(
  model: ExpressionModel,
  pair: SmartBracketPair
): ExpressionModel {
  const insertionIndex = model.selection.start;
  return model.insert(createCharacterToken(chooseSmartBracket(model.tokens, insertionIndex, pair)));
}
