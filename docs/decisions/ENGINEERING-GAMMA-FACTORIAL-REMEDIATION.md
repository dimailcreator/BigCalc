# Engineering decision: stage 32 Gamma/factorial remediation

## Scope

Stage 32 keeps the adaptive Stirling expansion introduced earlier. It adds cost routing
for the half-integer specialization, replaces linear exact factorial multiplication,
removes repeated Rational normalization from Bernoulli generation, and makes recurrence
product size observable.

## Half-integer routing

An exact point is classified as a half-integer without iterating toward `1/2`. The planner
computes the recurrence distance as a `bigint` and compares its estimated work with both a
precision-dependent recurrence budget and the general Stirling/reflection cost.

Small cases such as `Gamma(3/2)` retain the exact rational multiplier of `sqrt(pi)`. Cases
such as `Gamma(10^9+1/2)` and `Gamma(-10^9+1/2)` select the general route immediately;
their billion-step recurrence is never entered. Before a huge positive Gamma value can be
materialized, the lifecycle receives a conservative result-size estimate and may return a
typed hard memory failure. Negative huge half-integers use reflection before any shift is
converted to a JavaScript loop bound.

## Exact factorial

Exact factorial uses a balanced range-product tree with an explicit mutable traversal
stack. Leaves and internal products are checkpointed. A checkpoint exception leaves the
current phase unchanged, so `continue` resumes completed subtrees rather than rebuilding
them.

The preflight bound uses `n! <= n^n` and checks the resulting decimal-digit estimate
against `maxEstimatedBigIntDigits`. Small values use the same exact path without changing
their semantics.

## Bernoulli cache

The prior recurrence built every Bernoulli number as a balanced sum of many Rational
terms, repeatedly invoking gcd normalization on rapidly growing numerators and
denominators. The replacement generates exact tangent numbers with an integer convolution:

```text
T_n = sum C(2n-2, 2k-1) T_k T_(n-k)
B_(2n) = (-1)^(n-1) n T_n / (2^(2n-1) (2^(2n)-1))
```

Only the final Bernoulli coefficient is normalized as a Rational. The pending convolution
order, index, binomial coefficient, and sum are retained, making cache extension resumable.
Snapshot counters expose convolution products, checkpoints, retained bigint digits, and
the pending frontier. The algorithm remains exact and feeds the same adaptive Stirling
series and remainder proof.

## Recurrence product

The existing balanced interval product remains appropriate. Its profile now records tree
depth, largest bigint component, and peak retained bigint digits across tree levels. The
measured retained size is small compared with Bernoulli state at the tested high-precision
case, so a new log-domain accumulation path would add proof complexity without addressing
the current bottleneck.

## Local profile

Measurements on the reference Node.js backend in a fresh process:

| Operation                        |               Time | Structural result                                                           |
| -------------------------------- | -----------------: | --------------------------------------------------------------------------- |
| Bernoulli through 64 corrections |              29 ms | 2,080 new integer convolutions; 8,919 retained digits                       |
| Bernoulli 64 -> 128 corrections  |              52 ms | 6,176 new integer convolutions; 43,764 retained digits                      |
| Bernoulli 128 -> 257 corrections |             352 ms | 24,897 new integer convolutions; 212,114 retained digits                    |
| `10000!`                         | local profile only | depth 15; 9,998 products; 19,997 checkpoint sites; 35,660 result digits     |
| `Gamma(4/3)`, 300 digits         |             259 ms | 315 factors; depth 9; peak component 803 digits; peak retained 2,452 digits |

For the recurrence product, 2,452 simultaneously retained decimal digits correspond to
about 1.0 KiB of bigint numeric payload (excluding runtime object overhead); this is the
portable memory proxy recorded by the core profile.

The 257-correction production regression completed in about 0.4 seconds and its returned
interval contained the exact 156-digit integer `99!`. The half-integer planner estimates
one billion recurrence steps at 30,000,000,000 work units versus 2,000 general-route units
for a 20-digit request and selects the general route.

Timing and process-memory observations are diagnostic, not pass/fail thresholds. Tests
assert exactness, containment, structural counters, resumability, and typed lifecycle
outcomes.
