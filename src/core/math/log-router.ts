import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { createRational, divideRational, equalsRational, addRational } from "../values/rational.js";
import { AtanhLogKernel } from "./atanh-blocks.js";
import type { AtanhLayout } from "./atanh-blocks.js";
import type { RationalBounds } from "./scaled-interval.js";
import { selectLogLayout, recordAlgorithmSelection } from "./algorithm-strategy.js";
export { selectLogLayout } from "./algorithm-strategy.js";

const owners = new WeakMap<EvaluationCheckpoint, ReducedLogProvider[]>();
// Completed entries may be evicted; a suspended job must never be evicted.
const COMPLETED_ENTRY_CACHE_SIZE = 8;

/** Optional exact factor reduction is a benchmark experiment, not a grammar change. */
export class ReducedLogProvider {
  private readonly kernels = new Map<AtanhLayout, AtanhLogKernel[]>();
  constructor(
    readonly argument: Rational,
    readonly tableReduction = false
  ) {}

  get pending(): boolean {
    return [...this.kernels.values()].some((pair) => pair.some((kernel) => kernel.pending));
  }
  get retainedDigitsUpperBound(): number {
    return [...this.kernels.values()]
      .flat()
      .reduce((sum, kernel) => sum + kernel.retainedDigitsUpperBound, 0);
  }

  getInterval(
    digits: number,
    control: EvaluationCheckpoint,
    layout = selectLogLayout(digits, this.argument)
  ): RationalBounds {
    const guarded = (active: AtanhLogKernel): EvaluationCheckpoint => ({
      checkpoint: () => {
        control.checkpoint();
      },
      guardBigIntDigits: (estimate) => {
        // Other layouts and optional table factors remain alive across switching.
        const retained = [...this.kernels.values()]
          .flat()
          .reduce(
            (sum, kernel) => sum + (kernel === active ? 0 : kernel.retainedDigitsUpperBound),
            0
          );
        control.guardBigIntDigits?.(estimate + retained);
      }
    });
    // Finish a suspended old route before switching families on a later request.
    for (const [family, kernels] of this.kernels) {
      if (family !== layout)
        for (const kernel of kernels) {
          if (kernel.pendingDigits !== null)
            kernel.getInterval(kernel.pendingDigits, guarded(kernel));
        }
    }
    let kernels = this.kernels.get(layout);
    if (kernels === undefined) {
      if (this.tableReduction) {
        // Nearest positive multiple of 1/16; factor and residual are exact rationals.
        const index =
          (32n * this.argument.numerator + this.argument.denominator) /
          (2n * this.argument.denominator);
        const factor = createRational(index, 16n);
        kernels = [
          new AtanhLogKernel(factor, layout),
          new AtanhLogKernel(divideRational(this.argument, factor), layout)
        ];
      } else kernels = [new AtanhLogKernel(this.argument, layout)];
      this.kernels.set(layout, kernels);
    }
    let lower = createRational(0n, 1n),
      upper = lower;
    for (const kernel of kernels) {
      const result = kernel.getInterval(digits, guarded(kernel));
      lower = addRational(lower, result.lower);
      upper = addRational(upper, result.upper);
    }
    return { lower, upper };
  }

  getSnapshot() {
    const states = [...this.kernels.values()].flat().map((kernel) => kernel.getSnapshot());
    return {
      workingDigits: Math.max(0, ...states.map((s) => s.workingDigits)),
      termCount: states.reduce((n, s) => n + s.termCount, 0),
      blockCount: states.reduce((n, s) => n + s.blockCount, 0),
      largeMultiplications: states.reduce((n, s) => n + s.largeMultiplications, 0),
      largeDivisions: states.reduce((n, s) => n + s.largeDivisions, 0),
      checkpointCount: states.reduce((n, s) => n + s.checkpointCount, 0),
      peakBigIntDigits: Math.max(0, ...states.map((s) => s.peakBigIntDigits)),
      retainedBigIntDigits: states.reduce((n, s) => n + s.retainedBigIntDigits, 0)
    };
  }
}

export function routedReducedLog(
  argument: Rational,
  digits: number,
  control: EvaluationCheckpoint
): RationalBounds {
  let entries = owners.get(control);
  if (entries === undefined) {
    entries = [];
    owners.set(control, entries);
  }
  let provider = entries.find((entry) => equalsRational(entry.argument, argument));
  if (provider === undefined) {
    while (entries.filter((entry) => !entry.pending).length >= COMPLETED_ENTRY_CACHE_SIZE) {
      const index = entries.findIndex((entry) => !entry.pending);
      entries.splice(index, 1);
    }
    provider = new ReducedLogProvider(argument);
    entries.push(provider);
  }
  const otherRetained = entries.reduce(
    (sum, entry) => sum + (entry === provider ? 0 : entry.retainedDigitsUpperBound),
    0
  );
  const layout = selectLogLayout(digits, argument);
  recordAlgorithmSelection(
    control,
    "ln",
    layout,
    digits,
    layout === "sequential" && digits >= 128 ? "near-one" : "reduced"
  );
  const result = provider.getInterval(
    digits,
    {
      checkpoint: () => {
        control.checkpoint();
      },
      guardBigIntDigits: (estimate) => {
        control.guardBigIntDigits?.(estimate + otherRetained);
      }
    },
    layout
  );
  while (entries.filter((entry) => !entry.pending).length > COMPLETED_ENTRY_CACHE_SIZE) {
    const index = entries.findIndex((entry) => entry !== provider && !entry.pending);
    entries.splice(index, 1);
  }
  return result;
}

export function getLogCacheSnapshot(control: EvaluationCheckpoint) {
  const entries = owners.get(control) ?? [];
  return {
    entries: entries.length,
    pending: entries.filter((entry) => entry.pending).length,
    retainedDigitsUpperBound: entries.reduce(
      (sum, entry) => sum + entry.retainedDigitsUpperBound,
      0
    )
  };
}
