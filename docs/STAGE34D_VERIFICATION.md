# Stage 34D verification

## Entry baseline

Captured before modifying typography, from Stage 34C commit `2a07ac5`, on Windows Chromium `153.0.8010.12`, viewport height 800 CSS px. The live expression was `1/7`; main result was measured before explicit equals, lone Ans after equals, and History result after opening History. Counts use the real content width divided by the measured `1ch` probe width.

| Width | Main slots | Main font | Lone Ans slots | Ans font | History slots | History font |
| ----- | ---------- | --------- | -------------- | -------- | ------------- | ------------ |
| 320   | 19         | 26px      | 12             | 42px     | 16            | 24px         |
| 360   | 22         | 26px      | 13             | 43.92px  | 19            | 24.48px      |
| 384   | 23         | 27.264px  | 13             | 46.848px | 19            | 26.112px     |
| 390   | 23         | 27.69px   | 13             | 47.58px  | 20            | 26.52px      |
| 412   | 23         | 29.252px  | 13             | 50.264px | 20            | 28.016px     |

The regression test also compares medium font and probe metrics against the original CSS formulas at heights 640 and 800. This preserves the baseline across environments with different system fonts rather than treating one machine's slot counts as universal constants.

## Implementation

Display sizes use six semantic CSS typography tokens. Medium retains the existing formulas, including the short-height overrides; small uses 80% and large 120%. Large compact History typography is capped at 55px for expression and 34px for result so both lines, padding, gap and the top border still fit the existing 142px display. Keyboard, TopBar, navigation controls, Settings, safe-area and icon styles do not consume these tokens.

Settings supplies three native radio inputs in full-row labels. The appearance callback applies the dataset, updates presentation state, saves the complete settings snapshot, and synchronizes selection. No evaluation setting, expression model, Core API or Worker protocol is changed.

NumberViewport's existing ResizeObserver additionally observes the `1ch` probe. A font change therefore remeasures even a fixed-size History output. Slot counts continue to come from the actual content and probe widths. Increasing visible digit demand uses refinement of the current calculation session.

## Regression coverage

`tests/app/display-size.spec.js` covers native radio semantics and keyboard selection; immediate persistence and cross-setting preservation; medium typography compatibility; 320/360/384/390/412/768 widths in all three presets; strict large < medium < small density for main result, lone Ans and History; shell and compact layout preservation; all four History expressions (`√(40!)`, `1/7`, `10^100`, `10^-100`); first/last slot containment within 1 CSS px; fixed-output font-sensitive measurement; caret hit testing; clipboard and native input event paths with Android IME suppression; drag/flick and Home/Arrow navigation; and same-session Worker refinement with zero extra create/cancel/dispose commands.

At entry, `adb devices -l` reported no devices. After the device was connected, physical Android ActionMode and IME checks were completed separately from browser event-path tests (see below).

## Validation results

Verified on 2026-10-04:

| Gate                            | Result                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                 | Passed: formatting, lint, Core typechecks, 404 Core tests, 14 benchmark tests, Core build and public API audit.                              |
| `npm run check:app`             | Passed: app typechecks, 204 unit tests, 157 browser tests and production App build.                                                          |
| `npm run build:app`             | Passed as the final step of `check:app`, and during Android asset synchronization.                                                           |
| `npm run android:build:debug`   | Passed: production assets synchronized and debug APK assembled.                                                                              |
| `npm run test:android:stage32r` | Passed on SM-A576B: 10 open/close cycles each for Drawer, Overflow and History, plus TopBar swipe opening History without activating Drawer. |
| `git diff --check`              | Passed.                                                                                                                                      |

The browser suite includes 15 new Stage 34D cases. The medium baseline covers five widths at both 640px and 800px heights; the three-size geometry/density matrix covers 320/360/384/390/412/768px widths at 800px height. Existing portrait, compressed-height, tablet, accessibility and Stage 32R/32S browser regressions also pass.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

SHA-256: `261F408A451D9501A8D9EA08A5485734C2B33EBD3B0A487B35C24BFDBC00A9C7`.

## Physical Android acceptance

The same debug APK was installed with `adb install -r` on Samsung SM-A576B, Android 16, WebView `153.0.8010.36`. Physical display: 1080 × 2340, density 450; WebView viewport: 384 × 749 CSS px, devicePixelRatio 2.8125.

Each size was selected through the real Settings radio control. Native long presses and menu taps used Android `adb shell input` touch injection. System screenshots confirmed the Android floating ActionMode and its Russian `Выбрать все`, `Копировать` and `Вставить` commands. CDP inspected the resulting DOM selection and captured trusted clipboard events; no synthetic ClipboardEvent was used for these native checks.

| Size   | Expression font | Copied source / exact source restored after AC → native Paste | Select all offsets | Trusted Copy/Paste | IME    |
| ------ | --------------- | ------------------------------------------------------------- | ------------------ | ------------------ | ------ |
| large  | 56.2176px       | `1234+5679`                                                   | 0–9                | Both observed      | Hidden |
| medium | 46.848px        | `1234+5678`                                                   | 0–9                | Both observed      | Hidden |
| small  | 37.4784px       | `1234+5680`                                                   | 0–9                | Both observed      | Hidden |

All three inputs retained `inputMode="none"`, and `dumpsys input_method` reported `mInputShown=false`. Menu placement and the return from its overflow panel differ with size and selection state; commands were verified from actual system screenshots rather than assumed to occupy portable fixed coordinates.

Stage 34D Definition of Done is complete, including 34D.21 / DoD 22–23. Product documentation, the full theme/palette/size Android matrix and the full Stage 34 integration report remain scoped to 34E.
