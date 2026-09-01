import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvaluationContext, EvaluationGraphContext, LazyReal } from "../src/core/index.js";
import {
  createAddNode,
  createEvaluationContext,
  createEvaluationGraph,
  createLazyRealNode,
  createRationalNode,
  createRegistry,
  integerRational,
  nodeToLazyReal,
  precisionBitsForRequest,
  rationalToBall
} from "../src/core/index.js";

void describe("evaluation graph lazy state", () => {
  void it("continues repeated refinement of one graph node instead of restarting", async () => {
    let checkpoints = 0;
    const context = createEvaluationContext({
      checkpoint() {
        checkpoints += 1;
      }
    });
    const lazyReal = new StepCountingLazyReal();
    const node = createLazyRealNode(lazyReal);
    const graph = createEvaluationGraph(node, context);

    await graph.refine({ significantDigits: 10 });
    assert.equal(lazyReal.completedSteps, 10);
    assert.equal(lazyReal.refinementCalls, 1);
    assert.equal(node.getStateSnapshot().highestCompletedDigits, 10);

    await graph.refine({ significantDigits: 100 });
    assert.equal(lazyReal.completedSteps, 100);
    assert.equal(lazyReal.refinementCalls, 2);
    assert.equal(node.getStateSnapshot().highestCompletedDigits, 100);

    await graph.refine({ significantDigits: 25 });
    assert.equal(lazyReal.completedSteps, 100);
    assert.equal(lazyReal.refinementCalls, 2);
    assert.equal(node.getStateSnapshot().cacheHits, 1);
    assert.ok(checkpoints >= 100);
  });

  void it("keeps state independent for distinct lazy nodes", async () => {
    const context = createEvaluationContext();
    const leftLazy = new StepCountingLazyReal();
    const rightLazy = new StepCountingLazyReal();
    const left = createLazyRealNode(leftLazy);
    const right = createLazyRealNode(rightLazy);

    await left.refine({ significantDigits: 12 }, context);
    await right.refine({ significantDigits: 7 }, context);

    assert.equal(leftLazy.completedSteps, 12);
    assert.equal(rightLazy.completedSteps, 7);

    left.invalidate();
    assert.equal(left.getStateSnapshot().invalidations, 1);
    assert.equal(right.getStateSnapshot().invalidations, 0);

    await left.refine({ significantDigits: 3 }, context);
    assert.equal(leftLazy.completedSteps, 12);
    assert.equal(leftLazy.refinementCalls, 2);
    assert.equal(rightLazy.refinementCalls, 1);
  });

  void it("records operand precision requests from parent nodes", async () => {
    const context = createEvaluationContext();
    const left = createLazyRealNode(new StepCountingLazyReal());
    const right = createLazyRealNode(new StepCountingLazyReal());
    const root = createAddNode(left, right, (request, childIndex) => ({
      significantDigits: request.significantDigits + childIndex + 1
    }));
    const graph = createEvaluationGraph(root, context);

    await graph.refine({ significantDigits: 10 });

    assert.deepEqual(
      root.getStateSnapshot().childRequests.map((request) => request.requestedDigits),
      [11, 12]
    );
    assert.equal(left.getStateSnapshot().highestRequestedDigits, 11);
    assert.equal(right.getStateSnapshot().highestRequestedDigits, 12);
  });

  void it("shares constant node state inside one evaluation graph", async () => {
    let createValueCalls = 0;
    const constantValue = new StepCountingLazyReal();
    const registry = createRegistry({
      constants: [
        {
          kind: "constant",
          name: "c",
          createValue(): LazyReal {
            createValueCalls += 1;
            return constantValue;
          }
        }
      ]
    });
    const context = createEvaluationContext({ registry });
    const graphWithCache = createEvaluationGraph(createRationalNode(integerRational(0n)), context);
    const sharedConstant = graphWithCache.getOrCreateConstantNode("c");
    const sameSharedConstant = graphWithCache.getOrCreateConstantNode("c");
    const root = createAddNode(sharedConstant, sameSharedConstant, (request) => request);
    const graph = createEvaluationGraph(root, context);

    assert.equal(sharedConstant, sameSharedConstant);

    await graph.refine({ significantDigits: 10 });

    assert.equal(createValueCalls, 1);
    assert.equal(constantValue.refinementCalls, 1);
    assert.equal(constantValue.completedSteps, 10);
    assert.equal(sharedConstant.getStateSnapshot().cacheHits, 1);

    graph.invalidate();
    assert.equal(sharedConstant.getStateSnapshot().invalidations, 1);
  });

  void it("wraps evaluation nodes as LazyReal values", async () => {
    const context = createEvaluationContext();
    const node = createLazyRealNode(new StepCountingLazyReal());
    const lazy = nodeToLazyReal(node);

    await lazy.refine({ significantDigits: 15 }, context);

    assert.equal(lazy.kind, "lazy-real");
    assert.equal(node.getStateSnapshot().highestCompletedDigits, 15);
  });
});

class StepCountingLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  completedSteps = 0;
  refinementCalls = 0;

  refine(request: { readonly significantDigits: number }, context: EvaluationContext) {
    this.refinementCalls += 1;
    const graphContext = context as EvaluationGraphContext;

    while (this.completedSteps < request.significantDigits) {
      graphContext.checkpoint();
      this.completedSteps += 1;
    }

    return Promise.resolve(
      rationalToBall(
        integerRational(BigInt(this.completedSteps)),
        precisionBitsForRequest(request),
        graphContext.backend
      )
    );
  }
}
