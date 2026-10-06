# Shared module calculation/settings services — Stage 9 verification

Date: 2026-10-06 (Europe/Moscow).

## Entry and dependencies

Entry HEAD: `f6d02a3f60cd014d3638dfefc3109a40c4f89754` (`BigCalc CM 8`), with a clean working tree. This task creates no commit; evidence describes the working tree based on this entry.

Stage 8 was checked against the scoped input implementation, Host lifecycle and [verification report](MODULE_INPUT_STAGE8_VERIFICATION.md): 404 Core tests, 14 benchmarks, 346 App unit and 254 browser tests, physical BMI IME and primary regressions. Its optional services context is the blocking framework dependency. Historical Stage 5 closure/IME follow-up and Stage 6–8 reports are preserved separately.

Requirements: [Calculator Modules Stage 9](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §43.6.6](../UI_SPEC.md), [DESIGN_SPEC §50](../DESIGN_SPEC.md), frozen [Core boundary](../CORE_SPEC.md), accepted [Stage 6 ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md) and [App compatibility baseline](APP_ARCHITECTURE_FREEZE.md).

## Implementation

`ModuleCalculationService` owns generic module calculation scopes over the existing `CalculationClient` and protocol. `services.calculations/settings` are optional additive context fields; existing hooks and BMI remain compatible. The production App creates exactly one client/Worker. No module imports Core, constructs or terminates a Worker, or receives another owner's handles.

Each session has immutable source/settings, `ready`, `refine`, `continue`, idempotent terminal `cancel/dispose`, and at most one pending refinement, including while creation is pending. Mathematical create/refinement errors remain `CalcErrorDto`/`RefinementResultDto`; transport failures remain `CalculationTransportError`, with unknown gateway failures normalized separately from mathematics. Pause preserves the handle and continuation budget; consumer freeze means withholding requests, not irreversible cancellation. Closing a session prevents delayed results from resolving successfully; a delayed create acknowledgement receives additional disposal. Owner deactivation/settings replacement/disposal release its stale work without terminating transport.

Primary, History refiners and modules use one application-realm allocator, with separate branded session/request IDs backed by one monotonically increasing technical `bigint` counter. It replaces local primary counters and History UUID namespaces without changing expression/settings or transport DTO semantics. History replay still uses original snapshots/structured references.

Settings read/subscribe exposes only immutable `angleMode`, `factorialMode`, `maxCalculationTimeMs`. Identical settings and appearance/inertia changes are ignored. Update releases old module sessions before notifications. Zero/fractional non-negative finite timeout remains compatible with existing transport/persistence. Subscriptions survive deactivation for source/settings tracking, are explicitly unsubscribeable and are removed on scope disposal; inactive modules must defer calculation until activation. Primary startup accepts its saved snapshot before its first emission, avoiding transient defaults. Host activates scope before module hooks, and deactivates/releases it before runtime hooks; App teardown releases owners/controllers/History before terminating Worker.

No runtime session/handle/settings observer is persisted. The synthetic calculation module declares only source persistence; its fixture uses actual production Worker/Host/services, never Core directly. Stage 10 domain/registry/parser and Units production registration are not implemented.

## Regression coverage and development findings

Seventeen new service unit tests cover immutable settings, zero/fractional timeout, independent owners/multiple sessions, unique primary/History/module IDs, isolated cancel/dispose, pause/continue, duplicate pending work, delayed create/refinement, mathematical vs transport errors, three transport failure categories, settings invalidation/update/unsubscribe, App cleanup and Host activation/deactivation. The initial targeted run passed 182 tests (14 new at that point); the expanded service/Host run passed 23 tests (16 service + 7 Host). Final review added a regression for disposal/unsubscribe inside a settings notification: it failed before the listener membership/lifetime guard and all 17 service tests passed after the fix.

Five new browser cases use real Worker/Core for independent primary/secondary results/IDs; paused continuation with another session; cancel/dispose/navigation/source-only persistence; settings recomputation; and one production Worker with saved initial settings and appearance isolation. The first targeted run passed 17 browser tests (five new plus existing lifecycle/equals cases); the appearance assertion was then expanded to exercise real Settings theme/palette controls in the final full gate.

Initial lint found async private-field narrowing checks and unused mock parameters; helpers/typed mocks were corrected. Inspection found that restricting timeout to positive integers would contradict existing Worker/persistence behavior; the service now accepts the existing non-negative finite contract and has explicit zero/fractional regression coverage. Existing assertions/timeouts/performance bounds are unchanged. Local logs: `.release-test/stage9/`.

## Android artifact and physical acceptance

The final `npm run android:build:debug` passed (`BUILD SUCCESSFUL in 28s`). Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **7 439 554 bytes**, SHA-256 `3292d62b1e0fa641bb749ff810551c9a5edcc4780a9084164fea271fd4aebb76`. `adb install -r` succeeded without clearing application data. The Gradle daemon was stopped before device/full App verification.

Physical Samsung **SM-A576B**, Android **16**, WebView **153.0.8010.36**, Samsung HoneyBoard IME: final `npm run test:android:bmi -- --with-regressions` passed, including smoke, lifecycle and Stage 34. BMI used **53 trusted input events**, **eight category cases**, **four appearances** and **zero Worker commands**. Real height/weight IME checks retained identical TopBar/Drawer/overflow/wallpaper geometry before/open/closed. At **384×439** with IME open, native internal scrolling reached the complete result card (`bottom=395.13`, `scrollTop=71.47`) with `pageScrollY=0` and no horizontal overflow. Android Back, Drawer/Settings/About, module stack, primary state and restart passed. Entry settings/history/module storage was restored and verified. Stage 34 passed 36 Settings combinations, density/caret/restart checks and Liquid Glass responsiveness (maximum frame gap **215.5ms**).

The first device run on the earlier APK stopped at the unchanged Stage 34 `Settings open` timeout before BMI acceptance. The same APK passed on repeat without source/script/assertion/timeout changes. That result preceded the final notification lifetime guard; the final APK was rebuilt, installed and passed the complete device gate again. The failed run is retained as `.release-test/stage9/android-bmi-initial.log`; the intermediate passing log/artifacts are separate from final evidence. No root cause for the initial timeout is asserted.

Final evidence: `.release-test/stage9/android-bmi-final.log`, `android-stage34-final-results.json`, `bmi-android/` (results and screenshots, including directly inspected `dark-liquid-glass-ime.png`). Prior BMI artifacts and intermediate evidence remain in separate directories. This Stage 9 evidence does not rewrite Stage 5 initial closure/IME follow-up or Stage 6–8 reports. Synthetic calculation behavior uses real Worker browser fixtures; device evidence verifies the required production BMI/primary regressions.

All **six assets**, including **four JS/CSS assets**, in the APK match the final production build by SHA-256; `.release-test/stage9/apk-asset-audit.json` records names/hashes. Test calculation probe strings/registration are absent from production JS. Worker and CSS assets retain their entry-stage names/hashes.

## Final verification and Definition of Done

`npm run check` passed: **404 Core tests**, **14 benchmarks**, formatter/lint/types/build and public API audit. Final log: `.release-test/stage9/check-core-final.log`.

The complete `npm run check:app` passed: App typechecks, **363 unit tests in 32 files**, **all 259 browser tests (11.9min)** and production build. The five new browser cases passed, including the expanded actual Settings appearance controls. Existing Liquid Glass responsiveness measured **300.0ms** against its unchanged **1000ms** bound. Sources/fixtures stayed stable and no build/device/Core gate ran concurrently with the full browser gate. No tests were skipped. Final log: `.release-test/stage9/check-app-final.log`.

| Gate                                                         | Result                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run check`                                              | Passed: 404 Core tests, 14 benchmarks, formatting/lint/types/build/API audit      |
| `npm run check:app`                                          | Passed: 363 unit + 259 browser tests, App types and production build              |
| Final Android build/install                                  | Passed; artifact/hash recorded above                                              |
| `npm run test:android:bmi -- --with-regressions`             | Passed: real BMI IME/layout plus smoke/lifecycle/Stage 34; entry storage restored |
| Final formatting, `git diff --check`, scope/link/asset audit | Passed                                                                            |

| Stage 9 DoD                     | Evidence                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1: generic calculation service  | Optional owner-scoped `calculations/settings` context and reusable session API                                 |
| 2: existing protocol            | Service wraps the unchanged CalculationClient/Worker DTOs/runtime                                              |
| 3: one production Worker        | Production startup/appearance browser instrumentation; one existing factory call                               |
| 4: no direct module Core import | Service/context use App DTOs; synthetic owner imports only App services                                        |
| 5: independent sessions         | Real primary/secondary Worker results; IDs across two primary controllers, History and module owners           |
| 6: isolated cancel/dispose      | Multiple sessions/owners; actual Worker cancellation/disposal/navigation; primary remains usable               |
| 7: pause/continue               | Real soft timeout continues the same handle; consumer freeze preserves work by withholding requests            |
| 8: generic settings             | Immutable read/subscribe, saved startup snapshot, invalidation before notification, unsubscribe/disposal guard |
| 9: non-persistent handles       | Source-only test DTO; no persistence schema/repository changes or runtime serialization                        |
| 10: primary regression          | Full App browser/unit and physical smoke/lifecycle/Stage 34 passed; historical settings replay retained        |
| 11: BMI regression              | Full browser BMI/native-layout suite and physical four-appearance IME acceptance passed                        |
| 12: Stage 10 unblocked          | Input/keyboard/calculation/current-settings prerequisites available; Units domain remains unimplemented        |

Final scope: seven App implementation files, four App test/fixture files and Stage 9 documentation/plan. Core/version/API/grammar/algorithms, Worker/client/protocol/runtime, editor model, BMI, installed module registrations, persistence, Android host, scripts/package files and normative specifications have no tracked changes. All 12 Stage 9 DoD items are satisfied; no blocker remains. Stage 10 is unblocked and not started. No commit is created by this task.
