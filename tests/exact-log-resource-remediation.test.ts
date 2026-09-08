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
import { exactLogRationalWithProfile } from "../src/core/math/elementary.js";

const HEAVY_LOG_EXPONENT = 4_096n;
const HEAVY_LOG_ARGUMENT = 1n << HEAVY_LOG_EXPONENT;
const HEAVY_LOG_LITERAL = HEAVY_LOG_ARGUMENT.toString();

void describe("stage 34 exact-log resource remediation", () => {
  void it("keeps exact integer logarithms above the former exponent ceiling", () => {
    const exponent = 100_000n;
    const result = exactLogRationalWithProfile(
      integerRational(2n),
      integerRational(1n << exponent)
    );

    assertRationalEqual(result.value, integerRational(exponent));
    assert.equal(result.profile.matchedExponent, exponent);
    assert.equal(result.profile.exactPowerChecks, 1);
  });

  void it("pauses and resumes an exact candidate power comparison", async () => {
    let ticks = 0;
    const created = createCalculationHandleFromSource(`log2(${HEAVY_LOG_LITERAL})`, {
      now: () => ticks++,
      settings: { maxCalculationTimeMs: 5 },
      resourceLimits: { maxEstimatedBigIntDigits: 5_000 }
    });
    assert.equal(created.ok, true);

    let result = await created.handle.refine({ significantDigits: 10 });
    let pauses = 0;
    while (result.status === "paused") {
      pauses += 1;
      assert.equal(pauses < 20, true);
      ticks = 0;
      result = await created.handle.continue();
    }

    assert.equal(pauses > 0, true);
    assert.equal(result.status, "complete");
    assert.equal(result.value.digits.startsWith("4096"), true);
  });

  void it("cancels inside an exact candidate power comparison", async () => {
    let checkpoints = 0;
    let cancel: (() => void) | null = null;
    const created = createCalculationHandleFromSource(`log2(${HEAVY_LOG_LITERAL})`, {
      checkpoint(): void {
        checkpoints += 1;
        if (checkpoints === 6) cancel?.();
      }
    });
    assert.equal(created.ok, true);
    cancel = () => {
      created.handle.cancel();
    };

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "cancelled");
    assert.equal(checkpoints, 6);
  });

  void it("rejects an oversized candidate comparison through the typed memory guard", async () => {
    const created = createCalculationHandleFromSource(`log2(${HEAVY_LOG_LITERAL})`, {
      resourceLimits: { maxEstimatedBigIntDigits: 100 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
    assert.equal(result.error.resource, "memory");
  });

  void it("early-aborts a wrong neighboring exponent without materializing its power", () => {
    const argument = HEAVY_LOG_ARGUMENT - 1n;
    const result = exactLogRationalWithProfile(integerRational(2n), integerRational(argument));

    assert.equal(result.value, null);
    assert.equal(result.profile.estimatedExponent, HEAVY_LOG_EXPONENT);
    assert.equal(result.profile.earlyAbortedPowerChecks > 0, true);
    assert.equal(result.profile.peakPowerComponentDigits < argument.toString().length, true);
  });

  void it("preserves exact log_x(x) and the adaptive near-one-base path", async () => {
    const exact = evaluateExpressionToRealValue("log{7}(7)");
    assert.equal(exact.ok, true);
    assertRationalValue(exact.value, integerRational(1n));

    const adaptive = createEvaluationGraphFromSource("log{1+1/100000000000000000000}(2)");
    assert.equal(adaptive.ok, true);
    const request = { significantDigits: 30 } as const;
    const ball = await adaptive.graph.refine(request);
    const verified = verifiedNumberFromBall(ball, request, adaptive.context.backend);
    assert.equal(verified.verifiedDigits >= request.significantDigits, true);
    assert.equal(adaptive.graph.root.getStateSnapshot().childRequests.length > 0, true);
  });
});

function assertRationalValue(actual: RealValue, expected: Rational): void {
  assert.equal(actual.kind, "rational");
  assertRationalEqual(actual, expected);
}

function assertRationalEqual(actual: Rational | null, expected: Rational): void {
  assert.ok(actual !== null);
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}
