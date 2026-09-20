# AR-0: Algorithm comparison infrastructure

Date: 2026-09-20  
Stage: AR-0 — completed

`benchmarks/algorithm-harness.mjs` supplies one harness for existing and future
algorithm families. `production-candidates.mjs` adapts the existing production
graph without changing mathematical kernels or the frozen public Core API.
The Stage 37 scaling benchmark remains available for conversions and its original
profile. AR-1 and later algorithm replacements are outside this change.

## Running and saving results

```text
npm run benchmark:algorithms -- --case ln2 --output ln2.json
npm run benchmark:algorithms -- --case pi --format csv --output pi.csv
npm run benchmark:algorithms -- --case ln2 --grid 100,300,1000
npm run benchmark:algorithms -- --case pi --high --output pi-high.json
```

The default grid is `100,300,1000,3000,10000` for every selected case. There are
no per-function silent truncations. `--high` adds `30000,100000`; `--grid` accepts
any strictly increasing positive safe-integer grid. High precision is opt-in and
is not a CI requirement. Gamma and large precision grids can take substantial
time. Selecting a case is useful for local profiling.

Build once with `npm run build`, then invoke
`node --expose-gc benchmarks/algorithm-comparison.mjs` with the same options to
obtain clean JSON/CSV on stdout without npm's build banner. `--output` writes
clean UTF-8 data directly; its parent directory must exist. Unknown options,
empty selections, and invalid grids fail before computation.

## Adding and comparing candidates

An ES module passed with `--module path/to/candidates.mjs` exports `cases`:

```js
export const cases = [
  {
    name: "ln2",
    input: { source: "ln(2)" },
    candidates: [oldCandidate, newCandidate],
    reference: async (digits) => independentlyVerifiedNumber(digits)
  }
];
```

Use `productionCandidate` from `benchmarks/production-candidates.mjs` as the old
graph adapter. Each candidate declares a unique `family` and implements
`create(input, counters)`. It receives a separate clone of the same input and
returns a session with:

- `refine(requestedDigits)`: returns an opaque mathematical result, synchronously
  or asynchronously; only this operation is timed as `wallTimeMs`.
- `verify(result, requestedDigits)`: extracts a Core-shaped `VerifiedNumber`
  (`sign`, `digits`, `exponent10: bigint`, `verifiedDigits`) outside refinement time.
- Optional `snapshot()`: reports cumulative counters and gauges after refinement.
- Optional `dispose()`: releases session ownership, including on verification failure.

The candidate must actually honor the common input. The harness cannot prove an
adapter's mathematical semantics. Each family gets a new session for sequential
refinement and another for a direct maximum request. All caches must belong to
that session; module-global warm caches would invalidate a fresh comparison.
Factory/setup costs are excluded from refinement timing. Runs are serial, in
case/family/mode order. `cumulativeWallTimeMs` allows comparing the complete
sequential workload against the fresh direct maximum, not just its final increment.
For performance decisions, repeat measurements and vary family order to assess JIT
and host noise. Timing is never a correctness threshold.

At every point the harness requires enough verified digits, compares families and
direct/sequential results, and checks that the previous verified prefix persists.
Exact terminating results may have fewer written digits; their proven trailing
zeros are included when comparing prefixes.
If supplied, `reference` is computed outside timings and compared at every point;
otherwise the first family supplies the comparison prefix. Agreement is not an
independent containment proof. New kernels still require their own bound,
containment, domain and resource-lifecycle tests before promotion.

## Counter contract

Every row has the required AR-0 metric columns. Unknown measurements are `null`
in JSON and empty fields in CSV; they are never replaced by a misleading proxy.
New kernel adapters can pass `counters.add` and `counters.observe` callbacks into
their internal instrumentation without adding anything to the public Core API.
Instrumentation is optional and must not replace cooperative resource checks.

| Metric                                   | Meaning                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `requestedDigits`                        | Consumer demand at this point                                                         |
| `workingDigits`                          | Highest internal decimal working precision observed in this session                   |
| `termCount`                              | Cumulative completed series terms/work terms, including recomputation if instrumented |
| `blockCount`                             | Cumulative completed summation blocks                                                 |
| `largeMultiplications`, `largeDivisions` | Cumulative large bigint operations reported by the kernel                             |
| `checkpointCount`                        | Cumulative cooperative checkpoint calls                                               |
| `peakBigIntDigits`                       | Largest individual working bigint observed, in decimal digits                         |
| `retainedBigIntDigits`                   | Sum of decimal digits in currently retained algorithm state                           |
| `peakRSSBytes`                           | OS process lifetime high-water RSS, in bytes, if available                            |

Counters use `add(name, amount = 1)` and report cumulative values plus a `Delta`
column per request. Call `add(name, 0)` to declare a supported counter with zero
work. Gauges use `observe(name, value)`; working/peak digits take the maximum,
retained digits take the latest observation. All values must be nonnegative safe
integers. A snapshot can override the callback metrics, but counters must never
decrease within a session. Snapshots are detached from collector state.

When counting large arithmetic, comparison adapters must use the same threshold
and scope: an operation is large when at least one operand has 100 or more decimal
digits (absolute value, zero has one digit). Count each bigint `*` or `/` once;
include squarings, exclude `%`, and include intermediate operands in the observed
bigint peak. Instrumentation overhead is part of refinement timing, so compare
equally instrumented candidates. Snapshot/decimal extraction costs are excluded.

Production adapters currently expose provider term/peak/retained state for
`π`, `e`, and `ln2`, plus working precision/block count for `π`. Provider term counts
describe completed frontier terms, not all resummation work. They do not claim to
count internal bigint operations. Other families currently expose checkpoints;
their unavailable term/working/memory counters remain `null`. Gamma's coefficient
count is deliberately not represented as a series-term count. Future kernels can
report all structural fields using the common collector.

`rssBytes` is observed immediately after refinement. `peakRSSBytes` is the
process-lifetime peak from Node `resourceUsage().maxRSS`, converted from KiB, not
a candidate-local peak. It can include earlier candidates and runtime overhead;
run one family/case in a fresh process for interpretable RSS comparisons. Neither
post-GC RSS nor result-ball size is substituted for a working-state peak.

## Validation

`npm run test:benchmarks` tests two distinct exact arithmetic fixture algorithms,
fresh session ownership, sequential counters, reference/prefix failure detection,
cleanup, unsupported metrics, grid validation, CSV escaping, JSON roundtrip, CLI
validation, and real production provider refinement. The fixture algorithms only
test the harness; they are not new production math candidates. These tests are
also included in `npm test` and `npm run check`.

Local validation passed all 282 Core tests and the benchmark suite, typecheck,
ESLint, build and the public API audit. The modified files pass Prettier.
Repository-wide `npm run check` stops on pre-existing formatting violations in
29 untouched files (including the supplied untracked replacement plan).

A production `π` smoke profile completed the entire default grid and a fresh
10000-digit request, with verified prefix agreement. Sequential completed terms
were `12,24,76,216,708`, blocks `3,6,19,54,177`, and working digits
`116,316,1016,3016,10016`. This validates the harness at the default maximum;
it is not an algorithm promotion measurement. The optional 30000/100000 grid
was not run.
