import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEvaluationContext,
  createRational,
  verifiedNumberFromBall,
  compareRational,
  addRational,
  subtractRational,
  multiplyRational,
  divideRational
} from "../src/core/index.js";
import {
  gammaRealBallWithProfile,
  getBernoulliCacheSnapshot,
  createGammaStirlingPlan,
  stirlingCorrectionInterval
} from "../src/core/math/elementary.js";
import {
  recurrentStirlingCorrection,
  getStirlingCorrectionSnapshot
} from "../src/core/math/stirling-correction.js";
import type { EvaluationGraphContext } from "../src/core/index.js";
import { ResourceLimitException } from "../src/core/errors/index.js";

void describe("AR-5 adaptive Stirling", () => {
  void it("escapes a fixed-point rounding floor by refining the scale, not generating endless coefficients", () => {
    const x = createRational(64n, 1n),
      argument = { lower: x, upper: x };
    const budget = new Error("Too many coefficients for this test");
    const legacy: EvaluationGraphContext = createEvaluationContext({
      checkpoint() {
        if (getBernoulliCacheSnapshot(legacy).highestEvenIndex > 80) throw budget;
      }
    });
    assert.throws(
      () => stirlingCorrectionInterval(argument, 40, legacy, 0, false, 40),
      (e) => e === budget
    );
    const adaptive: EvaluationGraphContext = createEvaluationContext({
      checkpoint() {
        if (getBernoulliCacheSnapshot(adaptive).highestEvenIndex > 80) throw budget;
      }
    });
    const result = stirlingCorrectionInterval(argument, 40, adaptive, 0, true, 40);
    const reference = stirlingCorrectionInterval(argument, 80, createEvaluationContext(), 0);
    assert.ok(
      compareRational(
        subtractRational(result.sum.lower, result.remainder),
        subtractRational(reference.sum.lower, reference.remainder)
      ) <= 0
    );
    assert.ok(
      compareRational(
        addRational(result.sum.upper, result.remainder),
        addRational(reference.sum.upper, reference.remainder)
      ) >= 0
    );
  });
  void it("bounds a finite correction sum and the first omitted term independently", () => {
    const z = createRational(1000n, 1n);
    const bs = [
      createRational(0n, 1n),
      createRational(1n, 6n),
      createRational(-1n, 30n),
      createRational(1n, 42n),
      createRational(-1n, 30n)
    ];
    const bernoulli = (i: number) => {
      const value = bs[i / 2];
      assert.ok(value !== undefined);
      return value;
    };
    const result = recurrentStirlingCorrection(
      { lower: z, upper: z },
      8,
      3,
      createEvaluationContext(),
      bernoulli,
      () => 0
    );
    let exact = createRational(0n, 1n);
    for (let k = 1; k <= 3; k++)
      exact = addRational(
        exact,
        divideRational(
          bernoulli(2 * k),
          createRational(BigInt(2 * k * (2 * k - 1)) * 1000n ** BigInt(2 * k - 1), 1n)
        )
      );
    assert.equal(result.terms, 3);
    assert.ok(compareRational(result.sum.lower, exact) <= 0);
    assert.ok(compareRational(result.sum.upper, exact) >= 0);
    assert.ok(compareRational(result.remainder, createRational(1n, 1680n * 1000n ** 7n)) >= 0);
  });

  void it("agrees with the reference through direct, reflection, near-pole and half-integer routes", () => {
    for (const [n, d] of [
      [4n, 3n],
      [-1n, 3n],
      [-1000n, 3n],
      [1000001n, 1000000n],
      [-999999n, 1000000n],
      [3n, 2n],
      [20001n, 2n],
      [10n ** 60n + 1n, 10n ** 60n]
    ] as const) {
      const x = createRational(n, d);
      const prefixes = (["legacy", "adaptive"] as const).map((stirlingStrategy) => {
        const context = createEvaluationContext();
        const result = gammaRealBallWithProfile(
          { lower: x, upper: x },
          52,
          400,
          context.backend,
          context,
          { stirlingStrategy }
        );
        assert.ok(result.ball !== null);
        const verified = verifiedNumberFromBall(
          result.ball,
          { significantDigits: 40 },
          context.backend
        );
        assert.ok(verified.verifiedDigits >= 40);
        return [verified.sign, verified.exponent10, verified.digits.slice(0, 40)];
      });
      assert.deepEqual(prefixes[0], prefixes[1]);
    }
  });

  void it("resumes committed corrections without adding them twice", () => {
    let interrupt = true;
    const paused = new Error("test pause");
    const context: EvaluationGraphContext = createEvaluationContext({
      checkpoint() {
        if (
          interrupt &&
          getStirlingCorrectionSnapshot(context).states.some((s) => !s.done && s.terms >= 5)
        )
          throw paused;
      }
    });
    const x = createRational(4n, 3n);
    const run = (owner: EvaluationGraphContext) =>
      gammaRealBallWithProfile({ lower: x, upper: x }, 70, 400, owner.backend, owner, {
        algorithm: "stirling"
      });
    assert.throws(
      () => run(context),
      (e) => e === paused
    );
    assert.equal(getStirlingCorrectionSnapshot(context).pending, 1);
    const frontier = getStirlingCorrectionSnapshot(context).states[0]?.terms;
    assert.equal(frontier, 5);
    interrupt = false;
    const resumed = run(context),
      cold = run(createEvaluationContext());
    assert.deepEqual(resumed, cold);
    const before = getBernoulliCacheSnapshot(context);
    run(context);
    assert.deepEqual(getBernoulliCacheSnapshot(context), before);
    assert.equal(getStirlingCorrectionSnapshot(context).pending, 0);
  });

  void it("preserves correction state after a resource guard rejects a temporary allocation", () => {
    let reject = true;
    const context: EvaluationGraphContext = createEvaluationContext({
      guardBigIntDigits() {
        if (
          reject &&
          getStirlingCorrectionSnapshot(context).states.some((s) => !s.done && s.terms >= 4)
        )
          throw new ResourceLimitException("memory", "Test correction allocation");
      }
    });
    const x = createRational(4n, 3n);
    const run = (owner: EvaluationGraphContext) =>
      gammaRealBallWithProfile({ lower: x, upper: x }, 60, 350, owner.backend, owner, {
        algorithm: "stirling"
      });
    assert.throws(() => run(context), ResourceLimitException);
    assert.equal(getStirlingCorrectionSnapshot(context).states[0]?.terms, 4);
    reject = false;
    assert.deepEqual(run(context), run(createEvaluationContext()));
  });

  void it("bounds owner-local correction retention and accounts it during coefficient generation", () => {
    let largest = 0;
    const context = createEvaluationContext({
      guardBigIntDigits(n) {
        largest = Math.max(largest, n);
      }
    });
    for (let i = 0; i < 12; i++) {
      const x = createRational(BigInt(1000 + i), 3n);
      gammaRealBallWithProfile({ lower: x, upper: x }, 12, 180, context.backend, context);
    }
    const snapshot = getStirlingCorrectionSnapshot(context);
    assert.equal(snapshot.entries, 8);
    assert.equal(snapshot.pending, 0);
    assert.ok(
      largest >=
        snapshot.retainedBigIntDigits + getBernoulliCacheSnapshot(context).retainedBigIntDigits
    );
    assert.equal(getStirlingCorrectionSnapshot(createEvaluationContext()).entries, 0);
  });

  void it("selects joint work estimates without turning them into a term ceiling", () => {
    for (const digits of [10, 100, 300, 1000, 3000, 10000]) {
      const plan = createGammaStirlingPlan(digits);
      assert.ok(Number.isFinite(plan.estimatedCost));
      assert.ok(plan.estimatedCorrectionTerms > 0);
      assert.equal(plan.maximumCorrectionTerms, null);
    }
    const constrained = createGammaStirlingPlan(300, {
      minimumCorrectionTerms: 257,
      minimumShiftTarget: 1000
    });
    assert.equal(constrained.shiftTarget, 1000);
    assert.ok(constrained.estimatedCorrectionTerms >= 257);
  });

  void it("keeps correction intervals valid for non-point inputs", () => {
    const context = createEvaluationContext();
    const lower = createRational(1000n, 1n),
      upper = createRational(1001n, 1n);
    const b = (i: number) => (i === 4 ? createRational(-1n, 30n) : createRational(1n, 42n));
    const result = recurrentStirlingCorrection({ lower, upper }, 8, 1, context, b, () => 0);
    for (const z of [lower, upper]) {
      const exact = divideRational(createRational(1n, 12n), z);
      assert.ok(compareRational(result.sum.lower, exact) <= 0);
      assert.ok(compareRational(result.sum.upper, exact) >= 0);
      const tail = divideRational(
        createRational(1n, 360n),
        multiplyRational(z, multiplyRational(z, z))
      );
      assert.ok(compareRational(result.remainder, tail) >= 0);
    }
  });
});
