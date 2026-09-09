# Engineering note: Core scaling profile

Date: 2026-09-09  
Stage: 37 — performance profiling and safe optimizations

## Scope and method

`benchmarks/core-scaling.mjs` measures the production evaluation graph on the geometric
precision grid `100, 300, 1000, 3000, 10000`. It records sequential refinement and a
fresh direct request at the largest supported point for each case. The full command is:

```text
npm run benchmark:scaling
```

The quick local/CI-oriented command stops at 1000 digits (Gamma at 300):

```text
npm run benchmark:scaling:quick
```

Times and retained process memory are observations, not pass/fail thresholds. Exact
series/state counters are used for `π`, `e`, `ln2`, and Gamma's coefficient cache. For
algorithms without a public term counter, the benchmark labels cooperative checkpoints
as the work-unit proxy. Likewise, an algorithmic working-state peak is preferred; where
it is not exposed, the result-ball component size is explicitly labelled as the proxy.

The suite covers constants and Chudnovsky state, small and large radian reduction,
standalone trig and the shared `sincos` path used by `tan`, `exp` reduction and
reconstruction, general `ln` reduction and shared `ln2`, `nthRoot`, direct and reflected
Gamma, verified decimal extraction, Rational-to-ball and interval-to-ball conversion,
and large Rational normalization. The reflected Gamma case exercises exact-Rational
modulo reduction in `sin(πx)`.

## Representative full run

Windows/Node 20.17 local run, sequential refinement; elapsed milliseconds:

| operation   | 100 | 300 | 1000 | 3000 | 10000 |
| ----------- | --: | --: | ---: | ---: | ----: |
| `π`         |   8 |  12 |  107 |  906 | 11195 |
| `e`         |   2 |   3 |   23 |  368 |     — |
| `sin(1/10)` |   4 |   7 |   59 |  989 | 15818 |
| `exp(1)`    |   5 |  15 |  231 | 4262 |     — |
| `ln(2)`     |   4 |   9 |  164 | 3005 | 66793 |
| `2^(1/2)`   |   3 |   4 |   21 |  154 |  1686 |
| `(1/3)!`    |  27 | 160 | 5434 |    — |     — |
| `(-4/3)!`   |  24 | 154 | 5865 |    — |     — |

The 10000-digit points completed with verified extraction. The highest observed RSS in
this run was about 66 MiB. Chudnovsky completed-term counts grew `12, 24, 76, 216, 708`
and its observed working BigInt peak grew `237, 637, 2037, 6037, 20037` decimal digits.
The shared `ln2` provider completed-term counts grew `127, 336, 1069, 3164, 10499`; its
working peaks were `127, 327, 1028, 3028, 10029` digits. These trends and the successful
10000-digit results show no fixed precision ceiling before the configured resource
policy.

Sequential state reuse was observed in the constant providers. At the maximum points,
fresh direct requests were in the same order of growth as sequential refinement. The
benchmark emits all direct/sequential rows so later profiling can compare them without
turning machine-specific timings into brittle tests.

## Safe optimizations selected

1. `intervalToBall` now computes a directed midpoint and an outward upper radius directly
   in the backend. The proof obligation is local: the midpoint is rounded downward, so
   `upper - center` covers both endpoint distances. This removes conversion of huge binary
   exponents into exponentially large Rational powers of two.
2. Radian trig reduction returns immediately for an interval already contained in
   `[-1/2, 1/2]`. Since `1/2 < π/4`, this proves the canonical-strip condition without
   constructing `π`.
3. Gamma uses a precision-dependent positive shift: approximately `1.5N` below 512
   digits and `2N` from 512 digits. The larger Stirling argument rigorously reduces the
   number of expensive exact Bernoulli corrections. The former 1000-digit strategy did
   not finish within 90 seconds in the profiling run; the selected strategy completes
   direct and reflected cases in about 5–6 seconds on the same machine.

All three changes preserve directed rounding and existing error bounds. Regression tests
cover huge-exponent interval containment/compactness, the no-`π` small-radian route, and
the selected high-precision Gamma plan; the existing containment, monotonic-refinement,
domain, and resource-lifecycle suites remain the mathematical oracle.

## Remaining performance observations

`ln2`, general `exp`, and trigonometric series dominate the 10000-digit local runtime.
Their curves are resource costs rather than correctness failures, and no artificial
precision ceiling or new correctness/resource blocker was found. Future improvements may
replace their linear/chunked inner work, but must retain the current directed bounds and
state semantics.
