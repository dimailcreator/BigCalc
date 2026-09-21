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
import { getSpecialGammaSnapshot } from "../dist/core/math/gamma-special.js";
import { getSpougeSnapshot } from "../dist/core/math/gamma-spouge.js";

export function gammaCandidate(family) {
  return {
    family,
    create(input, counters) {
      const algorithm = family.split("-")[0];
      let measuring = !family.endsWith("-warm");
      const context = createEvaluationContext({
        checkpoint() {
          if (measuring) counters.add("checkpointCount");
        }
      });
      const x = createRational(BigInt(input.numerator), BigInt(input.denominator));
      const compute = (argument, digits) =>
        gammaRealBallWithProfile(
          { lower: argument, upper: argument },
          digits + 12,
          4 * digits + 256,
          context.backend,
          context,
          { algorithm }
        );
      if (family.endsWith("-warm")) {
        if (!Number.isSafeInteger(input.warmDigits))
          throw new Error("Warm candidate needs warmDigits");
        compute(createRational(7n, 5n), input.warmDigits);
      }
      measuring = true;
      let terms = 0,
        workingDigits = 0;
      const beforeSpouge = getSpougeSnapshot(context).terms;
      return {
        refine(digits) {
          const result = compute(x, digits);
          terms += result.profile.correctionTerms;
          workingDigits = result.profile.workingDigits;
          return result.ball;
        },
        verify(ball, digits) {
          if (ball === null) throw new Error("Gamma dependency unresolved");
          return verifiedNumberFromBall(ball, { significantDigits: digits }, context.backend);
        },
        snapshot() {
          const s = getSpecialGammaSnapshot(context),
            p = getSpougeSnapshot(context);
          if (algorithm === "special")
            return {
              workingDigits: s.workingDigits,
              termCount: s.terms,
              retainedBigIntDigits: s.retainedBigIntDigits
            };
          if (algorithm === "spouge")
            return {
              workingDigits: Math.max(0, ...p.parameters.map((t) => t.workingDigits)),
              termCount: p.terms - beforeSpouge,
              retainedBigIntDigits: p.retainedBigIntDigits
            };
          const correction = getStirlingCorrectionSnapshot(context);
          return {
            workingDigits: Math.max(
              workingDigits,
              ...correction.states.map((s) => s.workingDigits)
            ),
            termCount: terms,
            retainedBigIntDigits:
              getBernoulliCacheSnapshot(context).retainedBigIntDigits +
              correction.retainedBigIntDigits
          };
        }
      };
    }
  };
}
export const cases = [
  { name: "gamma-one-third", numerator: "1", denominator: "3", special: true },
  { name: "gamma-four-thirds", numerator: "4", denominator: "3", special: true },
  { name: "gamma-one-quarter", numerator: "1", denominator: "4", special: true },
  { name: "gamma-three-quarters", numerator: "3", denominator: "4", special: true },
  { name: "gamma-one-sixth", numerator: "1", denominator: "6", special: true },
  { name: "gamma-negative-third", numerator: "-1", denominator: "3", special: true },
  { name: "gamma-general", numerator: "10", denominator: "7" },
  { name: "gamma-reflection", numerator: "-1000", denominator: "7" },
  { name: "gamma-near-pole", numerator: "1", denominator: "1000000000000" },
  { name: "gamma-large", numerator: "4001", denominator: "4" }
].map((input) => ({
  name: input.name,
  input,
  candidates: ["stirling", "spouge", ...(input.special ? ["special"] : [])].map(gammaCandidate)
}));
