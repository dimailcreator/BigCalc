import { describe, expect, it } from "vitest";
import { createCalculationHandle } from "@bigcalc/core";
import type { CalculationSettings, CompletedResult, RefinementResult } from "@bigcalc/core";

async function evaluate(
  source: string,
  significantDigits: number,
  settings: Partial<CalculationSettings> = {}
): Promise<RefinementResult> {
  const created = createCalculationHandle(source, { settings });
  if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
  return created.handle.refine({ significantDigits });
}

async function complete(
  source: string,
  significantDigits: number,
  settings: Partial<CalculationSettings> = {}
): Promise<CompletedResult> {
  const result = await evaluate(source, significantDigits, settings);
  if (result.status !== "complete") throw new Error(`Expected complete, got ${result.status}`);
  return result;
}

describe("Stage 7 public Core boundary proof", () => {
  it("A: source expansion preserves an exact rational only when all settings agree", async () => {
    const original = await complete("1/3", 12);
    const expanded = await complete("(1/3)+1", 12);
    const decimalSubstitution = await complete(`0,${original.value.digits}+1`, 15);

    expect(original.value.valueExact).toBe(true);
    expect(original.value.decimalTerminating).toBe(false);
    expect(expanded.value.valueExact).toBe(true);
    expect(expanded.value.decimalTerminating).toBe(false);
    expect(decimalSubstitution.value.valueExact).toBe(true);
    expect(decimalSubstitution.value.decimalTerminating).toBe(true);
    expect(decimalSubstitution.value.digits).not.toBe(expanded.value.digits);
  });

  it("B and E: source expansion of a lazy value can request more digits", async () => {
    const lower = await complete("(π)*2", 8);
    const higher = await complete("(π)*2", 30);

    expect(lower.value.valueExact).toBe(false);
    expect(higher.value.valueExact).toBe(false);
    expect(higher.value.verifiedDigits).toBeGreaterThanOrEqual(30);
    expect(higher.value.digits.startsWith(lower.value.digits.slice(0, 7))).toBe(true);
  });

  it("C: one source string cannot retain an old degree setting under a current radian setting", async () => {
    const historyValue = await complete("sin(30)", 12, { angleMode: "degrees" });
    const degreeExpansion = await complete("(sin(30))+1", 12, { angleMode: "degrees" });
    const radianExpansion = await complete("(sin(30))+1", 12, { angleMode: "radians" });

    expect(historyValue.value.valueExact).toBe(true);
    expect(historyValue.value.digits).toBe("5");
    expect(degreeExpansion.value.digits).toBe("15");
    expect(degreeExpansion.value.exponent10).toBe(0n);
    expect(radianExpansion.value.digits).not.toBe(degreeExpansion.value.digits);
  });

  it("D: source expansion loses the saved Gamma mode under current integer factorial mode", async () => {
    const saved = await complete("(-1/2)!", 12, { factorialMode: "gamma" });
    const current = await evaluate("((-1/2)!)+1", 12, { factorialMode: "integer" });

    expect(saved.value.sign).toBe(1);
    expect(current.status).toBe("failed");
    if (current.status === "failed") expect(current.error.code).toBe("DomainError");
  });

  it("C through E: the public parser cannot resolve an Ans reference", () => {
    const created = createCalculationHandle("Ans+1");
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.code).toBe("UnknownIdentifierError");
  });
});
