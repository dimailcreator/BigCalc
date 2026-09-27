# Stage 29: exact logarithm and power compositions

## Diagnosis before the fix

The public calculation for `e^ln(2)` at 20 significant digits entered the generic positive-real power route: refine `e` and `ln(2)`, evaluate `ln(e)`, multiply the intervals, then evaluate `exp`. A diagnostic run with a fixed clock and a 100,000-checkpoint hard watchdog ended in `ResourceLimitError` (`resource: hard-watchdog`) at checkpoint 100,001. The power node had requested 5,632 digits from each child while its own request was only 20 digits. Immediately before failure the last bigint resource estimate was 93,569 decimal digits; the peak estimate was 600,662. The latest `ln` route was binary at 5,659 working digits, and the latest `exp` route was rectangular at 2,836 working digits.

At 28 operand digits, the resulting interval for `e^ln(2)` had a lower bound below 2 and an upper bound above 2. Its verified digit count was zero. The exact result lies on a decimal leading-digit boundary, so arbitrarily refining this generic interval cannot prove a common prefix. A hard resource failure is terminal in `DefaultCalculationHandle`; `continue()` returns the stored failure.

The same 20-digit audit with a 20,000-checkpoint cap also reached the hard watchdog for `e^ln(10)`, `ln(e)`, and `10^log(2)`. `e^ln(-2)` returned `DomainError`.

## Decision

The graph uses local, mathematically exact routes for `ln(e) = 1`, `e^0 = 1`, `e^1 = e`, `e^ln(x) = x` when `x` evaluates to a positive exact rational, and `b^log_b(x) = x` when both bases match as exact rationals and `x` is a positive exact rational. Both operands are evaluated before the power identity is considered; logarithm domain checks remain authoritative. Other powers retain the existing approximate route. No hard limit or precision cutoff changed.

The Stage 29 regression suite covers the full composition matrix at 18, 100, and 1,000 digits; logarithm domains and child errors; and pause/continue on the same lazy `e^1` state. The existing hard-resource and algorithm-routing tests remain in the Core suite.
