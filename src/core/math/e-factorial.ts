import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import { createRational } from "../values/rational.js";
import { BinaryBlock } from "./binary-block.js";
import { recordAlgorithmSelection, selectEStrategy } from "./algorithm-strategy.js";
import type { RationalBounds } from "./scaled-interval.js";

interface Pair {
  readonly q: bigint;
  readonly t: bigint;
}
interface Job {
  readonly end: number;
  readonly tree: BinaryBlock<Pair>;
}

/** Exact factorial prefix shared by sequential and balanced affine composition.
 * N_k = k*N_(k-1)+1, S_k=N_k/k!, and 0 < e-S_k <= 2/(k+1)!.
 * Each tree step commits before checkpoint; the prefix commits atomically. */
export class FactorialEProvider {
  private n = -1;
  private numerator = 0n;
  private denominator = 1n;
  private job: Job | null = null;
  private binaryStarted = false;
  private logFactorial = 0;
  private completedBlocks = 0;
  private peakBigIntDigits = 1;
  private workingDigits = 0;

  get completedTerms(): number {
    return this.n + 1;
  }

  getInterval(digits: number, control: EvaluationCheckpoint): RationalBounds {
    if (!Number.isSafeInteger(digits) || digits < 1)
      throw new InternalCalculationException("Invalid e precision");
    const layout = selectEStrategy(digits, this.binaryStarted);
    recordAlgorithmSelection(control, "e", layout, digits, "factorial-series");
    // Guard before allocating the target scale, including retained pending work.
    this.guard(control, Math.max(this.n, this.job?.end ?? 0), digits);
    control.checkpoint();
    this.workingDigits = Math.max(this.workingDigits, digits);
    const target = 2n * 10n ** BigInt(digits);
    if (this.n < 0) {
      this.n = 0;
      this.numerator = 1n;
    }
    this.binaryStarted ||= layout === "binary";
    while (this.job !== null || this.denominator * BigInt(this.n + 1) < target) {
      if (layout === "sequential") {
        this.guard(control, this.n + 1, digits);
        control.checkpoint();
        const next = BigInt(this.n + 1);
        this.numerator = this.numerator * next + 1n;
        this.denominator *= next;
        this.n++;
        this.logFactorial += Math.log10(this.n);
      } else {
        if (this.job === null) {
          let end = this.n,
            estimate = this.logFactorial;
          // Only schedules work. The loop condition proves the tail exactly.
          do {
            end++;
            estimate += Math.log10(end);
          } while (estimate < digits + 1);
          this.guard(control, end, digits);
          control.checkpoint();
          this.job = { end, tree: new BinaryBlock<Pair>(this.n + 1, end + 1) };
        }
        const { end, tree } = this.job;
        this.guard(control, end, digits);
        const pair = tree.run(
          control,
          (k) => ({ q: BigInt(k), t: 1n }),
          (a, b) => ({ q: a.q * b.q, t: a.t * b.q + b.t })
        );
        this.numerator = this.numerator * pair.q + pair.t;
        this.denominator *= pair.q;
        for (let k = this.n + 1; k <= end; k++) this.logFactorial += Math.log10(k);
        this.n = end;
        this.completedBlocks++;
        this.job = null;
      }
    }
    this.guard(control, this.n, digits);
    const denominator = this.denominator * BigInt(this.n + 1);
    const numerator = this.numerator * BigInt(this.n + 1);
    this.peakBigIntDigits = Math.max(
      this.peakBigIntDigits,
      (numerator + 2n).toString().length,
      denominator.toString().length,
      target.toString().length
    );
    return {
      lower: createRational(numerator, denominator),
      upper: createRational(numerator + 2n, denominator)
    };
  }

  private guard(control: EvaluationCheckpoint, end: number, digits: number): void {
    // k! <= (end+1)^(end+1). Tree-retained blocks partition the range;
    // each q is a product and 0<t<=2q. 24 copies cover live nodes, prefix,
    // merge temporaries and endpoint/GCD operands. Logs do not prove this bound.
    const bound = (end + 2) * String(end + 1).length + 2;
    const estimate = 24 * bound + 4 * (digits + 2);
    if (!Number.isSafeInteger(estimate))
      throw new InternalCalculationException("Unsafe e storage estimate");
    control.guardBigIntDigits?.(estimate);
  }

  getSnapshot() {
    const retained = [this.numerator, this.denominator];
    for (const pair of this.job?.tree.retained() ?? []) retained.push(pair.q, pair.t);
    return Object.freeze({
      algorithm: this.binaryStarted
        ? ("factorial-binary" as const)
        : ("factorial-recurrence" as const),
      workingDigits: this.workingDigits,
      completedTerms: this.completedTerms,
      blockCount: this.completedBlocks,
      pending: this.job !== null,
      treePhase: this.job?.tree.phase ?? "idle",
      peakBigIntDigits: this.peakBigIntDigits,
      cachedBigIntDigits: retained.reduce((sum, value) => sum + value.toString().length, 0)
    });
  }
}
