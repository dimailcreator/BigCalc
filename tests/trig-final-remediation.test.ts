import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCalculationHandleFromSource,
  createEvaluationGraphFromSource,
  evaluateExpressionToRealValue,
  integerRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { Rational, RealValue } from "../src/core/index.js";

void describe("stage 33 trigonometry final remediation", () => {
  void it("does not apply a low add/sub cutoff to degree trigonometry", async () => {
    for (const source of ["sin(1)", "cos(1)", "tan(1)"]) {
      const created = createEvaluationGraphFromSource(source, {
        settings: { angleMode: "degrees", precisionCutoffDigits: 20 }
      });
      assert.equal(created.ok, true);

      const request = { significantDigits: 50 } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);

      assert.equal(verified.verifiedDigits >= request.significantDigits, true, source);
    }
  });

  void it(
    "proves degree trig precision above the production 3000-digit cutoff",
    { timeout: 30_000 },
    async () => {
      const created = createEvaluationGraphFromSource("sin(1)", {
        settings: { angleMode: "degrees" }
      });
      assert.equal(created.ok, true);
      assert.equal(created.context.settings.precisionCutoffDigits, 3000);

      const request = { significantDigits: 3001 } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);

      assert.equal(verified.verifiedDigits >= request.significantDigits, true);
    }
  );

  void it("recognizes sums and differences of rational multiples of pi", () => {
    assertExpressionError("tan(π+π/2)", "DomainError");
    assertExpressionError("tan(2π-π/2)", "DomainError");
    assertExpressionRational("sin(π+π)", integerRational(0n));
    assertExpressionRational("cos(π-2π)", integerRational(-1n));
    assertExpressionError("tan(-π+3π/2)", "DomainError");

    assertExpressionRational("sin(π+(1-1))", integerRational(0n));
    assertExpressionRational("cos((1-1)-π)", integerRational(-1n));
  });

  void it("reports exact composite tangent poles before iterative refinement", async () => {
    const created = createCalculationHandleFromSource("tan(π+π/2)", {
      resourceLimits: { maxCheckpointsPerRun: 8 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 100 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "DomainError");
  });

  void it("preserves the original direct pi fast paths", () => {
    assertExpressionRational("sin(π)", integerRational(0n));
    assertExpressionRational("cos(π)", integerRational(-1n));
    assertExpressionRational("tan(π)", integerRational(0n));
    assertExpressionError("tan(π/2)", "DomainError");
  });

  void it("keeps nonzero near-pole offsets on the adaptive interval path", async () => {
    const created = createEvaluationGraphFromSource("tan(π/2+1/1000000)");
    assert.equal(created.ok, true);

    const request = { significantDigits: 12 } as const;
    const ball = await created.graph.refine(request);
    const verified = verifiedNumberFromBall(ball, request, created.context.backend);

    assert.equal(verified.sign, -1);
    assert.equal(verified.verifiedDigits >= request.significantDigits, true);
    assert.equal(created.graph.root.getStateSnapshot().childRequests.length > 0, true);
  });
});

function assertExpressionRational(source: string, expected: Rational): void {
  const result = evaluateExpressionToRealValue(source);
  assert.equal(result.ok, true);
  assertRationalEqual(result.value, expected);
}

function assertExpressionError(source: string, expectedCode: "DomainError"): void {
  const result = evaluateExpressionToRealValue(source);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expectedCode);
}

function assertRationalEqual(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}
