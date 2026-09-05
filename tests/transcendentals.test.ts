import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createInternalInterval,
  createFunctionNode,
  createLazyRealNode,
  createRational,
  evaluateExpressionToRealValue,
  integerRational,
  intervalToBall,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational, RealValue } from "../src/core/index.js";

const E_PREFIX =
  "271828182845904523536028747135266249775724709369995957496696762772407663035354759";
const LN2_PREFIX =
  "69314718055994530941723212145817656807550013436025525412068000949339362196969471";
const LOG10_2_PREFIX = "30102999566398119521373889472449302676818988146210854131042746";

void describe("exp, ln, and log", () => {
  void it("preserves exact local fast paths for exp, ln, and log", () => {
    assertExpressionRational("exp(0)", integerRational(1n));
    assertExpressionRational("ln(1)", integerRational(0n));
    assertExpressionRational("log(100)", integerRational(2n));
    assertExpressionRational("log10(100)", integerRational(2n));
    assertExpressionRational("log2(8)", integerRational(3n));
    assertExpressionRational("log{2+3}(125)", integerRational(3n));
    assertExpressionRational("log2(1/8)", integerRational(-3n));
    assertExpressionRational("log4(2)", createRational(1n, 2n));
    assertExpressionRational("log8(4)", createRational(2n, 3n));
  });

  void it("produces verified digits for exp, ln, and default log", async () => {
    await assertVerifiedPrefix("exp(1)", E_PREFIX, 80, 0n);
    await assertVerifiedPrefix("ln(2)", LN2_PREFIX, 80, -1n);
    await assertVerifiedPrefix("log(2)", LOG10_2_PREFIX, 60, -1n);
  });

  void it("keeps verified prefixes monotonic across continued refinement", async () => {
    const result = createEvaluationGraphFromSource("ln(2)");
    assert.equal(result.ok, true);

    let previousDigits = "";

    for (const significantDigits of [20, 50, 100]) {
      const ball = await result.graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(previousDigits), true);
      previousDigits = verified.digits;
    }

    assert.equal(result.graph.root.getStateSnapshot().refinementCalls, 3);
  });

  void it("supports implemented function and log iterations", async () => {
    assertExpressionRational("exp[0](2)", integerRational(2n));
    await assertVerifiedPrefix("exp[2](0)", E_PREFIX, 60, 0n);
    assertExpressionRational("log{10}[0](2)", integerRational(2n));
    assertExpressionRational("log{10}[2](10000000000)", integerRational(1n));
  });

  void it("refines uncertain positive domains before evaluating ln", async () => {
    const argument = new ErrorControlledRationalLazyReal(createRational(1n, 10n ** 30n));
    const graph = createEvaluationGraph(
      createFunctionNode("ln", [createLazyRealNode(argument)]),
      createEvaluationContext()
    );
    const ball = await graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 20 }, graph.context.backend);

    assert.equal(verified.sign, -1);
    assert.equal(verified.verifiedDigits >= 20, true);
    assert.equal(Math.max(...argument.requestedDigits) > 22, true);
  });

  void it("rejects proven domain errors without hiding them as internal failures", async () => {
    assertExpressionErrorCode("ln(0)", "DomainError");
    assertExpressionErrorCode("ln(-1)", "DomainError");
    assertExpressionErrorCode("log{1}(10)", "DomainError");
    assertExpressionErrorCode("log{-2}(10)", "DomainError");

    const zeroLog = createEvaluationGraphFromSource("log(0)");
    assert.equal(zeroLog.ok, true);
    await assert.rejects(() => zeroLog.graph.refine({ significantDigits: 20 }), {
      code: "DomainError"
    });
  });

  void it("handles expression bases, bases near one, and nested functions", async () => {
    await assertVerified("log{1+1/1000000}(2)", 20);
    await assertVerified("ln(exp(1))", 20);
    await assertVerified("exp(ln(2))", 20);
  });
});

async function assertVerifiedPrefix(
  source: string,
  prefix: string,
  significantDigits: number,
  exponent10: bigint
): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);

  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.exponent10, exponent10);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  assert.equal(verified.digits.startsWith(prefix.slice(0, significantDigits)), true);
}

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

function assertExpressionErrorCode(source: string, code: "DomainError"): void {
  const result = evaluateExpressionToRealValue(source);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}

function assertRationalEqual(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
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
