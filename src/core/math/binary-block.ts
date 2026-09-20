import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";

interface Frame<T> {
  readonly start: number;
  readonly end: number;
  left: T | null;
  right: T | null;
  phase: "left" | "right" | "combine";
}

/** Context-owned balanced traversal. Leaves/combines commit before the next checkpoint. */
export class BinaryBlock<T> {
  private readonly stack: Frame<T>[];
  private result: T | null = null;

  constructor(start: number, end: number) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      throw new InternalCalculationException("Invalid binary block range");
    }
    this.stack = [this.frame(start, end)];
  }

  run(control: EvaluationCheckpoint, leaf: (index: number) => T, combine: (a: T, b: T) => T): T {
    while (this.stack.length > 0) {
      const current = this.stack.at(-1);
      if (current === undefined) throw new InternalCalculationException("Missing binary frame");
      control.checkpoint();
      let result: T;
      if (current.end - current.start === 1) result = leaf(current.start);
      else if (current.phase === "left") {
        current.phase = "right";
        this.stack.push(this.frame(current.start, Math.floor((current.start + current.end) / 2)));
        continue;
      } else if (current.phase === "right") {
        current.phase = "combine";
        this.stack.push(this.frame(Math.floor((current.start + current.end) / 2), current.end));
        continue;
      } else {
        if (current.left === null || current.right === null)
          throw new InternalCalculationException("Incomplete binary block");
        result = combine(current.left, current.right);
      }
      this.stack.pop();
      const parent = this.stack.at(-1);
      if (parent === undefined) this.result = result;
      else if (parent.phase === "right") parent.left = result;
      else parent.right = result;
    }
    if (this.result === null) throw new InternalCalculationException("Missing binary result");
    return this.result;
  }

  get depth(): number {
    return this.stack.length;
  }
  get phase(): string {
    return this.stack.at(-1)?.phase ?? "complete";
  }
  retained(): T[] {
    const values: T[] = this.result === null ? [] : [this.result];
    for (const frame of this.stack) {
      if (frame.left !== null) values.push(frame.left);
      if (frame.right !== null) values.push(frame.right);
    }
    return values;
  }
  private frame(start: number, end: number): Frame<T> {
    return { start, end, left: null, right: null, phase: "left" };
  }
}
