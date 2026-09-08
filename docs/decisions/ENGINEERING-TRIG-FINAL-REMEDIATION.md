# Engineering decision: stage 33 trigonometry final remediation

## Scope

Stage 33 removes an incorrect precision ceiling from approximate degree trigonometry and
extends the existing local structural recognizer for rational multiples of `π`. It does
not change the fixed-point trigonometric algorithms or introduce general symbolic
simplification.

## Degree precision

Degree conversion and range reduction remain part of the ordinary demand-driven interval
path. Their result is now passed directly to verified-digit analysis. The
`precisionCutoffDigits` setting is not consulted by `sin`, `cos`, or `tan`; precision
cutoff remains attached to the addition and subtraction nodes where the specification
defines it.

Exact rational degree fast paths, including quadrant values and tangent poles, are
unchanged. Regression coverage uses a cutoff of 20 with 50 requested digits for all three
functions and also performs a 3001-digit degree-sine request with the production cutoff of 3000.

## Rational multiples of pi

The recognizer now combines two operands only when each is already structurally proven to
be a rational multiple of the built-in `π`:

```text
a*π + b*π -> (a+b)*π
a*π - b*π -> (a-b)*π
```

An independently exact rational zero may be discarded as a neutral term. No nonzero
non-`π` expression is folded. Consequently composite exact tangent poles are rejected by
the typed `DomainError` path without interval refinement, while expressions with a
nonzero near-pole offset continue through adaptive interval evaluation.
