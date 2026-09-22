import {
  createEvaluationContext,
  createRational,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import { BinaryBlock } from "../dist/core/math/binary-block.js";
import { intervalToRoundedBall } from "../dist/core/math/elementary.js";
import { routedSmallExp } from "../dist/core/math/exp-router.js";
import { scaledIntervalToRationalBounds } from "../dist/core/math/scaled-interval.js";
import { FactorialRecurrenceE } from "../dist/core/math/constants.js";

// Experimental exact affine recurrence N_k = k N_(k-1) + 1.
// A block represents N -> q*N+t; composition is associative.
export class BinaryFactorialE {
  n = 0;
  numerator = 1n;
  denominator = 1n;
  job = null;
  blocks = 0;
  getInterval(digits, control) {
    const target = 2n * 10n ** BigInt(digits);
    while (this.job !== null || this.denominator * BigInt(this.n + 1) < target) {
      if (this.job === null) {
        let end = this.n + 1;
        let estimate = 0;
        // Only a scheduling heuristic: termination uses exact factorial bounds.
        for (let k = 2; k <= this.n + 1; k++) estimate += Math.log10(k);
        while (estimate < digits + 1) {
          end++;
          estimate += Math.log10(end);
        }
        this.job = { end, tree: new BinaryBlock(this.n + 1, end + 1) };
      }
      const { end, tree } = this.job;
      const pair = tree.run(
        control,
        (k) => ({ q: BigInt(k), t: 1n }),
        (a, b) => ({ q: a.q * b.q, t: a.t * b.q + b.t })
      );
      this.numerator = this.numerator * pair.q + pair.t;
      this.denominator *= pair.q;
      this.n = end;
      this.blocks++;
      this.job = null;
    }
    // After k=0..n, the positive remainder is <= 2/(n+1)!.
    const denominator = this.denominator * BigInt(this.n + 1);
    const numerator = this.numerator * BigInt(this.n + 1);
    return {
      lower: createRational(numerator, denominator),
      upper: createRational(numerator + 2n, denominator)
    };
  }
}

export function experimentalECandidate(family) {
  return {
    family,
    create(input, counters) {
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      const factorial = new BinaryFactorialE();
      return {
        refine(digits) {
          const bounds =
            family === "factorial-binary"
              ? factorial.getInterval(digits + 8, context)
              : scaledIntervalToRationalBounds(
                  routedSmallExp(createRational(1n, 1n), digits + 8, context)
                );
          const bits = Math.max(64, Math.ceil((digits + 8) * Math.log2(10)) + 64);
          const ball = intervalToRoundedBall(bounds, bits, context.backend);
          // Production e proves the requested prefix inside refine, too.
          const verified = verifiedNumberFromBall(
            ball,
            { significantDigits: digits },
            context.backend
          );
          if (verified.verifiedDigits < digits)
            throw new Error("Insufficient experimental e precision");
          return ball;
        },
        verify(ball, digits) {
          return verifiedNumberFromBall(ball, { significantDigits: digits }, context.backend);
        },
        snapshot() {
          return family === "factorial-binary"
            ? {
                termCount: factorial.n + 1,
                blockCount: factorial.blocks,
                retainedBigIntDigits:
                  factorial.numerator.toString().length + factorial.denominator.toString().length
              }
            : {};
        }
      };
    }
  };
}
export const cases = [
  {
    name: "e",
    input: { source: "e" },
    candidates: [
      {
        family: "factorial-recurrence",
        create(input, counters) {
          const context = createEvaluationContext({
            checkpoint() {
              counters.add("checkpointCount");
            }
          });
          const provider = new FactorialRecurrenceE();
          return {
            refine(significantDigits) {
              return provider.refine({ significantDigits }, context);
            },
            verify(ball, significantDigits) {
              return verifiedNumberFromBall(ball, { significantDigits }, context.backend);
            },
            snapshot() {
              const state = provider.getStateSnapshot();
              return {
                termCount: state.completedTerms,
                peakBigIntDigits: state.peakBigIntDigits,
                retainedBigIntDigits: state.cachedBigIntDigits
              };
            }
          };
        }
      },
      experimentalECandidate("factorial-binary"),
      experimentalECandidate("exp-one-kernel")
    ]
  }
];
