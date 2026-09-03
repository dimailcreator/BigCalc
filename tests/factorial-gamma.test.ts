import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createFactorialNode,
  createInternalInterval,
  createLazyRealNode,
  createRational,
  evaluateExpressionToRealValue,
  integerRational,
  intervalToBall,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational, RealValue } from "../src/core/index.js";

const HALF_FACTORIAL_PREFIX = "88622692545275801364908374167057259139877472806119";
const THIRD_FACTORIAL_PREFIX = "8929795115";

void describe("factorial and Gamma mode", () => {
  void it("keeps integer factorial exact for small and large non-negative integers", () => {
    assertExpressionRational("0!", integerRational(1n));
    assertExpressionRational("1!", integerRational(1n));
    assertExpressionRational("5!", integerRational(120n));
    assertExpressionRational("30!", integerRational(265252859812191058636308480000000n));
  });

  void it("rejects negative and non-integer operands in integer mode", () => {
    assertExpressionErrorCode("(-1)!", "DomainError", "integer");
    assertExpressionErrorCode("(1/2)!", "DomainError", "integer");
  });

  void it("preserves exact integer path in Gamma mode", () => {
    assertExpressionRational("6!", integerRational(720n), "gamma");
  });

  void it("evaluates non-integer factorial through real Gamma in Gamma mode", async () => {
    const result = createEvaluationGraphFromGammaSource("(1/2)!");
    assert.equal(result.graph.evaluate().kind, "lazy-real");

    const ball = await result.graph.refine({ significantDigits: 50 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 50 },
      result.context.backend
    );

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, -1n);
    assert.equal(verified.verifiedDigits >= 50, true);
    assert.equal(verified.digits.startsWith(HALF_FACTORIAL_PREFIX.slice(0, 50)), true);
  });

  void it("evaluates general non-half-integer Gamma values with verified bounds", async () => {
    const result = createEvaluationGraphFromGammaSource("(1/3)!");
    const ball = await result.graph.refine({ significantDigits: 10 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 10 },
      result.context.backend
    );

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, -1n);
    assert.equal(verified.verifiedDigits >= 10, true);
    assert.equal(verified.digits.startsWith(THIRD_FACTORIAL_PREFIX), true);
  });

  void it("rejects Gamma poles as typed domain errors", () => {
    assertExpressionErrorCode("(-1)!", "DomainError", "gamma");
    assertExpressionErrorCode("(-2)!", "DomainError", "gamma");
  });

  void it("refines near Gamma poles before evaluating", async () => {
    const operand = new ErrorControlledRationalLazyReal(createRational(-1n, 2n), -7);
    const context = createEvaluationContext({ settings: { factorialMode: "gamma" } });
    const graph = createEvaluationGraph(createFactorialNode(createLazyRealNode(operand)), context);

    const ball = await graph.refine({ significantDigits: 5 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 5 }, graph.context.backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.verifiedDigits >= 5, true);
    assert.equal(Math.max(...operand.requestedDigits) > 7, true);
  });
});

function assertExpressionRational(
  source: string,
  expected: Rational,
  factorialMode: "integer" | "gamma" = "integer"
): void {
  const result = evaluateExpressionToRealValue(source, { settings: { factorialMode } });

  assert.equal(result.ok, true);
  assertRationalEqual(result.value, expected);
}

function assertExpressionErrorCode(
  source: string,
  code: "DomainError",
  factorialMode: "integer" | "gamma"
): void {
  const result = evaluateExpressionToRealValue(source, { settings: { factorialMode } });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}

function assertRationalEqual(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}

function createEvaluationGraphFromGammaSource(source: string) {
  const result = evaluateGraphFromSource(source);
  assert.equal(result.ok, true);

  return result;
}

function evaluateGraphFromSource(source: string) {
  return createEvaluationGraphFromSource(source, { settings: { factorialMode: "gamma" } });
}

class ErrorControlledRationalLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  readonly requestedDigits: number[] = [];

  constructor(
    private readonly value: Rational,
    private readonly uncertaintyPaddingDigits: number
  ) {}

  refine(
    request: { readonly significantDigits: number },
    context: Parameters<LazyReal["refine"]>[1]
  ) {
    const graphContext = context as EvaluationGraphContext;
    this.requestedDigits.push(request.significantDigits);

    const uncertainty = createRational(
      1n,
      10n ** BigInt(request.significantDigits + this.uncertaintyPaddingDigits)
    );
    const lower = subtractRational(this.value, uncertainty);
    const upper = addRational(this.value, uncertainty);
    const precisionBits = Math.max(128, request.significantDigits * 4);

    return Promise.resolve(
      intervalToBall(
        createInternalInterval(
          graphContext.backend.fromRational(lower, precisionBits, "towardNegativeInfinity"),
          graphContext.backend.fromRational(upper, precisionBits, "towardPositiveInfinity"),
          graphContext.backend
        ),
        precisionBits,
        graphContext.backend
      )
    );
  }
}
