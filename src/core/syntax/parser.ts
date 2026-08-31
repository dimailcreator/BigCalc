import { syntaxError } from "../errors/index.js";
import type { CalcError } from "../errors/index.js";
import { createCoreRegistry } from "../registry/index.js";
import type { CoreRegistry } from "../registry/index.js";
import type {
  BinaryNode,
  ExpressionNode,
  FunctionCallNode,
  FunctionIterationNode,
  LogNode,
  PostfixNode,
  SourceSpan,
  UnaryNode
} from "./ast.js";
import { freezeExpressionNode } from "./ast.js";
import { tokenizeExpression } from "./tokenizer.js";
import type { NumberToken, Token } from "./tokenizer.js";

export type ParseResult =
  | { readonly ok: true; readonly ast: ExpressionNode }
  | { readonly ok: false; readonly error: CalcError };

export function parseExpression(
  source: string,
  registry: CoreRegistry = createCoreRegistry()
): ParseResult {
  const tokenized = tokenizeExpression(source, registry);

  if (!tokenized.ok) {
    return { ok: false, error: tokenized.error };
  }

  const parser = new Parser(tokenized.tokens, registry);
  return parser.parse();
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly registry: CoreRegistry
  ) {}

  parse(): ParseResult {
    if (this.peek().kind === "end") {
      return {
        ok: false,
        error: syntaxError("Expression cannot be empty", this.spanOf(this.peek()))
      };
    }

    const expression = this.parseAdditive();
    if (!expression.ok) {
      return expression;
    }

    const next = this.peek();
    if (next.kind !== "end") {
      return {
        ok: false,
        error: syntaxError(`Unexpected token: ${this.tokenLabel(next)}`, this.spanOf(next))
      };
    }

    return { ok: true, ast: freezeExpressionNode(expression.node) };
  }

  private parseAdditive(): NodeResult {
    let left = this.parseMultiplicative();
    if (!left.ok) {
      return left;
    }

    for (;;) {
      const token = this.peek();
      if (token.kind !== "operator" || (token.value !== "+" && token.value !== "-")) {
        break;
      }

      this.advance();
      const operator = token.value;
      const right = this.parseMultiplicative();
      if (!right.ok) {
        return right;
      }

      left = {
        ok: true,
        node: {
          kind: "binary",
          operator,
          left: left.node,
          right: right.node,
          span: mergeSpans(left.node.span, right.node.span)
        }
      };
    }

    return left;
  }

  private parseMultiplicative(): NodeResult {
    let left = this.parseImplicitMultiplication();
    if (!left.ok) {
      return left;
    }

    for (;;) {
      const token = this.peek();
      if (token.kind !== "operator" || (token.value !== "*" && token.value !== "/")) {
        break;
      }

      this.advance();
      const operator = token.value;
      const right = this.parseImplicitMultiplication();
      if (!right.ok) {
        return right;
      }

      left = {
        ok: true,
        node: {
          kind: "binary",
          operator,
          left: left.node,
          right: right.node,
          span: mergeSpans(left.node.span, right.node.span)
        }
      };
    }

    return left;
  }

  private parseImplicitMultiplication(): NodeResult {
    let left = this.parseUnary();
    if (!left.ok) {
      return left;
    }

    while (this.isImplicitMultiplicationStart(this.peek())) {
      const right = this.parseUnary();
      if (!right.ok) {
        return right;
      }

      left = {
        ok: true,
        node: {
          kind: "binary",
          operator: "implicit-multiply",
          left: left.node,
          right: right.node,
          span: mergeSpans(left.node.span, right.node.span)
        }
      };
    }

    return left;
  }

  private parseUnary(): NodeResult {
    const token = this.peek();
    if (token.kind === "operator" && (token.value === "+" || token.value === "-")) {
      this.advance();
      const operator = token.value;
      const operand = this.parseUnary();

      if (!operand.ok) {
        return operand;
      }

      const node: UnaryNode = {
        kind: "unary",
        operator,
        operand: operand.node,
        span: {
          start: token.start,
          end: operand.node.span.end
        }
      };

      return { ok: true, node };
    }

    return this.parsePower();
  }

  private parsePower(): NodeResult {
    const left = this.parsePostfixChain();
    if (!left.ok) {
      return left;
    }

    if (!this.matchOperator("^")) {
      return left;
    }

    const right = this.parseUnary();
    if (!right.ok) {
      return right;
    }

    const node: BinaryNode = {
      kind: "binary",
      operator: "^",
      left: left.node,
      right: right.node,
      span: mergeSpans(left.node.span, right.node.span)
    };

    return { ok: true, node };
  }

  private parsePostfixChain(): NodeResult {
    const operand = this.parsePrimary();
    if (!operand.ok) {
      return operand;
    }

    const operators: OperatorTokenValue[] = [];
    const operatorSpans: SourceSpan[] = [];

    for (;;) {
      const token = this.peek();
      if (token.kind !== "operator" || (token.value !== "%" && token.value !== "!")) {
        break;
      }

      this.advance();
      operators.push(token.value);
      operatorSpans.push(this.spanOf(token));
    }

    let node = operand.node;

    for (const entry of orderedPostfixOperators(operators, operatorSpans)) {
      const postfixNode: PostfixNode = {
        kind: "postfix",
        operator: entry.operator,
        operand: node,
        span: mergeSpans(node.span, entry.span)
      };
      node = postfixNode;
    }

    return { ok: true, node };
  }

  private parsePrimary(): NodeResult {
    const token = this.peek();

    if (token.kind === "number") {
      this.advance();
      return {
        ok: true,
        node: {
          kind: "number-literal",
          raw: token.raw,
          value: token.value,
          span: this.spanOf(token)
        }
      };
    }

    if (this.matchDelimiter("(")) {
      const start = this.previous().start;
      const inner = this.parseAdditive();
      if (!inner.ok) {
        return inner;
      }

      const close = this.consumeDelimiter(")", "Expected ')' to close grouped expression");
      if (!close.ok) {
        return close;
      }

      return {
        ok: true,
        node: freezeExpressionNode(withSpan(inner.node, { start, end: close.token.end }))
      };
    }

    if (token.kind === "registered-name") {
      this.advance();

      if (token.nameKind === "constant") {
        return {
          ok: true,
          node: {
            kind: "constant",
            name: token.canonicalName,
            span: this.spanOf(token)
          }
        };
      }

      if (token.canonicalName === "log") {
        return this.parseLog(token);
      }

      return this.parseFunctionCallOrIteration(token);
    }

    return {
      ok: false,
      error: syntaxError(`Expected expression, got ${this.tokenLabel(token)}`, this.spanOf(token))
    };
  }

  private parseFunctionCallOrIteration(functionToken: RegisteredNameParserToken): NodeResult {
    const iteration = this.tryParseIteration();
    if (!iteration.ok) {
      return iteration;
    }

    const args = this.parseArgumentList();
    if (!args.ok) {
      return args;
    }

    const arityError = this.validateFunctionArity(
      functionToken.canonicalName,
      args.args,
      args.span
    );
    if (arityError !== null) {
      return arityError;
    }

    const span = {
      start: functionToken.start,
      end: args.close.end
    };

    if (iteration.value === null) {
      const node: FunctionCallNode = {
        kind: "function-call",
        functionName: functionToken.canonicalName,
        args: args.args,
        span
      };
      return { ok: true, node };
    }

    const iterationSupportError = this.validateFunctionIterationSupport(
      functionToken.canonicalName,
      span
    );
    if (iterationSupportError !== null) {
      return iterationSupportError;
    }

    const node: FunctionIterationNode = {
      kind: "function-iteration",
      functionName: functionToken.canonicalName,
      iteration: iteration.value,
      args: args.args,
      span
    };

    return { ok: true, node };
  }

  private parseLog(logToken: RegisteredNameParserToken): NodeResult {
    let base: ExpressionNode | null = null;

    if (this.peek().kind === "number") {
      const number = this.advance() as NumberToken;
      base = {
        kind: "number-literal",
        raw: number.raw,
        value: number.value,
        span: this.spanOf(number)
      };
    } else if (this.matchDelimiter("{")) {
      const baseStart = this.previous().start;
      const baseExpression = this.parseAdditive();
      if (!baseExpression.ok) {
        return baseExpression;
      }

      const closeBase = this.consumeDelimiter("}", "Expected '}' to close log base");
      if (!closeBase.ok) {
        return closeBase;
      }

      base = freezeExpressionNode(
        withSpan(baseExpression.node, { start: baseStart, end: closeBase.token.end })
      );
    }

    const iteration = this.tryParseIteration();
    if (!iteration.ok) {
      return iteration;
    }

    const args = this.parseArgumentList();
    if (!args.ok) {
      return args;
    }

    if (args.args.length !== 1) {
      return {
        ok: false,
        error: syntaxError("log expects exactly one argument expression", args.span)
      };
    }

    const argument = args.args[0];

    if (argument === undefined) {
      return {
        ok: false,
        error: syntaxError("log expects an argument expression", args.span)
      };
    }

    const node: LogNode = {
      kind: "log",
      base,
      iteration: iteration.value,
      argument,
      span: {
        start: logToken.start,
        end: args.close.end
      }
    };

    return { ok: true, node };
  }

  private tryParseIteration(): IterationResult {
    if (!this.matchDelimiter("[")) {
      return { ok: true, value: null };
    }

    const token = this.peek();

    if (token.kind !== "number" || !token.integerLiteral) {
      return {
        ok: false,
        error: syntaxError(
          "Function iteration must be a non-negative integer literal",
          this.spanOf(token)
        )
      };
    }

    this.advance();
    const close = this.consumeDelimiter("]", "Expected ']' to close function iteration");
    if (!close.ok) {
      return close;
    }

    return {
      ok: true,
      value: token.value.numerator
    };
  }

  private parseArgumentList(): ArgumentListResult {
    const open = this.consumeDelimiter("(", "Expected '(' before function arguments");
    if (!open.ok) {
      return open;
    }

    const args: ExpressionNode[] = [];

    if (this.matchDelimiter(")")) {
      return {
        ok: true,
        args,
        close: this.previous(),
        span: { start: open.token.start, end: this.previous().end }
      };
    }

    for (;;) {
      const argument = this.parseAdditive();
      if (!argument.ok) {
        return argument;
      }

      args.push(argument.node);

      if (this.matchDelimiter(")")) {
        return {
          ok: true,
          args: Object.freeze(args),
          close: this.previous(),
          span: { start: open.token.start, end: this.previous().end }
        };
      }

      if (!this.matchDelimiter(";")) {
        return {
          ok: false,
          error: syntaxError("Expected ';' or ')' in function arguments", this.spanOf(this.peek()))
        };
      }

      const next = this.peek();
      if (next.kind === "delimiter" && next.value === ")") {
        return {
          ok: false,
          error: syntaxError("Function argument cannot be empty", this.spanOf(next))
        };
      }
    }
  }

  private isImplicitMultiplicationStart(token: Token): boolean {
    if (token.kind === "number" || token.kind === "registered-name") {
      return true;
    }

    return token.kind === "delimiter" && token.value === "(";
  }

  private validateFunctionArity(
    functionName: string,
    args: readonly ExpressionNode[],
    span: SourceSpan
  ): NodeResult | null {
    const definition = this.registry.getFunction(functionName);
    if (definition === null) {
      return {
        ok: false,
        error: syntaxError(`Unknown function definition: ${functionName}`, span)
      };
    }

    if (definition.arity.kind === "fixed" && args.length !== definition.arity.count) {
      return {
        ok: false,
        error: syntaxError(
          `${functionName} expects ${String(definition.arity.count)} argument(s)`,
          span
        )
      };
    }

    if (
      definition.arity.kind === "range" &&
      (args.length < definition.arity.min || args.length > definition.arity.max)
    ) {
      return {
        ok: false,
        error: syntaxError(
          `${functionName} expects ${String(definition.arity.min)}-${String(
            definition.arity.max
          )} argument(s)`,
          span
        )
      };
    }

    return null;
  }

  private validateFunctionIterationSupport(
    functionName: string,
    span: SourceSpan
  ): NodeResult | null {
    const definition = this.registry.getFunction(functionName);
    if (definition === null) {
      return {
        ok: false,
        error: syntaxError(`Unknown function definition: ${functionName}`, span)
      };
    }

    if (!definition.supportsIteration) {
      return {
        ok: false,
        error: syntaxError(`${functionName} does not support function iteration`, span)
      };
    }

    return null;
  }

  private matchOperator(operator: OperatorTokenValue): boolean {
    const token = this.peek();
    if (token.kind === "operator" && token.value === operator) {
      this.advance();
      return true;
    }

    return false;
  }

  private matchDelimiter(delimiter: DelimiterValue): boolean {
    const token = this.peek();
    if (token.kind === "delimiter" && token.value === delimiter) {
      this.advance();
      return true;
    }

    return false;
  }

  private consumeDelimiter(delimiter: DelimiterValue, message: string): TokenResult {
    if (this.matchDelimiter(delimiter)) {
      return { ok: true, token: this.previous() };
    }

    return { ok: false, error: syntaxError(message, this.spanOf(this.peek())) };
  }

  private peek(): Token {
    const token = this.tokens[this.index];
    if (token !== undefined) {
      return token;
    }

    const end = this.tokens[this.tokens.length - 1];
    if (end !== undefined) {
      return end;
    }

    return { kind: "end", start: 0, end: 0 };
  }

  private previous(): Token {
    return this.tokens[this.index - 1] ?? this.peek();
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "end") {
      this.index += 1;
    }

    return token;
  }

  private spanOf(token: Token): SourceSpan {
    return { start: token.start, end: token.end };
  }

  private tokenLabel(token: Token): string {
    switch (token.kind) {
      case "number":
        return token.raw;
      case "registered-name":
        return token.sourceName;
      case "operator":
      case "delimiter":
        return token.value;
      case "end":
        return "end of input";
    }
  }
}

type NodeResult =
  | { readonly ok: true; readonly node: ExpressionNode }
  | { readonly ok: false; readonly error: CalcError };

type IterationResult =
  | { readonly ok: true; readonly value: bigint | null }
  | { readonly ok: false; readonly error: CalcError };

type TokenResult =
  { readonly ok: true; readonly token: Token } | { readonly ok: false; readonly error: CalcError };

type ArgumentListResult =
  | {
      readonly ok: true;
      readonly args: readonly ExpressionNode[];
      readonly close: Token;
      readonly span: SourceSpan;
    }
  | { readonly ok: false; readonly error: CalcError };

type OperatorTokenValue = "%" | "!" | "+" | "-" | "*" | "/" | "^";
type DelimiterValue = "(" | ")" | "{" | "}" | "[" | "]" | ";";
type RegisteredNameParserToken = Extract<Token, { readonly kind: "registered-name" }>;

function orderedPostfixOperators(
  operators: readonly OperatorTokenValue[],
  spans: readonly SourceSpan[]
): readonly { readonly operator: "%" | "!"; readonly span: SourceSpan }[] {
  const entries = operators.map((operator, index) => {
    const span = spans[index];
    if (span === undefined || (operator !== "%" && operator !== "!")) {
      throw new Error("Invalid postfix operator state");
    }

    return { operator, span };
  });

  return [
    ...entries.filter((entry) => entry.operator === "%"),
    ...entries.filter((entry) => entry.operator === "!")
  ];
}

function mergeSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return {
    start: left.start < right.start ? left.start : right.start,
    end: left.end > right.end ? left.end : right.end
  };
}

function withSpan(node: ExpressionNode, span: SourceSpan): ExpressionNode {
  switch (node.kind) {
    case "number-literal":
    case "constant":
    case "unary":
    case "binary":
    case "postfix":
    case "function-call":
    case "function-iteration":
    case "log":
      return { ...node, span };
  }
}

export function astToDebugString(node: ExpressionNode): string {
  switch (node.kind) {
    case "number-literal":
      return node.raw;
    case "constant":
      return node.name;
    case "unary":
      return `(${node.operator}${astToDebugString(node.operand)})`;
    case "binary":
      return `(${astToDebugString(node.left)} ${node.operator} ${astToDebugString(node.right)})`;
    case "postfix":
      return `(${astToDebugString(node.operand)}${node.operator})`;
    case "function-call":
      return `${node.functionName}(${node.args.map(astToDebugString).join(";")})`;
    case "function-iteration":
      return `${node.functionName}[${String(node.iteration)}](${node.args
        .map(astToDebugString)
        .join(";")})`;
    case "log": {
      const base = node.base === null ? "" : `{${astToDebugString(node.base)}}`;
      const iteration = node.iteration === null ? "" : `[${String(node.iteration)}]`;
      return `log${base}${iteration}(${astToDebugString(node.argument)})`;
    }
  }
}
