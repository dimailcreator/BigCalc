import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCalculationHandle,
  createCalculationHandleFromSegments,
  DEFAULT_CALCULATION_SETTINGS
} from "../src/core/api.js";
import type {
  CalculationExpressionSegment,
  CalculationReferenceSnapshot,
  CalculationSettings,
  CompletedResult
} from "../src/core/api.js";

const source = (text: string): CalculationExpressionSegment => ({ kind: "source", source: text });
const reference = (id: string): CalculationExpressionSegment => ({ kind: "reference", id });

function snapshot(
  id: string,
  expression: readonly CalculationExpressionSegment[],
  settings: Partial<CalculationSettings> = {}
): CalculationReferenceSnapshot {
  return {
    id,
    expression,
    settings: { ...DEFAULT_CALCULATION_SETTINGS, ...settings }
  };
}

async function complete(
  expression: readonly CalculationExpressionSegment[],
  references: readonly CalculationReferenceSnapshot[],
  settings: Partial<CalculationSettings> = {},
  digits = 20
): Promise<CompletedResult> {
  const created = createCalculationHandleFromSegments(expression, references, { settings });
  if (!created.ok) assert.fail(`${created.error.code}: ${created.error.message}`);
  const result = await created.handle.refine({ significantDigits: digits });
  if (result.status !== "complete") assert.fail(`Expected complete, got ${result.status}`);
  return result;
}

void describe("Core API 1.1 structured history references", () => {
  void it("keeps 1/3 exact when the reference participates in arithmetic", async () => {
    const result = await complete(
      [reference("third"), source("+1")],
      [snapshot("third", [source("1/3")])]
    );
    assert.equal(result.value.valueExact, true);
    assert.equal(result.value.decimalTerminating, false);
    assert.equal(result.value.digits.startsWith("133333333333"), true);
  });

  void it("keeps π lazy and can refine the same handle to more digits", async () => {
    const created = createCalculationHandleFromSegments(
      [reference("pi"), source("*2")],
      [snapshot("pi", [source("π")])]
    );
    if (!created.ok) assert.fail(created.error.message);
    const first = await created.handle.refine({ significantDigits: 10 });
    const later = await created.handle.refine({ significantDigits: 35 });
    if (first.status !== "complete" || later.status !== "complete") {
      assert.fail("Both refinement requests must complete");
    }
    assert.equal(first.value.valueExact, false);
    assert.equal(later.value.valueExact, false);
    assert.equal(first.value.digits.startsWith("6283185307"), true);
    assert.equal(later.value.digits.startsWith(first.value.digits.slice(0, 10)), true);
    assert.equal(later.value.verifiedDigits >= 35, true);
  });

  void it("uses saved degree settings inside a radian expression", async () => {
    const result = await complete(
      [reference("degree"), source("+1")],
      [snapshot("degree", [source("sin(30)")], { angleMode: "degrees" })],
      { angleMode: "radians" }
    );
    assert.equal(result.value.valueExact, true);
    assert.equal(result.value.digits, "15");
    assert.equal(result.value.exponent10, 0n);
  });

  void it("uses saved radian settings inside a degree expression", async () => {
    const result = await complete(
      [reference("radian")],
      [snapshot("radian", [source("sin(1)")], { angleMode: "radians" })],
      { angleMode: "degrees" },
      10
    );
    assert.equal(result.value.digits.startsWith("8414709848"), true);
    assert.equal(result.value.exponent10, -1n);
  });

  void it("uses saved Gamma settings inside an integer-factorial expression", async () => {
    const result = await complete(
      [reference("gamma"), source("+1")],
      [snapshot("gamma", [source("(-1/2)!")], { factorialMode: "gamma" })],
      { factorialMode: "integer" },
      12
    );
    assert.equal(result.value.valueExact, false);
    assert.equal(result.value.digits.startsWith("277245"), true);
  });

  void it("uses saved integer-factorial settings inside a Gamma expression", async () => {
    const created = createCalculationHandleFromSegments(
      [reference("integer")],
      [snapshot("integer", [source("(-1/2)!")], { factorialMode: "integer" })],
      { settings: { factorialMode: "gamma" } }
    );
    if (!created.ok) assert.fail(created.error.message);
    const result = await created.handle.refine({ significantDigits: 10 });
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "DomainError");
  });

  void it("distinguishes two stable references in one expression", async () => {
    const result = await complete(
      [reference("third"), source("+"), reference("sixth")],
      [snapshot("third", [source("1/3")]), snapshot("sixth", [source("1/6")])]
    );
    assert.equal(result.value.valueExact, true);
    assert.equal(result.value.decimalTerminating, true);
    assert.equal(result.value.digits, "5");
    assert.equal(result.value.exponent10, -1n);
  });

  void it("parses adjacent references as implicit multiplication", async () => {
    const result = await complete(
      [reference("third"), reference("sixth")],
      [snapshot("third", [source("1/3")]), snapshot("sixth", [source("1/6")])]
    );
    assert.equal(result.value.valueExact, true);
    assert.equal(result.value.decimalTerminating, false);
    assert.equal(result.value.digits.startsWith("555555"), true);
    assert.equal(result.value.exponent10, -2n);
  });

  void it("resolves nested references with their original settings", async () => {
    const result = await complete(
      [reference("sum"), source("*3")],
      [snapshot("third", [source("1/3")]), snapshot("sum", [reference("third"), source("+1")])]
    );
    assert.equal(result.value.valueExact, true);
    assert.equal(result.value.digits, "4");
    assert.equal(result.value.exponent10, 0n);
  });

  void it("rejects missing, duplicate, and cyclic reference graphs", () => {
    assert.throws(() => createCalculationHandleFromSegments([reference("missing")], []), TypeError);
    assert.throws(
      () =>
        createCalculationHandleFromSegments(
          [reference("a")],
          [snapshot("a", [source("1")]), snapshot("a", [source("2")])]
        ),
      TypeError
    );
    assert.throws(
      () =>
        createCalculationHandleFromSegments(
          [reference("a")],
          [snapshot("a", [reference("b")]), snapshot("b", [reference("a")])]
        ),
      TypeError
    );
  });

  void it("leaves the existing source-only API unchanged", () => {
    const created = createCalculationHandle("Ans+1");
    if (created.ok) assert.fail("The source-only API must not resolve Ans");
    assert.equal(created.error.code, "UnknownIdentifierError");
  });
});
