# Engineering note: constant state and scaling

## Decision

Stage 28 keeps the existing Chudnovsky series for `π` and factorial series for `e`.
The remediation changes resumable state and diagnostics only.

The `π` provider now treats its binary-counter `splitLevels` as the single source for both
the partial sum and the first omitted coefficient. For a completed split `[0,n)`, its
`P/Q` is multiplied by the one-step Chudnovsky ratio at `n`; multiplying by `A+B*n` gives
the exact magnitude of the first omitted term. The established geometric factor
`10^12/(10^12-1)` remains the rigorous total-tail bound. The former sequential numerator
and denominator accumulators and the redundant linear block array are therefore absent.

The provider owns a context-scoped fixed-point Newton state for `sqrt(10005)`. A higher
precision request rescales the previous outward interval, uses its upper endpoint as the
Newton start, and intersects the new result with that rescaled interval. This makes every
new cached square-root interval no wider than the preceding one.

The `e` factorial recurrence already continued from its prior numerator, denominator, and
term count. Local profiling did not justify changing its summation structure, so its
mathematical series and sequential state remain unchanged. New counters explicitly report
the reused prefix, newly generated terms, and bigint sizes.

## Local profiling

Measurements used one process, one evaluation context, sequential `N = 100, 300, 1000,
2000`, Node on the development Windows environment. Times are diagnostic and intentionally
not asserted by tests.

| Constant    | N sequence              | Incremental times (ms)     | Final terms |             Final retained split nodes |
| ----------- | ----------------------- | -------------------------- | ----------: | -------------------------------------: |
| `π`, before | 100 → 300 → 1000 → 2000 | 7.7 → 12.8 → 79.7 → 284.5  |         144 | 36 duplicated blocks plus split levels |
| `π`, after  | 100 → 300 → 1000 → 2000 | 7.4 → 10.0 → 79.3 → 324.4  |         144 |                                      2 |
| `e`         | 100 → 300 → 1000 → 2000 | 10.0 → 11.1 → 64.5 → 251.5 |         811 |                         not applicable |

The 2000-digit `π` timing varies enough that this change is not claimed as a speedup. Its
measured result is the removal of linear duplicate/tail state: the final provider retained
two split nodes, reused `sqrt(10005)` three times, had `peakBigIntDigits = 4021`, and
`cachedBigIntDigits = 19114`. The corresponding `e` runs added `75, 96, 283, 357` terms;
every later refinement reused the complete earlier prefix.
