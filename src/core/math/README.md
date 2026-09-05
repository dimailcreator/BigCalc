# Math

Arithmetic, powers, factorial/Gamma, trigonometric functions, logarithms, exp, and constants live here.

Fundamental high-precision infrastructure is context-scoped: `π` uses cached Chudnovsky
binary-splitting blocks, `ln(2)` uses a reusable rigorous series state, and decimal
fixed-point interval operations provide outward-rounded multiplication, squaring, division,
and rescaling without exposing backend types.

`exp` reconstructs reduced arguments with fixed-scale outward squaring, while `ln` selects
its binary scale directly and reuses the context-scoped `ln(2)` cache. Their guard precision
grows with the decimal digit count of the amplification factor, not linearly with the binary
scale. Small rational logarithms also have a bounded exact fractional-exponent path.

Trigonometric evaluation uses one canonical reduction to `[-π/4, π/4]` and a joint
fixed-point `sincos` series with outward rounding. `tan` consumes that shared result and
checks reducer pole metadata before starting the series. Degree conversion passes the same
cached `π` interval into reduction.
