# ADR: Application persistence backend

## Status

Accepted at Stage 26; records the repository boundary implemented in Stages 15–20.

## Decision

`ApplicationRepositories` supplies settings, History, and calculator-state repositories over a small synchronous `StoragePort`. The browser composition root uses `window.localStorage`; repositories catch unavailable storage and report failed writes without turning storage failures into `CalcError`. The calculation/UI session continues in memory.

The document schema version is `APPLICATION_SCHEMA_VERSION = 1`. Settings use `bigcalc.app.settings.v1`, History uses `bigcalc.history.v1`, and module state uses `bigcalc.app.calculator-state.v1`. Unknown versions are not reinterpreted or overwritten. Invalid records are rejected; valid History references must point to earlier retained entries. Legacy math-mode and scroll-inertia keys migrate into the current settings document. A module declares its own positive `revision`, `serialize`, and `deserialize`; its serializer selects the JSON-only subset of state that survives restart. Runtime handles and lazy graphs are excluded.

## Why and consequences

The repository boundary isolates storage availability, JSON validation, version checks, and module-specific persistence from AppShell. History stores original expression segments, original settings, stable IDs, and display data so an old result can be reevaluated; its displayed decimal is presentation data. Adding a future storage adapter can preserve repository contracts. Schema or module revision changes require explicit migration and round-trip tests.

Evidence: `src/app/persistence/`, `src/app/history/HistoryStorage.ts`, and the persistence and History tests under `tests/app/`.

## Stage 34A additive appearance settings

The explicitly requested Stage 34A in `STAGE_34_IMPLEMENTATION_PLAN.md` extends `AppSettings` with required in-memory `theme`, `palette`, and `displaySize` fields. Stored v1 settings remain backward compatible: absent appearance fields load as `dark`, `lavender`, and `medium`, preserving the original calculation settings and inertia. New saves require and write all three fields. The shared `APPLICATION_SCHEMA_VERSION` stays at 1; History and calculator-module documents are unaffected.

Allowed values and validation live in `src/app/settings/AppearanceSettings.ts`. Present but invalid appearance values reject the settings document and return the full defaults, following the existing invalid-record policy; load does not rewrite the document. Invalid saves are rejected. Unknown schema versions remain protected from overwrite. Legacy math-mode/inertia migrations write a complete settings document including appearance defaults.

AppShell uses one complete settings snapshot for persistence and Settings synchronization, preserving appearance when existing keyboard, calculation, timeout, inertia, or lifecycle callbacks save settings. Appearance stays outside `EvaluationSettingsSnapshot`, Worker DTOs, and History evaluation settings. Runtime appearance and controls belong to Stages 34B–34D; Stage 34A preserves the current UI.

Evidence: `tests/app/persistence/LocalSettingsRepository.test.ts`, `tests/app/persistence/ApplicationRepositories.test.ts`, and `tests/app/settings.spec.js`.
