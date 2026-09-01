import type {
  BigFloatBackend,
  InternalFloat,
  NonNegativeInternalFloat
} from "../backend/contracts.js";
import { divisionByZeroError } from "../errors/index.js";
import type { DivisionByZeroError } from "../errors/index.js";
import type { Ball, Rational } from "./contracts.js";

export interface InternalInterval {
  readonly kind: "internal-interval";
  readonly lower: InternalFloat;
  readonly upper: InternalFloat;
}

export function createBall(center: InternalFloat, radius: InternalFloat): Ball {
  return Object.freeze({
    kind: "ball",
    center,
    radius: asNonNegativeInternalFloat(radius)
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
  const radius = backend.sub(
    checkedInterval.upper,
    checkedInterval.lower,
    precisionBits,
    "towardPositiveInfinity"
  );

  return createBall(checkedInterval.lower, radius);
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
