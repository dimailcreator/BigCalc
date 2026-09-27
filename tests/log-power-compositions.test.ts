import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCalculationHandle } from "../src/core/api.js";
import { createCalculationHandleFromSource } from "../src/core/index.js";

void describe("Stage 29 logarithm and power compositions", () => {
  void it("evaluates e^ln(2) without exhausting the hard watchdog", async () => {
    const publicCalculation = createCalculationHandle("e^ln(2)");
    if (!publicCalculation.ok) assert.fail(publicCalculation.error.message);
    const publicResult = await publicCalculation.handle.refine({ significantDigits: 18 });
    if (publicResult.status !== "complete") {
      assert.fail(`Expected public completion, got ${publicResult.status}`);
    }
    assert.equal(publicResult.value.valueExact, true);
    assert.equal(publicResult.value.digits, "2");

    const created = createCalculationHandleFromSource("e^ln(2)", {
      now: () => 0,
      resourceLimits: { maxCheckpointsPerRun: 20_000 }
    });
    if (!created.ok) assert.fail(created.error.message);

    const result = await created.handle.refine({ significantDigits: 18 });
    if (result.status !== "complete") assert.fail(`Expected complete, got ${result.status}`);
    assert.equal(result.value.digits, "2");
    assert.equal(result.value.valueExact, true);
  });

  void it("covers the composition audit matrix at App, 100, and 1000 digits", async () => {
    const exactCases = new Map<string, { digits: string; exponent10: bigint }>([
      ["e^ln(2)", { digits: "2", exponent10: 0n }],
      ["e^ln(10)", { digits: "1", exponent10: 1n }],
      ["e^0", { digits: "1", exponent10: 0n }],
      ["ln(e)", { digits: "1", exponent10: 0n }],
      ["10^log(2)", { digits: "2", exponent10: 0n }],
      ["10^log(100)", { digits: "1", exponent10: 2n }],
      ["2^log2(8)", { digits: "8", exponent10: 0n }]
    ]);
    const approximateCases = new Map<string, string>([
      ["e^1", "271828182845904"],
      ["exp(ln(2))", "2"],
      ["exp(ln(1/3))", "333333333333333"],
      ["ln(exp(2))", "2"]
    ]);

    for (const source of [...exactCases.keys(), "e^ln(1/3)", ...approximateCases.keys()]) {
      const created = createCalculationHandleFromSource(source, {
        now: () => 0,
        resourceLimits: { maxCheckpointsPerRun: 100_000 }
      });
      if (!created.ok) assert.fail(created.error.message);

      for (const significantDigits of [18, 100, 1000]) {
        const result = await created.handle.refine({ significantDigits });
        if (result.status !== "complete") {
          assert.fail(`${source} at ${String(significantDigits)} digits: ${result.status}`);
        }
        const exact = exactCases.get(source);
        if (exact !== undefined) {
          assert.equal(result.value.valueExact, true, source);
          assert.equal(result.value.digits, exact.digits, source);
          assert.equal(result.value.exponent10, exact.exponent10, source);
        } else if (source === "e^ln(1/3)") {
          assert.equal(result.value.valueExact, true, source);
          assert.equal(result.value.exponent10, -1n, source);
          assert.equal(result.value.digits, "3".repeat(significantDigits), source);
        } else {
          assert.equal(result.value.verifiedDigits >= significantDigits, true, source);
          assert.equal(result.value.digits.startsWith(approximateCases.get(source) ?? ""), true);
        }
      }
    }
  });

  void it("preserves logarithm domains and child errors before applying identities", async () => {
    for (const [source, code] of [
      ["e^ln(-2)", "DomainError"],
      ["e^ln(0)", "DomainError"],
      ["e^ln(1-1)", "DomainError"],
      ["10^log(-2)", "DomainError"],
      ["10^log(0)", "DomainError"],
      ["10^log{1}(2)", "DomainError"],
      ["e^ln(1/0)", "DivisionByZeroError"]
    ] as const) {
      const created = createCalculationHandleFromSource(source, { now: () => 0 });
      if (!created.ok) assert.fail(created.error.message);
      const result = await created.handle.refine({ significantDigits: 18 });
      if (result.status !== "failed")
        assert.fail(`${source}: expected failure, got ${result.status}`);
      assert.equal(result.error.code, code, source);
    }
  });

  void it("keeps soft timeout resumable on the same e^1 calculation", async () => {
    let ticking = false;
    let ticks = 0;
    const created = createCalculationHandleFromSource("e^1", {
      settings: { maxCalculationTimeMs: 15 },
      now: () => (ticking ? ticks++ : ticks)
    });
    if (!created.ok) assert.fail(created.error.message);
    const constant = created.graph.root.children[0];
    assert.ok(constant);
    const value = constant.evaluate(created.context);
    assert.equal(value.kind, "lazy-real");
    const stateful = value as typeof value & {
      getStateSnapshot(): { readonly completedTerms: number };
    };

    const first = await created.handle.refine({ significantDigits: 18 });
    assert.equal(first.status, "complete");
    const previousTerms = stateful.getStateSnapshot().completedTerms;
    assert.equal(previousTerms > 0, true);

    ticking = true;
    const paused = await created.handle.refine({ significantDigits: 1000 });
    assert.equal(paused.status, "paused");
    assert.equal(paused.verifiedDigits >= 18, true);
    assert.equal(stateful.getStateSnapshot().completedTerms >= previousTerms, true);

    ticking = false;
    const continued = await created.handle.continue();
    assert.equal(continued.status, "complete");
    assert.equal(stateful.getStateSnapshot().completedTerms > previousTerms, true);
    assert.equal(created.graph.root.children[0], constant);
    assert.equal(constant.evaluate(created.context), value);
  });
});
