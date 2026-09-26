# Stage 23R — validation

Status: **IMPLEMENTED; Stage 24 READY**. The Stage 23R changes are limited to the application editor, the inertia setting, related UI documentation, and regression tests. Core code and public contracts are unchanged.

## Product behavior

- `numberScrollInertia` accepts the inclusive range `[0.1, 100]`; its default remains `1.6`. Invalid typed values retain the last accepted value on blur. Invalid current-schema settings fall back to defaults; an invalid legacy inertia is replaced by the default during migration.
- A user function-insertion command creates an atomic function name followed by an ordinary `(`. With a selection, it wraps the selected tokens in ordinary parentheses and leaves the cursor after `)`. The command uses the same supported function list as clipboard tokenization, including `exp` and `abs`. Paste and History reconstruction preserve their source text.

## Verification

- `npm run check:app`: 172 unit tests, 78 browser tests, typecheck, and production build passed.
- `npm test`: 373 Core tests and 14 benchmark-harness tests passed.
- `npm run lint`, targeted Prettier checks, and `git diff --check` passed.
- Browser smoke at 360 × 640 passed: `sin → sin(`, `sin(30)` via smart close yielded `0,5`, selection wrapping produced `sin(2+1)`, Backspace removed only `)`, and Settings accepted `0,1` and `100`. Screenshots of the open function, wrapped expression, and settled Settings screen were inspected locally under `test-results/stage23r-smoke-*.png` (ignored artifacts).

The browser smoke does not measure physical Android touch or IME behavior; Stage 23R does not define a physical-device gate.
