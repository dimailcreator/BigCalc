import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_REGISTRY as registry,
  UnitRegistry
} from "../../../../src/app/modules/units/UnitRegistry.js";
import type { UnitDefinition, UnitPrefix } from "../../../../src/app/modules/units/UnitRegistry.js";
import {
  BUILTIN_UNITS,
  SI_PREFIXES
} from "../../../../src/app/modules/units/UnitRegistryEntries.js";
import { unitDimensions as d } from "../../../../src/app/modules/units/UnitDimensions.js";
import {
  rationalScale as r,
  compileUnitScale
} from "../../../../src/app/modules/units/UnitExpression.js";
import {
  UnitDomainError,
  UnitRegistryConfigurationError
} from "../../../../src/app/modules/units/UnitErrors.js";
import { expectExactFactor, expectUnitError } from "./UnitFactorTestHelpers.js";

// Independent inventory expectations transcribed from the Stage 6 decision ledger.
const accepted = [
  ["m", "metre", d(1n), "1"],
  ["kg", "kilogram", d(0n, 1n), "1"],
  ["g", "gram", d(0n, 1n), "(1/1000)"],
  ["s", "second", d(0n, 0n, 1n), "1"],
  ["A", "ampere", d(0n, 0n, 0n, 1n), "1"],
  ["K", "kelvin", d(0n, 0n, 0n, 0n, 1n), "1"],
  ["mol", "mole", d(0n, 0n, 0n, 0n, 0n, 1n), "1"],
  ["cd", "candela", d(0n, 0n, 0n, 0n, 0n, 0n, 1n), "1"],
  ["min", "minute", d(0n, 0n, 1n), "60"],
  ["h", "hour", d(0n, 0n, 1n), "3600"],
  ["d", "day", d(0n, 0n, 1n), "86400"],
  ["wk", "week", d(0n, 0n, 1n), "604800"],
  ["yr", "year", d(0n, 0n, 1n), "31557600"],
  ["ft", "foot", d(1n), "(381/1250)"],
  ["in", "inch", d(1n), "(127/5000)"],
  ["yd", "yard", d(1n), "(1143/1250)"],
  ["mi", "mile", d(1n), "(201168/125)"],
  ["nmi", "nautical-mile", d(1n), "1852"],
  ["au", "astronomical-unit", d(1n), "149597870700"],
  ["ly", "light-year", d(1n), "9460730472580800"],
  ["pc", "parsec", d(1n), "(96939420213600000)/(π)"],
  ["Å", "angstrom", d(1n), "(10)^(-10)"],
  ["L", "litre", d(3n), "(1/1000)"],
  ["ha", "hectare", d(2n), "10000"],
  ["t", "tonne", d(0n, 1n), "1000"],
  ["lb", "pound", d(0n, 1n), "(45359237/100000000)"],
  ["oz", "ounce", d(0n, 1n), "(45359237/1600000000)"],
  ["1", "one", d(), "1"],
  ["°", "degree", d(), "(π)/(180)"],
  ["rad", "radian", d(), "1"],
  ["sr", "steradian", d(), "1"],
  ["%", "percent", d(), "(1/100)"],
  ["N", "newton", d(1n, 1n, -2n), "1"],
  ["Pa", "pascal", d(-1n, 1n, -2n), "1"],
  ["J", "joule", d(2n, 1n, -2n), "1"],
  ["W", "watt", d(2n, 1n, -3n), "1"],
  ["Hz", "hertz", d(0n, 0n, -1n), "1"],
  ["eV", "electronvolt", d(2n, 1n, -2n), "(801088317/5000000000000000000000000000)"],
  ["cal", "calorie", d(2n, 1n, -2n), "(523/125)"],
  ["kcal", "kilocalorie", d(2n, 1n, -2n), "4184"],
  ["bar", "bar", d(-1n, 1n, -2n), "100000"],
  ["atm", "atmosphere", d(-1n, 1n, -2n), "101325"],
  ["C", "coulomb", d(0n, 0n, 1n, 1n), "1"],
  ["V", "volt", d(2n, 1n, -3n, -1n), "1"],
  ["F", "farad", d(-2n, -1n, 4n, 2n), "1"],
  ["Ω", "ohm", d(2n, 1n, -3n, -2n), "1"],
  ["S", "siemens", d(-2n, -1n, 3n, 2n), "1"],
  ["Wb", "weber", d(2n, 1n, -2n, -1n), "1"],
  ["T", "tesla", d(0n, 1n, -2n, -1n), "1"],
  ["H", "henry", d(2n, 1n, -2n, -2n), "1"],
  ["lm", "lumen", d(0n, 0n, 0n, 0n, 0n, 0n, 1n), "1"],
  ["lx", "lux", d(-2n, 0n, 0n, 0n, 0n, 0n, 1n), "1"],
  ["Bq", "becquerel", d(0n, 0n, -1n), "1"],
  ["Gy", "gray", d(2n, 0n, -2n), "1"],
  ["Sv", "sievert", d(2n, 0n, -2n), "1"],
  ["kat", "katal", d(0n, 0n, -1n, 0n, 0n, 1n), "1"],
  ["°C", "celsius", d(0n, 0n, 0n, 0n, 1n), "(5463/20);1"],
  ["°F", "fahrenheit", d(0n, 0n, 0n, 0n, 1n), "(45967/100);(5/9)"],
  ["°R", "rankine", d(0n, 0n, 0n, 0n, 1n), "0;(5/9)"]
] as const;
const prefixes = [
  ["Y", "yotta", 24n],
  ["Z", "zetta", 21n],
  ["E", "exa", 18n],
  ["P", "peta", 15n],
  ["T", "tera", 12n],
  ["G", "giga", 9n],
  ["M", "mega", 6n],
  ["k", "kilo", 3n],
  ["h", "hecto", 2n],
  ["da", "deca", 1n],
  ["d", "deci", -1n],
  ["c", "centi", -2n],
  ["m", "milli", -3n],
  ["µ", "micro", -6n],
  ["n", "nano", -9n],
  ["p", "pico", -12n],
  ["f", "femto", -15n],
  ["a", "atto", -18n],
  ["z", "zepto", -21n],
  ["y", "yocto", -24n]
] as const;
function fixture(id: string, symbols: string[], names: string[] = []): UnitDefinition {
  return {
    kind: "linear",
    id,
    symbols,
    names,
    dimensions: d(1n),
    scale: r(1n),
    prefixes: true,
    convention: "Test fixture"
  };
}

describe("audited exact registry", () => {
  it("contains exactly 59 accepted definitions and 20 audited prefixes with unique identities", () => {
    expect(BUILTIN_UNITS).toHaveLength(59);
    expect(accepted).toHaveLength(59);
    expect(registry.entries.map((unit) => unit.id)).toEqual(accepted.map(([, id]) => id));
    expect(SI_PREFIXES).toHaveLength(20);
    expect(new Set(registry.entries.map((unit) => unit.id)).size).toBe(59);
  });
  it.each(accepted)(
    "%s: identity, full dimension vector and exact scale/transform",
    (symbol, id, dimensions, source) => {
      const unit = registry.resolve(symbol);
      expect(unit.prefix).toBeNull();
      expect(unit.definition.id).toBe(id);
      expect(unit.definition.dimensions).toEqual(dimensions);
      const definition = unit.definition;
      const compiled =
        definition.kind === "linear"
          ? compileUnitScale(definition.scale)
          : `${compileUnitScale(definition.transform.inputOffset)};${compileUnitScale(definition.transform.scale)}`;
      expect(compiled).toBe(source);
    }
  );
  it.each(prefixes)("%s: exact %s prefix power %s", (symbol, id, power) => {
    const unit = registry.resolve(symbol + "m");
    expect(unit.prefix?.id).toBe(id);
    expect(unit.prefix?.power10).toBe(power);
    expectExactFactor(unit.scale, power < 0n ? 1n : 10n ** power, power < 0n ? 10n ** -power : 1n);
    const prefix = SI_PREFIXES.find((entry) => entry.id === id);
    if (!prefix) throw new Error("Missing prefix");
    for (const alias of [...prefix.symbols, ...prefix.names]) {
      const resolved = registry.resolve(alias + "метр");
      expect(resolved.prefix?.id).toBe(id);
      expectExactFactor(
        resolved.scale,
        power < 0n ? 1n : 10n ** power,
        power < 0n ? 10n ** -power : 1n
      );
    }
  });
  it.each([
    ["м", "metre"],
    ["метр", "metre"],
    ["METER", "metre"],
    ["metre", "metre"],
    ["километр", "metre"],
    ["КИЛО-МЕТР", "metre"],
    ["кило_метр", "metre"],
    ["μm", "metre"],
    ["µm", "metre"],
    ["um", "metre"],
    ["Å", "angstrom"],
    ["Гр", "gray"],
    ["гр", "degree"],
    ["См", "siemens"],
    ["см", "metre"],
    ["ньютон", "newton"],
    ["ДЖОУЛЬ", "joule"],
    ["электронвольт", "electronvolt"],
    ["морская-миля", "nautical-mile"],
    ["световой_год", "light-year"],
    ["а.е.", "astronomical-unit"],
    ["ае", "astronomical-unit"],
    ["кельвин", "kelvin"],
    ["ЦЕЛЬСИЙ", "celsius"],
    ["fahrenheit", "fahrenheit"],
    ["rankine", "rankine"]
  ] as const)("localized/normalized alias %s resolves to %s", (alias, id) => {
    expect(registry.resolve(alias).definition.id).toBe(id);
  });
  it("resolves every declared alias and does not change its symbols into names", () => {
    for (const unit of registry.entries)
      for (const alias of [...unit.symbols, ...unit.names])
        expect(registry.resolve(alias).definition.id).toBe(unit.id);
    for (const alias of [
      "M",
      "a",
      "å",
      "w",
      "j",
      "pa",
      "hz",
      "морская миля",
      "а..е.",
      "-meter",
      "meter-",
      "Mn",
      "Мн",
      "Manya",
      "Маня",
      "Dal",
      "Дал",
      "mth",
      "month",
      "месяц",
      "мсц",
      "u",
      "amu",
      "atomicmassunit",
      "аедм",
      "Qm",
      "Rm",
      "qm",
      "rm",
      "Kim",
      "kilometer",
      "centiyard"
    ])
      expect(() => registry.resolve(alias)).toThrow(UnitDomainError);
  });
  it("keeps complete symbols above names/prefixes and retains all prefix case distinctions", () => {
    for (const [symbol, id] of [
      ["min", "minute"],
      ["h", "hour"],
      ["d", "day"],
      ["T", "tesla"],
      ["A", "ampere"],
      ["kg", "kilogram"],
      ["кг", "kilogram"],
      ["kcal", "kilocalorie"],
      ["ккал", "kilocalorie"]
    ])
      expect(registry.resolve(symbol ?? "").definition.id).toBe(id);
    for (const [alias, numerator, denominator] of [
      ["Mm", 1000000n, 1n],
      ["mm", 1n, 1000n],
      ["Pm", 10n ** 15n, 1n],
      ["pm", 1n, 10n ** 12n],
      ["Zm", 10n ** 21n, 1n],
      ["zm", 1n, 10n ** 21n],
      ["Ym", 10n ** 24n, 1n],
      ["ym", 1n, 10n ** 24n]
    ] as const)
      expectExactFactor(registry.resolve(alias).scale, numerator, denominator);
    expectExactFactor(registry.resolve("dam").scale, 10n);
    expectExactFactor(registry.resolve("dm").scale, 1n, 10n);
    expectExactFactor(registry.resolve("кграмм").scale, 1n);
    expectExactFactor(registry.resolve("ккалория").scale, 4184n);
    // Spelled-out prefixes must preserve the remainder's symbol case.
    expect(registry.resolve("килоСм").definition.id).toBe("siemens");
    expect(registry.resolve("килограмм").definition.id).toBe("kilogram");
  });
  it.each(["kkg", "мкг", "mkcal", "kkcal", "kK", "кило-кельвин"])(
    "rejects forbidden prefix %s",
    (alias) => {
      expectUnitError(() => registry.resolve(alias), { code: "PrefixNotAllowed" });
    }
  );
  it.each(["kkm", "mkm", "килокилометр", "k", "да", "микро"])(
    "rejects stacked/missing prefix remainder %s",
    (alias) => {
      expect(() => registry.resolve(alias)).toThrow(UnitDomainError);
    }
  );
  it("rejects duplicate IDs and normalized alias collisions instead of insertion-order overwrite", () => {
    expectUnitError(
      () => new UnitRegistry([fixture("x", ["x"]), fixture("x", ["y"])]),
      { code: "DuplicateId" },
      UnitRegistryConfigurationError
    );
    for (const order of [false, true]) {
      const units = [fixture("x", ["x"], ["ёлка-тест"]), fixture("y", ["y"], ["ЕЛКА_ТЕСТ"])];
      expect(() => new UnitRegistry(order ? units.reverse() : units)).toThrow(
        UnitRegistryConfigurationError
      );
      expectUnitError(
        () => new UnitRegistry([fixture("x", ["Å"]), fixture("y", ["Å"])]),
        { code: "AmbiguousAlias" },
        UnitRegistryConfigurationError
      );
    }
    expectUnitError(
      () => new UnitRegistry([fixture("x", ["x"], ["one word"])]),
      { code: "InvalidDefinition" },
      UnitRegistryConfigurationError
    );
  });
  it("accepts duplicate aliases for the same identity and applies symbol-before-name priority", () => {
    const custom = new UnitRegistry([
      fixture("x", ["x", "x"], ["test", "TEST"]),
      fixture("y", ["test"], ["other"])
    ]);
    expect(custom.resolve("test").definition.id).toBe("y");
    expect(custom.resolve("TEST").definition.id).toBe("x");
  });
  it("uses longest valid prefix and reports distinct same-tier candidates as typed ambiguity", () => {
    const customPrefixes: UnitPrefix[] = [
      { id: "short", power10: 1n, symbols: ["a"], names: [] },
      { id: "long", power10: 2n, symbols: ["ab"], names: [] }
    ];
    for (const order of [false, true]) {
      const custom = new UnitRegistry(
        [fixture("x", ["x"]), fixture("bx", ["bx"])],
        order ? [...customPrefixes].reverse() : customPrefixes
      );
      expect(custom.resolve("abx").definition.id).toBe("x");
      expect(custom.resolve("abx").prefix?.id).toBe("long");
    }
    const ambiguous = new UnitRegistry(
      [fixture("x", ["x"])],
      [
        { id: "symbol", power10: 1n, symbols: ["k"], names: [] },
        { id: "name", power10: 2n, symbols: [], names: ["k"] }
      ]
    );
    expectUnitError(() => ambiguous.resolve("kx"), {
      code: "AmbiguousAlias",
      range: { start: 0, end: 2 }
    });
  });
  it("normalizes ё/е and internal name separators without erasing syntax punctuation", () => {
    const custom = new UnitRegistry([fixture("x", ["x"], ["ёлка-тест", "а.е."])]);
    expect(custom.resolve("ЕЛКА_ТЕСТ").definition.id).toBe("x");
    expect(custom.resolve("ЁЛКА-ТЕСТ").definition.id).toBe("x");
    expect(custom.resolve("а.е.").definition.id).toBe("x");
    expect(() => custom.resolve("ае")).toThrow(UnitDomainError);
  });
  it("validates prefix ID and normalized alias collisions before resolution", () => {
    const prefix: UnitPrefix = { id: "p", power10: 1n, symbols: ["p"], names: ["ёлка"] };
    expectUnitError(
      () => new UnitRegistry([], [prefix, { ...prefix, symbols: ["q"] }]),
      { code: "DuplicateId" },
      UnitRegistryConfigurationError
    );
    expectUnitError(
      () => new UnitRegistry([], [prefix, { ...prefix, id: "q", symbols: ["q"], names: ["ЕЛКА"] }]),
      { code: "AmbiguousAlias" },
      UnitRegistryConfigurationError
    );
  });
  it("copies and freezes caller definitions so later mutations cannot alter resolution", () => {
    const symbols = ["x"];
    const names = ["test"];
    const custom = new UnitRegistry([fixture("x", symbols, names)]);
    symbols[0] = "y";
    names[0] = "other";
    expect(custom.resolve("x").definition.names).toEqual(["test"]);
    expect(() => custom.resolve("y")).toThrow(UnitDomainError);
    expect(Object.isFrozen(custom.entries)).toBe(true);
    expect(Object.isFrozen(custom.entries[0]?.dimensions)).toBe(true);
    expect(Object.isFrozen(custom.entries[0]?.symbols)).toBe(true);
  });
});
