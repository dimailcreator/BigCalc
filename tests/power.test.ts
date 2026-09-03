import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createInternalInterval,
  createLazyRealNode,
  createPowNode,
  createRational,
  createRationalNode,
  evaluateExpressionToRealValue,
  integerRational,
  intervalToBall,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational, RealValue } from "../src/core/index.js";

const SQRT_2_PREFIX = "14142135623730950488016887242096980785696718753769";
const TWO_TO_THREE_HALVES_PREFIX = "28284271247461900976033774484193961571393437507538";
const NEGATIVE_CUBE_ROOT_2_PREFIX = "12599210498948731647672106072782283505702514647015";
const E_SQUARED_PREFIX = "73890560989306502272";

void describe("general power", () => {
  void it("keeps exact rational strategies before lazy approximate paths", () => {
    assertExpressionRational("2^10", createRational(1024n));
    assertExpressionRational("(2/3)^5", createRational(32n, 243n));
    assertExpressionRational("(4/9)^(1/2)", createRational(2n, 3n));
    assertExpressionRational("(4/9)^(-1/2)", createRational(3n, 2n));
    assertExpressionRational("(-8)^(1/3)", createRational(-2n));
  });

  void it("handles zero-base cases without hidden special values", () => {
    assertExpressionRational("0^0", integerRational(1n));
    assertExpressionRational("0^(1/2)", integerRational(0n));
    assertExpressionErrorCode("0^(-1)", "DivisionByZeroError");
  });

  void it("produces verified digits for positive real powers", async () => {
    await assertVerifiedPrefix("2^(1/2)", SQRT_2_PREFIX, 50, 0n);
    await assertVerifiedPrefix("2^(3/2)", TWO_TO_THREE_HALVES_PREFIX, 50, 0n);
    await assertVerifiedPrefix("e^2", E_SQUARED_PREFIX, 20, 0n);
  });

  void it("rejects complex negative-base cases and supports real odd-denominator cases", async () => {
    assertExpressionErrorCode("(-2)^(1/2)", "DomainError");
    await assertVerifiedPrefix("(-2)^(1/3)", NEGATIVE_CUBE_ROOT_2_PREFIX, 50, 0n, -1);
  });

  void it("refines base domain near zero before positive-real power evaluation", async () => {
    const base = new ErrorControlledRationalLazyReal(createRational(5n, 10n ** 13n), 0);
    const graph = createEvaluationGraph(
      createPowNode(createLazyRealNode(base), createRationalNode(createRational(1n, 2n))),
      createEvaluationContext()
    );

    const ball = await graph.refine({ significantDigits: 10 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 10 }, graph.context.backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.verifiedDigits >= 10, true);
    assert.equal(Math.max(...base.requestedDigits) > 12, true);
  });
});

async function assertVerifiedPrefix(
  source: string,
  prefix: string,
  significantDigits: number,
  exponent10: bigint,
  sign: -1 | 1 = 1
): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);

  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.sign, sign);
  assert.equal(verified.exponent10, exponent10);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  assert.equal(verified.digits.startsWith(prefix.slice(0, significantDigits)), true);
}

function assertExpressionRational(source: string, expected: Rational): void {
  const result = evaluateExpressionToRealValue(source);
  assert.equal(result.ok, true);
  assertRationalEqual(result.value, expected);
}

function assertExpressionErrorCode(
  source: string,
  code: "DivisionByZeroError" | "DomainError"
): void {
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
