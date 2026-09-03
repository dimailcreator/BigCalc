import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCalculationHandle,
  createCalculationHandleFromSource,
  createLazyRealNode,
  createRational,
  integerRational,
  precisionBitsForRequest,
  rationalToBall
} from "../src/core/index.js";
import type { EvaluationContext, EvaluationGraphContext, LazyReal } from "../src/core/index.js";

void describe("calculation lifecycle and soft timeout", () => {
  void it("pauses on soft timeout and preserves a previously verified partial result", async () => {
    let ticks = 0;
    let advance = false;
    const now = () => (advance ? ticks++ : ticks);
    const created = createCalculationHandleFromSource("π", {
      settings: { maxCalculationTimeMs: 3 },
      now
    });
    assert.equal(created.ok, true);

    const first = await created.handle.refine({ significantDigits: 10 });
    assert.equal(first.status, "complete");

    ticks = 0;
    advance = true;
    const paused = await created.handle.refine({ significantDigits: 1000 });

    assert.equal(paused.status, "paused");
    assert.equal(paused.reason, "time-limit");
    assert.equal(paused.requestedDigits, 1000);
    assert.notEqual(paused.partial, null);
    assert.equal(paused.verifiedDigits >= 10, true);
  });

  void it("continues paused calculations with a fresh budget and the same lazy state", async () => {
    let ticks = 0;
    const now = () => ticks++;
    const lazy = new StepwiseLazyReal(5);
    const handle = createCalculationHandle(createLazyRealNode(lazy), {
      settings: { maxCalculationTimeMs: 3 },
      now
    });

    const first = await handle.refine({ significantDigits: 8 });
    assert.equal(first.status, "paused");
    assert.equal(lazy.progress, 2);

    ticks = 0;
    const second = await handle.continue();
    assert.equal(second.status, "paused");
    assert.equal(lazy.progress, 4);

    ticks = 0;
    const completed = await handle.continue();
    assert.equal(completed.status, "complete");
    assert.equal(lazy.progress, 5);
    assert.equal(lazy.calls, 3);
  });

  void it("cancels a running calculation cooperatively", async () => {
    const lazy = new AsyncCheckpointLazyReal();
    const handle = createCalculationHandle(createLazyRealNode(lazy));

    const running = handle.refine({ significantDigits: 8 });
    handle.cancel();

    const result = await running;
    assert.equal(result.status, "cancelled");
    assert.equal(result.partial, null);
    assert.equal(lazy.calls, 1);
  });

  void it("cancels a paused calculation and refuses to continue it", async () => {
    let ticks = 0;
    const lazy = new StepwiseLazyReal(10);
    const handle = createCalculationHandle(createLazyRealNode(lazy), {
      settings: { maxCalculationTimeMs: 2 },
      now: () => ticks++
    });

    const paused = await handle.refine({ significantDigits: 8 });
    assert.equal(paused.status, "paused");

    handle.cancel();
    const continued = await handle.continue();

    assert.equal(continued.status, "cancelled");
    assert.equal(continued.requestedDigits, 8);
  });

  void it("returns typed failed results for calculation errors", async () => {
    const created = createCalculationHandleFromSource("ln(-1)");
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 10 });

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "DomainError");
  });
});

class StepwiseLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  calls = 0;
  progress = 0;

  constructor(private readonly targetSteps: number) {}

  refine(request: { readonly significantDigits: number }, context: EvaluationContext) {
    const graphContext = context as EvaluationGraphContext;
    this.calls += 1;

    while (this.progress < this.targetSteps) {
      this.progress += 1;
      graphContext.checkpoint();
    }

    return Promise.resolve(
      rationalToBall(
        createRational(314159265358979n, 100000000000000n),
        precisionBitsForRequest(request),
        graphContext.backend
      )
    );
  }
}

class AsyncCheckpointLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  calls = 0;

  async refine(request: { readonly significantDigits: number }, context: EvaluationContext) {
    const graphContext = context as EvaluationGraphContext;
    this.calls += 1;

    await Promise.resolve();
    graphContext.checkpoint();

    return rationalToBall(
      integerRational(1n),
      precisionBitsForRequest(request),
      graphContext.backend
    );
  }
}
