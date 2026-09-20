import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { EvaluationGraphContext } from "../evaluation/context.js";
import type { Rational } from "../values/contracts.js";
import { compareRational, createRational } from "../values/rational.js";
import { getLn2RationalInterval, getPiRationalInterval } from "./constants.js";
import {
  ceilDiv,
  createScaledInterval,
  decimalScale,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";
import type { RationalBounds } from "./scaled-interval.js";

interface Root {
  readonly radicand: bigint;
  value: bigint;
  done: boolean;
}
interface Job {
  readonly digits: number;
  readonly workingDigits: number;
  readonly scale: bigint;
  readonly shift: number;
  readonly uUpper: bigint;
  readonly stopGap: bigint;
  aLower: bigint;
  aUpper: bigint;
  bLower: bigint;
  bUpper: bigint;
  lowerRoot: Root | null;
  upperRoot: Root | null;
}

/** Experimental AGM log. DLMF 19.8.5 and 19.12.1–3 imply
 * K = pi/(2 AGM(1,u)), 0 <= K-log(4/u) <= L*u^2/(1-u^2),
 * where L=log(4/u) and u=4/(r*2^m). Here L < m+2.
 * The asymptotic error is explicitly retained, never treated as zero.
 */
export class AgmLogKernel {
  private job: Job | null = null;
  private cached: RationalBounds | null = null;
  private highestDigits = 0;
  private iterations = 0;
  private rootIterations = 0;
  private checkpoints = 0;
  private workingDigits = 0;
  private peakDigits = 0;
  constructor(readonly argument: Rational) {
    if (
      compareRational(argument, createRational(2n, 3n)) < 0 ||
      compareRational(argument, createRational(2n, 1n)) > 0
    ) {
      throw new InternalCalculationException("AGM log requires a reduced positive argument");
    }
  }
  getInterval(digits: number, context: EvaluationGraphContext): RationalBounds {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid AGM precision");
    if (this.argument.numerator === this.argument.denominator) {
      const zero = createRational(0n, 1n);
      return { lower: zero, upper: zero };
    }
    if (this.cached !== null && digits <= this.highestDigits) return this.cached;
    this.job ??= this.start(digits, context);
    const job = this.job;
    while (job.aUpper - job.bLower > job.stopGap) {
      this.checkpoint(context);
      job.lowerRoot ??= this.root(job.aLower * job.bLower);
      job.upperRoot ??= this.root(job.aUpper * job.bUpper);
      const lo = this.finishRoot(job.lowerRoot, context);
      const hiFloor = this.finishRoot(job.upperRoot, context);
      const hi = hiFloor * hiFloor === job.upperRoot.radicand ? hiFloor : hiFloor + 1n;
      const aLower = (job.aLower + job.bLower) / 2n;
      const aUpper = ceilDiv(job.aUpper + job.bUpper, 2n);
      job.aLower = aLower;
      job.aUpper = aUpper;
      job.bLower = lo;
      job.bUpper = hi;
      job.lowerRoot = null;
      job.upperRoot = null;
      this.iterations += 1;
    }
    // Dependency caches are owned by the same context, and survive interruptions.
    const pi = scaledIntervalFromRationalBounds(
      getPiRationalInterval(context, job.workingDigits),
      job.workingDigits
    );
    const ln2 = scaledIntervalFromRationalBounds(
      getLn2RationalInterval(context, job.workingDigits),
      job.workingDigits
    );
    this.checkpoint(context);
    if (job.bLower <= 0n) throw new InternalCalculationException("AGM lower mean vanished");
    const kLower = (pi.lower * job.scale) / (2n * job.aUpper);
    const kUpper = ceilDiv(pi.upper * job.scale, 2n * job.bLower);
    const uSquared = job.uUpper * job.uUpper;
    const error = ceilDiv(
      BigInt(job.shift + 2) * uSquared * job.scale,
      job.scale * job.scale - uSquared
    );
    const result = scaledIntervalToRationalBounds(
      createScaledInterval(
        kLower - error - BigInt(job.shift) * ln2.upper,
        kUpper - BigInt(job.shift) * ln2.lower,
        job.workingDigits
      )
    );
    this.cached = result;
    this.highestDigits = job.digits;
    this.job = null;
    return digits > job.digits ? this.getInterval(digits, context) : result;
  }
  getSnapshot() {
    const job = this.job;
    const values =
      job === null
        ? []
        : [
            job.scale,
            job.aLower,
            job.aUpper,
            job.bLower,
            job.bUpper,
            job.uUpper,
            ...(job.lowerRoot === null ? [] : [job.lowerRoot.radicand, job.lowerRoot.value]),
            ...(job.upperRoot === null ? [] : [job.upperRoot.radicand, job.upperRoot.value])
          ];
    if (this.cached !== null)
      values.push(
        this.cached.lower.numerator,
        this.cached.lower.denominator,
        this.cached.upper.numerator,
        this.cached.upper.denominator
      );
    return {
      workingDigits: this.workingDigits,
      termCount: this.iterations,
      blockCount: this.rootIterations,
      checkpointCount: this.checkpoints,
      // Only a conservative preflight bound is available for this experiment.
      peakBigIntDigits: null,
      estimatedPeakBigIntDigits: this.peakDigits,
      retainedBigIntDigits: values.reduce(
        (n, value) => n + value.toString().replace("-", "").length,
        0
      ),
      pendingRoot: job?.lowerRoot !== null && job?.lowerRoot !== undefined
    };
  }
  private start(digits: number, context: EvaluationCheckpoint): Job {
    const shift = Math.ceil(((digits + 10) * Math.log2(10)) / 2) + 8;
    // The initial complementary modulus is tiny. Its absolute rounding error
    // becomes relative error before AGM contraction; guard against 1/u loss.
    // 2^m < 10^ceil(m/3) (since 8 < 10) is an integer-certified upper budget.
    const workingDigits = digits + Math.ceil(shift / 3) + 2 * String(shift).length + 30;
    context.guardBigIntDigits?.(
      workingDigits * 24 +
        this.argument.numerator.toString().length +
        this.argument.denominator.toString().length
    );
    this.checkpoint(context);
    const scale = decimalScale(workingDigits);
    const numerator = 4n * this.argument.denominator * scale;
    const denominator = this.argument.numerator << BigInt(shift);
    const bLower = numerator / denominator,
      bUpper = ceilDiv(numerator, denominator);
    if (bLower <= 0n || bUpper >= scale / 2n)
      throw new InternalCalculationException("AGM scaling is not certified");
    this.workingDigits = Math.max(this.workingDigits, workingDigits);
    // Conservative peak/aggregate guards cover all square-root and correction temporaries.
    this.peakDigits = Math.max(this.peakDigits, 3 * workingDigits + String(shift).length + 2);
    return {
      digits,
      workingDigits,
      shift,
      scale,
      uUpper: bUpper,
      stopGap: decimalScale(workingDigits - digits - 12) / (BigInt(shift) + 2n) ** 2n,
      aLower: scale,
      aUpper: scale,
      bLower,
      bUpper,
      lowerRoot: null,
      upperRoot: null
    };
  }
  private root(radicand: bigint): Root {
    return {
      radicand,
      value: 1n << BigInt(Math.ceil(radicand.toString(2).length / 2)),
      done: false
    };
  }
  private finishRoot(root: Root, control: EvaluationCheckpoint): bigint {
    while (!root.done) {
      this.checkpoint(control);
      const next = (root.value + root.radicand / root.value) / 2n;
      this.rootIterations += 1;
      if (next >= root.value) root.done = true;
      else root.value = next;
    }
    return root.value;
  }
  private checkpoint(control: EvaluationCheckpoint): void {
    this.checkpoints += 1;
    control.checkpoint();
  }
}
