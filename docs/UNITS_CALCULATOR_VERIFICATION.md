# Units calculator — Stage 15 verification

Entry commit: `fcb7e689fab4758a1d8885c11f1ace1d2a152645` (`BigCalc CM 14`), clean working tree.

Final Stage 15 commit: `7594cc26305dcdba0b379a6e7f2060aa60d56c27` (`BigCalc CM 15`). It includes the initial Stage 15 closure and the subsequent Primary Back policy follow-up, whose verification is recorded separately below. Stage 14 registration and historical Stage 5 initial closure/IME follow-up remain separate.

## Scope and fixes

Calculator Modules Stage 15, plus the explicitly requested Android font/Back corrections and primary-display follow-up. Applicable Core public boundary, UI_SPEC §§41/43.6/44.2, DESIGN_SPEC §50 and App Stage 26 freeze were checked. Stage 14 prerequisite verification is recorded in [its report](UNITS_INTEGRATION_STAGE14_VERIFICATION.md); initial closure gates below reran those regressions.

Native IME shrinks the WebView across the `height <= 680px` breakpoint. Two production browser regressions failed before the fix: expression/result font sizes changed from `47.58px / 27.69px` to `35.1px / 22.23px`. The generic NativeInputLayout now retains unscaled numeric typography baselines until actual viewport restoration/width change, preserving live displaySize scaling. Both regressions pass after the fix.

The generic Android Back handler closes the top overlay, then dismisses an open shared math keyboard on secondary calculators, then uses navigation/exit. After the user clarified the primary policy, BigCalc skips keyboard dismissal and uses navigation/exit directly (see the follow-up below). Dismissal blurs the active math field, stops held actions/input routing and preserves source/session. Refresh/overlay close/background resume cannot reopen it; explicit focus can. History's legacy automatic focus restoration is suppressed when the keyboard was dismissed; explicit math focus inside History releases dismissal while routing remains suspended. UI_SPEC §41 records the user's explicit behavior decision. Seven Back-priority tests (including two primary-policy regressions) and two coordinator regressions join the existing suite.

The initial primary-display follow-up revealed a layout jump: keyboard dismissal expanded the display grid row and moved expression/result to the screen bottom. Physical screenshot `primary-position-before.png` records this behavior. Five browser geometry regressions failed before removing that row override. That initial correction retained the primary display rectangle during dismissal. The subsequent user clarification prohibits primary keyboard dismissal entirely. Updated browser/physical checks cover primary root exit, module-stack Back, visible keyboard on return and History Back; secondary dismissal remains covered.

No Core code/API/version/grammar/algorithms, Worker protocol, module contracts, unit registry/parser/compiler, persistence schema/revision or Android host changes are made. Package adds only the Units acceptance command. No next calculator implementation is started.

## Registry and parser baseline

The audited Stage 6 decisions remain authoritative: **59 units / 20 prefixes**, exact/conventional constants explicit, quarantined units/aliases excluded. [Domain Stage 10](UNITS_DOMAIN_STAGE10_VERIFICATION.md) records **235 domain tests**, including **102 parser / 126 registry** cases. Coverage includes all declared aliases/identities/prefixes, NFC/case/longest-prefix/ambiguity, compound factors/dimensions, groups, whitespace multiplication, signed integer powers and affine restrictions. Unit grammar stays module-local; mathematical value grammar stays Core-owned. Exact bigint factors compile to Core source and mathematical results are calculated only through the shared Worker/public API.

## Initial Stage 15 physical Android acceptance

Physical Samsung **SM-A576B**, serial `R5GL36KWGNT`, Android **16**, Google WebView **154.0.8037.101**, Samsung HoneyBoard IME (`com.samsung.android.honeyboard/.service.HoneyBoardService`). WebView viewport is **384×749**, DPR **2.8125**; native IME reduces height to **439**. No emulator is used.

`npm run test:android:units` passed against the initial closure debug APK identified below. The script checks all installed WebView assets against `dist-app`, snapshots `bigcalc.*`, seeds independent test data before bootstrap and restores the entry strings exactly in `finally`, also on failures. ADB performs real taps/text/Back/Home/swipes; CDP selects existing text and observes results, focus, layout and real Worker traffic without replacing Core or transport. Native input events are trusted. Initial evidence: `.release-test/stage15/initial-closure/units-results.json`; earlier harness findings are retained in `initial-results.json`, `second-results.json` and their logs.

| Physical case             | Verified display prefix / exact result |
| ------------------------- | -------------------------------------- |
| `1 км/ч → м/с`            | `0,2777777777777777…`                  |
| `π km → m`                | `3141,5926535897932…`                  |
| `√2 m → cm`               | `141,42135623730950…`                  |
| `1 J/W → s`               | `1`                                    |
| `1 kJ*h/J → s`            | `3600000`                              |
| `25 celsius → K`          | `298,15`                               |
| `32 fahrenheit → celsius` | `0`                                    |
| `1 bar → Pa`              | `100000`                               |
| `e m → m`                 | `2,7182818284590452…`                  |
| `sin(30) m → m`, degrees  | `0,5`                                  |

ASCII names/symbols typed with native ADB are existing registry aliases for the same mandatory conversions, including °C/°F. Russian default units are exercised directly. Shared app keyboard inserts π/e/√/sin/operators/digits/backspace; `2+3 → backspace → 4` yields source `2+4`, result `6`. Unknown unit, dimension mismatch, affine product misuse and explicitly submitted incomplete mathematical expression produce distinct errors with obsolete output cleared.

Math field is focused with `inputMode=none`, native IME closed and the single shared keyboard visible. Native from/to fields open IME and hide that keyboard. Native A→B keeps IME usable; native→math closes it and restores the shared expanded layout without losing source. IME Back keeps Units active. Overlay Back keeps the underlying math keyboard; the next Back dismisses it without navigation/source loss. Background/resume and leaving/returning preserve dismissal; explicit focus restores it. A further Back follows the module stack. The initial closure also checked primary dismissal/refocus; the later primary-policy follow-up supersedes that behavior. Its initial-closure display remained at y=75.706px, 352×209.861px before/after Back, with source `Ans*3` and result `1`; expression/result stay fully inside the 749px viewport.

**23 geometry checks** cover four appearances and all three display sizes: TopBar, drawer/menu button rectangles (tolerance <0.1px), wallpaper geometry and expression/result font sizes remain stable before/during/after IME and after native result swipes. Native WebView screen offsets are compared to exclude host panning. The module surface shrinks with native viewport height and scrolls internally; page `scrollY=0`, no horizontal overflow. Adaptive native swipes place the whole result between TopBar and IME. Numeric fonts (expression/result) remain **37.4784/21.8112px** small, **46.848/27.264px** medium, **56.2176/32.7168px** large while IME is open; global display scaling is retained.

Nine final physical screenshots include the primary calculator after keyboard Back and math + native IME for each dark/lavender, light/blue, dark/Liquid Glass and light/Liquid Glass, are in `.release-test/stage15/android/`. Representative normal and both Glass screenshots were visually inspected for stable header/background, readable fields/result, focus and keyboard separation. The final IME screenshots show the entire result above the native keyboard. The initial primary screenshot is archived under `initial-closure/primary-after-back.png`; the current primary screenshot additionally retains the keyboard.

Real Worker constructor count remains **1**. Initial Units `create/refine` commands use an independent session ID, leaving the primary session uncancelled/undisposed. Subsequent conversions generate Worker commands. BMI edits `180/75 → 23,15 / Норма` produce **zero** Worker calculation commands. BigCalc → Units → BMI → Units → BigCalc preserves all source states; primary `1/3` confirmed into Ans still gives exactly `1` after `Ans*3`, with original History unchanged by Units.

Source persistence is exactly `valueSource/fromUnitText/toUnitText`, Units revision 1 under application schema 1. Force-stop/reopen creates a fresh document and Worker; opening Units restores the three strings and sends fresh `create/refine` commands to recompute the result. The script observes the existing post-restart Worker through its prototype and CDP worker targets, comparing old/new target identities without a reload; the new Units create source and refine session must match. No derived result, focus/dismissal, parsed units, settings snapshot, session/handle or lazy graph is restored from storage.

## Harness findings

The first native run reached the correct integer `1`, but the new script used `startsWith` before trimming NumberViewport alignment spaces. The second reached the first appearance, but a duplicate geometry-object key overwrote the menu-button rectangle with an overflow boolean. Both observation errors were corrected without changing production calculations, expected values or timeouts; both failure paths restored storage. Screenshot review then strengthened result reachability from a one-sided bottom check to full result visibility, bounded native swipes and repeated chrome/font/page/host checks after scrolling.

The first complete App gate passed 764 unit / 348 browser tests (10.9min), with 200.0ms maximum Glass frame gap. Subsequent focus-policy audit added a failing coordinator regression and reproduced `History Back reopened dismissed keyboard` on the physical pre-correction APK, with entry storage restored. The minimal History focus guard and coordinator History-interaction selection fix resolve that edge; the targeted 16 Back/coordinator cases pass. Initial closure gates below reran the corrected artifact; this earlier full pass is intermediate evidence. After the primary-display geometry correction, all five Back browser regressions plus the three targeted Liquid Glass cases passed (8 tests, 48.9s, maximum Glass frame gap 333.3ms). The subsequent full Core attempt caught two unqualified browser globals in the new test; those were qualified with `globalThis`, and the complete Core gate then passed.

## Initial Stage 15 closure gates

Initial closure `npm run check` passed **404 Core tests + 14 benchmark tests**, formatting/lint/types/build and public API audit (`check-core-closure-final.log`). A later full App attempt passed 765 unit tests and 346/348 browser tests, but failed page navigation with `ERR_NETWORK_IO_SUSPENDED` and the following Menu lookup timeout. This failed run is retained in `check-app-final.log`; the affected cases and full gate were rerun without relaxing timeouts. Initial closure `npm run check:app` passed **765 unit tests in 42 files / 353 browser tests (14.9min)**, application typechecks and production build (`check-app-closure.log`). Its Glass frame gap was **333.3ms**, below the unchanged 1000ms limit. The separate `npm run build:app` also passed. `npm run android:build:debug` passed (31s), and the initial closure APK was installed with `adb install -r`. Initial closure `npm run test:android:units -- --with-regressions` passed all included commands: `test:android:smoke`, `test:android:lifecycle`, `test:android:stage34`, `test:android:bmi`, then Units acceptance. The outer guard verified exact restoration of the original entry storage. Stage 34 physical maximum Glass frame gap was **208.1ms**; BMI passed eight category cases, four appearances and fresh restart with zero Worker calculation commands during BMI edits. Initial combined evidence: `android-combined-closure.log`, `initial-closure/units-results.json`, `initial-closure/stage34-results.json` and `initial-closure/bmi-results.json`.

The initial closure full App gate includes **765 unit tests in 42 files** and **353 browser tests**. Stage 14's 28 production Units tests and Stage 13's 36 real view tests remain included, plus all existing primary/BMI/editor/Worker/persistence/layout/appearance regressions. The two production Android-host resize cases now also compare expression/result fonts; no timeout, expected mathematics or performance limit is weakened. Primary/default typography metrics and short-height behavior are checked by the existing display-size suite.

Portrait browser matrix remains **360×640, 360×800, 390×844, 412×915, 768×1024**, covering compact/expanded/math/native layouts, internal scroll and result/catalog reachability, long input/errors, safe areas, focus/touch targets, display sizes, normal/Glass appearance, exact Ans and independent History, shared timeout, Worker/session lifecycle and source-only reload. Real physical IME evidence above is separate from browser viewport simulation.

Initial closure debug APK build and installation passed: `android/app/build/outputs/apk/debug/app-debug.apk`, **7,502,754 bytes**, SHA-256 `34CF95FCF103907B501AA52E2487B79025DD872F5049C8A6759B7B449D8795C5`. The combined run verified installed `index.html` plus all six assets against the initial closure `dist-app` build. Worker bundle `calculator.worker-CZ1Oqi1c.js` remains **181,779 bytes**, SHA-256 `E536DB2FADFA7BAAE8BE018A98A13964E8AB2311CD65BCA661A62EF1138DB9D9`; both Liquid Glass wallpaper hashes also match Stage 14. Only the application JS/CSS/web-import chunks change. Asset/APK evidence: `final-assets.json`, `final-apk.json`, `android-build-closure.log` under `.release-test/stage15/`.

## Definition of Done mapping

| Stage 15 item                 | Evidence                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| 1. Physical Android           | Native Units acceptance on SM-A576B                        |
| 2. Math IME suppression       | Focus + `inputMode=none`, native IME false                 |
| 3. Shared keyboard editing    | Native app-key insertion and `2+4=6`                       |
| 4. π entry                    | App π key, `π km → m`                                      |
| 5. Unit native IME            | From/to focus + HoneyBoard + trusted events                |
| 6. Shared keyboard hidden     | Native-field focus checks                                  |
| 7. Native→math                | IME closes, math focus/keyboard/source retained            |
| 8. NativeInputLayout          | 23 checks including fonts/host offsets/native swipes       |
| 9. Linear conversions         | Speed/length/pressure matrix                               |
| 10. Compound units            | J/W and kJ*h/J cases                                       |
| 11. Mathematical expressions  | π/√2/e/sin(30), actual Core Worker                         |
| 12. Affine temperatures       | 25 °C → K; 32 °F → °C                                      |
| 13. Unit errors               | Unknown/dimension/affine restrictions                      |
| 14. Core errors               | Invalid math, failed phase/aria-invalid                    |
| 15. One Worker                | Real constructor count 1, independent session commands     |
| 16. No Core bypass            | Frozen code diff + lint + existing compiler/service tests  |
| 17. Primary state/history     | Original History retained; exact rational Ans*3=1          |
| 18. BMI retained              | 180/75 result/category, zero calculation commands          |
| 19. Units restart             | Force-stop/new document, restored source/recomputed result |
| 20. No persisted runtime      | Three-string source DTO, fresh create/refine               |
| 21. Physical appearances      | Dark/light normal and Liquid Glass, eight screenshots      |
| 22. Glass mixed input         | Chrome/wallpaper/fonts/host checks in both Glass themes    |
| 23. Full Core/App gate        | Initial full gates passed; final-tree gap remains          |
| 24. Existing Android suites   | Smoke/lifecycle/Stage 34/BMI passed in combined gate       |
| 25. Units Android gate        | Final Units combined acceptance passed                     |
| 26. Docs updated              | UI/Design/README/modules guide/plan/report                 |
| 27. Verification report       | This report + local JSON/logs/screenshots                  |
| 28. About/README shipped      | Existing Units described in product/About copy             |
| 29. Mixed input architecture  | Generic coordinator/layout proven on physical Android      |
| 30. Core module architecture  | Generic scopes/shared Worker/source-only restart proven    |
| 31. Units milestone           | Closed at initial closure                                  |
| 32. Next calculator unblocked | Unblocked by closure; no next calculator code              |

All 32 Stage 15 items passed the initial closure; the Units milestone was closed. Documentation formatting, local-link checks and `git diff --check` were part of that closure audit. The final Stage 15 commit includes the later Back policy change, verified separately below. The formal verification gap remains open: the full Core/App gates were not repeated after that change, so the initial full pass does not establish a full gate on the final tree.

## Primary Back policy follow-up — 2026-10-08

The user clarified that Back on primary BigCalc must not hide its keyboard. The handler now receives the generic primary-role flag and bypasses math-keyboard dismissal for that role. Overlay priority remains first; primary uses navigation/exit, while secondary calculators retain the first-Back keyboard dismissal. No module identity or contract change is introduced. Two new unit regressions failed before the fix (`primary-policy-before.log`); the physical old-APK root check also failed because Back hid the keyboard instead of exiting (`primary-policy-device-before.log`), with storage restored. Initial Stage 15 gates/APK identity above remain historical evidence. The follow-up passes application typechecks, full lint, **767 App unit tests in 42 files** and **37 targeted production browser tests** (2.1min: primary Back across all five sizes, navigation and all Units integration cases). Full Core and 353-browser gates above belong to the initial closure and were not repeated for this App-only policy change. The Worker bundle remains byte-identical.

Production/debug builds and `npm run test:android:units -- --with-regressions` pass on the same physical Samsung. Root primary Back reaches the Samsung launcher instead of leaving a calculator with a hidden keyboard; primary module-stack Back/return and History Back retain the keyboard, source `Ans*3` and result `1`. Secondary dismissal/refocus remains verified. All smoke/lifecycle/Stage 34/BMI/Units cases pass and entry storage is restored exactly. Current installed APK: **7,502,754 bytes**, SHA-256 `8719E32CC69D1349A9F7AD859BDAA04BD63CAAD00F63F626AB0EC4BD1404DF04`; installed index plus six assets match the current build.

Follow-up evidence: `primary-policy-check.log`, `primary-policy-lint.log`, `primary-policy-browser.log`, `primary-policy-build.log`, `primary-policy-android.log`, `primary-policy-apk.json`, `android/results.json`, `android/primary-policy-stage34-results.json` and `android/primary-policy-bmi-results.json` under `.release-test/stage15/`. The current `android/primary-after-back.png` was visually inspected with the complete primary keyboard visible. Initial closure JSON/APK identity and its primary screenshot are archived under `initial-closure/`.

## Limits and scope audit

Physical evidence covers one Samsung device, Android/WebView/IME combination. Portrait/wide browser matrix supplies additional geometry coverage; multi-device/IME, signed release/store distribution and landscape acceptance are not claimed. Debug APK is the tested artifact. Existing conventional registry definitions/exclusions remain unchanged.

Changes are limited to generic typography/input/Back handling, shipped About copy, two font regression assertions, two coordinator regressions, seven Back-priority unit cases, five primary Back browser geometry cases, one Android acceptance script/command and current documentation. Core/Worker/module contracts, calculator mathematics/source DTOs and Android host remain unchanged. Initial Stage 5 closure/IME follow-up and Stage 6–14 records are preserved. No new calculator is implemented.
