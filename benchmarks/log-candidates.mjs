import {
  createEvaluationContext,
  createRational,
  createInternalInterval,
  intervalToBall,
  verifiedNumberFromBall,
  addRational,
  multiplyRational
} from "../dist/core/index.js";
import {
  reduceLnArgument,
  lnReducedPositiveRationalInterval
} from "../dist/core/math/elementary.js";
import { getLn2RationalInterval } from "../dist/core/math/constants.js";
import { ReducedLogProvider } from "../dist/core/math/log-router.js";
import { AgmLogKernel } from "../dist/core/math/log-agm.js";

function candidate(family) {
  return {
    family,
    create(input, counters) {
      let numerator = BigInt(input.numerator),
        denominator = BigInt(input.denominator);
      if (input.binaryExponent > 0) numerator <<= BigInt(input.binaryExponent);
      if (input.binaryExponent < 0) denominator <<= BigInt(-input.binaryExponent);
      const value = createRational(numerator, denominator);
      const context = createEvaluationContext({
        checkpoint() {
          counters.add("checkpointCount");
        }
      });
      // ln(2) is also a direct kernel comparison; otherwise use production reduction.
      const reduction =
        input.name === "ln2" ? { value, power: 0 } : reduceLnArgument(value, context);
      const provider =
        family === "agm"
          ? new AgmLogKernel(reduction.value)
          : new ReducedLogProvider(reduction.value, family.endsWith("-table"));
      const layout = family.replace("-table", "");
      return {
        refine(digits) {
          const work =
            digits + (input.nearOneDigits ?? 0) + String(Math.abs(reduction.power)).length + 12;
          const part =
            family === "legacy"
              ? lnReducedPositiveRationalInterval(reduction.value, work, context)
              : family === "agm"
                ? provider.getInterval(work, context)
                : provider.getInterval(work, context, layout === "router" ? undefined : layout);
          if (reduction.power === 0) return part;
          const ln2 = getLn2RationalInterval(context, work);
          const power = createRational(BigInt(reduction.power), 1n);
          return reduction.power > 0
            ? {
                lower: addRational(part.lower, multiplyRational(power, ln2.lower)),
                upper: addRational(part.upper, multiplyRational(power, ln2.upper))
              }
            : {
                lower: addRational(part.lower, multiplyRational(power, ln2.upper)),
                upper: addRational(part.upper, multiplyRational(power, ln2.lower))
              };
        },
        verify(bounds, digits) {
          const bits = (digits + (input.nearOneDigits ?? 0)) * 4 + 64;
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
        },
        snapshot() {
          if (family === "legacy") return {};
          const snapshot = provider.getSnapshot();
          // Keep full-function checkpoint observations, including shared constants.
          delete snapshot.checkpointCount;
          return snapshot;
        }
      };
    }
  };
}

const nearScale = 10n ** 50n;
export const cases = [
  { name: "ln2", numerator: "2", denominator: "1" },
  { name: "ln3", numerator: "3", denominator: "1" },
  { name: "ln10", numerator: "10", denominator: "1" },
  { name: "ln113", numerator: "113", denominator: "100" },
  {
    name: "near-one",
    numerator: String(nearScale + 1n),
    denominator: String(nearScale),
    nearOneDigits: 50
  },
  { name: "large-exponent", numerator: "3", denominator: "2", binaryExponent: 100000 },
  { name: "small-exponent", numerator: "3", denominator: "2", binaryExponent: -100000 }
].map((input) => ({
  name: input.name,
  input,
  candidates: [
    "legacy",
    "sequential",
    "rectangular",
    "binary",
    "binary-table",
    "agm",
    "router"
  ].map(candidate)
}));
