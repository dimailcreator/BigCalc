# Engineering note: precision-parametric Gamma

## Decision

Stage 27 keeps Stirling's log-Gamma expansion instead of introducing Spouge. The production
path is now precision-parametric: the shift target is derived from requested decimal precision,
the correction loop has no term ceiling, and it stops only after its rigorous next-term bound
is below the requested threshold.

## Error bound

For real `z > 0`, after `m` Stirling corrections the remainder has the sign of the first
omitted term and magnitude no greater than

```text
|B_(2m+2)| / ((2m+2)(2m+1) z^(2m+1)).
```

The implementation evaluates that omitted term with outward fixed-point intervals. Its upper
magnitude is added explicitly to the returned log-Gamma interval. Rounding from coefficient,
power, multiplication, and summation operations is already present in those intervals.

The shift target is at least `requestedDigits + 16`. Bernoulli coefficients are generated
incrementally and cached exactly; odd coefficients after `B1` are skipped. Powers reuse one
outward interval for `z^-2`. The loop has no fixed maximum: lifecycle checkpoints, rather than
a mathematical term cap, enforce resource policy.

Recurrence factors are combined by a balanced product tree before taking their logarithm.
For negative intervals, a cost model compares direct and reflected recurrence counts and uses
`Γ(x) = π / (sin(πx) Γ(1-x))` only when its estimated overhead is lower.
Half-integer `sqrt(π)` uses the rigorous `nthRoot` primitive, and the existing shared `π`,
`ln(2)`, `ln`, and `exp` implementations remain the only corresponding providers.

## Local benchmark

Reference-backend measurements on the development Windows/Node environment after this change:

```text
(1/3)! at 100 verified digits: about 50 ms
(1/3)! at 300 verified digits: about 240 ms
```

These numbers are diagnostic rather than performance guarantees. Correct outward containment
and the absence of a precision ceiling remain the acceptance criteria.
