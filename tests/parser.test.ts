import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  astToDebugString,
  compareRational,
  createRegistry,
  integerRational,
  parseExpression
} from "../src/core/index.js";
import type {
  ConstantDefinition,
  ExpressionNode,
  FunctionDefinition,
  RealValue
} from "../src/core/index.js";

function testFunction(name: string, supportsIteration = true): FunctionDefinition {
  return {
    kind: "function",
    name,
    arity: { kind: "range", min: 1, max: 3 },
    supportsIteration,
    angleSensitive: false,
    evaluate(): RealValue {
      return integerRational(0n);
    }
  };
}

function testConstant(name: string): ConstantDefinition {
  return {
    kind: "constant",
    name,
    createValue(): RealValue {
      return integerRational(0n);
    }
  };
}

function parseOk(source: string): ExpressionNode {
  const registry = createRegistry({
    functions: [testFunction("f"), testFunction("sinh")],
    constants: [testConstant("x"), testConstant("h")]
  });
  const result = parseExpression(source, registry);

  if (!result.ok) {
    assert.fail(`${result.error.code}: ${result.error.message}`);
  }

  return result.ast;
}

function parseErrorCode(source: string): string {
  const result = parseExpression(source);

  if (result.ok) {
    assert.fail(`Expected parser error for ${source}`);
  }

  return result.error.code;
}

function parseDebug(source: string): string {
  return astToDebugString(parseOk(source));
}

function expectKind<K extends ExpressionNode["kind"]>(
  node: ExpressionNode,
  kind: K
): Extract<ExpressionNode, { readonly kind: K }> {
  if (node.kind !== kind) {
    assert.fail(`Expected ${kind}, got ${node.kind}`);
  }

  return node as Extract<ExpressionNode, { readonly kind: K }>;
}

void describe("parser literals", () => {
  void it("parses integer and decimal literals as exact Rational values", () => {
    const integer = parseOk("42");
    const integerLiteral = expectKind(integer, "number-literal");
    assert.equal(integerLiteral.value.numerator, 42n);
    assert.equal(integerLiteral.value.denominator, 1n);

    const decimal = parseOk("1,25");
    const decimalLiteral = expectKind(decimal, "number-literal");
    assert.equal(decimalLiteral.raw, "1,25");
    assert.equal(decimalLiteral.value.numerator, 5n);
    assert.equal(decimalLiteral.value.denominator, 4n);
  });

  void it("keeps AST nodes immutable", () => {
    const ast = parseOk("2(3+4)");

    assert.equal(Object.isFrozen(ast), true);
    if (ast.kind === "binary") {
      assert.equal(Object.isFrozen(ast.left), true);
      assert.equal(Object.isFrozen(ast.right), true);
    }
  });
});

void describe("parser precedence and associativity", () => {
  const cases: readonly [source: string, expected: string][] = [
    ["-2^2", "(-(2 ^ 2))"],
    ["2^2^2", "(2 ^ (2 ^ 2))"],
    ["2^50%", "(2 ^ (50%))"],
    ["5!%", "((5%)!)"],
    ["2/3π", "(2 / (3 implicit-multiply π))"],
    ["50%%", "((50%)%)"],
    ["2π", "(2 implicit-multiply π)"],
    ["2(3+4)", "(2 implicit-multiply (3 + 4))"],
    ["(2+3)(4+5)", "((2 + 3) implicit-multiply (4 + 5))"],
    ["2sin(3)", "(2 implicit-multiply sin(3))"],
    ["πe", "(π implicit-multiply e)"],
    ["πsin(2)", "(π implicit-multiply sin(2))"],
    ["ecos(1)", "(e implicit-multiply cos(1))"],
    ["1+2*3", "(1 + (2 * 3))"],
    ["1*2+3", "((1 * 2) + 3)"],
    ["2^(-3)", "(2 ^ (-3))"]
  ];

  for (const [source, expected] of cases) {
    void it(`parses ${source}`, () => {
      assert.equal(parseDebug(source), expected);
    });
  }
});

void describe("parser functions and logarithms", () => {
  void it("parses normal function calls and semicolon-separated arguments", () => {
    assert.equal(parseDebug("f(1,25;2,5)"), "f(1,25;2,5)");
    assert.equal(parseDebug("SIN(1)"), "sin(1)");
    assert.equal(parseDebug("sinh(1)"), "sinh(1)");
  });

  void it("parses function iterations including zero", () => {
    const ast = parseOk("sin[0](x)");

    const iteration = expectKind(ast, "function-iteration");
    assert.equal(iteration.functionName, "sin");
    assert.equal(iteration.iteration, 0n);
    assert.equal(iteration.args.length, 1);
    assert.equal(parseDebug("sin[2](x)"), "sin[2](x)");
  });

  void it("parses log default, numeric, expression, and iterated bases", () => {
    assert.equal(parseDebug("log(x)"), "log(x)");
    assert.equal(parseDebug("ln(x)"), "ln(x)");
    assert.equal(parseDebug("log2(x)"), "log{2}(x)");
    assert.equal(parseDebug("log10(x)"), "log{10}(x)");
    assert.equal(parseDebug("log1,5(x)"), "log{1,5}(x)");
    assert.equal(parseDebug("log{2+3}(x)"), "log{(2 + 3)}(x)");
    assert.equal(parseDebug("log{2+3}[3](x)"), "log{(2 + 3)}[3](x)");
    assert.equal(parseDebug("log{sin(1)+2}(x)"), "log{(sin(1) + 2)}(x)");
  });

  void it("stores compact decimal log base as exact Rational", () => {
    const ast = parseOk("log1,5(x)");

    const log = expectKind(ast, "log");
    assert.notEqual(log.base, null);
    if (log.base === null) {
      assert.fail("Expected compact log base");
    }
    const base = expectKind(log.base, "number-literal");
    assert.equal(compareRational(base.value, integerRational(1n)), 1);
    assert.equal(base.value.numerator, 3n);
    assert.equal(base.value.denominator, 2n);
  });
});

void describe("parser malformed input", () => {
  const syntaxErrors = [
    "",
    "1,",
    ",5",
    "(1+2",
    "sin",
    "sin()",
    "sin(1;)",
    "sin[1,5](2)",
    "sin[-1](2)",
    "sin[2(1)",
    "log{2+}(8)",
    "log(1;2)",
    "1;",
    "2**3"
  ];

  for (const source of syntaxErrors) {
    void it(`rejects ${source.length === 0 ? "<empty>" : source}`, () => {
      assert.equal(parseErrorCode(source), "SyntaxError");
    });
  }

  void it("surfaces unknown and ambiguous identifier errors from registry-aware tokenization", () => {
    assert.equal(parseErrorCode("foo"), "UnknownIdentifierError");

    const registry = createRegistry({
      functions: [testFunction("ab"), testFunction("ba")],
      constants: [testConstant("a")]
    });
    const result = parseExpression("aba", registry);

    if (result.ok) {
      assert.fail("Expected AmbiguousIdentifierError");
    }
    assert.equal(result.error.code, "AmbiguousIdentifierError");
  });

  void it("rejects iteration when the registry definition does not support it", () => {
    const registry = createRegistry({
      functions: [testFunction("plain", false)],
      constants: [testConstant("x")]
    });
    const result = parseExpression("plain[2](x)", registry);

    if (result.ok) {
      assert.fail("Expected unsupported iteration syntax error");
    }

    assert.equal(result.error.code, "SyntaxError");
  });
});
