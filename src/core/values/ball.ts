import type {
  BigFloatBackend,
  InternalFloat,
  NonNegativeInternalFloat
} from "../backend/contracts.js";
import { divisionByZeroError } from "../errors/index.js";
import type { DivisionByZeroError } from "../errors/index.js";
import type { Ball, PrecisionCutoffMetadata, Rational, Sign } from "./contracts.js";
import {
  absRational,
  addRational,
  compareRational,
  createRational,
  divideRational,
  isZeroRational,
  multiplyRational,
  signOfRational,
  subtractRational
} from "./rational.js";

const ZERO = 0n;
const ONE = 1n;
const TWO = 2n;
const TEN = 10n;

export interface InternalInterval {
  readonly kind: "internal-interval";
  readonly lower: InternalFloat;
  readonly upper: InternalFloat;
}

export function createBall(
  center: InternalFloat,
  radius: InternalFloat,
  precisionCutoff?: PrecisionCutoffMetadata
): Ball {
  const ball = {
    kind: "ball",
    center,
    radius: asNonNegativeInternalFloat(radius)
  } satisfies Omit<Ball, "precisionCutoff">;

  if (precisionCutoff === undefined) {
    return Object.freeze(ball);
  }

  return Object.freeze({
    ...ball,
    precisionCutoff
  });
}

export function createInternalInterval(
  lower: InternalFloat,
  upper: InternalFloat,
  backend: BigFloatBackend
): InternalInterval {
  if (backend.compare(lower, upper) > 0) {
    throw new Error("Internal interval lower bound must not exceed upper bound");
  }

  return Object.freeze({
    kind: "internal-interval",
    lower,
    upper
  });
}

export function rationalToBall(
  value: Rational,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  return intervalToBall(
    createInternalInterval(
      backend.fromRational(value, precisionBits, "towardNegativeInfinity"),
      backend.fromRational(value, precisionBits, "towardPositiveInfinity"),
      backend
    ),
    precisionBits,
    backend
  );
}

export function ballToOutwardInterval(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): InternalInterval {
  return createInternalInterval(
    backend.sub(ball.center, ball.radius, precisionBits, "towardNegativeInfinity"),
    backend.add(ball.center, ball.radius, precisionBits, "towardPositiveInfinity"),
    backend
  );
}

export function intervalToBall(
  interval: InternalInterval,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const checkedInterval = createInternalInterval(interval.lower, interval.upper, backend);
  const lower = internalFloatToRational(checkedInterval.lower);
  const upper = internalFloatToRational(checkedInterval.upper);
  const midpoint = divideRational(addRational(lower, upper), integerRational(TWO));
  const center = backend.fromRational(midpoint, precisionBits, "nearest");
  const centerRational = internalFloatToRational(center);
  const radius = maxRational(
    absRational(subtractRational(centerRational, lower)),
    absRational(subtractRational(upper, centerRational))
  );

  return createBall(center, backend.fromRational(radius, precisionBits, "towardPositiveInfinity"));
}

export function addBall(
  left: Ball,
  right: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const leftInterval = ballToOutwardInterval(left, precisionBits, backend);
  const rightInterval = ballToOutwardInterval(right, precisionBits, backend);

  return intervalToBall(
    createInternalInterval(
      backend.add(leftInterval.lower, rightInterval.lower, precisionBits, "towardNegativeInfinity"),
      backend.add(leftInterval.upper, rightInterval.upper, precisionBits, "towardPositiveInfinity"),
      backend
    ),
    precisionBits,
    backend
  );
}

export function subtractBall(
  left: Ball,
  right: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const leftInterval = ballToOutwardInterval(left, precisionBits, backend);
  const rightInterval = ballToOutwardInterval(right, precisionBits, backend);

  return intervalToBall(
    createInternalInterval(
      backend.sub(leftInterval.lower, rightInterval.upper, precisionBits, "towardNegativeInfinity"),
      backend.sub(leftInterval.upper, rightInterval.lower, precisionBits, "towardPositiveInfinity"),
      backend
    ),
    precisionBits,
    backend
  );
}

export function multiplyBall(
  left: Ball,
  right: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const leftInterval = ballToOutwardInterval(left, precisionBits, backend);
  const rightInterval = ballToOutwardInterval(right, precisionBits, backend);

  return intervalToBall(
    createInternalInterval(
      minFloat(
        [
          backend.mul(
            leftInterval.lower,
            rightInterval.lower,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.mul(
            leftInterval.lower,
            rightInterval.upper,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.mul(
            leftInterval.upper,
            rightInterval.lower,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.mul(
            leftInterval.upper,
            rightInterval.upper,
            precisionBits,
            "towardNegativeInfinity"
          )
        ],
        backend
      ),
      maxFloat(
        [
          backend.mul(
            leftInterval.lower,
            rightInterval.lower,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.mul(
            leftInterval.lower,
            rightInterval.upper,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.mul(
            leftInterval.upper,
            rightInterval.lower,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.mul(
            leftInterval.upper,
            rightInterval.upper,
            precisionBits,
            "towardPositiveInfinity"
          )
        ],
        backend
      ),
      backend
    ),
    precisionBits,
    backend
  );
}

export function divideBall(
  left: Ball,
  right: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const leftInterval = ballToOutwardInterval(left, precisionBits, backend);
  const rightInterval = ballToOutwardInterval(right, precisionBits, backend);

  if (containsZeroInterval(rightInterval, backend)) {
    throwDivisionByZeroError("Cannot divide by a ball whose denominator interval contains zero");
  }

  return intervalToBall(
    createInternalInterval(
      minFloat(
        [
          backend.div(
            leftInterval.lower,
            rightInterval.lower,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.div(
            leftInterval.lower,
            rightInterval.upper,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.div(
            leftInterval.upper,
            rightInterval.lower,
            precisionBits,
            "towardNegativeInfinity"
          ),
          backend.div(
            leftInterval.upper,
            rightInterval.upper,
            precisionBits,
            "towardNegativeInfinity"
          )
        ],
        backend
      ),
      maxFloat(
        [
          backend.div(
            leftInterval.lower,
            rightInterval.lower,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.div(
            leftInterval.lower,
            rightInterval.upper,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.div(
            leftInterval.upper,
            rightInterval.lower,
            precisionBits,
            "towardPositiveInfinity"
          ),
          backend.div(
            leftInterval.upper,
            rightInterval.upper,
            precisionBits,
            "towardPositiveInfinity"
          )
        ],
        backend
      ),
      backend
    ),
    precisionBits,
    backend
  );
}

export function applyPrecisionCutoff(
  ball: Ball,
  cutoffDigits: number,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  validatePrecisionCutoffDigits(cutoffDigits);

  const workingPrecisionBits = Math.max(
    precisionBits,
    ball.center.precisionBits,
    ball.radius.precisionBits
  );
  const interval = ballToOutwardInterval(ball, workingPrecisionBits, backend);
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);

  if (compareRational(lower, upper) === 0 && isZeroRational(lower)) {
    return ball;
  }

  const step = precisionCutoffStepForInterval(lower, upper, cutoffDigits);
  const halfStep = divideRational(step, integerRational(TWO));
  const roundedCenter = roundHalfAwayFromZeroToStep(internalFloatToRational(ball.center), step);
  const roundedLower = roundHalfAwayFromZeroToStep(lower, step);
  const roundedUpper = roundHalfAwayFromZeroToStep(upper, step);
  const lowerRoundedBound = minRational(roundedLower, roundedUpper);
  const upperRoundedBound = maxRational(roundedLower, roundedUpper);
  const finalLower = subtractRational(lowerRoundedBound, halfStep);
  const finalUpper = addRational(upperRoundedBound, halfStep);
  const storedCenter = backend.fromRational(roundedCenter, workingPrecisionBits, "nearest");
  const storedCenterRational = internalFloatToRational(storedCenter);
  const radius = maxRational(
    absRational(subtractRational(storedCenterRational, finalLower)),
    absRational(subtractRational(finalUpper, storedCenterRational))
  );

  return createBall(
    storedCenter,
    backend.fromRational(radius, workingPrecisionBits, "towardPositiveInfinity"),
    Object.freeze({
      kind: "precision-cutoff",
      cutoffDigits,
      stepExponent10: decimalExponentOfPowerOfTen(step),
      roundedCenter,
      roundedLower,
      roundedUpper,
      ambiguousBoundary: compareRational(roundedLower, roundedUpper) !== 0
    })
  );
}

export function widenOutwardBall(
  ball: Ball,
  extraRadius: InternalFloat,
  precisionBits: number,
  backend: BigFloatBackend
): Ball {
  const nonNegativeExtraRadius = backend.abs(extraRadius);

  return createBall(
    ball.center,
    backend.add(ball.radius, nonNegativeExtraRadius, precisionBits, "towardPositiveInfinity")
  );
}

export function widenOutwardInterval(
  interval: InternalInterval,
  amount: InternalFloat,
  precisionBits: number,
  backend: BigFloatBackend
): InternalInterval {
  const nonNegativeAmount = backend.abs(amount);

  return createInternalInterval(
    backend.sub(interval.lower, nonNegativeAmount, precisionBits, "towardNegativeInfinity"),
    backend.add(interval.upper, nonNegativeAmount, precisionBits, "towardPositiveInfinity"),
    backend
  );
}

export function definitelyPositiveBall(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): boolean {
  return definitelyPositiveInterval(ballToOutwardInterval(ball, precisionBits, backend), backend);
}

export function definitelyNegativeBall(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): boolean {
  return definitelyNegativeInterval(ballToOutwardInterval(ball, precisionBits, backend), backend);
}

export function definitelyZeroBall(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): boolean {
  return definitelyZeroInterval(ballToOutwardInterval(ball, precisionBits, backend), backend);
}

export function containsZeroBall(
  ball: Ball,
  precisionBits: number,
  backend: BigFloatBackend
): boolean {
  return containsZeroInterval(ballToOutwardInterval(ball, precisionBits, backend), backend);
}

export function definitelyPositiveInterval(
  interval: InternalInterval,
  backend: BigFloatBackend
): boolean {
  return backend.compare(interval.lower, zeroFloat(backend)) > 0;
}

export function definitelyNegativeInterval(
  interval: InternalInterval,
  backend: BigFloatBackend
): boolean {
  return backend.compare(interval.upper, zeroFloat(backend)) < 0;
}

export function definitelyZeroInterval(
  interval: InternalInterval,
  backend: BigFloatBackend
): boolean {
  const zero = zeroFloat(backend);

  return backend.compare(interval.lower, zero) === 0 && backend.compare(interval.upper, zero) === 0;
}

export function containsZeroInterval(
  interval: InternalInterval,
  backend: BigFloatBackend
): boolean {
  const zero = zeroFloat(backend);

  return backend.compare(interval.lower, zero) <= 0 && backend.compare(interval.upper, zero) >= 0;
}

function asNonNegativeInternalFloat(value: InternalFloat): NonNegativeInternalFloat {
  if (value.sign < 0) {
    throw new Error("Ball radius must be non-negative");
  }

  return value as NonNegativeInternalFloat;
}

function minFloat(values: readonly InternalFloat[], backend: BigFloatBackend): InternalFloat {
  const first = values[0];
  if (first === undefined) {
    throw new Error("minFloat requires at least one value");
  }

  let result = first;

  for (const value of values.slice(1)) {
    if (backend.compare(value, result) < 0) {
      result = value;
    }
  }

  return result;
}

function maxFloat(values: readonly InternalFloat[], backend: BigFloatBackend): InternalFloat {
  const first = values[0];
  if (first === undefined) {
    throw new Error("maxFloat requires at least one value");
  }

  let result = first;

  for (const value of values.slice(1)) {
    if (backend.compare(value, result) > 0) {
      result = value;
    }
  }

  return result;
}

function integerRational(value: bigint): Rational {
  return createRational(value, ONE);
}

function precisionCutoffStepForInterval(
  lower: Rational,
  upper: Rational,
  cutoffDigits: number
): Rational {
  const lowerMagnitude = absRational(lower);
  const upperMagnitude = absRational(upper);
  const magnitude = maxRational(lowerMagnitude, upperMagnitude);
  const exponent =
    isZeroRational(magnitude) || compareRational(magnitude, integerRational(ONE)) < 0
      ? -BigInt(cutoffDigits)
      : floorLog10Rational(magnitude) - BigInt(cutoffDigits);

  return powerOfTenRational(exponent);
}

function roundHalfAwayFromZeroToStep(value: Rational, step: Rational): Rational {
  const scaled = divideRational(value, step);
  const roundedMagnitude = roundHalfAwayFromZeroToInteger(absRational(scaled));
  const rounded =
    signOfRational(scaled) < 0
      ? integerRational(-roundedMagnitude)
      : integerRational(roundedMagnitude);

  return multiplyRational(rounded, step);
}

function roundHalfAwayFromZeroToInteger(value: Rational): bigint {
  if (value.numerator < ZERO) {
    throw new Error("roundHalfAwayFromZeroToInteger requires a non-negative rational");
  }

  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;

  return remainder * TWO < value.denominator ? quotient : quotient + ONE;
}

function floorLog10Rational(value: Rational): bigint {
  if (value.numerator <= ZERO) {
    throw new Error("floorLog10Rational requires a positive rational");
  }

  let exponent = BigInt(value.numerator.toString().length - value.denominator.toString().length);

  while (comparePositiveRationalToPowerOfTen(value, exponent) < 0) {
    exponent -= ONE;
  }

  while (comparePositiveRationalToPowerOfTen(value, exponent + ONE) >= 0) {
    exponent += ONE;
  }

  return exponent;
}

function comparePositiveRationalToPowerOfTen(value: Rational, exponent: bigint): Sign {
  const left = exponent >= ZERO ? value.numerator : value.numerator * powerOfTen(-exponent);
  const right = exponent >= ZERO ? value.denominator * powerOfTen(exponent) : value.denominator;

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function powerOfTenRational(exponent: bigint): Rational {
  return exponent >= ZERO
    ? createRational(powerOfTen(exponent), ONE)
    : createRational(ONE, powerOfTen(-exponent));
}

function decimalExponentOfPowerOfTen(value: Rational): bigint {
  const denominator = value.denominator.toString();
  const numerator = value.numerator.toString();

  if (value.numerator === ONE && isPowerOfTenString(denominator)) {
    return -BigInt(denominator.length - 1);
  }

  if (value.denominator === ONE && isPowerOfTenString(numerator)) {
    return BigInt(numerator.length - 1);
  }

  throw new Error("Expected a power-of-ten rational");
}

function isPowerOfTenString(value: string): boolean {
  if (!value.startsWith("1")) {
    return false;
  }

  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== "0") {
      return false;
    }
  }

  return true;
}

function powerOfTen(exponent: bigint): bigint {
  if (exponent < ZERO) {
    throw new Error("powerOfTen requires a non-negative exponent");
  }

  return TEN ** exponent;
}

function minRational(left: Rational, right: Rational): Rational {
  return compareRational(left, right) <= 0 ? left : right;
}

function maxRational(left: Rational, right: Rational): Rational {
  return compareRational(left, right) >= 0 ? left : right;
}

function validatePrecisionCutoffDigits(cutoffDigits: number): void {
  if (!Number.isSafeInteger(cutoffDigits) || cutoffDigits < 1) {
    throw new Error("precision cutoff digits must be a positive safe integer");
  }
}

function internalFloatToRational(value: InternalFloat): Rational {
  if (value.sign === 0) {
    return createRational(ZERO, ONE);
  }

  const signedSignificand = value.sign === 1 ? value.significand : -value.significand;

  if (value.exponent >= ZERO) {
    return createRational(signedSignificand * powerOfTwo(value.exponent), ONE);
  }

  return createRational(signedSignificand, powerOfTwo(-value.exponent));
}

function powerOfTwo(exponent: bigint): bigint {
  if (exponent < ZERO) {
    throw new Error("powerOfTwo requires a non-negative exponent");
  }

  return ONE << exponent;
}

function zeroFloat(backend: BigFloatBackend): InternalFloat {
  return backend.fromRational({ kind: "rational", numerator: 0n, denominator: 1n }, 1, "nearest");
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
