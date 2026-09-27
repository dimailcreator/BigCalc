# Stage 30: expression-valued iteration

Iteration brackets now contain a normal BigCalc expression AST. The parser checks syntax and the evaluator checks the value after the calculation starts. The value must be an exact `Rational` with denominator 1 and numerator at least 0. Therefore syntactically valid but invalid iteration values now report `InvalidIterationError` during refinement; mathematical failures inside the expression retain their original typed errors.

An iteration graph node holds the expression and argument without expanding the function chain at creation. It evaluates the count, checks the planned node count, then constructs at most 512 function or log nodes. The 512-node cap is a hard graph-memory guard, not a precision limit. Partial expansion is retained across soft timeout and `continue()`. The existing `[0]` identity avoids evaluating the function or logarithm base.

The same path handles ordinary functions and iterated `log`. The direct internal `createLogNode` route also checks the node cap. The public error type remains `InvalidIterationError`; the planned public version update belongs to Stage 33.
