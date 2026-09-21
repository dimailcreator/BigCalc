import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import { createScaledInterval, floorDiv, ceilDiv } from "./scaled-interval.js";
import type { RationalBounds, ScaledInterval } from "./scaled-interval.js";

interface RootState {
  radicand: bigint;
  value: bigint;
  done: boolean;
}
/** Small-degree outward root with a checkpoint-safe integer Newton frontier. */
export class GammaRoot {
  private lower: RootState | null = null;
  private upper: RootState | null = null;
  private result: ScaledInterval | null = null;
  constructor(
    readonly argument: RationalBounds,
    readonly degree: number,
    readonly digits: number
  ) {
    if (![2, 4, 6].includes(degree) || argument.lower.numerator < 0n)
      throw new InternalCalculationException("Invalid Gamma root");
  }
  getInterval(control: EvaluationCheckpoint): ScaledInterval {
    if (this.result !== null) return this.result;
    control.guardBigIntDigits?.(32 * (this.degree * this.digits + this.retainedDigits));
    if (this.lower === null || this.upper === null) {
      control.checkpoint();
      const scale = 10n ** BigInt(this.digits * this.degree);
      const make = (n: bigint): RootState => ({
        radicand: n,
        value: n === 0n ? 0n : 1n << BigInt(Math.ceil(n.toString(2).length / this.degree)),
        done: n === 0n
      });
      this.lower = make(
        floorDiv(this.argument.lower.numerator * scale, this.argument.lower.denominator)
      );
      this.upper = make(
        ceilDiv(this.argument.upper.numerator * scale, this.argument.upper.denominator)
      );
    }
    const finish = (state: RootState) => {
      while (!state.done) {
        control.checkpoint();
        const d = BigInt(this.degree);
        const next = ((d - 1n) * state.value + state.radicand / state.value ** (d - 1n)) / d;
        if (next >= state.value) state.done = true;
        else state.value = next;
      }
      return state.value;
    };
    const lo = finish(this.lower),
      hi = finish(this.upper);
    this.result = createScaledInterval(
      lo,
      hi ** BigInt(this.degree) === this.upper.radicand ? hi : hi + 1n,
      this.digits
    );
    this.lower = null;
    this.upper = null;
    return this.result;
  }
  get complete(): boolean {
    return this.result !== null;
  }
  get retainedDigits(): number {
    const values = [
      this.argument.lower.numerator,
      this.argument.lower.denominator,
      this.argument.upper.numerator,
      this.argument.upper.denominator
    ];
    for (const state of [this.lower, this.upper])
      if (state !== null) values.push(state.radicand, state.value);
    if (this.result !== null) values.push(this.result.lower, this.result.upper);
    return values.reduce((n, v) => n + v.toString().replace("-", "").length, 0);
  }
}
