# Units prototype registry audit — Stage 6

Date: 2026-10-06 (Europe/Moscow). This is a review/decision ledger, not a production registry. Reference inspected: `C:\Users\mmole\Downloads\calc.html`, 34 382 bytes, SHA-256 `548d6c5119c25c364fca78a88ab4a0bcaefb080105314796a49c9c9790a48ede`. The prototype is outside the repository; identity and inventory below make the review traceable without treating its executable code as an application dependency.

The registry block contains **63 `addUnit` entries and 20 decimal prefixes**. All entries, symbols and names are accounted for below. An isolated, read-only evaluation of that block confirmed three duplicate keys (`kg`, `wk`, `grad`); it did not run DOM handlers or the conversion UI. Prototype floating-point values are observations only, never authoritative production scale data.

Normative behavior is [UI_SPEC §43.6](../UI_SPEC.md). Prefix/direct precedence, conventional naming, signed integer powers and affine restrictions are explicitly specified there. Stage 10 must validate canonical identity, alias collisions and exact source generation before a registry is executable.

## Standard/conventional candidates

The following 59 prototype entries have recognizable definitions. They are production candidates subject to the exact representations and explicit conventions recorded here. Symbols remain case-sensitive; comma-separated names are aliases, not an invitation to invent arbitrary plurals. Dimension notation uses the seven-component SI vector, with omitted components zero. `J` in the vector means luminous intensity; the unit symbol J means joule.

| Prototype key       | Symbols                   | Name aliases                | Dimension         | Production scale / definition                                                      |
| ------------------- | ------------------------- | --------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| m                   | m, м                      | meter, metre, метр          | L                 | 1                                                                                  |
| kg (ordinary entry) | kg, кг                    | kilogram, килограмм         | M                 | 1; prefixes apply to g, not kg                                                     |
| g                   | g, г                      | gram, gramm, грамм          | M                 | 1/1000                                                                             |
| s                   | s, с                      | second, секунда             | T                 | 1                                                                                  |
| A                   | A, А                      | ampere, ампер               | I                 | 1                                                                                  |
| K                   | K, К                      | kelvin, кельвин             | Th                | 1; standalone temperature, no prefixes in v1                                       |
| mol                 | mol, моль                 | mole, моль                  | N                 | 1                                                                                  |
| cd                  | cd, кд                    | candela, кандела            | J                 | 1                                                                                  |
| min                 | min, мин                  | minute, минута              | T                 | 60                                                                                 |
| h                   | h, ч                      | hour, час                   | T                 | 3600                                                                               |
| d                   | d                         | day, сутки, день            | T                 | 86400; fixed duration, not calendar arithmetic                                     |
| wk (week entry)     | wk                        | week, неделя                | T                 | 604800                                                                             |
| yr                  | yr, год                   | year, год                   | T                 | 31557600; Julian year, explicitly 365.25 fixed days                                |
| ft                  | ft                        | foot, feet, фут             | L                 | 381/1250; international foot                                                       |
| in                  | in                        | inch, дюйм                  | L                 | 127/5000; international inch                                                       |
| yd                  | yd, ярд                   | yard, ярд                   | L                 | 1143/1250; international yard                                                      |
| mi                  | mi                        | mile, миля                  | L                 | 1609344/1000; international mile                                                   |
| nmi                 | nmi                       | nauticalmile, морскаямиля   | L                 | 1852; international nautical mile                                                  |
| au                  | au                        | astronomicalunit, ае, а.е.  | L                 | 149597870700                                                                       |
| ly                  | ly                        | lightyear, световойгод      | L                 | 9460730472580800 = 299792458 * 31557600; Julian light-year                         |
| pc                  | pc                        | parsec, парсек              | L                 | `149597870700 * 648000 / π`; reject the prototype rounded decimal as authoritative |
| Å                   | Å, Å (A + combining ring) | angstrom, ангстрем          | L                 | `10^-10`; NFC unifies the two symbols, not plain A                                 |
| L                   | L, л                      | liter, litre, литр          | L^3               | 1/1000                                                                             |
| ha                  | ha                        | hectare, гектар             | L^2               | 10000                                                                              |
| t                   | t, т                      | tonne, ton, тонна           | M                 | 1000; `ton` here means metric tonne, not short/long ton                            |
| lb                  | lb                        | pound, фунт                 | M                 | 45359237/100000000; avoirdupois pound                                              |
| oz                  | oz                        | ounce, унция                | M                 | 45359237/1600000000; avoirdupois ounce, not fluid/troy ounce                       |
| grad (unity entry)  | 1                         | ed, ед                      | dimensionless     | 1; distinct canonical ID `one`, not degree                                         |
| grad (degree entry) | °                         | deg, градус, гр             | dimensionless     | `π/180`; distinct canonical ID `degree`                                            |
| rad                 | rad                       | radian, радиан, рад         | dimensionless     | 1                                                                                  |
| sr                  | sr                        | steradian, стерадиан        | dimensionless     | 1                                                                                  |
| pct                 | %                         | percent, процент            | dimensionless     | 1/100; unit token, not Core's postfix syntax                                       |
| N                   | N, Н                      | newton, ньютон              | L M T^-2          | 1                                                                                  |
| Pa                  | Pa, Па                    | pascal, паскаль             | L^-1 M T^-2       | 1                                                                                  |
| J                   | J, Дж                     | joule, джоуль               | L^2 M T^-2        | 1                                                                                  |
| W                   | W, Вт                     | watt, ватт                  | L^2 M T^-3        | 1                                                                                  |
| Hz                  | Hz, Гц                    | hertz, герц                 | T^-1              | 1                                                                                  |
| eV                  | eV, эВ                    | electronvolt, электронвольт | L^2 M T^-2        | `1602176634 / 10^28`                                                               |
| cal                 | cal, кал                  | calorie, caloria, калория   | L^2 M T^-2        | 523/125; thermochemical calorie, not IT calorie                                    |
| kcal                | kcal, ккал                | kilocalorie, килокалория    | L^2 M T^-2        | 4184; direct spelling equals kilo + thermochemical cal; no second prefix           |
| bar                 | bar                       | bar, бар                    | L^-1 M T^-2       | 100000                                                                             |
| atm                 | atm                       | atmosphere, атм, атмосфера  | L^-1 M T^-2       | 101325; standard atmosphere, not technical atmosphere                              |
| C                   | C, Кл                     | coulomb, кулон              | T I               | 1                                                                                  |
| V                   | V, В                      | volt, вольт                 | L^2 M T^-3 I^-1   | 1                                                                                  |
| F                   | F, Ф                      | farad, фарад                | L^-2 M^-1 T^4 I^2 | 1                                                                                  |
| Ω                   | Ω, Ohm, Ом                | ohm, ом                     | L^2 M T^-3 I^-2   | 1                                                                                  |
| S                   | S, См                     | siemens, сименс             | L^-2 M^-1 T^3 I^2 | 1                                                                                  |
| Wb                  | Wb, Вб                    | weber, вебер                | L^2 M T^-2 I^-1   | 1                                                                                  |
| T                   | T, Тл                     | tesla, тесла                | M T^-2 I^-1       | 1                                                                                  |
| H                   | H, Гн                     | henry, генри                | L^2 M T^-2 I^-2   | 1                                                                                  |
| lm                  | lm, лм                    | lumen, люмен                | J                 | 1; solid angle dimensionless                                                       |
| lx                  | lx, лк                    | lux, люкс                   | L^-2 J            | 1                                                                                  |
| Bq                  | Bq, Бк                    | becquerel, беккерель        | T^-1              | 1                                                                                  |
| Gy                  | Gy, Гр                    | gray, грей                  | L^2 T^-2          | 1                                                                                  |
| Sv                  | Sv, Зв                    | sievert, зиверт             | L^2 T^-2          | 1                                                                                  |
| kat                 | kat, кат                  | katal, катал                | T^-1 N            | 1                                                                                  |
| °C                  | °C                        | celsius, degc, цельсий      | Th                | affine: `x + 27315/100` to K                                                       |
| °F                  | °F                        | fahrenheit, degf, фаренгейт | Th                | affine: `(x + 45967/100) * 5/9` to K                                               |
| °R                  | °R                        | rankine, degr, ранкин       | Th                | affine policy, even with zero offset: `x * 5/9` to K                               |

These exact expressions specify conventions rather than claiming every similarly named historical unit has the same definition. Catalog descriptions must expose Julian year/light-year, international length, avoirdupois mass and thermochemical calorie conventions. Every linear candidate permits one prefix except already-prefixed kg/kcal and standalone K; affine entries permit none. Prefixes to conventional non-SI linear units are intentional prototype behavior, including `санти-ярд/кило-год`, not strict SI publication notation.

## Quarantined entries and unresolved intent

These four entries are reviewed but **not approved for implementation**. They are not silently renamed, corrected or presented as intentional easter eggs. An explicit product/domain decision is required before Stage 10 includes any of them; their quarantine does not block Stages 7–9 generic framework work.

| Prototype entry  | Observed data                                                                            | Classification and required decision                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kg (Manya entry) | Symbols Mn/Мн; names Manya/Маня; dimension M; factor `30e9`; duplicates ordinary kg key  | Non-standard/custom or possible easter egg; intent unconfirmed. Decide inclusion, meaning and unique ID explicitly; never map it to kilogram merely because key says kg.                                                                        |
| dal              | Symbol Dal; name Дал; dimensionless; factor `9.86016*10**-50`                            | Non-standard/custom or possible easter egg; intent unconfirmed. Neither the dalton (mass, Da) nor decalitres (volume, daL). Meaning and spelling need a decision; no inferred correction.                                                       |
| wk (month entry) | Symbol mth; names month/месяц/мсц; factor `31557600/12` = 2629800 s; duplicates week key | Conventional average Julian month versus calendar month ambiguity. Decide a fixed-duration meaning and unique ID, or omit; do not claim calendar conversion.                                                                                    |
| u                | Symbol u; names amu/atomicmassunit/аедм; prototype `1.66053906660e-27` kg                | Standard unit but measured mass ratio with uncertainty, not an exact defining decimal. Needs an explicit uncertainty/approximation product contract before verified conversion; freezing those digits as exact is not an acceptable workaround. |

No registry row is evidenced as an **intentional** easter egg or deliberate test datum. The prototype's execution style (silent map overwrite, `number`, 12-decimal result, `Number(expToken)`, explicit calculate button) is prototype-only scaffolding. Duplicate-key identities and rounded `Math.PI`/parsec factors are implementation defects/limitations, documented here without editing the reference file.

## Prefix inventory and deterministic resolution

| Prefix | Exact power of ten | Prototype aliases |
| ------ | ------------------ | ----------------- |
| yotta  | 24                 | Y, йотта, иотта   |
| zetta  | 21                 | Z, зетта          |
| exa    | 18                 | E, экса           |
| peta   | 15                 | P, пета           |
| tera   | 12                 | T, тера           |
| giga   | 9                  | G, гига           |
| mega   | 6                  | M, мега           |
| kilo   | 3                  | k, к, кило        |
| hecto  | 2                  | h, гекто          |
| deca   | 1                  | da, дека          |
| deci   | -1                 | d, д, деци        |
| centi  | -2                 | c, с, санти       |
| milli  | -3                 | m, м, милли       |
| micro  | -6                 | u, µ, μ, микро    |
| nano   | -9                 | n, н, нано        |
| pico   | -12                | p, п, пико        |
| femto  | -15                | f, ф, фемто       |
| atto   | -18                | a, а, атто        |
| zepto  | -21                | z, з, зепто       |
| yocto  | -24                | y, й, йокто       |

This v1 set retains the 20 inspected prefixes. Ronna/quetta/ronto/quecto are valid current SI prefixes, but are not in this prototype set and are deferred rather than accidentally assigned factors. Binary prefixes are out of scope. Exact scales compile from integer powers of ten, not `1e...` floating-point values. English spelled-out prefix names are not present in the prototype; additions require an explicit alias entry rather than speculative normalization.

Resolution tiers: complete direct symbol → complete normalized name → longest valid single prefix with symbol/name remainder. Symbol case cannot be lost in normalized-name fallback; one-letter prefix symbols must not become case-insensitive through name normalization. Distinct candidates at the same tier produce an ambiguity error; map insertion order cannot decide meaning. Repeated aliases that resolve to the same canonical definition are allowed.

| Collision or trap                                           | Required behavior / audit disposition                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate kg/wk/grad keys                                   | Canonical IDs unique; separate kg/Manya, week/month and unity/degree identities; quarantined entries stay excluded pending decision.                             |
| `min` versus milli + inch (`m` + `in`)                      | Whole direct minute wins, independent of iteration order.                                                                                                        |
| `h`, `d`, `T`, `A` versus prefix fragments / similar glyphs | Whole hour/day/tesla/ampere symbols win; prefix alone without remainder is not a unit. Latin/Cyrillic glyphs are not globally merged.                            |
| `kg`, `kcal` versus prefix + g/cal                          | Whole direct entries win and must have identical dimension/scale to expansion; repeated prefix remains forbidden.                                                |
| `См` versus `см`                                            | Siemens versus centimetre; preserve case.                                                                                                                        |
| `Гр` versus normalized degree alias `гр`                    | Gray direct symbol wins; lowercase alias remains degree. Do not normalize all symbols into a shared name map.                                                    |
| `m`/`M`, `p`/`P`, `z`/`Z`, `y`/`Y`                          | Prefix symbols retain case, giving different factors. Prototype normalized-prefix fallback lowercases these and can select a wrong factor; do not carry it over. |
| `da` versus `d`, µ/μ/u                                      | Longest valid prefix and explicit micro variants, never unstable alias-array order; no stacked prefixes.                                                         |
| Å versus decomposed Å, Cyrillic ё/е names                   | NFC before lookup; normalize names independently. Plain A is still ampere.                                                                                       |
| `м с` versus `мс`, `морская миля`                           | Whitespace multiplies, concatenated token uses registry/prefix; multiword aliases must be explicitly concatenated/hyphenated.                                    |
| Removing `°`, `/`, parentheses or dots globally             | Never erase grammar/operators or degree signs. Only approved alias punctuation such as а.е. normalizes inside a token.                                           |
| Temperature K/C/F/R                                         | K remains linear but is unprefixed in v1; °C/°F/°R standalone affine, no compound/power/prefix. Raw C/F are electrical units, not temperature aliases.           |

Mandatory Stage 10 tests include every resolution example, normalized-alias collision rejection, checked exact integer dimensions, lexical signed powers (`с^-2`, not `с^1e2`), all forbidden affine forms, and no IEEE-754 factor on the compiler path. Prefix/name/symbol identity is independent of Core angleMode; degree scale always means `π/180` radians.

## Sources checked for technical audit

These sources justify classification/scale accuracy; they do not infer product intent for custom entries.

- [BIPM SI Brochure](https://www.bipm.org/en/publications/si-brochure/) defines SI base/derived units, Celsius relation, accepted non-SI units and the distinction between exact defining constants and measured quantities.
- [BIPM SI prefixes](https://www.bipm.org/en/measurement-units/si-prefixes) lists the current decimal prefix set, including the four 2022 additions outside the inspected prototype.
- [NIST conversion factors, Appendix B.8](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8) distinguishes exact factors and conventional definitions, including international length, avoirdupois mass and thermochemical calorie.
- [IAU 2015 Resolution B2, note 4](https://iauarchive.eso.org/static/resolutions/IAU2015_English.pdf) specifies parsec as `(648000/π) au` using the exact 2012 astronomical-unit definition. The prototype's finite parsec decimal must therefore be replaced by symbolic source, not certified as an exact length.
