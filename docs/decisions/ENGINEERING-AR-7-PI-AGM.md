# AR-7: Chudnovsky versus Gauss–Legendre AGM

Date: 2026-09-22

Status: AR-7 completed; route high-N pi to AGM, retain Chudnovsky below the
measured threshold and as an explicit comparison baseline.

Scope: ALGORITHM_REPLACEMENT_PLAN.md AR-7; implementation-plan constant stages
12, 24 and 28, with the existing public API freeze preserved.

## Decision

Route internal pi requests of at least 3000 decimal digits to Gauss–Legendre
AGM. Keep Chudnovsky binary splitting below that threshold. An already completed
AGM enclosure also serves smaller requests. Consumer guard digits are part of
the internal request, so the threshold is not a new public precision setting.

The threshold is the lowest high-precision point compared in this experiment,
not a claim about the exact crossover. No global router or AR-8 work is included.
The public constant and internal pi dependencies share the same context-owned
selection. Chudnovsky split levels and its cached rigorous sqrt(10005) remain
available. `getChudnovskyPiRationalInterval` explicitly selects the baseline for
independent tests/benchmarks; the historical provider snapshot describes that
baseline. `getPiComputationSnapshot` describes production selection and both
providers' retained storage. No new exports enter the package API.

## AGM enclosure

The Gauss–Legendre identity used here is described by Richard P. Brent in
[Jonathan Borwein, Pi and the AGM](https://maths-people.anu.edu.au/~brent/pd/JBCC-Brent.pdf),
the Gauss–Legendre algorithm section. Start with

```text
a_0 = 1, b_0 = sqrt(1/2), t_0 = 1/4
a_(n+1) = (a_n + b_n)/2
b_(n+1) = sqrt(a_n b_n)
t_(n+1) = t_n - 2^n (a_n - b_n)^2 / 4
pi = M^2 / t_infinity, where M = AGM(1, sqrt(1/2)).
```

The following deliberately conservative remainder certificate is derived from
these recurrences. Put `d_n = a_n-b_n >= 0`. AM–GM gives
`b_n <= M <= a_n`, and

```text
d_(n+1) = (sqrt(a_n)-sqrt(b_n))^2 / 2 <= d_n/2.
```

Consequently, the uncomputed t decrement is bounded by a geometric series:

```text
0 <= t_n-t_infinity
   = sum(j>=0, 2^(n+j) d_(n+j)^2 / 4)
  <= 2^(n-1) d_n^2 = R_n.
```

Whenever `t_n-R_n > 0`, this certifies

```text
b_n^2 / t_n <= pi <= a_n^2 / (t_n-R_n).
```

The implementation stores intervals for a, b and t at decimal scale P. Every
division uses floor/ceil. The lower gap is clamped to zero; the upper gap is
`a.upper-b.lower`. Both truncation and rounding therefore remain in the returned
enclosure. A sufficient enclosure width, rather than an iteration count, stops
the algorithm. P initially equals the requested digits plus 32. If rounding
dominates, the guard scale increases without increasing the requested target.
The reduced-guard regression test exercises that recovery path. There is no
fixed iteration or precision ceiling.

For an interval product `[L,U]` at squared scale, integer Newton iteration
computes `r=floor(sqrt(L))` from an upper starting integer. Since the AGM operands
stay positive, r is positive, and

```text
r <= sqrt(L) <= sqrt(U)
sqrt(U) <= r + ceil((U-r^2)/(2r)).
```

The last inequality follows by squaring its nonnegative right side. Thus one
integer root suffices for an outward interval root; no floating-point square
root contributes to the result. Decimal conversion to Rational and then Ball
uses the existing directed boundaries.

## State and the baseline regression

AGM owns a completed enclosure and one pending job. The job retains a, b, t,
the power-of-two weight, and the current Newton root frontier. A pause or typed
resource rejection does not discard this work. A higher request first finishes
pending work, then starts a larger-scale pass. Completed lower-precision AGM
iterations cannot recover discarded rounding bits: increasing precision starts
a fresh pass. Same/lower requests reuse the completed result. This limitation
is included in the sequential measurements, rather than hidden by prewarming.

Context WeakMaps own production providers. Allocation guards reserve pending
state and reconstruction temporaries; switching strategies includes retained
Chudnovsky storage in the reserve. The old tree is retained, not discarded on
selection of AGM. Counts in the production snapshot are cumulative series
terms plus AGM iterations, so benchmark counters do not regress at the switch.
The scaling adapter labels those mixed units explicitly.

Dependency testing found a pre-existing Chudnovsky correctness bug. When a
pause occurred between carry merges, the old code had already cleared a split
level but kept the combined carry only in a local variable. Continuation lost
terms and produced different, incorrect pi digits. The new regression failed
before the fix. The carry and its level now persist; old levels remain intact
until the complete carry is committed. Pending carry storage is counted in the
snapshot. The series, tail bound, block size and sqrt(10005) algorithm are unchanged.

## Measurement method and counters

Node 20.17.0, Windows. No elapsed-time assertion is used as a correctness test.
The AR-0 runner compares families in one invocation, checks verified prefixes,
and compares sequential requests with a fresh direct maximum. Ball conversion
and verified extraction occur outside the kernel timing.

The optional `sqrtOperations` counter was added to the harness, with a counter
test. Pi instrumentation is opt-in and context-owned. It counts interval-root
starts (including interrupted attempts) and explicit instrumented bigint
products whose two operands each have at least 129 magnitude bits. Instrumented
Chudnovsky operations cover split combinations, scaled tail comparisons and
root products; AGM covers its recurrence, bound and root products. These are
kernel counters, not counts of hidden multiplications in Rational/GCD/backend
code or V8's implementation of bigint division/power. Full wall times include
all those costs. Resource snapshots count logical retained decimal bigint
digits; they are not allocated bytes. RSS/process peak values also include the
runtime and earlier work and should not be read as isolated kernel allocations.

## Results

`benchmarks/results/ar-7-pi-comparison.csv` is the repeat, same-invocation
comparison with cross-family verified-prefix checks:

| Mode         | Digits | Chudnovsky, ms | AGM, ms |
| ------------ | -----: | -------------: | ------: |
| Sequential   |   3000 |         811.49 |  182.15 |
| Sequential   |  10000 |       10424.53 | 1586.03 |
| Fresh direct |  10000 |        8336.43 | 1501.30 |

For the direct 10000-digit point, observed kernel large multiplications were
2875 versus 108, root starts 1 versus 14, and retained decimal bigint digits
99457 versus 20022 (Chudnovsky versus AGM). More root operations do not imply
slower computation in this implementation. The AGM sequential pass at 10000
still restarted at its new scale, yet won decisively.

Incrementally saved budget probes are in `ar-7-pi-agm-budget.json` and
`ar-7-pi-chudnovsky-budget.json`:

| Fresh direct point | Chudnovsky                            | AGM                     |
| ------------------ | ------------------------------------- | ----------------------- |
| 3000               | 489 ms, verified                      | 186 ms, verified        |
| 10000              | 8158 ms, verified                     | 1594 ms, verified       |
| 30000              | 20 s budget exceeded                  | 10730 ms, verified      |
| 100000             | not attempted after budget exhaustion | 21.2 s, budget exceeded |

AGM also completed sequential 30000 digits in 11772 ms. Its sequential/direct
prefixes agree throughout. Cross-family comparison is complete through 10000
digits; there is no claim of an independent full 30000-digit Chudnovsky reference.
Censored observations are not successful timings. The optional 100000-digit
point was attempted for AGM but not completed within the preselected 20-second
budget. The production algorithm itself has no such experimental budget cap.
A single bigint operation cannot be interrupted, so elapsed time may exceed
the cooperative budget. No 100000-digit completion/scaling claim is made.

Budget probes save each row immediately; the two families' complete rows are
stored separately. Baseline diagnostic Rational endpoints are omitted from
JSON; scalar metrics remain available.

Reproduce after `npm run build`:

```powershell
node --expose-gc benchmarks/algorithm-comparison.mjs --module benchmarks/pi-candidates.mjs --grid 3000,10000 --format csv
node --expose-gc benchmarks/pi-budget.mjs 3000,10000,30000,100000 20000 benchmarks/results/pi-agm.json agm
node --expose-gc benchmarks/pi-budget.mjs 3000,10000,30000,100000 20000 benchmarks/results/pi-chudnovsky.json chudnovsky
```

## Checks

Seven new Core tests cover the lost-carry regression, independent containment,
monotonic verified prefixes, Newton/AGM pause continuation, resource rejection,
precision upgrades, cache isolation, working-scale recovery and the public
strategy transition. A new harness test verifies cumulative counters and
verified output across that transition.

- Full suite passed: 351 Core tests in 49 suites and 10 benchmark harness tests.
- Typecheck, ESLint, build and frozen public API audit passed.
- Changed/new code and this report pass Prettier. The repository-wide check
  retains 29 pre-existing formatting violations; unrelated files were not reformatted.
- Diff review found only AR-7 implementation, diagnostics, tests and measurements.
- Remaining measurement limits: Chudnovsky at 30000 and AGM at 100000 digits
  are censored at the cooperative budget; no unmeasured completion time is inferred.
