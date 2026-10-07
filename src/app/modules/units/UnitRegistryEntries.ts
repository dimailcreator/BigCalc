import { unitDimensions as d } from "./UnitDimensions.js";
import type { UnitDimensions } from "./UnitDimensions.js";
import {
  rationalScale as r,
  decimalScale,
  PI_SCALE,
  multiplyScales,
  divideScales
} from "./UnitExpression.js";
import type { UnitScale } from "./UnitExpression.js";
import type { UnitDefinition, UnitPrefix } from "./UnitRegistry.js";

function linear(
  id: string,
  symbols: string[],
  names: string[],
  dimensions: UnitDimensions,
  scale: UnitScale = r(1n),
  prefixes = true,
  convention = ""
): UnitDefinition {
  return Object.freeze({
    kind: "linear",
    id,
    symbols: Object.freeze(symbols),
    names: Object.freeze(names),
    dimensions,
    scale,
    prefixes,
    convention
  });
}
function affine(
  id: string,
  symbol: string,
  names: string[],
  inputOffset: UnitScale,
  scale: UnitScale
): UnitDefinition {
  return Object.freeze({
    kind: "affine",
    id,
    symbols: Object.freeze([symbol]),
    names: Object.freeze(names),
    dimensions: d(0n, 0n, 0n, 0n, 1n),
    prefixes: false,
    transform: Object.freeze({ inputOffset, scale }),
    convention: "Standalone absolute temperature; no delta-temperature syntax"
  });
}

/** Exactly the 59 accepted Stage 6 entries. Four quarantined entries remain excluded. */
export const BUILTIN_UNITS: readonly UnitDefinition[] = Object.freeze([
  linear("metre", ["m", "м"], ["meter", "metre", "метр"], d(1n)),
  linear("kilogram", ["kg", "кг"], ["kilogram", "килограмм"], d(0n, 1n), r(1n), false),
  linear("gram", ["g", "г"], ["gram", "gramm", "грамм"], d(0n, 1n), r(1n, 1000n)),
  linear("second", ["s", "с"], ["second", "секунда"], d(0n, 0n, 1n)),
  linear("ampere", ["A", "А"], ["ampere", "ампер"], d(0n, 0n, 0n, 1n)),
  linear("kelvin", ["K", "К"], ["kelvin", "кельвин"], d(0n, 0n, 0n, 0n, 1n), r(1n), false),
  linear("mole", ["mol", "моль"], ["mole", "моль"], d(0n, 0n, 0n, 0n, 0n, 1n)),
  linear("candela", ["cd", "кд"], ["candela", "кандела"], d(0n, 0n, 0n, 0n, 0n, 0n, 1n)),
  linear("minute", ["min", "мин"], ["minute", "минута"], d(0n, 0n, 1n), r(60n)),
  linear("hour", ["h", "ч"], ["hour", "час"], d(0n, 0n, 1n), r(3600n)),
  linear(
    "day",
    ["d"],
    ["day", "сутки", "день"],
    d(0n, 0n, 1n),
    r(86400n),
    true,
    "Fixed 86400-second day; no calendar arithmetic"
  ),
  linear("week", ["wk"], ["week", "неделя"], d(0n, 0n, 1n), r(604800n)),
  linear(
    "year",
    ["yr", "год"],
    ["year", "год"],
    d(0n, 0n, 1n),
    r(31557600n),
    true,
    "Julian year: 365.25 fixed days"
  ),
  linear(
    "foot",
    ["ft"],
    ["foot", "feet", "фут"],
    d(1n),
    r(381n, 1250n),
    true,
    "International foot"
  ),
  linear("inch", ["in"], ["inch", "дюйм"], d(1n), r(127n, 5000n), true, "International inch"),
  linear(
    "yard",
    ["yd", "ярд"],
    ["yard", "ярд"],
    d(1n),
    r(1143n, 1250n),
    true,
    "International yard"
  ),
  linear("mile", ["mi"], ["mile", "миля"], d(1n), r(1609344n, 1000n), true, "International mile"),
  linear(
    "nautical-mile",
    ["nmi"],
    ["nauticalmile", "морскаямиля"],
    d(1n),
    r(1852n),
    true,
    "International nautical mile"
  ),
  linear("astronomical-unit", ["au"], ["astronomicalunit", "ае", "а.е."], d(1n), r(149597870700n)),
  linear(
    "light-year",
    ["ly"],
    ["lightyear", "световойгод"],
    d(1n),
    r(9460730472580800n),
    true,
    "Julian light-year: 299792458 * 31557600 metres"
  ),
  linear(
    "parsec",
    ["pc"],
    ["parsec", "парсек"],
    d(1n),
    divideScales(multiplyScales(r(149597870700n), r(648000n)), PI_SCALE)
  ),
  linear("angstrom", ["Å", "Å"], ["angstrom", "ангстрем"], d(1n), decimalScale(-10n)),
  linear("litre", ["L", "л"], ["liter", "litre", "литр"], d(3n), r(1n, 1000n)),
  linear("hectare", ["ha"], ["hectare", "гектар"], d(2n), r(10000n)),
  linear(
    "tonne",
    ["t", "т"],
    ["tonne", "ton", "тонна"],
    d(0n, 1n),
    r(1000n),
    true,
    "Metric tonne; not short/long ton"
  ),
  linear(
    "pound",
    ["lb"],
    ["pound", "фунт"],
    d(0n, 1n),
    r(45359237n, 100000000n),
    true,
    "Avoirdupois pound"
  ),
  linear(
    "ounce",
    ["oz"],
    ["ounce", "унция"],
    d(0n, 1n),
    r(45359237n, 1600000000n),
    true,
    "Avoirdupois ounce; not fluid/troy ounce"
  ),
  linear("one", ["1"], ["ed", "ед"], d()),
  linear("degree", ["°"], ["deg", "градус", "гр"], d(), divideScales(PI_SCALE, r(180n))),
  linear("radian", ["rad"], ["radian", "радиан", "рад"], d()),
  linear("steradian", ["sr"], ["steradian", "стерадиан"], d()),
  linear("percent", ["%"], ["percent", "процент"], d(), r(1n, 100n)),
  linear("newton", ["N", "Н"], ["newton", "ньютон"], d(1n, 1n, -2n)),
  linear("pascal", ["Pa", "Па"], ["pascal", "паскаль"], d(-1n, 1n, -2n)),
  linear("joule", ["J", "Дж"], ["joule", "джоуль"], d(2n, 1n, -2n)),
  linear("watt", ["W", "Вт"], ["watt", "ватт"], d(2n, 1n, -3n)),
  linear("hertz", ["Hz", "Гц"], ["hertz", "герц"], d(0n, 0n, -1n)),
  linear(
    "electronvolt",
    ["eV", "эВ"],
    ["electronvolt", "электронвольт"],
    d(2n, 1n, -2n),
    r(1602176634n, 10n ** 28n)
  ),
  linear(
    "calorie",
    ["cal", "кал"],
    ["calorie", "caloria", "калория"],
    d(2n, 1n, -2n),
    r(523n, 125n),
    true,
    "Thermochemical calorie; not IT calorie"
  ),
  linear(
    "kilocalorie",
    ["kcal", "ккал"],
    ["kilocalorie", "килокалория"],
    d(2n, 1n, -2n),
    r(4184n),
    false,
    "Thermochemical kilocalorie"
  ),
  linear("bar", ["bar"], ["bar", "бар"], d(-1n, 1n, -2n), r(100000n)),
  linear(
    "atmosphere",
    ["atm"],
    ["atmosphere", "атм", "атмосфера"],
    d(-1n, 1n, -2n),
    r(101325n),
    true,
    "Standard atmosphere; not technical atmosphere"
  ),
  linear("coulomb", ["C", "Кл"], ["coulomb", "кулон"], d(0n, 0n, 1n, 1n)),
  linear("volt", ["V", "В"], ["volt", "вольт"], d(2n, 1n, -3n, -1n)),
  linear("farad", ["F", "Ф"], ["farad", "фарад"], d(-2n, -1n, 4n, 2n)),
  linear("ohm", ["Ω", "Ohm", "Ом"], ["ohm", "ом"], d(2n, 1n, -3n, -2n)),
  linear("siemens", ["S", "См"], ["siemens", "сименс"], d(-2n, -1n, 3n, 2n)),
  linear("weber", ["Wb", "Вб"], ["weber", "вебер"], d(2n, 1n, -2n, -1n)),
  linear("tesla", ["T", "Тл"], ["tesla", "тесла"], d(0n, 1n, -2n, -1n)),
  linear("henry", ["H", "Гн"], ["henry", "генри"], d(2n, 1n, -2n, -2n)),
  linear("lumen", ["lm", "лм"], ["lumen", "люмен"], d(0n, 0n, 0n, 0n, 0n, 0n, 1n)),
  linear("lux", ["lx", "лк"], ["lux", "люкс"], d(-2n, 0n, 0n, 0n, 0n, 0n, 1n)),
  linear("becquerel", ["Bq", "Бк"], ["becquerel", "беккерель"], d(0n, 0n, -1n)),
  linear("gray", ["Gy", "Гр"], ["gray", "грей"], d(2n, 0n, -2n)),
  linear("sievert", ["Sv", "Зв"], ["sievert", "зиверт"], d(2n, 0n, -2n)),
  linear("katal", ["kat", "кат"], ["katal", "катал"], d(0n, 0n, -1n, 0n, 0n, 1n)),
  affine("celsius", "°C", ["celsius", "degc", "цельсий"], r(27315n, 100n), r(1n)),
  affine("fahrenheit", "°F", ["fahrenheit", "degf", "фаренгейт"], r(45967n, 100n), r(5n, 9n)),
  affine("rankine", "°R", ["rankine", "degr", "ранкин"], r(0n), r(5n, 9n))
]);

function prefix(id: string, power10: bigint, symbols: string[], names: string[]): UnitPrefix {
  return Object.freeze({
    id,
    power10,
    symbols: Object.freeze(symbols),
    names: Object.freeze(names)
  });
}
export const SI_PREFIXES: readonly UnitPrefix[] = Object.freeze([
  prefix("yotta", 24n, ["Y"], ["йотта", "иотта"]),
  prefix("zetta", 21n, ["Z"], ["зетта"]),
  prefix("exa", 18n, ["E"], ["экса"]),
  prefix("peta", 15n, ["P"], ["пета"]),
  prefix("tera", 12n, ["T"], ["тера"]),
  prefix("giga", 9n, ["G"], ["гига"]),
  prefix("mega", 6n, ["M"], ["мега"]),
  prefix("kilo", 3n, ["k", "к"], ["кило"]),
  prefix("hecto", 2n, ["h"], ["гекто"]),
  prefix("deca", 1n, ["da"], ["дека"]),
  prefix("deci", -1n, ["d", "д"], ["деци"]),
  prefix("centi", -2n, ["c", "с"], ["санти"]),
  prefix("milli", -3n, ["m", "м"], ["милли"]),
  prefix("micro", -6n, ["u", "µ", "μ"], ["микро"]),
  prefix("nano", -9n, ["n", "н"], ["нано"]),
  prefix("pico", -12n, ["p", "п"], ["пико"]),
  prefix("femto", -15n, ["f", "ф"], ["фемто"]),
  prefix("atto", -18n, ["a", "а"], ["атто"]),
  prefix("zepto", -21n, ["z", "з"], ["зепто"]),
  prefix("yocto", -24n, ["y", "й"], ["йокто"])
]);
