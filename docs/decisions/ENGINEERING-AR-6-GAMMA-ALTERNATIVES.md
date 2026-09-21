# AR-6: Special rational Gamma and Spouge comparison

Date: 2026-09-21

Status: AR-6 completed. Special rational paths are enabled; Spouge remains an
experimental comparison candidate.

Scope: ALGORITHM_REPLACEMENT_PLAN.md, AR-6; implementation-plan stages 27,
32 and 35. The frozen public API and mathematical semantics are unchanged.

## Routing decision

Use special formulas for exact rational Gamma arguments with reduced denominator
3, 4 or 6 and `-32 < x < 33`. Existing half-integer paths run first and retain
their cost gate; exact integer factorial remains exact. Uncertain intervals,
other denominators and larger recurrence distances retain adaptive Stirling
and its existing reflection policy. A precision-independent magnitude gate
bounds the new exact recurrence to 32 factors; it is not a precision ceiling.

Spouge is an internal, explicitly selected comparison candidate. It does not
win the measured cold or prewarmed cases and is not automatically selected.
Explicit Stirling benchmark/planner options bypass special routing so AR-5
remains reproducible. Neither algorithm selection nor its profiles become
public calculation settings.

## Special formulas and bounds

The primary reference is Fredrik Johansson,
[Arbitrary-precision computation of the gamma function](https://mapletransactions.org/index.php/maple/article/download/14591/12393/39109),
equations 113–114. With `F(q) = 3F2(1/2, 1/6, 5/6; 1, 1; q)`:

```text
Gamma(1/4)^4 = 32 pi^3 / sqrt(33) * F(8/1331)
Gamma(1/3)^6 = 12 pi^4 / sqrt(10) * F(-9/64000).
```

For positive term magnitudes, the ratio from n to n+1 is

```text
((6n+1)(6n+3)(6n+5) / (216(n+1)^3)) * |q| < |q|.
```

After the current term, the uncomputed tail is bounded by
`nextMagnitude / (1-|q|)`. Its outward integer ceiling bounds both the positive
quarter series and the alternating third series. All term updates and signed
sum endpoints use floor/ceil; the final sum is widened by that tail. The
guard-digit choices affect width and speed, not validity of containment.

All pi bounds come from the existing context-owned provider. Products and
divisions are outward scaled intervals. Square, fourth and sixth roots use
integer Newton iteration: scale a rational radicand outward by `10^(degree*P)`,
compute its integer floor root from an upper starting value, and use a ceiling
for the upper endpoint. Endpoint integer powers certify the enclosure; no
floating-point root determines a mathematical result.

The remaining reduced fractions follow duplication/reflection identities:

```text
Gamma(2/3) = 2 pi / (sqrt(3) Gamma(1/3))
Gamma(3/4) = pi sqrt(2) / Gamma(1/4)
Gamma(1/6)^2 = 3 Gamma(1/3)^4 / (2^(2/3) pi)
Gamma(5/6) = 2 pi / Gamma(1/6).
```

`2^(2/3)` is the positive sixth root of 16. Integer shifts use the exact
rational recurrence. The final multiplication by its signed rational factor
also stays exact: rounding it at an absolute scale would unnecessarily lose
relative accuracy for tiny negative-shift results. Poles still use the existing
domain/refinement handling.

## Spouge parameter, rounding and approximation error

The same primary reference gives the Spouge expansion and error bound in
equations 52–54. For `x > 0`, set `z = x-1`, `a >= 3` and evaluate

```text
S = sqrt(2 pi) + sum(k=1..a-1, c_k / (x+k-1))
c_k = (-1)^(k+1) exp(a-k) (a-k)^(k-1/2) / (k-1)!
log Gamma(x) approximately equals
    (x-1/2) log(x+a-1) - (x+a-1) + log(S).
```

The relative approximation bound is at most
`sqrt(a) / ((2 pi)^(a+1/2) * (x+a-1))`. Since
`x+a-1 > a-1 >= sqrt(a)` and `2 pi > 6`, the conservative bound
`delta = 6^-a` suffices. The planner certifies `6^a >= 10^(N+12)` with bigint
arithmetic. A floating estimate only supplies a starting integer; it never
certifies accuracy. The logarithmic result is widened by `2 delta`, using
`|log(1+epsilon)| <= 2 delta` for `|epsilon| <= delta < 1/2`.

Coefficients use scale `P = N + 2a + 32`. This is a conservative cancellation
heuristic; every rounding error is still represented by outward endpoints.
The shared exponential kernel encloses e, a resumable binary power encloses
`e^(a-1)`, and outward division by e advances subsequent coefficient powers.
Integer factorials/powers are exact; roots are certified by the root kernel.
Each reciprocal denominator and the logarithmic reconstruction use intervals.
If coefficient cancellation leaves `S.lower <= 0`, the candidate returns an
unresolved enclosure request instead of inventing a sign or a domain error.
Negative nonintegers use the existing reflection machinery with the explicitly
selected positive Spouge path.

There is no fixed coefficient ceiling. Tests execute more than 256 coefficients,
and the 1000-digit experiment executes the larger precision-derived parameter.
The 3000/10000-digit Spouge timings were not measured: the 1000-digit candidate
already loses substantially. No completion or performance claim is made for
those unmeasured points.

## State, checkpoints and resources

All state is owned by an evaluation context through WeakMaps. Special Gamma
keeps two base providers, each with its last completed enclosure and at most
one pending series/root job. Five fixed derived-root keys hold Newton frontiers.
A higher request finishes a pending root before replacing it. Exact recurrence
frontiers survive pauses too; completed recurrence entries are evicted once the
cache reaches eight. Pending entries are preserved; the strict argument gate
allows at most 455 distinct reduced fractions across all four denominators.

Spouge retains at most two precision-specific coefficient tables and eight sum
jobs. Pending work is finished before eviction. Coefficient, factorial,
exponential-power and sum frontiers are committed only after dependency calls
and guards that can pause/throw. Repeated calls reuse coefficients within one
owner; another context starts independently. Dependency providers receive the
original context, rather than an ephemeral guard wrapper that would lose caches.

Allocation guards cover candidate storage and conservative temporary estimates.
Snapshots count retained bigint decimal digits, including pending roots, sums,
factorials and coefficient tables. They are logical candidate-local retention,
not byte allocation or a claim about total process memory. Shared pi/log/exp
providers keep their own existing accounting. Unsupported individual peak and
operation metrics remain null in the benchmark harness.

## Measurements

Node 20.17.0 on Windows. Timings are observations, not test thresholds. The AR-0
runner verifies cross-family prefixes and fresh-direct versus sequential results;
verified extraction is outside the timed region.

`ar-6-gamma-matrix.csv` covers 20/50/100 digits for thirds, quarters, sixths,
a negative third, general positive, reflection, near-pole and large arguments.
`ar-6-gamma-matrix-300.csv` repeats the argument classes at 300 digits. Direct
300-digit measurements, milliseconds:

| Argument | Stirling |  Spouge | Special |
| -------- | -------: | ------: | ------: |
| 1/3      |   111.50 | 2035.20 |   19.96 |
| 4/3      |   111.66 | 2066.14 |   20.26 |
| 1/4      |   121.30 | 2193.98 |   20.31 |
| 3/4      |   117.63 | 2080.32 |   22.28 |
| 10/7     |   115.65 | 2234.91 |       — |
| -1000/7  |   126.90 | 2378.04 |       — |
| 10^-12   |  1633.20 | 2326.94 |       — |
| 4001/4   |    59.92 | 2160.58 |       — |

`ar-6-gamma-third.csv` extends the same-invocation comparison to 1000 digits.
Fresh direct times are 1883.31 ms for Stirling, 39004.98 ms for Spouge and
182.06 ms for special. Candidate-local retained decimal digits were about
275 thousand, 10.5 million and 4.3 thousand respectively. Early measurements
preceded the final small recurrence-cache accounting changes; no mathematical
formula or Spouge parameter was changed afterward.

`ar-6-gamma-warm.csv` prepares Gamma(7/5) at 300 digits outside timing, then
evaluates another argument at the same precision. Preparation checkpoints are
excluded from measured counters, but retained storage includes prepared tables.
Stirling takes 76–80 ms for 1/3, 3/4 and 10/7; Spouge takes 579–800 ms.
This deliberately favorable coefficient-reuse experiment still does not support
promoting Spouge.

`ar-6-gamma-special-scaling.csv` completes the full
`100 -> 300 -> 1000 -> 3000 -> 10000` grid and a fresh direct 10000-digit
calculation for all six special cases (the four mandatory arguments, 1/6 and
-1/3). All verified prefix checks pass. Direct 10000-digit observations range
from 47.7 to 76.5 seconds, with 40–121 thousand retained candidate-local decimal
digits. Some static checks and the focused test run overlapped this long
validation run; its timings are not an isolated comparison of algorithm speed.
The same-invocation common-range comparisons above provide the routing evidence.

Reproduction after `npm run build`:

```powershell
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/gamma-candidates.mjs --grid 20,50,100 --format csv
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/gamma-candidates.mjs --grid 300 --format csv
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/gamma-candidates.mjs --case gamma-one-third --grid 100,300,1000 --format csv
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/gamma-warm-candidates.mjs --grid 300 --format csv
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/gamma-candidates.mjs --family special --grid 100,300,1000,3000,10000 --format csv
```

## Verification

The added tests cover independent decimal prefixes, finer Stirling containment,
exact integer containment for Spouge, root endpoint certificates, monotonic
refinement through 1000 digits, actual coefficient counts above 256, reflection,
near-pole/large arguments, unsupported uncertain inputs, public factorial routing,
context isolation, bounded coefficient retention, repeated small checkpoint
budgets and recovery after typed resource rejection. An approximate enclosure
around an exact decimal boundary is tested for containment, rather than requiring
it to prove trailing zeros. Resumed logarithm bounds may tighten as shared
providers refine; both resumed and cold bounds must contain the independent
finer reference, rather than having identical endpoints.

There are 15 new tests, including containment for a non-point Spouge argument
and a regression for relative accuracy of Gamma(-95/3) after exact recurrence.

- Full suite passed: 344 Core tests in 48 suites and 9 benchmark harness tests.
- Typecheck, ESLint, build and the frozen public API audit passed.
- New files pass Prettier. The whole-repository formatter check still reports
  the same 29 pre-existing violations; unrelated files were not reformatted.
- The special-path high-precision grid completed through 10000 verified digits.
- Final diff review found no unrelated changes or new public/backend types.
- Remaining limitation: Spouge's large coefficient storage and runtime do not
  justify production routing. Its 3000/10000-digit timings remain unmeasured.
