import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCalculationHandle } from "../src/core/api.js";
import {
  createCoreRegistry,
  createRational,
  evaluateExpressionToRealValue,
  tokenizeExpression
} from "../src/core/index.js";

void describe("Stage 31 square-root source syntax", () => {
  void it("tokenizes √ as an operator rather than a registered name", () => {
    const result = tokenizeExpression("√π", createCoreRegistry());
    if (!result.ok) assert.fail(result.error.message);
    const first = result.tokens[0];
    assert.equal(first?.kind, "operator");
    assert.equal(first.value, "√");
    assert.equal(result.tokens[1]?.kind, "registered-name");
  });

  void it("retains exact rational square roots through the existing power path", () => {
    for (const [source, numerator, denominator] of [
      ["√0", 0n, 1n],
      ["√1", 1n, 1n],
      ["√4", 2n, 1n],
      ["√(4/9)", 2n, 3n],
      ["√9%", 3n, 10n],
      ["√4!", 2n, 1n],
      ["2^√4", 4n, 1n],
      ["√√16", 2n, 1n]
    ] as const) {
      const result = evaluateExpressionToRealValue(source);
      if (!result.ok) assert.fail(`${source}: ${result.error.message}`);
      assert.deepEqual(result.value, createRational(numerator, denominator), source);
    }
  });

  void it("produces verified digits for irrational and large positive radicands", async () => {
    for (const [rootSource, powerSource, requestedDigits] of [
      ["√2", "(2)^(1/2)", 25],
      ["√(40!)", "(40!)^(1/2)", 12]
    ] as const) {
      const root = createCalculationHandle(rootSource);
      const power = createCalculationHandle(powerSource);
      if (!root.ok) assert.fail(root.error.message);
      if (!power.ok) assert.fail(power.error.message);
      const rootResult = await root.handle.refine({ significantDigits: requestedDigits });
      const powerResult = await power.handle.refine({ significantDigits: requestedDigits });
      if (rootResult.status !== "complete") assert.fail(`${rootSource}: ${rootResult.status}`);
      if (powerResult.status !== "complete") assert.fail(`${powerSource}: ${powerResult.status}`);
      assert.equal(rootResult.value.verifiedDigits >= requestedDigits, true, rootSource);
      assert.equal(rootResult.value.digits, powerResult.value.digits, rootSource);
      assert.equal(rootResult.value.exponent10, powerResult.value.exponent10, rootSource);
    }
  });

  void it("returns a typed domain error for a negative radicand", async () => {
    const created = createCalculationHandle("√(-1)");
    if (!created.ok) assert.fail(created.error.message);
    const result = await created.handle.refine({ significantDigits: 10 });
    if (result.status !== "failed") assert.fail(`Expected failure, got ${result.status}`);
    assert.equal(result.error.code, "DomainError");
  });

  void it("matches exact power semantics for grouped positive rationals", () => {
    for (const value of ["0", "1", "4", "4/9", "100/121"]) {
      const root = evaluateExpressionToRealValue(`√(${value})`);
      const power = evaluateExpressionToRealValue(`(${value})^(1/2)`);
      if (!root.ok) assert.fail(root.error.message);
      if (!power.ok) assert.fail(power.error.message);
      assert.deepEqual(root.value, power.value, value);
    }
  });
});
