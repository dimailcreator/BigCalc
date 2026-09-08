# Engineering decision: stage 34 exact-log resource remediation

## Scope

Stage 34 changes only the exact rational logarithm fast path. The interval algorithms for
`exp`, `ln`, and general `log_b(x) = ln(x) / ln(b)` remain unchanged.

## Resource-aware candidate comparison

Integer logarithm candidates are no longer checked by constructing `base^p` through an
uncontrolled `powRational` call. The exact-log path now receives the evaluation control and
uses a bounded rational exponentiation-by-squaring comparison.

Before every multiplication the algorithm:

- invokes a cooperative checkpoint;
- estimates the largest bigint product and invokes `guardBigIntDigits`;
- compares the pending product with the exact argument;
- stops immediately when the candidate power is proven greater than the argument.

The comparison remains exact. A matching candidate still returns an exact `Rational`, and
there is no exponent ceiling.

## Resumable ownership

Each `LogEvaluationNode` owns an `ExactLogRationalState`. It records the current candidate,
the exponentiation phase, remaining exponent bits, accumulated result and factor, and the
fractional-candidate frontier. A checkpoint exception occurs before mutation, so a soft
timeout preserves the frontier and `continue()` resumes it.

The same checkpoints observe cancellation. The lifecycle memory guard is consulted before
candidate comparison products are allocated, producing a typed `ResourceLimitError` when
the configured policy rejects the work.

## Observability

The exact-log profile records candidate checks, early-aborted checks, multiplication count,
and peak materialized power-component digits. Regression coverage verifies that a candidate
adjacent to a 4096-bit power is rejected without materializing that full power.
