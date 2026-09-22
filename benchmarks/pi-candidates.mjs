import { createEvaluationContext, verifiedNumberFromBall } from "../dist/core/index.js";
import {
  getChudnovskyPiRationalInterval,
  getPiProviderStateSnapshot
} from "../dist/core/math/constants.js";
import { AgmPiProvider } from "../dist/core/math/pi-agm.js";
import {
  enablePiInstrumentation,
  piInstrumentation
} from "../dist/core/math/pi-instrumentation.js";
import { intervalToRoundedBall } from "../dist/core/math/elementary.js";

export function piCandidate(family) {
  return {
    family,
    create(input, counters) {
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      enablePiInstrumentation(context);
      const agm = new AgmPiProvider();
      return {
        refine(digits) {
          return family === "agm"
            ? agm.getInterval(digits + 8, context)
            : getChudnovskyPiRationalInterval(context, digits + 8);
        },
        verify(bounds, digits) {
          return verifiedNumberFromBall(
            intervalToRoundedBall(bounds, 4 * digits + 64, context.backend),
            { significantDigits: digits },
            context.backend
          );
        },
        snapshot() {
          const stats = piInstrumentation(context);
          if (family === "agm")
            return { ...agm.getSnapshot(), ...stats, termCount: agm.getSnapshot().iterations };
          const s = getPiProviderStateSnapshot(context);
          return {
            ...stats,
            workingDigits: s.highestProviderWorkingDigits,
            termCount: s.completedTerms,
            blockCount: s.completedBlocks,
            peakBigIntDigits: s.peakBigIntDigits,
            retainedBigIntDigits: s.cachedBigIntDigits
          };
        }
      };
    }
  };
}
export const cases = [
  {
    name: "pi",
    input: { source: "π" },
    candidates: [piCandidate("chudnovsky"), piCandidate("agm")]
  }
];
