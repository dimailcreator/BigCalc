import { createEvaluationGraphFromSource, verifiedNumberFromBall } from "../dist/core/index.js";
import {
  getLn2ProviderStateSnapshot,
  getPiProviderStateSnapshot
} from "../dist/core/math/constants.js";

export function productionCandidate(family, constant) {
  return {
    family,
    create(input, counters) {
      counters.add("checkpointCount", 0);
      const created = createEvaluationGraphFromSource(input.source, {
        settings: input.settings,
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      if (!created.ok) throw new Error(created.error.message);
      return {
        refine(significantDigits) {
          return created.graph.refine({ significantDigits });
        },
        verify(ball, significantDigits) {
          return verifiedNumberFromBall(ball, { significantDigits }, created.context.backend);
        },
        snapshot() {
          if (constant === "pi") {
            const state = getPiProviderStateSnapshot(created.context);
            return {
              workingDigits: state.highestProviderWorkingDigits,
              termCount: state.completedTerms,
              blockCount: state.completedBlocks,
              peakBigIntDigits: state.peakBigIntDigits,
              retainedBigIntDigits: state.cachedBigIntDigits
            };
          }
          if (constant === "ln2" || constant === "e") {
            const state =
              constant === "ln2"
                ? getLn2ProviderStateSnapshot(created.context)
                : created.graph.evaluate().getStateSnapshot();
            return {
              workingDigits: state.workingDigits ?? null,
              termCount: state.termCount ?? state.completedTerms,
              blockCount: state.blockCount ?? null,
              largeMultiplications: state.largeMultiplications ?? null,
              largeDivisions: state.largeDivisions ?? null,
              peakBigIntDigits: state.peakBigIntDigits,
              retainedBigIntDigits: state.cachedBigIntDigits
            };
          }
          return {};
        }
      };
    }
  };
}

export const productionCases = [
  ["pi", "π", "chudnovsky-binary-splitting", "pi"],
  ["e", "e", "factorial-recurrence", "e"],
  ["ln2", "ln(2)", "atanh-binary-rebuild", "ln2"],
  ["ln3", "ln(3)", "binary-reduction-routed-atanh"],
  ["exp", "exp(1)", "reduced-taylor"],
  ["sin", "sin(1/10)", "fixed-point-taylor"],
  ["cos", "cos(1/10)", "fixed-point-taylor"],
  ["tan", "tan(1/10)", "fixed-point-sincos"],
  ["sqrt", "2^(1/2)", "fixed-point-newton"],
  ["gamma", "(1/3)!", "adaptive-stirling"],
  ["gamma-reflection", "(-4/3)!", "adaptive-stirling-reflection"]
].map(([name, source, family, constant]) => ({
  name,
  input: { source, ...(name.startsWith("gamma") ? { settings: { factorialMode: "gamma" } } : {}) },
  candidates: [productionCandidate(family, constant)]
}));
