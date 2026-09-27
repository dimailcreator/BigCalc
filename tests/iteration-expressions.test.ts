import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCalculationHandle } from "../src/core/api.js";
import { createCalculationHandleFromSource } from "../src/core/index.js";

void describe("Stage 30 expression-valued function iteration", () => {
  void it("evaluates exact non-negative integer expressions and preserves zero identity", async () => {
    for (const [source, digits] of [
      ["sin[0](2)", "2"],
      ["sin[1+1](0)", "0"],
      ["sin[4/2](0)", "0"],
      ["sin[(1+3)/2](0)", "0"],
      ["sin[1/2+1/2](0)", "0"],
      ["sin[(2+4)/3](0)", "0"],
      ["sin[π-π](2)", "2"],
      ["sin[ln(e)](0)", "0"],
      ["abs[2+1](-3)", "3"],
      ["log{10}[1+1](10000000000)", "1"]
    ] as const) {
      const created = createCalculationHandle(source);
      if (!created.ok) assert.fail(created.error.message);
      const result = await created.handle.refine({ significantDigits: 20 });
      if (result.status !== "complete") assert.fail(`${source}: ${result.status}`);
      assert.equal(result.value.digits, digits, source);
      assert.equal(result.value.valueExact, true, source);
    }
  });

  void it("uses expression-valued iteration for log with an expression base", async () => {
    const created = createCalculationHandle("log{2}[1+2](8)");
    if (!created.ok) assert.fail(created.error.message);
    const result = await created.handle.refine({ significantDigits: 20 });
    if (result.status !== "complete") assert.fail(`Expected complete, got ${result.status}`);
    assert.equal(result.value.verifiedDigits >= 20, true);
  });

  void it("rejects non-integer, negative, and approximate iteration values", async () => {
    for (const source of ["sin[3/2](0)", "sin[-1](0)", "sin[π](0)", "sin[2+π-π](0)"]) {
      const created = createCalculationHandle(source);
      if (!created.ok) assert.fail(created.error.message);
      const result = await created.handle.refine({ significantDigits: 10 });
      if (result.status !== "failed") assert.fail(`${source}: expected failure`);
      assert.equal(result.error.code, "InvalidIterationError", source);
      assert.match(result.error.message, /provably exact non-negative integer/);
    }
  });

  void it("preserves mathematical errors in the iteration expression", async () => {
    for (const [source, code] of [
      ["sin[1/0](0)", "DivisionByZeroError"],
      ["sin[(-1)!](0)", "DomainError"],
      ["log{2}[1/0](8)", "DivisionByZeroError"]
    ] as const) {
      const created = createCalculationHandle(source);
      if (!created.ok) assert.fail(created.error.message);
      const result = await created.handle.refine({ significantDigits: 10 });
      if (result.status !== "failed") assert.fail(`${source}: expected failure`);
      assert.equal(result.error.code, code, source);
    }
  });

  void it("guards huge exact counts before expanding the graph", async () => {
    for (const source of ["sin[513](0)", "sin[1000000000000](0)", "log{2}[513](8)"]) {
      const created = createCalculationHandleFromSource(source, {
        now: () => 0,
        resourceLimits: { maxCheckpointsPerRun: 10 }
      });
      if (!created.ok) assert.fail(created.error.message);
      assert.equal(created.graph.root.nodeType, "iteration");
      assert.equal(created.graph.root.children.length <= 3, true);

      const result = await created.handle.refine({ significantDigits: 10 });
      if (result.status !== "failed") assert.fail(`${source}: expected resource failure`);
      assert.equal(result.error.code, "ResourceLimitError", source);
      assert.equal(result.error.resource, "memory", source);
      assert.equal(created.graph.root.children.length <= 3, true);
    }
  });

  void it("continues the same iterated calculation after a soft timeout", async () => {
    let advanceClock = true;
    let ticks = 0;
    const created = createCalculationHandleFromSource("sin[8](0)", {
      settings: { maxCalculationTimeMs: 6 },
      now: () => (advanceClock ? ticks++ : ticks)
    });
    if (!created.ok) assert.fail(created.error.message);
    const root = created.graph.root;

    const paused = await created.handle.refine({ significantDigits: 10 });
    assert.equal(paused.status, "paused");
    advanceClock = false;
    const continued = await created.handle.continue();
    if (continued.status !== "complete") assert.fail(`Expected complete, got ${continued.status}`);
    assert.equal(continued.value.digits, "0");
    assert.equal(created.graph.root, root);
  });
});
