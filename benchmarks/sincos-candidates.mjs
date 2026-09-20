import {
  createEvaluationContext,
  createRational,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall
} from "../dist/core/index.js";
import { legacySinCosSmallPointInterval, divideIntervals } from "../dist/core/math/elementary.js";
import { SinCosKernel } from "../dist/core/math/sincos-kernel.js";
import { BitBurstSinCosKernel } from "../dist/core/math/sincos-bit-burst.js";
import { routedSmallSinCos, getSinCosCacheSnapshot } from "../dist/core/math/sincos-router.js";
import { scaledIntervalToRationalBounds } from "../dist/core/math/scaled-interval.js";

function candidate(family) {
  return {
    family,
    create(input, counters) {
      const argument = createRational(BigInt(input.numerator), BigInt(input.denominator));
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      const [layout, dyadic] = family.split(":");
      const kernel =
        family === "bit-burst"
          ? new BitBurstSinCosKernel(argument)
          : new SinCosKernel(
              argument,
              input.mode,
              layout === "legacy" || layout === "router" ? "sequential" : layout,
              dyadic === undefined ? undefined : Number(dyadic)
            );
      return {
        refine(digits) {
          const work = digits + 12 + (input.nearZeroDigits ?? 0);
          if (family === "legacy")
            return legacySinCosSmallPointInterval(argument, work, context, {
              needSin: input.mode !== "cos",
              needCos: input.mode !== "sin"
            });
          const result =
            family === "router"
              ? routedSmallSinCos(argument, work, input.mode, context)
              : kernel.getInterval(work, context);
          return {
            sinInterval: result.sin === null ? null : scaledIntervalToRationalBounds(result.sin),
            cosInterval: result.cos === null ? null : scaledIntervalToRationalBounds(result.cos)
          };
        },
        verify(result, digits) {
          const bounds =
            input.mode === "both"
              ? divideIntervals(result.sinInterval, result.cosInterval)
              : input.mode === "sin"
                ? result.sinInterval
                : result.cosInterval;
          const bits = 4 * (digits + (input.nearZeroDigits ?? 0)) + 128;
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
            const states = getSinCosCacheSnapshot(context).states;
            return {
              workingDigits: Math.max(0, ...states.map((s) => s.workingDigits)),
              termCount: states.reduce((sum, s) => sum + s.termCount, 0),
              blockCount: states.reduce((sum, s) => sum + s.blockCount, 0),
              largeMultiplications: states.reduce((sum, s) => sum + s.largeMultiplications, 0),
              largeDivisions: states.reduce((sum, s) => sum + s.largeDivisions, 0),
              peakBigIntDigits: Math.max(0, ...states.map((s) => s.peakBigIntDigits)),
              retainedBigIntDigits: states.reduce((sum, s) => sum + s.retainedBigIntDigits, 0)
            };
          }
          return family === "legacy" ? {} : kernel.getSnapshot();
        }
      };
    }
  };
}
export const cases = [
  { name: "tenth", numerator: "1", denominator: "10" },
  { name: "edge", numerator: "3", denominator: "4" },
  { name: "negative", numerator: "-7", denominator: "10" },
  { name: "tiny", numerator: "1", denominator: String(10n ** 50n), nearZeroDigits: 50 }
].flatMap((value) =>
  ["sin", "cos", "both"].map((mode) => ({
    name: `${mode}-${value.name}`,
    input: { ...value, mode },
    candidates: [
      "legacy",
      "sequential",
      "rectangular",
      "binary",
      "router",
      ...(mode === "sin" ? [] : ["rectangular:0", "binary:0", "binary:8", "bit-burst"])
    ].map(candidate)
  }))
);
