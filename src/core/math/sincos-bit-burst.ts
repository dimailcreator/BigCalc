import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import {
  absRational,
  createRational,
  equalsRational,
  subtractRational
} from "../values/rational.js";
import { SinCosKernel } from "./sincos-kernel.js";
import type { SinCosScaled } from "./sincos-kernel.js";
import { createScaledInterval, decimalScale, mulScaled, rescaleScaled } from "./scaled-interval.js";
import type { ScaledInterval } from "./scaled-interval.js";
import { InternalCalculationException } from "../errors/index.js";

interface Job {
  digits: number;
  work: number;
  bits: number;
  previous: Rational;
  kernel: SinCosKernel | null;
  final: boolean;
  sin: ScaledInterval;
  cos: ScaledInterval;
}
/** Conservative experiment: progressively finer exact dyadic argument chunks,
 * composed with outward angle-addition formulas at full result precision.
 */
export class BitBurstSinCosKernel {
  private job: Job | null = null;
  private cached: SinCosScaled | null = null;
  private highest = 0;
  private terms = 0;
  private blocks = 0;
  private chunks = 0;
  constructor(readonly argument: Rational) {
    if (absRational(argument).numerator > argument.denominator)
      throw new InternalCalculationException("Small bit-burst sincos requires |x|<=1");
  }
  getInterval(digits: number, control: EvaluationCheckpoint): SinCosScaled {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid bit-burst precision");
    const magnitude = absRational(this.argument);
    const argumentDigits =
      magnitude.numerator.toString().length + magnitude.denominator.toString().length;
    const guarded: EvaluationCheckpoint = {
      checkpoint: () => {
        control.checkpoint();
      },
      guardBigIntDigits: (n) => {
        control.guardBigIntDigits?.(n + 2 * argumentDigits + 8 * (this.job?.work ?? digits));
      }
    };
    if (this.cached !== null && digits <= this.highest) return scaleResult(this.cached, digits);
    if (this.job === null) {
      const work = digits + 2 * String(digits).length + 16;
      guarded.guardBigIntDigits?.(work * 256);
      control.checkpoint();
      const scale = decimalScale(work);
      this.job = {
        digits,
        work,
        bits: 16,
        previous: createRational(0n, 1n),
        kernel: null,
        final: false,
        sin: createScaledInterval(0n, 0n, work),
        cos: createScaledInterval(scale, scale, work)
      };
    }
    const j = this.job;
    for (;;) {
      guarded.guardBigIntDigits?.(j.work * 256);
      if (j.kernel === null) {
        control.checkpoint();
        j.final = j.bits >= 4 * j.work;
        const denominator = 1n << BigInt(j.bits);
        const next = j.final
          ? magnitude
          : createRational(
              (magnitude.numerator * denominator) / magnitude.denominator,
              denominator
            );
        const chunk = subtractRational(next, j.previous);
        if (equalsRational(next, magnitude)) j.final = true;
        j.kernel = new SinCosKernel(chunk, "both", "binary", 0);
        j.previous = next;
      }
      const part = j.kernel.getInterval(j.work, guarded);
      if (part.sin === null || part.cos === null)
        throw new InternalCalculationException("Missing bit-burst branch");
      control.checkpoint();
      const sc = mulScaled(j.sin, part.cos, j.work),
        cs = mulScaled(j.cos, part.sin, j.work);
      const cc = mulScaled(j.cos, part.cos, j.work),
        ss = mulScaled(j.sin, part.sin, j.work);
      const scale = decimalScale(j.work);
      j.sin = clip(createScaledInterval(sc.lower + cs.lower, sc.upper + cs.upper, j.work), scale);
      j.cos = clip(createScaledInterval(cc.lower - ss.upper, cc.upper - ss.lower, j.work), scale);
      const state = j.kernel.getSnapshot();
      this.terms += state.termCount;
      this.blocks += state.blockCount;
      this.chunks += 1;
      j.kernel = null;
      if (j.final) {
        this.cached = {
          sin:
            this.argument.numerator < 0n
              ? createScaledInterval(-j.sin.upper, -j.sin.lower, j.work)
              : j.sin,
          cos: j.cos
        };
        this.highest = j.digits;
        this.job = null;
        return digits > this.highest
          ? this.getInterval(digits, control)
          : scaleResult(this.cached, digits);
      }
      j.bits *= 2;
    }
  }
  getSnapshot() {
    return {
      workingDigits: this.job?.work ?? this.cached?.sin?.scaleDigits ?? 0,
      termCount: this.terms + (this.job?.kernel?.getSnapshot().termCount ?? 0),
      blockCount: this.blocks,
      chunkCount: this.chunks,
      peakBigIntDigits: null,
      retainedBigIntDigits: null
    };
  }
}
function clip(value: ScaledInterval, scale: bigint) {
  return createScaledInterval(
    value.lower < 0n ? 0n : value.lower,
    value.upper > scale ? scale : value.upper,
    value.scaleDigits
  );
}
function scaleResult(value: SinCosScaled, digits: number): SinCosScaled {
  return {
    sin: value.sin === null ? null : rescaleScaled(value.sin, digits),
    cos: value.cos === null ? null : rescaleScaled(value.cos, digits)
  };
}
