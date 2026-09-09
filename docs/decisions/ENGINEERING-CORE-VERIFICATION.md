# Engineering verification: stage 36

## Scope

Stage 36 adds a single end-to-end verification layer over the mathematical core stabilized
in stages 23–35. It does not change mathematical semantics or freeze the public API.

## End-to-end matrix

The stage suite covers:

- parser to immutable AST to exact `Rational` evaluation with arithmetic, precedence,
  postfix operators, implicit multiplication, exact powers, factorial modes, iterations,
  logarithm forms, and degree fast paths;
- parser to lazy graph to verified digits for `π`, `e`, `abs`, trigonometry, `exp`, `ln`,
  default and expression-base logarithms, powers, and Gamma;
- containment of independently tabulated high-precision decimal reference points in the
  returned Balls;
- one graph refined through `10 → 20 → 50 → 100 → 300 → 1000` digits, plus parameterized
  1200- and 1500-digit requests within the test resource budget;
- division, logarithm, tangent, negative-base power, and Gamma domain boundaries;
- a deliberately reduced cutoff proving that cutoff is not a global precision ceiling for
  approximate built-ins;
- soft timeout, continuation with retained graph state, cancellation, hard resource failure,
  and serializable Worker transport DTOs on real expression graphs.

## Remediation regression inventory

The full runner retains every focused regression group introduced before this audit:

| Concern                                                                      | Regression suites                                                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| π ownership, reuse, tail proof, and shared trig/Gamma provider               | `correctness-stabilization`, `high-precision-infrastructure`, `constant-state-scaling`                |
| e term growth and retained state                                             | `constants`, `constant-state-scaling`                                                                 |
| quadrant signs, exact degree reduction, denominator growth, and tan work     | `scalable-trig`, `trig-post-stabilization`, `trig-final-remediation`                                  |
| exponent-aware exp, large-scale ln, ln2 reuse, and near-one log              | `scalable-exp-ln-log`, `exp-ln-log-remediation`                                                       |
| rational roots, numerator/result power cost, and compact huge powers         | `precision-parametric-powers-gamma`, `power-nth-root-remediation`, `power-gamma-resource-remediation` |
| adaptive Gamma beyond 256 terms, compact reflection, and Bernoulli resources | `gamma-factorial-remediation`, `power-gamma-resource-remediation`                                     |
| cooperative exact-log lifecycle and resource bounds                          | `exact-log-resource-remediation`                                                                      |

## Result

The end-to-end suite and all focused suites pass without a known violation of the ten core
invariants. Stage 37 remains responsible for measurement-driven global scaling and profile
optimization; it is not required to reinterpret any stage 36 correctness result.
