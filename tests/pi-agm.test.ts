import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEvaluationContext,
  createEvaluationGraphFromSource,
  compareRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import {
  getPiRationalInterval,
  getChudnovskyPiRationalInterval,
  getPiProviderStateSnapshot,
  getPiComputationSnapshot,
  AGM_PI_THRESHOLD
} from "../src/core/math/constants.js";
import { AgmPiProvider } from "../src/core/math/pi-agm.js";
import { intervalToRoundedBall } from "../src/core/math/elementary.js";
import { ResourceLimitException } from "../src/core/errors/index.js";
import { enablePiInstrumentation, piInstrumentation } from "../src/core/math/pi-instrumentation.js";

void describe("AR-7 pi candidates", () => {
  void it("preserves Chudnovsky carry when paused between split-level merges", () => {
    const paused = new Error("pause");
    let afterThreeBlocks = 0,
      interrupt = true;
    const context = createEvaluationContext({
      checkpoint() {
        if (
          getPiProviderStateSnapshot(context).completedBlocks === 3 &&
          ++afterThreeBlocks === 11 &&
          interrupt
        )
          throw paused;
      }
    });
    assert.throws(
      () => getPiRationalInterval(context, 300),
      (e) => e === paused
    );
    interrupt = false;
    assert.deepEqual(
      getPiRationalInterval(context, 300),
      getPiRationalInterval(createEvaluationContext(), 300)
    );
  });
  void it("contains finer independent Chudnovsky bounds and preserves verified prefixes", () => {
    const context = createEvaluationContext(),
      agm = new AgmPiProvider();
    let prefix = "";
    for (const digits of [10, 30, 100, 300, 1000]) {
      const bounds = agm.getInterval(digits + 4, context);
      const finer = getChudnovskyPiRationalInterval(context, digits + 30);
      assert.ok(compareRational(bounds.lower, finer.lower) <= 0);
      assert.ok(compareRational(bounds.upper, finer.upper) >= 0);
      const value = verifiedNumberFromBall(
        intervalToRoundedBall(bounds, 4 * digits + 80, context.backend),
        { significantDigits: digits },
        context.backend
      );
      assert.ok(value.verifiedDigits >= digits);
      assert.ok(value.digits.startsWith(prefix));
      assert.ok(value.digits.startsWith("3141592653"));
      prefix = value.digits.slice(0, digits);
    }
    const before = agm.getSnapshot();
    agm.getInterval(300, context);
    assert.equal(agm.getSnapshot().iterations, before.iterations);
    assert.equal(agm.getSnapshot().cacheHits, before.cacheHits + 1);
  });
  void it("resumes roots and AGM iterations with short checkpoint budgets", () => {
    const paused = new Error("pause");
    let steps = 0,
      pauses = 0;
    const context = createEvaluationContext({
      checkpoint() {
        if (++steps > 4) throw paused;
      }
    });
    const agm = new AgmPiProvider();
    let result;
    for (let attempt = 0; attempt < 1000; attempt++) {
      steps = 0;
      try {
        result = agm.getInterval(300, context);
        break;
      } catch (error) {
        assert.equal(error, paused);
        pauses++;
      }
    }
    assert.ok(result !== undefined);
    assert.ok(pauses > 5);
    assert.deepEqual(result, new AgmPiProvider().getInterval(300, createEvaluationContext()));
    assert.equal(agm.getSnapshot().pending, false);
  });
  void it("preserves pending state on resource rejection and on a higher request", () => {
    const agm = new AgmPiProvider();
    let reject = true;
    const context = createEvaluationContext({
      guardBigIntDigits(n) {
        assert.ok(n >= agm.getSnapshot().retainedBigIntDigits);
        if (reject && agm.getSnapshot().iterations >= 2)
          throw new ResourceLimitException("memory", "AGM test");
      }
    });
    assert.throws(() => agm.getInterval(80, context), ResourceLimitException);
    assert.ok(agm.getSnapshot().pending);
    reject = false;
    assert.deepEqual(
      agm.getInterval(200, context),
      new AgmPiProvider().getInterval(200, createEvaluationContext())
    );
    assert.equal(agm.getSnapshot().passes, 2);
  });
  void it("counts kernel work and keeps independent provider state", () => {
    const context = createEvaluationContext();
    enablePiInstrumentation(context);
    const agm = new AgmPiProvider();
    agm.getInterval(100, context);
    const before = piInstrumentation(context);
    assert.ok((before.sqrtOperations ?? 0) > 1);
    assert.ok((before.largeMultiplications ?? 0) > 0);
    agm.getInterval(100, context);
    assert.deepEqual(piInstrumentation(context), before);
    assert.equal(new AgmPiProvider().getSnapshot().iterations, 0);
    assert.throws(() => agm.getInterval(0, context));
  });
  void it("increases the working scale when rounding dominates without changing the target", () => {
    const context = createEvaluationContext(),
      agm = new AgmPiProvider(4);
    const bounds = agm.getInterval(100, context);
    assert.ok(agm.getSnapshot().passes > 1);
    const reference = getChudnovskyPiRationalInterval(context, 130);
    assert.ok(compareRational(bounds.lower, reference.lower) <= 0);
    assert.ok(compareRational(bounds.upper, reference.upper) >= 0);
    assert.equal(agm.canServe(100), true);
    assert.equal(agm.canServe(101), false);
  });
  void it("routes high precision and preserves the public prefix across the strategy boundary", async () => {
    const created = createEvaluationGraphFromSource("π");
    assert.equal(created.ok, true);
    const low = await created.graph.refine({ significantDigits: AGM_PI_THRESHOLD - 20 });
    const lowDigits = verifiedNumberFromBall(
      low,
      { significantDigits: AGM_PI_THRESHOLD - 20 },
      created.context.backend
    ).digits;
    assert.equal(
      getPiComputationSnapshot(created.context).algorithm,
      "chudnovsky-binary-splitting"
    );
    const before = getPiProviderStateSnapshot(created.context);
    const high = await created.graph.refine({ significantDigits: AGM_PI_THRESHOLD });
    const highDigits = verifiedNumberFromBall(
      high,
      { significantDigits: AGM_PI_THRESHOLD },
      created.context.backend
    );
    assert.ok(highDigits.verifiedDigits >= AGM_PI_THRESHOLD);
    assert.ok(highDigits.digits.startsWith(lowDigits));
    assert.equal(getPiComputationSnapshot(created.context).algorithm, "gauss-legendre-agm");
    assert.equal(getPiProviderStateSnapshot(created.context).completedTerms, before.completedTerms);
    const steps = getPiComputationSnapshot(created.context).termCount;
    getPiRationalInterval(created.context, 100);
    assert.equal(getPiComputationSnapshot(created.context).termCount, steps);
    assert.ok(getPiComputationSnapshot(created.context).stateReuse > 0);
    assert.equal(getPiComputationSnapshot(createEvaluationContext()).termCount, 0);
  });
});
