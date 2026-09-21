# AR-5: Jointly planned Stirling corrections

Date: 2026-09-21

Status: AR-5 completed; improved adaptive Stirling is the baseline for AR-6.

Scope: ALGORITHM_REPLACEMENT_PLAN.md, AR-5; implementation-plan stages 27, 32
and 35. Core API 1.0 is unchanged. AR-6 algorithms are not introduced here.

## Planner

`createGammaStirlingPlan` compares positive shift targets near
`N * {0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8} + 16`, respecting the minimum
argument of 64 and explicit test constraints. Each target has an estimated
correction count and costs for the balanced recurrence product, Bernoulli
convolution, correction powers, and final exponential. The weights are measured
routing heuristics; they are not mathematical bounds.

The logarithmic estimate of the first omitted term uses the factorial envelope
of even Bernoulli numbers. JavaScript floating point is confined to this cost
estimate. The actual evaluator still obtains an exact Bernoulli coefficient
and proves the omitted-term bound. `maximumCorrectionTerms` remains `null`;
an estimate never becomes a stopping condition or a coefficient preallocation.

Internal benchmark options retain the old 1.5N/2N planner and allow fixed shift
targets and the old correction layout. None is exported through the frozen API.

## Correction layout and containment

For positive rational `z = a/b`, correction k is

```text
t_k(z) = B_(2k) b^(2k-1) / ((2k)(2k-1) a^(2k-1)).
```

The new layout advances exact numerator/denominator powers by multiplication
with `a^2` and `b^2`. Each term is divided outward directly into the sum's scale
`P = requested correction digits + 24`. This removes the separate scaled huge
coefficient and tiny reciprocal power that previously required about 2N digits.
The effective significant precision decreases with term magnitude. Early terms
still need the final absolute accuracy: calculating them at fewer significant
digits without compensating error would be invalid.

For interval arguments, evaluate both positive endpoints and take their hull.
Each signed inverse odd power is monotone, so its endpoint hull contains the
term throughout the input interval. Floor and ceil are used for every signed
division; accumulated rounding stays in the interval, never in an untracked
epsilon. After m corrections the positive-real Stirling remainder satisfies

```text
|R_m(z)| <= |B_(2m+2)| / ((2m+2)(2m+1) z^(2m+1)).
```

The outward magnitude of the next term bounds this remainder over the whole
input interval. Its scale need not represent the true term exactly. The sum
is widened symmetrically by that upper bound. This is the existing Stirling
theorem from ENGINEERING-GAMMA-STIRLING.md, not an inference from matching digits.

Exact powers would expand excessively for dense rational/dyadic endpoints.
When either endpoint's numerator and denominator exceed 40 decimal digits in
total, production retains the old bounded fixed-point layout with the new
planner and adaptive scale. This is a performance choice, not a precision or
domain restriction.

The legacy fixed scale has a rounding-floor failure at higher precision:
`z^-(2k+1)` can round to `[0,1]` scale units before multiplication by a large
Bernoulli coefficient. Generating further coefficients then increases the
remainder estimate instead of proving the requested precision. The production
fallback detects this condition and retries at twice the scale, retaining exact
cached coefficients and guarding the larger allocation first. The explicitly
selected legacy benchmark remains unchanged. A regression injects an inadequate
40-digit scale: legacy exhausts the coefficient budget; adaptive scaling finishes
and contains an independently computed finer interval.

## Summation alternatives considered

- Rectangular splitting groups the polynomial in `z^-2`, but its Bernoulli
  coefficients still require exact generation. With the selected small rational
  endpoints, power recurrence multiplies by small integers instead of full-size
  approximate numbers. A table of baby powers does not eliminate that dominant
  coefficient cost and needs additional outward error accounting.
- A block sum of exact fractions introduces products/lcms of unrelated Bernoulli
  denominators. The scaled accumulator uses exact integer additions instead;
  it does not need a block denominator or a retained summation tree.
- The complete Bernoulli correction sequence is not treated as hypergeometric.
  Only its inverse-power component uses an exact recurrence. The existing
  recurrence-factor product retains its balanced binary tree.
- An exact ratio `t_(k+1)/t_k` prototype required repeated rational reductions of
  large Bernoulli numerators. It was discarded in favor of direct outward term
  division. These alternatives are not promoted as additional production routes.

## Ownership, checkpoints, and resources

Exact-power correction state is held by a WeakMap keyed by the evaluation owner. Up to eight
completed argument/precision entries are retained. Interrupted entries finish
before eviction. A state contains the committed sum, next omitted term, exact
power frontier, and index. All potentially throwing checkpoints and guards occur
before committing the next term, so continuation cannot add a term twice.
Higher-precision requests reuse the owner-local Bernoulli frontier, while their
rounded correction sum is recomputed at the new scale.

Bernoulli/tangent coefficients remain demand-generated and context-owned. The
tangent convolution pairs equal terms under `i -> n-i`, counting the middle
term once. Cached decimal lengths avoid repeated integer-to-string conversions
inside the convolution. Lengths describe exact stored integers; they do not
approximate any mathematical result.

Resource guards include retained correction states during coefficient generation
and retained coefficients during correction work, as well as temporary products.
Retention counts are cached after each committed step. There is no global
coefficient table and no allocation based solely on the planner's term estimate.

## Verification and measurement

The dedicated tests cover independent finite-sum containment, outward omitted
terms, interval inputs, old/new Gamma comparison, dense endpoints, direct and
reflected arguments, poles, half-integers, correction interruption, resource
failure, cache isolation and bounded retention. Existing tests exercise exact
99! containment with 257 corrections, prefix refinement, large compact results,
and the 5000-digit resource budget.

`benchmarks/stirling-candidates.mjs` supplies legacy, power-only, adaptive and
fixed-shift candidates to the AR-0 harness. Legacy and new layouts share the
optimized tangent generator, so their comparison isolates planner/summation
changes and does not claim to measure the separate convolution improvement.
Missing whole-Gamma operation counts and individual-bigint peak measurements
remain null; a total allocation guard estimate is not reported as an individual
integer size. Retention covers Bernoulli and correction state, not all shared
log/exp providers. RSS is the harness's process observation.

## Common-range comparison

`benchmarks/results/ar-5-stirling-comparison.csv` compares all three candidates
in one harness invocation, including cross-family verified prefixes and fresh
direct versus sequential runs. Node 20.17.0, Windows; times are observations,
not CI thresholds. Both families use the improved coefficient generator.

| Requested digits | Legacy sequential, ms | Power-only sequential, ms | Adaptive sequential, ms |
| ---------------: | --------------------: | ------------------------: | ----------------------: |
|              100 |                 44.61 |                     66.98 |                   23.85 |
|              300 |                122.89 |                    102.31 |                  110.82 |
|             1000 |               2193.24 |                   1810.66 |                 1835.36 |

Fresh direct 1000-digit runs were 2998.74 ms (legacy), 2006.78 ms (power-only),
and 1909.96 ms (adaptive). The adaptive run retained about 275k decimal digits
of coefficient/correction storage versus 268k for legacy. Faster computation
does not imply a smaller retained cache; the additional sum/power states support
continuation and repeated requests.

Reproduce the common range with the AR-0 runner and
`--module ./benchmarks/stirling-candidates.mjs --case third-factorial --grid 100,300,1000`.
The module also offers fixed shifts and negative/reflected/large half-integer
cases. `stirling-budget.mjs` records cooperative-budget exhaustion separately
from verified timings and writes each completed probe immediately. A censored
probe is never presented as a verified result or a successful AR-0 timing row.

## High-precision curve and limits

`benchmarks/results/ar-5-stirling-adaptive.csv` extends sequential refinement to
3000 verified digits and compares it with a fresh direct 3000-digit computation.
All prefix checks pass. In that separate run:

| Requested digits | Sequential time, ms | Corrections for this request | Correction scale |
| ---------------: | ------------------: | ---------------------------: | ---------------: |
|              100 |               66.22 |                           42 |              144 |
|              300 |              158.00 |                           98 |              344 |
|             1000 |             2997.97 |                          285 |             1044 |
|             3000 |            80858.50 |                          695 |             3044 |

Fresh direct 3000 digits took 80209.77 ms and retained 1,965,276 decimal digits
of coefficient/correction storage. Cross-run timing variability is substantial;
use the common-range same-invocation table for old/new speed comparisons.

`ar-5-stirling-budget-3000.json` and `ar-5-stirling-budget-10000.json` record
separate fresh probes with a 60000 ms cooperative budget. Both families exceeded
that budget at both precisions. The adaptive 3000-digit probe had completed all
695 corrections before it stopped in later work; it is separate from the fully
verified 80-second runs above. A cooperative checkpoint cannot interrupt a
single bigint operation, so an elapsed time may exceed the nominal budget.

The 10000-digit point is **censored**, not a completed or verified benchmark.
There is no new mathematical precision ceiling, but this stage does not claim
a measured completion time or a verified 10000-digit Gamma comparison.
Large recurrence products and exact coefficient generation remain bottlenecks
for subsequent Gamma experiments. The retained legacy reference also has the
fixed-scale rounding-floor limitation described above.

`ar-5-stirling-boundaries.csv` compares negative thirds, reflection and large
half-integers on the common 100/300/1000 grid, with cross-family and sequential
versus direct prefix checks.

## Final checks

- Full suite: 329 Core tests in 47 suites and 9 benchmark harness tests passed.
- Typecheck, ESLint, build and frozen public API audit passed.
- New files pass Prettier; whole-repository format check retains the same 29
  pre-existing violations. Unrelated files were not reformatted.
- No backend types or new settings were added to the package's public surface.
- The old reference remains available for comparisons. AR-6 special rational
  Gamma paths and Spouge are outside this change.
