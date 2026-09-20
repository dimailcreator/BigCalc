# AR-4: Selective and joint sin/cos block kernels

Date: 2026-09-20

Status: AR-4 completed.

Scope: ALGORITHM_REPLACEMENT_PLAN.md, AR-4. Core API 1.0 remains frozen.

## Production integration

Only the small point evaluator was replaced. Existing callers retain:

- exact degree period reduction before multiplication by the shared pi interval;
- the small-radian path that does not request pi;
- canonical quadrant reduction and sign/swap metadata;
- structural rational multiples of pi and exact zero/pole paths;
- interval endpoint evaluation, including the cosine maximum at zero;
- pole rejection/refinement and the monotone endpoint hull for tangent.

`selectiveSinCosSmallPointInterval` now calls a context-owned kernel and converts
its outward fixed-point endpoints to Rational bounds. The old evaluator remains
internally callable as `legacySinCosSmallPointInterval` for differential testing
and benchmarks. No new tangent series is introduced.

The historical `TrigSeriesProfile` retains its call-level point/branch counters
and requested-scale endpoint size measurements. The new kernel snapshots expose
actual summation passes, terms, arithmetic operation counts and intermediate
bigint sizes separately; the historical profile is not relabeled as a measurement
of every temporary bigint allocation.

## Shared powers and selective series

The kernel accepts `|x| <= 1`, which includes the canonical strip and the existing
small-interval helper domain. It evaluates the nonnegative magnitude and restores
the sign only for sine. Cosine is even.

For `u = |x| / 2^s`, let `q = u^2`. One outward table of baby powers `q^i`, for
`i = 0..16`, is shared by both requested series. The per-series term magnitude is

```text
t_n = u^(2n+b) / (2n+b)!
b = 1 for sin, 0 for cos
```

A block contains the signed terms

```text
t_n * sum((-1)^(n+i) q^i / ((2n+b+1)...(2n+b+2i)), i = 0..m-1)
```

with an empty coefficient product equal to one. The next magnitude is obtained
from the same baby power `q^m` and coefficient product. Rectangular mode divides
each baby interval by its coefficient product; binary mode combines signed
interval numerators and exact denominators with the shared balanced `BinaryBlock`
traversal and divides at the root. Exact coefficient denominators are confined to
blocks of 16 terms. Sequential mode is the width-one version.

Every signed division uses floor for the lower bound and ceil for the upper
bound. Products use a positive-interval fast path when possible and the minimum
and maximum of all four endpoint products otherwise. Subtracting a negative
term does not reuse positive-only truncation semantics.

For `|u| <= 1`, factorial term magnitudes decrease. The alternating-series
remainder is bounded in absolute value by the first omitted term. Each branch
adds that outward upper bound to both sides of its sum when the tail is at most
two scale units. The argument applies independently of block layout or dyadic
choice. It does not infer correctness from agreement between algorithms.

Standalone sine creates no cosine series, and standalone cosine creates no sine
series. Joint mode shares powers but keeps independent resumable coefficient
frontiers and sums. Tests inspect the actual kernel counters rather than relying
only on wrapper profile labels.

## Dyadic reconstruction and routing

Joint mode reconstructs with

```text
sin(2u) = 2 sin(u) cos(u)
cos(2u) = 2 cos(u)^2 - 1
```

Cosine alone uses the second identity without a sine series. Both updates use
the old cosine interval before committing the next step. All intermediate
arguments are between zero and one, so intersecting each branch with `[0,1]` is
rigorous. This also prevents avoidable interval widening outside the known range.

Sine alone uses `s=0`: introducing an unrequested cosine series merely to perform
double-angle reconstruction would violate standalone selectivity. Its scalable
block sum already removes most of the high-precision division cost.

For block-mode cosine and joint requests, the initial cost model balances
`N/(2s)` Taylor work against `s` double-angle steps and chooses
`s = ceil(sqrt(N)/2)`. Forced `s=0` and `s=8` candidates provide measured controls.
The model only selects an algorithm. Containment follows from outward operations
for every selected integer `s`.

The working scale adds `ceil(2s/3)` digits for double-angle error amplification,
logarithmic overhead for accumulated rounding, and 16 safety digits. The maps have
an error amplification bounded in terms of `4^s`; `2/3 > log10(4)` supplies a
conservative budget. Final endpoints are outward-rescaled to the caller's scale,
and the existing demand-driven verifier decides whether more precision is needed.
No fixed term or digit ceiling is added.

The internal router uses sequential below 128 digits, rectangular from 128 through
4095, and binary from 4096 onward. These are tunable engineering bands, not
mathematical constants. New precision requests may rebuild the fixed-point sum;
the previous rigorous enclosure is retained and intersected with the new one.

## Bit-burst experiment

`BitBurstSinCosKernel` decomposes the magnitude into exact successive differences
of dyadic truncations at 16, 32, 64, ... fractional bits. The last chunk is the
exact Rational residual; no argument bits are silently discarded. Exact dyadic
inputs finish as soon as the residual becomes zero.

Each chunk uses the rigorously bounded binary joint kernel without extra dyadic
reduction. Composition uses the angle-addition formulas for sin(a+b) and cos(a+b),
with outward products and subtraction. The argument chunk resolution increases;
result composition deliberately remains at the full working scale. This is a
conservative experiment, not an optimized gradual-precision implementation.

Bit-burst remains experimental and is never selected for a standalone request.
It computes both branches, and measured high-precision cost is above the joint
dyadic block route. This decision rejects the measured implementation, not every
possible future bit-burst algorithm.

## Ownership and lifecycle

Baby powers, signed partial sums, coefficient products, explicit binary stacks,
finished-branch flags and the remaining double-angle count survive interruption.
Checkpoints precede coefficient generation, each leaf/combine, block commits and
each double-angle step. The next step always starts from the last committed state.
Bit-burst additionally retains the current chunk and composed result.

Endpoint caches belong to their evaluation checkpoint context via a WeakMap.
At most eight completed entries are retained. Pending work is finished before a
different endpoint, mode or route is selected, including when pi refinement
changes the exact reduced endpoints. Smaller direct-kernel cache hits preserve
any outstanding larger request. There is no process-global numeric cache.

Preflight allocation guards account for the input Rational, its conversion
temporaries, the shared power table, both branch states, bounded coefficient
trees, reconstruction products and previously completed cache entries. Completed
entries use a smaller storage estimate than live blocks. Cancellation and hard
resource exceptions propagate through the existing calculation lifecycle.

## Measurements

Local Windows, Node 20.17.0, milliseconds. Sequential refinement requests
100, 300, 1000, 3000 and 10000 digits; fresh direct requests start from an empty
session. Verification/extraction is measured separately and is not part of the
reported kernel evaluation time.

| Input 1/10, requested branch | Family                         | 3000 sequential | 10000 sequential | 10000 fresh |
| ---------------------------- | ------------------------------ | --------------: | ---------------: | ----------: |
| sin                          | legacy                         |          880.12 |         15565.40 |    15463.58 |
| sin                          | router                         |           93.95 |          1173.64 |     1181.21 |
| cos                          | legacy                         |          706.74 |         19560.21 |    15336.40 |
| cos                          | router                         |           73.32 |           814.42 |      856.89 |
| joint sin/cos                | legacy                         |         1798.38 |         32190.55 |    35270.33 |
| joint sin/cos                | binary with dyadic reduction   |          140.87 |          1656.58 |     1649.12 |
| joint sin/cos                | binary without extra reduction |          146.34 |          2174.03 |     2156.41 |
| joint sin/cos                | bit-burst                      |          404.63 |          5309.44 |     5304.52 |

At 10000 digits, standalone sin uses 1264 terms and zero cosine series; standalone
cos uses 272 terms and zero sine series. Joint dyadic mode uses 544 total terms
versus 2544 in the block candidate without extra reduction. Shared powers and
reduced coefficient division cost account for the standalone sine improvement
even without dyadic reconstruction.

Rectangular and binary block timings are close on this machine. A separate
10000-digit joint repeat measured fresh rectangular/binary/router/bit-burst at
1778.93/1844.47/1934.61/5612.59 ms. The high-precision binary route reduces
coefficient divisions; the measurements do not establish a universal crossover
at exactly 4096 digits. The initial runs include scheduling outliers, notably
rectangular joint sequential 10000 and rectangular standalone-cosine direct 10000. These rows are retained rather than silently removed. The separate repeat
and router matrix expose normal run-to-run variation.

The measurements support promotion of block kernels and dyadic joint/cosine
reconstruction. Bit-burst remains experimental. Reported speedups are for small
kernels; arbitrary-argument functions may additionally spend substantial time on
pi and range reduction.

Saved machine-readable files:

- `benchmarks/results/ar-4-sincos-joint-scaling.csv`: all forced joint candidates
  at 1/10 on the full precision grid;
- `benchmarks/results/ar-4-sincos-selective-scaling.csv`: standalone sin/cos,
  old versus rectangular/binary/router, full grid;
- `benchmarks/results/ar-4-sincos-joint-repeat.csv`: separate fresh 10000-digit
  comparison of the selected candidates and bit-burst;
- `benchmarks/results/ar-4-sincos-matrix.csv`: 100/300/1000 digits, all candidates
  on positive, negative, near-strip-edge and tiny arguments;
- `benchmarks/results/ar-4-sincos-router.csv`: production routing on that same
  argument/mode matrix through 10000 digits.

## Verification

New tests cover signed/boundary/tiny and deterministic Rational inputs, exact
Rational reference series, unreduced reference containment through 10000 digits,
stable verified prefixes, selective branch counts, dyadic alternatives,
interrupted coefficients/double-angle steps, typed pause/cancel, bit-burst
continuation, context/cache isolation and hard allocation guards.

Interval tests retain the cosine maximum at zero and compare tangent endpoint
bounds against independently computed Rational sine/cosine enclosures. Existing
stages 26, 29 and 33 additionally exercise all quadrant/sign handling, exact
rational multiples of pi, degree mode, huge exact degree reduction, near poles,
small-radian no-pi behavior and refinement above the production cutoff.

The AR-0 harness compares identical inputs and requested precision across forced
families and production routing. Joint cases verify the sine/cosine ratio so
both branches contribute to the checked output. Unknown counters remain null;
bit-burst does not claim an uninstrumented aggregate bigint peak. RSS includes
the process and verification and is not a kernel-only allocation measurement.

```powershell
npm run build
node benchmarks/algorithm-comparison.mjs --module ./benchmarks/sincos-candidates.mjs --case both-tenth --grid 100,300,1000,3000,10000 --format csv --output dist/sincos.csv
node benchmarks/algorithm-comparison.mjs --module ./benchmarks/sincos-candidates.mjs --case sin-tenth --grid 100,300,1000,3000,10000 --format csv --output dist/sin.csv
npm test
npm run lint
npm run typecheck
npm run audit:public-api
```

The optional 30000/100000 precision grid was not run. No specification, grammar,
public API, cutoff rule or pole/domain rule was changed.

Final validation: all 321 Core tests in 46 suites passed, including 9 new AR-4
tests and the preceding AR-1/AR-2/AR-3 suites. All 9 benchmark-harness tests passed.
Lint, core/test typechecking, build, the public API audit, targeted Prettier and
`git diff --check` passed. Global Prettier still reports the same 29 pre-existing
formatting violations; those unrelated files were not reformatted.

AR-4 Definition of Done is satisfied: range-reduction and pole/domain semantics
are preserved, the new high-precision kernel outperforms the Taylor baseline,
standalone selectivity remains intact, and all new production paths retain strict
bounds and cooperative resumable state. Bit-burst remains an internal experiment.
