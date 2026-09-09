# Engineering decision: Core API 1.0 freeze

Date: 2026-09-09  
Stage: 38 — first public Core API freeze

## Decision

The sole package entrypoint is `dist/core/api.js`, declared by `package.exports["."]`.
`src/core/index.ts` remains an internal omnibus entrypoint for Core development and tests;
it is not reachable as a package subpath. Public API version `1.0.0` begins at this stage.

The public runtime surface is allow-listed by `scripts/audit-public-api.mjs`. The same
audit follows the generated declaration dependency closure and rejects backend types,
math representations, graph types, algorithm names, and DOM/Worker types.

## Boundary audit

| Concern                                           | Decision                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Expression input                                  | Public through `createCalculationHandle(source, options)`                        |
| Lifecycle                                         | Public through opaque `CalculationHandle` with `refine`, `continue`, `cancel`    |
| Precision result                                  | Public as `VerifiedNumber` and the four-state `RefinementResult` union           |
| Errors                                            | Public typed `CalcError` union; no message matching required                     |
| Settings                                          | Public only as angle mode, factorial mode, and soft time limit                   |
| Formatting                                        | Public conversion from `VerifiedNumber` to `FormattedNumber`                     |
| Numeric backend                                   | Internal; no backend type or injection hook in the declaration closure           |
| `Rational`, `LazyReal`, `Ball`                    | Internal; hidden behind the handle, allowing a future third value variant        |
| AST and evaluation graph                          | Internal and owned by the calculation handle                                     |
| Chudnovsky/Stirling/fixed-point/coefficient state | Internal and absent from public declarations                                     |
| Worker transport                                  | Separate internal boundary; no Worker or `postMessage` type in package root      |
| DOM/UI                                            | No dependency or public type                                                     |
| History                                           | Internal service; not required to evaluate through the Core API                  |
| Registry                                          | Grammar-aware implementation retained internally; callback API not frozen in 1.0 |

## Registry and future value kinds

The parser already consumes a registry and `createRegistry` can add functions/constants
while preserving the fixed tokenizer and grammar rules. Its current callbacks receive
internal `RealValue` and evaluation-context objects, so publishing them would freeze the
very representations this stage must hide. Registry callbacks therefore remain internal
until the plugin-system specification defines an opaque public value contract.

Because public results expose verified decimal data rather than the internal `RealValue`
union, adding a future logarithmic/symbolic representation for extremely large numbers
does not require changing the input, lifecycle, settings, or ordinary result contracts.

## Compatibility policy

Within Core API major version 1:

- existing runtime exports and required contract fields are not removed or reinterpreted;
- new optional result metadata or additive entrypoints require tests and documentation;
- changes to verified-digit, pause/continue, cancellation, settings, or error semantics
  require a new major API version;
- internal modules and algorithm profiles carry no public compatibility promise.

## Verification

`npm run audit:public-api` builds the declarations, verifies the package export map and
runtime export allow-list, and scans the complete public declaration closure for leaks.
`tests/public-api.test.ts` exercises expression creation, settings, verified refinement,
formatting, typed syntax/math errors, soft pause/continue, and cancellation exclusively
through the frozen facade.
