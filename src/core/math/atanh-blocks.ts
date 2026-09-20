import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import {
  absRational,
  addRational,
  compareRational,
  createRational,
  divideRational,
  subtractRational
} from "../values/rational.js";
import { BinaryBlock } from "./binary-block.js";
import {
  ceilDiv,
  createScaledInterval,
  decimalScale,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";
import type { RationalBounds } from "./scaled-interval.js";

export type AtanhLayout = "sequential" | "rectangular" | "binary";
interface Pair {
  readonly lower: bigint;
  readonly upper: bigint;
}
interface Coefficient extends Pair {
  readonly denominator: bigint;
}
interface Job {
  readonly digits: number;
  readonly workingDigits: number;
  readonly scale: bigint;
  readonly z: Pair;
  readonly q: Pair;
  readonly baby: Pair[];
  giant: Pair | null;
  power: Pair;
  sum: Pair;
  index: number;
  innerIndex: number;
  inner: Pair;
  tree: BinaryBlock<Coefficient> | null;
  block: Pair | null;
}

/** Resumable positive atanh magnitude; sign is restored only on publication.
 * Baby powers are outward fixed point. Exact odd-denominator products remain
 * inside bounded coefficient blocks, using the same tree traversal as ln2.
 */
export class AtanhLogKernel {
  private readonly magnitude: Rational;
  private readonly negative: boolean;
  private job: Job | null = null;
  private cached: RationalBounds | null = null;
  private highestDigits = 0;
  private workingDigits = 0;
  private termCount = 0;
  private blockCount = 0;
  private combineCount = 0;
  private checkpointCount = 0;
  private largeMultiplications = 0;
  private largeDivisions = 0;
  private peakBigIntDigits = 1;
  private nextPeak = 10n;
  private passes = 0;

  constructor(
    readonly argument: Rational,
    readonly layout: AtanhLayout = "binary",
    readonly blockSize = 16
  ) {
    if (argument.numerator <= 0n)
      throw new InternalCalculationException("Atanh log requires a positive argument");
    const one = createRational(1n, 1n);
    const z = divideRational(subtractRational(argument, one), addRational(argument, one));
    this.negative = z.numerator < 0n;
    this.magnitude = absRational(z);
    if (
      compareRational(this.magnitude, createRational(1n, 3n)) > 0 ||
      !Number.isSafeInteger(blockSize) ||
      blockSize < 1
    ) {
      throw new InternalCalculationException(
        "Atanh block kernel requires |z| <= 1/3 and positive block size"
      );
    }
  }

  get pending(): boolean {
    return this.job !== null;
  }
  get pendingDigits(): number | null {
    return this.job?.digits ?? null;
  }
  get retainedDigitsUpperBound(): number {
    return (
      this.workingDigits * (this.pending ? 4 * this.blockSize + 24 : 7) +
      size(this.argument.numerator) +
      size(this.argument.denominator)
    );
  }

  getInterval(digits: number, control: EvaluationCheckpoint): RationalBounds {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid atanh precision");
    if (this.magnitude.numerator === 0n) {
      const zero = createRational(0n, 1n);
      return { lower: zero, upper: zero };
    }
    if (this.cached !== null && digits <= this.highestDigits) return this.cached;
    this.job ??= this.start(digits, control);
    const job = this.job;
    const width = this.layout === "sequential" ? 1 : this.blockSize;
    while (job.baby.length < width) {
      this.checkpoint(control);
      const last = job.baby.at(-1);
      if (last === undefined) throw new InternalCalculationException("Missing baby power");
      job.baby.push(this.product(last, job.q, job, control));
    }
    if (job.giant === null) {
      // Build q^m from the already computed z^(2m-1), multiplying by z.
      this.checkpoint(control);
      const last = job.baby.at(-1);
      if (last === undefined) throw new InternalCalculationException("Missing giant power");
      job.giant = this.product(last, job.z, job, control);
    }
    for (;;) {
      if (job.block === null) {
        if (this.layout === "binary") {
          job.tree ??= new BinaryBlock(0, width);
          const root = job.tree.run(
            {
              checkpoint: () => {
                this.checkpoint(control);
              }
            },
            (offset) => {
              const power = job.baby[offset];
              if (power === undefined)
                throw new InternalCalculationException("Missing coefficient power");
              this.termCount += 1;
              return { ...power, denominator: 2n * BigInt(job.index + offset) + 1n };
            },
            (left, right) => {
              const denominator = this.multiply(left.denominator, right.denominator, control);
              const lower =
                this.multiply(left.lower, right.denominator, control) +
                this.multiply(right.lower, left.denominator, control);
              const upper =
                this.multiply(left.upper, right.denominator, control) +
                this.multiply(right.upper, left.denominator, control);
              this.combineCount += 1;
              return { denominator, lower, upper };
            }
          );
          job.block = {
            lower: this.divide(root.lower, root.denominator, false, control),
            upper: this.divide(root.upper, root.denominator, true, control)
          };
        } else {
          while (job.innerIndex < width) {
            this.checkpoint(control);
            const power = job.baby[job.innerIndex];
            if (power === undefined)
              throw new InternalCalculationException("Missing rectangular power");
            const odd = 2n * BigInt(job.index + job.innerIndex) + 1n;
            const lower = this.divide(power.lower, odd, false, control);
            const upper = this.divide(power.upper, odd, true, control);
            job.inner = { lower: job.inner.lower + lower, upper: job.inner.upper + upper };
            job.innerIndex += 1;
            this.termCount += 1;
          }
          job.block = job.inner;
        }
      }
      this.checkpoint(control);
      const contribution = this.product(job.block, job.power, job, control);
      const nextPower = this.product(job.power, job.giant, job, control);
      const nextIndex = job.index + width;
      // 2*z/(1-z^2) <= 3 for |z|<=1/3. The power bound is outward,
      // so R_N <= 3*q^N/(2N+1), independent of the coefficient layout.
      const tail = this.divide(
        this.multiply(3n, nextPower.upper, control),
        2n * BigInt(nextIndex) + 1n,
        true,
        control
      );
      job.sum = {
        lower: job.sum.lower + contribution.lower,
        upper: job.sum.upper + contribution.upper
      };
      job.power = nextPower;
      job.index = nextIndex;
      job.block = null;
      job.tree = null;
      job.innerIndex = 0;
      job.inner = { lower: 0n, upper: 0n };
      this.blockCount += 1;
      if (tail <= 4n) {
        const lower = 2n * job.sum.lower,
          upper = 2n * job.sum.upper + tail;
        const result = scaledIntervalToRationalBounds(
          createScaledInterval(
            this.negative ? -upper : lower,
            this.negative ? -lower : upper,
            job.workingDigits
          )
        );
        this.cached =
          this.cached === null
            ? result
            : {
                lower:
                  compareRational(this.cached.lower, result.lower) > 0
                    ? this.cached.lower
                    : result.lower,
                upper:
                  compareRational(this.cached.upper, result.upper) < 0
                    ? this.cached.upper
                    : result.upper
              };
        this.highestDigits = job.digits;
        this.job = null;
        return digits > job.digits ? this.getInterval(digits, control) : this.cached;
      }
    }
  }

  getSnapshot() {
    const values: bigint[] = [this.argument.numerator, this.argument.denominator, this.nextPeak];
    if (this.cached !== null)
      values.push(
        this.cached.lower.numerator,
        this.cached.lower.denominator,
        this.cached.upper.numerator,
        this.cached.upper.denominator
      );
    const job = this.job;
    if (job !== null) {
      values.push(job.scale);
      const pairs = [...job.baby, job.q, job.z, job.power, job.sum, job.inner];
      if (job.block !== null) pairs.push(job.block);
      if (job.giant !== null) pairs.push(job.giant);
      for (const pair of pairs) values.push(pair.lower, pair.upper);
      for (const node of job.tree?.retained() ?? [])
        values.push(node.lower, node.upper, node.denominator);
    }
    return {
      workingDigits: this.workingDigits,
      termCount: this.termCount,
      blockCount: this.blockCount,
      combineCount: this.combineCount,
      checkpointCount: this.checkpointCount,
      largeMultiplications: this.largeMultiplications,
      largeDivisions: this.largeDivisions,
      peakBigIntDigits: this.peakBigIntDigits,
      retainedBigIntDigits: values.reduce((sum, value) => sum + size(value), 0),
      passes: this.passes,
      pendingPhase: job?.tree?.phase ?? (job === null ? "idle" : "block")
    };
  }

  private start(digits: number, control: EvaluationCheckpoint): Job {
    const workingDigits = digits + String(digits).length + 8;
    control.guardBigIntDigits?.(
      workingDigits * (4 * this.blockSize + 24) +
        size(this.magnitude.numerator) +
        size(this.magnitude.denominator)
    );
    this.checkpoint(control);
    const scale = decimalScale(workingDigits);
    const numerator = this.multiply(this.magnitude.numerator, scale, control);
    const z = {
      lower: this.divide(numerator, this.magnitude.denominator, false, control),
      upper: this.divide(numerator, this.magnitude.denominator, true, control)
    };
    this.workingDigits = Math.max(this.workingDigits, workingDigits);
    this.passes += 1;
    const job: Job = {
      digits,
      workingDigits,
      scale,
      z,
      q: { lower: 0n, upper: 0n },
      baby: [z],
      giant: null,
      power: { lower: scale, upper: scale },
      sum: { lower: 0n, upper: 0n },
      index: 0,
      innerIndex: 0,
      inner: { lower: 0n, upper: 0n },
      tree: null,
      block: null
    };
    return { ...job, q: this.product(z, z, job, control) };
  }

  private product(a: Pair, b: Pair, job: Job, control: EvaluationCheckpoint): Pair {
    return {
      lower: this.divide(this.multiply(a.lower, b.lower, control), job.scale, false, control),
      upper: this.divide(this.multiply(a.upper, b.upper, control), job.scale, true, control)
    };
  }
  private checkpoint(control: EvaluationCheckpoint): void {
    this.checkpointCount += 1;
    control.checkpoint();
  }
  private multiply(a: bigint, b: bigint, control: EvaluationCheckpoint): bigint {
    const estimate = upperDigits(a) + upperDigits(b);
    control.guardBigIntDigits?.(estimate);
    if (a >= LARGE_INTEGER || b >= LARGE_INTEGER) this.largeMultiplications += 1;
    const result = a * b;
    this.observe(result);
    return result;
  }
  private divide(a: bigint, b: bigint, up: boolean, control: EvaluationCheckpoint): bigint {
    const estimate = Math.max(upperDigits(a), upperDigits(b));
    control.guardBigIntDigits?.(estimate);
    this.observe(a);
    this.observe(b);
    if (a >= LARGE_INTEGER || b >= LARGE_INTEGER) this.largeDivisions += 1;
    return up ? ceilDiv(a, b) : a / b;
  }
  private observe(value: bigint): void {
    if (value >= this.nextPeak) {
      this.peakBigIntDigits = size(value);
      this.nextPeak = 10n ** BigInt(this.peakBigIntDigits);
    }
  }
}

function size(value: bigint): number {
  return value.toString().replace("-", "").length;
}
// 2^3 < 10: an outward allocation estimate without repeated decimal conversion.
function upperDigits(value: bigint): number {
  return Math.ceil(value.toString(2).length / 3) + 1;
}
const LARGE_INTEGER = 10n ** 99n;
