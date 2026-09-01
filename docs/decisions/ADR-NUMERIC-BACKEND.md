# ADR: Numeric Backend

## Status

Accepted for Stage 5.

## Context

BigCalc needs an internal arbitrary-precision binary floating-point backend that can produce directed-rounded lower and upper bounds for ball arithmetic. The backend must not expose third-party numeric objects through Core public types.

Relevant Core requirements:

- finite `InternalFloat` with `sign`, `significand`, `exponent`, and `precisionBits`;
- arbitrary precision;
- exponent range not limited by JavaScript `number`;
- canonical zero;
- no `NaN`, `Infinity`, or negative zero as Core values;
- rounding modes `nearest`, `towardNegativeInfinity`, and `towardPositiveInfinity`;
- compatibility with non-DOM execution and future Worker transport.

## Decision

Use GNU MPFR semantics as the production numeric backend target, compiled to WebAssembly with GMP as its integer dependency, hidden behind `BigFloatBackend`.

Stage 5 adds a Core-owned `BigFloatBackend` contract and a deterministic reference backend implemented with exact `Rational` arithmetic. The reference backend is not the intended performance backend. It exists to pin down BigCalc's adapter semantics, provide conformance tests, and prove the path to lower/upper directed-rounded bounds before ball arithmetic is implemented.

## Directed Rounding

MPFR is selected because its public contract is arbitrary-precision floating-point arithmetic with correct rounding. Its rounding modes include round toward negative infinity and round toward positive infinity. These map directly to BigCalc interval endpoints:

- lower bound: `towardNegativeInfinity`;
- upper bound: `towardPositiveInfinity`;
- display/center approximations may use `nearest` where the later ball layer accounts for error.

The Stage 5 reference backend implements the same three modes by computing the exact rational value first, then selecting the representable binary value at the requested precision. This gives a testable, backend-independent oracle for basic operations.

## Build And Worker Usage

The production adapter will instantiate an MPFR/GMP WebAssembly module behind an internal factory. It must not require DOM, HTML, CSS, or UI-thread-only APIs. The same adapter boundary is suitable for Node tests, browser main thread execution, and future Worker transport, because `BigFloatBackend` accepts and returns only serializable BigCalc-owned structures.

The WebAssembly artifact should be built reproducibly from pinned MPFR, GMP, and compiler versions. The wrapper must translate MPFR values into `InternalFloat`; MPFR object handles and heap pointers must remain private to the adapter.

## License

GNU MPFR is LGPL-licensed. GMP is also LGPL/GPL dual-licensed. The production WASM packaging must preserve the required license notices and keep the dependency isolated enough that replacing or relinking the backend remains practical.

## Rejected Alternatives

### decimal.js / big.js / bignumber.js

Rejected for the production backend. They are decimal-oriented JavaScript libraries and do not provide the binary directed-rounding contract BigCalc needs for lower/upper ball bounds.

### Native JavaScript number / BigInt Scaling

Rejected as the production backend. `number` cannot represent arbitrary precision or huge exponents safely. A pure `BigInt` rational backend is useful as a reference oracle, but it is not a practical long-term approximate backend for transcendental functions.

### Unspecified "Many Digits" Libraries

Rejected categorically. A backend that only returns many decimal digits without directed rounding or a strictly proven error bound cannot support verified digits.

## Consequences

- Core code depends on `BigFloatBackend`, not MPFR types.
- Stage 6 ball arithmetic can request lower and upper endpoints with explicit rounding modes.
- The reference backend is slower than MPFR/WASM but suitable for Stage 5 conformance and small exact tests.
- Production integration still needs a concrete pinned MPFR/WASM build step before performance-sensitive math functions.

## Sources

- GNU MPFR documentation: https://www.mpfr.org/
- GNU MPFR manual, rounding modes: https://www.mpfr.org/mpfr-current/mpfr.html
- GNU MPFR license information: https://www.mpfr.org/mpfr-current/mpfr.html#Copying
- GNU MPFR FAQ on GMP dependency: https://www.mpfr.org/faq.html
- GNU GMP documentation and license summary: https://gmplib.org/
- Emscripten WebAssembly documentation: https://emscripten.org/docs/compiling/WebAssembly.html
