import { createAtomicIdentifierToken, createCharacterToken } from "./ExpressionModel.js";
import type { ExpressionToken } from "./ExpressionModel.js";

// Built-in public names from CORE_SPEC.md. Registration changes must update this UI list.
export const FUNCTION_NAMES = ["sin", "cos", "tan", "exp", "log", "ln", "abs"] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];
const functionNames = new Set<string>(FUNCTION_NAMES);
const NAMES = [...FUNCTION_NAMES, "e"].sort((left, right) => right.length - left.length);
const SYNTAX_CHARACTER = /^[0-9,+\-*/^%!(){}\[\];π]$/u;

export function isFunctionName(name: string): name is FunctionName {
  return functionNames.has(name);
}

/** Filter untrusted text into editor tokens; this is not a mathematical parser. */
export function parseEditorText(text: string): readonly ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let offset = 0;
  while (offset < text.length) {
    const remaining = text.slice(offset);
    const word = /^[a-z]+/iu.exec(remaining)?.[0];
    if (word !== undefined) {
      const names = splitKnownNames(word.toLowerCase());
      if (names !== null) {
        for (const name of names) {
          tokens.push(name === "e" ? createCharacterToken("e") : createAtomicIdentifierToken(name));
        }
      }
      offset += word.length;
      continue;
    }

    const symbol = String.fromCodePoint(text.codePointAt(offset) ?? 0);
    if (SYNTAX_CHARACTER.test(symbol)) tokens.push(createCharacterToken(symbol));
    offset += symbol.length;
  }
  return tokens;
}

function splitKnownNames(word: string): readonly string[] | null {
  const names: string[] = [];
  let offset = 0;
  while (offset < word.length) {
    const match = NAMES.find((name) => word.startsWith(name, offset));
    if (match === undefined) return null;
    names.push(match);
    offset += match.length;
  }
  return names;
}
