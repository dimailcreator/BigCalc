# Shared CalculatorKeyboard — Stage 7 verification

Date: 2026-10-06 (Europe/Moscow). Stage 7 closed.

## Entry and dependencies

Entry HEAD: `707b409562031565ed948517a0f22505d11f95e5` (`BigCalc CM 6`), with a clean working tree. This task does not create a commit; final evidence refers to the Stage 7 working tree based on that entry.

Stage 6 was checked against its [verification report](UNITS_STAGE6_VERIFICATION.md), accepted [input/calculation ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md), registry quarantine ledger and actual keyboard/editor/press implementation. Its final baseline passed 404 Core tests, 14 benchmarks, 331 App unit and 227 browser tests. Quarantined Units registry entries do not block generic keyboard work. Stage 5 closure and its later IME follow-up remain separate historical evidence.

Applicable requirements: [Calculator Modules plan Stage 7](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md), [UI_SPEC §§27–36/43.6.2](../UI_SPEC.md), [DESIGN_SPEC §§14–16](../DESIGN_SPEC.md), [Core public boundary](../CORE_SPEC.md) and the [Stage 26 compatibility baseline](APP_ARCHITECTURE_FREEZE.md).

## Implementation and ownership

`CalculatorKeyboardTarget` contains an `ExpressionEditor`, `clear(origin)` and `submit()`. `setTarget` replaces the active target; `clearTarget` releases it; `dispose` releases it permanently. A null initial target is supported. Target-dependent actions are ignored without a target, while angle/factorial controls and expansion remain global. The legacy `(editor, actions, modes)` constructor overload remains usable and its initial target is replaceable. Global action storage retains only global callbacks.

Replacement/clear invalidates all active target-dependent pointer bindings and stops the old editor's repeat before releasing its reference. `ButtonPressState` keeps the invalidated pointer's provenance until release/cancel, suppressing the release action and any compatibility click, including one retargeted onto another button or overlay. Stop callbacks run once per pointer sequence; late release cannot stop a replacement editor's hold. A new press remains usable. Numeric target generations are unnecessary: the invalidated press state is the equivalent lifetime boundary.

The single production keyboard starts with primary BigCalc's target. Physical editor Enter and shared `=` call the same target submit action. Primary clear/controller behavior, all insertion syntax, mode persistence, keyboard DOM/layout/expansion and Android `suppressSoftwareKeyboard` setup remain intact. Teardown disposes the keyboard before the editor. Target replacement itself does not focus an editor.

The registration owner must clear/replace a target before hiding or disposing its editor; Stage 8 will provide scoped registration/navigation coordination. Stage 7 adds neither that coordinator nor secondary keyboard layout/native input switching. Units production code/registration, Core/API/grammar, Worker DTOs, module contracts, persistence documents, dependencies and package scripts are unchanged.

## Regression coverage

Two new unit cases cover invalidation, release/click provenance, drag/cancel and subsequent pointer/keyboard activation. The targeted press/repeater run passed **10 tests**.

Thirteen new browser cases mount two real editors in a test-only fixture: initial/empty/legacy targets, dynamic replacement/clear, every insertion family, atomic functions and smart brackets, AC/Enter/`=`, keyboard vs pointer focus, selection/cursor preservation, global modes and expansion, held digit/AC/equals replacement, retargeted clicks, backspace switch/clear, same-target reattachment, no-target press activation and disposal. Hidden/disposed detached editors cannot receive a late action or regain focus.

Initial targeted keyboard/Stage 27 run passed **23 browser tests**. The final target/Stage 32R run passed **20 browser tests** (13 new + 7 existing). Existing assertions, performance bounds and timeouts were not weakened. An initial lint finding in the new fixture (`URLSearchParams` without `globalThis`) was corrected.

Regression sensitivity was checked by temporarily disabling only keyboard press invalidation, restoring the exact source in a `finally` block. The first sensitivity run revealed that hiding an editor shifted the fixture keyboard and canceled the pointer geometrically; that incidental cancellation masked the missing guard. The fixture now preserves both editor tracks. With stable geometry, the same test fails as intended: delayed release changes the replacement editor from `456` to `4567`. This is a deliberate negative check, not a failure of the final implementation. Logs for both sensitivity runs remain separate.

After restoring the implementation and stabilizing fixture tracks, all **13 target browser tests passed**. The first full Core gate stopped on the temporary `.ts` source backup outside the lint TypeScript project; renaming that local backup to `.txt` removed the tooling obstruction without changing scripts/configuration. The repeated `npm run check` passed: **404 Core tests, 14 benchmarks**, formatter/lint/types/build and public API audit.

Local logs are under `.release-test/stage7/`.

## Android artifact

`npm run android:build:debug` passed (`BUILD SUCCESSFUL in 29s`). Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **7 460 440 bytes**, SHA-256 `4bfe83ac39680b2063395888e4a65c979842108c770508396a8a3fe6edb32018`. Installation with `adb install -r` succeeded; existing application data was not cleared. The completed build daemon was stopped before device/full App verification.

Device: Samsung **SM-A576B**, Android **16**, Android System WebView **153.0.8010.36**. This is new Stage 7 evidence on its own APK, not a revision of Stage 5/6 results.

All four existing device harnesses passed on the installed artifact:

- `npm run test:android:stage27`: 100/1000/3000ms holds, exactly-once digit/operator/equals/AC/mode/History actions.
- `npm run test:android:stage32r`: ten open/close cycles each for Drawer, overflow and History; compatibility clicks and TopBar swipe routing preserved.
- `npm run test:android:smoke`: production Worker/Core calculation and 5000 verified digits, foreground result and Android Back layers.
- `npm run test:android:lifecycle`: focus/background/overlay/process recreation, software Settings IME/Back, hardware typing and History lock/unlock, portrait/touch behavior. Primary editor remains focused with `inputMode="none"`, and `dumpsys input_method` confirms IME stays hidden, including after three Home/foreground cycles. Its final viewport is 749px tall (visual viewport 749.51px).

Existing harness cleanup can print a missing prior adb forward or an already-running Activity warning; all commands exited successfully and their assertions passed. No device test scripts, expected results, deadlines or runtime contracts were changed.

All four JS/CSS assets in the APK match the final `dist-app/assets` files by SHA-256. The installed APK therefore contains the final keyboard implementation; production asset names are recorded in `.release-test/stage7/apk-asset-audit.json`.

## Final gates and Definition of Done

The complete `npm run check:app` passed on the final implementation: App typechecks, **333 unit tests in 30 files**, **all 240 browser tests (9.6min)** and production build. The existing Liquid Glass performance case measured **133.3ms** maximum frame gap against its unchanged **1000ms** bound. No parallel build/device work ran during this full gate; no tests were skipped or their expectations/timeouts weakened.

| Gate                                                             | Result                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run check`                                                  | Passed: 404 Core tests, 14 benchmarks, formatting/lint/types/build and public API audit |
| `npm run check:app`                                              | Passed: 333 unit + 240 browser tests, App typechecks and production build               |
| `npm run android:build:debug` + installation                     | Passed; installed artifact and hash recorded above                                      |
| Android Stage 27 / Stage 32R / smoke / lifecycle                 | All passed on the installed Stage 7 APK                                                 |
| Final formatter/lint, `git diff --check`, scope/link/asset audit | Passed                                                                                  |

| Stage 7 DoD items                              | Evidence                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1–2: replaceable generic target                | Target/global action split; set/clear/dispose; null and legacy constructor coverage                                                 |
| 3: primary unchanged                           | Existing keyboard, Stage 27/32R/32S, History/settings/navigation tests and Android runs                                             |
| 4–5: no Units production code or module branch | Production diff is limited to keyboard, button press and primary wiring; installed modules/Host/Surface unchanged                   |
| 6: exactly-once backspace                      | Immediate delete, delayed repeat, switch/clear/release/cancel and disposal regressions                                              |
| 7–8: modes and focus                           | Global controls with/without target; persisted modes, expansion, selection/caret, keyboard/pointer focus and detached-editor checks |
| 9–10: browser and full App checks              | Complete passing gates above                                                                                                        |
| 11: Android primary IME                        | Existing suppression configuration plus device lifecycle assertions for `inputMode="none"`, focus and hidden IME                    |
| 12: Stage 8 unblocked                          | Generic target ready for scoped input coordination; Stage 8 is not started                                                          |

Final scope audit: only the three App implementation files, press unit tests, new target browser fixture/tests and Stage 7 documentation/plan are changed. Core source/version/API/algorithms, editor model/contracts, Worker/protocol, modules/registration/navigation/surface, styles, Android host, persistence, scripts and package files have no tracked changes. Prior Stage 5/6 reports retain their historical evidence. Stage 7 is complete with no blocking issue; scoped input services/layout/native switching and Units production work remain later stages.
