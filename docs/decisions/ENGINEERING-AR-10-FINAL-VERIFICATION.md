# AR-10: global verification and final scaling profile

AR-10 is complete. The final profile finds no new correctness/resource blocker;
Core API 1.0 remains frozen. The principal measured bottlenecks improve, with
the local regressions and remaining measurement limits explicitly retained below.

## Results

Both runs completed all 91 rows: 76 verified expression rows and 15 conversion/
normalization rows. All 76 cross-version verified signatures agree. Raw evidence:
`benchmarks/results/ar-10-stage37.json`, `ar-10-post.json`, and
`ar-10-comparison.json`. The comparison contains every precision and mode,
including extraction, heap/RSS and compatible term-count ratios.

The table shows each expression's largest **sequential increment**. Ratios are
post/baseline; memory is whole-process RSS and work is the checkpoint proxy.

| Operation        | Digits | Baseline ms |  Post ms | Time ratio | RSS ratio | Checkpoint ratio | Strategy                                 |
| ---------------- | -----: | ----------: | -------: | ---------: | --------: | ---------------: | ---------------------------------------- |
| pi               |  10000 |   10611.520 | 4078.620 |      0.384 |     0.955 |            0.165 | AGM                                      |
| e                |   3000 |     284.540 |  156.290 |      0.549 |     0.819 |            4.026 | binary factorial                         |
| small-sin        |  10000 |   16702.620 | 1841.470 |      0.110 |     0.827 |            4.918 | binary sincos                            |
| sincos-tan       |   3000 |    1881.820 |  285.820 |      0.152 |     0.983 |            0.774 | rectangular sincos                       |
| large-radian-sin |   1000 |     184.270 |  119.000 |      0.646 |     0.985 |            1.966 | Chudnovsky reduction, rectangular sincos |
| exp              |   3000 |    4760.230 |  588.720 |      0.124 |     1.002 |            1.869 | rectangular exp                          |
| ln-reduction     |   3000 |    4856.150 |  793.660 |      0.163 |     1.013 |            1.651 | rectangular log                          |
| ln2              |  10000 |   67615.500 | 5726.380 |      0.085 |     1.194 |            2.326 | binary ln2; trivial reduced log          |
| nth-root-power   |  10000 |    1903.630 | 2020.860 |      1.062 |     1.008 |            2.250 | local Newton/root router                 |
| gamma            |   1000 |    7602.570 |  196.440 |      0.026 |     0.997 |            0.010 | special rational Gamma                   |
| gamma-reflection |   1000 |    5712.510 |  202.570 |      0.035 |     0.992 |            0.011 | special rational Gamma                   |
| large-exp        |   3000 |    4494.660 |  728.160 |      0.162 |     0.752 |            1.995 | rectangular exp                          |
| near-one-ln      |   3000 |     964.240 | 1128.500 |      1.170 |     0.994 |            3.499 | binary log                               |
| near-one-log     |   3000 |   22007.270 | 4005.260 |      0.182 |     1.005 |            2.771 | binary log                               |
| rational-power   |   3000 |     173.310 |  176.490 |      1.018 |     1.005 |            1.897 | local Newton/root router                 |

Observed sequential speedups include 11.8x for ln2, 9.1x for small sin, 8.1x for
exp, 6.1x for ln3 and 38.7x/28.2x for the sampled direct/reflected Gamma cases.
This is not a claim that every input is faster. Near-one ln regresses 17.0%
sequentially and 12.7% on a fresh direct request at 3000. The decision is to retain
the proven AR-2 policy in this final verification stage rather than recalibrate
its argument/precision thresholds from one global timing sample. This remains a
documented tuning opportunity, not a correctness or resource failure. Unchanged
root/power paths show small mixed timing differences; their existing policy stays.

The highest observed RSS is 68.66 MiB baseline and 68.52 MiB post-AR. In individual
rows RSS can rise (notably ln2, 1.194x); the result is not advertised as a universal
memory reduction. More checkpoints can accompany faster balanced work, as the
e and sin rows demonstrate.

No 10000-digit general-Gamma or 100000-digit pi completion claim is added here.
The previously censored experiments and expensive general Stirling coefficient
generation remain documented in AR-5/AR-7. The Gamma timing gains above concern
the specified rational test inputs, not all real arguments.

## Reproducible comparison

The baseline is the actual Stage 37 commit
`6489afe72c5a3205f56cda43ff86d7e8f2aa1717`, archived and compiled under
`dist/ar-10-baseline` without changing the working checkout. The post-AR Core is
AR-9 commit `a2cf6eb`; AR-10 changes only benchmark verification/reporting and
documentation. Both runs use the same current measurement script, Node v20.17.0,
Windows, `--expose-gc`, case order, expressions and precision requests. Heavy
tests and other benchmarks do not run alongside either measurement run.

The full Stage 37 geometric grid and per-case maxima are preserved: pi, small
sin, ln2 and sqrt through 10000; e, tan, exp and ln3 through 3000; large-radian
sin and direct/reflected Gamma through 1000. Each case refines sequentially and
then runs its maximum request on a fresh graph. The extended cases are
`exp(1000000)`, `ln(1+1/10^20)`, `log{1+1/10^20}(2)` and `(7/3)^(5/7)`, each through 3000. Actual expression strings are stored in the raw rows.

Every expression row proves the requested digits. Sequential prefixes must
extend earlier ones; fresh direct maximums must agree. SHA-256 signatures of
sign, exponent and requested prefix additionally require agreement between
Stage 37 and post-AR. Hash matching supplements the independent mathematical
containment tests; it does not replace them. Extraction is timed separately.
Rational normalization and both interval/ball conversion microbenchmarks are
also retained on the entire grid.

Raw measurements are persisted after each expression row. The comparison tool
rejects missing/duplicate rows, changed inputs, insufficient digits and prefix
mismatches. Its regression test ensures absent or incompatible metrics remain
null instead of being reported as a zero-cost result.

## Interpretation

All ratios are **post / baseline**: below one means less time/memory/work as
labelled. RSS and heap are post-GC **whole-process** observations, not an isolated
kernel's allocation or peak memory. Runtime/JIT/order effects and allocator
high-water marks affect them. These single-run ratios are a final integration
profile, not a cross-platform threshold calibration; repeated candidate
measurements in AR-1 through AR-9 support the selection decisions.

Checkpoint ratios compare cooperative work-unit proxies, not equal-cost
mathematical operations. Checkpoint placement changed between families.
Literal term ratios are emitted only when metric names match. Pi's old series
terms versus new series-plus-AGM iterations, and Gamma's old cached coefficients
versus new hypergeometric terms, are deliberately incomparable. Extraction and
conversion ratios are retained in the complete comparison JSON.

## Correctness coverage

| Required category                     | Executed suites                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-expression regressions          | `core-verification`, `correctness-stabilization`, `exact-log-resource-remediation`, public API exact-decimal regressions                                    |
| Independent reference and containment | `core-verification`, `ln2-splitting`, `log-router`, `exp-kernel`, `sincos-kernel`, `stirling-adaptive`, `gamma-alternatives`, `pi-agm`, `algorithm-routing` |
| Monotonic verified prefix             | Core verification and replacement kernel suites; sequential/direct benchmark checks                                                                         |
| Domain boundaries and Gamma poles     | `core-verification`, `factorial-gamma`, `gamma-alternatives`, trig and log boundary suites                                                                  |
| Structural q*pi trig                  | `trig-final-remediation`, `trig-post-stabilization`, `sincos-kernel`                                                                                        |
| Timeout, continue, cancel             | `calculation-lifecycle`, replacement kernel suites, `algorithm-routing`                                                                                     |
| Hard resource separation              | `hard-resource-safety`, `power-gamma-resource-remediation`, routing and kernel resource regressions                                                         |
| API freeze and transport              | Frozen public API tests, declaration audit, Worker DTO tests                                                                                                |

Algorithm proofs, state/resource invariants and selection decisions remain in
the engineering notes for [AR-1](ENGINEERING-AR-1-LN2-SPLITTING.md),
[AR-2](ENGINEERING-AR-2-LOG-ROUTER.md), [AR-3](ENGINEERING-AR-3-EXP-KERNEL.md),
[AR-4](ENGINEERING-AR-4-SINCOS-KERNEL.md), [AR-5](ENGINEERING-AR-5-ADAPTIVE-STIRLING.md),
[AR-6](ENGINEERING-AR-6-GAMMA-ALTERNATIVES.md), [AR-7](ENGINEERING-AR-7-PI-AGM.md),
[AR-8](ENGINEERING-AR-8-E.md), and [AR-9](ENGINEERING-AR-9-ROUTING.md).
Experimental AGM log/table reduction, bit-burst and Spouge are not promoted.
The bounded Newton/root cost policy and exact arithmetic/conversion algorithms
remain unchanged: correctness and compact exponent handling remain necessary,
and no unmeasured replacement is introduced by this profiling stage.

## Commands

```powershell
git archive 6489afe -o dist/ar-10-baseline.tar
# Extract into a new dist/ar-10-baseline directory.
tar -xf dist/ar-10-baseline.tar -C dist/ar-10-baseline
npx tsc -p dist/ar-10-baseline/tsconfig.build.json
npm run build
node --expose-gc benchmarks/core-scaling.mjs --full --extended --json --core-root dist/ar-10-baseline/dist/core --output benchmarks/results/ar-10-stage37.json
node --expose-gc benchmarks/core-scaling.mjs --full --extended --json --output benchmarks/results/ar-10-post.json
node benchmarks/final-scaling-report.mjs benchmarks/results/ar-10-stage37.json benchmarks/results/ar-10-post.json benchmarks/results/ar-10-comparison.json
```

## Final checks

- Full suite passed: 357 Core tests in 50 suites, plus 14 benchmark tests.
- The added comparison regression rejects changed/missing verification and
  unmatched/duplicate rows, and checks ratio/metric compatibility behavior.
- Typecheck, ESLint, build and frozen public API audit passed.
- Changed files pass Prettier. Whole-repository formatting still has 29
  pre-existing violations outside this change.
- Final diff is confined to the retained benchmark harness, comparison/report
  tools, their regression, raw measurements and this engineering note.
- No mathematical implementation, error semantics, parser, public settings or
  API surface was changed by AR-10. The harness remains available for future work.
