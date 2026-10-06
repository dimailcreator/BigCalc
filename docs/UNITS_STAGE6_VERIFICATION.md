# Units Stage 6 verification

Date: 2026-10-06 (Europe/Moscow). Stage 6 closed.

## Entry and dependencies

Entry HEAD: `28d1f80921d3390e6aba6d0dfd2e3799ec2fdb5f` (`BigCalc CM docs fix`). On entry only `CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md` was modified: the user's updated plan introduces Units Stages 6–15 and reorganizes prior sections. That supplied content is preserved; this stage adds its own decisions/evidence and formatter normalization. The original entry plan is saved locally in `.release-test/stage6/entry-plan.md` (SHA-256 `cb5c18abbb1e3bc57c239fb3c2b5de0facc6729fb5acf0e515b8b7f522a0de36`). No final commit is created by this task.

Stage 5 dependency was checked against its [verification report](BMI_CALCULATOR_VERIFICATION.md), final commit `bc551903e145e9c7c94109ec55c4a0eab4632563` (`BigCalc CM 5`), docs-sync entry commit and the existing BMI model/module/view/registration/IME coverage. Initial Stage 5 closure and later IME follow-up remain separate historical evidence; this report does not rewrite their results or assert a new physical acceptance.

Prototype reference found outside the repository: `C:\Users\mmole\Downloads\calc.html`, 34 382 bytes, SHA-256 `548d6c5119c25c364fca78a88ab4a0bcaefb080105314796a49c9c9790a48ede`. Full review of its registry, normalization, parser, UI defaults/examples and affine path is recorded in the [registry audit](UNITS_REGISTRY_AUDIT.md).

## Specification and architecture deliverables

- `UI_SPEC.md` §§43.6/44.2: `units` / Единицы, mathematical value vs native unit text input, shared keyboard and focus, signed-integer unit grammar, seven exact dimensions, direct/name/prefix precedence, exact symbolic scales and standalone affine temperature rules, live/timeout/result/settings semantics, primary-only History, `Ans` exclusion, actions and source-only persistence.
- `DESIGN_SPEC.md` §50: portrait ordering, two generic secondary layouts, shared keyboard track without overlap, native IME chrome/background geometry, tokens/Liquid Glass/accessibility, displaySize on mathematical displays and verification matrix.
- [Module input/calculation ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md): records the primary-bound keyboard and persistence-only runtime deficiencies, plus the generic additive direction for Stages 7–9. It covers target lifetime, scoped services/settings, shared Worker ownership, globally unique IDs, isolation/error layering and required future regression coverage.
- [Registry audit](UNITS_REGISTRY_AUDIT.md): all 63 prototype unit entries, all symbols/name aliases and 20 prefixes; three duplicate keys and normalized-symbol/prefix traps. Standard conventions and exact sources are explicit. Manya, Dal, average-month identity/meaning and measured atomic-mass-unit scale remain quarantined pending explicit decisions. No claim of intentional easter eggs or intentional test data is inferred.
- `docs/CALCULATOR_MODULES.md` and the updated plan link the accepted specification/ADR/audit and distinguish future registration from today's installed BigCalc/BMI.

Defaults accepted: `1`, `км/ч`, `м/с`. Negative/zero integer powers are supported; lexical non-integer/scientific/chained powers are rejected. Standalone K/°C/°F/°R have exact temperature transforms and no prefixes in v1; affine endpoints cannot be compound expressions. V1 retains the 20 inspected decimal prefixes; newer SI/binary prefix scope is explicit. Factors cannot be authoritative `number` values; optional factor display must also use a Core-backed session.

## Separate baseline remediation

The first `npm run check` stopped at formatter warnings in the supplied plan and four existing checkout files: `scripts/android-bmi-acceptance.mjs`, `BmiCalculatorView.ts`, `bmi-integration.spec.js`, `bmi-view.spec.js`. Targeted Prettier normalization removed the warnings. The four existing files showed no textual Git diff after line-ending normalization; no harness logic, assertions, expected results or timeouts changed. Four intentional header line breaks in the supplied plan use explicit `<br>` instead of trailing spaces so `git diff --check` also passes, preserving their rendered meaning.

The first `npm run check:app` passed App types and all 331 unit tests, then repeatedly failed existing BMI browser assertions: `<p aria-label="Категория: Норма">` returned an empty accessible name. This is an existing implementation defect, not a Units dependency or an expected-result change: paragraph naming is prohibited by [W3C ARIA naming rules](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/). The already-failed run was stopped after 16 recorded assertions with this same cause, rather than counted as a completed full suite.

Separate minimal fix: the category paragraph receives `role="group"`, which supports its existing accessible name. Visible text, styles, numeric logic, persistence, IME layout, contracts and the parent polite/atomic status remain unchanged. Existing `toHaveAccessibleName` assertions failed before the fix and passed afterward; targeted production/view regression passed **46/46 browser tests (1.3min)**. No new tests are needed to duplicate that coverage, and no test expectations/timeouts were weakened.

The subsequent full App run passed 331 unit and 226 browser tests but the last existing Liquid Glass performance case observed a 1916.6ms frame gap against its unchanged 1000ms bound (13.5min browser run). Its first isolated repeat stopped during `beforeEach` because navigation/networkidle exceeded the existing 30s test deadline, before the performance assertion ran. A second isolated repeat passed (30.3s), maximum frame gap **233.3ms**. These observations do not prove a code performance defect or establish the cause of either outlier. No bound, timeout or expected result was changed.

The Android build was verified independently. After it finished, the test environment showed about 190MiB free out of 3.4GiB visible RAM; the completed build's Gradle daemon was stopped through the project wrapper before the complete App repeat to avoid retaining its memory. This resource observation is not proof of the earlier failures' cause. Logs for every run remain separate.

The complete App repeat passed: **331 unit tests in 30 files, all 227 browser tests (11.3min), App typechecks and production build**. The final existing Liquid Glass scenario measured **266.6ms** maximum frame gap, below the unchanged 1000ms bound. No parallel build or device work ran during this repeat. This is the final full App gate; isolated success was not substituted for it.

## Verification gates

| Command / check                               | Result                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run check` after formatter normalization | Passed: 404 Core tests, 14 benchmarks, formatter/lint/types/build and public API audit |
| Targeted BMI browser baseline remediation     | Passed: 46 browser tests                                                               |
| Final `npm run check:app`                     | Passed: 331 unit + 227 browser tests; types and production build                       |
| `npm run android:build:debug`                 | Passed: Gradle BUILD SUCCESSFUL in 25s; debug APK built                                |
| Final formatter/lint and `git diff --check`   | Passed; documentation links, registry inventory and scope audit also passed            |
| Physical Android availability                 | `adb devices -l`: no connected device                                                  |

Full App logs and targeted remediation evidence are local under `.release-test/stage6/`. The mandatory Android gate is a build, not a claim of installation/device testing. Stage 6 recommends physical smoke/lifecycle/BMI repeats when a device is available; none is currently connected, so those optional physical runs are not performed. Existing Stage 5 physical evidence remains scoped to its recorded device/WebView/IME/date.

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 7 439 554 bytes, SHA-256 `eac4f94040961e8bfb79e8aeede520b848a9721067eb9b77981ca870b53b7720`. Capacitor sync/build succeeded; APK was not installed because no device was connected. All four JS/CSS assets inside the APK match the final App production build by SHA-256. The final scope comparison confirms that the supplied plan is preserved apart from documented Stage 6 additions/formatting, the harness/tests have no text changes after line-ending normalization, and the BMI production fix is exactly one role attribute.

## Definition of Done mapping and boundary audit

| Stage 6 items                                      | Evidence                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| 1: current HEAD                                    | Entry section above                                                   |
| 2: green regression baseline                       | All mandatory verification gates above passed                         |
| 3–5: product, input taxonomy, shared keyboard      | UI_SPEC §43.6.1–2; ADR target/coordinator direction                   |
| 6: Core/Worker boundary                            | UI_SPEC §43.6.5–6; ADR scoped sessions over existing transport        |
| 7–9: grammar, dimensions, affine                   | UI_SPEC §43.6.3–5; audit exact definitions/resolution traps           |
| 10: persistence                                    | UI_SPEC §44.2; source-only revision 1, existing schema                |
| 11–12: no Ans, primary-only History                | UI_SPEC §43.6.1/6; module documentation                               |
| 13–14: deficiencies and accepted generic direction | ADR with existing-code evidence and Stages 7–9 regression obligations |
| 15: registry ambiguities                           | Complete audit and explicit quarantine ledger                         |
| 16: no Units production code                       | No Units module/model/view/registration; installed modules unchanged  |
| 17: Stage 7 unblocked                              | Unblocked; Stage 7 implementation not started                         |

Stage 6 makes no frozen Core/Worker/module/application runtime contract change. The only production behavior correction is the separately documented pre-existing BMI accessibility defect. Package scripts/dependencies, Core algorithms/API/version, Worker DTOs, Host/Surface/navigation and persistence schema remain unchanged. New runtime contracts and regression tests belong to Stages 7–9, not this documentation/decision stage. No unresolved architecture/spec conflict requires a second Worker, module-specific shell branch or Core workaround.

All 17 Stage 6 Definition of Done items are satisfied. Registry intent/uncertainty questions block only inclusion of the quarantined entries, not the generic Stage 7 keyboard task. Stage 7 is unblocked and is the next permitted implementation stage; it has not been started. Units production code/registration has not been added.
