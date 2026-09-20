import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import { InternalCalculationException } from "../errors/index.js";
import { compareRational } from "../values/rational.js";
import {
  createScaledInterval,
  decimalScale,
  rescaleScaled,
  scaledIntervalToRationalBounds
} from "./scaled-interval.js";
import type { RationalBounds } from "./scaled-interval.js";

export type Ln2Layout = "rectangular" | "binary";
export type Ln2Retention = "persistent" | "rebuild";

interface Block {
  // p=9^(b-a), q=product(2k+1), t/q=sum 9^(b-1-k)/(2k+1).
  readonly p: bigint;
  readonly q: bigint;
  readonly t: bigint;
}
interface Frame {
  readonly start: number;
  readonly end: number;
  left: Block | null;
  right: Block | null;
  phase: "left" | "right" | "combine";
}
interface Job {
  readonly digits: number;
  readonly terms: number;
  readonly workingDigits: number;
  readonly scale: bigint;
  readonly tailScale: bigint;
  planned: number;
  planningExponent: number;
  planningPower: bigint;
  nextPower: bigint;
  tailDenominator: bigint | null;
  index: number;
  power: bigint;
  lower: bigint;
  upper: bigint;
  block: Block | null;
  rectangularIndex: number;
  rectangular: Block;
  readonly stack: Frame[];
}

/** Same atanh series and geometric remainder, with bounded exact coefficient blocks.
 * All state transitions commit between checkpoints. Retrying a paused request never
 * restarts its block, tree traversal, summation, or tail planning.
 */
export class SplittingLn2Provider {
  private readonly blocks: Block[] = [];
  private job: Job | null = null;
  private cached: RationalBounds | null = null;
  private highestRequestedDigits = 0;
  private completedTerms = 0;
  private lastRefinementAddedTerms = 0;
  private intervalRequests = 0;
  private cacheHits = 0;
  private summationPasses = 0;
  private termCount = 0;
  private blockCount = 0;
  private combineCount = 0;
  private reusedBlocks = 0;
  private largeMultiplications = 0;
  private largeDivisions = 0;
  private checkpointCount = 0;
  private peakBigIntDigits = 1;
  private workingDigits = 0;
  private frontierPower = 3n;

  constructor(
    readonly layout: Ln2Layout = "binary",
    readonly retention: Ln2Retention = "rebuild",
    readonly blockSize = 32
  ) {
    if (!Number.isSafeInteger(blockSize) || blockSize < 1) {
      throw new InternalCalculationException("Invalid ln2 block size");
    }
  }

  getInterval(digits: number, control: EvaluationCheckpoint): RationalBounds {
    if (!Number.isSafeInteger(digits) || digits < 1 || digits > Number.MAX_SAFE_INTEGER - 100) {
      throw new InternalCalculationException("Invalid ln2 precision");
    }
    this.intervalRequests += 1;
    if (this.cached !== null && digits <= this.highestRequestedDigits) {
      this.cacheHits += 1;
      this.lastRefinementAddedTerms = 0;
      return this.cached;
    }
    // Finish an interrupted request even if its caller subsequently asks for more.
    // Never throw away partial work or the previous verified enclosure.
    this.job ??= this.start(digits, control);
    const job = this.job;
    while (job.planned < job.terms) {
      this.checkpoint(control);
      const remaining = Math.floor(job.planningExponent / 2);
      const nextPower =
        job.planningExponent % 2 === 1
          ? this.multiply(job.nextPower, job.planningPower, control)
          : job.nextPower;
      const planningPower =
        remaining > 0 ? this.multiply(job.planningPower, job.planningPower, control) : 1n;
      job.nextPower = nextPower;
      job.planningPower = planningPower;
      job.planningExponent = remaining;
      if (remaining === 0) job.planned = job.terms;
    }
    // The logarithm used by the planner is only a cost heuristic. This exact
    // inequality proves R_N <= 10^-(digits+2), independent of the block layout.
    job.tailDenominator ??= this.multiply(
      4n * (2n * BigInt(job.terms) + 1n),
      job.nextPower,
      control
    );
    const tailDenominator = job.tailDenominator;
    if (this.multiply(9n, job.tailScale, control) > tailDenominator) {
      throw new InternalCalculationException("ln2 term planner failed its exact tail proof");
    }
    while (job.index < job.terms) {
      if (job.block === null) {
        const cachedBlock = this.blocks[job.index / this.blockSize];
        if (cachedBlock !== undefined) {
          this.checkpoint(control);
          job.block = cachedBlock;
          this.reusedBlocks += 1;
        } else if (this.layout === "rectangular") {
          this.buildRectangular(job, control);
        } else {
          this.buildBinary(job, control);
        }
      }
      const block = job.block;
      if (block === null) throw new InternalCalculationException("Missing ln2 block");
      this.checkpoint(control);
      // A block's exact contribution is 2*t/(3*9^a * 9^(m-1)*q).
      // Only this division is performed at the full requested scale.
      const denominator = this.multiply(
        this.multiply(job.power, this.divide(block.p, 9n, control), control),
        block.q,
        control
      );
      const numerator = this.multiply(this.multiply(2n, block.t, control), job.scale, control);
      const lower = this.divide(numerator, denominator, control);
      const upper = lower + (numerator % denominator === 0n ? 0n : 1n);
      const nextPower = this.multiply(job.power, block.p, control);
      if (this.retention === "persistent") this.blocks[job.index / this.blockSize] = block;
      job.lower += lower;
      job.upper += upper;
      job.power = nextPower;
      job.index += this.blockSize;
      job.block = null;
      job.rectangular = { p: 1n, q: 1n, t: 0n };
      job.rectangularIndex = 0;
      this.blockCount += 1;
    }
    this.checkpoint(control);
    const tailUpper = this.divide(
      this.multiply(9n, job.scale, control) + tailDenominator - 1n,
      tailDenominator,
      control
    );
    const result = scaledIntervalToRationalBounds(
      rescaleScaled(
        createScaledInterval(job.lower, job.upper + tailUpper, job.workingDigits),
        job.digits + 2
      )
    );
    // Intersect proved enclosures; refinement cannot discard an older proof.
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
    this.highestRequestedDigits = job.digits;
    this.lastRefinementAddedTerms = job.terms - this.completedTerms;
    this.completedTerms = job.terms;
    this.frontierPower = job.nextPower;
    this.job = null;
    return digits > job.digits ? this.getInterval(digits, control) : this.cached;
  }

  getSnapshot() {
    const job = this.job;
    const retained: bigint[] = [this.frontierPower];
    if (this.cached !== null)
      retained.push(
        this.cached.lower.numerator,
        this.cached.lower.denominator,
        this.cached.upper.numerator,
        this.cached.upper.denominator
      );
    const blockValues = (block: Block) => retained.push(block.p, block.q, block.t);
    this.blocks.forEach(blockValues);
    if (job !== null) {
      retained.push(
        job.scale,
        job.tailScale,
        job.nextPower,
        job.planningPower,
        job.power,
        job.lower,
        job.upper
      );
      blockValues(job.rectangular);
      if (job.tailDenominator !== null) retained.push(job.tailDenominator);
      if (job.block !== null) blockValues(job.block);
      for (const frame of job.stack) {
        if (frame.left !== null) blockValues(frame.left);
        if (frame.right !== null) blockValues(frame.right);
      }
    }
    const cachedBigIntDigits = retained.reduce((sum, value) => sum + decimalDigits(value), 0);
    return Object.freeze({
      algorithm: `${this.layout}-${this.retention}`,
      intervalRequests: this.intervalRequests,
      cacheHits: this.cacheHits,
      highestRequestedDigits: this.highestRequestedDigits,
      completedTerms: this.completedTerms,
      lastRefinementAddedTerms: this.lastRefinementAddedTerms,
      summationPasses: this.summationPasses,
      retainedGrowingDenominators: 0 as const,
      recurrenceStateBigIntCount: 1 as const,
      peakBigIntDigits: this.peakBigIntDigits,
      cachedBigIntDigits,
      retainedBigIntDigits: cachedBigIntDigits,
      workingDigits: this.workingDigits,
      termCount: this.termCount,
      blockCount: this.blockCount,
      combineCount: this.combineCount,
      reusedBlocks: this.reusedBlocks,
      largeMultiplications: this.largeMultiplications,
      largeDivisions: this.largeDivisions,
      checkpointCount: this.checkpointCount,
      pendingTerms: job?.index ?? 0,
      pendingStackDepth: job?.stack.length ?? 0,
      pendingPhase:
        job === null
          ? "idle"
          : job.planned < job.terms
            ? "planning"
            : (job.stack.at(-1)?.phase ?? "block")
    });
  }

  private start(digits: number, control: EvaluationCheckpoint): Job {
    const terms = Math.ceil((digits + 4) / Math.log10(9) / this.blockSize) * this.blockSize;
    const workingDigits = digits + String(terms).length + 5;
    if (!Number.isSafeInteger(terms) || !Number.isSafeInteger(workingDigits))
      throw new InternalCalculationException("ln2 precision overflow");
    // Conservative aggregate allocation estimate as well as per-operation guards.
    // Persistent coefficients cost O(N log N); rebuilding keeps only one block.
    const coefficientDigits =
      (this.retention === "persistent" ? terms : this.blockSize * 4) *
      (String(2 * terms + 1).length + 2);
    control.guardBigIntDigits?.(workingDigits * 16 + coefficientDigits * 4);
    this.checkpoint(control);
    this.summationPasses += 1;
    this.workingDigits = Math.max(this.workingDigits, workingDigits);
    const scale = decimalScale(workingDigits);
    this.peakBigIntDigits = Math.max(this.peakBigIntDigits, workingDigits + 1);
    return {
      digits,
      terms,
      workingDigits,
      scale,
      tailScale: decimalScale(digits + 2),
      planned: this.completedTerms,
      planningExponent: terms - this.completedTerms,
      planningPower: 9n,
      nextPower: this.frontierPower,
      tailDenominator: null,
      index: 0,
      power: 3n,
      lower: 0n,
      upper: 0n,
      block: null,
      rectangularIndex: 0,
      rectangular: { p: 1n, q: 1n, t: 0n },
      stack: []
    };
  }

  private buildRectangular(job: Job, control: EvaluationCheckpoint): void {
    // Forward Horner coefficients share powers of nine and an exact block denominator.
    while (job.rectangularIndex < this.blockSize) {
      this.checkpoint(control);
      const odd = 2n * BigInt(job.index + job.rectangularIndex) + 1n;
      const old = job.rectangular;
      const t = this.multiply(this.multiply(old.t, 9n, control), odd, control) + old.q;
      const q = this.multiply(old.q, odd, control);
      const p = this.multiply(old.p, 9n, control);
      job.rectangular = { p, q, t };
      job.rectangularIndex += 1;
      this.termCount += 1;
    }
    job.block = job.rectangular;
  }

  private buildBinary(job: Job, control: EvaluationCheckpoint): void {
    if (job.stack.length === 0) job.stack.push(frame(job.index, job.index + this.blockSize));
    while (job.stack.length > 0) {
      const current = job.stack.at(-1);
      if (current === undefined) throw new InternalCalculationException("Missing ln2 frame");
      this.checkpoint(control);
      let result: Block;
      if (current.end - current.start === 1) {
        result = { p: 9n, q: 2n * BigInt(current.start) + 1n, t: 1n };
        this.termCount += 1;
      } else if (current.phase === "left") {
        current.phase = "right";
        job.stack.push(frame(current.start, Math.floor((current.start + current.end) / 2)));
        continue;
      } else if (current.phase === "right") {
        current.phase = "combine";
        job.stack.push(frame(Math.floor((current.start + current.end) / 2), current.end));
        continue;
      } else {
        const { left, right } = current;
        if (left === null || right === null)
          throw new InternalCalculationException("Incomplete ln2 split");
        const p = this.multiply(left.p, right.p, control);
        const q = this.multiply(left.q, right.q, control);
        const t =
          this.multiply(this.multiply(left.t, right.p, control), right.q, control) +
          this.multiply(right.t, left.q, control);
        result = { p, q, t };
        this.combineCount += 1;
      }
      job.stack.pop();
      const parent = job.stack.at(-1);
      if (parent === undefined) job.block = result;
      else if (parent.phase === "right") parent.left = result;
      else parent.right = result;
    }
  }

  private checkpoint(control: EvaluationCheckpoint): void {
    this.checkpointCount += 1;
    control.checkpoint();
  }

  private multiply(a: bigint, b: bigint, control: EvaluationCheckpoint): bigint {
    const sizeA = decimalDigits(a),
      sizeB = decimalDigits(b);
    control.guardBigIntDigits?.(sizeA + sizeB);
    if (Math.max(sizeA, sizeB) >= 100) this.largeMultiplications += 1;
    const result = a * b;
    this.peakBigIntDigits = Math.max(this.peakBigIntDigits, sizeA, sizeB, decimalDigits(result));
    return result;
  }

  private divide(a: bigint, b: bigint, control: EvaluationCheckpoint): bigint {
    const size = Math.max(decimalDigits(a), decimalDigits(b));
    control.guardBigIntDigits?.(size);
    if (size >= 100) this.largeDivisions += 1;
    this.peakBigIntDigits = Math.max(this.peakBigIntDigits, size);
    return a / b;
  }
}

function frame(start: number, end: number): Frame {
  return { start, end, left: null, right: null, phase: "left" };
}
function decimalDigits(value: bigint): number {
  return value.toString().length;
}
