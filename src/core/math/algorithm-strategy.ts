import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";

// Measured policy, not a precision ceiling. See ENGINEERING-AR-9-ROUTING.md.
export type SeriesLayout = "sequential" | "rectangular" | "binary";
export const AGM_PI_THRESHOLD = 3000;
export const BINARY_E_THRESHOLD = 1000;

export function selectSeriesLayout(digits: number): SeriesLayout {
  return digits < 128 ? "sequential" : digits < 4096 ? "rectangular" : "binary";
}

export function selectLogLayout(digits: number, argument?: Rational): SeriesLayout {
  if (argument !== undefined) {
    const difference = argument.numerator - argument.denominator;
    if (difference === 0n) return "sequential";
    const magnitude = difference < 0n ? -difference : difference;
    const leadingZeros =
      (argument.numerator + argument.denominator).toString().length -
      magnitude.toString().length -
      1;
    // Cost heuristic only: the kernel still proves its tail using exact integers.
    if (leadingZeros > 0 && leadingZeros * 16 >= digits + 16) return "sequential";
  }
  return selectSeriesLayout(digits);
}

export function selectPiStrategy(digits: number, cachedAgm = false) {
  return digits >= AGM_PI_THRESHOLD || cachedAgm ? "agm" : "chudnovsky";
}

export function selectEStrategy(digits: number, binaryStarted = false) {
  return digits >= BINARY_E_THRESHOLD || binaryStarted ? "binary" : "sequential";
}

type Operation = "ln" | "exp" | "sincos" | "pi" | "e";
interface Selection {
  readonly operation: Operation;
  readonly strategy: string;
  readonly workingDigits: number;
  readonly argumentClass: string;
  readonly requests: number;
  readonly changes: number;
}
const owners = new WeakMap<EvaluationCheckpoint, Map<Operation, Selection>>();

/** Bounded context-local diagnostics of selection attempts, including paused ones.
 * Completion and resumable jobs remain observable on the individual providers. */
export function recordAlgorithmSelection(
  owner: EvaluationCheckpoint,
  operation: Operation,
  strategy: string,
  workingDigits: number,
  argumentClass = "general"
): void {
  let entries = owners.get(owner);
  if (entries === undefined) {
    entries = new Map();
    owners.set(owner, entries);
  }
  const previous = entries.get(operation);
  entries.set(
    operation,
    Object.freeze({
      operation,
      strategy,
      workingDigits,
      argumentClass,
      requests: (previous?.requests ?? 0) + 1,
      changes:
        (previous?.changes ?? 0) +
        (previous !== undefined && previous.strategy !== strategy ? 1 : 0)
    })
  );
}

export function getAlgorithmRoutingSnapshot(owner: EvaluationCheckpoint): readonly Selection[] {
  return Object.freeze([...(owners.get(owner)?.values() ?? [])]);
}
