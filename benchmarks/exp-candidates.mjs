import {
  createEvaluationContext,
  createRational,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import { expSmallNonNegativeScaledInterval } from "../dist/core/math/elementary.js";
import { ExpKernel } from "../dist/core/math/exp-kernel.js";
import { BitBurstExpKernel } from "../dist/core/math/exp-bit-burst.js";
import { routedSmallExp, getExpCacheSnapshot } from "../dist/core/math/exp-router.js";
import { scaledIntervalToRationalBounds } from "../dist/core/math/scaled-interval.js";

function candidate(family) {
  return {
    family,
    create(input, counters) {
      const value = createRational(BigInt(input.numerator), BigInt(input.denominator));
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      const [layout, s] = family.split(":");
      const kernel =
        family === "bit-burst"
          ? new BitBurstExpKernel(value)
          : new ExpKernel(
              value,
              layout === "legacy" ? "sequential" : layout,
              s === undefined ? undefined : Number(s)
            );
      return {
        refine(digits) {
          if (family === "router") return routedSmallExp(value, digits + 12, context);
          return family === "legacy"
            ? expSmallNonNegativeScaledInterval(value, digits + 12, context)
            : kernel.getInterval(digits + 12, context);
        },
        verify(result, digits) {
          const bounds = scaledIntervalToRationalBounds(result),
            bits = 4 * digits + 128;
          return verifiedNumberFromBall(
            intervalToBall(
              createInternalInterval(
                context.backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
                context.backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
                context.backend
              ),
              bits,
              context.backend
            ),
            { significantDigits: digits },
            context.backend
          );
        },
        snapshot() {
          if (family === "router") {
            const states = getExpCacheSnapshot(context).states;
            return {
              workingDigits: Math.max(0, ...states.map((s) => s.workingDigits)),
              termCount: states.reduce((n, s) => n + s.termCount, 0),
              blockCount: states.reduce((n, s) => n + s.blockCount, 0),
              largeMultiplications: states.reduce((n, s) => n + s.largeMultiplications, 0),
              largeDivisions: states.reduce((n, s) => n + s.largeDivisions, 0),
              peakBigIntDigits: Math.max(0, ...states.map((s) => s.peakBigIntDigits)),
              retainedBigIntDigits: states.reduce((n, s) => n + s.retainedBigIntDigits, 0)
            };
          }
          return family === "legacy" ? {} : kernel.getSnapshot();
        }
      };
    }
  };
}
export const cases = [
  { name: "exp-small", numerator: "1", denominator: "1" },
  {
    name: "exp-remainder",
    numerator: "306852819440054690582767878541823432",
    denominator: "1000000000000000000000000000000000000"
  },
  { name: "exp-two", numerator: "2", denominator: "1" },
  { name: "exp-tiny", numerator: "1", denominator: String(10n ** 50n) }
].map((input) => ({
  name: input.name,
  input,
  candidates: [
    "legacy",
    "sequential",
    "rectangular",
    "binary",
    "rectangular:1",
    "binary:1",
    "binary:16",
    "bit-burst",
    "router"
  ].map(candidate)
}));
