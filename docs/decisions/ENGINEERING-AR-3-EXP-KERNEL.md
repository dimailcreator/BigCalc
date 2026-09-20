# AR-3: Small exponential kernels

Date: 2026-09-20

Status: AR-3 completed.

Scope: ALGORITHM_REPLACEMENT_PLAN.md, AR-3. Core API 1.0 and mathematical
semantics are unchanged. This replaces the small positive exponential used by
the exponent-aware production path, including approximate powers and Gamma.
The existing Rational-returning reference path remains available internally.

## Algorithm and rigorous enclosure

`expIntervalBallWithProfile` retains its existing outer reduction:

```text
x = k ln(2) + r
exp(x) = 2^k exp(r)
```

The shared ln2 interval determines an outward remainder. Its endpoints are
evaluated separately, using monotonicity of exp. The backend applies `2^k` to
the exponent of both center and radius, never expanding the absolute decimal
magnitude. Boundary-straddling reduction and dependency precision are unchanged.

The new `ExpKernel` accepts `0 <= r <= 2` and chooses `s >= 1`:

```text
u = r / 2^s
exp(r) = exp(u)^(2^s)
```

All baby powers, block terms, sums and reconstruction squares are positive
fixed-point intervals at one working decimal scale. Lower divisions truncate
towards zero (equivalent to floor here); upper divisions use integer ceil.
There is no repeated squaring of exact Rational denominators.

For a block starting at term `n`, with width `m`, write:

```text
t_n = u^n / n!
C_i = u^i / ((n+1)...(n+i)), C_0 = 1
block = t_n * sum(C_i, i = 0..m-1)
t_(n+m) = t_n * C_m
```

Baby powers `u^i` are computed once per summation pass. Rectangular summation
divides each baby power by the small exact coefficient product. Binary summation
uses the shared `BinaryBlock` traversal to combine numerator intervals and exact
coefficient denominators, dividing only at the block root. Exact denominator
products exist only inside a block of 16 terms, not across the full series.
Sequential mode is the same enclosure recurrence with width one.

After at least one term, `u <= 1` implies every subsequent ratio is at most
`1/2`. Thus the omitted positive tail is bounded by twice the outward upper
bound of the next term. The stopping test is `2 * nextTermUpper <= 4` scale units.
The lower sum excludes the tail; the upper sum includes it. This bound is
independent of summation layout and the heuristic choice of `s`.

Each reconstruction square uses floor on the lower product and ceil on the upper
product. Consequently, containment does not depend on a heuristic error estimate.
The working scale additionally budgets `ceil(s/3)` digits for squaring error
amplification, logarithmic overhead for accumulated rounding, and 16 safety digits.
The outer verified-digit machinery still checks whether the requested digits
were actually established. No term or precision ceiling is introduced.

Exact zero returns the exact fixed-point value one without series work.
Refinement intersects a completed kernel enclosure with its previously proved
enclosure before outward rescaling.

## Cost model and routing

The initial cost model balances approximately `N/s` series terms against `s`
full-precision squares. It chooses `s = ceil(sqrt(N))` for block kernels and
`s = 1` for the simple low-precision recurrence. Integer bounds, not this
floating-point cost heuristic, establish the result.

The production bands are internal engineering choices:

| Requested kernel scale | Layout                                   |
| ---------------------- | ---------------------------------------- |
| below 128 digits       | resumable sequential, one extra halving  |
| 128 through 4095       | rectangular, adaptive dyadic reduction   |
| 4096 and above         | binary blocks, adaptive dyadic reduction |

The high-precision binary and rectangular timings are close; binary is selected
for reducing coefficient divisions, not on a claim of a decisive timing crossover.
Fixed `s=1` and `s=16` candidates are retained in the comparison matrix. The
4096 boundary is a tunable cost-policy boundary, not a mathematical constant.

## Bit-burst experiment

`BitBurstExpKernel` truncates the argument towards zero at 16, 32, 64, ... binary
fractional bits, takes exact successive differences, and multiplies the enclosed
exponentials of those chunks. It finishes with the exact Rational residual once
the chunk resolution reaches the working precision. If the decomposition becomes
exact sooner, it stops there. No argument tail is silently discarded.

Every chunk uses the rigorous binary Taylor kernel with one halving. Chunk
resolution increases progressively; result composition deliberately stays at the
full working scale. This experiment does not implement an optimized gradual
precision expm1 composition. It measures this conservative implementation, not
the theoretical best possible bit-burst algorithm.

Bit-burst remains experimental: the measured implementation does not beat the
stronger dyadic block route. Production never selects it.

## Ownership, pause and resource accounting

The kernel retains baby powers, coefficient frontier, partial sums, the explicit
binary traversal stack and the number of remaining squares. Checkpoints occur
before each leaf/combine, coefficient step, block commit and square. A pause
does not restart the current request. A later larger request finishes the pending
pass first, preserves its proved result, and then starts a larger-scale pass.

Production endpoint kernels belong to their `EvaluationCheckpoint` context via
a WeakMap. At most eight completed entries are retained. Pending work is finished
before changing endpoints or routes, including when another operation refined
the shared ln2 provider and thereby changed the exact remainder endpoints.
No global numeric-state cache is introduced.

Allocation guards run before initial scale/argument products and account for
other retained endpoint entries. The preflight estimate covers the bounded baby
table, coefficient tree, fixed-point products, caches and input rational. Separate
storage factors apply to width-one, rectangular and binary live states. Completed
states use a smaller bound for their two cached endpoints and instrumentation.
An initial overly conservative implementation charged every completed entry as
a live binary block and rejected an existing compact Gamma resource test. The
accounting was corrected, with a regression covering eight completed endpoints
under a 5000-digit resource budget. Existing resource-limit expectations remain.

Counters expose terms, blocks, squarings, passes, large multiplications/divisions,
observed bigint peak, retained bigint digits and pending phases. A large operation
has at least one operand of 100 decimal digits. The observed peak concerns kernel
arithmetic, not allocations internal to the backend or JavaScript runtime.
The experimental bit-burst aggregate does not claim unavailable peak/allocation
counters; those fields remain null. RSS is process-level and includes verification.

## Measurements

Local Windows/Node 20.17.0 measurements, milliseconds. These are observations rather than
portable thresholds or performance assertions in tests. Sequential rows request
100, 300, 1000, 3000, then 10000 digits in one session; direct rows use a fresh
session at 10000 digits. Extraction is recorded separately by the harness.

| Small kernel, input 1        | 3000 sequential | 10000 sequential | 10000 fresh |
| ---------------------------- | --------------: | ---------------: | ----------: |
| old unreduced Taylor         |         1091.97 |         16676.73 |    16321.97 |
| rectangular, adaptive dyadic |           60.77 |           689.67 |      651.81 |
| binary, adaptive dyadic      |           53.98 |           656.24 |      783.23 |
| binary, one halving          |           82.66 |          1325.40 |     1493.35 |
| binary, 16 halvings          |           50.10 |           676.03 |      679.07 |
| experimental bit-burst       |           83.20 |          1336.71 |     1353.40 |

At 10000 digits the old kernel executes 3252 Taylor iterations (one checkpoint
per iteration). The adaptive binary candidate uses 320 terms; one-halving binary
uses 3008, and fixed-16 binary uses 1344. Adaptive binary performs 392 large
divisions versus 992 for adaptive rectangular, including reconstruction. Both
retain 40294 bigint decimal digits after the fresh request. Block reuse across
precision changes is not assumed: these measurements include rebuilding each
new scale. They show that the principal gain is grouping terms and stronger
reduction, with no decisive wall-time advantage of binary over rectangular at
10000 digits on this machine.

For the non-dyadic representative remainder, the fresh 10000-digit run measured
1065.50 ms for rectangular, 661.75 ms for binary, and 3305.13 ms for bit-burst.
This supports retaining binary as the high-precision route. A separate production
router run measured 662.91 ms for input 1 and 656.06 ms for the representative
remainder; the saved rows expose the normal run-to-run variation.

| Full exp(1)       | 3000 sequential | 10000 sequential | 10000 fresh |
| ----------------- | --------------: | ---------------: | ----------: |
| old small kernel  |         2498.68 |         33541.26 |    32073.05 |
| production router |          480.54 |          7260.88 |     7164.74 |

The complete function is about 4.5 times faster in the fresh 10000-digit case.
It still includes shared ln2 computation, rational interval conversion and backend
reconstruction; the small-kernel speedup is not advertised as the full-function
speedup.

Saved results:

- `benchmarks/results/ar-3-exp-kernel-scaling.csv`: forced families, full grid, input 1;
- `benchmarks/results/ar-3-exp-remainder-scaling.csv`: block/bit-burst comparison
  on a non-dyadic rational close to the actual exp(1) remainder;
- `benchmarks/results/ar-3-exp-kernel-matrix.csv`: all small-kernel candidates
  at 100/300/1000 on 1, 2, a representative remainder and a tiny argument;
- `benchmarks/results/ar-3-exp-router.csv`: full-grid production route on those
  four small-kernel arguments;
- `benchmarks/results/ar-3-exp-full-matrix.csv`: full-function old/new comparison
  at 100/300/1000 for 0, +/-1, +/-1024 and +/-1000000;
- `benchmarks/results/ar-3-exp-full-scaling.csv`: full-grid old/new exp(1).

## Validation and reproducibility

`tests/exp-kernel.test.ts` covers unreduced Taylor containment and equal verified
prefixes at 100/300/1000/3000/10000 digits, deterministic rational samples, zero,
tiny arguments, dyadic choices, interruption in summation/reconstruction,
bit-burst continuation, cache ownership and hard resource guards. Production
`exp(1)` is also compared with the independent shared `e` provider. Full-function
tests cover `0`, `+/-1`, `+/-1024`, `+/-1000000`, nonzero-width input intervals and
compact backend exponents. Typed handle timeout/cancel tests target the actual
new sum and square phases.

Small-kernel families use the same exact input and requested scale in the AR-0
harness. Full-function comparisons retain the same ln2 reduction, conversion,
backend precision and exponent reconstruction on both sides. The only differing
operation is the small exponential evaluator. Timing is never a correctness test.

```powershell
npm run build
node benchmarks/algorithm-comparison.mjs --module ./benchmarks/exp-candidates.mjs --case exp-small --grid 100,300,1000,3000,10000 --format csv --output dist/exp-kernels.csv
node benchmarks/algorithm-comparison.mjs --module ./benchmarks/exp-full-candidates.mjs --case 'exp(1)' --grid 100,300,1000,3000,10000 --format csv --output dist/exp-full.csv
npm test
npm run lint
npm run typecheck
npm run audit:public-api
```

The optional 30000/100000 grid is not a CI requirement and was not run for AR-3.
Global Prettier checking still reports the 29 pre-existing formatting violations;
AR-3 files are checked separately. No specification, grammar or public export
surface is changed.

Final validation: 312 Core tests in 45 suites passed, including 10 AR-3 tests;
all 9 benchmark-harness tests passed. Lint, core/test typechecking, build,
public API audit, targeted Prettier and `git diff --check` passed. The complete
existing power/Gamma resource suite also passes with its original limits.

AR-3 Definition of Done is satisfied: compact large-argument reconstruction is
preserved, internal series work is substantially reduced at 3000+ digits, the
selected high-precision kernel retains a rigorous outward bound and resumable
state, and bit-burst remains explicitly experimental based on measurements.
