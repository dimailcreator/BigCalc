import type { EvaluationCheckpoint, EvaluationContext } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import {
  createRational,
  equalsRational,
  multiplyRational,
  divideRational,
  addRational
} from "../values/rational.js";
import { getPiRationalInterval } from "./constants.js";
import { GammaRoot } from "./gamma-root.js";
import {
  createScaledInterval,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds,
  mulScaled,
  divScaled,
  floorDiv,
  ceilDiv
} from "./scaled-interval.js";
import type { RationalBounds, ScaledInterval } from "./scaled-interval.js";
type Context = EvaluationContext & EvaluationCheckpoint;
type Base = 3 | 4;
interface Job {
  digits: number;
  p: number;
  index: number;
  term: ScaledInterval;
  sum: ScaledInterval;
  series: ScaledInterval | null;
  algebraicRoot: GammaRoot | null;
  finalRoot: GammaRoot | null;
}
/** Johansson's hypergeometric Gamma bases (equations 113–114).
 * The identities and tail proof are recorded in ENGINEERING-AR-6-GAMMA-ALTERNATIVES.md. */
class SpecialBase {
  job: Job | null = null;
  cached: RationalBounds | null = null;
  digits = 0;
  terms = 0;
  constructor(readonly base: Base) {}
  getInterval(
    digits: number,
    context: Context,
    control: EvaluationCheckpoint = context
  ): RationalBounds {
    if (this.cached !== null && digits <= this.digits) return this.cached;
    if (this.job === null) {
      control.guardBigIntDigits?.(256 * (digits + 32) + this.retainedDigits);
      const p = digits + 32,
        scale = 10n ** BigInt(p);
      this.job = {
        digits,
        p,
        index: 0,
        term: createScaledInterval(scale, scale, p),
        sum: createScaledInterval(scale, scale, p),
        series: null,
        algebraicRoot: null,
        finalRoot: null
      };
    }
    const j = this.job,
      qn = this.base === 3 ? 9n : 8n,
      qd = this.base === 3 ? 64000n : 1331n;
    while (j.series === null) {
      control.checkpoint();
      control.guardBigIntDigits?.(64 * j.p + this.retainedDigits);
      const n = BigInt(j.index),
        numerator = (6n * n + 1n) * (6n * n + 3n) * (6n * n + 5n) * qn;
      const denominator = 216n * (n + 1n) ** 3n * qd;
      const next = createScaledInterval(
        floorDiv(j.term.lower * numerator, denominator),
        ceilDiv(j.term.upper * numerator, denominator),
        j.p
      );
      // Every subsequent magnitude ratio is < |q|, since all three parameters
      // are in (0,1). This majorant also applies to the alternating third series.
      const tail = ceilDiv(next.upper * qd, qd - qn);
      if (tail <= 10n ** BigInt(j.p - j.digits - 8)) {
        j.series = createScaledInterval(j.sum.lower - tail, j.sum.upper + tail, j.p);
        break;
      }
      const negative = this.base === 3 && (j.index + 1) % 2 === 1;
      j.sum = createScaledInterval(
        j.sum.lower + (negative ? -next.upper : next.lower),
        j.sum.upper + (negative ? -next.lower : next.upper),
        j.p
      );
      j.term = next;
      j.index++;
      this.terms++;
    }
    const pi = scaledIntervalFromRationalBounds(getPiRationalInterval(context, j.p + 8), j.p);
    const radicand = createRational(this.base === 3 ? 10n : 33n, 1n);
    j.algebraicRoot ??= new GammaRoot({ lower: radicand, upper: radicand }, 2, j.p);
    const root = j.algebraicRoot.getInterval(control);
    if (j.finalRoot === null) {
      control.checkpoint();
      let power = mulScaled(pi, pi, j.p);
      power = mulScaled(power, pi, j.p);
      if (this.base === 3) power = mulScaled(power, pi, j.p);
      const factor = this.base === 3 ? 12n : 32n;
      const product = mulScaled(
        createScaledInterval(power.lower * factor, power.upper * factor, j.p),
        j.series,
        j.p
      );
      j.finalRoot = new GammaRoot(
        scaledIntervalToRationalBounds(divScaled(product, root, j.p)),
        this.base === 3 ? 6 : 4,
        j.p
      );
    }
    const value = scaledIntervalToRationalBounds(j.finalRoot.getInterval(control));
    this.cached = value;
    this.digits = j.digits;
    this.job = null;
    return digits > this.digits ? this.getInterval(digits, context, control) : value;
  }
  get retainedDigits(): number {
    const j = this.job,
      values: bigint[] = [];
    if (j !== null) values.push(j.term.lower, j.term.upper, j.sum.lower, j.sum.upper);
    if (j?.series !== null && j?.series !== undefined) values.push(j.series.lower, j.series.upper);
    if (this.cached !== null)
      values.push(
        this.cached.lower.numerator,
        this.cached.lower.denominator,
        this.cached.upper.numerator,
        this.cached.upper.denominator
      );
    return (
      values.reduce((n, v) => n + v.toString().replace("-", "").length, 0) +
      (j?.algebraicRoot?.retainedDigits ?? 0) +
      (j?.finalRoot?.retainedDigits ?? 0)
    );
  }
}
const owners = new WeakMap<EvaluationCheckpoint, Map<Base, SpecialBase>>();
const rootOwners = new WeakMap<EvaluationCheckpoint, Map<string, GammaRoot>>();
interface Recurrence {
  index: bigint;
  multiplier: Rational;
  done: boolean;
}
const recurrenceOwners = new WeakMap<EvaluationCheckpoint, Map<string, Recurrence>>();
function recurrenceDigits(states: Map<string, Recurrence>): number {
  return [...states.values()].reduce(
    (n, s) =>
      n + s.multiplier.numerator.toString().length + s.multiplier.denominator.toString().length,
    0
  );
}
/** A magnitude gate prevents recreating the old huge-half-integer linear trap. */
export function supportsSpecialGamma(argument: RationalBounds): boolean {
  const x = argument.lower;
  return (
    equalsRational(x, argument.upper) &&
    [2n, 3n, 4n, 6n].includes(x.denominator) &&
    x.numerator > -32n * x.denominator &&
    x.numerator < 33n * x.denominator
  );
}
export function specialGammaInterval(
  argument: RationalBounds,
  digits: number,
  context: Context
): RationalBounds | null {
  if (!supportsSpecialGamma(argument)) return null;
  const x = argument.lower,
    shift = floorDiv(x.numerator, x.denominator);
  const fraction = createRational(x.numerator - shift * x.denominator, x.denominator);
  let entries = owners.get(context);
  if (entries === undefined) {
    entries = new Map();
    owners.set(context, entries);
  }
  let roots = rootOwners.get(context);
  if (roots === undefined) {
    roots = new Map();
    rootOwners.set(context, roots);
  }
  let recurrences = recurrenceOwners.get(context);
  if (recurrences === undefined) {
    recurrences = new Map();
    recurrenceOwners.set(context, recurrences);
  }
  const guarded: Context = {
    ...context,
    checkpoint: () => {
      context.checkpoint();
    },
    guardBigIntDigits: (estimate) =>
      context.guardBigIntDigits?.(
        estimate +
          [...entries.values()].reduce((n, s) => n + s.retainedDigits, 0) +
          [...roots.values()].reduce((n, r) => n + r.retainedDigits, 0) +
          recurrenceDigits(recurrences)
      )
  };
  const p = digits + 24;
  // Reserve reconstruction temporaries even when every series/root is cached.
  guarded.guardBigIntDigits?.(256 * (p + 32));
  const base = (b: Base) => {
    let state = entries.get(b);
    if (state === undefined) {
      state = new SpecialBase(b);
      entries.set(b, state);
    }
    // The original owner is used for pi; wrappers must not create new provider caches.
    return scaledIntervalFromRationalBounds(state.getInterval(p, context, guarded), p);
  };
  const pi = scaledIntervalFromRationalBounds(getPiRationalInterval(context, p + 8), p);
  const root = (key: string, v: ScaledInterval, degree: number) => {
    const bounds = scaledIntervalToRationalBounds(v);
    let state = roots.get(key);
    if (
      state?.digits !== p ||
      !equalsRational(state.argument.lower, bounds.lower) ||
      !equalsRational(state.argument.upper, bounds.upper)
    ) {
      if (state !== undefined && !state.complete) state.getInterval(guarded);
      state = new GammaRoot(bounds, degree, p);
      roots.set(key, state);
    }
    return state.getInterval(guarded);
  };
  const integer = (n: bigint) => createScaledInterval(n, n, 0);
  let value: ScaledInterval;
  if (fraction.denominator === 2n) value = root("pi", pi, 2);
  else if (fraction.denominator === 4n) {
    value = base(4);
    if (fraction.numerator === 3n)
      value = divScaled(mulScaled(pi, root("two", integer(2n), 2), p), value, p);
  } else {
    value = base(3);
    if (fraction.denominator === 3n && fraction.numerator === 2n)
      value = divScaled(
        mulScaled(pi, integer(2n), p),
        mulScaled(root("three", integer(3n), 2), value, p),
        p
      );
    else if (fraction.denominator === 6n) {
      // Duplication and reflection: Gamma(1/6)^2 = 3 Gamma(1/3)^4 / (2^(2/3) pi).
      const cuberoot4 = root("four-cuberoot", integer(16n), 6);
      const square = mulScaled(value, value, p);
      value = root(
        "sixth-gamma",
        divScaled(
          mulScaled(mulScaled(square, square, p), integer(3n), p),
          mulScaled(cuberoot4, pi, p),
          p
        ),
        2
      );
      if (fraction.numerator === 5n) value = divScaled(mulScaled(pi, integer(2n), p), value, p);
    }
  }
  const key = `${x.numerator.toString()}/${x.denominator.toString()}`;
  let recurrence = recurrences.get(key);
  if (recurrence === undefined) {
    // Only completed jobs are evicted; a paused product belongs to its owner.
    if (recurrences.size >= 8) {
      const completed = [...recurrences].find(([, r]) => r.done);
      if (completed !== undefined) recurrences.delete(completed[0]);
    }
    guarded.guardBigIntDigits?.(2048);
    recurrence = { index: shift < 0n ? -1n : 0n, multiplier: createRational(1n, 1n), done: false };
    recurrences.set(key, recurrence);
  }
  while (!recurrence.done) {
    const i = recurrence.index;
    if (shift >= 0n ? i >= shift : i < shift) {
      recurrence.done = true;
      break;
    }
    guarded.checkpoint();
    guarded.guardBigIntDigits?.(2048);
    const factor = addRational(fraction, createRational(i, 1n));
    recurrence.multiplier =
      shift >= 0n
        ? multiplyRational(recurrence.multiplier, factor)
        : divideRational(recurrence.multiplier, factor);
    recurrence.index += shift >= 0n ? 1n : -1n;
  }
  const multiplier = recurrence.multiplier;
  const bounds = scaledIntervalToRationalBounds(value);
  // Keep the bounded rational recurrence exact, including its final scale.
  // Rounding a tiny negative-shift result at an absolute scale would lose digits.
  return {
    lower: multiplyRational(multiplier, multiplier.numerator < 0n ? bounds.upper : bounds.lower),
    upper: multiplyRational(multiplier, multiplier.numerator < 0n ? bounds.lower : bounds.upper)
  };
}
export function getSpecialGammaSnapshot(context: EvaluationCheckpoint) {
  const states = [...(owners.get(context)?.values() ?? [])];
  const roots = [...(rootOwners.get(context)?.values() ?? [])];
  return {
    entries: states.length,
    terms: states.reduce((n, s) => n + s.terms, 0),
    retainedBigIntDigits:
      states.reduce((n, s) => n + s.retainedDigits, 0) +
      roots.reduce((n, r) => n + r.retainedDigits, 0) +
      recurrenceDigits(recurrenceOwners.get(context) ?? new Map<string, Recurrence>()),
    workingDigits: Math.max(0, ...states.map((s) => s.job?.p ?? s.digits + 32)),
    pending: states.filter((s) => s.job !== null).length,
    roots: roots.length,
    pendingRoots: roots.filter((r) => !r.complete).length
  };
}
