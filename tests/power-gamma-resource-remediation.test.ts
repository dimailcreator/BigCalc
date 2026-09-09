import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ballToOutwardInterval,
  createCalculationHandleFromSource,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  integerRational,
  multiplyBall,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext } from "../src/core/index.js";
import { ResourceLimitException } from "../src/core/errors/index.js";
import {
  createRationalInterval,
  gammaRealIntervalWithProfile,
  getBernoulliCacheSnapshot,
  planNthRootStrategy
} from "../src/core/math/elementary.js";

void describe("stage 35 exponent-aware power, Gamma, and Bernoulli resources", () => {
  void it("routes a small root with a huge numerator through exponent-aware power", () => {
    const plan = planNthRootStrategy(
      2n,
      20,
      createRationalInterval(integerRational(2n), integerRational(2n)),
      2_000_001n
    );

    assert.equal(plan.strategy, "ln-exp");
    assert.equal(["result-magnitude", "numerator-power"].includes(plan.reason), true);
    assert.equal(plan.numeratorMagnitude, 2_000_001n);
    assert.equal(plan.estimatedResultMagnitudeDigits > 1_000_000n, true);
  });

  void it("keeps huge positive and negative approximate powers compact", async () => {
    const positive = await refineVerified("2^(1000000+1/2)", 20);
    const negative = await refineVerified("2^(-1000000-1/2)", 20);

    assert.equal(positive.verified.exponent10, 301_030n);
    assert.equal(negative.verified.exponent10, -301_031n);
    assert.equal(bigintBitLength(positive.ball.center.significand) < 160, true);
    assert.equal(bigintBitLength(positive.ball.radius.significand) < 160, true);
    assert.equal(bigintBitLength(negative.ball.center.significand) < 160, true);
    assert.equal(bigintBitLength(negative.ball.radius.significand) < 160, true);
  });

  void it("preserves containment and monotonic prefixes after the compact power route", async () => {
    const created = createEvaluationGraphFromSource("2^(1000000+1/2)");
    assert.equal(created.ok, true);
    let prefix = "";

    for (const significantDigits of [10, 20]) {
      const request = { significantDigits } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);
      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(prefix), true);
      prefix = verified.digits;
    }

    assert.equal(prefix.startsWith("1400164231"), true);

    const positive = await refineVerified("2^(1000000+1/2)", 19);
    const reciprocal = await refineVerified("2^(-1000000-1/2)", 19);
    const product = multiplyBall(positive.ball, reciprocal.ball, 80, created.context.backend);
    const productInterval = ballToOutwardInterval(product, 80, created.context.backend);
    const exactOne = created.context.backend.fromRational(integerRational(1n), 80, "nearest");
    assert.equal(created.context.backend.compare(productInterval.lower, exactOne) <= 0, true);
    assert.equal(created.context.backend.compare(productInterval.upper, exactOne) >= 0, true);
  });

  void it("keeps the negative-base odd-denominator path compact", async () => {
    const result = await refineVerified("(-2)^(200001/3)", 15);

    assert.equal(result.verified.sign, -1);
    assert.equal(result.verified.exponent10 > 20_000n, true);
    assert.equal(bigintBitLength(result.ball.center.significand) < 160, true);
  });

  void it("keeps direct and reflected huge Gamma results compact", async () => {
    const direct = await refineVerified("10000,5!", 15, "gamma");
    const reflected = await refineVerified("(-10000,5)!", 15, "gamma");

    assert.equal(direct.verified.exponent10 > 30_000n, true);
    assert.equal(reflected.verified.exponent10 < -30_000n, true);
    assert.equal(bigintBitLength(direct.ball.center.significand) < 160, true);
    assert.equal(bigintBitLength(reflected.ball.center.significand) < 160, true);
  });

  void it("does not reject a compact Gamma result by its expanded decimal magnitude", async () => {
    const created = createCalculationHandleFromSource("10000,5!", {
      settings: { factorialMode: "gamma" },
      resourceLimits: { maxEstimatedBigIntDigits: 5_000 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 15 });
    assert.equal(result.status, "complete");
    assert.equal(result.value.exponent10 > 30_000n, true);
  });

  void it("isolates Bernoulli high-water state between evaluation owners", () => {
    const first = createEvaluationContext();
    const second = createEvaluationContext();
    const initialSecond = getBernoulliCacheSnapshot(second);
    const argument = integerRational(1_000n);

    gammaRealIntervalWithProfile(createRationalInterval(argument, argument), 10, first, {
      minimumCorrectionTerms: 32
    });

    const expandedFirst = getBernoulliCacheSnapshot(first);
    const unchangedSecond = getBernoulliCacheSnapshot(second);
    assert.equal(expandedFirst.highestEvenIndex >= 64, true);
    assert.deepEqual(unchangedSecond, initialSecond);
  });

  void it("keeps a resumable Bernoulli frontier consistent after a typed resource failure", () => {
    let allowExpansion = false;
    const context: EvaluationGraphContext = createEvaluationContext({
      guardBigIntDigits(estimatedDigits): void {
        const snapshot = getBernoulliCacheSnapshot(context);
        if (
          !allowExpansion &&
          estimatedDigits > 1 &&
          snapshot.pendingOrder !== null &&
          snapshot.generationCheckpoints >= 3
        ) {
          throw new ResourceLimitException("memory", "Test Bernoulli cache budget exceeded");
        }
      }
    });
    const argument = integerRational(1_000n);
    const interval = createRationalInterval(argument, argument);

    assert.throws(
      () =>
        gammaRealIntervalWithProfile(interval, 10, context, {
          minimumCorrectionTerms: 24
        }),
      (error: unknown) => error instanceof ResourceLimitException && error.resource === "memory"
    );
    const failed = getBernoulliCacheSnapshot(context);
    assert.notEqual(failed.pendingOrder, null);
    assert.equal(failed.retainedBigIntDigits > 0, true);

    allowExpansion = true;
    const resumed = gammaRealIntervalWithProfile(interval, 10, context, {
      minimumCorrectionTerms: 24
    });
    const completed = getBernoulliCacheSnapshot(context);

    assert.ok(resumed.interval !== null);
    assert.equal(completed.pendingOrder, null);
    assert.equal(completed.highestEvenIndex >= 48, true);
    assert.equal(completed.convolutionProducts >= failed.convolutionProducts, true);
  });
});

async function refineVerified(
  source: string,
  significantDigits: number,
  factorialMode: "integer" | "gamma" = "integer"
) {
  const created = createEvaluationGraphFromSource(source, { settings: { factorialMode } });
  assert.equal(created.ok, true);
  const request = { significantDigits } as const;
  const ball = await created.graph.refine(request);
  const verified = verifiedNumberFromBall(ball, request, created.context.backend);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  return { ball, verified };
}

function bigintBitLength(value: bigint): number {
  const magnitude = value < 0n ? -value : value;
  return magnitude === 0n ? 0 : magnitude.toString(2).length;
}
