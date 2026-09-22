import type { EvaluationCheckpoint } from "../evaluation/contracts.js";

// Opt-in kernel instrumentation, not a public API or a count of backend internals.
const states = new WeakMap<
  EvaluationCheckpoint,
  { largeMultiplications: number; sqrtOperations: number }
>();
const threshold = 1n << 128n;
export function enablePiInstrumentation(owner: EvaluationCheckpoint): void {
  states.set(owner, { largeMultiplications: 0, sqrtOperations: 0 });
}
export function piInstrumentation(owner: EvaluationCheckpoint) {
  return { ...states.get(owner) };
}
export function piProduct(a: bigint, b: bigint, owner: EvaluationCheckpoint): bigint {
  const state = states.get(owner);
  if (
    state !== undefined &&
    (a >= threshold || a <= -threshold) &&
    (b >= threshold || b <= -threshold)
  )
    state.largeMultiplications++;
  return a * b;
}
export function countPiSqrt(owner: EvaluationCheckpoint): void {
  const state = states.get(owner);
  if (state !== undefined) state.sqrtOperations++;
}
