# Units conversion compiler and lifecycle — Stage 11 verification

Date: 2026-10-07 (Europe/Moscow).

## Entry and dependencies

Entry HEAD: `bba54f408e9735a219f9c44cc7ce247373f71d82` (`BigCalc CM 10`), with a clean working tree. No commit is created by this task; evidence describes the working tree based on this entry.

Scope: [Calculator Modules Stage 11](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §43.6.3–6](../UI_SPEC.md), [DESIGN_SPEC §50](../DESIGN_SPEC.md), [Core public boundary](../CORE_SPEC.md), [App freeze](APP_ARCHITECTURE_FREEZE.md), [Stage 6 ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md) and [registry audit](UNITS_REGISTRY_AUDIT.md). Frozen Core/Worker/module/input/settings/service contracts are sufficient; no new architecture/product decision is required.

[Stage 10 verification](UNITS_DOMAIN_STAGE10_VERIFICATION.md) and [Stage 9 verification](MODULE_CALCULATION_STAGE9_VERIFICATION.md) were reviewed against their implementation and DoD. The committed baseline has 404 Core + 14 benchmark tests, 598 App unit + 259 browser tests. Fresh dependency verification passed **259 tests**: all 235 domain tests, 17 shared calculation-service tests and seven Host tests (`.release-test/stage11/dependency-unit.log`). This includes exact/symbolic scales, standalone Kelvin identity, dimension/prefix/affine restrictions, owner cleanup, settings snapshots and shared session allocation.

## Implementation and boundaries

Two new production-source files under `src/app/modules/units/`, currently unreferenced by the shipped entrypoint:

- `UnitConversionCompiler.ts`: deterministic source compiler with exact bigint/π scale nodes, safe value/factor parentheses and affine transforms through base temperature. Dimension mismatch, standalone affine counterpart checks and reserved raw/structured History references are module errors before Worker creation. Linear `factorSource` is exact source only; no numeric factor is displayed or evaluated with JavaScript numbers.
- `UnitsCalculationController.ts`: owner-local source generation, debounce, module service create/refine/continue, stale-response gates, source/settings replacement cancel/dispose, active/inactive lifetime and separate unit/Core/transport diagnostics. Initial precision is supplied from viewport capacity; demand coalesces on the existing handle. First live timeout is hidden, repeat explicit timeout opens the interaction, cancel freezes resumable work, and additional-digit pauses continue automatically. Complete `=` confirms, paused `=` continues and failed `=` retries without changing primary source or History.

The delimiter check protects containment only; it does not parse value grammar. Unbalanced `1)*2+(3` would become balanced if blindly wrapped. The compiler therefore sends that original value unchanged for Core creation; the controller exposes Core's syntax error without refining or displaying a raw unconverted value. Unexpected acceptance is classified as a transport protocol failure. Live mathematical syntax diagnostics stay neutral until submit; other Core errors retain their DTO category. Original source/editor representations are copied before debounce, so later caller mutation cannot change the current revision.

The controller has no DOM/Core/History/persistence imports and creates no Worker. The compiler has no mathematical evaluator; mathematical source remains Core-owned. The test-only fixture supplies Host activation/deactivation, the actual shared calculation service/Worker, an independent primary controller/History and the existing NumberViewport. It is not a production Units definition/view/registration. Shared timeout presentation/navigation remains a future view integration; this stage exposes lifecycle state/actions only.

## Coverage and development findings

New unit suites have **78 tests** (35 compiler + 43 controller), covering compiler containment/determinism/exact scales/affine restrictions/Ans and controller debounce, immutable source identity, all three field invalidations, error layering, incomplete live edits, preflight syntax, stale completions/failures/cancellation/rejections/ready/continuations, retained pause/freeze, submit during pending work, retry/confirm, coalesced precision, finite-result suppression, settings, deactivation/reactivation/disposal and invalid demands. Controlled deferred promises deliberately deliver stale results after source replacement; fake timers avoid real-time lifecycle assertions.

New browser suite has **21 tests**. All mandatory conversions run through the actual Worker/Core with independently supplied expected digit prefixes/exponents/sign/exactness: `1 km/h→m/s` (5/18), `π km→m`, `√2 m→cm`, `J/W→s`, compounds/powers, `25°C→K`, `0K→°C`, `32°F→°C`, `212°F→K`, `0°R→K`. Additional cases verify negative temperature mathematics, value-expression precedence and symbolic degree scale. Core syntax/unknown/domain/division errors retain category; invalid units/dimensions/affine/Ans create no Worker sessions.

Real viewport PageDown demands refine the same handle and preserve its verified prefix, with initial demand equal to measured capacity and no large fixed prefetch. Real 1ms soft timeout freezes/continues one handle. Rapid revisions, Host navigation cleanup/reactivation, mathematical settings/inertia, independent primary result/History and exactly one Worker are checked. Initial browser run passed 20/21: iterating `sin(π)` could finish after its first continuation, so it was unsuitable for asserting a second timeout. The final stress case uses `sin[200](1)` at the same viewport demand; all 21 passed in 29.5s. No existing assertion, timeout or performance bound was changed.

Initial unit run caught incorrect source-golden assumptions about Stage 10's deliberately retained symbolic `*1` nodes; expectations were aligned with those exact domain representations without changing conversion semantics. Strict lint findings were resolved with explicit test parameter types, typed exception assertions and an explicit string-field list. Controller development checks added source snapshot and incomplete syntax coverage. No frozen-layer correctness issue was found.

## Final verification

`npm run check` passed: **404 Core tests**, **14 benchmark tests**, formatting/lint/types/build and public API audit. Log: `.release-test/stage11/check-core-final.log`. The final unit-fixture cleanup is covered by a subsequent targeted lint run and the full App gate.

`npm run check:app` passed: App typechecks, **676 unit tests in 38 files**, **all 280 browser tests (9.9min)** and production build. This includes all 598 previous unit and 259 previous browser tests. Liquid Glass maximum frame gap was **133.3ms**, below the unchanged **1000ms** bound. No test was skipped and no existing assertion/timeout/bound was weakened. Core/build/device work did not run concurrently with the full browser gate; source/test files stayed fixed. Log: `.release-test/stage11/check-app-final.log`.

All **six production assets** retain their entry filenames and SHA-256 hashes. `.release-test/stage11/app-assets-before.json` and `app-asset-audit.json` record the comparison. Stage 11 source remains absent from the shipped bundle. Final documentation formatting, whitespace, local links and changed-file/import scope checks passed.

| Gate                                            | Result                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Stage 9/10 dependency unit tests                | Passed: 259 tests                                                      |
| Compiler/controller tests                       | Passed: 76 initial targeted tests; all 78 final tests in full App gate |
| Targeted App types and strict lint              | Passed                                                                 |
| New actual Worker browser tests                 | Passed: all 21 tests                                                   |
| `npm run check`                                 | Passed: 404 Core + 14 benchmark tests, build/API audit                 |
| `npm run check:app`                             | Passed: 676 unit + 280 browser tests, App types and production build   |
| Production assets, final formatting/links/scope | Passed: all six assets identical; final checks clean                   |

Commands: fresh dependency `npx vitest run --config vitest.config.js` selecting the four domain suites plus service/Host; targeted same-config compiler/controller Vitest; `npm run typecheck:app`; `npx eslint` for new implementation/tests/fixture; `npm run test:app:e2e -- tests/app/units-calculation.spec.js`; serial `npm run check` then `npm run check:app`; SHA-256 comparison, `npx prettier`/`npm run format:check`, `git diff --check`, and read-only scope/link audit. Targeted logs are under `.release-test/stage11/` (`unit-targeted-final.log`, `types-final-targeted.log`, `lint-targeted-final.log`, `lint-final-unit.log`, `browser-targeted-final.log`); the full App log covers the two final guard tests. Temporary logs/audits are ignored local evidence, not new scripts/config.

## Definition of Done mapping

| Stage 11 DoD                        | Evidence                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1: deterministic compiler           | Immutable source result, golden containment/factor tests, exact scales                            |
| 2: value through Core               | Unaltered value embedding, raw syntax preflight, actual Worker value/error cases                  |
| 3: exact/Core-compatible scales     | Trusted bigint/π nodes, exact affine offsets, symbolic powers; no float evaluation                |
| 4: verified result                  | Existing VerifiedNumberDto and NumberViewport, mandatory browser conversions                      |
| 5: dimension mismatch before Worker | Controller/real Worker command audit proves no create for invalid dimensions                      |
| 6: affine conversions               | All five mandatory cases, exact zero, negative values, standalone restriction tests               |
| 7: stale races tested               | Identity/generation guards, deferred stale outcomes/ready/continuations, real rapid edits         |
| 8: pause/continue                   | Initial/repeat timeout, freeze without cancel, same-handle continuation, additional auto-continue |
| 9: explicit submit                  | Pending/no duplicate, confirm, continue, meaningful retry; source retained                        |
| 10: no primary History mutation     | Actual primary History before/after Units submits/navigation and independent primary result       |
| 11: shared Worker                   | Existing service only; actual browser Worker construction/command audit                           |
| 12: full regression                 | Full Core/App gates passed; 404 + 14 + 676 + 280 tests, build/API audit                           |
| 13: Stage 12 unblocked              | Exact compiler and tested module-local lifecycle ready for source state/persistence/definition    |

## Scope and limitations

Changed files: two new implementation files, two new unit suites, `tests/app/units-calculation.spec.js`, test-only `units-calculation.html`/`.js`, this report, `docs/CALCULATOR_MODULES.md` and the Stage 11 closure section in the plan. Existing tests, Core API/version/grammar/backend, Worker DTO/transport/service, module/input contracts, editor/keyboard/Host/navigation/persistence, primary/BMI, installed modules, Android host, scripts/package/config/dependencies and normative specifications have no changes. Historical Stage 5–10 reports and initial Stage 5 versus IME follow-up evidence are preserved.

No new Android production surface is shipped at this stage. APK/device acceptance is not rerun; prior physical BMI/IME results remain historical evidence, not a new Stage 11 device run. Units state/persistence/definition belongs to Stage 12; view/presentation/production registration and physical Android acceptance belong to subsequent stages. All 13 Stage 11 DoD items are satisfied, with no remaining failure, blocker, architecture/spec conflict or frozen-boundary change. The next allowed stage is Stage 12; it is unblocked and not started. No commit is created by this task.
