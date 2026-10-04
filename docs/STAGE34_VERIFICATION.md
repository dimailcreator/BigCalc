# Stage 34 integration verification

Stage 34E acceptance passed on 2026-10-04. Stage 34A–34E is complete and Stage 35 is unblocked. Entry commit: `aee23fb` (Stage 34D), clean working tree. Production appearance remains the Stage 34A hue-dependent `tokens.css` baseline; Core version, Core sources, mathematical settings/semantics and Worker contracts are outside this stage's changes.

## Dependency audit

34A persistence defaults, old-v1 compatibility, validation and future-schema protection; 34B idempotent startup application and normal/glass scope isolation; 34C real DOM whitelist, sanitization, inertness, uniform scale and Settings controls; and 34D medium baseline, typography density, probe remeasurement, same-session refinement, geometry, caret and native clipboard were implemented in the preceding commits. Their tests are retained in the full integration gate. The medium entry metrics and physical three-size ActionMode checks are recorded in [Stage 34D verification](STAGE34D_VERIFICATION.md).

## Browser coverage

`tests/app/stage34-integration.spec.js` adds 19 integration cases: a complete 36-state Settings/apply/persistence/reload matrix; light/teal/large plus radians/gamma/custom timeout/custom inertia preservation; nine representative visual states; five complete Settings responsive cases; two Liquid Glass Stage 32S caret/History containment cases; and simultaneous Liquid Glass preview interaction/frame-gap sanity.

Representative states: dark/lavender/medium, light/lavender/medium, dark/blue/large, light/teal/small, dark/rose/small, dark/glass/large, dark/glass/small, light/glass/large, light/glass/small. Browser screenshots are generated in `.release-test/stage34/browser/`.

Settings matrix: 360×640, 360×800, 390×844, 412×915, 768×1024. Both themes with Liquid Glass and large/small display fonts retain reachable previews, all six swatches, all three radio labels, numeric fields and Back without horizontal overflow. Calculator comparisons cover the visible shell/TopBar/display/keyboard and every visible key. Expanded-only keys collapsed to zero height have no visible geometry and are excluded from these comparisons.

Existing suites retain source-only Core access; unchanged mathematical/Worker contracts; creation/cancellation/disposal guards; same-session refinement; passive real DOM previews; palette scope isolation; medium baseline; 320/360/384/390/412/768 density; native input/clipboard event semantics; Stage 32R exactly-once interactions; Stage 32S first/last-slot containment (≤1 CSS px); editor logical caret and keyboard access.

## Android coverage

`npm run test:android:stage34` uses the installed production debug APK and real Settings controls through WebView touch events. It verifies 36 independent appearance states and full settings persistence; zero presentation lifecycle commands; both themes and all six palettes; main/Ans/History font metrics and natural density; visible shell/keyboard geometry; compact History and first/last slots; light/glass/small and dark/glass/large caret/History regressions; simultaneous glass previews; light/glass/small appearance at first calculator mount, force-stop/process recreation and background/foreground; hidden expression IME. It restores its entry BigCalc localStorage snapshot in `finally`.

Device screenshots and structured results are generated in `.release-test/stage34/android/`. Native system ActionMode commands and visual quality are checked separately from synthetic DOM clipboard tests and from automated metric assertions.

## Gates and physical acceptance

Acceptance environment: Samsung SM-A576B (`R5GL36KWGNT`), Android 16, WebView `153.0.8010.36`; physical display 1080×2340, density 450; WebView 384×749 CSS px at DPR 2.8125. Debug APK was rebuilt and installed with `adb install -r`.

| Gate                             | Result                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                  | Passed: formatting, lint, typecheck, 404 Core tests, 14 benchmark-harness tests, Core build and public API audit                                       |
| App unit tests                   | 204 passed in 28 files                                                                                                                                 |
| `npm run check:app`              | Passed: App typecheck, 204 unit tests, 176 Chromium browser tests and production build                                                                 |
| `npm run android:build:debug`    | Passed: Gradle 112 tasks, 21 executed and 91 up-to-date                                                                                                |
| `npm run test:android:stage34`   | Passed: 36 states, persistence, density, geometry, caret, glass interaction, restart, foreground and IME                                               |
| `npm run test:android:smoke`     | Passed: real Worker calculation/refinement, foreground recovery and Back through overflow/drawer/Settings/History                                      |
| `npm run test:android:lifecycle` | Passed: safe areas, foreground focus, active Worker, persistence/process recreation, Settings IME, expression IME suppression, touch and portrait lock |
| `npm run test:android:stage27`   | Passed: 100/1000/3000ms holds activate calculator/mode/History controls once                                                                           |
| `npm run test:android:stage32r`  | Passed: 10 open/close cycles per TopBar control, real quick taps retained, swipe opens History without drawer activation                               |

APK: `android/app/build/outputs/apk/debug/app-debug.apk`; SHA-256: `261F408A451D9501A8D9EA08A5485734C2B33EBD3B0A487B35C24BFDBC00A9C7`.

All twelve physical theme/palette screenshots were inspected: lavender, blue, teal, amber, rose and Liquid Glass in dark and light. Normal surfaces retain distinct digit/operator/AC/equals groups and readable foregrounds. Dark Glass retains the dark star/Earth wallpaper, transparent surfaces and highlights; light Glass retains the bright wallpaper, light glass surfaces and dark text. Both actual glass Settings screenshots show simultaneous isolated dark/light previews, selected borders, all six swatches and three size rows. The nine browser representative screenshots were also inspected.

Physical density measurements, using actual `1ch` probes (font sizes in CSS px):

| Size   | Main result font / slots | Lone Ans font / slots | History result font / slots | Compact expression font / slots | Compact result font / slots | History expression font |
| ------ | ------------------------ | --------------------- | --------------------------- | ------------------------------- | --------------------------- | ----------------------- |
| large  | 32.7168 / 18             | 56.2176 / 10          | 31.3344 / 15                | 46.08 / 13                      | 27.648 / 21                 | 18                      |
| medium | 27.264 / 22              | 46.848 / 12           | 26.112 / 19                 | 38.4 / 15                       | 23.04 / 26                  | 15                      |
| small  | 21.8112 / 27             | 37.4784 / 16          | 20.8896 / 23                | 30.72 / 19                      | 18.432 / 32                 | 12                      |

All measured viewport targets rendered their full measured slot count. First/last slot bounds were inside usable content within 1 CSS px; observed negative margins were only floating-point noise below 0.00003px. Three-size main/Ans/History/compact screenshots were inspected. Light/glass/small and dark/glass/large both retained the `√(40!)` History result; trusted calculator-key touch changed `1234` at boundary 2 to `12534`, with the logical caret visible at boundary 3.

Liquid Glass sanity used three open/scroll/theme/palette/close/reopen cycles with two real previews. Maximum sampled animation-frame gap was 283.4ms in the full headless Chromium gate and 249.9ms in the final physical WebView run. These are interaction sanity measurements for this run, rather than a cross-device performance guarantee; no persistent freeze was observed. Real clones and glass effects were retained.

The reload probe observed light/liquid-glass/small at the first calculator DOM mount, before paint. Force-stop/process recreation restored the same appearance and full settings snapshot, including radians/gamma, 2750ms timeout and 3.2 inertia. Home/foreground preserved appearance; expression focus kept `mInputShown=false`.

Native ActionMode was checked again after appearance changes using real Android long presses and system menu taps (`adb shell input`), with actual system screenshots locating `Выбрать все`, `Копировать` and `Вставить`. No synthetic ClipboardEvent was used for these checks.

| Appearance            | Normal expression font | Native Select all | Exact source restored after native Copy → AC → Paste | Clipboard / IME                                                 |
| --------------------- | ---------------------- | ----------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| light / glass / small | 37.4784px              | 0–9               | `1234+5684`                                          | Trusted copy and paste; `inputMode="none"`, `mInputShown=false` |
| dark / glass / large  | 56.2176px              | 0–9               | `1234+5686`                                          | Trusted copy and paste; `inputMode="none"`, `mInputShown=false` |

Normal medium expression was also inspected at 46.848px (`1234+5685`). Together with the three-size main result/lone Ans/History/compact checks, this covers all six physical display-size targets. System menu placement varies with size and selection state; command coordinates were taken from actual screenshots. Stage 32R quick taps/swipe/Back and Stage 32S caret/containment passed after appearance changes. Existing Android lifecycle acceptance also confirms numeric Settings remain usable with the software keyboard and that system Back dismisses it.

Test tooling compares resting key geometry after release animation, excludes zero-height collapsed keys, and enables CDP Page before registering the startup probe. Snapshot restoration runs in the new document before bootstrap, after the outgoing App's lifecycle flush, and compares every original BigCalc storage entry. Screenshots, metrics and local recovery snapshots remain ignored verification artifacts in `.release-test/stage34/`.

UI_SPEC §39.3, DESIGN_SPEC §29.1 and APP_IMPLEMENTATION_PLAN now document the accepted model, presentation and completed 34A→34B→34C→34D→34E dependency chain. All Stage 34E Definition of Done items passed; Stage 35 is unblocked. No Stage 35 implementation is included.
