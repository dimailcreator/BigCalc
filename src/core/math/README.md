# Math

Arithmetic, powers, factorial/Gamma, trigonometric functions, logarithms, exp, and constants live here.

Fundamental high-precision infrastructure is context-scoped: `π` retains compact
Chudnovsky binary-splitting levels, derives its tail coefficient from those levels, and
continues a rigorous cached `sqrt(10005)` interval. `ln(2)` uses a reusable rigorous series
state, and decimal fixed-point interval operations provide outward-rounded multiplication,
squaring, division, and rescaling without exposing backend types.

`exp` reconstructs reduced arguments with fixed-scale outward squaring, while `ln` selects
its binary scale directly and reuses the context-scoped `ln(2)` cache. Their guard precision
grows with the decimal digit count of the amplification factor, not linearly with the binary
scale. Small rational logarithms also have a bounded exact fractional-exponent path.

Trigonometric evaluation uses one canonical reduction to `[-π/4, π/4]` and a joint
fixed-point `sincos` kernel with outward rounding. Standalone `sin`/`cos` select only the
base series required after quadrant mapping, while `tan` forms a monotone endpoint hull on
each proven pole-free branch. Degree inputs are reduced exactly modulo their period before
requesting the shared `π`; cheap rational multiples of `π` have local structural fast paths.

Rational fractional powers use a rigorous, resumable fixed-point `nthRoot` primitive when
the precision-dependent cost model selects it; general real powers retain the `ln`/`exp`
path. Gamma uses precision-parametric adaptive Stirling corrections, an incremental exact
Bernoulli cache, reusable fixed-point inverse powers, and balanced recurrence products.
