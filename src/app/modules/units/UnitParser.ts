import { multiplyDimensions, divideDimensions, powerDimensions } from "./UnitDimensions.js";
import { multiplyScales, divideScales, powerScale } from "./UnitExpression.js";
import type { ParsedUnitExpression, UnitSyntax, UnitValue } from "./UnitExpression.js";
import { UnitDomainError } from "./UnitErrors.js";
import type { UnitDomainErrorCode, UnitSourceRange } from "./UnitErrors.js";
import { DEFAULT_UNIT_REGISTRY } from "./UnitRegistry.js";
import type { UnitRegistry } from "./UnitRegistry.js";

interface Token {
  readonly text: string;
  readonly range: UnitSourceRange;
  readonly spaced: boolean;
}
interface Node {
  readonly syntax: UnitSyntax;
  readonly value: UnitValue;
}

/** Unit grammar only. The mathematical value field continues to belong to Core. */
export function parseUnitExpression(
  source: string,
  registry: UnitRegistry = DEFAULT_UNIT_REGISTRY
): ParsedUnitExpression {
  return new Parser(source, registry).parse();
}

class Parser {
  readonly #source: string;
  readonly #registry: UnitRegistry;
  readonly #tokens: readonly Token[];
  #position = 0;
  constructor(source: string, registry: UnitRegistry) {
    this.#source = source;
    this.#registry = registry;
    const tokens: Token[] = [];
    const pattern = /\s+|[*×·/÷^()]|[^\s*×·/÷^()]+/gu;
    let spaced = false;
    for (const match of source.matchAll(pattern)) {
      const text = match[0];
      if (/^\s/u.test(text)) {
        spaced = true;
        continue;
      }
      tokens.push(
        Object.freeze({
          text,
          range: Object.freeze({ start: match.index, end: match.index + text.length }),
          spaced
        })
      );
      spaced = false;
    }
    tokens.push(
      Object.freeze({
        text: "",
        range: Object.freeze({ start: source.length, end: source.length }),
        spaced
      })
    );
    this.#tokens = tokens;
  }
  parse(): ParsedUnitExpression {
    if (!this.#peek().text)
      this.#error("EmptyExpression", this.#peek(), "Unit expression is empty");
    const result = this.#expression();
    if (this.#peek().text === ")")
      this.#error("ExtraParenthesis", this.#peek(), "Extra closing parenthesis");
    if (this.#peek().text) this.#error("UnexpectedToken", this.#peek(), "Unexpected token");
    return Object.freeze({ source: this.#source, syntax: result.syntax, value: result.value });
  }
  #expression(): Node {
    let left = this.#factor();
    while (this.#peek().text && this.#peek().text !== ")") {
      const operator = this.#peek();
      const explicit = ["*", "×", "·", "/", "÷"].includes(operator.text);
      const quotient = operator.text === "/" || operator.text === "÷";
      if (explicit) this.#position++;
      else if (!operator.spaced || operator.text === "^")
        this.#error("UnexpectedToken", operator, "Whitespace is required between factors");
      const right = this.#factor();
      if (left.value.kind === "affine" || right.value.kind === "affine")
        this.#error(
          quotient ? "AffineInQuotient" : "AffineInProduct",
          operator,
          "Affine units must be standalone"
        );
      const kind = quotient ? "quotient" : "product";
      left = {
        syntax: Object.freeze({
          kind,
          left: left.syntax,
          right: right.syntax,
          range: span(left.syntax.range, right.syntax.range)
        }),
        value: Object.freeze({
          kind: "linear",
          dimensions: quotient
            ? divideDimensions(left.value.dimensions, right.value.dimensions)
            : multiplyDimensions(left.value.dimensions, right.value.dimensions),
          scale: quotient
            ? divideScales(left.value.scale, right.value.scale)
            : multiplyScales(left.value.scale, right.value.scale),
          standaloneUnitId: null
        })
      };
    }
    return left;
  }
  #factor(): Node {
    const base = this.#atom();
    if (this.#peek().text !== "^") return base;
    const operator = this.#peek();
    this.#position++;
    const token = this.#peek();
    if (!token.text || [")", "*", "×", "·", "/", "÷"].includes(token.text))
      this.#error("MissingExponent", token, "Integer exponent is missing");
    if (!/^[+-]?\d+$/u.test(token.text))
      this.#error("InvalidExponent", token, "Exponent must be a signed decimal integer");
    this.#position++;
    if (this.#peek().text === "^")
      this.#error("InvalidExponent", this.#peek(), "Only one integer power is allowed per factor");
    if (base.value.kind === "affine")
      this.#error("AffinePower", operator, "Affine units cannot be raised to a power");
    const exponent = BigInt(token.text);
    return {
      syntax: Object.freeze({
        kind: "power",
        base: base.syntax,
        exponent,
        range: span(base.syntax.range, token.range)
      }),
      value: Object.freeze({
        kind: "linear",
        dimensions: powerDimensions(base.value.dimensions, exponent),
        scale: powerScale(base.value.scale, exponent),
        standaloneUnitId: null
      })
    };
  }
  #atom(): Node {
    const token = this.#peek();
    if (token.text === "(") {
      this.#position++;
      if (!this.#peek().text) this.#error("UnclosedParenthesis", token, "Unclosed parenthesis");
      const expression = this.#expression();
      const closing = this.#peek();
      if (closing.text !== ")") this.#error("UnclosedParenthesis", token, "Unclosed parenthesis");
      this.#position++;
      return {
        syntax: Object.freeze({
          kind: "group",
          expression: expression.syntax,
          range: span(token.range, closing.range)
        }),
        value: expression.value
      };
    }
    if (token.text === ")")
      this.#error("ExtraParenthesis", token, "Unexpected closing parenthesis");
    if (
      !token.text ||
      /^[*×·/÷^+]/u.test(token.text) ||
      (token.text !== "1" && /^[\d-]/u.test(token.text))
    )
      this.#error("UnexpectedToken", token, "Expected a unit or grouped expression");
    this.#position++;
    const unit = this.#registry.resolve(token.text, token.range);
    const definition = unit.definition;
    return {
      syntax: Object.freeze({
        kind: "atom",
        unitId: definition.id,
        prefixId: unit.prefix?.id ?? null,
        range: token.range
      }),
      value:
        definition.kind === "affine"
          ? Object.freeze({
              kind: "affine",
              dimensions: definition.dimensions,
              transform: definition.transform,
              standaloneUnitId: definition.id
            })
          : Object.freeze({
              kind: "linear",
              dimensions: definition.dimensions,
              scale: unit.scale,
              standaloneUnitId: unit.prefix === null ? definition.id : null
            })
    };
  }
  #peek(): Token {
    const token = this.#tokens[this.#position];
    if (!token) throw new Error("Unit parser token invariant");
    return token;
  }
  #error(code: UnitDomainErrorCode, token: Token, message: string): never {
    throw new UnitDomainError(code, token.range, message);
  }
}
function span(left: UnitSourceRange, right: UnitSourceRange): UnitSourceRange {
  return Object.freeze({ start: left.start, end: right.end });
}
