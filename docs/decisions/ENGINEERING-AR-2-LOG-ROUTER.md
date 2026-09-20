# AR-2: General logarithm kernels and routing

Date: 2026-09-20  
Stage: AR-2 — completed

## Decision

General `ln` retains its existing exact binary reduction
`x = r * 2^k`, with `2/3 <= r <= 4/3`, and reconstruction
`ln(x) = ln(r) + k*ln(2)`. The exponent is selected directly, not by a loop over
`|k|`; dependency precision still grows with the decimal length of `k`.

The reduced logarithm now uses resumable kernels in `atanh-blocks.ts`, selected by
`log-router.ts`. The measured initial routing policy is:

| Reduced-kernel request                                | Route                              |
| ----------------------------------------------------- | ---------------------------------- |
| Below 128 decimal places                              | Simple sequential recurrence       |
| 128 through 4095                                      | Rectangular splitting              |
| 4096 and above                                        | Balanced binary coefficient blocks |
| Very close to one, with an estimated small term count | Sequential recurrence              |

These thresholds concern internal work requests, not a user precision limit.
The near-one cost estimate uses decimal lengths of the exact numerator of
`z=(r-1)/(r+1)` and its denominator; it never supplies an error bound. Every route
still proves its tail with outward integer arithmetic. The high crossover lies
between measured 3000- and 10000-digit cases; 4096 is a tunable initial policy.

**AGM is rejected for production in this stage.** It is implemented as an internal
experimental candidate in `log-agm.ts` and remains available for comparisons.
The optional exact table-factor reduction is also not selected: its additional
constant-log evaluation did not repay its cost in the measured workloads.

The previous reduced atanh evaluator remains exported from the internal
`elementary.ts` module for differential benchmarks. No public entrypoint, grammar,
numeric dependency, general `exp` kernel, or other function family was added.

## Block arithmetic and proof

Let `z=abs((r-1)/(r+1))`, `q=z^2`, and `S=10^workingDigits`.
The kernels require `z <= 1/3`, including the direct `ln(2)` comparison case.
They compute outward fixed-point baby powers `z*q^j` for a bounded block width
`m=16`, then advance through giant powers `q^(bm)`.

For block index `b`, the polynomial is

```text
sum_{j=0}^{m-1} (z*q^j)/(2*(b*m+j)+1).
```

Rectangular splitting divides each baby-power enclosure by its small odd
coefficient and sums outward. Binary splitting instead forms a balanced exact
sum of those integer endpoint numerators over the odd denominators, dividing
outward only at the block root. The combine rule for endpoints `t` and denominators
`d` is `t=tL*dR+tR*dL`, `d=dL*dR`, separately for lower and upper numerators.
There is no global product of odd denominators and no exact power of a dense
input Rational denominator. Both layouts multiply each completed block enclosure
by its outward giant power before accumulating it.

The binary traversal is shared with the AR-1 `ln2` evaluator through
`binary-block.ts`. That extraction preserves the leaf/combine checkpoint order
and retains pending frames; the AR-1 correctness and lifecycle suite remains active.

After `N` terms, independently of either summation layout,

```text
0 <= R_N <= 2*z*q^N / ((2N+1)*(1-q)) <= 3*q^N/(2N+1).
```

The integer upper bound for `q^N` is rounded upward and its tail is added to the
upper sum. Stopping at a small number of scale units does not discard that error.
All baby-power, giant-power and coefficient rounding remains in the enclosure.
The negative sign is restored only after the positive magnitude is enclosed.
Published intervals intersect previous proved intervals within a kernel, and
the graph continues to verify requested significant decimal digits adaptively.

## Additional reduction experiment

The table candidate selects the nearest positive multiple of `1/16` as an exact
factor `f`, then computes `ln(f) + ln(r/f)`. The residual is nearer to one; both
arguments and interval addition are exact/outward. Tests cover factors at the
reduction-strip boundaries and rational arguments between table points.

The candidate retains both kernel states so pause/continue works even between
the factor and residual logarithms. It does not assume unproved decimal constants.
On `ln(113/100)` at 1000 digits, binary/table took approximately 46 ms versus
23 ms for plain binary, and retained about twice the local state. Several required
benchmark arguments already lie on this table, so their residual is exactly one
and there is no reduction advantage. The experiment is kept internal, disabled
in production; no global lookup cache was introduced to hide its cold-start cost.

## AGM construction and rigorous correction

The AGM identity relates the elliptic integral to `M=AGM(1,u)` as
`K=pi/(2*M)`. See [DLMF 19.8.5](https://dlmf.nist.gov/19.8.E5).
The convergent complementary-modulus expansion in
[DLMF 19.12.1–3](https://dlmf.nist.gov/19.12) has coefficients at most one and
logarithmic factors between zero and `L=ln(4/u)` for the small positive `u` used
here. Bounding the remaining positive terms by a geometric series gives

```text
0 <= K-L <= L*u^2/(1-u^2).
```

The experiment chooses `u=4/(r*2^s)`. Since `r<=2` and `ln(2)<1`,
`L < s+2`. It therefore subtracts the explicit outward correction
`(s+2)*uUpper^2/(1-uUpper^2)` from the lower elliptic-integral bound and subtracts
the interval `s*ln(2)` from both sides. This is a derived finite error bound,
not an unquantified asymptotic approximation.

AGM arithmetic means round outward; geometric means use resumable integer Newton
sqrt jobs on lower/upper endpoint products. The true AGM stays between the lower
geometric and upper arithmetic means. Both the AGM loop and unfinished Newton
iterations survive interruption. Shared `pi`/`ln2` providers use the same context.

An early experimental implementation did not budget the relative error introduced
by rounding the tiny initial `u`; its interval stopped contracting before reaching
the target. The corrected working precision includes `ceil(s/3)` extra decimal
places, using `2^s <= 10^ceil(s/3)`, plus guard digits. The regression test requires
successful containment and bounded checkpoint work at 100 digits. No term/iteration
ceiling was added to mask this failure.

## State ownership and resources

The production cache belongs to its evaluation context through a WeakMap. It keeps
at most eight completed argument entries and protects unfinished entries from
eviction. Different contexts do not share these mutable states. On a family switch,
an unfinished previous route completes before the new route starts.

Allocation checks account for other retained argument entries as well as the
active kernel's baby powers, coefficient stack, sums, and cached enclosure.
Checkpoint callbacks continue to enforce cancellation, soft timeout and hard
watchdog policy. The fixed block width bounds traversal depth and coefficient
denominator size, not total precision. Larger requests remain subject only to the
existing resource policy. No permanent state is serialized.

Repeated decimal conversion in operation instrumentation initially obscured the
kernel's performance. Allocation estimates now use binary lengths and the outward
inequality `2^3 < 10`; exact decimal size is measured only when a new peak crosses
a power-of-ten threshold. This changes observation overhead, not arithmetic bounds.

## Benchmark evidence

Commands after building:

```text
npm run benchmark:algorithms -- --module benchmarks/log-candidates.mjs --grid 100,300,1000 --output log-matrix.json
npm run benchmark:algorithms -- --module benchmarks/log-candidates.mjs --case ln3 --output log-scaling.json
npm run benchmark:algorithms -- --module benchmarks/log-candidates.mjs --case ln3 --family router --format csv --output log-router.csv
```

The matrix covers `ln(2)`, `ln(3)`, `ln(10)`, `ln(113/100)`,
`ln(1+10^-50)`, and `ln((3/2)*2^k)` for `k=100000,-100000`.
All use the same input and requested precision within a case. Reduction setup is
outside kernel timing. For `ln(2)`, the module deliberately compares the direct
reduced kernels at `r=2`; production may instead use the AR-1 shared constant.
Near-one requests include their required absolute decimal offset in every family.
Decimal extraction and comparison are outside refinement timing.

Representative sequential `ln(3)` observations in milliseconds, Windows/Node 20.17:

| Family                    | 3000 digits | 10000 digits |
| ------------------------- | ----------: | -----------: |
| Previous sequential atanh |        1043 |        21953 |
| Rectangular               |         529 |        10403 |
| Binary                    |         703 |         9253 |
| Binary with table factor  |         638 |         9693 |
| AGM                       |        2598 |        54594 |

The selected router measured about 562 ms at 3000 and 9977 ms at 10000 in a
separate sequential run. Binary's balanced coefficient work and reduced full-size
division count support the high-precision choice. The older evaluator is faster
than the newly instrumented sequential candidate on some small inputs; the latter
is retained only where absolute costs are small or very few terms are expected,
and supplies resumability absent from the old local recurrence.

Timings are observations, never correctness assertions. Some direct runs showed
substantial host-load outliers; a separate fresh maximum request is saved as a
repeat (approximately 9191 ms for a direct 10000-digit request). The 1000-digit matrix also shows that exponent `+/-100000` costs remain
similar to ordinary arguments at matching reduced precision, and AGM pays for its
higher working precision and shared-constant dependencies. These results reject
AGM promotion with the current backend and constant algorithms, not AGM in general.

CSV artifacts are in `benchmarks/results/ar-2-log-*.csv`. The matrix and scaling
files contain the six forced families; the selected file and repeat record the
router. Arithmetic counters cover the local reduced kernel; shared constant work
is included in wall time and context checkpoints, but excluded from local retained
state. For AGM, `termCount` means AGM iterations and `blockCount` means Newton
iterations. Its actual bigint peak was not instrumented: that column is empty,
with the conservative bound preserved separately as `estimatedPeakBigIntDigits`.
Unknown legacy counters are also empty. RSS is the AR-0 process high-water reading.

## Verification and limits

`tests/log-router.test.ts` adds independent `ln(1+t)` series containment,
deterministic rational-property cases, both signs and near-one inputs, block-size
boundaries, route boundaries, table reduction, interrupted combines, pending-cache
retention and owner isolation, AGM sqrt continuation and the initial-modulus
regression, huge-exponent scaling, and production pause/continue/cancel/resource
separation. Rectangular/binary containment and verified-prefix stability run on
100/300/1000/3000/10000 digits. The full old/new/AGM comparison reaches 10000 for
`ln(3)`; the complete argument matrix reaches 1000.

The optional 30000/100000-digit grid was not run. General `ln` now uses the new
scalable kernels, huge-exponent reduction is preserved, the high route is measured,
and AGM has an explicit measured rejection. AR-3's `exp` replacement is outside
this stage.

Final validation passed: 302 Core tests, including 11 new AR-2 tests and all AR-1
tests; 9 benchmark-harness tests; lint, typecheck, build, and public API audit.
The sandbox denied Node test-runner child-process creation on the first run;
the authorized unsandboxed final test run completed successfully. Repository-wide
formatting still reports the same 29 files with existing style violations.
The new files and shared `ln2` traversal change pass targeted Prettier checks.
