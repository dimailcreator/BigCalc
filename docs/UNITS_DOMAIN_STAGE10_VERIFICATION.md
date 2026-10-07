# Pure Units domain — Stage 10 verification

Date: 2026-10-07 (Europe/Moscow).

## Entry and dependencies

Entry HEAD: `40b604d27b01079319c3434e08a48162fea6826f` (`BigCalc CM 9`), with a clean working tree. No commit is created by this task; evidence describes the working tree based on this entry.

Scope: [Calculator Modules Stage 10](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §43.6.3–5](../UI_SPEC.md), [DESIGN_SPEC §50](../DESIGN_SPEC.md), [Core boundary](../CORE_SPEC.md) and [App freeze](APP_ARCHITECTURE_FREEZE.md). The [Stage 6 registry audit](UNITS_REGISTRY_AUDIT.md) supplies exact/conventional definitions, aliases, precedence and explicit exclusions. Signed negative/zero integer powers and standalone affine policy were already accepted in Stage 6; no new product decision is needed.

Stage 9's committed service/Host implementation and [verification report](MODULE_CALCULATION_STAGE9_VERIFICATION.md) were checked: baseline 404 Core + 14 benchmark tests, 363 App unit + 259 browser tests and physical BMI IME/primary acceptance. A fresh dependency run passed all **24 service/Host unit tests** (17 + 7). Current Stage 10 has no runtime dependency on those services; they remain the calculation prerequisite for Stage 11.

The local prototype was read only for its six example pairs (`км/ч→м/с`, `Дж/Вт→с`, `кДж*ч/Дж→с`, `санти-ярд/кило-год→м/с`, `°C→K`, `bar→Pa`); its JavaScript/number factors/handlers are not reused. Registry identity/inventory remains the Stage 6 audit reference.

## Implementation and boundaries

Six new pure domain files under `src/app/modules/units/`:

- `UnitDimensions.ts`: immutable seven-component bigint vectors in L/M/T/I/Th/N/J order; equality, addition/subtraction and signed power with exact exponents.
- `UnitExpression.ts`: canonical bigint rational, symbolic π/product/quotient/power nodes, deterministic parenthesized factor source, affine `(input + inputOffset) * scale`, immutable syntax/value types. Large powers remain symbolic, not expanded into huge integers or float factors.
- `UnitRegistryEntries.ts`: exactly **59 accepted units and 20 prefixes**. Exact foot/yard/mass/calorie/time/electronvolt definitions and symbolic degree/parsec, with explicit conventional descriptions. Quarantined Manya/Dal/month/atomic mass, binary/newer SI prefixes and speculative aliases remain absent.
- `UnitRegistry.ts`: NFC direct symbols before normalized names before longest valid single prefix; symbols preserve case, prefix names preserve remainder symbol case. Name folding covers ё/е and internal hyphen/underscore, with punctuation explicit and whitespace/operator grammar retained. Canonical ID and normalized alias collision validation; immutable copied definitions/prefix metadata; same-tier ambiguity errors independent of map/array order.
- `UnitParser.ts`: module-local atom/group, one signed decimal integer power and left-associative product/quotient, with whitespace multiplication only. Original source/UTF-16 ranges remain intact. Every affine product/quotient/power/prefix is rejected; groups preserve standalone temperature identity while linear compounds/powers clear it for Stage 11 counterpart checks.
- `UnitErrors.ts`: typed unit domain errors/ranges, distinct registry configuration failures; no Core `CalcError` or transport error masking.

`compileUnitScale` serializes trusted factor nodes only. It does not compile user value conversions or evaluate source; Stage 11 owns that work. No module view/registration, App service/session, Worker execution or persistence is added. The new domain is unreferenced by the production entrypoint, so production UI/Android behavior remains the committed Stage 9 baseline.

## Regression coverage and development findings

Four new unit suites plus a shared test helper: **235 tests** (3 dimensions, 4 factors, 126 registry, 102 parser). Tests independently transcribe all 59 identities/dimensions/exact factor or affine representations from the decision ledger, and all 20 prefix powers. All declared aliases, representative Russian/English normalized names, µ/μ, NFC Å, ё/е, case traps and preserved punctuation are exercised. Longest-prefix and ambiguity fixtures test reversed declaration order; conflicting IDs/normalized unit/prefix aliases are rejected.

Parser coverage includes all mandatory Stage 10 expressions and all six prototype pairs; left associativity, nested groups, positive/zero/negative lexical powers, whitespace/operator aliases, invalid numeric/exponent/adjacency forms, every affine misuse and original source ranges. It retains the standalone K marker separately from K compounds/powers. Exact generated fraction and dimension identities use bigint; a separate bounded fraction interpreter checks prefix/compound factors without Core or IEEE-754. Huge dimension/power tests exceed Number.MAX_SAFE_INTEGER and keep factor powers symbolic.

Initial targeted run passed 227 tests; final normalization/prefix configuration and prototype pairs expanded coverage to 235 passing tests. Initial lint identified tuple-length narrowing and unsafe Vitest asymmetric matchers/one unused import. A widened validation array and typed error assertion helper resolved them without changing expectations. Targeted App types and final lint passed; existing tests/assertions/timeouts/performance bounds remain unchanged.

An isolated TypeScript project with **`lib: [ES2022]`, `types: []`** compiled all six domain files successfully, proving that DOM/Worker/Node/App runtime typings are unnecessary. The temporary verification config/log is local under `.release-test/stage10/`; no package scripts/config/dependencies are changed.

## Final verification and Definition of Done

`npm run check` passed: **404 Core tests**, **14 benchmark tests**, formatter/lint/types/build and public API audit. Final log: `.release-test/stage10/check-core-final.log`.

`npm run check:app` passed: App typechecks, **598 unit tests in 36 files**, **all 259 browser tests (11.8min)** and production build. Existing Stage 7–9, primary/BMI, History/editor, lifecycle/persistence/appearance and viewport regressions passed. Liquid Glass maximum frame gap was **283.3ms**, below the unchanged **1000ms** bound. No tests were skipped, no assertions/timeouts/bounds were weakened, and no build/device/Core work ran concurrently with the full browser gate. Sources and tests remained stable. Final log: `.release-test/stage10/check-app-final.log`.

All **six final production assets** have exactly the entry-stage filenames/SHA-256 values; `.release-test/stage10/app-assets-before.json` and `app-asset-audit.json` record this comparison. The new pure domain is not included in the shipped bundle. Stage 10 requires no new Android UI/host acceptance; APK build/device tests were not rerun. Prior physical Stage 9 BMI/IME evidence remains historical, not claimed as a new Stage 10 device run.

| Gate                                                             | Result                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stage 9 dependency tests                                         | Passed: 24 service/Host tests                                                |
| New Units targeted tests                                         | Passed: 235 tests in four suites                                             |
| ES2022-only pure compilation                                     | Passed: all six domain files with no DOM/Worker/Node typings                 |
| `npm run check`                                                  | Passed: 404 Core + 14 benchmark tests, formatting/lint/types/build/API audit |
| `npm run check:app`                                              | Passed: 598 unit + 259 browser tests, App types and production build         |
| Production asset comparison                                      | Passed: all six assets identical to entry baseline                           |
| Final formatting, whitespace, local links and scope/import audit | Passed                                                                       |

| Stage 10 DoD                                   | Evidence                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1: pure registry                               | 59 exact/conventional definitions, 20 prefixes; local-only imports and immutable snapshots                                     |
| 2: pure parser                                 | Unit grammar/source/ranges/immutable syntax, no application or numeric evaluation                                              |
| 3: pure dimension algebra                      | Seven bigint exponents; equality/product/quotient/integer power and generated identities                                       |
| 4–5: exact/symbolic scales, no floating factor | Trusted bigint/π nodes; independent exact factor assertions and enormous symbolic power coverage                               |
| 6: deterministic prefix precedence             | Direct symbol/name tiers, longest valid prefix, case traps, reversed-order and ambiguity tests                                 |
| 7: affine restrictions                         | Standalone/group-only C/F/R; every product/quotient/power/prefix rejected; K counterpart marker retained                       |
| 8: typed errors                                | Domain codes with original UTF-16 ranges, separate registry configuration error class                                          |
| 9: accepted prototype examples                 | All six source/target pairs parse compatible dimensions; mandatory individual expressions checked                              |
| 10: Stage 6 ambiguities                        | Unique identities, checked normalized collisions, exact kg/kcal equivalence, four quarantined entries excluded                 |
| 11–13: no DOM/Worker/Core execution            | ES2022/types-empty compilation; 21 imports all local to six domain files                                                       |
| 14: unit tests pass                            | All 235 new tests and all 598 App unit tests passed                                                                            |
| 15: full checks pass                           | Complete Core and App gates above; production build/API audit and unchanged browser performance bound                          |
| 16: Stage 11 unblocked                         | Parsed dimensions/exact scales/transforms/standalone identity/errors ready for conversion compiler and existing shared service |

Final scope: six new domain files, four new unit suites plus one helper, and Stage 10 module/audit/verification/plan documentation. Existing production/test files, Core/version/API/grammar, Worker/services/contracts, keyboard/editor/Host/navigation, BMI, installed registrations, persistence, Android host, scripts/package/config/dependencies and normative specs have no changes. Historical Stage 5–9 reports are preserved. No architecture/spec conflict or frozen-boundary change is required. All 16 Stage 10 DoD items are satisfied; no blocker remains. Stage 11 is unblocked and not started. No commit is created by this task.
