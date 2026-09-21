import {
  createEvaluationContext,
  createRational,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import {
  gammaRealBallWithProfile,
  getBernoulliCacheSnapshot
} from "../dist/core/math/elementary.js";
import { getStirlingCorrectionSnapshot } from "../dist/core/math/stirling-correction.js";

function candidate(family) {
  return {
    family,
    create(input, counters) {
      const x = createRational(BigInt(input.numerator), BigInt(input.denominator));
      let profile;
      let terms = 0;
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      return {
        refine(digits) {
          const before = getStirlingCorrectionSnapshot(context);
          const result = gammaRealBallWithProfile(
            { lower: x, upper: x },
            digits + 12,
            4 * digits + 256,
            context.backend,
            context,
            family === "legacy"
              ? { stirlingStrategy: "legacy" }
              : family === "power-only"
                ? { stirlingStrategy: "legacy", correctionLayout: "recurrence" }
                : family.startsWith("shift-")
                  ? {
                      stirlingStrategy: "fixed",
                      minimumShiftTarget: Math.ceil(Number(family.slice(6)) * (digits + 12)) + 16
                    }
                  : {}
          );
          profile = result.profile;
          const cached = before.states.some((s) => s.done && s.workingDigits === digits + 44);
          terms += cached ? 0 : profile.correctionTerms;
          return result.ball;
        },
        verify(ball, digits) {
          if (ball === null) throw new Error("Gamma dependency unresolved");
          return verifiedNumberFromBall(ball, { significantDigits: digits }, context.backend);
        },
        snapshot() {
          const bernoulli = getBernoulliCacheSnapshot(context);
          const correction = getStirlingCorrectionSnapshot(context);
          return {
            workingDigits:
              correction.entries > 0
                ? Math.max(...correction.states.map((s) => s.workingDigits))
                : 2 * (profile?.workingDigits ?? 0) + 48,
            termCount: terms,
            retainedBigIntDigits: bernoulli.retainedBigIntDigits + correction.retainedBigIntDigits,
            // The resource guard estimates total live storage, not the largest
            // individual integer. Do not mislabel that estimate as a peak.
            peakBigIntDigits: null
          };
        }
      };
    }
  };
}
export const cases = [
  { name: "third-factorial", numerator: "4", denominator: "3" },
  { name: "negative-third-factorial", numerator: "-1", denominator: "3" },
  { name: "reflection", numerator: "-1000", denominator: "3" },
  { name: "large-half-integer", numerator: "20001", denominator: "2" }
].map((input) => ({
  name: input.name,
  input,
  candidates: [
    "legacy",
    "power-only",
    "adaptive",
    "shift-1",
    "shift-1.5",
    "shift-2",
    "shift-3",
    "shift-4"
  ].map(candidate)
}));
