import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { createRational, subtractRational, equalsRational } from "../values/rational.js";
import { ExpKernel } from "./exp-kernel.js";
import { ceilDiv, createScaledInterval, decimalScale, rescaleScaled } from "./scaled-interval.js";
import type { ScaledInterval } from "./scaled-interval.js";

interface BurstJob {
  digits: number;
  work: number;
  bits: number;
  previous: Rational;
  kernel: ExpKernel | null;
  final: boolean;
  product: ScaledInterval;
}
/** Experimental exact dyadic chunks with doubling argument precision.
 * The last exact residual is included: no discarded argument bits.
 * Composition remains at full result precision, an intentionally conservative experiment.
 */
export class BitBurstExpKernel {
  private job: BurstJob | null = null;
  private cached: ScaledInterval | null = null;
  private highest = 0;
  private chunks = 0;
  private terms = 0;
  private blocks = 0;
  constructor(readonly argument: Rational) {}
  getInterval(digits: number, control: EvaluationCheckpoint): ScaledInterval {
    const argumentDigits =
      this.argument.numerator.toString().length + this.argument.denominator.toString().length;
    const guarded: EvaluationCheckpoint = {
      checkpoint: () => {
        control.checkpoint();
      },
      guardBigIntDigits: (estimate) => {
        control.guardBigIntDigits?.(estimate + 2 * argumentDigits + 4 * (this.job?.work ?? digits));
      }
    };
    if (this.cached !== null && digits <= this.highest) return rescaleScaled(this.cached, digits);
    if (this.job === null) {
      const work = digits + 2 * String(digits).length + 16;
      guarded.guardBigIntDigits?.(work * 200);
      control.checkpoint();
      const scale = decimalScale(work);
      this.job = {
        digits,
        work,
        bits: 16,
        previous: createRational(0n, 1n),
        kernel: null,
        final: false,
        product: createScaledInterval(scale, scale, work)
      };
    }
    const j = this.job;
    for (;;) {
      guarded.guardBigIntDigits?.(j.work * 200);
      if (j.kernel === null) {
        control.checkpoint();
        j.final = j.bits >= 4 * j.work;
        const denominator = 1n << BigInt(j.bits);
        const next = j.final
          ? this.argument
          : createRational(
              (this.argument.numerator * denominator) / this.argument.denominator,
              denominator
            );
        const chunk = subtractRational(next, j.previous);
        if (equalsRational(next, this.argument)) j.final = true;
        j.kernel = new ExpKernel(chunk, "binary", 1);
        j.previous = next;
      }
      const part = j.kernel.getInterval(j.work, guarded);
      control.checkpoint();
      const scale = decimalScale(j.work);
      j.product = createScaledInterval(
        (j.product.lower * part.lower) / scale,
        ceilDiv(j.product.upper * part.upper, scale),
        j.work
      );
      const snapshot = j.kernel.getSnapshot();
      this.terms += snapshot.termCount;
      this.blocks += snapshot.blockCount;
      j.kernel = null;
      this.chunks += 1;
      if (j.final) {
        this.cached = j.product;
        this.highest = j.digits;
        this.job = null;
        return digits > this.highest
          ? this.getInterval(digits, control)
          : rescaleScaled(this.cached, digits);
      }
      j.bits *= 2;
    }
  }
  getSnapshot() {
    return {
      workingDigits: this.job?.work ?? this.cached?.scaleDigits ?? 0,
      termCount: this.terms + (this.job?.kernel?.getSnapshot().termCount ?? 0),
      blockCount: this.blocks,
      chunkCount: this.chunks,
      peakBigIntDigits: null,
      retainedBigIntDigits: null
    };
  }
}
