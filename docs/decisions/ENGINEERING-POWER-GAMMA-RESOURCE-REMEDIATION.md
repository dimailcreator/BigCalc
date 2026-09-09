# Engineering decision: stage 35 exponent-aware power and Gamma resources

## Scope

Stage 35 removes result-magnitude allocation from approximate rational powers and Gamma.
Exact integer powers and exact integer factorials keep their complete `bigint` results and
their existing output-size guards.

## Approximate powers

The direct `nthRoot` planner now includes the rational numerator and a conservative final
result-magnitude estimate. A small denominator no longer makes the direct route eligible
when the subsequent integer power or expanded result would dominate the requested
precision.

The general positive-base route evaluates `exp(y * ln(x))` through `expIntervalBall`.
Consequently, values such as `2^(1000000+1/2)` retain a precision-sized significand and a
large backend binary exponent. Negative powers use the same route without first forming a
huge positive decimal Rational. For a negative rational base and an odd-denominator
rational exponent, the magnitude remains on this compact route and numerator parity is
applied as a separate sign operation.

## Gamma and reflection

The production Gamma graph now returns a `Ball` directly. Adaptive Stirling and recurrence
still prove an interval for `logGamma`, but its final exponential uses
`expIntervalBall`. The old guard based on the number of digits in an expanded Gamma result
was removed; lifecycle guards continue to cover actual intermediate Rational and bigint
work.

Reflection keeps the reflected Gamma value compact. Its final multiplication and division
operate on outward-rounded backend intervals and construct a Ball without converting a
large binary exponent to a Rational numerator or denominator.

## Bernoulli ownership and resources

Bernoulli and tangent-number state is held in a `WeakMap` keyed by the evaluation context.
Independent calculation contexts therefore start with independent coefficient frontiers,
while pause, cancellation, or a permitted retry on the same owner retains its exact pending
convolution state.

Cache expansion checkpoints before mutation and calls the owner's `guardBigIntDigits`
hook for retained coefficient digits, pending convolution products, and the new Bernoulli
coefficient. A typed hard resource failure leaves a consistent frontier which can be
continued if the same owner is later given sufficient resources.

## Verification

Regression coverage checks compact significands for huge positive and negative powers,
odd-denominator negative-base semantics, monotonic verified prefixes and independent
reciprocal containment. Direct and reflected Gamma are tested with decimal exponents much
larger than their significands. Bernoulli tests cover owner isolation, typed resource
failure, and continuation from the retained frontier.
