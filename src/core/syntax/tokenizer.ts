import { syntaxError } from "../errors/index.js";
import type { CalcError } from "../errors/index.js";
import type { CoreRegistry } from "../registry/index.js";
import { createRational } from "../values/index.js";
import type { Rational } from "../values/index.js";
import { segmentRegisteredNameRun } from "./name-tokenizer.js";

export type Token = NumberToken | RegisteredNameToken | OperatorToken | DelimiterToken | EndToken;

export type TokenizationResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: CalcError };

export interface NumberToken {
  readonly kind: "number";
  readonly raw: string;
  readonly value: Rational;
  readonly integerLiteral: boolean;
  readonly start: number;
  readonly end: number;
}

export interface RegisteredNameToken {
  readonly kind: "registered-name";
  readonly nameKind: "function" | "constant";
  readonly canonicalName: string;
  readonly sourceName: string;
  readonly start: number;
  readonly end: number;
}

export interface OperatorToken {
  readonly kind: "operator";
  readonly value: "+" | "-" | "*" | "/" | "^" | "!" | "%";
  readonly start: number;
  readonly end: number;
}

export interface DelimiterToken {
  readonly kind: "delimiter";
  readonly value: "(" | ")" | "{" | "}" | "[" | "]" | ";";
  readonly start: number;
  readonly end: number;
}

export interface EndToken {
  readonly kind: "end";
  readonly start: number;
  readonly end: number;
}

export function tokenizeExpression(source: string, registry: CoreRegistry): TokenizationResult {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === undefined) {
      break;
    }

    if (isWhitespace(character)) {
      return {
        ok: false,
        error: syntaxError("Whitespace is not part of normalized BigCalc input", {
          start: index,
          end: index + 1
        })
      };
    }

    if (isDigit(character)) {
      const result = readNumber(source, index);
      if (!result.ok) {
        return result;
      }

      tokens.push(result.token);
      index = result.token.end;
      continue;
    }

    if (isNameCharacter(character)) {
      const start = index;
      while (index < source.length && isNameCharacter(source[index] ?? "")) {
        index += 1;
      }

      const segment = source.slice(start, index);
      const result = segmentRegisteredNameRun(segment, start, registry);

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      for (const token of result.tokens) {
        if (token.kind !== "registered-name") {
          continue;
        }

        tokens.push({
          kind: "registered-name",
          nameKind: token.nameKind,
          canonicalName: token.canonicalName,
          sourceName: token.sourceName,
          start: token.start,
          end: token.end
        });
      }
      continue;
    }

    if (isOperator(character)) {
      tokens.push({
        kind: "operator",
        value: character,
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }

    if (isDelimiter(character)) {
      tokens.push({
        kind: "delimiter",
        value: character,
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }

    if (character === ",") {
      return {
        ok: false,
        error: syntaxError("Comma is only valid inside decimal literals", {
          start: index,
          end: index + 1
        })
      };
    }

    return {
      ok: false,
      error: syntaxError(`Unexpected character: ${character}`, {
        start: index,
        end: index + 1
      })
    };
  }

  tokens.push({ kind: "end", start: source.length, end: source.length });
  return { ok: true, tokens: Object.freeze(tokens) };
}

type ReadNumberResult =
  | { readonly ok: true; readonly token: NumberToken }
  | { readonly ok: false; readonly error: CalcError };

function readNumber(source: string, start: number): ReadNumberResult {
  let index = start;

  while (index < source.length && isDigit(source[index] ?? "")) {
    index += 1;
  }

  let integerLiteral = true;
  let denominator = 1n;

  if (source[index] === ",") {
    integerLiteral = false;
    index += 1;

    const fractionalStart = index;
    while (index < source.length && isDigit(source[index] ?? "")) {
      index += 1;
    }

    if (index === fractionalStart) {
      return {
        ok: false,
        error: syntaxError("Decimal comma must be followed by digits", {
          start: index - 1,
          end: index
        })
      };
    }

    denominator = 10n ** BigInt(index - fractionalStart);
  }

  const raw = source.slice(start, index);
  const numerator = BigInt(raw.replace(",", ""));

  return {
    ok: true,
    token: {
      kind: "number",
      raw,
      value: createRational(numerator, denominator),
      integerLiteral,
      start,
      end: index
    }
  };
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isNameCharacter(character: string): boolean {
  return /^[A-Za-zπ]$/.test(character);
}

function isOperator(character: string): character is OperatorToken["value"] {
  return (
    character === "+" ||
    character === "-" ||
    character === "*" ||
    character === "/" ||
    character === "^" ||
    character === "!" ||
    character === "%"
  );
}

function isDelimiter(character: string): character is DelimiterToken["value"] {
  return (
    character === "(" ||
    character === ")" ||
    character === "{" ||
    character === "}" ||
    character === "[" ||
    character === "]" ||
    character === ";"
  );
}
