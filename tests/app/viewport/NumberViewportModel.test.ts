import { describe, expect, it } from "vitest";
import type { VerifiedNumberDto } from "../../../src/app/calculation/CalculationProtocol.js";
import {
  createNumberViewportModel,
  initialViewportPrecisionDemand
} from "../../../src/app/viewport/NumberViewportModel.js";

const SQRT_TWO = "14142135623730950488016887242096980785696718753769";
const SQRT_FORTY_FACTORIAL = "9032802905233224086356101748970628681132497062868113";

describe("NumberViewport model", () => {
  it("keeps the comma while visible and then uses relative-E windows for sqrt(2)", () => {
    const value = number(SQRT_TWO, 0n);
    const initial = createNumberViewportModel({ value, availableSlots: 18 });
    expect(initial.representation).toBe("decimal");
    expect(initial.text).toBe("1,4142135623730950");
    expect(initial.logicalStart).toBe(0n);
    expect(initial.canScrollLeft).toBe(false);
    expect(initial.canScrollRight).toBe(true);

    const next = createNumberViewportModel({ value, availableSlots: 18, logicalStart: 1n });
    expect(next.representation).toBe("decimal");
    expect(next.text).toBe("..,4142135623730950");
    expect(next.lastDigitIndex).toBe(16n);
    expect(next.slots).toHaveLength(18);
    expect(next.slots[0]).toMatchObject({ kind: "ellipsis", text: ".." });
    expect(next.canScrollLeft).toBe(true);

    const beyondComma = createNumberViewportModel({
      value,
      availableSlots: 18,
      logicalStart: 2n
    });
    expect(beyondComma.representation).toBe("scientific");
    expect(beyondComma.text).toBe("..1421356237309E-14");

    const far = createNumberViewportModel({ value, availableSlots: 18, logicalStart: 19n });
    expect(far.text).toBe("..8016887242096E-31");
    expect(far.lastDigitIndex).toBe(31n);
  });

  it("moves between relative-E and genuine decimal-comma windows for sqrt(40!)", () => {
    const value = number(SQRT_FORTY_FACTORIAL, 23n);
    expect(createNumberViewportModel({ value, availableSlots: 18 }).text).toBe(
      "9032802905233224E8"
    );
    expect(createNumberViewportModel({ value, availableSlots: 18, logicalStart: 7n }).text).toBe(
      "..905233224086356E2"
    );
    const commaAtEnd = createNumberViewportModel({
      value,
      availableSlots: 18,
      logicalStart: 8n
    });
    expect(commaAtEnd.representation).toBe("decimal");
    expect(commaAtEnd.text).toBe("..0523322408635610,");
    expect(createNumberViewportModel({ value, availableSlots: 18, logicalStart: 23n }).text).toBe(
      "..0,174897062868113"
    );
    expect(createNumberViewportModel({ value, availableSlots: 18, logicalStart: 24n }).text).toBe(
      "..,1748970628681132"
    );
    expect(createNumberViewportModel({ value, availableSlots: 18, logicalStart: 26n }).text).toBe(
      "..4897062868113E-15"
    );
  });

  it("preserves exact finite boundaries including trimmed fractional zeros and virtual integer zeros", () => {
    const one = exact("1", 0n);
    const onePointZero = exact("10", 0n);
    for (const value of [one, onePointZero]) {
      const view = createNumberViewportModel({ value, availableSlots: 12, logicalStart: 100n });
      expect(view.text.trim()).toBe("1");
      expect(view.logicalStart).toBe(0n);
      expect(view.exactEndIndex).toBe(0n);
      expect(view.canScrollRight).toBe(false);
      expect(view.precisionDemand).toBeNull();
    }

    const eighth = createNumberViewportModel({ value: exact("125", -1n), availableSlots: 10 });
    expect(eighth.text.trim()).toBe("0,125");
    expect(eighth.logicalStart).toBe(-1n);
    expect(eighth.canScrollRight).toBe(false);

    const power = exact("1", 1_000_000n);
    const initial = createNumberViewportModel({ value: power, availableSlots: 18 });
    expect(initial.representation).toBe("scientific");
    expect(initial.canScrollRight).toBe(true);
    expect(initial.slots).toHaveLength(18);
    const final = createNumberViewportModel({
      value: power,
      availableSlots: 18,
      logicalStart: 999_999n
    });
    expect(final.representation).toBe("decimal");
    expect(final.text.trim()).toBe("..00");
    expect(final.exactEndIndex).toBe(1_000_000n);
    expect(final.canScrollRight).toBe(false);
    expect(final.precisionDemand).toBeNull();
    expect(
      createNumberViewportModel({
        value: power,
        availableSlots: 18,
        logicalStart: 1_000_100n
      }).logicalStart
    ).toBe(1_000_000n);
  });

  it("handles small and negative values and rejects too-long exponents", () => {
    expect(
      createNumberViewportModel({ value: exact("4", -4n), availableSlots: 10 }).text.trim()
    ).toBe("0,0004");
    const negative = createNumberViewportModel({
      value: number(SQRT_TWO, 0n, -1),
      availableSlots: 18
    });
    expect(negative.text).toBe("-1,414213562373095");
    expect(negative.slots).toHaveLength(18);
    expect(
      createNumberViewportModel({ value: exact("1", -1000n), availableSlots: 18 }).text.trim()
    ).toBe("1E-1000");
    expect(
      createNumberViewportModel({ value: exact("1", 10n ** 20n), availableSlots: 18 })
        .representation
    ).toBe("displayError");
    expect(
      createNumberViewportModel({ value: exact("1", 10n ** 20n), availableSlots: 18 }).text
    ).toBe("Ошибка отображения");
  });

  it("holds slot positions while lazy digits arrive and requests initial digits then 50-digit blocks", () => {
    const partialValue = number(SQRT_TWO.slice(0, 4), 0n);
    const partial = createNumberViewportModel({ value: partialValue, availableSlots: 18 });
    expect(partial.text).toBe("1,414             ");
    expect(partial.precisionDemand).toBe(17);
    expect(
      createNumberViewportModel({
        value: number(SQRT_TWO, 0n),
        availableSlots: 18,
        computedRange: { start: 0, endExclusive: 4 }
      }).text
    ).toBe(partial.text);
    const complete = createNumberViewportModel({ value: number(SQRT_TWO, 0n), availableSlots: 18 });
    expect(complete.logicalStart).toBe(partial.logicalStart);
    expect(complete.slots.map((slot) => slot.kind)).toEqual(
      partial.slots.map((slot) => (slot.kind === "placeholder" ? "digit" : slot.kind))
    );
    expect(complete.precisionDemand).toBeNull();

    const far = createNumberViewportModel({
      value: number(SQRT_TWO.slice(0, 20), 0n),
      availableSlots: 18,
      logicalStart: 19n
    });
    expect(far.logicalStart).toBe(19n);
    expect(far.slots.some((slot) => slot.kind === "placeholder")).toBe(true);
    expect(far.precisionDemand).toBe(70);
    const filled = createNumberViewportModel({
      value: number(SQRT_TWO, 0n),
      availableSlots: 18,
      logicalStart: far.logicalStart
    });
    expect(filled.logicalStart).toBe(19n);
    expect(filled.text).toBe("..8016887242096E-31");
  });

  it("bounds work by visual slots and keeps zero metadata distinct", () => {
    expect(initialViewportPrecisionDemand(18)).toBe(18);
    expect(() => initialViewportPrecisionDemand(1000)).toThrow(RangeError);
    expect(() =>
      createNumberViewportModel({ value: exact("1", 0n), availableSlots: 1000 })
    ).toThrow(RangeError);
    const exactZero = createNumberViewportModel({ value: zero("exact"), availableSlots: 12 });
    const roundedZero = createNumberViewportModel({ value: zero("rounded"), availableSlots: 12 });
    expect(exactZero.text.trim()).toBe("0");
    expect(exactZero.zeroKind).toBe("exact");
    expect(roundedZero.zeroKind).toBe("rounded");
  });

  it("does not present an unverified interval crossing zero as exact zero", () => {
    const unresolved: VerifiedNumberDto = {
      sign: 0,
      digits: "",
      exponent10: 0n,
      verifiedDigits: 0,
      valueExact: false,
      decimalTerminating: false,
      rounded: false
    };
    const view = createNumberViewportModel({ value: unresolved, availableSlots: 18 });
    expect(view.representation).toBe("pending");
    expect(view.text).toBe(" ".repeat(18));
    expect(view.slots).toHaveLength(18);
    expect(view.precisionDemand).toBe(18);

    const knownMagnitude = createNumberViewportModel({
      value: { ...unresolved, sign: 1, exponent10: 23n },
      availableSlots: 18
    });
    expect(knownMagnitude.representation).toBe("scientific");
    expect(knownMagnitude.slots.some((slot) => slot.kind === "placeholder")).toBe(true);
    expect(knownMagnitude.precisionDemand).toBeGreaterThan(0);
  });
});

function number(digits: string, exponent10: bigint, sign: -1 | 1 = 1): VerifiedNumberDto {
  return {
    sign,
    digits,
    exponent10,
    verifiedDigits: digits.length,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  };
}

function exact(digits: string, exponent10: bigint): VerifiedNumberDto {
  return {
    ...number(digits, exponent10),
    valueExact: true,
    decimalTerminating: true
  };
}

function zero(zeroKind: "exact" | "rounded"): VerifiedNumberDto {
  return {
    ...exact("0", 0n),
    sign: 0,
    rounded: zeroKind === "rounded",
    zeroKind
  };
}
