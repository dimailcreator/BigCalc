import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addRational,
  createAddNode,
  createDivNode,
  createEvaluationContext,
  createEvaluationGraph,
  createInternalInterval,
  createLazyRealNode,
  createMulNode,
  createRational,
  createRationalNode,
  createSubNode,
  integerRational,
  intervalToBall,
  precisionBitsForRequest,
  subtractRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type {
  EvaluationGraph,
  EvaluationGraphContext,
  LazyReal,
  Rational
} from "../src/core/index.js";

void describe("precision propagation for basic LazyReal arithmetic", () => {
  void it("increases operand precision under strong subtraction cancellation", async () => {
    const tinyDifference = createRational(1n, 81n * 10n ** 29n);
    const left = new ErrorControlledRationalLazyReal(
      addRational(integerRational(1n), tinyDifference)
    );
    const right = new ErrorControlledRationalLazyReal(integerRational(1n));
    const graph = createEvaluationGraph(
      createSubNode(createLazyRealNode(left), createLazyRealNode(right)),
      createEvaluationContext()
    );
    const result = await graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(
      result,
      { significantDigits: 20 },
      graph.context.backend
    );

    assert.equal(verified.verifiedDigits >= 20, true);
    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, -31n);
    assert.equal(Math.max(...left.requestedDigits) > 22, true);
    assert.equal(Math.max(...right.requestedDigits) > 22, true);
  });

  void it("does not over-refine simple addition across very different magnitudes", async () => {
    const huge = new ErrorControlledRationalLazyReal(
      integerRational(123456789012345678901234567890123456789012345678901n)
    );
    const small = new ErrorControlledRationalLazyReal(createRational(1n, 3n));
    const root = createAddNode(createLazyRealNode(huge), createLazyRealNode(small));
    const graph = createEvaluationGraph(root, createEvaluationContext());
    const result = await graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(
      result,
      { significantDigits: 20 },
      graph.context.backend
    );

    assert.equal(verified.verifiedDigits >= 20, true);
    assert.deepEqual(huge.requestedDigits, [22]);
    assert.deepEqual(small.requestedDigits, [22]);
    assert.equal(root.getStateSnapshot().childRequests.length, 2);
  });

  void it("refines a near-zero denominator before dividing", async () => {
    const numerator = new ErrorControlledRationalLazyReal(integerRational(1n));
    const denominator = new ErrorControlledRationalLazyReal(createRational(7n, 10n ** 40n));
    const graph = createEvaluationGraph(
      createDivNode(createLazyRealNode(numerator), createLazyRealNode(denominator)),
      createEvaluationContext()
    );
    const result = await graph.refine({ significantDigits: 20 });
    const verified = verifiedNumberFromBall(
      result,
      { significantDigits: 20 },
      graph.context.backend
    );

    assert.equal(verified.verifiedDigits >= 20, true);
    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 39n);
    assert.equal(Math.max(...denominator.requestedDigits) > 22, true);
  });

  void it("surfaces a proven zero denominator as DivisionByZeroError during refinement", async () => {
    const numerator = new ErrorControlledRationalLazyReal(integerRational(1n));
    const graph = createEvaluationGraph(
      createDivNode(createLazyRealNode(numerator), createRationalNode(integerRational(0n))),
      createEvaluationContext()
    );

    await assert.rejects(() => graph.refine({ significantDigits: 20 }), {
      code: "DivisionByZeroError"
    });
  });

  void it("keeps nested operations refining monotonically for 20 -> 100 -> 500 digits", async () => {
    const left = new ErrorControlledRationalLazyReal(createRational(1n, 3n));
    const right = new ErrorControlledRationalLazyReal(createRational(1n, 7n));
    const graph = nestedGraph(left, right);
    const requests = [20, 100, 500];
    let previousDigits = "";

    for (const significantDigits of requests) {
      const ball = await graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, graph.context.backend);

      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(previousDigits), true);
      previousDigits = verified.digits;
    }

    assert.equal(Math.max(...left.requestedDigits) >= 502, true);
    assert.equal(Math.max(...right.requestedDigits) >= 502, true);
    assert.equal(left.refinementCalls <= 12, true);
    assert.equal(right.refinementCalls <= 12, true);
  });
});

class ErrorControlledRationalLazyReal implements LazyReal {
  readonly kind = "lazy-real";
  readonly requestedDigits: number[] = [];
  refinementCalls = 0;

  constructor(
    private readonly value: Rational,
    private readonly uncertaintyPaddingDigits = 5
  ) {}

  refine(
    request: { readonly significantDigits: number },
    context: Parameters<LazyReal["refine"]>[1]
  ) {
    const graphContext = context as EvaluationGraphContext;
    this.refinementCalls += 1;
    this.requestedDigits.push(request.significantDigits);

    const uncertainty = createRational(
      1n,
      10n ** BigInt(request.significantDigits + this.uncertaintyPaddingDigits)
    );
    const lower = subtractRational(this.value, uncertainty);
    const upper = addRational(this.value, uncertainty);
    const precisionBits = precisionBitsForRequest({
      significantDigits: request.significantDigits + this.uncertaintyPaddingDigits + 4
    });

    return Promise.resolve(
      intervalToBall(
        createInternalInterval(
          graphContext.backend.fromRational(lower, precisionBits, "towardNegativeInfinity"),
          graphContext.backend.fromRational(upper, precisionBits, "towardPositiveInfinity"),
          graphContext.backend
        ),
        precisionBits,
        graphContext.backend
      )
    );
  }
}

function nestedGraph(
  left: ErrorControlledRationalLazyReal,
  right: ErrorControlledRationalLazyReal
): EvaluationGraph {
  const leftNode = createLazyRealNode(left);
  const rightNode = createLazyRealNode(right);
  const product = createMulNode(leftNode, rightNode);
  const shifted = createAddNode(product, createRationalNode(createRational(5n, 11n)));
  const denominator = createAddNode(rightNode, createRationalNode(integerRational(2n)));

  return createEvaluationGraph(createDivNode(shifted, denominator), createEvaluationContext());
}
