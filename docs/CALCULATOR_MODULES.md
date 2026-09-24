# Calculator modules

`src/app/modules/CalculatorModule.ts` defines the module contract. The application owns the top bar, navigation stack, drawer, and keyboard layout. A module owns its fields, calculation behavior, output, errors, and calculation lifecycle inside its view. Only the primary BigCalc screen has history.

To bundle another calculator, create it with `defineCalculatorModule(...)` and add the registration to `src/app/modules/installedModules.ts`. `CalculatorModuleHost` supplies the drawer and navigation registrations; `CalculatorModuleSurface` mounts the module view. AppShell and `NavigationController` need no module-specific branches.

`fields` declares input and output IDs, labels, and optional descriptions. If a view renders a description label, it follows the label → description dialog interaction in `UI_SPEC.md`. The module contract has no keyboard layout setting.

State lives in memory while the app runs. A module with a `persistence` declaration also implements `restoreState` and `serializePersistentState`. The host loads that declaration when it creates the module, saves it before deactivation, and flushes it on page hide. The declaration controls which JSON data survives restart. Worker handles, live calculation graphs, and other runtime objects must stay out of the persistent DTO.

`tests/app/modules/CalculatorModuleHost.test.ts` registers a test calculator, switches to it through the existing navigation controller, and verifies state retention and restart restoration. `tests/app/module-framework.spec.js` checks that its screen mounts without changing the main shell.
