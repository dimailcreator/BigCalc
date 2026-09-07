# Engineering note: trigonometry post-stabilization

## Scope

Stage 29 keeps the stage-26 Taylor kernels and canonical radian reduction. It changes when
arguments are reduced and which existing series are evaluated.

Degree arguments are translated by an exact integer multiple of their function period
(`360` for `sin`/`cos`, `180` for `tan`) before multiplication by the shared `π` interval.
The translation is exact for every Rational interval and therefore preserves the function
image without adding an error term.

After radian quadrant selection, standalone `sin` and `cos` request only the base series
needed after `swapSinCos`. `tan` evaluates both series at the exact endpoints of every
proven pole-free reduced interval and uses monotonicity to form the hull. A point interval
keeps the former joint-series interval division as the cheaper fallback. Pole metadata is
checked before either path.

A deliberately local graph recognizer handles only Rational scalings and divisions of the
built-in `π` node. It proves the integer and half-integer cases needed for exact zeros,
unit values, and tangent poles; it is not a symbolic rewrite system.

## Local profiling

Measurements used Node on the development Windows environment. They are diagnostic and
are not timing assertions.

| Case                                 |    Time | Range reductions | Point evaluations | sin series | cos series | `π` working digits |
| ------------------------------------ | ------: | ---------------: | ----------------: | ---------: | ---------: | -----------------: |
| `sin((360*10^100000+1)°)`, 50 digits |  108 ms |                1 |                 2 |          2 |          0 |                 72 |
| standalone `sin(1)`, 100 digits      |       — |                1 |                 2 |          0 |          2 |                122 |
| standalone `cos(1)`, 100 digits      |       — |                1 |                 2 |          2 |          0 |    122 (cache hit) |
| `tan([0.1,0.2])`, 100 digits         | 14.4 ms |                1 |                 2 |          2 |          2 |                122 |

The huge degree input had `degreeOriginalMagnitudeDigits = 100003`, reduced magnitude one,
and requested only 64 digits from the `π` API (72 provider working digits including its
guard). The observed peak bigint size was 100003 digits—the input itself—while trigonometric
fixed-point state stayed at 50 digits. For `tan(π/2 + 10^-20)` at 10 requested digits, the
graph made four child-precision requests before proving the pole-free side and completed in
about 87 ms. Exact `tan(π/2)` is rejected structurally without a refinement retry.
