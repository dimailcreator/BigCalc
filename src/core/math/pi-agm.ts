import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import {
  createScaledInterval,
  floorDiv,
  ceilDiv,
  rescaleScaled,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";
import type { ScaledInterval, RationalBounds } from "./scaled-interval.js";
import { piProduct, countPiSqrt } from "./pi-instrumentation.js";

// Positive interval square root at a fixed scale. Newton's integer frontier
// survives checkpoints. The upper endpoint follows (r+h)^2 >= r^2+2rh.
class Root {
  private estimate: bigint;
  private result: { lower: bigint; upper: bigint } | null = null;
  iterations = 0;
  constructor(
    readonly lower: bigint,
    readonly upper: bigint
  ) {
    if (lower <= 0n || lower > upper) throw new InternalCalculationException("Invalid AGM root");
    this.estimate = 1n << BigInt(Math.ceil(lower.toString(2).length / 2));
  }
  finish(context: EvaluationCheckpoint) {
    if (this.result !== null) return this.result;
    for (;;) {
      context.checkpoint();
      const next = (this.estimate + this.lower / this.estimate) / 2n;
      this.iterations++;
      if (next >= this.estimate) break;
      this.estimate = next;
    }
    const r = this.estimate;
    this.result = { lower: r, upper: r + ceilDiv(this.upper - piProduct(r, r, context), 2n * r) };
    return this.result;
  }
  get retainedDigits() {
    return [this.lower, this.upper, this.estimate, this.result?.upper ?? 0n].reduce(
      (n, v) => n + v.toString().length,
      0
    );
  }
}
interface Pair {
  lower: bigint;
  upper: bigint;
}
interface Job {
  digits: number;
  p: number;
  scale: bigint;
  a: Pair;
  b: Pair | null;
  t: Pair;
  weight: bigint;
  iterations: number;
  root: Root | null;
}

/** Gauss–Legendre provider; no dependency on the Chudnovsky path.
 * See ENGINEERING-AR-7-PI-AGM.md for the geometric remainder certificate. */
export class AgmPiProvider {
  private job: Job | null = null;
  private cached: ScaledInterval | null = null;
  private completedDigits = 0;
  private iterations = 0;
  private passes = 0;
  private cacheHits = 0;
  private newtonIterations = 0;
  private lastNewtonIterations = 0;
  private peakBigIntDigits = 0;
  private guardDigits: number;

  // Internal test hook exercises scale recovery; this is not a user precision setting.
  constructor(initialGuardDigits = 32) {
    if (!Number.isSafeInteger(initialGuardDigits) || initialGuardDigits < 4)
      throw new InternalCalculationException("Invalid AGM guard scale");
    this.guardDigits = initialGuardDigits;
  }

  canServe(digits: number): boolean {
    return this.cached !== null && digits <= this.completedDigits;
  }

  getInterval(digits: number, context: EvaluationCheckpoint): RationalBounds {
    return scaledIntervalToRationalBounds(this.getScaledInterval(digits, context));
  }
  getScaledInterval(digits: number, context: EvaluationCheckpoint): ScaledInterval {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid AGM precision");
    if (this.cached !== null && digits <= this.completedDigits) {
      this.cacheHits++;
      return this.cached;
    }
    for (;;) {
      if (this.job === null) {
        const p = digits + this.guardDigits;
        context.guardBigIntDigits?.(96 * p + this.getSnapshot().retainedBigIntDigits);
        context.checkpoint();
        const scale = 10n ** BigInt(p);
        const square = piProduct(scale, scale, context);
        this.peakBigIntDigits = Math.max(this.peakBigIntDigits, square.toString().length);
        const radicand = square / 2n;
        this.job = {
          digits,
          p,
          scale,
          a: { lower: scale, upper: scale },
          b: null,
          t: { lower: scale / 4n, upper: scale / 4n },
          weight: 1n,
          iterations: 0,
          root: new Root(radicand, radicand)
        };
        countPiSqrt(context);
        this.passes++;
      }
      const j = this.job;
      context.guardBigIntDigits?.(96 * j.p + this.getSnapshot().retainedBigIntDigits);
      const mul = (a: bigint, b: bigint) => {
        const value = piProduct(a, b, context);
        this.peakBigIntDigits = Math.max(this.peakBigIntDigits, value.toString().length);
        return value;
      };
      const finishRoot = (root: Root) => {
        try {
          return root.finish(context);
        } finally {
          this.newtonIterations += root.iterations - this.lastNewtonIterations;
          this.lastNewtonIterations = root.iterations;
        }
      };
      if (j.b === null) {
        if (j.root === null) throw new InternalCalculationException("Missing initial AGM root");
        j.b = finishRoot(j.root);
        j.root = null;
        this.lastNewtonIterations = 0;
      }
      // Exact AGM gap contracts by at least 1/2, so the remaining t decrement
      // is <= 2^(n-1) (a_n-b_n)^2. Every endpoint below is directed outward.
      const gap = j.a.upper - j.b.lower;
      const tail = ceilDiv(j.weight * mul(gap, gap), 2n * j.scale);
      const denominator = j.t.lower - tail;
      if (denominator > 0n) {
        const lo = floorDiv(mul(j.b.lower, j.b.lower), j.t.upper);
        const hi = ceilDiv(mul(j.a.upper, j.a.upper), denominator);
        if (hi - lo <= 10n ** BigInt(j.p - j.digits - 4)) {
          this.cached = rescaleScaled(createScaledInterval(lo, hi, j.p), j.digits + 2);
          this.completedDigits = j.digits;
          this.job = null;
          if (digits <= this.completedDigits) return this.cached;
          continue;
        }
      }
      context.checkpoint();
      const nextA = {
        lower: floorDiv(j.a.lower + j.b.lower, 2n),
        upper: ceilDiv(j.a.upper + j.b.upper, 2n)
      };
      if (j.root === null) {
        j.root = new Root(mul(j.a.lower, j.b.lower), mul(j.a.upper, j.b.upper));
        countPiSqrt(context);
      }
      const nextB = finishRoot(j.root);
      const diffLo = j.a.lower > j.b.upper ? j.a.lower - j.b.upper : 0n;
      const correctionLo = floorDiv(j.weight * mul(diffLo, diffLo), 4n * j.scale);
      const correctionHi = ceilDiv(j.weight * mul(gap, gap), 4n * j.scale);
      j.t = { lower: j.t.lower - correctionHi, upper: j.t.upper - correctionLo };
      j.a = nextA;
      j.b = nextB;
      j.weight *= 2n;
      j.iterations++;
      this.iterations++;
      j.root = null;
      this.lastNewtonIterations = 0;
      // Precision cannot be inferred from the iteration count. If rounding
      // dominates, restart at a larger scale, retaining the last valid output.
      if (gap <= 10n * j.weight && j.iterations > 4) {
        this.guardDigits += 32;
        this.job = null;
        continue;
      }
    }
  }
  getSnapshot() {
    const j = this.job;
    const values: bigint[] = this.cached === null ? [] : [this.cached.lower, this.cached.upper];
    if (j !== null) values.push(j.scale, j.a.lower, j.a.upper, j.t.lower, j.t.upper, j.weight);
    if (j?.b !== null && j?.b !== undefined) values.push(j.b.lower, j.b.upper);
    const sizes = values.map((v) => v.toString().length);
    this.peakBigIntDigits = Math.max(this.peakBigIntDigits, ...sizes);
    return {
      workingDigits: j?.p ?? this.completedDigits + this.guardDigits,
      iterations: this.iterations,
      passes: this.passes,
      cacheHits: this.cacheHits,
      newtonIterations: this.newtonIterations,
      pending: j !== null,
      pendingIterations: j?.iterations ?? 0,
      retainedBigIntDigits: sizes.reduce((a, b) => a + b, 0) + (j?.root?.retainedDigits ?? 0),
      peakBigIntDigits: this.peakBigIntDigits
    };
  }
}
