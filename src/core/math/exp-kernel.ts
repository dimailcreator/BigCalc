import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { BinaryBlock } from "./binary-block.js";
import { ceilDiv, createScaledInterval, decimalScale, rescaleScaled } from "./scaled-interval.js";
import type { ScaledInterval } from "./scaled-interval.js";

export type ExpLayout = "sequential" | "rectangular" | "binary";
interface Pair {
  lower: bigint;
  upper: bigint;
}
interface Node extends Pair {
  denominator: bigint;
}
interface Job {
  digits: number;
  work: number;
  scale: bigint;
  squarings: number;
  u: Pair;
  baby: Pair[];
  factorials: bigint[];
  denominator: bigint;
  index: number;
  sum: Pair;
  term: Pair;
  tree: BinaryBlock<Node> | null;
  inner: Pair;
  offset: number;
  phase: "powers" | "sum" | "square";
}

/** Positive fixed-point Taylor blocks followed by outward dyadic squaring.
 * All commits precede checkpoints; a suspended tree or square is retained.
 */
export class ExpKernel {
  private job: Job | null = null;
  private cached: ScaledInterval | null = null;
  private highest = 0;
  private terms = 0;
  private blocks = 0;
  private squares = 0;
  private passes = 0;
  private work = 0;
  private largeMultiplications = 0;
  private largeDivisions = 0;
  private peakBigIntDigits = 1;
  private nextPeak = 10n;
  constructor(
    readonly argument: Rational,
    readonly layout: ExpLayout = "binary",
    readonly dyadic?: number
  ) {
    if (argument.numerator < 0n || argument.numerator > 2n * argument.denominator)
      throw new InternalCalculationException("Small exp requires 0 <= argument <= 2");
    if (dyadic !== undefined && (!Number.isSafeInteger(dyadic) || dyadic < 1))
      throw new InternalCalculationException("Invalid exp dyadic reduction");
  }
  get pending() {
    return this.job !== null;
  }
  get retainedDigitsUpperBound() {
    return (
      (this.work + 1) * (this.pending ? this.liveStorageFactor : 6) +
      this.argument.numerator.toString().length +
      this.argument.denominator.toString().length
    );
  }
  private get liveStorageFactor() {
    return this.layout === "sequential" ? 24 : this.layout === "rectangular" ? 96 : 160;
  }
  getInterval(digits: number, control: EvaluationCheckpoint): ScaledInterval {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid exp precision");
    control.guardBigIntDigits?.(this.retainedDigitsUpperBound);
    if (this.cached !== null && digits <= this.highest) return rescaleScaled(this.cached, digits);
    if (this.argument.numerator === 0n) {
      control.guardBigIntDigits?.(2 * (digits + 1) + this.retainedDigitsUpperBound);
      control.checkpoint();
      const scale = decimalScale(digits);
      this.cached = createScaledInterval(scale, scale, digits);
      this.highest = digits;
      this.work = digits;
      this.observe(scale);
      return this.cached;
    }
    if (this.job === null) {
      const s =
        this.dyadic ??
        (this.layout === "sequential" ? 1 : Math.max(1, Math.ceil(Math.sqrt(digits))));
      // Squaring amplifies absolute error by at most 2^(s+4) for exp(r)<=exp(2).
      const work = digits + Math.ceil(s / 3) + 2 * String(digits).length + 16;
      control.guardBigIntDigits?.(
        (work + 1) * this.liveStorageFactor +
          this.retainedDigitsUpperBound +
          this.argument.numerator.toString().length +
          this.argument.denominator.toString().length
      );
      control.checkpoint();
      const scale = decimalScale(work),
        denominator = this.argument.denominator << BigInt(s);
      const numerator = this.argument.numerator * scale;
      this.observe(numerator);
      this.observe(denominator);
      const u = { lower: numerator / denominator, upper: ceilDiv(numerator, denominator) };
      this.job = {
        digits,
        work,
        scale,
        squarings: s,
        u,
        baby: [{ lower: scale, upper: scale }],
        factorials: [1n],
        denominator: 1n,
        index: 0,
        sum: { lower: 0n, upper: 0n },
        term: { lower: scale, upper: scale },
        tree: null,
        inner: { lower: 0n, upper: 0n },
        offset: 0,
        phase: "powers"
      };
      this.work = work;
      this.passes += 1;
    }
    const j = this.job;
    const width = this.layout === "sequential" ? 1 : 16;
    const product = (a: Pair, b: Pair): Pair => ({
      lower: this.divide(this.multiply(a.lower, b.lower), j.scale, false),
      upper: this.divide(this.multiply(a.upper, b.upper), j.scale, true)
    });
    while (j.baby.length <= width) {
      control.checkpoint();
      const previous = j.baby.at(-1);
      if (previous === undefined) throw new InternalCalculationException("Missing exp power");
      j.baby.push(product(previous, j.u));
    }
    if (j.phase === "powers") j.phase = "sum";
    while (j.phase === "sum") {
      // Coefficients relative to term n: u^i / ((n+1)...(n+i)).
      while (j.factorials.length <= width) {
        control.checkpoint();
        j.denominator *= BigInt(j.index + j.factorials.length);
        j.factorials.push(j.denominator);
      }
      let block: Pair;
      if (this.layout === "binary") {
        j.tree ??= new BinaryBlock<Node>(0, width);
        const root = j.tree.run(
          control,
          (i) => {
            const power = j.baby[i],
              denominator = j.factorials[i];
            if (power === undefined || denominator === undefined)
              throw new InternalCalculationException("Missing exp coefficient");
            this.terms += 1;
            return { ...power, denominator };
          },
          (a, b) => ({
            lower: this.multiply(a.lower, b.denominator) + this.multiply(b.lower, a.denominator),
            upper: this.multiply(a.upper, b.denominator) + this.multiply(b.upper, a.denominator),
            denominator: this.multiply(a.denominator, b.denominator)
          })
        );
        block = {
          lower: this.divide(root.lower, root.denominator, false),
          upper: this.divide(root.upper, root.denominator, true)
        };
      } else {
        while (j.offset < width) {
          control.checkpoint();
          const power = j.baby[j.offset],
            denominator = j.factorials[j.offset];
          if (power === undefined || denominator === undefined)
            throw new InternalCalculationException("Missing exp coefficient");
          j.inner = {
            lower: j.inner.lower + this.divide(power.lower, denominator, false),
            upper: j.inner.upper + this.divide(power.upper, denominator, true)
          };
          j.offset += 1;
          this.terms += 1;
        }
        block = j.inner;
      }
      control.checkpoint();
      const contribution = product(j.term, block),
        giant = j.baby[width];
      if (giant === undefined) throw new InternalCalculationException("Missing exp giant power");
      const next = product(j.term, giant);
      j.term = {
        lower: this.divide(next.lower, j.denominator, false),
        upper: this.divide(next.upper, j.denominator, true)
      };
      j.sum = { lower: j.sum.lower + contribution.lower, upper: j.sum.upper + contribution.upper };
      j.index += width;
      this.blocks += 1;
      // u<=1 and n>=1: subsequent term ratios <=1/2, hence tail <=2*term_n.
      const tail = 2n * j.term.upper;
      j.tree = null;
      j.inner = { lower: 0n, upper: 0n };
      j.offset = 0;
      j.factorials = [1n];
      j.denominator = 1n;
      if (tail <= 4n) {
        j.sum.upper += tail;
        j.phase = "square";
      }
    }
    while (j.squarings > 0) {
      control.checkpoint();
      j.sum = product(j.sum, j.sum);
      j.squarings -= 1;
      this.squares += 1;
    }
    let result = createScaledInterval(j.sum.lower, j.sum.upper, j.work);
    this.observe(j.sum.upper);
    if (this.cached !== null) {
      const old = rescaleScaled(this.cached, j.work);
      result = createScaledInterval(
        result.lower > old.lower ? result.lower : old.lower,
        result.upper < old.upper ? result.upper : old.upper,
        j.work
      );
    }
    this.cached = result;
    this.highest = j.digits;
    this.job = null;
    return digits > this.highest
      ? this.getInterval(digits, control)
      : rescaleScaled(result, digits);
  }
  getSnapshot() {
    const values = [this.argument.numerator, this.argument.denominator, this.nextPeak];
    if (this.cached !== null) values.push(this.cached.lower, this.cached.upper);
    if (this.job !== null) {
      const j = this.job;
      values.push(j.scale, j.denominator, ...j.factorials);
      for (const pair of [...j.baby, j.u, j.sum, j.term, j.inner])
        values.push(pair.lower, pair.upper);
      for (const node of j.tree?.retained() ?? [])
        values.push(node.lower, node.upper, node.denominator);
    }
    return {
      workingDigits: this.work,
      termCount: this.terms,
      blockCount: this.blocks,
      squaringCount: this.squares,
      passes: this.passes,
      pendingPhase: this.job?.phase ?? "idle",
      treePhase: this.job?.tree?.phase ?? null,
      largeMultiplications: this.largeMultiplications,
      largeDivisions: this.largeDivisions,
      peakBigIntDigits: this.peakBigIntDigits,
      retainedBigIntDigits: values.reduce((sum, value) => sum + value.toString().length, 0),
      estimatedRetainedBigIntDigits: this.retainedDigitsUpperBound
    };
  }
  private multiply(a: bigint, b: bigint): bigint {
    if (a >= LARGE || b >= LARGE) this.largeMultiplications += 1;
    const result = a * b;
    this.observe(result);
    return result;
  }
  private divide(a: bigint, b: bigint, up: boolean): bigint {
    if (a >= LARGE || b >= LARGE) this.largeDivisions += 1;
    this.observe(a);
    this.observe(b);
    return up ? ceilDiv(a, b) : a / b;
  }
  private observe(value: bigint): void {
    if (value >= this.nextPeak) {
      this.peakBigIntDigits = value.toString().length;
      this.nextPeak = 10n ** BigInt(this.peakBigIntDigits);
    }
  }
}
const LARGE = 10n ** 99n;
