import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEvaluationContext,
  createRational,
  compareRational,
  addRational,
  subtractRational,
  multiplyRational,
  verifiedNumberFromBall,
  createEvaluationGraphFromSource
} from "../src/core/index.js";
import type { EvaluationGraphContext } from "../src/core/index.js";
import {
  gammaRealBallWithProfile,
  rationalIntervalFromBall,
  lnPositiveInterval
} from "../src/core/math/elementary.js";
import {
  specialGammaInterval,
  getSpecialGammaSnapshot,
  supportsSpecialGamma
} from "../src/core/math/gamma-special.js";
import { spougeLogInterval, getSpougeSnapshot, planSpouge } from "../src/core/math/gamma-spouge.js";
import { GammaRoot } from "../src/core/math/gamma-root.js";
import { scaledIntervalToRationalBounds } from "../src/core/math/scaled-interval.js";
import { ResourceLimitException } from "../src/core/errors/index.js";
const point = (n: bigint, d = 1n) => {
  const x = createRational(n, d);
  return { lower: x, upper: x };
};
function compute(
  n: bigint,
  d: bigint,
  digits: number,
  algorithm: "special" | "spouge" | "stirling",
  context = createEvaluationContext()
) {
  const result = gammaRealBallWithProfile(
    point(n, d),
    digits + 12,
    4 * digits + 256,
    context.backend,
    context,
    { algorithm }
  );
  assert.ok(result.ball !== null);
  const verified = verifiedNumberFromBall(
    result.ball,
    { significantDigits: digits },
    context.backend
  );
  assert.ok(verified.verifiedDigits >= digits);
  return { ball: result.ball, verified, profile: result.profile };
}
void describe("AR-6 Gamma alternatives", () => {
  void it("certifies outward small-degree roots and resumes every Newton frontier", () => {
    for (const degree of [2, 4, 6])
      for (const [n, d] of [
        [0n, 1n],
        [1n, 1n],
        [2n, 3n],
        [9n, 4n],
        [10n ** 50n, 3n]
      ] as const) {
        const job = new GammaRoot(point(n, d), degree, 30),
          paused = new Error("pause");
        let steps = 0,
          result;
        for (let attempt = 0; attempt < 200; attempt++) {
          steps = 0;
          try {
            result = job.getInterval({
              checkpoint() {
                if (++steps > 3) throw paused;
              }
            });
            break;
          } catch (error) {
            assert.equal(error, paused);
          }
        }
        assert.ok(result !== undefined);
        assert.equal(job.complete, true);
        const bounds = scaledIntervalToRationalBounds(result);
        let lo = createRational(1n, 1n),
          hi = lo;
        for (let i = 0; i < degree; i++) {
          lo = multiplyRational(lo, bounds.lower);
          hi = multiplyRational(hi, bounds.upper);
        }
        assert.ok(compareRational(lo, createRational(n, d)) <= 0);
        assert.ok(compareRational(hi, createRational(n, d)) >= 0);
      }
  });
  void it("contains finer Stirling intervals for thirds, quarters, sixths and negative shifts", () => {
    for (const [n, d] of [
      [1n, 3n],
      [1n, 2n],
      [3n, 2n],
      [-3n, 2n],
      [4n, 3n],
      [2n, 3n],
      [1n, 4n],
      [3n, 4n],
      [1n, 6n],
      [5n, 6n],
      [-1n, 3n],
      [-7n, 4n],
      [-1n, 6n],
      [-95n, 3n],
      [95n, 3n],
      [31n, 6n]
    ] as const) {
      const context = createEvaluationContext();
      const bounds = specialGammaInterval(point(n, d), 25, context);
      assert.ok(bounds !== null);
      const reference = compute(n, d, 90, "stirling", context);
      const inside = rationalIntervalFromBall(reference.ball, 600, context.backend);
      assert.ok(
        compareRational(bounds.lower, inside.lower) <= 0,
        `${n.toString()}/${d.toString()} lower`
      );
      assert.ok(
        compareRational(bounds.upper, inside.upper) >= 0,
        `${n.toString()}/${d.toString()} upper`
      );
    }
  });
  void it("matches independent reference prefixes and preserves sequential precision", () => {
    const references = [
      [1n, 3n, "267893853470774763365569294097"],
      [1n, 4n, "362560990822190831193068515586"],
      [3n, 4n, "122541670246517764512909830336"]
    ] as const;
    for (const [n, d, reference] of references) {
      const context = createEvaluationContext();
      let previous = "";
      for (const digits of [10, 30, 100, 300, 1000]) {
        const value = compute(n, d, digits, "special", context).verified;
        assert.ok(value.digits.startsWith(previous));
        if (digits >= 30) assert.ok(value.digits.startsWith(reference));
        previous = value.digits.slice(0, digits);
      }
      assert.ok(getSpecialGammaSnapshot(context).entries <= 2);
      assert.equal(getSpecialGammaSnapshot(context).pending, 0);
    }
  });
  void it("certifies the Spouge parameter without a 256-term ceiling", () => {
    for (const digits of [1, 30, 100, 300, 1000, 10000]) {
      const plan = planSpouge(digits);
      assert.ok(6n ** BigInt(plan.a) >= 10n ** BigInt(digits + 12));
      assert.ok(compareRational(plan.error, createRational(1n, 10n ** BigInt(digits + 12))) <= 0);
    }
    assert.ok(planSpouge(300).a > 256);
    const context = createEvaluationContext();
    const result = compute(4n, 3n, 200, "spouge", context);
    assert.ok(getSpougeSnapshot(context).coefficients > 256);
    assert.equal(
      result.verified.digits.slice(0, 200),
      compute(4n, 3n, 200, "stirling").verified.digits.slice(0, 200)
    );
  });
  void it("contains exact factorial references with Spouge's approximation error included", () => {
    for (const n of [1n, 2n, 5n, 20n, 100n]) {
      let factorial = 1n;
      for (let k = 1n; k < n; k++) factorial *= k;
      const context = createEvaluationContext();
      // A nonzero-radius ball around an exact decimal boundary need not prove
      // its trailing zeros. Here the invariant is containment, not prefix length.
      const value = gammaRealBallWithProfile(point(n), 42, 400, context.backend, context, {
        algorithm: "spouge"
      });
      assert.ok(value.ball !== null);
      const bounds = rationalIntervalFromBall(value.ball, 500, context.backend),
        exact = createRational(factorial, 1n);
      assert.ok(compareRational(bounds.lower, exact) <= 0);
      assert.ok(compareRational(bounds.upper, exact) >= 0);
    }
  });
  void it("compares Spouge through positive, reflection, near-pole and large arguments", () => {
    for (const [n, d] of [
      [1n, 3n],
      [3n, 4n],
      [10n, 7n],
      [-1n, 3n],
      [-1000n, 7n],
      [1n, 10n ** 20n],
      [-1n, 10n ** 20n],
      [4001n, 4n]
    ] as const) {
      const a = compute(n, d, 35, "spouge"),
        b = compute(n, d, 35, "stirling");
      assert.equal(a.verified.sign, b.verified.sign);
      assert.equal(a.verified.exponent10, b.verified.exponent10);
      assert.equal(a.verified.digits.slice(0, 35), b.verified.digits.slice(0, 35));
      if (n < 0n) assert.equal(a.profile.usedReflection, true);
    }
    const context = createEvaluationContext();
    const pole = gammaRealBallWithProfile(point(-2n), 40, 240, context.backend, context, {
      algorithm: "spouge"
    });
    assert.equal(pole.ball, null);
    const wide = spougeLogInterval(
      { lower: createRational(1n, 4n), upper: createRational(3n, 1n) },
      30,
      context
    );
    assert.equal(wide, null);
  });
  void it("retains special series and algebraic-root work over small checkpoint budgets", () => {
    const paused = new Error("pause");
    let steps = 0,
      pauses = 0;
    const context = createEvaluationContext({
      checkpoint() {
        if (++steps > 20) throw paused;
      }
    });
    let result;
    for (let attempt = 0; attempt < 1000; attempt++) {
      steps = 0;
      try {
        result = specialGammaInterval(point(1n, 6n), 100, context);
        break;
      } catch (error) {
        assert.equal(error, paused);
        pauses++;
      }
    }
    assert.ok(pauses > 2);
    assert.ok(result !== undefined && result !== null);
    assert.deepEqual(result, specialGammaInterval(point(1n, 6n), 100, createEvaluationContext()));
    assert.equal(getSpecialGammaSnapshot(context).pendingRoots, 0);
  });
  void it("encloses a non-point positive argument with Spouge", () => {
    const context = createEvaluationContext();
    const x = createRational(1n, 3n),
      epsilon = createRational(1n, 10n ** 25n);
    const input = { lower: subtractRational(x, epsilon), upper: addRational(x, epsilon) };
    const enclosure = spougeLogInterval(input, 40, context);
    assert.ok(enclosure !== null);
    for (const endpoint of [input.lower, input.upper]) {
      const ball = compute(endpoint.numerator, endpoint.denominator, 90, "stirling", context).ball;
      const reference = lnPositiveInterval(
        rationalIntervalFromBall(ball, 600, context.backend),
        90,
        context
      );
      assert.ok(compareRational(enclosure.lower, reference.lower) <= 0);
      assert.ok(compareRational(enclosure.upper, reference.upper) >= 0);
    }
  });
  void it("retains Spouge coefficients and sums across pauses and shares them within one owner", () => {
    const paused = new Error("pause");
    let steps = 0,
      pauses = 0;
    const context = createEvaluationContext({
      checkpoint() {
        if (++steps > 30) throw paused;
      }
    });
    let result;
    for (let attempt = 0; attempt < 2000; attempt++) {
      steps = 0;
      try {
        result = spougeLogInterval(point(4n, 3n), 35, context);
        break;
      } catch (error) {
        assert.equal(error, paused);
        pauses++;
      }
    }
    assert.ok(pauses > 2);
    assert.ok(result !== undefined && result !== null);
    const cold = spougeLogInterval(point(4n, 3n), 35, createEvaluationContext());
    assert.ok(cold !== null);
    const referenceContext = createEvaluationContext();
    const referenceBall = compute(4n, 3n, 90, "stirling", referenceContext).ball;
    const reference = lnPositiveInterval(
      rationalIntervalFromBall(referenceBall, 600, referenceContext.backend),
      90,
      referenceContext
    );
    // Shared logarithm providers may refine during retries, tightening bounds.
    // Both executions must contain the independent, finer Stirling enclosure.
    for (const enclosure of [result, cold]) {
      assert.ok(compareRational(enclosure.lower, reference.lower) <= 0);
      assert.ok(compareRational(enclosure.upper, reference.upper) >= 0);
    }
    steps = -1000000;
    const before = getSpougeSnapshot(context);
    spougeLogInterval(point(5n, 3n), 35, context);
    assert.equal(getSpougeSnapshot(context).coefficients, before.coefficients);
    assert.equal(getSpougeSnapshot(createEvaluationContext()).tables, 0);
    for (const digits of [40, 45, 50]) spougeLogInterval(point(4n, 3n), digits, context);
    assert.equal(getSpougeSnapshot(context).tables, 2);
  });
  void it("guards pending state and resumes after a typed resource rejection", () => {
    for (const algorithm of ["special", "spouge"] as const) {
      let reject = true;
      const context: EvaluationGraphContext = createEvaluationContext({
        guardBigIntDigits() {
          const terms =
            algorithm === "special"
              ? getSpecialGammaSnapshot(context).terms
              : getSpougeSnapshot(context).terms;
          if (reject && terms >= 3)
            throw new ResourceLimitException("memory", "Test Gamma allocation");
        }
      });
      const run = () =>
        algorithm === "special"
          ? specialGammaInterval(point(4n, 3n), 40, context)
          : spougeLogInterval(point(4n, 3n), 40, context);
      assert.throws(run, ResourceLimitException);
      reject = false;
      assert.ok(run() !== null);
    }
  });
  void it("does not apply rational formulas to uncertain inputs or huge recurrence distances", () => {
    assert.equal(
      supportsSpecialGamma({ lower: createRational(1n, 3n), upper: createRational(2n, 3n) }),
      false
    );
    assert.equal(supportsSpecialGamma(point(1000001n, 3n)), false);
    assert.equal(supportsSpecialGamma(point(10n, 7n)), false);
  });
  void it("preserves relative accuracy through a tiny negative-shift result", () => {
    const context = createEvaluationContext();
    const value = gammaRealBallWithProfile(point(-95n, 3n), 30, 400, context.backend, context, {
      algorithm: "special"
    });
    assert.ok(value.ball !== null);
    assert.ok(
      verifiedNumberFromBall(value.ball, { significantDigits: 30 }, context.backend)
        .verifiedDigits >= 30
    );
  });
  void it("preserves exact integer factorial and near-pole public semantics", async () => {
    for (const source of ["20!", "(-1+1/1000000000000)!"]) {
      const created = createEvaluationGraphFromSource(source, {
        settings: { factorialMode: "gamma" }
      });
      assert.equal(created.ok, true);
      const ball = await created.graph.refine({ significantDigits: 20 });
      assert.ok(
        verifiedNumberFromBall(ball, { significantDigits: 20 }, created.context.backend)
          .verifiedDigits >= 20
      );
    }
  });
  void it("routes public small rational factorials to special formulas", async () => {
    for (const source of ["(1/3)!", "(-4/3)!", "(-3/4)!", "(-1/4)!"]) {
      const created = createEvaluationGraphFromSource(source, {
        settings: { factorialMode: "gamma" }
      });
      assert.equal(created.ok, true);
      let previous = "";
      for (const digits of [10, 30, 100]) {
        const ball = await created.graph.refine({ significantDigits: digits });
        const verified = verifiedNumberFromBall(
          ball,
          { significantDigits: digits },
          created.context.backend
        );
        assert.ok(verified.verifiedDigits >= digits);
        assert.ok(verified.digits.startsWith(previous));
        previous = verified.digits.slice(0, digits);
      }
      assert.ok(getSpecialGammaSnapshot(created.context).entries > 0);
      assert.equal(getSpougeSnapshot(created.context).tables, 0);
    }
  });
  void it("resumes the bounded exact recurrence with budgets shorter than its shift", () => {
    const paused = new Error("pause");
    let steps = 0;
    const context = createEvaluationContext({
      checkpoint() {
        if (++steps > 10) throw paused;
      }
    });
    let result;
    for (let attempt = 0; attempt < 1000; attempt++) {
      steps = 0;
      try {
        result = specialGammaInterval(point(95n, 3n), 40, context);
        break;
      } catch (error) {
        assert.equal(error, paused);
      }
    }
    assert.ok(result !== undefined && result !== null);
    assert.deepEqual(result, specialGammaInterval(point(95n, 3n), 40, createEvaluationContext()));
    assert.equal(getSpecialGammaSnapshot(createEvaluationContext()).entries, 0);
  });
});
