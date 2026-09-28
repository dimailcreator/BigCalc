# Post-freeze Core remediation history

The original Core `IMPLEMENTATION_PLAN.md` was removed when the repository moved to application development in commit `d4cc0a1`. Its historical stages remain available with `git show d4cc0a1^:IMPLEMENTATION_PLAN.md`; those stage descriptions are not retroactively changed by this note.

The following changes were made after the first Core API freeze under the separate `POST_STAGE_26_REMEDIATION_PLAN.md`:

| Stage | Change                                                                                                                  | Decision or regression evidence                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 28    | Exact cancellation of lazy constants such as `π-π` and `e-e`, without sacrificing lazy state or error bounds.           | `tests/constants.test.ts`; `POST_STAGE_26_REMEDIATION_PLAN.md` Stage 28                                  |
| 29    | Local exact routes for problematic logarithm/power compositions such as `e^ln(2)`; hard resource policy remains intact. | [Stage 29 decision](decisions/ENGINEERING-STAGE-29-LOG-POWER.md), `tests/log-power-compositions.test.ts` |
| 30    | Function iteration accepts an expression in `[...]` whose evaluated value is an exact non-negative integer.             | [Stage 30 decision](decisions/ENGINEERING-STAGE-30-ITERATION.md), `tests/iteration-expressions.test.ts`  |
| 31    | Prefix `√` is Core source syntax with a dedicated AST node and real square-root semantics.                              | `tests/square-root-syntax.test.ts`, `tests/parser.test.ts`                                               |

Stages 30 and 31 are additive grammar changes exposed in Core public API **1.3.0**. The source-only calculation handle contract and structured reference contract remain compatible. `CORE_SPEC.md` defines their current mathematical semantics; `APP_IMPLEMENTATION_PLAN.md` records the application dependency chain.
