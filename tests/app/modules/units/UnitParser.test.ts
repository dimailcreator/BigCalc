import { describe, expect, it } from "vitest";
import { parseUnitExpression as parse } from "../../../../src/app/modules/units/UnitParser.js";
import { unitDimensions as d } from "../../../../src/app/modules/units/UnitDimensions.js";
import { compileUnitScale } from "../../../../src/app/modules/units/UnitExpression.js";
import type { UnitDomainErrorCode } from "../../../../src/app/modules/units/UnitErrors.js";
import { expectExactFactor, expectUnitError } from "./UnitFactorTestHelpers.js";

const valid = [
  ["m", d(1n), 1n, 1n],
  ["м", d(1n), 1n, 1n],
  ["метр", d(1n), 1n, 1n],
  ["meter", d(1n), 1n, 1n],
  ["km", d(1n), 1000n, 1n],
  ["километр", d(1n), 1000n, 1n],
  ["μm", d(1n), 1n, 1000000n],
  ["µm", d(1n), 1n, 1000000n],
  ["км/ч", d(1n, 0n, -1n), 5n, 18n],
  ["m/s", d(1n, 0n, -1n), 1n, 1n],
  ["Дж/Вт", d(0n, 0n, 1n), 1n, 1n],
  ["кДж*ч/Дж", d(0n, 0n, 1n), 3600000n, 1n],
  ["(Н*м)/Дж", d(), 1n, 1n],
  ["санти-ярд/кило-год", d(1n, 0n, -1n), 1143n, 125000000n * 31557600n],
  ["m^2", d(2n), 1n, 1n],
  ["m^-2", d(-2n), 1n, 1n],
  ["m^+2", d(2n), 1n, 1n],
  ["с^-2", d(0n, 0n, -2n), 1n, 1n],
  ["м^0", d(), 1n, 1n],
  ["см^-2", d(-2n), 10000n, 1n],
  ["((kg*m)/(s^2))", d(1n, 1n, -2n), 1n, 1n],
  ["м с", d(1n, 0n, 1n), 1n, 1n],
  ["мс", d(0n, 0n, 1n), 1n, 1000n],
  ["м / с", d(1n, 0n, -1n), 1n, 1n],
  ["m × s", d(1n, 0n, 1n), 1n, 1n],
  ["m·s", d(1n, 0n, 1n), 1n, 1n],
  ["m÷s", d(1n, 0n, -1n), 1n, 1n],
  ["m\n\t(s)", d(1n, 0n, 1n), 1n, 1n],
  ["m/s s", d(1n), 1n, 1n],
  ["m/s/s", d(1n, 0n, -2n), 1n, 1n],
  ["m/(s s)", d(1n, 0n, -2n), 1n, 1n],
  ["m ^ -2", d(-2n), 1n, 1n],
  ["(m^2)^3", d(6n), 1n, 1n],
  ["1", d(), 1n, 1n],
  ["%", d(), 1n, 100n],
  ["K*m/m", d(0n, 0n, 0n, 0n, 1n), 1n, 1n],
  ["K^1", d(0n, 0n, 0n, 0n, 1n), 1n, 1n],
  ["(m) (s)", d(1n, 0n, 1n), 1n, 1n]
] as const;
const invalid: readonly (readonly [string, UnitDomainErrorCode])[] = [
  ["", "EmptyExpression"],
  [" \n\t", "EmptyExpression"],
  ["wat", "UnknownUnit"],
  ["m*", "UnexpectedToken"],
  ["m / / s", "UnexpectedToken"],
  ["m + s", "UnexpectedToken"],
  ["2 m", "UnexpectedToken"],
  ["1.5", "UnexpectedToken"],
  ["-1", "UnexpectedToken"],
  ["+1", "UnexpectedToken"],
  ["(m", "UnclosedParenthesis"],
  ["(", "UnclosedParenthesis"],
  ["((m)", "UnclosedParenthesis"],
  ["m)", "ExtraParenthesis"],
  [")", "ExtraParenthesis"],
  ["()", "ExtraParenthesis"],
  ["m^", "MissingExponent"],
  ["m^ /s", "MissingExponent"],
  ["(m^)", "MissingExponent"],
  ["m^1.5", "InvalidExponent"],
  ["m^1,5", "InvalidExponent"],
  ["m^1e2", "InvalidExponent"],
  ["m^(2)", "InvalidExponent"],
  ["m^2^3", "InvalidExponent"],
  ["m^- 2", "InvalidExponent"],
  ["m^2s", "InvalidExponent"],
  ["m(s)", "UnexpectedToken"],
  ["(m)(s)", "UnexpectedToken"],
  ["(m)s", "UnexpectedToken"],
  ["°C*1", "AffineInProduct"],
  ["1*°C", "AffineInProduct"],
  ["m °C", "AffineInProduct"],
  ["°F/°F", "AffineInQuotient"],
  ["1/°R", "AffineInQuotient"],
  ["°C/s", "AffineInQuotient"],
  ["°C^1", "AffinePower"],
  ["°C^0", "AffinePower"],
  ["(°R)^-2", "AffinePower"],
  ["к°C", "PrefixOnAffine"],
  ["k°F", "PrefixOnAffine"],
  ["кило-цельсий", "PrefixOnAffine"],
  ["m°R", "PrefixOnAffine"],
  ["kK", "PrefixNotAllowed"],
  ["mkg", "PrefixNotAllowed"],
  ["sqrt(m)", "UnknownUnit"],
  ["sin(m)", "UnknownUnit"],
  ["морская миля", "UnknownUnit"]
];

describe("unit-expression grammar and dimensional values", () => {
  it.each([
    ["км/ч", "м/с"],
    ["Дж/Вт", "с"],
    ["кДж*ч/Дж", "с"],
    ["санти-ярд/кило-год", "м/с"],
    ["°C", "K"],
    ["bar", "Pa"]
  ] as const)(
    "prototype example %s → %s parses compatible dimensions without calculation",
    (from, to) => {
      expect(parse(from).value.dimensions).toEqual(parse(to).value.dimensions);
    }
  );
  it.each(valid)(
    "%s: exact dimensions and factor",
    (source, dimensions, numerator, denominator) => {
      const result = parse(source);
      expect(result.value.kind).toBe("linear");
      if (result.value.kind !== "linear") throw new Error("Expected a linear value");
      expect(result.source).toBe(source);
      expect(result.value.dimensions).toEqual(dimensions);
      expectExactFactor(result.value.scale, numerator, denominator);
      expect(compileUnitScale(result.value.scale)).toMatch(/^[0-9π()+\-*/^]+$/u);
    }
  );
  it.each(invalid)("%s rejects with %s", (source, code) => {
    expectUnitError(() => parse(source), { code });
  });
  it.each(["°C", "(°F)", "((°R))", "цельсий", "FAHRENHEIT", "ранкин"])(
    "%s remains standalone affine",
    (source) => {
      const result = parse(source);
      expect(result.value.kind).toBe("affine");
      expect(result.value.dimensions).toEqual(d(0n, 0n, 0n, 0n, 1n));
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  );
  it("keeps standalone temperature identity distinct from dimension-equivalent compounds/powers", () => {
    expect(parse("((K))").value.standaloneUnitId).toBe("kelvin");
    expect(parse("K*m/m").value.standaloneUnitId).toBeNull();
    expect(parse("K^1").value.standaloneUnitId).toBeNull();
    expect(parse("K*1").value.standaloneUnitId).toBeNull();
  });
  it("retains exact symbolic degree/parsec factors, without interpreting them or angle settings", () => {
    const degree = parse("°").value;
    const parsec = parse("pc").value;
    if (degree.kind !== "linear" || parsec.kind !== "linear")
      throw new Error("Expected linear values");
    expect(compileUnitScale(degree.scale)).toBe("(π)/(180)");
    expect(compileUnitScale(parsec.scale)).toBe("(96939420213600000)/(π)");
  });
  it("keeps original source and UTF-16 error ranges through whitespace/NFC/name normalization", () => {
    const source = "  Å / КИЛО_МЕТР  ";
    expect(parse(source).source).toBe(source);
    expectUnitError(() => parse("  м / unknown "), {
      code: "UnknownUnit",
      range: { start: 6, end: 13 }
    });
    expectUnitError(() => parse("м ^ 1.5"), {
      code: "InvalidExponent",
      range: { start: 4, end: 7 }
    });
    expectUnitError(() => parse("  (м"), {
      code: "UnclosedParenthesis",
      range: { start: 2, end: 3 }
    });
  });
  it("stores parsed syntax/value/ranges immutably and identifies left-associative operators", () => {
    const result = parse("m/s s");
    expect(result.syntax.kind).toBe("product");
    if (result.syntax.kind !== "product") throw new Error("Expected product");
    expect(result.syntax.left.kind).toBe("quotient");
    expect(result.syntax.range).toEqual({ start: 0, end: 5 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.syntax)).toBe(true);
    expect(Object.isFrozen(result.syntax.range)).toBe(true);
    expect(Object.isFrozen(result.value.dimensions)).toBe(true);
  });
  it("parses arbitrary exact signed exponents without JavaScript number coercion", () => {
    const exponent = 900719925474099312345678901234567890n;
    const result = parse(`km^-${String(exponent)}`);
    expect(result.value.dimensions).toEqual(d(-exponent));
    if (result.value.kind !== "linear") throw new Error("Expected linear value");
    expect(compileUnitScale(result.value.scale)).toBe(`(((10)^(3))*(1))^(-${String(exponent)})`);
  });
});
