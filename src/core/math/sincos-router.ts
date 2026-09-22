import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { equalsRational } from "../values/rational.js";
import { SinCosKernel } from "./sincos-kernel.js";
import type { SinCosLayout, SinCosMode } from "./sincos-kernel.js";
import { selectSeriesLayout, recordAlgorithmSelection } from "./algorithm-strategy.js";

interface Entry {
  kernel: SinCosKernel;
  digits: number;
}
const owners = new WeakMap<EvaluationCheckpoint, Entry[]>();
export function selectSinCosLayout(digits: number): SinCosLayout {
  return selectSeriesLayout(digits);
}
/** Endpoint state belongs to the evaluation context; pending work is never evicted. */
export function routedSmallSinCos(
  argument: Rational,
  digits: number,
  mode: SinCosMode,
  control: EvaluationCheckpoint
) {
  let entries = owners.get(control);
  if (entries === undefined) {
    entries = [];
    owners.set(control, entries);
  }
  const guarded = (kernel: SinCosKernel): EvaluationCheckpoint => ({
    checkpoint: () => {
      control.checkpoint();
    },
    guardBigIntDigits: (estimate) => {
      control.guardBigIntDigits?.(
        estimate +
          entries.reduce(
            (sum, e) => sum + (e.kernel === kernel ? 0 : e.kernel.retainedDigitsUpperBound),
            0
          )
      );
    }
  });
  for (const entry of entries)
    if (entry.kernel.pending) entry.kernel.getInterval(entry.digits, guarded(entry.kernel));
  const layout = selectSinCosLayout(digits);
  recordAlgorithmSelection(control, "sincos", layout, digits, mode);
  let entry = entries.find(
    (e) =>
      e.kernel.mode === mode &&
      e.kernel.layout === layout &&
      equalsRational(e.kernel.argument, argument)
  );
  if (entry === undefined) {
    if (entries.length >= 8) entries.shift();
    entry = { kernel: new SinCosKernel(argument, mode, layout), digits };
    entries.push(entry);
  }
  entry.digits = digits;
  return entry.kernel.getInterval(digits, guarded(entry.kernel));
}
export function getSinCosCacheSnapshot(control: EvaluationCheckpoint) {
  const entries = owners.get(control) ?? [];
  return {
    entries: entries.length,
    pending: entries.filter((e) => e.kernel.pending).length,
    states: entries.map((e) => e.kernel.getSnapshot())
  };
}
