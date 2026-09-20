import {
  createEvaluationContext,
  createRational,
  createBall,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import {
  expSmallNonNegativeScaledInterval,
  reduceExpIntervalByLn2,
  intervalToRoundedBall,
  expIntervalBallWithProfile
} from "../dist/core/math/elementary.js";
import { scaledIntervalToRationalBounds } from "../dist/core/math/scaled-interval.js";

function candidate(family) {
  return {
    family,
    create(input, counters) {
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      const value = createRational(BigInt(input), 1n),
        argument = { lower: value, upper: value };
      return {
        refine(digits) {
          const bits = 4 * digits + 128;
          if (family === "router") {
            const result = expIntervalBallWithProfile(
              argument,
              digits + 12,
              bits,
              context.backend,
              context
            );
            if (result.ball === null) throw new Error("Point exp reduction failed");
            return result.ball;
          }
          const reduction = reduceExpIntervalByLn2(argument, digits + 12, context);
          if (reduction === null) throw new Error("Point exp reduction failed");
          const lower = expSmallNonNegativeScaledInterval(
            reduction.remainder.lower,
            digits + 22,
            context
          );
          const upper = expSmallNonNegativeScaledInterval(
            reduction.remainder.upper,
            digits + 22,
            context
          );
          const mantissa = intervalToRoundedBall(
            {
              lower: scaledIntervalToRationalBounds(lower).lower,
              upper: scaledIntervalToRationalBounds(upper).upper
            },
            bits,
            context.backend
          );
          return createBall(
            context.backend.scaleByPowerOfTwo(mantissa.center, reduction.binaryExponent),
            context.backend.scaleByPowerOfTwo(mantissa.radius, reduction.binaryExponent)
          );
        },
        verify(ball, digits) {
          return verifiedNumberFromBall(ball, { significantDigits: digits }, context.backend);
        },
        snapshot() {
          return {};
        }
      };
    }
  };
}
export const cases = ["0", "1", "-1", "1024", "-1024", "1000000", "-1000000"].map((input) => ({
  name: `exp(${input})`,
  input,
  candidates: ["legacy", "router"].map(candidate)
}));
