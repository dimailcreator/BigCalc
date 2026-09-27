# ADR: Bundled calculator module boundary

## Status

Accepted at Stage 26; records the Stage 20 module contract.

## Decision

A bundled calculator supplies `id`, `title`, optional field descriptors, `createState`, optional view and activation hooks, and an optional typed persistence declaration. `defineCalculatorModule` validates registration and hides the module's state types behind `RegisteredCalculatorModule`. `CalculatorModuleHost` creates runtimes, loads declared state, activates/deactivates modules, and flushes persistence. `CalculatorModuleSurface` mounts their screens; `NavigationController` receives registrations without knowing module internals.

AppShell retains the top bar, drawer, navigation stack, and keyboard layout. The primary BigCalc alone owns History. A secondary module owns its fields, validation, calculation, result and error presentation, and its own calculation lifecycle. Its view is mounted in the shared shell. The `fields` metadata does not grant a module control over keyboard layout or a separate History surface.

## Why and consequences

To add the next bundled calculator, implement its view/state and register it in `src/app/modules/installedModules.ts`. No module-specific AppShell or navigation rewrite is required. Persistent module data is a declared JSON subset; session-only handles remain private. User-created calculators and a plugin marketplace are outside this contract.

Evidence: `docs/CALCULATOR_MODULES.md`, `tests/app/modules/CalculatorModuleHost.test.ts`, and `tests/app/module-framework.spec.js`.
