import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCalculationHandle,
  createCalculationHandleFromSource,
  createLazyRealNode,
  createRational,
  precisionBitsForRequest,
  rationalToBall
} from "../src/core/index.js";
import type { EvaluationContext, EvaluationGraphContext, LazyReal } from "../src/core/index.js";

void describe("hard resource safety", () => {
  void it("fails with ResourceLimitError when the hard checkpoint watchdog is reached", async () => {
    const lazy = new LongCheckpointLazyReal(10);
    const handle = createCalculationHandle(createLazyRealNode(lazy), {
      now: () => 0,
      settings: { maxCalculationTimeMs: 1000 },
      resourceLimits: { maxCheckpointsPerRun: 2 }
    });

    const result = await handle.refine({ significantDigits: 8 });

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
    assert.equal(result.error.resource, "hard-watchdog");
    assert.equal(lazy.calls, 1);
  });

  void it("makes hard resource failures non-continuable", async () => {
    const handle = createCalculationHandle(createLazyRealNode(new LongCheckpointLazyReal(10)), {
      now: () => 0,
      settings: { maxCalculationTimeMs: 1000 },
      resourceLimits: { maxCheckpointsPerRun: 2 }
    });

    const failed = await handle.refine({ significantDigits: 8 });
    assert.equal(failed.status, "failed");

    const continued = await handle.continue();

    assert.equal(continued.status, "failed");
    assert.equal(continued.error.code, "ResourceLimitError");
  });

  void it("uses requested digits as a hard size guard before expensive refinement", async () => {
    const lazy = new LongCheckpointLazyReal(1);
    const handle = createCalculationHandle(createLazyRealNode(lazy), {
      now: () => 0,
      settings: { maxCalculationTimeMs: 1000 },
      resourceLimits: { maxRequestedDigits: 5 }
    });

    const result = await handle.refine({ significantDigits: 6 });

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
    assert.equal(result.error.resource, "memory");
    assert.equal(lazy.calls, 0);
  });

  void it("does not mask hard resource errors as domain errors", async () => {
    const created = createCalculationHandleFromSource("ln(-1)", {
      resourceLimits: { maxRequestedDigits: 5 }
    });
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 6 });

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "ResourceLimitError");
  });

  void it("keeps soft timeout continuable when hard limits are not reached", async () => {
    let ticks = 0;
    const lazy = new LongCheckpointLazyReal(2);
    const handle = createCalculationHandle(createLazyRealNode(lazy), {
      now: () => ticks++,
      settings: { maxCalculationTimeMs: 2 },
      resourceLimits: { maxCheckpointsPerRun: 100 }
    });

    const paused = await handle.refine({ significantDigits: 8 });
    assert.equal(paused.status, "paused");

    ticks = 0;
    const second = await handle.continue();
    assert.equal(second.status, "paused");

    ticks = 0;
    const completed = await handle.continue();
    assert.equal(completed.status, "complete");
  });
});

class LongCheckpointLazyReal implements LazyReal {
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
        createRational(2718281828459045n, 1000000000000000n),
        precisionBitsForRequest(request),
        graphContext.backend
      )
    );
  }
}
