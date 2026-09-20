import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { BinaryBlock } from "./binary-block.js";
import {
  ceilDiv,
  floorDiv,
  createScaledInterval,
  decimalScale,
  rescaleScaled
} from "./scaled-interval.js";
import type { ScaledInterval } from "./scaled-interval.js";

export type SinCosMode = "sin" | "cos" | "both";
export type SinCosLayout = "sequential" | "rectangular" | "binary";
export interface SinCosScaled {
  sin: ScaledInterval | null;
  cos: ScaledInterval | null;
}
interface Pair {
  lower: bigint;
  upper: bigint;
}
interface Node extends Pair {
  denominator: bigint;
}
interface Series {
  parity: 0 | 1;
  index: number;
  term: Pair;
  sum: Pair;
  factorials: bigint[];
  denominator: bigint;
  offset: number;
  inner: Pair;
  tree: BinaryBlock<Node> | null;
  done: boolean;
}
interface Job {
  digits: number;
  work: number;
  scale: bigint;
  u: Pair;
  q: Pair;
  baby: Pair[];
  series: Series[];
  squarings: number;
  phase: "powers" | "sum" | "double";
}

/** Shared outward powers with independently selectable alternating factorial sums.
 * A bounded exact coefficient tree is used only within a block. No common
 * denominator spans the entire Taylor sum or the double-angle reconstruction.
 */
export class SinCosKernel {
  private job: Job | null = null;
  private cached: SinCosScaled | null = null;
  private highest = 0;
  private work = 0;
  private terms = 0;
  private blocks = 0;
  private doubles = 0;
  private passes = 0;
  private sinSeries = 0;
  private cosSeries = 0;
  private multiplications = 0;
  private divisions = 0;
  private peak = 1;
  private nextPeak = 10n;
  constructor(
    readonly argument: Rational,
    readonly mode: SinCosMode = "both",
    readonly layout: SinCosLayout = "binary",
    readonly dyadic?: number
  ) {
    if (abs(argument.numerator) > argument.denominator)
      throw new InternalCalculationException("Small sincos requires |x| <= 1");
    if (
      dyadic !== undefined &&
      (!Number.isSafeInteger(dyadic) || dyadic < 0 || (mode === "sin" && dyadic !== 0))
    )
      throw new InternalCalculationException("Invalid selective sincos reduction");
  }
  get pending() {
    return this.job !== null;
  }
  private get storageFactor() {
    return this.layout === "sequential" ? 32 : this.layout === "rectangular" ? 128 : 224;
  }
  get retainedDigitsUpperBound() {
    return (
      (this.work + 1) * (this.pending ? this.storageFactor : 8) +
      this.argument.numerator.toString().length +
      this.argument.denominator.toString().length
    );
  }
  getInterval(digits: number, control: EvaluationCheckpoint): SinCosScaled {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid sincos precision");
    control.guardBigIntDigits?.(this.retainedDigitsUpperBound);
    if (this.cached !== null && digits <= this.highest) return rescale(this.cached, digits);
    if (this.job === null) {
      const s =
        this.dyadic ??
        (this.mode === "sin" || this.layout === "sequential"
          ? 0
          : Math.ceil(Math.sqrt(digits) / 2));
      // The double-angle maps amplify endpoint errors by at most roughly 4^s.
      // This only plans precision; every product and subtraction remains outward.
      const work = digits + Math.ceil((2 * s) / 3) + 2 * String(digits).length + 16;
      control.guardBigIntDigits?.(
        (work + 1) * this.storageFactor +
          this.retainedDigitsUpperBound +
          this.argument.numerator.toString().length +
          this.argument.denominator.toString().length
      );
      control.checkpoint();
      const scale = decimalScale(work),
        denominator = this.argument.denominator << BigInt(s);
      const numerator = this.multiply(abs(this.argument.numerator), scale);
      const u = {
        lower: this.divide(numerator, denominator, false),
        upper: this.divide(numerator, denominator, true)
      };
      const q = this.product(u, u, scale);
      const series: Series[] = [];
      if (this.mode !== "cos") {
        series.push(this.series(1, u));
        this.sinSeries += 1;
      }
      if (this.mode !== "sin") {
        series.push(this.series(0, { lower: scale, upper: scale }));
        this.cosSeries += 1;
      }
      this.job = {
        digits,
        work,
        scale,
        u,
        q,
        baby: [{ lower: scale, upper: scale }],
        series,
        squarings: s,
        phase: "powers"
      };
      this.work = work;
      this.passes += 1;
    }
    const j = this.job,
      width = this.layout === "sequential" ? 1 : 16;
    while (j.baby.length <= width) {
      control.checkpoint();
      const previous = j.baby.at(-1);
      if (previous === undefined)
        throw new InternalCalculationException("Missing sincos baby power");
      j.baby.push(this.product(previous, j.q, j.scale));
    }
    if (j.phase === "powers") j.phase = "sum";
    for (const series of j.series)
      while (!series.done) {
        while (series.factorials.length <= width) {
          control.checkpoint();
          const last = BigInt(2 * (series.index + series.factorials.length) + series.parity);
          series.denominator *= last * (last - 1n);
          series.factorials.push(series.denominator);
        }
        let block: Pair;
        if (this.layout === "binary") {
          series.tree ??= new BinaryBlock<Node>(0, width);
          const root = series.tree.run(
            control,
            (i) => {
              const power = j.baby[i],
                denominator = series.factorials[i];
              if (power === undefined || denominator === undefined)
                throw new InternalCalculationException("Missing sincos coefficient");
              this.terms += 1;
              return { ...((series.index + i) % 2 === 0 ? power : negate(power)), denominator };
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
          while (series.offset < width) {
            control.checkpoint();
            const power = j.baby[series.offset],
              denominator = series.factorials[series.offset];
            if (power === undefined || denominator === undefined)
              throw new InternalCalculationException("Missing sincos coefficient");
            const signed = (series.index + series.offset) % 2 === 0 ? power : negate(power);
            series.inner = {
              lower: series.inner.lower + this.divide(signed.lower, denominator, false),
              upper: series.inner.upper + this.divide(signed.upper, denominator, true)
            };
            series.offset += 1;
            this.terms += 1;
          }
          block = series.inner;
        }
        control.checkpoint();
        const giant = j.baby[width];
        if (giant === undefined)
          throw new InternalCalculationException("Missing sincos giant power");
        const contribution = this.product(series.term, block, j.scale),
          next = this.product(series.term, giant, j.scale);
        series.term = {
          lower: this.divide(next.lower, series.denominator, false),
          upper: this.divide(next.upper, series.denominator, true)
        };
        series.sum = {
          lower: series.sum.lower + contribution.lower,
          upper: series.sum.upper + contribution.upper
        };
        series.index += width;
        this.blocks += 1;
        // For |u|<=1, factorial term magnitudes decrease. The alternating
        // remainder is bounded in absolute value by the first omitted term.
        const tail = series.term.upper;
        series.tree = null;
        series.offset = 0;
        series.inner = { lower: 0n, upper: 0n };
        series.factorials = [1n];
        series.denominator = 1n;
        if (tail <= 2n) {
          series.sum = clip(
            { lower: series.sum.lower - tail, upper: series.sum.upper + tail },
            j.scale
          );
          series.done = true;
        }
      }
    j.phase = "double";
    const sine = j.series.find((series) => series.parity === 1),
      cosine = j.series.find((series) => series.parity === 0);
    while (j.squarings > 0) {
      control.checkpoint();
      if (cosine === undefined)
        throw new InternalCalculationException("Sine-only doubling requires a second branch");
      const squared = this.product(cosine.sum, cosine.sum, j.scale);
      const nextCos = clip(
        { lower: 2n * squared.lower - j.scale, upper: 2n * squared.upper - j.scale },
        j.scale
      );
      if (sine !== undefined) {
        const mixed = this.product(sine.sum, cosine.sum, j.scale);
        sine.sum = clip({ lower: 2n * mixed.lower, upper: 2n * mixed.upper }, j.scale);
      }
      cosine.sum = nextCos;
      j.squarings -= 1;
      this.doubles += 1;
    }
    const output = (series: Series | undefined, negative: boolean): ScaledInterval | null => {
      if (series === undefined) return null;
      const pair = negative ? negate(series.sum) : series.sum;
      this.observe(pair.lower);
      this.observe(pair.upper);
      return createScaledInterval(pair.lower, pair.upper, j.work);
    };
    let result: SinCosScaled = {
      sin: output(sine, this.argument.numerator < 0n),
      cos: output(cosine, false)
    };
    if (this.cached !== null)
      result = {
        sin: intersect(result.sin, this.cached.sin),
        cos: intersect(result.cos, this.cached.cos)
      };
    this.cached = result;
    this.highest = j.digits;
    this.job = null;
    return digits > this.highest ? this.getInterval(digits, control) : rescale(result, digits);
  }
  getSnapshot() {
    const values = [this.argument.numerator, this.argument.denominator, this.nextPeak];
    for (const interval of [this.cached?.sin, this.cached?.cos])
      if (interval) values.push(interval.lower, interval.upper);
    if (this.job !== null) {
      const j = this.job;
      values.push(j.scale);
      for (const pair of [j.u, j.q, ...j.baby]) values.push(pair.lower, pair.upper);
      for (const series of j.series) {
        values.push(series.denominator, ...series.factorials);
        for (const pair of [series.term, series.sum, series.inner])
          values.push(pair.lower, pair.upper);
        for (const node of series.tree?.retained() ?? [])
          values.push(node.lower, node.upper, node.denominator);
      }
    }
    return {
      workingDigits: this.work,
      termCount: this.terms,
      blockCount: this.blocks,
      doubleAngleCount: this.doubles,
      passes: this.passes,
      sinSeriesEvaluations: this.sinSeries,
      cosSeriesEvaluations: this.cosSeries,
      sharedSquareEvaluations: this.passes,
      largeMultiplications: this.multiplications,
      largeDivisions: this.divisions,
      peakBigIntDigits: this.peak,
      retainedBigIntDigits: values.reduce((sum, value) => sum + abs(value).toString().length, 0),
      pendingPhase: this.job?.phase ?? "idle",
      treePhase: this.job?.series.find((s) => s.tree !== null)?.tree?.phase ?? null
    };
  }
  private series(parity: 0 | 1, term: Pair): Series {
    return {
      parity,
      index: 0,
      term,
      sum: { lower: 0n, upper: 0n },
      factorials: [1n],
      denominator: 1n,
      offset: 0,
      inner: { lower: 0n, upper: 0n },
      tree: null,
      done: false
    };
  }
  private multiply(a: bigint, b: bigint): bigint {
    if (abs(a) >= LARGE || abs(b) >= LARGE) this.multiplications += 1;
    const result = a * b;
    this.observe(result);
    return result;
  }
  private divide(a: bigint, b: bigint, up: boolean): bigint {
    if (abs(a) >= LARGE || b >= LARGE) this.divisions += 1;
    this.observe(a);
    this.observe(b);
    return up ? ceilDiv(a, b) : floorDiv(a, b);
  }
  private observe(value: bigint) {
    const magnitude = abs(value);
    if (magnitude >= this.nextPeak) {
      this.peak = magnitude.toString().length;
      this.nextPeak = 10n ** BigInt(this.peak);
    }
  }
  private product(a: Pair, b: Pair, scale: bigint): Pair {
    if (a.lower >= 0n && b.lower >= 0n)
      return {
        lower: this.divide(this.multiply(a.lower, b.lower), scale, false),
        upper: this.divide(this.multiply(a.upper, b.upper), scale, true)
      };
    const products = [
      this.multiply(a.lower, b.lower),
      this.multiply(a.lower, b.upper),
      this.multiply(a.upper, b.lower),
      this.multiply(a.upper, b.upper)
    ];
    return {
      lower: this.divide(
        products.reduce((a, b) => (a < b ? a : b)),
        scale,
        false
      ),
      upper: this.divide(
        products.reduce((a, b) => (a > b ? a : b)),
        scale,
        true
      )
    };
  }
}
function abs(value: bigint) {
  return value < 0n ? -value : value;
}
function negate(pair: Pair): Pair {
  return { lower: -pair.upper, upper: -pair.lower };
}
// All partial double-angle arguments lie in [0,1], where sin and cos are in [0,1].
function clip(pair: Pair, scale: bigint): Pair {
  return {
    lower: pair.lower < 0n ? 0n : pair.lower,
    upper: pair.upper > scale ? scale : pair.upper
  };
}
function intersect(next: ScaledInterval | null, previous: ScaledInterval | null) {
  if (next === null || previous === null) return next;
  const old = rescaleScaled(previous, next.scaleDigits);
  return createScaledInterval(
    next.lower > old.lower ? next.lower : old.lower,
    next.upper < old.upper ? next.upper : old.upper,
    next.scaleDigits
  );
}
function rescale(value: SinCosScaled, digits: number): SinCosScaled {
  return {
    sin: value.sin === null ? null : rescaleScaled(value.sin, digits),
    cos: value.cos === null ? null : rescaleScaled(value.cos, digits)
  };
}
const LARGE = 10n ** 99n;
