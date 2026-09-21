import { InternalCalculationException } from "../errors/index.js";
import type { EvaluationContext, EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import {
  createRational,
  addRational,
  subtractRational,
  multiplyRational,
  equalsRational
} from "../values/rational.js";
import { lnPositiveInterval } from "./elementary.js";
import { routedSmallExp } from "./exp-router.js";
import { getPiRationalInterval } from "./constants.js";
import { GammaRoot } from "./gamma-root.js";
import {
  createScaledInterval,
  scaledIntervalToRationalBounds,
  mulScaled,
  divScaled,
  floorDiv,
  ceilDiv,
  rescaleScaled
} from "./scaled-interval.js";
import type { RationalBounds, ScaledInterval } from "./scaled-interval.js";
type Context = EvaluationContext & EvaluationCheckpoint;
const size = (v: bigint) => v.toString().replace("-", "").length;
const point = (n: bigint): RationalBounds => ({
  lower: createRational(n, 1n),
  upper: createRational(n, 1n)
});

/** For x>0 and a>=3, Spouge's relative-error bound is < 6^-a.
 * Choose a by an integer certificate, not a floating-point accuracy claim. */
export function planSpouge(digits: number) {
  if (!Number.isSafeInteger(digits) || digits < 1)
    throw new InternalCalculationException("Invalid Spouge precision");
  let a = Math.max(3, Math.ceil((digits + 12) / Math.log10(6)));
  const target = 10n ** BigInt(digits + 12);
  let denominator = 6n ** BigInt(a);
  while (denominator < target) {
    a++;
    denominator *= 6n;
  }
  return { a, workingDigits: digits + 2 * a + 32, error: createRational(1n, denominator) };
}
class Coefficients {
  readonly plan: ReturnType<typeof planSpouge>;
  readonly values: ScaledInterval[] = [];
  factorial = 1n;
  ePower: ScaledInterval | null = null;
  e: ScaledInterval | null = null;
  root: GammaRoot | null = null;
  exponentialPower: { remaining: number; base: ScaledInterval; product: ScaledInterval } | null =
    null;
  retained = 0;
  private coefficientDigits = 0;
  constructor(readonly digits: number) {
    this.plan = planSpouge(digits);
    this.updateRetained();
  }
  ensure(index: number, context: Context, control: EvaluationCheckpoint): ScaledInterval {
    const { a, workingDigits: p } = this.plan;
    while (this.values.length <= index) {
      control.checkpoint();
      control.guardBigIntDigits?.(this.retained + 128 * (p + a) + 8 * size(this.factorial));
      const k = this.values.length;
      if (k === 0) {
        const pi = getPiRationalInterval(context, p + 8);
        this.root ??= new GammaRoot(
          {
            lower: multiplyRational(pi.lower, createRational(2n, 1n)),
            upper: multiplyRational(pi.upper, createRational(2n, 1n))
          },
          2,
          p
        );
        const c = this.root.getInterval(control);
        this.values.push(c);
        this.root = null;
        this.updateRetained(c);
        continue;
      }
      if (this.e === null) {
        this.e = rescaleScaled(routedSmallExp(createRational(1n, 1n), p + 8, context), p);
        this.updateRetained();
      }
      if (this.ePower === null) {
        const scale = 10n ** BigInt(p);
        this.exponentialPower ??= {
          remaining: a - 1,
          base: this.e,
          product: createScaledInterval(scale, scale, p)
        };
        const power = this.exponentialPower;
        while (power.remaining > 0) {
          control.checkpoint();
          const product =
            power.remaining % 2 === 1 ? mulScaled(power.product, power.base, p) : power.product;
          const base = power.remaining > 1 ? mulScaled(power.base, power.base, p) : power.base;
          power.product = product;
          power.base = base;
          power.remaining = Math.floor(power.remaining / 2);
        }
        this.ePower = power.product;
        this.exponentialPower = null;
        this.updateRetained();
      }
      const b = BigInt(a - k);
      this.root ??= new GammaRoot(point(b), 2, p);
      const sqrt = this.root.getInterval(control);
      control.checkpoint();
      // This integer power has O(a log a) digits, independently of the argument.
      control.guardBigIntDigits?.(this.retained + 128 * (p + a) + 8 * a * String(a).length);
      const power = b ** BigInt(k - 1);
      const product = mulScaled(this.ePower, sqrt, p);
      let c = createScaledInterval(
        floorDiv(product.lower * power, this.factorial),
        ceilDiv(product.upper * power, this.factorial),
        p
      );
      if (k % 2 === 0) c = createScaledInterval(-c.upper, -c.lower, p);
      const nextE = divScaled(this.ePower, this.e, p);
      // All resumable dependency calls and guards precede this commit.
      this.values.push(c);
      this.ePower = nextE;
      this.factorial *= BigInt(k);
      this.root = null;
      this.updateRetained(c);
    }
    const result = this.values[index];
    if (result === undefined) throw new InternalCalculationException("Missing Spouge coefficient");
    return result;
  }
  private updateRetained(coefficient?: ScaledInterval) {
    if (coefficient !== undefined)
      this.coefficientDigits += size(coefficient.lower) + size(coefficient.upper);
    this.retained =
      this.coefficientDigits +
      size(this.plan.error.denominator) +
      size(this.factorial) +
      (this.ePower === null ? 0 : size(this.ePower.lower) + size(this.ePower.upper)) +
      (this.e === null ? 0 : size(this.e.lower) + size(this.e.upper));
  }
}
interface SumJob {
  argument: RationalBounds;
  digits: number;
  table: Coefficients;
  index: number;
  sum: ScaledInterval | null;
  log: RationalBounds | null;
}
interface Owner {
  tables: Coefficients[];
  jobs: SumJob[];
  terms: number;
}
const owners = new WeakMap<EvaluationCheckpoint, Owner>();
function retained(owner: Owner): number {
  return (
    owner.tables.reduce(
      (n, t) =>
        n +
        t.retained +
        (t.root?.retainedDigits ?? 0) +
        (t.exponentialPower === null
          ? 0
          : size(t.exponentialPower.base.lower) +
            size(t.exponentialPower.base.upper) +
            size(t.exponentialPower.product.lower) +
            size(t.exponentialPower.product.upper)),
      0
    ) +
    owner.jobs.reduce(
      (n, j) =>
        n +
        size(j.argument.lower.numerator) +
        size(j.argument.lower.denominator) +
        size(j.argument.upper.numerator) +
        size(j.argument.upper.denominator) +
        (j.sum === null ? 0 : size(j.sum.lower) + size(j.sum.upper)) +
        (j.log === null
          ? 0
          : size(j.log.lower.numerator) +
            size(j.log.lower.denominator) +
            size(j.log.upper.numerator) +
            size(j.log.upper.denominator)),
      0
    )
  );
}
export function getSpougeSnapshot(context: EvaluationCheckpoint) {
  const owner = owners.get(context);
  return {
    tables: owner?.tables.length ?? 0,
    terms: owner?.terms ?? 0,
    coefficients: owner?.tables.reduce((n, t) => n + t.values.length, 0) ?? 0,
    retainedBigIntDigits: owner === undefined ? 0 : retained(owner),
    pending: owner?.jobs.filter((j) => j.log === null).length ?? 0,
    parameters:
      owner?.tables.map((t) => ({
        a: t.plan.a,
        workingDigits: t.plan.workingDigits,
        completed: t.values.length
      })) ?? []
  };
}
export function spougeLogInterval(
  argument: RationalBounds,
  digits: number,
  context: Context
): RationalBounds | null {
  if (argument.lower.numerator <= 0n) return null;
  let owner = owners.get(context);
  if (owner === undefined) {
    owner = { tables: [], jobs: [], terms: 0 };
    owners.set(context, owner);
  }
  const control: EvaluationCheckpoint = {
    checkpoint: () => {
      context.checkpoint();
    },
    guardBigIntDigits: (n) => context.guardBigIntDigits?.(n + retained(owner))
  };
  const run = (job: SumJob): RationalBounds | null => {
    if (job.log !== null) return job.log;
    const t = job.table,
      { a, workingDigits: p, error } = t.plan;
    if (job.sum === null) {
      job.sum = t.ensure(0, context, control);
      job.index = 1;
    }
    while (job.index < a) {
      control.checkpoint();
      const k = job.index,
        c = t.ensure(k, context, control),
        shift = createRational(BigInt(k - 1), 1n);
      const denominators = [
        addRational(job.argument.lower, shift),
        addRational(job.argument.upper, shift)
      ];
      control.guardBigIntDigits?.(
        64 * p + 8 * denominators.reduce((n, v) => n + size(v.numerator) + size(v.denominator), 0)
      );
      const lo: bigint[] = [],
        hi: bigint[] = [];
      for (const v of [c.lower, c.upper])
        for (const d of denominators) {
          lo.push(floorDiv(v * d.denominator, d.numerator));
          hi.push(ceilDiv(v * d.denominator, d.numerator));
        }
      job.sum = createScaledInterval(
        job.sum.lower + lo.reduce((x, y) => (x < y ? x : y)),
        job.sum.upper + hi.reduce((x, y) => (x > y ? x : y)),
        p
      );
      job.index++;
      owner.terms++;
    }
    if (job.sum.lower <= 0n) return null; // Wide input/cancellation: the caller must refine, never guess a sign.
    control.guardBigIntDigits?.(256 * p);
    const shift = createRational(BigInt(a - 1), 1n),
      half = createRational(1n, 2n);
    const z = {
      lower: addRational(job.argument.lower, shift),
      upper: addRational(job.argument.upper, shift)
    };
    const logZ = lnPositiveInterval(z, p, context),
      logSum = lnPositiveInterval(scaledIntervalToRationalBounds(job.sum), p, context);
    const factors = [
      subtractRational(job.argument.lower, half),
      subtractRational(job.argument.upper, half)
    ];
    const products = factors.flatMap((f) => [
      multiplyRational(f, logZ.lower),
      multiplyRational(f, logZ.upper)
    ]);
    const compare = (x: Rational, y: Rational) =>
      x.numerator * y.denominator < y.numerator * x.denominator;
    // |log(1+epsilon)| <= 2 delta for |epsilon|<=delta<1/2.
    const radius = multiplyRational(error, createRational(2n, 1n));
    job.log = {
      lower: subtractRational(
        addRational(
          subtractRational(
            products.reduce((x, y) => (compare(x, y) ? x : y)),
            z.upper
          ),
          logSum.lower
        ),
        radius
      ),
      upper: addRational(
        addRational(
          subtractRational(
            products.reduce((x, y) => (compare(x, y) ? y : x)),
            z.lower
          ),
          logSum.upper
        ),
        radius
      )
    };
    return job.log;
  };
  // Finish interrupted work before bounded eviction. A wide unresolved interval
  // has a completed coefficient/sum frontier and may be replaced by a finer input.
  for (const j of owner.jobs) if (j.log === null) run(j);
  let job = owner.jobs.find(
    (j) =>
      j.digits === digits &&
      equalsRational(j.argument.lower, argument.lower) &&
      equalsRational(j.argument.upper, argument.upper)
  );
  if (job === undefined) {
    let table = owner.tables.find((t) => t.digits === digits);
    if (table === undefined) {
      if (owner.tables.length >= 2) {
        const removed = owner.tables.shift();
        owner.jobs = owner.jobs.filter((j) => j.table !== removed);
      }
      control.guardBigIntDigits?.(128 * (digits + 32));
      table = new Coefficients(digits);
      owner.tables.push(table);
    }
    if (owner.jobs.length >= 8) owner.jobs.shift();
    job = { argument, digits, table, index: 0, sum: null, log: null };
    owner.jobs.push(job);
  }
  return run(job);
}
