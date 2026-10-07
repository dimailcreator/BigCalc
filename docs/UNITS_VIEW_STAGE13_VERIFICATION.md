# Units production view — Stage 13 verification

Entry HEAD: `c0119287c95cd8f30486d5db86be52096239ac20` (`BigCalc CM 12`), clean working tree. This task creates no commit; evidence describes its final working tree.

## Scope and dependencies

Only Calculator Modules Stage 13. Core public boundary, UI_SPEC §§43.6/44.2, DESIGN_SPEC §50 and App Stage 26 freeze were checked against the current implementation. Fresh prerequisites passed **448 tests**: Units domain/compiler/controller/source/persistence, scoped calculation service, input coordinator, Host and BMI persistence.

Production `UnitsCalculatorView` is attached to the existing module definition with activation/deactivation/disposal hooks. The installed module list still contains BMI only. No Stage 14 registration or Stage 15 APK/device acceptance is performed. Historical Stage 5 closure/IME follow-up and Stage 6–12 reports remain intact.

## Implementation and boundaries

The real ExpressionEditor, one shared keyboard target, two native unit inputs and NumberViewport form a bounded vertical view. Swap, six examples and whole-form reset each commit one source snapshot. Keyboard AC leaves unit text unchanged; form clear resets to `1` / empty strings and has a distinct accessible name. Twenty prefixes and 59 accepted units insert into the last selected native field (default fromUnit), replacing its selection without opening IME. Catalog groups collapse and chips wrap.

The controller owns mathematical sessions through Stage 9 services. The view owns only rendering, focus/selection, clipboard feedback and viewport; source persistence remains exactly three strings. Result metadata uses from→to and a temperature marker; no numeric factor, second Worker, History or number arithmetic is introduced. Current verified output alone enables copy, with target text and temporary accessible feedback. Five zones distinguish value/Core, fromUnit, toUnit, dimension/conversion and transport errors. Obsolete errors/results clear immediately on editing.

Two necessary **additive, backward-compatible boundaries** are explicitly recorded in [the ADR](ADR_MODULE_PRESENTATION_STAGE13.md): optional owner-scoped presentation (global inertia and the existing shared timeout interaction) and optional ExpressionEditor text-to-token callback. Units uses its existing source-preserving helper for every user text channel. The primary editor's default parser is unchanged. The generic main routing has no Units ID or calculator-specific branch; the single existing TimeoutDialog/navigation surface serves its active owner. Core API/version/semantics, Worker DTOs, module state contract, persistence schema, keyboard layout, Host/Surface/NavigationController and installedModules are unchanged.

## Verification and development findings

Eight new presentation service tests cover inactive/disposed ownership, old-owner isolation, release-before-inner-cleanup, shared callbacks, equal/invalid inertia, notification/unsubscribe and idempotent disposal. The existing Stage 12 declaration test now expects the Stage 13 factory while retaining the installation/persistence assertions; all other prior tests and timeouts/bounds are preserved.

**36 new browser tests** mount the actual production view through Host, input/calculation/presentation services, one real Worker and localStorage. They cover defaults/accessibility, all six atomic examples, swap, AC/reset, shared π/√/e/functions and atomic deletion, authoritative angle settings, native focus/composition/selection, default/last-field catalog insertion, five error zones, neutral incomplete states, typed/pasted/composed/structured Ans, replacement-input source preservation, verified copy/rejection/stale completion, demand-driven digits without History or repeated announcements, shared timeout continuation/freeze/Back and independent disposal, source reload and secondary switching/background/overlay routing.

All five portrait sizes (360×640, 360×800, 390×844, 412×915, 768×1024) cover compact/expanded keyboard, native layout, field/result/catalog reachability and bounded horizontal width, including long invalid input. Four representative appearances cover all display sizes: dark/lavender, light/blue, dark/liquid-glass, light/liquid-glass. Numeric displays scale; native/chip sizes and calculation identity remain stable. Browser resize tests compare TopBar/button/wallpaper geometry while native input reduces viewport height, retain it through math focus, and release on actual restoration. This is browser simulation, not physical Android IME acceptance.

Initial new harness runs found incorrect use of `fill()` against editor selection, an expected scientific representation where NumberViewport uses decimal, an incorrect empty function macro expectation, the default angle-mode assumption, and synthetic replacement input dispatched to an inactive math target. Tests were corrected to use real select-all/editor replacement and the existing component semantics. Timeout fixture navigation was corrected to mirror production's calculation-driven dismissal race handling; an expensive fresh computation is checked for a new session rather than promised completion within the initial soft budget. The clear-button ambiguity prompted the distinct form accessible name. Intermediate runs: 26/33, 30/33 and 34/36; final targeted run passed **36/36 in 1.2min** before the final shared-header/screenshot fixture refinements. No existing assertion or timing/performance bound was relaxed.

Local ignored logs, screenshots and artifact audits live under `.release-test/stage13/`. No scripts/package/config/dependencies are added.

## Final gates

| Gate                                   | Result                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Fresh dependency suites                | 448 tests passed                                                                                                   |
| Selected Units/presentation suites     | 395 tests passed                                                                                                   |
| Targeted production-view browser suite | 36/36 passed (1.2min)                                                                                              |
| `npm run check`                        | Passed: formatter/lint/types, 404 Core + 14 benchmark tests, build and public API audit                            |
| `npm run check:app`                    | Passed: App types, 758 unit tests in 41 files, all 320 browser tests (13.1min), production build                   |
| Liquid Glass responsiveness            | 283.4ms maximum frame gap, below unchanged 1000ms bound                                                            |
| Production artifact audit              | Four assets unchanged: Worker, CSS, two wallpapers; application JS and its referencing Capacitor web chunk changed |
| Final documentation/scope audit        | Formatting, local file links, whitespace and changed-file/import boundaries checked                                |

The first full Core gate stopped at strict lint errors in the new callbacks/tests; explicit void blocks, checked test service access, browser `globalThis` constructors and a shared asynchronous clipboard guard resolved them. The final complete gate passed. Full App regression was run after those fixes and the final shared-header/screenshot fixture refinement, with production/test sources held unchanged while Playwright/Vite ran. No failing check remains.

Commands: selected `npx vitest run --config vitest.config.js` dependency/Units/presentation suites; `npm run typecheck:app`; targeted `npx playwright test --config playwright.config.js tests/app/units-view.spec.js`; targeted `npx eslint` and `npx prettier`; serial `npm run check` and `npm run check:app`; SHA-256 comparison, `git diff --check`, local Markdown link and import/scope audits. Logs include `dependencies.log`, `units.log`, `types.log`, `view-browser*.log`, `lint*.log`, `core-check*.log`, `app-check-final.log`, `app-assets-before.json`, `app-assets-after.json` and `app-asset-audit.json`.

The production bundle contains no Units view/catalog/style: registration remains Stage 14. Generic presentation routing changes the app JS; the Capacitor web chunk changes its import of that app chunk. Worker/CSS/wallpaper filenames and SHA-256 values match the entry artifacts. Eight ignored screenshots cover four representative appearances in math and native modes; native screenshots were visually inspected for control/result readability, focus and scrolling. Neither build nor screenshots claim a new APK/physical IME acceptance.

## Files changed

- Production: `src/app/modules/units/UnitsCalculatorView.ts`, `units.css`, `UnitsCalculatorModule.ts`; `src/app/input/ModulePresentationService.ts`, `CalculatorInputs.ts`; `src/app/editor/ExpressionEditor.ts`; generic wiring in `src/app/main.ts`.
- Tests: new `tests/app/input/ModulePresentationService.test.ts`, `tests/app/units-view.spec.js`, `tests/app/fixtures/units-view.html`/`.js`; Stage 12's module factory expectation in `tests/app/modules/units/UnitsCalculatorModule.test.ts` updated for the actual view.
- Documentation: this report, the Stage 13 ADR, current module/architecture documentation and the Stage 13 plan closure. Normative specs, historical reports, Core, Worker protocol, persistence, installed module list, Android host, scripts/package/config/dependencies and unrelated tests remain unchanged.

## Definition of Done

| Stage 13 DoD                                             | Evidence                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1–3: production view/editor/native fields                | Actual view, existing ExpressionEditor, native text controls and labels                                                   |
| 4–6: shared routing, native hides keyboard, one keyboard | Coordinator registrations and real browser routing/matrix tests                                                           |
| 7: NumberViewport                                        | Verified DTO input, coalesced refinement, unchanged handle                                                                |
| 8–10: swap/clear/copy                                    | Atomic sources, distinct AC/form reset, verified clipboard/stale feedback tests                                           |
| 11–12: examples/catalog selection                        | Six examples, 20/59 entries, default/last native selection insertion                                                      |
| 13–14: errors/accessibility                              | Five zones, invalid/described inputs, output/context/status, focus and touch targets                                      |
| 15–16: appearance/portrait matrix                        | Semantic tokens, four representative theme/palette pairs, three display sizes, all five viewports and both keyboard modes |
| 17: Stage 14 unblocked                                   | Complete view using generic services, production list unchanged                                                           |

All 17 Stage 13 DoD items are satisfied. No unresolved failure, blocker or architecture/spec conflict remains. The two additive application/editor boundaries are explicit in the ADR and tested; no frozen Core or Worker contract is changed. Stage 14 is unblocked and not started. No commit is created.
