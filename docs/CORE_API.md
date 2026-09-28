# BigCalc Core API

Current public version: **1.3.0**.

The package root is the stable, UI-independent API for evaluating BigCalc expressions.
It does not expose numeric-backend objects, balls, evaluation graphs, parser nodes, or
algorithm-specific state.

## Create and refine a calculation

```ts
import { createCalculationHandle, formatVerifiedNumber } from "bigcalc-core";

const created = createCalculationHandle("sin(30)+1/3", {
  settings: {
    angleMode: "degrees",
    factorialMode: "integer",
    maxCalculationTimeMs: 1000
  }
});

if (!created.ok) {
  console.error(created.error.code, created.error.message);
} else {
  let result = await created.handle.refine({ significantDigits: 50 });

  while (result.status === "paused") {
    // Each continuation receives a fresh soft-time budget and keeps graph state.
    result = await created.handle.continue();
  }

  if (result.status === "complete") {
    console.log(formatVerifiedNumber(result.value).text);
  } else if (result.status === "failed") {
    console.error(result.error.code, result.error.message);
  }
}
```

`cancel()` permanently cancels a handle. A later `refine()` or `continue()` returns a
result with `status: "cancelled"`.

## Settings

`CalculationSettings` contains only user-visible mathematical/runtime settings:

```ts
interface CalculationSettings {
  angleMode: "radians" | "degrees";
  factorialMode: "integer" | "gamma";
  maxCalculationTimeMs: number;
}
```

All fields are optional when passed through `CalculationOptions.settings`. Defaults are
available as `DEFAULT_CALCULATION_SETTINGS`. Internal precision, cutoff, backend, graph,
clock, and hard-resource policy are deliberately not configurable through this API.

## Results and errors

`refine()` and `continue()` return the discriminated union `RefinementResult`:

- `complete` contains a `VerifiedNumber`;
- `paused` is a resumable soft timeout and may contain a previously verified partial;
- `cancelled` is terminal and may contain a partial;
- `failed` contains a machine-readable `CalcError`.

Branch on `status` and then, for failures, on `error.code`. Error messages are diagnostic
text and must not be used for program logic.

`PrecisionRequest.significantDigits` asks the Core to prove at least that many significant
decimal digits. It does not set an internal working precision. Exact terminating results
may naturally contain fewer digits.

## Stability boundary

`CORE_PUBLIC_API_VERSION` is `1.3.0`. The package root exports only:

- `createCalculationHandle`;
- `createCalculationHandleFromSegments` for saved references with their original settings;
- `formatVerifiedNumber`;
- `DEFAULT_CALCULATION_SETTINGS`;
- `CORE_PUBLIC_API_VERSION`, `CORE_STAGE`, and `createCoreSmokeProbe`;
- the TypeScript contracts needed by those values.

Public version history:

- **1.1** added structured expression segments with stable saved references and their original settings.
- **1.2** added `InvalidIterationError` for an invalid value in a recognized function iteration.
- **1.3** added expression-valued iteration and the prefix `√` source operator.

An iteration count such as `sin[1+1](0)` or `sin[4/2](0)` is valid when the bracketed
expression evaluates to an exact, non-negative integer `Rational`. `sin[0](x)` is the
identity `x`. A syntactically valid expression with a negative, fractional, or
approximate count reports `InvalidIterationError` during refinement; malformed syntax
remains `SyntaxError`, and mathematical failures inside the count keep their own error
codes. `√2` and `√(4/9)` are Core source syntax, with `√` binding below postfix `%`
and above postfix `!` and power `^`. `√(-1)` reports `DomainError`.

The source-only `createCalculationHandle(source, options)` contract remains unchanged.

Files under `src/core`, generated internal modules under `dist/core`, Worker transport,
history infrastructure, registry callbacks, AST, `Rational`, `LazyReal`, `Ball`, and the
numeric backend are implementation details and are not package entrypoints.

Function/constant registration remains registry-aware and does not change the grammar,
but its callback contract is intentionally outside the public API. A future plugin
contract can be added without changing expression grammar or the calculation-handle API.
