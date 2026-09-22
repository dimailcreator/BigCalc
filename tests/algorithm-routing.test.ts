import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEvaluationContext,
  createCalculationHandleFromSource,
  createRational,
  compareRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import { FactorialEProvider } from "../src/core/math/e-factorial.js";
import {
  selectSeriesLayout,
  selectLogLayout,
  selectEStrategy,
  selectPiStrategy,
  getAlgorithmRoutingSnapshot
} from "../src/core/math/algorithm-strategy.js";
import { routedSmallExp } from "../src/core/math/exp-router.js";
import { routedSmallSinCos } from "../src/core/math/sincos-router.js";
import { routedReducedLog, ReducedLogProvider } from "../src/core/math/log-router.js";
import { AtanhLogKernel } from "../src/core/math/atanh-blocks.js";
import { ExpKernel } from "../src/core/math/exp-kernel.js";
import { intervalToRoundedBall } from "../src/core/math/elementary.js";
import { scaledIntervalToRationalBounds } from "../src/core/math/scaled-interval.js";
import type { RationalBounds } from "../src/core/math/scaled-interval.js";

function prefix(bounds: RationalBounds, digits: number): string {
  const { backend } = createEvaluationContext();
  const value = verifiedNumberFromBall(
    intervalToRoundedBall(bounds, 4 * digits + 80, backend),
    { significantDigits: digits },
    backend
  );
  assert.ok(value.verifiedDigits >= digits);
  return value.digits.slice(0, digits);
}

void describe("AR-9 algorithm routing", () => {
  void it("counts the retained log family when guarding a strategy switch", () => {
    const argument = createRational(3n, 2n),
      provider = new ReducedLogProvider(argument);
    provider.getInterval(140, createEvaluationContext());
    const retained = provider.retainedDigitsUpperBound,
      denied = new Error("capture guard");
    let estimate = 0;
    const control = {
      checkpoint() {
        // This test interrupts allocation through the resource guard instead.
      },
      guardBigIntDigits(value: number) {
        estimate = value;
        throw denied;
      }
    };
    assert.throws(
      () => new AtanhLogKernel(argument, "binary").getInterval(4100, control),
      (e: unknown) => e === denied
    );
    const standalone = estimate;
    assert.throws(
      () => provider.getInterval(4100, control),
      (e: unknown) => e === denied
    );
    assert.ok(estimate >= standalone + retained);
  });
  void it("uses measured boundaries without introducing a precision ceiling", () => {
    assert.deepEqual([127, 128, 4095, 4096, 1000000].map(selectSeriesLayout), [
      "sequential",
      "rectangular",
      "rectangular",
      "binary",
      "binary"
    ]);
    assert.equal(
      selectLogLayout(10000, createRational(10n ** 1000n + 1n, 10n ** 1000n)),
      "sequential"
    );
    assert.equal(selectLogLayout(10000, createRational(3n, 2n)), "binary");
    assert.equal(selectEStrategy(999), "sequential");
    assert.equal(selectEStrategy(1000), "binary");
    assert.equal(selectEStrategy(10, true), "binary");
    assert.equal(selectPiStrategy(2999), "chudnovsky");
    assert.equal(selectPiStrategy(3000), "agm");
    assert.equal(selectPiStrategy(10, true), "agm");
  });

  void it("preserves the exact e prefix and contains independent exp bounds across switching", () => {
    const provider = new FactorialEProvider(),
      context = createEvaluationContext();
    let previous = "",
      previousTerms = 0;
    for (const digits of [30, 999, 1000, 3000]) {
      const bounds = provider.getInterval(digits + 8, context);
      const reference = scaledIntervalToRationalBounds(
        new ExpKernel(createRational(1n, 1n)).getInterval(digits + 35, context)
      );
      assert.ok(compareRational(bounds.lower, reference.lower) <= 0);
      assert.ok(compareRational(bounds.upper, reference.upper) >= 0);
      const text = prefix(bounds, digits);
      assert.ok(text.startsWith(previous));
      assert.ok(provider.completedTerms >= previousTerms);
      previousTerms = provider.completedTerms;
      previous = text;
    }
    const before = provider.getSnapshot();
    provider.getInterval(50, context);
    assert.equal(provider.completedTerms, previousTerms);
    assert.equal(provider.getSnapshot().blockCount, before.blockCount);
    assert.equal(getAlgorithmRoutingSnapshot(context).find((s) => s.operation === "e")?.changes, 1);
    assert.equal(new FactorialEProvider().completedTerms, 0);
  });

  void it("resumes a binary e tree after precision upgrades and guard rejection", () => {
    const provider = new FactorialEProvider(),
      pause = new Error("pause"),
      denied = new Error("guard");
    let remaining = 7,
      reject = false;
    const control = {
      checkpoint() {
        if (--remaining === 0) throw pause;
      },
      guardBigIntDigits() {
        if (reject) throw denied;
      }
    };
    assert.throws(
      () => provider.getInterval(1000, control),
      (e: unknown) => e === pause
    );
    assert.equal(provider.getSnapshot().pending, true);
    const before = provider.getSnapshot();
    reject = true;
    assert.throws(
      () => provider.getInterval(1200, control),
      (e: unknown) => e === denied
    );
    assert.deepEqual(provider.getSnapshot(), before);
    reject = false;
    let result: RationalBounds | undefined;
    for (let attempt = 0; attempt < 5000 && result === undefined; attempt++) {
      remaining = 13;
      try {
        result = provider.getInterval(1200, control);
      } catch (error) {
        assert.equal(error, pause);
      }
    }
    assert.ok(result !== undefined);
    assert.equal(
      prefix(result, 1190),
      prefix(new FactorialEProvider().getInterval(1200, createEvaluationContext()), 1190)
    );
    assert.equal(provider.getSnapshot().pending, false);
  });

  void it("observes real log/exp/sincos route changes with monotonic verified prefixes", () => {
    const context = createEvaluationContext(),
      x = createRational(1n, 10n);
    const previous = ["", "", ""];
    for (const digits of [120, 140, 4100]) {
      const sin = routedSmallSinCos(x, digits, "sin", context).sin;
      assert.ok(sin !== null);
      const results = [
        routedReducedLog(createRational(3n, 2n), digits, context),
        scaledIntervalToRationalBounds(routedSmallExp(x, digits, context)),
        scaledIntervalToRationalBounds(sin)
      ];
      for (const [index, bounds] of results.entries()) {
        const text = prefix(bounds, digits - 12);
        assert.ok(text.startsWith(previous[index] ?? ""));
        previous[index] = text;
      }
    }
    const snapshot = getAlgorithmRoutingSnapshot(context);
    assert.equal(snapshot.length, 3);
    for (const selection of snapshot) {
      assert.equal(selection.strategy, "binary");
      assert.equal(selection.changes, 2);
    }
    assert.deepEqual(getAlgorithmRoutingSnapshot(createEvaluationContext()), []);
  });

  void it("preserves public e pause/continue, cancellation and hard resource separation", async () => {
    let ticking = false,
      ticks = 0;
    const created = createCalculationHandleFromSource("e", {
      settings: { maxCalculationTimeMs: 15 },
      now: () => (ticking ? ticks++ : ticks)
    });
    assert.ok(created.ok);
    const first = await created.handle.refine({ significantDigits: 30 });
    assert.equal(first.status, "complete");
    ticking = true;
    const paused = await created.handle.refine({ significantDigits: 1200 });
    assert.equal(paused.status, "paused");
    assert.ok(paused.verifiedDigits >= 30);
    ticking = false;
    const completed = await created.handle.continue();
    assert.equal(completed.status, "complete");
    ticking = true;
    assert.equal((await created.handle.refine({ significantDigits: 2000 })).status, "paused");
    created.handle.cancel();
    assert.equal((await created.handle.continue()).status, "cancelled");
    const limited = createCalculationHandleFromSource("e", {
      resourceLimits: { maxEstimatedBigIntDigits: 1000 },
      now: () => 0
    });
    assert.ok(limited.ok);
    const failed = await limited.handle.refine({ significantDigits: 1200 });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.code, "ResourceLimitError");
  });
});
