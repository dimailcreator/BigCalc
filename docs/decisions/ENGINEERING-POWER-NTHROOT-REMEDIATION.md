# Engineering decision: stage 31 power/nthRoot remediation

## Scope

Stage 31 replaces the pathological exact-root search, makes the existing decimal
scaled `nthRoot` route cost-aware, and connects exact integer powers to the calculation
resource lifecycle. It does not add a fixed mathematical denominator limit and does not
introduce a new root approximation family.

## Exact roots

Exact integer roots now start from a bit-length upper bound and descend with integer
Newton iteration. Every power comparison uses exponentiation by squaring and stops as
soon as multiplication would exceed the target. The Newton and power-check loops invoke
cooperative checkpoints.

The exact rational path applies the integer algorithm independently to the canonical
numerator and denominator. Negative values remain eligible only for odd root degrees.

The local profile exposes the initial bound width, Newton iterations, power-check
multiplications, early exits, and peak bigint digits. This makes a regression to a
`[1, value]` search or a linear-in-degree power check observable.

## Direct root strategy

The current direct route represents a `q`-th root at decimal scale `N` by an integer
problem whose target may contain about `N*q` decimal digits. Before constructing it, the
planner estimates:

- `N*q` allocation size and peak bigint digits, including the input;
- degree bit length and expected Newton/power-check work;
- the competing `ln+exp` work at the requested precision;
- a precision-linear memory envelope for the current implementation.

The direct route is selected only while both memory and estimated work are bounded.
Otherwise the node uses the rigorous `ln+exp` fallback. This is an implementation cost
decision, not a domain restriction on `q`. A node may move from direct root to fallback
when refinement raises the cost; the state records the transition and the graph continues
through the fallback instead of producing an internal error.

## Exact powers and resources

Exact rational integer powers use exponentiation by squaring. The node owns the mutable
power frontier, so a soft timeout resumes from completed multiplications. A preflight
result-size estimate is checked against `maxEstimatedBigIntDigits` before allocation.
Each multiplication is preceded by a checkpoint, allowing soft timeout, cancellation,
and the hard checkpoint watchdog to interrupt the operation. Values `0`, `1`, and `-1`
retain constant-size estimates.

## Local profile

Measurements on the reference Node.js backend:

| Case                                        |  Time | Newton iterations | Power multiplications | Peak bigint digits |
| ------------------------------------------- | ----: | ----------------: | --------------------: | -----------------: |
| exact `(2^100000)^(1/100000)`               | 57 ms |                 3 |                    96 |             30,104 |
| non-perfect `(2^100000+1)^(1/100000)` check | 46 ms |                 3 |                    96 |             30,104 |
| direct cube root of `2`, `N=100`            |  2 ms |                18 |    profiled in Newton |                301 |
| exact `3^100000`                            | 13 ms |               n/a |                    22 |   estimated 60,207 |

For `q=1000`, `N=1000`, the planner reports an `N*q` allocation of 1,000,000
digits, estimated peak size 1,000,009 digits, direct cost 40,000,360 units, and
fallback cost 1,064,000 units. It selects `ln-exp` before the scaled target is created.
A `q=20` state refined from `N=10` to `N=100` records one safe strategy change.

Timings are diagnostic and are not pass/fail thresholds. Regression tests assert the
structural counters and resource behavior instead.
