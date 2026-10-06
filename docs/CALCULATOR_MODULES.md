# Calculator modules

`src/app/modules/CalculatorModule.ts` defines the module contract. The application owns the top bar, navigation stack, drawer, and keyboard layout. A module owns its fields, calculation behavior, output, errors, and calculation lifecycle inside its view. Only the primary BigCalc screen has history.

To bundle another calculator, create it with `defineCalculatorModule(...)` and add the registration to `src/app/modules/installedModules.ts`. `CalculatorModuleHost` supplies the drawer and navigation registrations; `CalculatorModuleSurface` mounts the module view. AppShell and `NavigationController` need no module-specific branches.

`fields` declares input and output IDs, labels, and optional descriptions. If a view renders a description label, it follows the label → description dialog interaction in `UI_SPEC.md`. The module contract has no keyboard layout setting.

State lives in memory while the app runs. A module with a `persistence` declaration also implements `restoreState` and `serializePersistentState`. The host loads that declaration when it creates the module, saves it before deactivation, and flushes it on page hide. The declaration controls which JSON data survives restart. Worker handles, live calculation graphs, and other runtime objects must stay out of the persistent DTO.

`tests/app/modules/CalculatorModuleHost.test.ts` registers a test calculator, switches to it through the existing navigation controller, and verifies state retention and restart restoration. `tests/app/module-framework.spec.js` checks that its screen mounts without changing the main shell.

## Bundled BMI calculator

The production drawer contains BigCalc first and **ИМТ** (`bmi`) second. BMI has native height (cm) and weight (kg) inputs and calculates immediately within its own module; it does not use Core, Worker, or the primary calculation lifecycle. It has no history, custom keyboard, or calculate button.

The module accepts positive finite decimal input with comma or dot. It displays at most two decimal places with a comma and no trailing zeroes. Category is derived from the unrounded BMI: `100 cm / 29,996 kg` displays `30` but remains `Избыточная масса`. The normative category table and input states are in [UI_SPEC §43.5](../UI_SPEC.md#435-имт--первый-secondary-bundled-calculator).

Persistence stores only `heightText` and `weightText` in `bigcalc.app.calculator-state.v1`, module revision 1. Outputs are recomputed after restore. Switching retains both calculators' state; a fresh app may start on BigCalc. BMI inherits global theme/palette, including Liquid Glass; `displaySize` does not change its form typography.

Run `npm run test:android:bmi` with a connected physical Android device and the current debug APK installed. Use `ANDROID_SERIAL` to select a device and `ANDROID_HOME` to select the SDK (otherwise `.android-sdk` is used). `-- --with-regressions` also runs existing Android smoke, lifecycle, and Stage 34 acceptance inside the same storage snapshot guard. Input uses native ADB taps/text events; CDP observes the WebView and selects existing input text. Entry settings/history/module data are restored before bootstrap and checked even after failures. Evidence is written to `.release-test/bmi/android/`.

Implementation and acceptance evidence: [BMI verification report](BMI_CALCULATOR_VERIFICATION.md), [calculator modules plan](../CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md).

Android IME acceptance also compares shared TopBar and wallpaper geometry before/open/closed and reaches the result with native module swipes in four appearances. Shared Android layout retains chrome geometry during a native input's viewport reduction; the module surface still resizes and scrolls. Browser regression covers release on viewport restoration/width change and ordinary responsive resizing.

## Planned second secondary calculator: Единицы

Calculator Modules Stage 6 specifies `units` / **Единицы**; it is not installed yet. Stage 14 will register it after BigCalc and BMI. [UI_SPEC §§43.6/44.2](../UI_SPEC.md) defines source/input/conversion/persistence behavior; [DESIGN_SPEC §50](../DESIGN_SPEC.md) defines portrait layout. Source state is three strings: `valueSource`, `fromUnitText`, `toUnitText`, with defaults `1`, `км/ч`, `м/с`; revision 1 uses the existing module-state repository/document. Parsed units, compiled source, sessions, results, focus and selection are derived/runtime data and never persisted.

The value field uses the existing mathematical editor and the one application keyboard (`math-expression`, Android IME suppressed). Two native unit fields use `text` input/IME with the application keyboard hidden. History remains primary-only; Units rejects `Ans`/history-reference insertion, including paste, and `=` does not replace its source or create primary history. Result uses `VerifiedNumberDto` / `NumberViewport`, not prototype decimal rounding; global display size applies to mathematical displays.

Unit parsing/dimensions/prefixes stay module-local. Conversion compiles exact rational/symbolic scale/offset expressions into ordinary Core source and calculates through the existing shared Worker. Signed integer powers and the seven SI dimensions are explicit; affine temperature expressions are standalone. Names/aliases/unit AST never enter Core and JavaScript `number` is not an authoritative factor. All 63 prototype entries and 20 prefixes, resolution collisions and quarantined entries are recorded in the [registry audit](UNITS_REGISTRY_AUDIT.md). Quarantined/custom or uncertain entries need explicit decisions before inclusion.

The current framework cannot yet provide this behavior: `CalculatorKeyboard` captures the primary editor/actions, module runtime receives only persistence, and all secondary screens hide the keyboard/occupy all tracks below TopBar. The [Stage 6 ADR](decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md) accepts a generic additive direction: replaceable mathematical target (Stage 7), scoped input coordination/two secondary layouts (Stage 8), and scoped calculation/current-settings services over one production Worker (Stage 9). Existing BMI and legacy module registrations remain backward compatible; module-ID shell branches, private Core imports and module-owned keyboards/Workers are excluded. Stage 6 changes no runtime contract; implementation stages supply the specified regression coverage.

Baseline checks and closure: [Units Stage 6 verification](UNITS_STAGE6_VERIFICATION.md). Stage 7 is the next implementation stage; no Units production model/view/registration is part of Stage 6.
