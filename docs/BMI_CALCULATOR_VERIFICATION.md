# BMI calculator verification

Date: 2026-10-05 (Europe/Moscow). Stage 5 closed.

Entry commit: `17deee45c1ab4d589d12e8ef8f6f73e192db4465` (`BigCalc CM 4`). The entry tree was clean before Stage 5.

Final Stage 5 commit: `bc551903e145e9c7c94109ec55c4a0eab4632563` (`BigCalc CM 5`). It includes the initial Stage 5 closure and the subsequent IME follow-up, whose verification results are recorded separately below.

## Scope and architecture

BMI is the first production secondary bundled calculator, registered through `installedModules.ts`. Existing Host/Surface/navigation own the shared shell, drawer, switching, Back, and persistence. BMI calculation is module-local. Core API 1.3.0, Worker contracts, module contracts, mathematical algorithms, and application schema remain unchanged.

Stage 5 updates About copy and its existing browser check, adds `scripts/android-bmi-acceptance.mjs` / `test:android:bmi`, corrects native Settings tap preparation in the existing Android lifecycle harness, and documents implementation/acceptance. Follow-up acceptance also corrects shared TopBar/wallpaper geometry during Android IME resize through `NativeInputLayout`, shared CSS and its Android-only bootstrap binding; five browser regression cases and native swipe/geometry checks were added. It does not start another calculator or Stage 6+.

## Automated correctness and browser coverage

Stage 4 dependency: 127 BMI unit tests were repeated successfully (99 model + 28 state/persistence). Initial Stage 5 full regression passed: 404 Core tests, 14 benchmark tests, 331 App unit tests in 30 files, and 222 browser tests, including 18 production BMI integration tests and 28 BMI view tests. The existing About scenario now verifies that BMI is available. Core public API audit passed.

Boundary regression includes each exact category threshold (18,5; 25; 30; 35; 40), neighboring inputs, empty/incomplete/invalid input, decimal comma/dot, non-finite/unrepresentable output, formatting without grouping/trailing zeroes, and `100 / 29,996 → 30 / Избыточная масса` from raw BMI.

Browser portrait matrix: 360×640, 360×800, 390×844, 412×915, 768×1024; IME-sized height in the view fixture. Production tests cover source/result, BigCalc expression/Ans/history, switching, fresh context/pagehide reload, repository subset/future schema, Back/Forward/Settings/About, displaySize, and dark lavender / light blue / both Liquid Glass themes. Browser assertions cover all palettes and semantic tokens. All five portrait and four representative appearance screenshots were visually reviewed. Stage 34 browser Liquid Glass maximum frame gap was 316,7ms (<1000ms).

One initial appearance screenshot captured Settings during its closing transition: the role-based hidden check passed after `aria-hidden` changed, before opacity reached zero. The test now also asserts `data-open=false` and `opacity=0` before capture. All four affected appearance cases passed again (29,7s); the refreshed screenshots show the active BMI form. Portrait evidence is in `test-results/`; refreshed appearance evidence is in `.release-test/bmi/browser-appearance/`. No application behavior or timeout was changed.

## Physical Android acceptance

Device: SM-A576B, Android 16, Android System WebView `com.google.android.webview` 153.0.8010.36; Samsung HoneyBoard `com.samsung.android.honeyboard/.service.HoneyBoardService`. Physical display 1080×2340, initial WebView viewport 384×749 CSS px, DPR 2.8125. Initial debug APK: 7 482 892 bytes, SHA-256 `9681104a66885db0cfef73295be93cd28387490f3661a0f71f91473f61008124`. Follow-up APK with the IME layout correction was built (Gradle 17s) and installed with `adb install -r`: 7 483 676 bytes, SHA-256 `4d3ff3d01bf2a23a86c8d703699c0c9ef4207cd276a8d05d0e61c55668d1efe2`.

Standalone and combined BMI acceptance passed: base 180/75, eight category/input cases spanning all six categories and exact thresholds, comma/dot, `29,996 → 30 / Избыточная масса`, native IME, primary history/Ans retention, shared Drawer/Settings/About/module-stack Back, four appearances, source-only persistence, process restart and primary IME suppression after restart. The final suite recorded 53 trusted input events and zero Worker commands during BMI edits. Entry storage restoration was verified.

With IME shown, the WebView is 384×439 CSS px. The result was reached by internal module scrolling (scrollTop 31,64px): card top 261,02px, bottom 423,24px, page scrollY 0 and no horizontal overflow. Six physical screenshots were visually reviewed: height IME, base/result IME, dark lavender, light blue, dark Liquid Glass, light Liquid Glass. Labels/units, fields, number/category and focus remain readable and reachable; the form scrolls when the IME reduces available height.

The final combined suite also passed `test:android:smoke`, `test:android:lifecycle`, and `test:android:stage34`. Smoke exercised seven primary calculations, real Worker pause/continue and 5000 verified digits, UI responsiveness, foreground return and four Android Back layers. Lifecycle covered safe areas, expression IME suppression/physical keys, Settings IME containment/Back, background flush, resumable/frozen sessions, process recreation, touch inertia/history and portrait lock. Stage 34 applied/persisted all 36 appearance combinations, checked main/Ans/History density/caret/containment, first mount/force-stop restore and Liquid Glass; maximum frame gap was 299,6ms (<1000ms). Both the Stage 34 nested snapshot and the outer original device storage were restored and verified.

Initial harness runs failed on an assertion comparing NumberViewport padded text to `5`; observed expression was `2+3`, phase `completed`, result `5` with leading blank slots. Both primary assertions now compare trimmed text, keeping the expected number and state checks. No application fix was needed. The first combined suite passed Android smoke but exposed a pre-Stage-34 assumption in the existing lifecycle script: numeric Settings input center was at CSS y=961 outside the 749px viewport after Appearance became the first section (DESIGN_SPEC §29.1). `revealSettingsInput` now scrolls the real Settings surface and checks containment before both native numeric-field taps. Existing IME/safe-area/lifecycle assertions and timeouts remain intact. Every failed run restored entry storage.

`npm run test:android:bmi -- --with-regressions` runs existing Android smoke/lifecycle/Stage 34 checks under a shared entry-storage guard, followed by BMI acceptance. Numeric source enters via native ADB tap/text/key events with the IME visible, without assigning BMI input values or dispatching synthetic input events. CDP observes results and selects existing text for replacement. Both comma and dot are tested. This is automated testing on a physical device, not a claim of manual tapping of every soft-keyboard key.

The suite tests native IME for both fields, primary IME suppression before/after restart, base 180/75, six categories and exact thresholds, raw category vs rounded number, empty/invalid clearing, trusted input events, zero Worker commands during BMI editing, history isolation, primary Ans/result retention, shared Back, four representative appearances, source-only persistence and force-stop/reopen. Original `bigcalc.*` storage is restored before bootstrap and compared to the snapshot even on failure. Device evidence is under `.release-test/bmi/android/`; Stage 34 evidence is under `.release-test/stage34/android/`.

## Closure gate

The table below records the initial Stage 5 closure; follow-up IME acceptance is recorded separately below.

| Check                                     | Result                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `npm run check`                           | Passed: 404 Core + 14 benchmark tests; format/lint/types/build/API audit |
| `npm run check:app` / `npm run build:app` | Passed: 331 unit + 222 browser tests; types and production build         |
| `npm run android:build:debug`             | Passed: Gradle BUILD SUCCESSFUL in 11s; installed APK                    |
| Android smoke / lifecycle / Stage 34      | Passed; 36 Stage 34 combinations, frame gap 299,6ms                      |
| `npm run test:android:bmi`                | Passed; 8 category/input cases, 4 appearances, IME/restart/storage       |
| Visual review / `git diff --check`        | Passed: 9 browser + 6 physical screenshots; clean whitespace checks      |

## Limitations and milestone

Physical acceptance is scoped to the connected device/WebView/IME. It does not prove every Android keyboard, locale, font scale or OS version. BMI v1 retains its accepted scope: cm/kg, six adult categories, module-local numeric calculation, no history/custom keyboard/medical advice. The full Core result guarantees apply to primary BigCalc; BMI is not a verified-digit Core computation.

Stage 5 is closed: all 26 Definition of Done items are satisfied, full gates passed and physical evidence is recorded. The first real bundled-calculator milestone is closed and the existing module architecture is proven through a production calculator. Stage 6+ is unblocked and has not been started. No architecture/spec conflict or blocking failure remains. The initial closure and subsequent IME follow-up are included in the final Stage 5 commit recorded above.

## Follow-up: open IME geometry — 2026-10-05

The initial acceptance opened native IME but reached the result through `scrollIntoView()` and did not compare shared TopBar or wallpaper before/after the resize. That coverage missed a visual bug: WebView height changed 749 → 439 CSS px, TopBar buttons shrank 50,22 → 44px and moved, and the Liquid Glass wallpaper changed height 794,48 → 465,46px, scaling/recentering its image. Initial closure therefore did not establish this behavior.

`NativeInputLayout` captures the shared geometry before a native editable field opens the IME, retains it during same-width height reduction, and releases it after viewport restoration or width change. The actual module surface still follows available viewport height and scrolls internally. Primary expression `inputmode=none` is excluded. Existing responsive geometry and theme-preview scopes keep their behavior. The helper is enabled only for Android and disposed with the app lifecycle; Core, Worker, BMI calculation/state and module/navigation contracts are unchanged.

The five new browser cases exercise both ordinary and Liquid Glass themes, tall/short baselines, refocusing between fields, blur before IME closes, repeated open/close, result reachability, normal resize, width change and disposal. Targeted regression passed. Expanded physical acceptance now compares header/button positions and dimensions (tolerance <0,1 CSS px), exact wallpaper height/top/width, both fields, and IME open/close in all four appearances. Result is reached with native ADB swipes rather than programmatic scrolling; reverse swipe restores the height field. All ten geometry checks passed. With IME shown, the result card spans y=232,91–395,13 within the 439px viewport, module scrollTop=71,47px, page scrollY=0, no horizontal overflow. Four additional IME appearance screenshots were reviewed.

A separate physical interaction probe entered `180` and `75` by tapping HoneyBoard's visible numeric keys at positions verified from its screenshot, generating five trusted input events without ADB text injection or assigning input values. It checked forward/reverse native swipes, refocus, IME Back, and Liquid Glass before/open/closed screenshots. It passed and restored entry storage; evidence is under `.release-test/bmi/ime-interaction/`. This probe is scoped to this device's inspected 1080×2340 HoneyBoard layout; the reusable acceptance script keeps generic native ADB text input.

The first follow-up Android regression run exposed a lifecycle-test observation race: native resize arrived before WebView finished scrolling the focused Settings field (transient bottom 478,55px; settled bottom 273,39px within 439,11px). The existing 5s resize wait now observes both resize and focused-field containment, retaining the original final assertions and time budget. A separate settled-state probe confirmed containment. Full Android smoke/lifecycle/Stage 34/BMI acceptance then passed; Stage 34 maximum frame gap was 299,6ms. Original storage restoration passed on both failure and success.

The first follow-up full App run passed 331 unit and 226 browser cases but the final Liquid Glass performance case exceeded its unchanged 1000ms bound (2183,2ms), while device/screenshot work ran concurrently. A complete repeat without that concurrent work passed: 331 unit tests, all 227 browser tests (8,7min), types and production build; maximum Liquid Glass frame gap 166,7ms. This observation does not establish a code performance defect or prove the cause of the outlier. Expected results, performance bound and timeouts were preserved.

Final follow-up gates passed: full App regression/build, Android debug build/install, Android smoke/lifecycle/Stage 34/BMI, formatter/lint, syntax checks and whitespace/scope audit. The installed APK and final production build share the same JS/CSS asset hashes. The previous 404 Core + 14 benchmark/API regression remains the unchanged Core baseline; no Core source or contract changed. Stage 5 closure is confirmed with the expanded IME coverage. Device storage is restored, no blocking failure remains, and Stage 6+ has not been started.
