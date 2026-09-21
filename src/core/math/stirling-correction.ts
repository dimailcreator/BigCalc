import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational } from "../values/contracts.js";
import { createRational, divideRational, equalsRational } from "../values/rational.js";
import {
  createScaledInterval,
  scaledIntervalFromRationalBounds,
  scaledIntervalToRationalBounds,
  floorDiv,
  ceilDiv
} from "./scaled-interval.js";
import type { RationalBounds, ScaledInterval } from "./scaled-interval.js";

interface State {
  argument: RationalBounds;
  digits: number;
  minimumTerms: number;
  index: number;
  term: ScaledInterval;
  sum: ScaledInterval;
  powers: readonly [bigint, bigint, bigint, bigint];
  done: boolean;
  retainedDigits: number;
}
const owners = new WeakMap<EvaluationCheckpoint, State[]>();
const size = (value: bigint) => value.toString().replace("-", "").length;
function retained(state: State): number {
  return [
    state.argument.lower.numerator,
    state.argument.lower.denominator,
    state.argument.upper.numerator,
    state.argument.upper.denominator,
    state.term.lower,
    state.term.upper,
    state.sum.lower,
    state.sum.upper,
    ...state.powers
  ].reduce((n, v) => n + size(v), 0);
}
export function stirlingRetainedDigits(control: EvaluationCheckpoint): number {
  return (owners.get(control) ?? []).reduce((n, state) => n + state.retainedDigits, 0);
}
export function getStirlingCorrectionSnapshot(control: EvaluationCheckpoint) {
  const states = owners.get(control) ?? [];
  return {
    entries: states.length,
    pending: states.filter((s) => !s.done).length,
    retainedBigIntDigits: stirlingRetainedDigits(control),
    states: states.map((s) => ({
      terms: s.index - 1,
      workingDigits: s.term.scaleDigits,
      done: s.done
    }))
  };
}

/** Exact power recurrence, followed by one outward division per endpoint, avoids
 * representing huge Bernoulli coefficients and tiny inverse powers at 2N digits.
 * The first omitted term bounds the positive-real Stirling remainder. */
export function recurrentStirlingCorrection(
  argument: RationalBounds,
  digits: number,
  minimumTerms: number,
  control: EvaluationCheckpoint,
  bernoulli: (index: number) => Rational,
  coefficientRetained: () => number
) {
  let states = owners.get(control);
  if (states === undefined) {
    states = [];
    owners.set(control, states);
  }
  const run = (state: State) => {
    const threshold = 10n ** BigInt(state.term.scaleDigits - state.digits);
    while (!state.done) {
      control.checkpoint();
      const magnitude = state.term.lower < 0n ? -state.term.lower : state.term.upper;
      if (state.index > state.minimumTerms && state.index > 1 && magnitude <= threshold) {
        state.done = true;
        break;
      }
      const nextIndex = state.index + 1;
      const b = bernoulli(2 * nextIndex);
      control.guardBigIntDigits?.(
        stirlingRetainedDigits(control) +
          coefficientRetained() +
          8 * Math.max(...state.powers.map(size)) +
          12 *
            (state.term.scaleDigits +
              size(b.numerator) +
              size(b.denominator) +
              size(state.argument.lower.numerator) +
              size(state.argument.lower.denominator) +
              size(state.argument.upper.numerator) +
              size(state.argument.upper.denominator))
      );
      const { lower, upper } = state.argument;
      const powers = [
        state.powers[0] * lower.numerator * lower.numerator,
        state.powers[1] * lower.denominator * lower.denominator,
        state.powers[2] * upper.numerator * upper.numerator,
        state.powers[3] * upper.denominator * upper.denominator
      ] as const;
      const denominator = b.denominator * BigInt(2 * nextIndex) * BigInt(2 * nextIndex - 1);
      const numerator = b.numerator * 10n ** BigInt(state.term.scaleDigits);
      const lows: bigint[] = [],
        highs: bigint[] = [];
      for (const [p, q] of [
        [powers[0], powers[1]],
        [powers[2], powers[3]]
      ] as const) {
        lows.push(floorDiv(numerator * q, denominator * p));
        highs.push(ceilDiv(numerator * q, denominator * p));
      }
      const nextTerm = createScaledInterval(
        lows.reduce((a, b) => (a < b ? a : b)),
        highs.reduce((a, b) => (a > b ? a : b)),
        state.term.scaleDigits
      );
      // Commit after all checkpoints/guards: a pause cannot double-add a term.
      state.sum = createScaledInterval(
        state.sum.lower + state.term.lower,
        state.sum.upper + state.term.upper,
        state.term.scaleDigits
      );
      state.term = nextTerm;
      state.powers = powers;
      state.index = nextIndex;
      state.retainedDigits = retained(state);
    }
  };
  // Complete interrupted work before eviction, just as the other context-owned routers do.
  for (const state of states) if (!state.done) run(state);
  let state = states.find(
    (s) =>
      s.digits === digits &&
      s.minimumTerms === minimumTerms &&
      equalsRational(s.argument.lower, argument.lower) &&
      equalsRational(s.argument.upper, argument.upper)
  );
  if (state === undefined) {
    if (states.length >= 8) states.shift();
    control.guardBigIntDigits?.(
      stirlingRetainedDigits(control) +
        coefficientRetained() +
        12 * (digits + 24) +
        8 *
          (size(argument.lower.numerator) +
            size(argument.lower.denominator) +
            size(argument.upper.numerator) +
            size(argument.upper.denominator))
    );
    const coefficient = createRational(1n, 12n);
    const term = scaledIntervalFromRationalBounds(
      {
        lower: divideRational(coefficient, argument.upper),
        upper: divideRational(coefficient, argument.lower)
      },
      digits + 24
    );
    state = {
      argument,
      digits,
      minimumTerms,
      index: 1,
      term,
      sum: createScaledInterval(0n, 0n, term.scaleDigits),
      powers: [
        argument.lower.numerator,
        argument.lower.denominator,
        argument.upper.numerator,
        argument.upper.denominator
      ],
      done: false,
      retainedDigits: 0
    };
    state.retainedDigits = retained(state);
    states.push(state);
    run(state);
  }
  const magnitude = state.term.lower < 0n ? -state.term.lower : state.term.upper;
  return {
    sum: scaledIntervalToRationalBounds(state.sum),
    remainder: createRational(magnitude, 10n ** BigInt(state.term.scaleDigits)),
    terms: state.index - 1
  };
}
