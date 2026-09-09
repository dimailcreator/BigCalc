# BigCalc Core API 1.0

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

`CORE_PUBLIC_API_VERSION` is `1.0.0`. The package root exports only:

- `createCalculationHandle`;
- `formatVerifiedNumber`;
- `DEFAULT_CALCULATION_SETTINGS`;
- `CORE_PUBLIC_API_VERSION`, `CORE_STAGE`, and `createCoreSmokeProbe`;
- the TypeScript contracts needed by those values.

Files under `src/core`, generated internal modules under `dist/core`, Worker transport,
history infrastructure, registry callbacks, AST, `Rational`, `LazyReal`, `Ball`, and the
numeric backend are implementation details and are not package entrypoints.

Function/constant registration remains registry-aware and does not change the grammar,
but its callback contract is intentionally not frozen as public API 1.0. A future plugin
contract can be added without changing expression grammar or the calculation-handle API.
