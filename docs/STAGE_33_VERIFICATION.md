# Stage 33 verification — 2026-09-28

Stage 33 closes the post-freeze remediation from Stages 27–32S. Stage 32S physical checks were reported passed by the user before this stage. No mathematical behavior was added in Stage 33; the public version was raised to **1.3.0** for the additive grammar already implemented in Stages 30 and 31.

## Regression and build gate

| Command                          | Result                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run check`                  | Passed: 404 Core tests, 14 benchmark-harness tests, typecheck, lint, format, build, public API audit. |
| `npm run check:app`              | Passed: 181 App unit tests, 105 browser tests, typecheck and production build.                        |
| `npm run build:app`              | Passed independently.                                                                                 |
| `npm run android:build:debug`    | Passed, `assembleDebug` successful.                                                                   |
| `npm run test:android:stage27`   | Passed on SM-A576B.                                                                                   |
| `npm run test:android:stage32r`  | Passed on SM-A576B: 10 open/close cycles each for Drawer, Overflow and History, plus TopBar swipe.    |
| `npm run test:android:stage33`   | Passed on SM-A576B: cancellation, log/power, iteration, root paste/History and two separate taps.     |
| `npm run test:android:smoke`     | Passed on SM-A576B: production Worker, Core root calculations and navigation.                         |
| `npm run test:android:lifecycle` | Passed on SM-A576B: safe area, IME, background/foreground, Worker and process recreation.             |

The debug APK was installed with `adb install -r` before device checks. APK: `android/app/build/outputs/apk/debug/app-debug.apk`; SHA-256: `B51DDFC3B2C2A1C39461E8C723CFF05449957EB05D6B464075B4190CBA325244`. Device: Samsung SM-A576B (`R5GL36KWGNT`).

## Physical-device acceptance matrix

| #     | Check                                                    | Evidence                                                                                                                                                                                                        | Result |
| ----- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1–2   | Hold/release digit and `=`                               | Stage 27 smoke: 100, 1000 and 3000 ms holds; `=` creates one History entry.                                                                                                                                     | Passed |
| 3–4   | `π-π`, `e-e`                                             | Stage 33 smoke: both displayed exact `0`.                                                                                                                                                                       | Passed |
| 5     | `e^ln(2)`                                                | Stage 33 smoke: displayed `2`.                                                                                                                                                                                  | Passed |
| 6–7   | `sin[1+1](0)`, `sin[4/2](0)`                             | Stage 33 smoke: both displayed `0`.                                                                                                                                                                             | Passed |
| 8–10  | `√2`, `√4!`, `√(40!)`                                    | Android production smoke: verified prefixes and exact `2`.                                                                                                                                                      | Passed |
| 11    | Paste `√(2+3)`                                           | Stage 33 WebView paste test yielded `√(2+3)` and `2,23606…`; separately, Android native ActionMode Copy and Paste restored that exact source after AC.                                                          | Passed |
| 12    | Save, History, restore a `√` expression                  | Stage 33 smoke saved `√(4/9)` and restored its source from a History card.                                                                                                                                      | Passed |
| 13    | Long press expression, Select all/Copy/Paste, IME hidden | ADB touch on the physical screen opened Android ActionMode. Select all covered the source; Copy produced the system confirmation; Paste restored the source after AC. `dumpsys input_method` showed IME hidden. | Passed |
| 14–16 | 10 quick single taps each for Drawer, Overflow, History  | Stage 32R smoke: 10 open/close cycles per control with one pointer activation per tap.                                                                                                                          | Passed |
| 17    | Two separate quick taps                                  | Stage 33 smoke: first Drawer tap opened, second closed.                                                                                                                                                         | Passed |
| 18    | TopBar vertical swipe                                    | Stage 32R smoke: opened History without Drawer activation.                                                                                                                                                      | Passed |

The WebView paste regression uses a `ClipboardEvent`; the separate Android ActionMode check exercised the system clipboard with physical touch injection. The native menu's position depends on device geometry, so that part was observed directly on SM-A576B rather than encoded as a portable coordinate assertion.

## Architecture audit

- `src/app` imports Core only through `@bigcalc/core` in Worker modules; there are no App imports from `src/core/**` internals.
- `src/app/worker/calculator.worker.ts` and `CalculationWorkerRuntime.ts` remain the production Core boundary. UI does not run mathematical refinement.
- History persists structured expression segments, stable reference IDs, original settings and display data separately. The saved decimal text is never parsed as the mathematical value of `Ans`.
- The `√` operator and expression-valued iteration are parsed and evaluated by Core. App editor/clipboard only transport source syntax.
- The source-only public handle and structured-reference contracts remain unchanged. No hard resource limit was altered for product-specific expressions.

Stage 33 Definition of Done and the post-freeze remediation milestone are complete. Further product work can follow the dependency chain in `APP_IMPLEMENTATION_PLAN.md`.
