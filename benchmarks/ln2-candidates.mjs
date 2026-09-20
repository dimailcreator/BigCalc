import {
  createEvaluationContext,
  createInternalInterval,
  createRational,
  intervalToBall,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import { SequentialLn2Provider } from "../dist/core/math/constants.js";
import { SplittingLn2Provider } from "../dist/core/math/ln2-splitting.js";

function candidate(family, factory) {
  return {
    family,
    create(input, counters) {
      if (input.source !== "ln(2)") throw new Error("ln2 candidate requires ln(2)");
      counters.add("checkpointCount", 0);
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      const provider = factory();
      return {
        refine(digits) {
          return provider.getInterval(digits + 4, context);
        },
        verify(bounds, digits) {
          return extract(bounds, digits, context);
        },
        snapshot() {
          const state = provider.getSnapshot();
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
      };
    }
  };
}

function extract(bounds, digits, context = createEvaluationContext()) {
  const bits = digits * 4 + 64;
  const interval = createInternalInterval(
    context.backend.fromRational(bounds.lower, bits, "towardNegativeInfinity"),
    context.backend.fromRational(bounds.upper, bits, "towardPositiveInfinity"),
    context.backend
  );
  return verifiedNumberFromBall(
    intervalToBall(interval, bits, context.backend),
    { significantDigits: digits },
    context.backend
  );
}

// Independent log(1-z) series, not the candidate atanh series. Reference work is
// outside timings. Each floor costs <1 scale unit; bound the remaining geometric tail.
function reference(digits) {
  const scale = 10n ** BigInt(digits + 15);
  const terms = 4 * (digits + 15);
  let power = scale;
  let lower = 0n;
  for (let k = 1; k <= terms; k += 1) {
    power /= 2n;
    lower += power / BigInt(k);
  }
  const denominator = BigInt(terms + 1) * (1n << BigInt(terms));
  const tail = (scale + denominator - 1n) / denominator;
  return extract(
    {
      lower: createRational(lower, scale),
      upper: createRational(lower + BigInt(terms) + tail, scale)
    },
    digits
  );
}

export const cases = [
  {
    name: "ln2",
    input: { source: "ln(2)" },
    reference,
    candidates: [
      candidate("atanh-sequential", () => new SequentialLn2Provider()),
      ...["rectangular", "binary"].flatMap((layout) =>
        ["persistent", "rebuild"].map((retention) =>
          candidate(`${layout}-${retention}`, () => new SplittingLn2Provider(layout, retention))
        )
      )
    ]
  }
];
