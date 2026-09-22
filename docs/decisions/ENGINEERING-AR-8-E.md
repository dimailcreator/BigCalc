# AR-8: measured choice of the e provider

## Decision

AR-8 is complete. Select **binary-splitting factorial series** for the e strategy
to be integrated in AR-9 (`e: selected benchmark winner`). Replacement is
justified on the required grid: the current provider is not retained as the
long-term high-precision choice. Production remains unchanged in this experiment;
resource accounting and production lifecycle integration belong to that next step.
No crossover below 1000 digits is inferred from this grid.

Two complete repetitions on Windows / Node v20.17.0 give the following mean
refinement times in milliseconds. Sequential rows measure the increment from
the preceding grid point; direct means a fresh 30000-digit owner.

| Request          | Current recurrence | Binary factorial | AR-3 exp(1) |
| ---------------- | -----------------: | ---------------: | ----------: |
| Sequential 1000  |              33.71 |            13.63 |       20.90 |
| Sequential 3000  |             483.01 |            75.40 |      126.41 |
| Sequential 10000 |            6970.30 |           758.53 |     1490.12 |
| Sequential 30000 |           69880.38 |          7996.43 |    13412.48 |
| Direct 30000     |           81962.54 |          7791.81 |    12682.85 |

Binary factorial wins every point in both repetitions. At direct 30000 it is
approximately 10.5 times faster than the current provider and 1.63 times faster
than exp(1). All requested digits were verified, all families agreed, and
sequential prefixes and fresh direct results agreed. These are implementation
measurements, including current recurrence's per-term bigint-size diagnostics,
not an asymptotic claim about all implementations of recurrence.

Raw rows are in `benchmarks/results/ar-8-e.json`. A third repetition encountered
a long session suspension and was stopped; its entire partial run is preserved
under `excludedRun`, outside the 30 accepted rows. It contributes to no averages
or speedup claims. Two repetitions establish a clear local winner but are not
a cross-platform performance study.

## Scope and proof

AR-8 compares the existing factorial recurrence, an experimental binary-splitting
factorial series and the AR-3 small exp kernel at the exact argument 1. The
experiment lives in `benchmarks/e-candidates.mjs`; it does not add public API.

For the binary candidate, the exact recurrence is `N_k = k N_(k-1) + 1`, with
`N_0 = 1`. A block stores the affine map `N -> q*N+t`. Joining adjacent blocks
uses `(q_left*q_right, t_left*q_right+t_right)`. Thus after index n the partial
sum is exactly `N_n/n!`. The omitted positive series is bounded by
`2/(n+1)!`: after its first term, each successive ratio is at most 1/2.
Floating logarithms schedule blocks only; an exact integer inequality proves
the requested tail bound. Rational endpoints and outward backend conversion
include all rounding errors.

The candidate retains the exact prefix and an unfinished `BinaryBlock` across
checkpoint interruptions. Tests compare against an independently accumulated
100-term rational series and its tighter remainder, exercise repeated pauses,
and compare all three families through sequential and fresh direct refinement.
The experimental candidate has no production hard-resource accounting and must
not be installed as a production provider without that integration.

## Measurement protocol

Grid: 1000, 3000, 10000, 30000 significant decimal digits. Each repetition uses
fresh owners for each family and mode. Sequential mode extends one owner across
the grid; direct mode requests 30000 from a fresh owner. All families use the
same backend precision formula and prove their requested prefix inside refine.
The harness independently extracts and cross-checks prefixes outside timing;
those extraction times are reported separately. The exp candidate calls the
AR-3 routed small kernel directly at exact 1, excluding generic expression
range reduction. Unknown instrumentation remains null.

`onRow` persists each validated measurement outside the timed section. No
candidate uses previously rendered decimal text as mathematical input.

Reproduce after `npm run build`:

```powershell
node --expose-gc benchmarks/e-comparison.mjs benchmarks/results/ar-8-e.json 2
```

## Validation

- Full suite: 351 Core tests in 49 suites, plus 13 benchmark tests, all passed.
- Three new tests cover cross-family/direct/monotonic comparison and incremental
  row delivery, independent series containment, and pause/resume with cached reuse.
- Typecheck, ESLint, build and frozen public API audit passed.
- Changed files pass Prettier; no production Core or public API files changed.
- The binary candidate is deliberately experimental: production resource guards
  and routing are still required in AR-9. AR-8's benchmark-based decision is complete.
