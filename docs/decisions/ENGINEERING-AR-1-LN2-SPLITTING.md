# AR-1: ln(2) block splitting

Date: 2026-09-20  
Stage: AR-1 — completed

## Decision and scope

The context-owned production `ln(2)` provider uses balanced binary splitting inside
32-term coefficient blocks and outward fixed-point accumulation between blocks.
It rebuilds coefficients on a new higher-precision request, keeping the compact
term/power frontier and previous proved interval. A paused request retains its
entire unfinished computation. There is no term limit or precision ceiling.

`SplittingLn2Provider` also implements rectangular block evaluation and persistent
block-root retention as benchmark candidates. The old sequential evaluator is
retained as `SequentialLn2Provider` in `constants.ts`, for differential testing and
benchmarking. These are internal modules; the frozen public API is unchanged.
The general `ln` reduction/atanh kernel and the algorithms for other functions have
not been replaced. Existing consumers of the shared `ln2` provider benefit from
this change.

## Exact block identity and enclosure proof

For a block `[a,b)`, define

```text
p = 9^(b-a)
q = product of (2k+1), a <= k < b
t/q = sum of 9^(b-1-k)/(2k+1), a <= k < b
```

Its contribution to `ln(2) = 2 sum 1/((2k+1) 3^(2k+1))` is exactly

```text
2*t / ((3*9^a) * (p/9) * q).
```

The rectangular layout groups coefficients into fixed-width polynomial blocks.
Within a block, forward Horner recurrence with `d=2k+1` is
`t'=9*d*t+q`, `q'=d*q`, `p'=9*p`. Outside the block, the giant step advances the
power denominator by `p`. Thus neither layout performs a full-scale division per
series term.

The binary layout starts with `(p,q,t)=(9,2k+1,1)` and combines adjacent children:

```text
p = pL*pR
q = qL*qR
t = tL*pR*qR + tR*qL
```

All coefficients are exact bigints. Only block roots need survive combination.
An explicit balanced traversal stack replaces recursive calls. Exact denominator
products are confined to a block, whose size is a performance parameter, not a
bound on the total term count. The implementation never constructs the global
product of all odd denominators. Tests also exercise block sizes 1, 3, 17 and 64.

At decimal scale `S`, divide the exact block numerator by its denominator, rounding
down for the lower sum and up for the upper sum. Each block contributes less than
one scale unit of error per side. These errors are included in the interval;
they are never discarded as insignificant.

The same geometric tail bound as the old provider is applied independently of the
block layout. With `P_N = 3*9^N`,

```text
0 < R_N <= 9 / (4*P_N*(2N+1)).
```

Indeed, replace all remaining odd denominators by the first one and sum the
geometric ratio `1/9`. A floating-point term estimate only plans work; the exact
integer inequality `9*10^(digits+2) <= 4*P_N*(2N+1)` is checked before using the
bound. The power frontier is extended by resumable exponentiation by squaring.
The tail's upward-rounded scaled value is added separately to the upper sum.
Final decimal rescaling rounds outward. Refinement intersects the new proved
enclosure with the old one, so previously proved information is retained.

## State and resource lifecycle

Each context owns its provider through the existing WeakMap. An active job stores
its precision, scale, tail power and proof denominator, completed block frontier,
outward sums, current rectangular coefficients or binary traversal stack, and
pending block root. Every checkpoint precedes a committed state transition.
Pausing before a leaf, combine, or block division leaves all completed work intact.
Small cached requests do not disturb a suspended higher-precision job; a still
larger request first finishes the suspended job and then starts its new summation.

Persistent retention keeps the completed block-root forest for later requests;
rebuild retention releases it after each block is accumulated. The production
choice keeps only one bounded block tree plus O(N)-digit working values and the
proved interval. The default traversal depth is at most six frames.

Checkpoints use the existing context's cancellation, soft-timeout, and hard-watchdog
policy. Aggregate working/retained allocation estimates are checked before creating
scales and coefficients; individual bigint multiplication/division sizes are also
guarded before execution. No independent timeout or error encoding was introduced.

## Measurements and selection

Reproduce all five candidates with the AR-0 harness:

```text
npm run benchmark:algorithms -- --module benchmarks/ln2-candidates.mjs --output ln2.json
npm run benchmark:algorithms -- --module benchmarks/ln2-candidates.mjs --format csv --output ln2.csv
npm run benchmark:algorithms -- --module benchmarks/ln2-candidates.mjs --family binary-rebuild --output ln2-selected.json
```

The module compares the same provider input and precision, outside graph/parser
overhead. Extraction is timed separately. It also supplies an independent reference
using `-ln(1-1/2) = sum 1/(k*2^k)` with outward integer truncation and tail
`<= 1/((n+1)*2^n)`, computed outside candidate timings.

Windows, Node 20.17.0, local observed milliseconds; the selected-path repeat was
run in a fresh process:

| Request            | Old sequential provider | Selected binary/rebuild repeat |
| ------------------ | ----------------------: | -----------------------------: |
| sequential 100     |                     3.1 |                            3.2 |
| sequential 300     |                     5.3 |                            5.1 |
| sequential 1000    |                   138.9 |                           27.7 |
| sequential 3000    |                  2834.7 |                          280.0 |
| sequential 10000   |                 73019.3 |                         4660.8 |
| fresh direct 10000 |                 78091.9 |                         3545.4 |

These observations justify replacing the old high-precision path without a
low-precision router: low-precision costs remain a few milliseconds, while the
3000/10000 costs decrease substantially. Host/JIT noise remains material; an
initial direct binary run was an outlier and was repeated in a fresh process.
Timing is not a correctness assertion or a universal performance guarantee.

At 10000 digits, the completed retained state is 50025 decimal bigint digits for
the old provider, 50042 for rebuilding, and 150597 for persistent blocks. Persistent
retention did not show a consistent speed advantage sufficient to justify its
roughly threefold retained state. Binary and rectangular variants are close because
both perform the same full-scale block divisions. Binary/rebuild is selected for
its balanced coefficient work and compact state; the other candidates remain
available for future tuning. The block width 32 is a conservative tested choice,
not a claim of an optimal threshold on every machine.

Machine-readable comparison and selected-path repeat are stored in
`benchmarks/results/ar-1-ln2-comparison.csv` and
`benchmarks/results/ar-1-ln2-selected-repeat.csv`. The comparison combines the
legacy rows of the initial complete five-family run with a subsequent run of the
four new candidates after completing operation-counter instrumentation. The
separate selected-path repeat supplies the table above. Compare timings as observations
from local executions, not a controlled statistical experiment. RSS is the process
high-water mark under the AR-0 contract, not a candidate-local working peak.
The legacy provider's term count is its completed frontier; new candidates report
actual evaluated coefficient terms, including rebuilds. Unsupported legacy
operation counters remain empty. New large-operation counters cover explicit
kernel arithmetic; shared rational normalization/extraction is outside their scope.

## Verification

`tests/ln2-splitting.test.ts` covers:

- Independent interval containment and verified-prefix agreement for all four
  new configurations on 100/300/1000/3000/10000 digits, plus legacy comparisons
  through 1000. The benchmark covers legacy/new agreement through 10000.
- Tiny precision, varied block sizes, and identical bounds for both layouts at
  identical term frontiers, independently of their coefficient summation order.
- Suspended binary combines, repeated short-budget interruptions, cache hits
  during suspended work, and larger requests without losing partial work.
- Real `CalculationHandle` soft timeout and cancellation at a pending combine,
  continued verified-prefix preservation, and hard-resource failure separation.
- Compact rebuild retention and a reduction in full-size divisions, without any
  timing assertion.

The older infrastructure test required strictly more terms for every precision
increase. Whole blocks can already cover a later request's tail, so that assertion
now checks a nondecreasing term frontier, increased working precision, a new
summation pass, and nested proved intervals. Mathematical expectations were not
relaxed.

The 30000/100000 optional grid was not run. No known correctness or lifecycle
blocker remains for AR-1; routing/reduction for general `ln` belongs to AR-2.

Validation completed: 291 Core tests, 9 benchmark-harness tests, typecheck, lint,
build and public API audit. The Node benchmark test runner required an unsandboxed
retry because the sandbox denied child-process creation (`spawn EPERM`). The
repository-wide formatter still reports the same 29 files with pre-existing style
violations; no broad formatting cleanup is part of this stage.
