import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createCoreRegistry,
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createFunctionNode,
  createInternalInterval,
  createLazyRealNode,
  createRational,
  evaluateExpressionToRealValue,
  integerRational,
  intervalToBall,
  parseExpression,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational, RealValue } from "../src/core/index.js";

const REQUIRED_FUNCTIONS = ["abs", "sin", "cos", "tan", "exp", "log", "ln"] as const;

void describe("built-in completion", () => {
  void it("exposes complete registry metadata for first-core built-ins", () => {
    const registry = createCoreRegistry();

    for (const name of REQUIRED_FUNCTIONS) {
      const definition = registry.getFunction(name);
      assert.ok(definition !== null);
      assert.equal(definition.supportsIteration, true);
      assert.deepEqual(
        definition.arity,
        name === "log" ? { kind: "range", min: 1, max: 2 } : { kind: "fixed", count: 1 }
      );
      assert.equal(definition.angleSensitive, name === "sin" || name === "cos" || name === "tan");
    }

    assert.equal(registry.getConstant("π")?.kind, "constant");
    assert.equal(registry.getConstant("e")?.kind, "constant");
    assert.equal(registry.getFunction("log2"), null);
  });

  void it("makes every required built-in available end-to-end", async () => {
    assertExpressionRational("ABS(-4/7)", createRational(4n, 7n));
    assertExpressionRational("Sin(0)", integerRational(0n));
    assertExpressionRational("COS(0)", integerRational(1n));
    assertExpressionRational("tan(0)", integerRational(0n));
    assertExpressionRational("exp(0)", integerRational(1n));
    assertExpressionRational("ln(1)", integerRational(0n));
    assertExpressionRational("log2(8)", integerRational(3n));
    assertExpressionRational("log{2+3}(125)", integerRational(3n));

    await assertVerified("abs(sin(1))", 20);
  });

  void it("refines LazyReal abs values without falling back to registry stubs", async () => {
    const operand = new ErrorControlledRationalLazyReal(
      createRational(-12345678912345n, 10n ** 13n)
    );
    const graph = createEvaluationGraph(
      createFunctionNode("abs", [createLazyRealNode(operand)]),
      createEvaluationContext()
    );

    const ball = await graph.refine({ significantDigits: 12 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 12 }, graph.context.backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 0n);
    assert.equal(verified.verifiedDigits >= 12, true);
    assert.equal(verified.digits.startsWith("123456789123"), true);
  });

  void it("keeps parser arity and iteration checks tied to registry metadata", () => {
    assertParseError("abs()");
    assertParseError("cos(1;2)");
    assertParseError("ln[1,5](2)");

    assertExpressionRational("abs[0](-3)", integerRational(-3n));
    assertExpressionRational("abs[2](-3)", integerRational(3n));
  });

  void it("keeps π as the built-in constant token without adding ASCII pi", async () => {
    assert.equal(parseExpression("π").ok, true);
    assert.equal(parseExpression("pi").ok, false);

    await assertVerified("π", 20);
  });
});

async function assertVerified(source: string, significantDigits: number): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);

  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.verifiedDigits >= significantDigits, true);
}

function assertExpressionRational(source: string, expected: Rational): void {
  const result = evaluateExpressionToRealValue(source);

  assert.equal(result.ok, true);
  assertRationalEqual(result.value, expected);
}

function assertRationalEqual(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}

function assertParseError(source: string): void {
  const result = parseExpression(source);
  assert.equal(result.ok, false);
}

class ErrorControlledRationalLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  readonly requestedDigits: number[] = [];

  constructor(
    private readonly value: Rational,
    private readonly uncertaintyPaddingDigits = 5
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
