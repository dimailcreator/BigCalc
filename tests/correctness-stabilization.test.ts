import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  divideRational,
  integerRational,
  negateRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import {
  createRationalInterval,
  expRationalInterval,
  gammaRealInterval,
  reduceRadianInterval,
  sinAngleInterval
} from "../src/core/math/elementary.js";
import { getPiProviderStateSnapshot, getPiRationalInterval } from "../src/core/math/constants.js";

void describe("stage 23 correctness stabilization", () => {
  void it("preserves quadrant signs for the known radian and degree regressions", async () => {
    await assertVerifiedPrefix("sin(4)", "75680249530792825137", 20, -1, "radians");
    await assertVerifiedPrefix("cos(4)", "65364362086361191463", 20, -1, "radians");
    await assertVerifiedPrefix("sin(100)", "98480775301220805936", 20, 1, "degrees");
    await assertVerifiedPrefix("cos(100)", "17364817766693034885", 20, -1, "degrees");
  });

  void it("keeps signs in all four quadrants and for large arguments of either sign", async () => {
    const quadrantCases = [
      ["sin(40)", 1],
      ["cos(40)", 1],
      ["sin(140)", 1],
      ["cos(140)", -1],
      ["sin(220)", -1],
      ["cos(220)", -1],
      ["sin(320)", -1],
      ["cos(320)", 1]
    ] as const;

    for (const [source, sign] of quadrantCases) {
      await assertVerifiedSign(source, sign, "degrees");
    }

    await assertVerifiedPrefix("sin(1000000)", "3499935021", 10, -1, "radians");
    await assertVerifiedPrefix("sin(-1000000)", "3499935021", 10, 1, "radians");
  });

  void it("does not choose an unsafe branch near quadrant boundaries", async () => {
    await assertVerifiedSign("sin(89999999/1000000)", 1, "degrees");
    await assertVerifiedSign("cos(89999999/1000000)", 1, "degrees");
    await assertVerifiedSign("sin(90000001/1000000)", 1, "degrees");
    await assertVerifiedSign("cos(90000001/1000000)", -1, "degrees");

    const context = createEvaluationContext();
    const exactFour = createRationalInterval(integerRational(4n), integerRational(4n));
    const reduction = reduceRadianInterval(exactFour, 30, context);
    assert.ok(reduction !== null);
    assert.equal(reduction.branches.length, 1);

    const branch = reduction.branches[0];
    assert.ok(branch !== undefined);
    assert.equal(branch.quadrant, 3);
    assert.equal(branch.sinSign, -1);
    assert.equal(branch.cosSign, 1);
    assert.equal(branch.swapSinCos, true);

    const pi = getPiRationalInterval(context, 50);
    const quarterPiUpper = divideRational(pi.upper, integerRational(4n));
    assert.equal(
      compareRational(branch.reducedInterval.lower, negateRational(quarterPiUpper)) >= 0,
      true
    );
    assert.equal(compareRational(branch.reducedInterval.upper, quarterPiUpper) <= 0, true);
  });

  void it("shares one precision-aware pi provider across constants, trig, degree conversion, and Gamma", async () => {
    const context = createEvaluationContext({
      settings: { angleMode: "degrees", factorialMode: "gamma" }
    });
    const first = getPiRationalInterval(context, 20);
    const afterFirst = getPiProviderStateSnapshot(context);
    const repeated = getPiRationalInterval(context, 20);
    const afterRepeated = getPiProviderStateSnapshot(context);

    assert.equal(repeated, first);
    assert.equal(afterRepeated.completedTerms, afterFirst.completedTerms);
    assert.equal(afterRepeated.cacheHits, afterFirst.cacheHits + 1);

    const angle = createRationalInterval(integerRational(100n), integerRational(100n));
    assert.ok(sinAngleInterval(angle, 30, "degrees", context) !== null);
    const afterTrig = getPiProviderStateSnapshot(context);
    assert.equal(afterTrig.highestRequestedDigits > afterFirst.highestRequestedDigits, true);

    const half = createRational(1n, 2n);
    assert.ok(gammaRealInterval(createRationalInterval(half, half), 20, context) !== null);
    const afterGamma = getPiProviderStateSnapshot(context);
    assert.equal(afterGamma.intervalRequests > afterTrig.intervalRequests, true);
    assert.equal(afterGamma.cacheHits > afterTrig.cacheHits, true);

    const piDefinition = context.registry.getConstant("π");
    assert.ok(piDefinition !== null);
    const piValue = piDefinition.createValue(context);
    assert.equal(piValue.kind, "lazy-real");
    await piValue.refine({ significantDigits: 10 }, context);
    assert.equal(getPiProviderStateSnapshot(context).cacheHits > afterGamma.cacheHits, true);
  });

  void it("lets lifecycle checkpoints stop exp reconstruction work", () => {
    const sentinel = new Error("checkpoint sentinel");
    let checkpoints = 0;

    assert.throws(
      () =>
        expRationalInterval(integerRational(1024n), 20, {
          checkpoint(): void {
            checkpoints += 1;
            if (checkpoints === 10) {
              throw sentinel;
            }
          }
        }),
      (error: unknown) => error === sentinel
    );
    assert.equal(checkpoints, 10);
  });
});

async function assertVerifiedPrefix(
  source: string,
  prefix: string,
  significantDigits: number,
  sign: -1 | 1,
  angleMode: "radians" | "degrees"
): Promise<void> {
  const result = createEvaluationGraphFromSource(source, { settings: { angleMode } });
  assert.equal(result.ok, true);
  const ball = await result.graph.refine({ significantDigits });
  const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= significantDigits, true);
  assert.equal(verified.digits.startsWith(prefix.slice(0, significantDigits)), true);
}

async function assertVerifiedSign(
  source: string,
  sign: -1 | 1,
  angleMode: "radians" | "degrees"
): Promise<void> {
  const result = createEvaluationGraphFromSource(source, { settings: { angleMode } });
  assert.equal(result.ok, true);
  const request = { significantDigits: 8 } as const;
  const ball = await result.graph.refine(request);
  const verified = verifiedNumberFromBall(ball, request, result.context.backend);

  assert.equal(verified.sign, sign);
  assert.equal(verified.verifiedDigits >= request.significantDigits, true);
}
