import { describe, expect, it } from "vitest";
import {
  formatCalculationError,
  formatTemporaryResult
} from "../../../src/app/calculator/TemporaryResultFormatter.js";
import type {
  CalcErrorDto,
  VerifiedNumberDto
} from "../../../src/app/calculation/CalculationProtocol.js";

describe("temporary result formatting", () => {
  it("renders exact, periodic, small, and scientific values without inventing digits", () => {
    expect(formatTemporaryResult(number({ digits: "5", exact: true }))).toBe("5");
    expect(formatTemporaryResult(number({ digits: "333333", exponent10: -1n }))).toBe(
      "0,333333..."
    );
    expect(formatTemporaryResult(number({ digits: "4", exponent10: -4n, exact: true }))).toBe(
      "0,0004"
    );
    expect(formatTemporaryResult(number({ digits: "12", exponent10: 15n }))).toBe("1,2E15");
  });

  it("keeps exact and rounded zero distinct", () => {
    expect(formatTemporaryResult(zero("exact"))).toBe("0");
    expect(formatTemporaryResult(zero("rounded"))).toBe("...0");
  });

  it("maps explicit Core errors to application text", () => {
    const divisionByZero: CalcErrorDto = {
      kind: "calc-error",
      code: "DivisionByZeroError",
      message: "Division by zero"
    };
    const syntax: CalcErrorDto = {
      kind: "calc-error",
      code: "SyntaxError",
      message: "Unexpected token"
    };

    expect(formatCalculationError(divisionByZero)).toBe("Деление на ноль запрещено");
    expect(formatCalculationError(syntax)).toBe("Ошибка синтаксиса");
  });
});

function number(options: {
  readonly digits: string;
  readonly exponent10?: bigint;
  readonly exact?: boolean;
}): VerifiedNumberDto {
  return {
    sign: 1,
    digits: options.digits,
    exponent10: options.exponent10 ?? 0n,
    verifiedDigits: options.digits.length,
    valueExact: options.exact ?? false,
    decimalTerminating: options.exact ?? false,
    rounded: false
  };
}

function zero(zeroKind: "exact" | "rounded"): VerifiedNumberDto {
  return {
    sign: 0,
    digits: "",
    exponent10: 0n,
    verifiedDigits: 0,
    valueExact: zeroKind === "exact",
    decimalTerminating: true,
    rounded: zeroKind === "rounded",
    zeroKind
  };
}
