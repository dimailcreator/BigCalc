import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;

interface FactorialFrame {
  readonly lower: bigint;
  readonly upper: bigint;
  phase: "start" | "await-left" | "await-right";
  left: bigint | null;
}

export interface FactorialState {
  target: bigint | null;
  stack: FactorialFrame[];
  carry: bigint | null;
  result: bigint | null;
  multiplications: number;
  checkpoints: number;
  treeDepth: number;
  estimatedResultDigits: number;
}

export interface FactorialProfile {
  readonly argument: bigint;
  readonly multiplications: number;
  readonly checkpoints: number;
  readonly treeDepth: number;
  readonly estimatedResultDigits: number;
}

export function createFactorialState(): FactorialState {
  return {
    target: null,
    stack: [],
    carry: null,
    result: null,
    multiplications: 0,
    checkpoints: 0,
    treeDepth: 0,
    estimatedResultDigits: 1
  };
}

export function factorialBigInt(
  value: bigint,
  control?: EvaluationCheckpoint,
  state: FactorialState = createFactorialState()
): bigint {
  return factorialBigIntWithProfile(value, control, state).value;
}

export function factorialBigIntWithProfile(
  value: bigint,
  control?: EvaluationCheckpoint,
  state: FactorialState = createFactorialState()
): { readonly value: bigint; readonly profile: FactorialProfile } {
  if (value < ZERO) {
    throw new InternalCalculationException("Exact factorial requires a non-negative integer");
  }

  const estimatedResultDigits = estimateFactorialResultDigits(value);
  control?.guardBigIntDigits?.(estimatedResultDigits);
  initializeFactorialState(state, value, estimatedResultDigits);

  while (state.result === null) {
    if (state.carry !== null) {
      const parent = state.stack.at(-1);
      if (parent === undefined) {
        state.result = state.carry;
        state.carry = null;
        break;
      }

      if (parent.phase === "await-left") {
        parent.left = state.carry;
        state.carry = null;
        parent.phase = "await-right";
        const middle = (parent.lower + parent.upper) / TWO;
        state.stack.push(createFactorialFrame(middle + ONE, parent.upper));
        state.treeDepth = Math.max(state.treeDepth, state.stack.length);
        continue;
      }

      if (parent.phase !== "await-right" || parent.left === null) {
        throw new InternalCalculationException("Factorial product-tree state is inconsistent");
      }

      // Checkpoint before mutating the completed-subtree frontier. A pause can
      // therefore retry this one multiplication without duplicating work.
      checkpointFactorial(control, state);
      const product = parent.left * state.carry;
      state.multiplications += 1;
      state.stack.pop();
      state.carry = product;
      continue;
    }

    const frame = state.stack.at(-1);
    if (frame === undefined) {
      throw new InternalCalculationException("Factorial product-tree frame is missing");
    }

    if (frame.lower === frame.upper) {
      // Leaves are also resumable boundaries, keeping cancellation responsive
      // even before products become large.
      checkpointFactorial(control, state);
      state.stack.pop();
      state.carry = frame.lower;
      continue;
    }

    if (frame.phase !== "start") {
      throw new InternalCalculationException(
        "Factorial product-tree cannot descend from this phase"
      );
    }

    frame.phase = "await-left";
    const middle = (frame.lower + frame.upper) / TWO;
    state.stack.push(createFactorialFrame(frame.lower, middle));
    state.treeDepth = Math.max(state.treeDepth, state.stack.length);
  }

  const result = state.result;
  return Object.freeze({
    value: result,
    profile: Object.freeze({
      argument: value,
      multiplications: state.multiplications,
      checkpoints: state.checkpoints,
      treeDepth: state.treeDepth,
      estimatedResultDigits: state.estimatedResultDigits
    })
  });
}

function initializeFactorialState(
  state: FactorialState,
  value: bigint,
  estimatedResultDigits: number
): void {
  if (state.target === value) return;

  state.target = value;
  state.stack = [];
  state.carry = null;
  state.result = value < TWO ? ONE : null;
  state.multiplications = 0;
  state.checkpoints = 0;
  state.treeDepth = value < TWO ? 0 : 1;
  state.estimatedResultDigits = estimatedResultDigits;

  if (value >= TWO) {
    state.stack.push(createFactorialFrame(TWO, value));
  }
}

function createFactorialFrame(lower: bigint, upper: bigint): FactorialFrame {
  return { lower, upper, phase: "start", left: null };
}

function checkpointFactorial(
  control: EvaluationCheckpoint | undefined,
  state: FactorialState
): void {
  control?.checkpoint();
  state.checkpoints += 1;
}

function estimateFactorialResultDigits(value: bigint): number {
  if (value < TWO) return 1;

  // n! <= n^n, so this is deliberately conservative and safe for preflight.
  const estimate = value * BigInt(value.toString().length);
  return estimate > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(estimate);
}
