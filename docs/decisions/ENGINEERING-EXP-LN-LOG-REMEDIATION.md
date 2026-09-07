# Engineering decision: stage 30 exp/ln/log remediation

## Scope

Stage 30 keeps the existing small `exp` factorial series, `ln` atanh-series, and
`log_b(x) = ln(x) / ln(b)`. The changes are limited to reconstruction, cache state,
and local exact paths.

## `exp` representation

The production graph path now proves an integer `k` from a rigorous `ln(2)` interval:

```text
x = k ln(2) + r
exp(x) = 2^k exp(r),  0 <= r < ln(2)
```

Only `exp(r)` is evaluated in decimal fixed-point. The resulting ball's center and
radius are scaled with `BigFloatBackend.scaleByPowerOfTwo`, so `k` changes the internal
binary exponent without extending the significand. If a non-point argument interval
does not yet prove one `k`, the graph refines the operand.

The reference backend performs dyadic `add`, `sub`, `mul`, `compare`, and exponent
scaling directly on `(significand, exponent)`. This prevents ball-bound extraction from
undoing the representation improvement. Verified-number extraction also has a direct
large-binary-exponent route and constructs only the powers required to prove the leading
decimal prefix.

## `ln(2)` state

The atanh series is unchanged. The provider retains only the convergence frontier
(`completedTerms` and the next power of nine), rather than every growing denominator.
A higher-precision request extends that frontier and renders the same series at the new
fixed-point scale; a lower request remains a cache hit. Snapshot counters expose retained
state size and distinguish added terms from summation passes.

## Exact logarithms

The former `|p| <= 512` search was removed. For an integer exact logarithm, the numerator
magnitudes provide an approximate exponent and at most seven nearby candidates. Each
candidate is accepted only after an exact `Rational` power equality check. The existing
small fractional-log path uses the same unbounded integer search.

The shared-node `log_x(x) = 1` path remains after, not before, proof of `x > 0` and
`x != 1`.

## Local profile

Measurements on the reference Node.js backend, requesting 30 verified digits:

| Case           |   Time | Significand | Internal exponent | Decimal exponent |    Graph retries |
| -------------- | -----: | ----------: | ----------------: | ---------------: | ---------------: |
| `exp(1024)`    |  10 ms |    111 bits |              1367 |              444 |                0 |
| `exp(-1024)`   |   4 ms |    111 bits |             -1588 |             -445 |                0 |
| `exp(10^6)`    | 550 ms |    144 bits |           1442552 |           434294 |                0 |
| `exp(-10^6)`   | 581 ms |    144 bits |          -1442839 |          -434295 |                0 |
| near-one `log` |   9 ms |    217 bits |              -151 |               19 | 4 child requests |

At 500 requested `ln(2)` digits the provider completed 523 terms, retained zero per-term
denominators and one recurrence-state bigint, and reported 2509 cached bigint decimal
digits. `log2(2^100000)` used seven candidates, four exact checks, and completed in about
1 ms after constructing the exact argument.
