# Generic module input coordination — Stage 8 verification

Date: 2026-10-06 (Europe/Moscow). Stage 8 closed.

## Entry and dependencies

Entry HEAD: `a6c0fd702a923f8eb5686bf1e6923c9fda516dba` (`BigCalc CM 7`), with a clean working tree. This task does not create a commit; evidence describes the Stage 8 working tree based on that entry.

Stage 7 was checked against its implementation, [verification report](SHARED_KEYBOARD_STAGE7_VERIFICATION.md) and the accepted [Stage 6 ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md). Its baseline passed 404 Core tests, 14 benchmarks, 333 App unit and 240 browser tests. The replaceable keyboard target, press invalidation and editor focus behavior are the blocking input dependencies. Stage 5 initial closure and subsequent IME follow-up remain separate historical evidence.

Applicable requirements: [Calculator Modules Stage 8](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §§43.6.1–2](../UI_SPEC.md), [DESIGN_SPEC §50](../DESIGN_SPEC.md), frozen [Core public boundary](../CORE_SPEC.md) and [Stage 26 compatibility baseline](APP_ARCHITECTURE_FREEZE.md).

## Implementation and ownership

`CalculatorModuleServices.inputs` is optional; runtime/view creation accepts an optional trailing services context. `CalculatorFieldDescriptor.inputKind` is optional and valid only on input descriptors. Legacy module hooks/callers remain compatible; metadata alone cannot activate a target. Host creates one input service scope per runtime, deactivates it before the runtime, and releases scopes before disposing views. Failed scope/view construction cleans up earlier scopes and runtimes.

`CalculatorModuleInputs.registerMath(target)` and `registerText(input)` return idempotent activate/deactivate/dispose registrations. Math registration additionally exposes `submit()` for physical Enter, gated to the active target; the shared keyboard's `=` calls the same target action. Modules own editor/field state and clear/submit behavior; App owns the single keyboard, global modes/expansion and input lifecycle. Current-settings/calculation services are not added here.

`CalculatorInputCoordinator` remembers the selected field per runtime. First math registration is the default without autofocus. Native text focus suspends math routing and allows IME; math activation blurs native text and suppresses Android IME. Legacy unregistered native fields remain supported. Suspended/inactive/unselected/hidden math fields cannot receive delayed editing DOM events. Keyboard target changes stop holds and retain Stage 7 release/click invalidation.

Drawer/Settings/About/History, background, module switching and pagehide release routing and hold. Resume never focuses an unavailable editor or steals native Settings focus. Only a still-selected active math editor can regain background focus; native fields never gain automatic focus. Selection, focus and registration are runtime-only. Existing primary History interactions retain their own editing lock; primary overlay geometry remains behind the inert layer, with routing disabled.

Secondary math layout uses a bounded scrollable surface above the keyboard; native/no-target layout fills the space below TopBar with keyboard hidden. The shared shell switches by math capability, with no Units branch. History remains primary-only. `NativeInputLayout` and Android host code are unchanged: chrome/wallpaper hold lasts through blur until actual viewport restoration. BMI stays native-only and keeps its implementation, state DTO and internal scrolling.

The synthetic math/text module exists only in `tests/app/fixtures/module-input.js`, not production registration or assets. No Units model/view/registration or Stage 9 service is implemented.

## Regression coverage and development findings

New coordinator coverage: nine unit tests for default selection/no autofocus, delayed DOM edits, scope isolation, Settings focus, background/return, switch, unregister/dispose, duplicate/hidden/inert/disconnected fields and native-only owners. Four added Host cases cover optional context/cleanup order, failed view construction, failed service factory and metadata compatibility. The final targeted unit run passed **16 tests** (nine coordinator and seven total Host tests).

Fourteen new browser cases cover compact/expanded keyboard at 360×640, 360×800, 390×844, 412×915 and 768×1024; one keyboard, 44px cell hit areas, internal scrolling/no overlap; math/text editing/AC/Enter/equals; delayed DOM edits; native resize/blur/restoration in dark/light Liquid Glass; Drawer/Settings/About and Back/Forward; Settings native focus; background/hold/switch/dispose; BMI and restart behavior. The clean targeted run passed **14 tests**.

Initial fixture failures came from selecting modules without the required Drawer navigation layer, using a button rectangle rather than its cell hit area, and matching the entire BMI status rather than its numeric output. Those fixtures/selectors were corrected. Existing behavior checks identified two implementation regressions from hiding the primary keyboard behind overlays: Timeout focus return to `=` and Settings preview geometry. Preserving the primary inert geometry fixed both; the repeated existing lifecycle/appearance suite passed **27 tests**. Runs during source edits produced Vite HMR reloads and are not treated as final verification. Final gates run with stable sources.

Initial lint checks rejected non-null assertions/empty fixture callbacks and browser globals without `globalThis`; these were corrected. Existing assertions, timeouts and performance bounds were not weakened. Local development and final logs are retained separately under `.release-test/stage8/`.

## Android artifact and physical acceptance

`npm run android:build:debug` passed (`BUILD SUCCESSFUL in 40s`). Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **7 439 554 bytes**, SHA-256 `e0c83abfb7c69ead745af8c1c03a124ff9debbf3c17345564ba4829f9798ecd8`. `adb install -r` succeeded without clearing application data. The completed Gradle daemon was stopped before device/full App verification.

Device: Samsung **SM-A576B**, Android **16**, Android System WebView **153.0.8010.36**, Samsung HoneyBoard IME. `npm run test:android:bmi -- --with-regressions` passed on this artifact, including existing smoke, lifecycle and Stage 34 acceptance. Separate Stage 27 and Stage 32R device harnesses also passed. No harness/assertion/timeout was changed.

BMI acceptance used native ADB tap/text/swipe events: **53 trusted input events**, **eight category cases**, **four appearances** (dark/lavender, light/blue, dark/light Liquid Glass), **zero Worker commands during BMI**. Height/weight IME opened; chrome checks compared TopBar, Drawer/overflow buttons and wallpaper before/open/closed, retaining identical geometry. With IME open the WebView was **384×439**; native internal scrolling reached the complete result card (`bottom=395.13`, `scrollTop=71.47`) without page scrolling or horizontal overflow. Android Back, Drawer/Settings/About, module stack, primary state and restart passed. Entry application storage was restored and verified.

Primary lifecycle also confirmed focused `inputMode="none"`, hidden software IME after background/foreground, Settings IME/Back, hardware typing and History lock/unlock. Stage 34 passed 36 Settings combinations and Liquid Glass responsiveness (maximum frame gap **266.5ms**). Stage 27/32R preserved holds, exactly-once actions, overlay cycles and TopBar swipe routing.

Evidence was copied to `.release-test/stage8/bmi-android/` (results JSON and screenshots, including `dark-liquid-glass-ime.png` inspected directly); the pre-existing BMI artifacts were retained separately in `.release-test/stage8/bmi-before/`. This is new Stage 8 device evidence, not a rewrite of Stage 5 initial closure/IME follow-up or Stage 6–7 results. Synthetic secondary math/text behavior is exercised by browser fixtures; real Android evidence covers the required BMI and primary host regression.

All **four JS/CSS assets** in the APK match the final `dist-app/assets` files by SHA-256. `.release-test/stage8/apk-asset-audit.json` records names and hashes. Synthetic probe strings/registration are absent from production JS assets.

## Final verification and Definition of Done

`npm run check` passed: **404 Core tests**, **14 benchmarks**, formatter/lint/types/build and public API audit. Its passing log is `.release-test/stage8/check-core-final.log`.

The first full App run passed 346 unit and 252 browser tests but took **3.4h** across a long interruption and ended with two timeouts: Stage 34 360×800 `beforeEach` (30000ms) and 390×844 Chromium launch (180000ms), before those cases' behavior assertions. Its log is retained as `.release-test/stage8/check-app-interrupted.log`; it is not a passing gate. There was no source/assertion/timeout change before repeating the complete gate.

The repeated **`npm run check:app` passed**: App typechecks, **346 unit tests in 31 files**, **all 254 browser tests (11.6min)** and production build. Both previously timed-out viewport cases passed. The existing Liquid Glass performance case measured **266.7ms** against its unchanged **1000ms** bound. Sources remained stable; no parallel build/device work ran during either full browser gate, and no tests were skipped. Passing log: `.release-test/stage8/check-app-final.log`.

| Gate                                                         | Result                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run check`                                              | Passed: 404 Core tests, 14 benchmarks, formatting/lint/types/build/API audit      |
| `npm run check:app`                                          | Passed: 346 unit + 254 browser tests, App types and production build              |
| Android build/install                                        | Passed; artifact/hash recorded above                                              |
| `npm run test:android:bmi -- --with-regressions`             | Passed: real BMI IME/layout plus smoke/lifecycle/Stage 34; entry storage restored |
| Android Stage 27 / Stage 32R                                 | Both passed on the same APK                                                       |
| Final formatting, `git diff --check`, scope/link/asset audit | Passed                                                                            |

| Stage 8 DoD                           | Evidence                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2: generic math/native registration | Optional scoped input context; registered math/text and legacy native fields; compatibility/lifetime unit tests                           |
| 3–5: visibility and both layouts      | Active field kind controls routing; five portrait/wide viewport cases, compact/expanded keyboard, no overlap/overflow, internal scrolling |
| 6: primary-only History               | Existing navigation rules; synthetic/BMI checks; full History regression                                                                  |
| 7: BMI unchanged                      | BMI source/DTO unchanged; browser regressions and physical native-IME acceptance                                                          |
| 8: math ↔ text switching              | Editing/AC/Enter/equals isolation, expansion/source retention, IME resize/restore and delayed DOM event tests                             |
| 9: overlays/Back/lifecycle            | Drawer/Settings/About and browser Back/Forward; hold/background/switch/dispose; real Android Back/lifecycle                               |
| 10–11: generic shell/one keyboard     | Capability-driven shell/owner scopes, no Units branch/registration or module-owned keyboard layout                                        |
| 12: full browser regression           | All 254 browser tests passed in the complete final gate                                                                                   |
| 13: Android BMI                       | Available physical device; current APK acceptance passed with real IME and stable chrome/wallpaper                                        |
| 14: Stage 9 unblocked                 | Generic scoped input service/layout ready; calculation/current-settings services remain unimplemented                                     |

Final scope audit: seven App implementation files, five App test/fixture files and Stage 8 documentation/plan. Core/version/API/grammar/algorithms, Worker/protocol/calculation controllers, editor contracts/model, BMI, installed modules, persistence, Android host, scripts/package files and normative specifications have no tracked changes. Prior stage reports retain their historical evidence. All 14 Stage 8 DoD items are satisfied; no blocker remains. Stage 9 is unblocked and not started.
