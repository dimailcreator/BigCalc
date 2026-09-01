import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEvaluationGraphFromAst,
  createEvaluationGraphFromSource,
  createRational,
  evaluateExpressionToRealValue,
  parseExpression
} from "../src/core/index.js";
import type { Rational, RealValue } from "../src/core/index.js";

void describe("exact evaluator", () => {
  void it("evaluates rational expressions through source -> AST -> graph -> Rational", () => {
    const parsed = parseExpression("1/3+1/6");
    assert.equal(parsed.ok, true);

    const graph = createEvaluationGraphFromAst(parsed.ast);
    assertRationalEqual(graph.evaluate(), createRational(1n, 2n));

    assert.equal(graph.root.getStateSnapshot().refinementCalls, 0);
  });

  void it("evaluates stage 8 exact examples without creating approximate values", () => {
    assertExpressionRational("50%", createRational(1n, 2n));
    assertExpressionRational("2^10", createRational(1024n));
    assertExpressionRational("(2/3)^5", createRational(32n, 243n));
    assertExpressionRational("5!", createRational(120n));
    assertExpressionRational("abs(-4/7)", createRational(4n, 7n));
  });

  void it("repeats precedence semantics at computed-result level", () => {
    assertExpressionRational("-2^2", createRational(-4n));
    assertExpressionRational("2^2^2", createRational(16n));
    assertExpressionLazy("2^50%");
    assertExpressionErrorCode("5!%", "DomainError");
    assertExpressionRational("2/3(4+5)", createRational(2n, 27n));
    assertExpressionRational("1+2*3", createRational(7n));
    assertExpressionRational("1*2+3", createRational(5n));
    assertExpressionRational("50%%", createRational(1n, 200n));
  });

  void it("uses exact rational root fast paths when real and provable", () => {
    assertExpressionRational("(4/9)^(1/2)", createRational(2n, 3n));
    assertExpressionRational("(-8)^(1/3)", createRational(-2n));
    assertExpressionRational("(32/243)^(1/5)", createRational(2n, 3n));
    assertExpressionRational("(4/9)^(-1/2)", createRational(3n, 2n));
  });

  void it("returns LazyReal for non-exact rational powers instead of fabricating digits", () => {
    const result = evaluateExpressionToRealValue("2^(1/2)");

    assert.equal(result.ok, true);

    assert.equal(result.value.kind, "lazy-real");
  });

  void it("surfaces division by zero and domain errors as typed errors", () => {
    assertExpressionErrorCode("1/0", "DivisionByZeroError");
    assertExpressionErrorCode("0^(-1)", "DivisionByZeroError");
    assertExpressionErrorCode("(-4)^(1/2)", "DomainError");
    assertExpressionErrorCode("(-1)!", "DomainError");
    assertExpressionErrorCode("(1/2)!", "DomainError");
  });

  void it("preserves exact integer factorial path in gamma mode", () => {
    assertExpressionRational("6!", createRational(720n), {
      settings: { factorialMode: "gamma" }
    });
  });

  void it("builds graph directly from source with custom context settings", () => {
    const graphResult = createEvaluationGraphFromSource("2(3+4)!", {
      settings: { factorialMode: "integer" }
    });

    assert.equal(graphResult.ok, true);

    assertRationalEqual(graphResult.graph.evaluate(), createRational(10080n));
    assert.equal(graphResult.context.settings.factorialMode, "integer");
  });
});

function assertExpressionRational(
  source: string,
  expected: Rational,
  options?: Parameters<typeof evaluateExpressionToRealValue>[1]
): void {
  const result = evaluateExpressionToRealValue(source, options);

  assert.equal(result.ok, true);

  assertRationalEqual(result.value, expected);
}

function assertExpressionErrorCode(source: string, code: "DivisionByZeroError" | "DomainError") {
  const result = evaluateExpressionToRealValue(source, {
    settings: { factorialMode: "integer" }
  });

  assert.equal(result.ok, false);

  assert.equal(result.error.code, code);
}

function assertRationalEqual(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");

  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}

function assertExpressionLazy(source: string): void {
  const result = evaluateExpressionToRealValue(source);

  assert.equal(result.ok, true);

  assert.equal(result.value.kind, "lazy-real");
}
