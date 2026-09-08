# Math

Arithmetic, powers, factorial/Gamma, trigonometric functions, logarithms, exp, and constants live here.

Fundamental high-precision infrastructure is context-scoped: `π` retains compact
Chudnovsky binary-splitting levels, derives its tail coefficient from those levels, and
continues a rigorous cached `sqrt(10005)` interval. The `ln(2)` provider keeps a compact
recurrence frontier instead of a quadratic collection of growing denominators. Decimal
fixed-point interval operations provide outward-rounded multiplication, squaring, division,
and rescaling without exposing backend types.

The production `exp` path reduces `x = k*ln(2) + r`, evaluates the existing small series at
`r`, and applies `2^k` through the backend binary exponent without growing the mantissa.
`ln` selects its binary scale directly and reuses the context-scoped `ln(2)` cache. Exact
integer logarithms derive a small candidate set from bigint magnitude and verify candidates
with exact rational powers, without a fixed exponent ceiling. Small rational logarithms keep
their bounded exact fractional-exponent path.

Trigonometric evaluation uses one canonical reduction to `[-π/4, π/4]` and a joint
fixed-point `sincos` kernel with outward rounding. Standalone `sin`/`cos` select only the
base series required after quadrant mapping, while `tan` forms a monotone endpoint hull on
each proven pole-free branch. Degree inputs are reduced exactly modulo their period before
requesting the shared `π`; their approximate refinement is not limited by the add/sub
precision cutoff. Cheap rational multiples of `π` have local structural fast paths closed
under addition and subtraction of already-recognized coefficients, without general symbolic
simplification.

Rational fractional powers use a rigorous, resumable fixed-point `nthRoot` primitive when
the precision-dependent cost model selects it; general real powers retain the `ln`/`exp`
path. Gamma uses precision-parametric adaptive Stirling corrections, an incremental exact
Bernoulli cache, reusable fixed-point inverse powers, and balanced recurrence products.

Exact integer roots use a bit-length bound, integer Newton iteration, and bounded
exponentiation-by-squaring checks. The direct decimal `nthRoot` planner accounts for its
`N*q` representation, peak bigint size, expected Newton work, and `ln`/`exp` fallback cost;
large degrees therefore fall back before a pathological scaled integer is allocated.
Exact integer powers use resumable exponentiation by squaring with checkpoint and preflight
size guards supplied by the calculation lifecycle.

Exact factorials use a resumable balanced range-product tree. Their result-size preflight
and per-leaf/per-product checkpoints share the same lifecycle resource policy.

Half-integer Gamma recurrence is cost-gated before iteration; huge distances use the
general Stirling/reflection route. Bernoulli coefficients are derived from a resumable
integer tangent-number cache, avoiding repeated Rational normalization while preserving
the adaptive Stirling expansion. Balanced Gamma recurrence products report peak component
and retained bigint sizes for resource profiling.
