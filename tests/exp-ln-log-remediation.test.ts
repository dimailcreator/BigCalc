import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEvaluationContext,
  createEvaluationGraph,
  createEvaluationGraphFromSource,
  createInternalInterval,
  createLazyRealNode,
  createLogNode,
  integerRational,
  intervalToBall,
  evaluateExpressionToRealValue,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { EvaluationGraphContext, LazyReal, Rational } from "../src/core/index.js";
import {
  createRationalInterval,
  exactLogRationalWithProfile,
  expIntervalBallWithProfile
} from "../src/core/math/elementary.js";
import { getLn2ProviderStateSnapshot, getLn2RationalInterval } from "../src/core/math/constants.js";
import { DomainException } from "../src/core/errors/index.js";

void describe("stage 30 exp, ln, and log remediation", () => {
  void it("reconstructs large positive and negative exp through a binary exponent", async () => {
    const context = createEvaluationContext();

    for (const value of [1_024n, -1_024n, 1_000_000n, -1_000_000n]) {
      const argument = integerRational(value);
      const result = expIntervalBallWithProfile(
        createRationalInterval(argument, argument),
        40,
        160,
        context.backend,
        context
      );
      assert.ok(result.ball !== null && result.profile !== null);
      assert.equal(result.profile.mantissaScaleDigits, 50);
      assert.equal(result.profile.mantissaPeakDecimalDigits < 60, true);
      assert.equal(result.profile.resultSignificandBits <= 160, true);
      assert.equal(result.profile.ln2RequestedDigits < 100, true);
      assert.equal(result.profile.binaryExponent > 0n, value > 0n);
      assert.equal(result.profile.resultExponentMagnitude > 1_000n, true);
    }

    await assertVerifiedLargeExp("exp(1000000)", "30332153968020875450", 434_294n);
    await assertVerifiedLargeExp("exp(-1000000)", "32968314780885585789", -434_295n);
  });

  void it("keeps ln(2) series state compact across cache hits and continuation", () => {
    const context = createEvaluationContext();
    const first = getLn2RationalInterval(context, 50);
    const afterFirst = getLn2ProviderStateSnapshot(context);
    const repeated = getLn2RationalInterval(context, 20);
    const afterHit = getLn2ProviderStateSnapshot(context);
    const extended = getLn2RationalInterval(context, 500);
    const afterExtension = getLn2ProviderStateSnapshot(context);

    assert.equal(repeated, first);
    assert.equal(afterHit.cacheHits, afterFirst.cacheHits + 1);
    assert.equal(afterHit.summationPasses, afterFirst.summationPasses);
    assert.equal(afterHit.lastRefinementAddedTerms, 0);
    assert.equal(afterExtension.completedTerms > afterFirst.completedTerms, true);
    assert.equal(afterExtension.lastRefinementAddedTerms > 0, true);
    assert.equal(afterExtension.retainedGrowingDenominators, 0);
    assert.equal(afterExtension.recurrenceStateBigIntCount, 1);
    assert.equal(
      afterExtension.cachedBigIntDigits < afterExtension.highestRequestedDigits * 7,
      true
    );
    assertContainsPrefix(extended, "6931471805599453094172321214581765680755");
  });

  void it("finds exact integer logarithms far above the former 512 ceiling", () => {
    for (const exponent of [1_000n, 100_000n]) {
      const argument = integerRational(1n << exponent);
      const result = exactLogRationalWithProfile(integerRational(2n), argument);

      assertRationalEqual(result.value, integerRational(exponent));
      assert.equal(result.profile.estimatedExponent, exponent);
      assert.equal(result.profile.matchedExponent, exponent);
      assert.equal(result.profile.candidateCount <= 7, true);
      assert.equal(result.profile.exactPowerChecks <= 7, true);
    }

    const endToEnd = evaluateExpressionToRealValue("log2(2^100000)");
    assert.equal(endToEnd.ok, true);
    assert.equal(endToEnd.value.kind, "rational");
    assertRationalEqual(endToEnd.value, integerRational(100_000n));
  });

  void it("returns exact log_x(x) only after proving its domain", async () => {
    let positiveRefinements = 0;
    const positive = createLazyRealNode(
      fixedLazyRational(integerRational(2n), () => {
        positiveRefinements += 1;
      })
    );
    const positiveGraph = createEvaluationGraph(
      createLogNode({ base: positive, argument: positive, iteration: null }),
      createEvaluationContext()
    );
    const ball = await positiveGraph.refine({ significantDigits: 40 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 40 },
      positiveGraph.context.backend
    );

    assert.equal(verified.digits.startsWith("1"), true);
    assert.equal(verified.exponent10, 0n);
    assert.equal(positiveRefinements, 1);

    const invalid = createLazyRealNode(fixedLazyRational(integerRational(1n)));
    const invalidGraph = createEvaluationGraph(
      createLogNode({ base: invalid, argument: invalid, iteration: null }),
      createEvaluationContext()
    );
    await assert.rejects(
      invalidGraph.refine({ significantDigits: 20 }),
      (error: unknown) => error instanceof DomainException && error.operation === "log"
    );
  });

  void it("preserves adaptive near-one logarithm refinement", async () => {
    const result = createEvaluationGraphFromSource("log{1+1/100000000000000000000}(2)");
    assert.equal(result.ok, true);
    const ball = await result.graph.refine({ significantDigits: 30 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 30 },
      result.context.backend
    );

    assert.equal(verified.verifiedDigits >= 30, true);
    assert.equal(result.graph.root.getStateSnapshot().childRequests.length > 0, true);
  });
});

async function assertVerifiedLargeExp(
  source: string,
  prefix: string,
  exponent10: bigint
): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);
  const request = { significantDigits: prefix.length } as const;
  const ball = await result.graph.refine(request);
  const verified = verifiedNumberFromBall(ball, request, result.context.backend);
  assert.equal(verified.digits, prefix);
  assert.equal(verified.exponent10, exponent10);
}

function fixedLazyRational(value: Rational, onRefine: () => void = () => undefined): LazyReal {
  return Object.freeze({
    kind: "lazy-real",
    refine(request: Parameters<LazyReal["refine"]>[0], context: Parameters<LazyReal["refine"]>[1]) {
      onRefine();
      const graphContext = context as EvaluationGraphContext;
      const precisionBits = Math.max(128, request.significantDigits * 4);
      return Promise.resolve(
        intervalToBall(
          createInternalInterval(
            graphContext.backend.fromRational(value, precisionBits, "towardNegativeInfinity"),
            graphContext.backend.fromRational(value, precisionBits, "towardPositiveInfinity"),
            graphContext.backend
          ),
          precisionBits,
          graphContext.backend
        )
      );
    }
  });
}

function assertContainsPrefix(
  interval: { readonly lower: Rational; readonly upper: Rational },
  prefix: string
): void {
  const denominator = 10n ** BigInt(prefix.length);
  const lower = { kind: "rational", numerator: BigInt(prefix), denominator } as const;
  const upper = { kind: "rational", numerator: BigInt(prefix) + 1n, denominator } as const;
  assert.equal(compareRationals(interval.lower, lower) >= 0, true);
  assert.equal(compareRationals(interval.upper, upper) < 0, true);
}

function compareRationals(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function assertRationalEqual(actual: Rational | null, expected: Rational): void {
  assert.ok(actual !== null);
  assert.equal(actual.numerator, expected.numerator);
  assert.equal(actual.denominator, expected.denominator);
}
