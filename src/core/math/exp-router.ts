import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { equalsRational } from "../values/rational.js";
import { ExpKernel } from "./exp-kernel.js";
import type { ExpLayout } from "./exp-kernel.js";
import { selectSeriesLayout, recordAlgorithmSelection } from "./algorithm-strategy.js";

interface Entry {
  kernel: ExpKernel;
  digits: number;
}
const owners = new WeakMap<EvaluationCheckpoint, Entry[]>();
export function selectExpLayout(digits: number): ExpLayout {
  return selectSeriesLayout(digits);
}
/** A context owns at most eight completed endpoints. Pending work is completed
 * before changing endpoints/families, including when shared ln2 was refined.
 */
export function routedSmallExp(argument: Rational, digits: number, control: EvaluationCheckpoint) {
  let entries = owners.get(control);
  if (entries === undefined) {
    entries = [];
    owners.set(control, entries);
  }
  const guarded = (kernel: ExpKernel): EvaluationCheckpoint => ({
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
  const layout = selectExpLayout(digits);
  recordAlgorithmSelection(control, "exp", layout, digits, "reduced-positive");
  let entry = entries.find(
    (e) => e.kernel.layout === layout && equalsRational(e.kernel.argument, argument)
  );
  if (entry === undefined) {
    if (entries.length >= 8) entries.shift();
    entry = { kernel: new ExpKernel(argument, layout), digits };
    entries.push(entry);
  }
  entry.digits = digits;
  return entry.kernel.getInterval(digits, guarded(entry.kernel));
}
export function getExpCacheSnapshot(control: EvaluationCheckpoint) {
  const entries = owners.get(control) ?? [];
  return {
    entries: entries.length,
    pending: entries.filter((e) => e.kernel.pending).length,
    states: entries.map((e) => e.kernel.getSnapshot())
  };
}
