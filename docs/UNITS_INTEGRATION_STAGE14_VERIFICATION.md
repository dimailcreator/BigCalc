# Units production integration — Stage 14 verification

Entry HEAD: `bd657173a4761526785a732cc0a79358ee5774ca` (`BigCalc CM 13`), clean working tree. No commit is created by this task; evidence describes the resulting working tree.

## Scope and dependencies

Calculator Modules Stage 14 only. The applicable Core public boundary, UI_SPEC §§43.6/44.2, DESIGN_SPEC §50 and App Stage 26 freeze were checked. Fresh dependency suites passed **456 tests** before registration: Units domain/compiler/controller/source/persistence, scoped calculation and presentation services, input coordinator, Host and BMI persistence. The existing Stage 13 view suite was also rerun: all **36 tests passed**.

The only production change imports `unitsCalculatorModule` into `src/app/modules/installedModules.ts` and appends it after BMI. The production drawer now lists **BigCalc → ИМТ → Единицы**. The completed Stage 13 view and lifecycle hooks run through the existing Host, Surface, navigation, input/calculation/settings/presentation services and shared Worker.

No Units-specific branch or other change is added to main, NavigationController, CalculatorModuleHost, CalculatorModuleSurface or the shared persistence repository. Core API/version/grammar/algorithms, Worker protocol, module contracts, persistence schema/revision, Android host, scripts, package/config/dependencies and normative specs remain unchanged. Historical Stage 5 closure and IME follow-up, and Stage 6–13 evidence, are preserved. Stage 15 physical acceptance and its Android automation are not started.

## Production browser evidence

`tests/app/units-integration.spec.js` adds **28 tests** against `/`, without a fixture shell or injected module runtime. Instrumentation observes the real Worker constructor and commands; it does not replace Core calculation or transport. A clipboard recorder checks presentation text only.

- Default source, generic registration/drawer order, accessible input attributes, one shared keyboard and one Worker; inactive construction starts no Units calculation.
- Shared π, √, functions, operators and atomic identifier deletion edit Units alone. Native from/to focus hides the keyboard; math focus restores it with expansion retained.
- Rational `1/3 m → cm`, irrational `√2 m → cm` and `π/2 m → cm`, and affine `25 °C → K` calculate through Core. Explicit `=` retains the source and creates no History entry.
- Real Settings and keyboard controls change degrees/radians for `sin(30)` and integer/Gamma for `0,5!`. Worker commands verify authoritative snapshots, new session identity and disposal of old Units work.
- Primary `1/3` is confirmed into exact Ans before Units runs. Its session is neither cancelled nor disposed; result, expression, History and atomic Ans remain intact. Returning and multiplying Ans by 3 gives exactly 1, proving the displayed finite decimal was not substituted as the value.
- BigCalc/BMI/Units retain independent source state through switches. BMI still produces `23,15` from `180`/`75`. Units releases its own session on leaving and creates fresh work from retained source on return, without replacing the shared Worker.
- A real production reload restores `π/2`, `m` and `cm` verbatim. The stored Units record contains only those three strings, revision 1 under schema 1. Focus/result/session are absent. Opening Units after reload selects the fresh math target and creates a new Worker calculation producing `157,0796…`. History remains empty; pagehide may persist the standard empty history document.
- Drawer, module stack, Settings, About and browser Back/Forward are exercised with both math and native targets. Overlays suspend routing, Settings native focus remains available, and closing restores the selected layout and source.
- The production single timeout dialog uses the same handle for hidden initial pause, explicit `=`, Continue and Cancel/freeze. Browser Back freezes rather than cancelling Core. Deactivation disposes the module handle. No History entry is created.
- Examples and swap each create one pipeline. Keyboard AC retains unit strings; form clear resets `1` and empty units. Copy contains the verified presentation value and target, with invalid output disabled.

The full portrait matrix (**360×640, 360×800, 390×844, 412×915, 768×1024**) checks compact/expanded math layout, native layout, bounded scrolling, result/example/catalog reachability, long invalid unit text, no horizontal overflow and 44px catalog controls. History is hidden for Units.

Four appearances use real Settings: dark/lavender with math keyboard, light/blue with native fields, dark/Liquid Glass with math keyboard, light/Liquid Glass with native fields. All three display sizes scale mathematical editor/result only; native inputs and chips retain their sizes. Appearance/inertia changes preserve calculation identity. Six screenshots, including expanded keyboards for both dark appearances, are saved under `.release-test/stage14/` and visually inspected for contrast, focus, wrapping and layout.

Two browser resize cases enable Capacitor's Android host path before reload, then focus a native field and reduce viewport height. They compare TopBar/button/wallpaper geometry, require the held-layout signal, check the shrinking content surface, switch to math while geometry remains held, and release only when the actual viewport restores. This is browser simulation of the production Android path; it does not claim physical IME acceptance.

## Harness findings and compatibility

Initial new tests incorrectly expected symbolic cancellation of π and of an irrational Ans at a decimal boundary. Core is not a CAS; representative irrational conversions and exact rational Ans chaining replaced those assumptions without changing Core or increasing timeouts. A whitespace-containing math source was correctly rejected by the frozen Core grammar (§23); successful restart now uses valid `π/2` while preserving unit-field whitespace. Existing source-preservation behavior remains unchanged.

Other new harness corrections use visible/hidden assertions for CSS-driven keyboard layout, enable the actual Android host path for resize, await its resize event before measuring, and account for pagehide's standard empty History document. Intermediate runs were 19/28, 83/86 and 4/5; final standalone production run passed **28/28 in 1.7min**. The 83/86 run included all 36 passing Stage 13 view tests. Both obsolete primary-editor selectors (BMI and inert settings-preview tests) now scope to the primary display because two production editors exist. Their source/result/Worker/preview assertions are retained. Module-list expectations now explicitly include Units; no prior timeout or performance limit is relaxed.

## Gates and artifacts

The first full App gate passed all 758 unit tests and 346/348 browser tests (14.9min). Its two failures exposed obsolete assumptions in existing tests: Drawer Tab wrapped after BMI, and primary character tokens were selected globally, including the hidden Units default `1`. The corrected accessibility test verifies the three-item forward/reverse focus cycle and preserves Escape/focus restoration; the token test retains its exact atomic-name/ordinary-bracket assertions inside the primary display. The full final gate passed after these changes. Initial Liquid Glass responsiveness passed at 316.6ms under the unchanged 1000ms limit.

| Gate                                 | Result                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Fresh dependency suites              | 456 passed                                                                                    |
| Existing Stage 13 view browser suite | 36/36 passed                                                                                  |
| Final production Units browser suite | 28/28 passed (1.7min)                                                                         |
| `npm run check`                      | Passed: format/lint/types, 404 Core + 14 benchmarks, build and public API audit               |
| `npm run check:app`                  | Passed: App types, 758 unit tests/41 files, all 348 browser tests (14.7min), production build |
| `npm run build:app`                  | Passed: separate production build                                                             |
| `npm run android:build:debug`        | Passed: fresh web build, Capacitor sync and assembleDebug (29s)                               |
| Final scope/docs/whitespace audit    | Passed: formatting, local links, git diff --check and changed-file/import audit               |

Heavy gates are serial. Production, test and fixture sources remain unchanged while Playwright/Vite runs. Logs, asset/APK audits and screenshots are ignored artifacts under `.release-test/stage14/`.

Final Liquid Glass responsiveness: **316.7ms** maximum frame gap, below the unchanged **1000ms** limit. The entry Worker (`calculator.worker-CZ1Oqi1c.js`) and both wallpapers retain their SHA-256 values. Registration includes Units view/domain/catalog/CSS in the production bundle: application JS, CSS and the Capacitor web chunk referencing that JS change. No test fixture is bundled.

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **7,439,554 bytes**, application `com.bigcalc.app`, version `1.0.0` / code `1`. SHA-256: `C91425985FF92D613CCCF36880DB2FDE2F00CFE53AF789C7E47811D5E6B60187`. Its `assets/public/index.html` and all six bundled web assets match the final `dist-app` files by SHA-256; the APK is verified against the current build rather than inferred from an existing file. No install/device acceptance is performed.

Commands include the selected dependency Vitest suites; `npm run typecheck:app`; targeted Units/view/BMI/navigation browser runs; the two corrected legacy browser tests; serial final `npm run check` and `npm run check:app`; `npm run build:app`; `npm run android:build:debug`; SHA-256 and APK ZIP asset comparison; final formatting, local Markdown link and `git diff --check` audits. Evidence files include `dependencies.log`, `typecheck.log`, `integration-first.log`, `targeted-browser.log`, `corrections-browser.log`, `integration-final.log`, `legacy-browser-final.log`, `core-check-final.log`, `app-check-final.log`, `web-build.log`, `android-build.log`, `entry-assets.json`, `final-assets.json`, `asset-audit.json`, `apk-metadata.json` and `apk-asset-audit.json`.

All **18 Stage 14 DoD items are satisfied**. No unresolved check, blocker or architecture/spec conflict remains. Stage 15 is unblocked; its physical Android IME tests, device automation and milestone closure remain future work.

## Files changed

- Production: `src/app/modules/installedModules.ts` only.
- Tests: new `tests/app/units-integration.spec.js`; installation expectations in `tests/app/modules/units/UnitsCalculatorModule.test.ts`, `tests/app/navigation.spec.js`, `tests/app/bmi-integration.spec.js`; primary editor selectors in BMI and `tests/app/settings-appearance.spec.js`.
- Additional existing browser tests: `tests/app/accessibility.spec.js` now covers the three-item forward/reverse Drawer focus cycle; `tests/app/stage23r.spec.js` scopes its primary atomic/character token assertions to the primary display.
- Documentation: this report, current calculator-module/architecture documentation and the Stage 14 plan closure. Prior verification reports remain unchanged.

## Definition of Done

| Stage 14 item                      | Evidence                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------- |
| 1. Standard installation           | Only installedModules registration changes production code                 |
| 2. Drawer order                    | Production and existing navigation/BMI registration assertions             |
| 3. No shell special case           | Unchanged main/Host/Surface/navigation/persistence and identity audit      |
| 4. Shared math keyboard            | Production π/√/functions/operators/atomic editing                          |
| 5. Native fields hide keyboard     | Both native targets, return to math, expansion retention                   |
| 6. One Worker                      | Constructor/command observations across primary/BMI/Units                  |
| 7. Core-backed results             | Rational, irrational and affine conversions                                |
| 8. Global mathematical settings    | Real Settings and keyboard angle/factorial controls, session audit         |
| 9. Primary state/history preserved | Exact rational Ans chain, unchanged History and primary session            |
| 10. BMI state preserved            | `180`/`75` retained and BMI `23,15` restored                               |
| 11. Units switching retention      | Three retained sources and independently re-created calculation            |
| 12. Source restart restoration     | Real localStorage/reload, verbatim original strings                        |
| 13. Result re-derived              | Fresh post-reload Worker create and verified output                        |
| 14. No Units History               | Hidden History, unchanged/empty storage, explicit `=` keeps source         |
| 15. Appearance                     | Four real Settings appearances, three sizes and six screenshots            |
| 16. Portrait/browser               | Five sizes, both layouts, expanded keyboard and navigation stack           |
| 17. Full regression/build          | Final Core/App gates, separate web build and debug APK passed              |
| 18. Stage 15 unblocked             | All prerequisites pass; current APK ready, physical acceptance not started |
