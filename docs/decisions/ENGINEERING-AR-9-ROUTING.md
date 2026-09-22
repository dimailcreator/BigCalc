# AR-9: production strategy routing

AR-9 is complete: production kernels use the shared selection policy or the
explicit local policies listed below, and the AR-8 winner for e is integrated.

## Policy and ownership

`src/core/math/algorithm-strategy.ts` owns measured policy for ln, exp, sin/cos,
pi and e. The existing local routers still own their context-scoped caches and
pending jobs. Thresholds select work; they neither limit precision nor alter
tail proofs, outward rounding, domains or exact fast paths. No strategy or
backend types are added to the frozen package API.

| Production operation                                                 | Strategy selection                                                                                                                                                                                                                              | Internal observability                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ln; logarithms through ln                                            | Sequential below 128 working digits, rectangular below 4096, binary thereafter; near-one rational arguments can stay sequential                                                                                                                 | `getAlgorithmRoutingSnapshot`, `ReducedLogProvider.getSnapshot`, log cache snapshot |
| exp                                                                  | Same three precision bands after rigorous range reduction                                                                                                                                                                                       | Routing snapshot, exp cache/kernel snapshots                                        |
| sin, cos, tan                                                        | Same three bands, with sin/cos/both selected according to the required component; tan requests both                                                                                                                                             | Routing snapshot records component class; sincos cache snapshots and trig profiles  |
| pi                                                                   | Chudnovsky below 3000 working digits; AGM at/above 3000, or when its cached interval can already serve the request                                                                                                                              | Routing snapshot and `getPiComputationSnapshot`                                     |
| e                                                                    | Sequential factorial recurrence below 1000 working digits; binary splitting thereafter; once binary starts, keep that strategy                                                                                                                  | Routing snapshot and constant/provider state snapshots                              |
| ln(2) service                                                        | Local `SplittingLn2Provider`, binary splitting with retained prefix; no competing production family                                                                                                                                             | Existing ln2 provider snapshots                                                     |
| Gamma / gamma factorial                                              | Local router in `gammaRealIntervalWithProfile` / `gammaIntervalBallWithProfile`: exact integer handling in evaluation, bounded half-integer recurrence, supported special rational families, otherwise adaptive Stirling (including reflection) | Gamma profiles, `planHalfIntegerGammaStrategy`, special Gamma snapshots             |
| Rational powers / nth roots                                          | Existing local `planNthRootStrategy`: bounded Newton work versus ln-exp fallback using degree, numerator, magnitude and allocation cost                                                                                                         | Root strategy plan, reason, state and change counters                               |
| Rational arithmetic, abs, integer factorial and exact built-in cases | Existing exact evaluation paths; no approximate-family selection needed                                                                                                                                                                         | Existing evaluation/state profiles and exact-value tests                            |

The bands retain AR-2/3/4 measurements; the pi crossover is from AR-7. AR-8
selected binary factorial e on the 1000/3000/10000/30000 grid. Its lowest measured
point is used conservatively as the working-precision threshold; no crossover
below that point is claimed. Experimental AGM log, bit-burst, table reduction
and Spouge are not promoted without evidence. Gamma and nth-root local routers
are intentionally documented here rather than duplicating their argument-aware
cost rules in the common module.

Routing snapshots contain bounded, immutable, per-owner **selection attempts**:
operation, strategy, working digits, argument class, request and change counts.
They do not claim a paused kernel completed. Kernel/provider snapshots retain
completion and pending-phase details. Working digits include internal guards;
they are not the consumer's significant-digit request.

## e integration

`FactorialEProvider` promotes the AR-8 affine factorial construction to Core.
After k, the shared exact prefix is `N_k/k!`, with `N_k=k*N_(k-1)+1`.
Each balanced block represents `N -> q*N+t`; combining adjacent blocks gives
`(q_left*q_right, t_left*q_right+t_right)`. Switching from sequential work reuses
the same numerator and denominator and starts at the first uncomputed term.

The omitted positive tail is at most `2/(k+1)!`. Only an exact integer comparison
proves termination. Floating logarithms estimate a useful extension length.
The LazyReal wrapper still proves the requested decimal prefix and requests
more terms if a decimal boundary needs a tighter enclosure.

The split stack survives checkpoint interruptions and precision upgrades. Its
completed affine transform and the exact prefix commit without intervening
checkpoints. Lower requests after switching keep the binary route and reuse
the accumulated prefix. Distinct evaluation contexts own distinct providers.

Before scales, trees or bigint arithmetic are allocated, resource guards include
the retained prefix, pending tree, merge temporaries and endpoint conversion.
For end index m, `m! <= (m+1)^(m+1)` supplies an integer-based decimal-size bound;
retained tree blocks partition the term range and `0<t<=2q`. The conservative
24-copy allowance covers live coefficients and temporary products. Resource
limits remain configurable; they are not an algorithm precision ceiling.

The previous implementation remains available only through an explicit internal
`FactorialRecurrenceE` baseline for differential tests and historical benchmarks.
AR-8's benchmark adapter now names that baseline explicitly, so future comparisons
cannot silently relabel the new production path as the old recurrence.

## Switching and resource regression

Exp and sincos routers finish pending endpoints before changing layouts. Log
finishes pending work in an old family before using a new family. Pi retains its
old context-owned state when choosing AGM. Existing continuation tests remain
applicable; AR-9 adds cross-band prefix and lifecycle checks.

A new regression demonstrated that ReducedLogProvider's resource estimate omitted
retained kernels of other layouts (and optional table factors). The test failed
before the fix. Each active kernel now receives a guard that includes every
other live kernel in that provider, in addition to the outer router's other
providers. This changes accounting, not mathematical intervals.

## Reproduction

On Windows / Node v20.17.0, the fresh 10000-digit comparison measured the old
recurrence at 5818.5 ms, experimental binary factorial at 792.2 ms, exp(1) at
1509.8 ms and routed production e at 773.6 ms. All four verified prefixes agreed
through 100/1000/3000/10000 digits and fresh direct 10000. Production therefore
retains the measured winner's performance after lifecycle/resource integration.

A separate production run completed 10000 -> 30000 refinement in 881.8 ms and
8160.2 ms respectively; fresh direct 30000 took 7884.7 ms and matched the sequential
prefix. The raw CSV files are named in the commands below. These are local
single-run integration measurements, not new universal crossover estimates;
AR-8 remains the repeated comparison supporting the e decision. The full
cross-function scaling profile is AR-10 scope.

```powershell
npm run build
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/routing-candidates.mjs --grid 100,1000,3000,10000 --format csv --output benchmarks/results/ar-9-e-routing.csv
node --expose-gc benchmarks/algorithm-comparison.mjs --case e --grid 10000,30000 --format csv --output benchmarks/results/ar-9-e-production.csv
```

## Validation

- Full suite passed: 357 Core tests in 50 suites and 13 benchmark harness tests.
- Six AR-9 tests cover policy boundaries/argument classes, e containment against
  the independent exp kernel, exact-prefix reuse, pending-tree continuation
  across precision changes and guard rejection, live log/exp/sincos strategy
  transitions, context-local diagnostics and public e lifecycle/resource behavior.
  This includes the retained-log-family regression observed failing before its fix.
- Typecheck, ESLint, build, changed-file formatting and frozen public API audit
  passed. The final diff contains only routing, e integration, related benchmark
  adapters, tests, measurements and this report.
- Repository-wide `format:check` still reports the same 29 pre-existing formatting
  violations outside the changed files; those unrelated files were not reformatted.
- No known AR-9 blocker remains. Experimental alternatives remain unselected;
  no unmeasured low-precision crossover or global AR-10 verification is claimed.
