import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  divideRational,
  multiplyRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import {
  getLn2ProviderStateSnapshot,
  getLn2RationalInterval,
  getPiProviderStateSnapshot,
  getPiRationalInterval
} from "../src/core/math/constants.js";
import {
  createScaledInterval,
  divScaled,
  mulScaled,
  rescaleScaled,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds,
  squareScaled
} from "../src/core/math/scaled-interval.js";
import type { Rational } from "../src/core/index.js";

const PI_PREFIX_200 = [
  "31415926535897932384626433832795028841971693993751",
  "05820974944592307816406286208998628034825342117067",
  "98214808651328230664709384460955058223172535940812",
  "84811174502841027019385211055596446229489549303819"
].join("");

void describe("stage 24 high-precision infrastructure", () => {
  void it("uses resumable Chudnovsky binary splitting with strict growing pi intervals", async () => {
    const context = createEvaluationContext();
    const result = createEvaluationGraphFromSource("π", {
      checkpoint(): void {
        context.checkpoint();
      }
    });
    assert.equal(result.ok, true);

    let previousDigits = "";
    let previousTerms = 0;
    for (const significantDigits of [10, 100, 200]) {
      const ball = await result.graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
      const snapshot = getPiProviderStateSnapshot(result.context);

      assert.equal(snapshot.algorithm, "chudnovsky-binary-splitting");
      assert.equal(snapshot.completedTerms >= previousTerms, true);
      assert.equal(snapshot.cachedBlocks * 4, snapshot.completedTerms);
      assert.equal(snapshot.completedTerms < significantDigits / 2 + 8, true);
      assert.equal(verified.digits.startsWith(previousDigits), true);
      assert.equal(verified.digits.startsWith(PI_PREFIX_200.slice(0, significantDigits)), true);
      previousDigits = verified.digits;
      previousTerms = snapshot.completedTerms;
    }
  });

  void it("reuses pi blocks and cached intervals across increasing and repeated requests", () => {
    const context = createEvaluationContext();
    const first = getPiRationalInterval(context, 40);
    const firstState = getPiProviderStateSnapshot(context);
    const repeated = getPiRationalInterval(context, 20);
    const repeatedState = getPiProviderStateSnapshot(context);
    const extended = getPiRationalInterval(context, 150);
    const extendedState = getPiProviderStateSnapshot(context);

    assert.equal(repeated, first);
    assert.equal(repeatedState.cacheHits, firstState.cacheHits + 1);
    assert.equal(repeatedState.completedTerms, firstState.completedTerms);
    assert.equal(extendedState.completedTerms > firstState.completedTerms, true);
    assert.equal(extendedState.cachedBlocks > firstState.cachedBlocks, true);
    assertPiPrefixContainment(extended, PI_PREFIX_200);
  });

  void it("extends e from its rigorous factorial tail estimate instead of missing-digit chunks", async () => {
    const context = createEvaluationContext();
    const definition = context.registry.getConstant("e");
    assert.ok(definition !== null);
    const value = definition.createValue(context);
    assert.equal(value.kind, "lazy-real");

    await value.refine({ significantDigits: 100 }, context);
    const after100 = statefulConstantSnapshot(value);
    await value.refine({ significantDigits: 101 }, context);
    const after101 = statefulConstantSnapshot(value);
    await value.refine({ significantDigits: 300 }, context);
    const after300 = statefulConstantSnapshot(value);

    assert.equal(after100.lastTargetTermCount, after100.completedTerms);
    assert.equal(after101.lastRefinementAddedTerms, 0);
    assert.equal(after300.lastTargetTermCount, after300.completedTerms);
    assert.equal(after300.lastRefinementAddedTerms < 199, true);
    assert.equal(after300.completedTerms > after101.completedTerms, true);
  });

  void it("shares and extends a context-scoped rigorous ln(2) cache", async () => {
    const context = createEvaluationContext();
    const first = getLn2RationalInterval(context, 30);
    const firstState = getLn2ProviderStateSnapshot(context);
    const repeated = getLn2RationalInterval(context, 20);
    const repeatedState = getLn2ProviderStateSnapshot(context);

    assert.equal(repeated, first);
    assert.equal(repeatedState.cacheHits, firstState.cacheHits + 1);

    const result = createEvaluationGraphFromSource("ln(8)", {
      checkpoint(): void {
        context.checkpoint();
      }
    });
    assert.equal(result.ok, true);
    await result.graph.refine({ significantDigits: 80 });
    const graphState = getLn2ProviderStateSnapshot(result.context);
    assert.equal(graphState.completedTerms > 0, true);

    const extended = getLn2RationalInterval(context, 40);
    const extendedState = getLn2ProviderStateSnapshot(context);
    assert.equal(extendedState.completedTerms > firstState.completedTerms, true);
    assertContainsDecimalPrefix(extended, "69314718055994530941723212145817656807550013436025");
  });

  void it("matches exact Rational references for fixed-point interval operations", () => {
    const leftExact = {
      lower: createRational(-7n, 20n),
      upper: createRational(11n, 30n)
    };
    const rightExact = {
      lower: createRational(2n, 7n),
      upper: createRational(5n, 9n)
    };
    const denominatorExact = {
      lower: createRational(-5n, 4n),
      upper: createRational(-3n, 4n)
    };
    const left = scaledIntervalFromRationalBounds(leftExact, 8);
    const right = scaledIntervalFromRationalBounds(rightExact, 7);
    const denominator = scaledIntervalFromRationalBounds(denominatorExact, 6);

    assertContainsReference(
      mulScaled(left, right, 9),
      endpointProductBounds(leftExact, rightExact)
    );
    assertContainsReference(squareScaled(left, 9), {
      lower: createRational(0n, 1n),
      upper: multiplyRational(leftExact.upper, leftExact.upper)
    });
    assertContainsReference(
      divScaled(left, denominator, 9),
      endpointDivisionBounds(leftExact, denominatorExact)
    );
    assertContainsReference(rescaleScaled(left, 3), leftExact);

    const crossing = createScaledInterval(-12345n, 6789n, 4);
    const squared = scaledIntervalToRationalBounds(squareScaled(crossing, 5));
    assert.equal(compareRational(squared.lower, createRational(0n, 1n)) <= 0, true);
    assert.equal(compareRational(squared.upper, createRational(152399025n, 100000000n)) >= 0, true);
  });
});

function statefulConstantSnapshot(value: object): {
  readonly completedTerms: number;
  readonly lastRefinementAddedTerms: number;
  readonly lastTargetTermCount: number;
} {
  const snapshot = (
    value as {
      getStateSnapshot(): {
        readonly completedTerms: number;
        readonly lastRefinementAddedTerms?: number;
        readonly lastTargetTermCount?: number;
      };
    }
  ).getStateSnapshot();
  assert.ok(snapshot.lastRefinementAddedTerms !== undefined);
  assert.ok(snapshot.lastTargetTermCount !== undefined);
  return {
    completedTerms: snapshot.completedTerms,
    lastRefinementAddedTerms: snapshot.lastRefinementAddedTerms,
    lastTargetTermCount: snapshot.lastTargetTermCount
  };
}

function assertPiPrefixContainment(
  interval: { readonly lower: Rational; readonly upper: Rational },
  prefix: string
): void {
  assertContainsDecimalPrefix(interval, prefix, 1n);
}

function assertContainsDecimalPrefix(
  interval: { readonly lower: Rational; readonly upper: Rational },
  prefix: string,
  integerDigits = 0n
): void {
  const denominator = 10n ** BigInt(prefix.length - Number(integerDigits));
  const referenceLower = createRational(BigInt(prefix), denominator);
  const referenceUpper = createRational(BigInt(prefix) + 1n, denominator);
  assert.equal(compareRational(interval.lower, referenceLower) <= 0, true);
  assert.equal(compareRational(interval.upper, referenceUpper) >= 0, true);
}

function assertContainsReference(
  actual: ReturnType<typeof createScaledInterval>,
  expected: { readonly lower: Rational; readonly upper: Rational }
): void {
  const bounds = scaledIntervalToRationalBounds(actual);
  assert.equal(compareRational(bounds.lower, expected.lower) <= 0, true);
  assert.equal(compareRational(bounds.upper, expected.upper) >= 0, true);
}

function endpointProductBounds(
  left: { readonly lower: Rational; readonly upper: Rational },
  right: { readonly lower: Rational; readonly upper: Rational }
): { readonly lower: Rational; readonly upper: Rational } {
  return minMaxRationals([
    multiplyRational(left.lower, right.lower),
    multiplyRational(left.lower, right.upper),
    multiplyRational(left.upper, right.lower),
    multiplyRational(left.upper, right.upper)
  ]);
}

function endpointDivisionBounds(
  numerator: { readonly lower: Rational; readonly upper: Rational },
  denominator: { readonly lower: Rational; readonly upper: Rational }
): { readonly lower: Rational; readonly upper: Rational } {
  return minMaxRationals([
    divideRational(numerator.lower, denominator.lower),
    divideRational(numerator.lower, denominator.upper),
    divideRational(numerator.upper, denominator.lower),
    divideRational(numerator.upper, denominator.upper)
  ]);
}

function minMaxRationals(values: readonly Rational[]): {
  readonly lower: Rational;
  readonly upper: Rational;
} {
  let lower = values[0];
  let upper = values[0];
  assert.ok(lower !== undefined && upper !== undefined);
  for (const value of values.slice(1)) {
    if (compareRational(value, lower) < 0) lower = value;
    if (compareRational(value, upper) > 0) upper = value;
  }
  return { lower, upper };
}
