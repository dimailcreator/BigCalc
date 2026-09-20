import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRational,
  createEvaluationContext,
  createCalculationHandleFromSource,
  createEvaluationGraphFromSource,
  createLazyRealNode,
  createCalculationHandle,
  compareRational,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall
} from "../src/core/index.js";
import { ExpKernel } from "../src/core/math/exp-kernel.js";
import { BitBurstExpKernel } from "../src/core/math/exp-bit-burst.js";
import { routedSmallExp, getExpCacheSnapshot } from "../src/core/math/exp-router.js";
import {
  expSmallNonNegativeScaledInterval,
  expIntervalBallWithProfile
} from "../src/core/math/elementary.js";
import { scaledIntervalToRationalBounds } from "../src/core/math/scaled-interval.js";
import type { ScaledInterval } from "../src/core/math/scaled-interval.js";
import type { EvaluationGraphContext } from "../src/core/index.js";

const synchronous = {
  checkpoint() {
    /* No timeout in direct kernel comparisons. */
  }
};

function contains(outer: ScaledInterval, inner: ScaledInterval) {
  const a = scaledIntervalToRationalBounds(outer),
    b = scaledIntervalToRationalBounds(inner);
  assert.ok(compareRational(a.lower, b.lower) <= 0);
  assert.ok(compareRational(a.upper, b.upper) >= 0);
}
function prefix(result: ScaledInterval, digits: number) {
  const bounds = scaledIntervalToRationalBounds(result),
    { backend } = createEvaluationContext(),
    bits = 4 * digits + 128;
  const verified = verifiedNumberFromBall(
    intervalToBall(
      createInternalInterval(
        backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
        backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
        backend
      ),
      bits,
      backend
    ),
    { significantDigits: digits },
    backend
  );
  assert.ok(verified.verifiedDigits >= digits);
  return verified.digits;
}
void describe("AR-3 small exp replacement", () => {
  void it("contains the unreduced reference and preserves prefixes through 10000 digits", () => {
    const value = createRational(1n, 1n),
      control = createEvaluationContext();
    const kernels = [
      new ExpKernel(value, "rectangular"),
      new ExpKernel(value, "binary"),
      new BitBurstExpKernel(value)
    ];
    const previous = ["", "", ""];
    for (const digits of [100, 300, 1000, 3000, 10000]) {
      const reference = expSmallNonNegativeScaledInterval(value, digits + 30, control);
      kernels.forEach((kernel, i) => {
        const result = kernel.getInterval(digits + 10, control);
        contains(result, reference);
        const text = prefix(result, digits);
        assert.ok(text.startsWith(previous[i] ?? ""));
        previous[i] = text;
        assert.equal(text, prefix(reference, digits));
      });
    }
  });
  void it("covers zero, tiny arguments, boundaries and deterministic rational samples", () => {
    const control = createEvaluationContext();
    const zero = new ExpKernel(createRational(0n, 1n));
    const exact = zero.getInterval(100, control);
    assert.equal(exact.lower, exact.upper);
    assert.equal(exact.lower, 10n ** 100n);
    assert.equal(zero.getSnapshot().termCount, 0);
    const values = [createRational(0n, 1n), createRational(2n, 1n), createRational(1n, 10n ** 50n)];
    for (let i = 1; i <= 24; i++) values.push(createRational(BigInt((i * 37) % 200), 100n));
    for (const value of values)
      for (const digits of [1, 3, 100]) {
        const reference = expSmallNonNegativeScaledInterval(value, digits + 30, control);
        for (const layout of ["sequential", "rectangular", "binary"] as const)
          for (const s of [1, 7, 32])
            contains(new ExpKernel(value, layout, s).getInterval(digits, control), reference);
        contains(new BitBurstExpKernel(value).getInterval(digits, control), reference);
      }
  });
  void it("retains block and reconstruction work at checkpoints", () => {
    for (const phase of ["sum", "square"]) {
      const kernel = new ExpKernel(createRational(1n, 1n), "binary"),
        stop = new Error("pause");
      let paused = false;
      const control = {
        checkpoint() {
          const s = kernel.getSnapshot();
          if (
            !paused &&
            s.pendingPhase === phase &&
            (phase === "square" ? s.squaringCount >= 2 : s.termCount >= 3)
          ) {
            paused = true;
            throw stop;
          }
        }
      };
      assert.throws(
        () => kernel.getInterval(300, control),
        (e) => e === stop
      );
      const snapshot = kernel.getSnapshot();
      assert.equal(snapshot.passes, 1);
      const result = kernel.getInterval(300, control);
      assert.equal(kernel.getSnapshot().passes, 1);
      const fresh = new ExpKernel(kernel.argument, "binary");
      assert.deepEqual(result, fresh.getInterval(300, synchronous));
      assert.equal(kernel.getSnapshot().termCount, fresh.getSnapshot().termCount);
      assert.equal(kernel.getSnapshot().squaringCount, fresh.getSnapshot().squaringCount);
    }
  });
  void it("finishes suspended requests before larger precision and retains cache ownership", () => {
    const stop = new Error("pause");
    let calls = 0,
      enabled = true;
    const control = {
      checkpoint() {
        if (enabled && ++calls === 40) throw stop;
      }
    };
    const value = createRational(1n, 1n);
    assert.throws(
      () => routedSmallExp(value, 300, control),
      (e) => e === stop
    );
    assert.equal(getExpCacheSnapshot(control).pending, 1);
    enabled = false;
    routedSmallExp(value, 500, control);
    assert.equal(getExpCacheSnapshot(control).pending, 0);
    for (let i = 1; i < 15; i++) routedSmallExp(createRational(BigInt(i), 10n), 20, control);
    assert.ok(getExpCacheSnapshot(control).entries <= 8);
    assert.equal(getExpCacheSnapshot(synchronous).entries, 0);
  });
  void it("honors typed timeout and cancellation inside summation and squaring", async () => {
    for (const phase of ["sum", "square"])
      for (const cancel of [false, true]) {
        const kernel = new ExpKernel(createRational(1n, 1n), "binary");
        let clock = 0,
          stop = true;
        const node = createLazyRealNode({
          kind: "lazy-real",
          refine(request, context) {
            const control = context as EvaluationGraphContext;
            const bounds = scaledIntervalToRationalBounds(
              kernel.getInterval(request.significantDigits + 10, control)
            );
            const bits = request.significantDigits * 4 + 128;
            return Promise.resolve(
              intervalToBall(
                createInternalInterval(
                  control.backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
                  control.backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
                  control.backend
                ),
                bits,
                control.backend
              )
            );
          }
        });
        const handle = createCalculationHandle(node, {
          now: () => clock,
          settings: { maxCalculationTimeMs: 10 },
          checkpoint() {
            const state = kernel.getSnapshot();
            if (
              stop &&
              state.pendingPhase === phase &&
              (phase === "sum" ? state.termCount >= 3 : state.squaringCount >= 2)
            ) {
              stop = false;
              if (cancel) handle.cancel();
              else clock = 10;
            }
          }
        });
        assert.equal(
          (await handle.refine({ significantDigits: 300 })).status,
          cancel ? "cancelled" : "paused"
        );
        assert.equal(kernel.pending, true);
        clock = 0;
        assert.equal((await handle.continue()).status, cancel ? "cancelled" : "complete");
        assert.equal(kernel.getSnapshot().passes, 1);
      }
  });
  void it("retains bit-burst chunk work across pauses", () => {
    const value = createRational(123456789n, 100000000n),
      kernel = new BitBurstExpKernel(value),
      stop = new Error("pause");
    let calls = 0;
    assert.throws(
      () =>
        kernel.getInterval(300, {
          checkpoint() {
            if (++calls === 80) throw stop;
          }
        }),
      (e) => e === stop
    );
    const result = kernel.getInterval(300, synchronous),
      fresh = new BitBurstExpKernel(value);
    assert.deepEqual(result, fresh.getInterval(300, synchronous));
    assert.equal(kernel.getSnapshot().termCount, fresh.getSnapshot().termCount);
  });
  void it("accounts completed cache storage separately from live blocks", () => {
    const control = {
      checkpoint() {
        /* Synchronous resource regression. */
      },
      guardBigIntDigits(estimate: number) {
        assert.ok(estimate <= 5000);
      }
    };
    for (let i = 1; i <= 8; i++) routedSmallExp(createRational(BigInt(i), 10n), 40, control);
    assert.equal(getExpCacheSnapshot(control).entries, 8);
    for (const state of getExpCacheSnapshot(control).states)
      assert.ok(state.estimatedRetainedBigIntDigits < 500);
    const kernel = new ExpKernel(createRational(1n, 1n), "binary");
    const stop = new Error("hard resource");
    assert.throws(
      () =>
        kernel.getInterval(1000, {
          checkpoint() {
            /* Guard must run before allocation. */
          },
          guardBigIntDigits() {
            throw stop;
          }
        }),
      (e) => e === stop
    );
    assert.equal(kernel.getSnapshot().passes, 0);
    const denominator = 10n ** 1000n;
    const wideInput = new ExpKernel(createRational(denominator + 1n, denominator), "sequential");
    assert.throws(
      () =>
        wideInput.getInterval(10, {
          ...synchronous,
          guardBigIntDigits(estimate) {
            if (estimate > 3000) throw stop;
          }
        }),
      (e) => e === stop
    );
    assert.equal(wideInput.getSnapshot().passes, 0);
  });
  void it("keeps compact exponents and monotone interval endpoints for large signed inputs", () => {
    const context = createEvaluationContext();
    for (const n of [0n, 1n, -1n, 1024n, -1024n, 1000000n, -1000000n]) {
      const argument = createRational(n, 1n);
      const result = expIntervalBallWithProfile(
        { lower: argument, upper: argument },
        150,
        650,
        context.backend,
        context
      );
      assert.ok(result.ball !== null && result.profile !== null);
      assert.ok(result.profile.resultSignificandBits <= 650);
      assert.ok(result.profile.mantissaPeakDecimalDigits < 170);
      const lo = createRational(n * 10000n - 1n, 10000n),
        hi = createRational(n * 10000n + 1n, 10000n);
      const hull = expIntervalBallWithProfile(
        { lower: lo, upper: hi },
        150,
        650,
        context.backend,
        context
      );
      assert.ok(hull.ball !== null);
      const b = context.backend;
      const hullLo = b.sub(hull.ball.center, hull.ball.radius, 650, "towardNegativeInfinity");
      const hullHi = b.add(hull.ball.center, hull.ball.radius, 650, "towardPositiveInfinity");
      assert.ok(b.compare(hullLo, result.ball.center) <= 0);
      assert.ok(b.compare(hullHi, result.ball.center) >= 0);
    }
  });
  void it("checks production values against the independent shared e constant", async () => {
    const exp = createEvaluationGraphFromSource("exp(1)"),
      e = createEvaluationGraphFromSource("e");
    assert.ok(exp.ok && e.ok);
    for (const significantDigits of [100, 300, 1000]) {
      const a = verifiedNumberFromBall(
        await exp.graph.refine({ significantDigits }),
        { significantDigits },
        exp.context.backend
      );
      const b = verifiedNumberFromBall(
        await e.graph.refine({ significantDigits }),
        { significantDigits },
        e.context.backend
      );
      assert.equal(a.digits, b.digits);
    }
  });
  void it("supports handle pause/continue/cancel and separates hard resources", async () => {
    let clock = 0;
    const created = createCalculationHandleFromSource("exp(1)", {
      now: () => clock++,
      settings: { maxCalculationTimeMs: 150 }
    });
    assert.ok(created.ok);
    let result = await created.handle.refine({ significantDigits: 1000 });
    assert.equal(result.status, "paused");
    for (let i = 0; i < 1000 && result.status === "paused"; i++)
      result = await created.handle.continue();
    assert.equal(result.status, "complete");
    const cancelled = createCalculationHandleFromSource("exp(1)", {
      now: () => clock++,
      settings: { maxCalculationTimeMs: 2 }
    });
    assert.ok(cancelled.ok);
    assert.equal((await cancelled.handle.refine({ significantDigits: 1000 })).status, "paused");
    cancelled.handle.cancel();
    assert.equal((await cancelled.handle.continue()).status, "cancelled");
    const hard = createCalculationHandleFromSource("exp(1)", {
      resourceLimits: { maxEstimatedBigIntDigits: 3000 }
    });
    assert.ok(hard.ok);
    const failure = await hard.handle.refine({ significantDigits: 1000 });
    assert.equal(failure.status, "failed");
    assert.equal(failure.error.code, "ResourceLimitError");
  });
});
