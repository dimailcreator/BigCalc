import { divisionByZeroError } from "../errors/index.js";
import type { DivisionByZeroError } from "../errors/index.js";
import type { EvaluationCheckpoint } from "../evaluation/contracts.js";
import type { Rational, Sign } from "./contracts.js";

const ZERO = 0n;
const ONE = 1n;

export const RATIONAL_ZERO: Rational = Object.freeze({
  kind: "rational",
  numerator: ZERO,
  denominator: ONE
});

export const RATIONAL_ONE: Rational = Object.freeze({
  kind: "rational",
  numerator: ONE,
  denominator: ONE
});

export function createRational(numerator: bigint, denominator: bigint = ONE): Rational {
  if (denominator === ZERO) {
    throwDivisionByZeroError("Rational denominator cannot be zero");
  }

  if (numerator === ZERO) {
    return RATIONAL_ZERO;
  }

  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;

  if (normalizedDenominator < ZERO) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }

  const divisor = gcd(absBigInt(normalizedNumerator), normalizedDenominator);

  return Object.freeze({
    kind: "rational",
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor
  });
}

export function integerRational(value: bigint): Rational {
  return createRational(value, ONE);
}

export function isRational(value: unknown): value is Rational {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<PropertyKey, unknown>;

  return (
    candidate.kind === "rational" &&
    typeof candidate.numerator === "bigint" &&
    typeof candidate.denominator === "bigint" &&
    isCanonicalRationalShape(candidate.numerator, candidate.denominator)
  );
}

export function isZeroRational(value: Rational): boolean {
  return value.numerator === ZERO;
}

export function isIntegerRational(value: Rational): boolean {
  return value.denominator === ONE;
}

export function signOfRational(value: Rational): Sign {
  if (value.numerator === ZERO) {
    return 0;
  }

  return value.numerator < ZERO ? -1 : 1;
}

export function compareRational(left: Rational, right: Rational): Sign {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;

  if (difference === ZERO) {
    return 0;
  }

  return difference < ZERO ? -1 : 1;
}

export function equalsRational(left: Rational, right: Rational): boolean {
  return compareRational(left, right) === 0;
}

export function negateRational(value: Rational): Rational {
  return createRational(-value.numerator, value.denominator);
}

export function absRational(value: Rational): Rational {
  return createRational(absBigInt(value.numerator), value.denominator);
}

export function addRational(left: Rational, right: Rational): Rational {
  return createRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

export function subtractRational(left: Rational, right: Rational): Rational {
  return createRational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return createRational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function reciprocalRational(value: Rational): Rational {
  if (isZeroRational(value)) {
    throwDivisionByZeroError("Cannot take reciprocal of zero");
  }

  return createRational(value.denominator, value.numerator);
}

export function divideRational(left: Rational, right: Rational): Rational {
  if (isZeroRational(right)) {
    throwDivisionByZeroError();
  }

  return createRational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export interface RationalPowerState {
  baseNumerator: bigint | null;
  baseDenominator: bigint | null;
  exponent: bigint | null;
  numerator: BigIntPowerState | null;
  denominator: BigIntPowerState | null;
  totalMultiplications: number;
  estimatedResultDigits: number;
}

export interface ExactNthRootProfile {
  readonly degree: bigint;
  readonly initialBoundBits: number;
  readonly newtonIterations: number;
  readonly powerCheckMultiplications: number;
  readonly earlyAbortedPowerChecks: number;
  readonly peakBigIntDecimalDigits: number;
}

interface BigIntPowerState {
  readonly base: bigint;
  readonly exponent: bigint;
  result: bigint;
  factor: bigint;
  remaining: bigint;
  phase: "multiply-result" | "square-factor";
  multiplications: number;
}

export function createRationalPowerState(): RationalPowerState {
  return {
    baseNumerator: null,
    baseDenominator: null,
    exponent: null,
    numerator: null,
    denominator: null,
    totalMultiplications: 0,
    estimatedResultDigits: 0
  };
}

export function powRational(
  base: Rational,
  exponent: bigint,
  control?: EvaluationCheckpoint
): Rational {
  return powRationalWithState(base, exponent, createRationalPowerState(), control);
}

export function powRationalWithState(
  base: Rational,
  exponent: bigint,
  state: RationalPowerState,
  control?: EvaluationCheckpoint
): Rational {
  if (exponent === ZERO) {
    return RATIONAL_ONE;
  }

  if (exponent < ZERO) {
    return powRationalWithState(reciprocalRational(base), -exponent, state, control);
  }

  const estimatedDigits = estimatePowerResultDecimalDigits(base, exponent);
  control?.guardBigIntDigits?.(estimatedDigits);
  initializeRationalPowerState(state, base, exponent, estimatedDigits);
  const numeratorState = state.numerator;
  const denominatorState = state.denominator;
  if (numeratorState === null || denominatorState === null) {
    throw new Error("Rational power state was not initialized");
  }

  let numeratorMagnitude: bigint;
  let denominator: bigint;
  try {
    numeratorMagnitude = continueBigIntPower(numeratorState, control);
    denominator = continueBigIntPower(denominatorState, control);
  } finally {
    state.totalMultiplications = numeratorState.multiplications + denominatorState.multiplications;
  }
  const negative = base.numerator < ZERO && exponent % 2n !== ZERO;
  return createRational(negative ? -numeratorMagnitude : numeratorMagnitude, denominator);
}

export function exactNthRootRational(
  value: Rational,
  degree: bigint,
  control?: EvaluationCheckpoint
): Rational | null {
  return exactNthRootRationalWithProfile(value, degree, control).root;
}

export function exactNthRootRationalWithProfile(
  value: Rational,
  degree: bigint,
  control?: EvaluationCheckpoint
): { readonly root: Rational | null; readonly profile: ExactNthRootProfile } {
  if (degree <= ZERO) {
    return exactNthRootResult(null, degree, createRootMetrics());
  }

  if (degree === ONE) {
    return exactNthRootResult(
      createRational(value.numerator, value.denominator),
      degree,
      createRootMetrics()
    );
  }

  const numeratorSign = signOfRational(value);

  if (numeratorSign < 0 && degree % 2n === 0n) {
    return exactNthRootResult(null, degree, createRootMetrics());
  }

  const metrics = createRootMetrics();
  const numeratorRoot = exactNthRootBigInt(absBigInt(value.numerator), degree, control, metrics);
  if (numeratorRoot === null) {
    return exactNthRootResult(null, degree, metrics);
  }

  const denominatorRoot = exactNthRootBigInt(value.denominator, degree, control, metrics);
  if (denominatorRoot === null) {
    return exactNthRootResult(null, degree, metrics);
  }

  return exactNthRootResult(
    createRational(numeratorSign < 0 ? -numeratorRoot : numeratorRoot, denominatorRoot),
    degree,
    metrics
  );
}

export function assertCanonicalRational(value: Rational): void {
  if (value.denominator <= ZERO) {
    throw new Error("Rational denominator must be positive");
  }

  if (value.numerator === ZERO && value.denominator !== ONE) {
    throw new Error("Rational zero must be represented as 0/1");
  }

  if (gcd(absBigInt(value.numerator), value.denominator) !== ONE) {
    throw new Error("Rational numerator and denominator must be coprime");
  }
}

class DivisionByZeroException extends Error implements DivisionByZeroError {
  readonly kind = "calc-error";
  readonly code = "DivisionByZeroError";

  constructor(message?: string) {
    super(divisionByZeroError(message).message);
    this.name = "DivisionByZeroError";
  }
}

function throwDivisionByZeroError(message?: string): never {
  throw new DivisionByZeroException(message);
}

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;

  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

function isCanonicalRationalShape(numerator: bigint, denominator: bigint): boolean {
  return (
    denominator > ZERO &&
    (numerator !== ZERO || denominator === ONE) &&
    gcd(absBigInt(numerator), denominator) === ONE
  );
}

interface MutableRootMetrics {
  initialBoundBits: number;
  newtonIterations: number;
  powerCheckMultiplications: number;
  earlyAbortedPowerChecks: number;
  peakBigIntBits: number;
}

function exactNthRootBigInt(
  value: bigint,
  degree: bigint,
  control: EvaluationCheckpoint | undefined,
  metrics: MutableRootMetrics
): bigint | null {
  if (value < ZERO || degree <= ZERO) {
    return null;
  }

  if (degree === ONE || value < 2n) {
    return value;
  }

  const valueBits = bitLengthBigInt(value);
  metrics.peakBigIntBits = Math.max(metrics.peakBigIntBits, valueBits);
  if (degree > BigInt(valueBits)) {
    return null;
  }

  const initialBoundBits = Number((BigInt(valueBits) + degree - ONE) / degree);
  metrics.initialBoundBits = Math.max(metrics.initialBoundBits, initialBoundBits);
  let current = ONE << BigInt(initialBoundBits);

  for (;;) {
    control?.checkpoint();
    const divisorPower = powerToLimit(current, degree - ONE, value, control, metrics);
    const quotient = divisorPower === null ? ZERO : value / divisorPower;
    const next = ((degree - ONE) * current + quotient) / degree;
    metrics.newtonIterations += 1;
    metrics.peakBigIntBits = Math.max(
      metrics.peakBigIntBits,
      bitLengthBigInt(current),
      bitLengthBigInt(next)
    );
    if (next >= current) {
      break;
    }
    current = next;
  }

  const comparison = comparePowerToLimit(current, degree, value, control, metrics);
  return comparison === 0 ? current : null;
}

function comparePowerToLimit(
  base: bigint,
  exponent: bigint,
  limit: bigint,
  control: EvaluationCheckpoint | undefined,
  metrics: MutableRootMetrics
): Sign {
  const power = powerToLimit(base, exponent, limit, control, metrics);
  if (power === null) return 1;
  return power === limit ? 0 : power < limit ? -1 : 1;
}

function powerToLimit(
  base: bigint,
  exponent: bigint,
  limit: bigint,
  control: EvaluationCheckpoint | undefined,
  metrics: MutableRootMetrics
): bigint | null {
  let result = ONE;
  let factor = base;
  let remaining = exponent;

  while (remaining > ZERO) {
    control?.checkpoint();
    if (remaining % 2n !== ZERO) {
      if (factor !== ZERO && result > limit / factor) {
        metrics.earlyAbortedPowerChecks += 1;
        return null;
      }
      result *= factor;
      metrics.powerCheckMultiplications += 1;
      metrics.peakBigIntBits = Math.max(metrics.peakBigIntBits, bitLengthBigInt(result));
    }

    remaining /= 2n;
    if (remaining === ZERO) break;
    control?.checkpoint();
    if (factor !== ZERO && factor > limit / factor) {
      factor = limit + ONE;
    } else {
      factor *= factor;
      metrics.powerCheckMultiplications += 1;
      metrics.peakBigIntBits = Math.max(metrics.peakBigIntBits, bitLengthBigInt(factor));
    }
  }

  return result;
}

function initializeRationalPowerState(
  state: RationalPowerState,
  base: Rational,
  exponent: bigint,
  estimatedDigits: number
): void {
  if (
    state.baseNumerator === base.numerator &&
    state.baseDenominator === base.denominator &&
    state.exponent === exponent
  ) {
    return;
  }

  state.baseNumerator = base.numerator;
  state.baseDenominator = base.denominator;
  state.exponent = exponent;
  state.numerator = createBigIntPowerState(absBigInt(base.numerator), exponent);
  state.denominator = createBigIntPowerState(base.denominator, exponent);
  state.totalMultiplications = 0;
  state.estimatedResultDigits = estimatedDigits;
}

function createBigIntPowerState(base: bigint, exponent: bigint): BigIntPowerState {
  if (base === ZERO || base === ONE) {
    return {
      base,
      exponent,
      result: base === ZERO ? ZERO : ONE,
      factor: base,
      remaining: ZERO,
      phase: "multiply-result",
      multiplications: 0
    };
  }
  return {
    base,
    exponent,
    result: ONE,
    factor: base,
    remaining: exponent,
    phase: "multiply-result",
    multiplications: 0
  };
}

function continueBigIntPower(state: BigIntPowerState, control?: EvaluationCheckpoint): bigint {
  while (state.remaining > ZERO) {
    if (state.phase === "multiply-result") {
      if (state.remaining % 2n !== ZERO) {
        control?.checkpoint();
        state.result *= state.factor;
        state.multiplications += 1;
      }

      state.remaining /= 2n;
      state.phase = "square-factor";
    }

    if (state.remaining > ZERO) {
      control?.checkpoint();
      state.factor *= state.factor;
      state.multiplications += 1;
    }
    state.phase = "multiply-result";
  }
  return state.result;
}

function estimatePowerResultDecimalDigits(base: Rational, exponent: bigint): number {
  if (base.numerator === ZERO || (absBigInt(base.numerator) === ONE && base.denominator === ONE)) {
    return 1;
  }

  const componentBits = Math.max(
    bitLengthBigInt(absBigInt(base.numerator)),
    bitLengthBigInt(base.denominator)
  );
  const estimatedBits = BigInt(componentBits) * exponent + ONE;
  const estimatedDigits = (estimatedBits * 30_103n) / 100_000n + ONE;
  return estimatedDigits > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(estimatedDigits);
}

function createRootMetrics(): MutableRootMetrics {
  return {
    initialBoundBits: 0,
    newtonIterations: 0,
    powerCheckMultiplications: 0,
    earlyAbortedPowerChecks: 0,
    peakBigIntBits: 0
  };
}

function exactNthRootResult(
  root: Rational | null,
  degree: bigint,
  metrics: MutableRootMetrics
): { readonly root: Rational | null; readonly profile: ExactNthRootProfile } {
  return Object.freeze({
    root,
    profile: Object.freeze({
      degree,
      initialBoundBits: metrics.initialBoundBits,
      newtonIterations: metrics.newtonIterations,
      powerCheckMultiplications: metrics.powerCheckMultiplications,
      earlyAbortedPowerChecks: metrics.earlyAbortedPowerChecks,
      peakBigIntDecimalDigits: Math.ceil(metrics.peakBigIntBits * Math.LOG10E * Math.log(2))
    })
  });
}

function bitLengthBigInt(value: bigint): number {
  return value === ZERO ? 0 : value.toString(2).length;
}
