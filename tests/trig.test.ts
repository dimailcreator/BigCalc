import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createInternalInterval,
  createLazyRealNode,
  createFunctionNode,
  createRational,
  evaluateExpressionToRealValue,
  integerRational,
  intervalToBall,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational, RealValue } from "../src/core/index.js";

const SIN_1_PREFIX = "84147098480789650665250232163029899962256306079837";
const COS_1_PREFIX = "54030230586813971740093660744297660373231042061792";
const TAN_1_PREFIX = "15574077246549022305069748074583601730872507723815";

void describe("sin, cos, tan, and angle modes", () => {
  void it("preserves exact local fast paths for radian zero and degree quadrants", () => {
    assertExpressionRational("sin(0)", integerRational(0n));
    assertExpressionRational("cos(0)", integerRational(1n));
    assertExpressionRational("tan(0)", integerRational(0n));

    assertExpressionRational("sin(180)", integerRational(0n), "degrees");
    assertExpressionRational("sin(450)", integerRational(1n), "degrees");
    assertExpressionRational("cos(180)", integerRational(-1n), "degrees");
    assertExpressionRational("cos(270)", integerRational(0n), "degrees");
    assertExpressionRational("tan(180)", integerRational(0n), "degrees");
    assertExpressionErrorCode("tan(90)", "DomainError", "degrees");
  });

  void it("produces verified digits for radian trig functions", async () => {
    await assertVerifiedPrefix("sin(1)", SIN_1_PREFIX, 50, -1n);
    await assertVerifiedPrefix("cos(1)", COS_1_PREFIX, 50, -1n);
    await assertVerifiedPrefix("tan(1)", TAN_1_PREFIX, 50, 0n);
  });

  void it("distinguishes radian and degree modes", async () => {
    await assertVerifiedPrefix("sin(30)", "5", 1, -1n, "degrees");

    const radians = createEvaluationGraphFromSource("sin(30)");
    assert.equal(radians.ok, true);
    const ball = await radians.graph.refine({ significantDigits: 8 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 8 },
      radians.context.backend
    );

    assert.notEqual(verified.digits.startsWith("5"), true);
  });

  void it("supports trig iterations", async () => {
    assertExpressionRational("sin[0](2)", integerRational(2n));
    await assertVerified("cos[2](0)", 20);
    await assertVerified("sin[2](1)", 20);
  });

  void it("reduces large radian arguments before interval evaluation", async () => {
    await assertVerifiedPrefix("sin(1000000)", "3499935021", 10, -1n, "radians", -1);
  });

  void it("refines uncertain tan pole neighborhoods instead of emitting premature domain errors", async () => {
    const argument = new ErrorControlledRationalLazyReal(
      addRational(integerRational(90n), createRational(1n, 10n ** 8n)),
      0
    );
    const graph = createEvaluationGraph(
      createFunctionNode("tan", [createLazyRealNode(argument)]),
      createEvaluationContext({ settings: { angleMode: "degrees" } })
    );

    const ball = await graph.refine({ significantDigits: 8 });
    const verified = verifiedNumberFromBall(ball, { significantDigits: 8 }, graph.context.backend);

    assert.equal(verified.sign, -1);
    assert.equal(verified.verifiedDigits >= 8, true);
    assert.equal(Math.max(...argument.requestedDigits) > 10, true);
  });
});

async function assertVerifiedPrefix(
  source: string,
  prefix: string,
  significantDigits: number,
  exponent10: bigint,
  angleMode: "radians" | "degrees" = "radians",
  sign: -1 | 1 = 1
): Promise<void> {
  const result = createEvaluationGraphFromSource(source, { settings: { angleMode } });
  assert.equal(result.ok, true);

  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.sign, sign);
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

function assertExpressionRational(
  source: string,
  expected: Rational,
  angleMode: "radians" | "degrees" = "radians"
): void {
  const result = evaluateExpressionToRealValue(source, { settings: { angleMode } });
  assert.equal(result.ok, true);
  assertRationalEqual(result.value, expected);
}

function assertExpressionErrorCode(
  source: string,
  code: "DomainError",
  angleMode: "radians" | "degrees" = "radians"
): void {
  const result = evaluateExpressionToRealValue(source, { settings: { angleMode } });

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
