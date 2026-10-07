# Units state, persistence and module definition — Stage 12 verification

Date: 2026-10-07 (Europe/Moscow).

## Entry and dependencies

Entry HEAD: `0c29ba914cebbbded48377800467c9ebd1f9bedf` (`BigCalc CM 11`), clean working tree. No commit is created by this task; final evidence describes the working tree based on that entry.

Scope: [Calculator Modules Stage 12](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §§43.6/44.2](../UI_SPEC.md), [DESIGN_SPEC §50](../DESIGN_SPEC.md), [Core public boundary](../CORE_SPEC.md), [App architecture freeze](APP_ARCHITECTURE_FREEZE.md) and the existing repository/Host/editor contracts. Stage 12 owns original source state, revision 1 persistence, expression reconstruction and the production module definition; Stage 13 owns the view and Stage 14 installation. No frozen boundary or normative specification change is needed.

[Stage 11 verification](UNITS_CALCULATION_STAGE11_VERIFICATION.md) and its committed compiler/controller implementation were checked against the DoD: exact conversion sources, verified Worker results, pre-Worker errors, stale gates, shared ownership, pause/continue and demand-driven precision. Baseline full gates passed 404 Core + 14 benchmark tests and 676 App unit + 280 browser tests. Fresh dependency verification passed **365 tests**: 235 domain, 78 compiler/controller, 17 service, seven Host and 28 BMI persistence tests. Log: `.release-test/stage12/dependency-unit.log`.

## Implementation

Three new files under `src/app/modules/units/`:

- `UnitsState.ts`: source-only `UnitsState` / `PersistedUnitsStateV1`, fresh immutable defaults `1` / `км/ч` / `м/с`, explicit three-field serializer and declaration `units` / revision 1. It copies strings verbatim, accepts empty/incomplete/invalid source, ignores foreign properties and returns null for malformed DTOs so the existing repository/Host restores defaults. No application schema or storage key changes.
- `UnitsExpression.ts`: reconstructs a fresh immutable `ExpressionModel` using supported `parseEditorText` and token constructors. Known function names remain atomic with their original casing. Unknown syntax/whitespace is preserved rather than filtered; raw `Ans` remains a reserved atomic identifier with no History ID. Display and evaluation source equal the original persisted string; no saved tokens, selection or displayed result are used.
- `UnitsCalculatorModule.ts`: production definition and generic adapter with stable id/title, four exact descriptors/input kinds, create/restore/serialize hooks and the existing persistence declaration. It leaves `createView` unset until Stage 13 and is not added to `installedModules`. This is supported by the unchanged optional-view contract; direct adapter runtimes can flush source state, and Host integration tests supply observer views by spreading this production definition. No placeholder production UI or Host workaround is introduced.

Source state stays three strings; editor/calculation state is derived externally at view construction from the restored source and current services. The test observer views reconstruct the model and a new Stage 11 controller, then use the existing activation/deactivation hooks to compute/release work. These fixtures demonstrate restore and recomputation without starting the production view. Runtime models, parsed units, dimensions/scales, compilation, result/error, selection/focus, viewport position, settings/session/request/Worker data never enter the DTO.

## Verification coverage and development findings

Two new unit suites have **74 tests** (51 state/expression + 23 module/Host). They cover defaults/identity/fields/revision/schema, exact source round trips, malformed DTO/document, unsupported revisions, unknown/invalid/empty/incomplete text, foreign derived fields, even circular/non-JSON runtime extras, module switching, save-before-deactivation, Host/repository recreation and fresh atomic expression reconstruction. Bidirectional BMI preservation, unknown module/future Units record retention and future-schema refusal across flush/deactivation/disposal are checked. The exported definition is not installed, and no production view exists.

Four new actual browser/Worker tests exercise localStorage reload, Host navigation, retained original source and BMI, fresh editor selection, recomputed verified `√2 m→cm`, and one Worker in the recreated page. Saved fake result/reference/session data is ignored: restored `Ans` creates no Worker session, unknown math remains Core's identifier error and an unbalanced value retains Core syntax failure with no refinement. Malformed DTO/unknown revision safely falls back; future module records survive current saves. Future application documents remain byte-for-byte intact through edits, navigation and disposal. All four targeted tests passed in **25.6s** (`.release-test/stage12/browser-targeted.log`).

The existing clipboard path intentionally filters unsupported pasted text. Applying it directly to persisted `Ans+1` or `mystery(2)` would silently produce another value. The reconstruction helper retains those original characters while using existing tokenization for recognized names; unit and actual Worker tests verify diagnostics without decimal substitution or a new mathematical grammar. Initial targeted tests used a nonexistent `backspace()` test call; this was corrected to the existing `deleteBackward()` method without changing expected atomic deletion. Type narrowing and strict test lint findings were also resolved. No existing correctness defect or frozen contract change was required; all previous tests/assertions/timeouts/bounds are unchanged.

## Final gates

`npm run check` passed: **404 Core tests**, **14 benchmark tests**, formatting/lint/typechecks/build and public API audit. Log: `.release-test/stage12/check-core-final.log`.

Final `npm run check:app` passed: App typechecks, **750 unit tests in 40 files**, **all 284 browser tests (11.8min)** and production build. This includes all 676 previous unit and 280 previous browser tests. Liquid Glass maximum frame gap was **316.7ms**, below the unchanged **1000ms** bound. No tests were skipped and no existing assertions/timeouts/bounds were weakened. Core/build/device work did not run concurrently with the browser gate, and source/test files stayed fixed. Log: `.release-test/stage12/check-app-final.log`.

The first full App attempt passed all 750 unit tests and 283/284 browser tests, but the existing displaySize 360px case exceeded its 120000ms timeout at `page.goto("/", {waitUntil:"networkidle"})`, before layout assertions. The run spanned an interruption and reported 1.5h wall time; the exact cause of that navigation timeout is not established. All new Units tests passed in that attempt. First log/error context are preserved as `check-app-first.log` and `display-size-first-error-context.md`. The same unchanged case passed with a fresh server in **31.4s** (`display-size-recheck.log`), then the full App gate passed with another fresh server. No source/test fix or weakened check was used to obtain the final pass.

All **six production assets** retain entry filenames and SHA-256 hashes (`app-assets-before.json`, `app-asset-audit.json`); the new uninstalled definition/state/helper is absent from the shipped bundle. Final repository formatting, whitespace, local documentation links and changed-file/import scope checks passed.

| Gate                                                 | Result                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Stage 11/service/Host/BMI dependency tests           | Passed: 365 tests                                                     |
| New state/expression/module unit tests               | Passed: 74 tests                                                      |
| Targeted App typecheck and strict lint               | Passed                                                                |
| Actual Worker/localStorage browser tests             | Passed: four tests                                                    |
| `npm run check`                                      | Passed: 404 Core + 14 benchmark tests, build/API audit                |
| `npm run check:app`                                  | Passed: 750 unit + 284 browser tests, App types and production build  |
| Production asset and final documentation/scope audit | Passed: six identical assets, formatting/links/whitespace/scope clean |

Commands: selected `npx vitest run --config vitest.config.js` dependency/new suites; `npm run typecheck:app`; `npx eslint` for new production/tests/fixture files; `npm run test:app:e2e -- tests/app/units-state.spec.js`; serial `npm run check` then `npm run check:app`; isolated `npm run test:app:e2e -- tests/app/display-size.spec.js --grep '360px: density'` followed by full `npm run check:app` after the first navigation timeout; `npx prettier` / `npm run format:check`, SHA-256 comparison, `git diff --check` and read-only scope/link checks. Targeted logs include `dependency-unit.log`, `unit-targeted-final.log`, `types-targeted.log`, `lint-targeted-final.log` and `browser-targeted.log`. All logs/audits are ignored local evidence under `.release-test/stage12/`; they introduce no scripts/config/dependencies.

## Definition of Done mapping

| Stage 12 DoD                    | Evidence                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1: fixed id/title               | Production definition/adapter: `units` / `Единицы`                                                                |
| 2: correct fields               | Exactly value/fromUnit/toUnit inputs and result output with specified labels                                      |
| 3: generic input kinds          | Existing `math-expression` / `text`, no contract changes                                                          |
| 4: source-only state            | Three original string fields, fresh immutable snapshots                                                           |
| 5: persistence revision 1       | Existing `units` declaration/document, application schema remains 1                                               |
| 6: runtime calculation excluded | Explicit serializer/deserializer; circular/non-JSON runtime extras and forged saved results/tokens ignored        |
| 7: derived state reconstructed  | Fresh supported ExpressionModel and Stage 11 controller in Host/reload observers, actual Worker recomputation     |
| 8: BMI unaffected               | Bidirectional repository preservation, three-module Host switching/recreation and browser BMI checks              |
| 9: Host tests                   | New 23 module/Host tests, all seven existing Host tests and complete App regression passed                        |
| 10: not production-registered   | `installedModules` unchanged and explicit adapter/registration assertion                                          |
| 11: Stage 13 unblocked          | Tested source definition, revision 1 persistence and lossless editor reconstruction ready for the production view |

## Scope and limitations

Changes: three new implementation files, two new unit suites, `tests/app/units-state.spec.js`, test-only `units-state.html`/`.js`, this report, current module documentation and the Stage 12 plan closure. Existing production/test files, Core/version/API/grammar/backend, Worker/protocol/service/allocator, module/input/editor/Host/navigation/persistence contracts, primary/BMI, installed module list, Android host, scripts/package/config/dependencies and normative specs are unchanged. Historical Stage 5–11 reports and Stage 5 initial closure versus IME follow-up remain intact.

No new production screen is shipped. APK/device acceptance is not rerun; prior physical BMI/IME evidence remains historical. Stage 13 will attach the real view and use the reconstruction/controller APIs; Stage 14 will install Units, and later acceptance will cover physical Android. All 11 Stage 12 DoD items are satisfied. No unresolved failure, blocker, architecture/spec conflict or frozen-boundary change remains. Stage 13 is the next allowed stage, unblocked and not started. No commit is created by this task.
