import type { Rational, Sign } from "../values/contracts.js";

export type RoundingMode = "nearest" | "towardNegativeInfinity" | "towardPositiveInfinity";

export interface InternalFloat {
  readonly kind: "internal-float";
  readonly sign: Sign;
  readonly significand: bigint;
  readonly exponent: bigint;
  readonly precisionBits: number;
}

export interface BigFloatBackend {
  fromRational(value: Rational, precisionBits: number, roundingMode: RoundingMode): InternalFloat;
  compare(left: InternalFloat, right: InternalFloat): Sign;
  add(
    left: InternalFloat,
    right: InternalFloat,
    precisionBits: number,
    roundingMode: RoundingMode
  ): InternalFloat;
  sub(
    left: InternalFloat,
    right: InternalFloat,
    precisionBits: number,
    roundingMode: RoundingMode
  ): InternalFloat;
  mul(
    left: InternalFloat,
    right: InternalFloat,
    precisionBits: number,
    roundingMode: RoundingMode
  ): InternalFloat;
  div(
    left: InternalFloat,
    right: InternalFloat,
    precisionBits: number,
    roundingMode: RoundingMode
  ): InternalFloat;
  round(value: InternalFloat, precisionBits: number, roundingMode: RoundingMode): InternalFloat;
  negate(value: InternalFloat): InternalFloat;
  abs(value: InternalFloat): InternalFloat;
  scaleByPowerOfTwo(value: InternalFloat, exponentDelta: bigint): InternalFloat;
}

export interface NonNegativeInternalFloat {
  readonly kind: "internal-float";
  readonly sign: 0 | 1;
  readonly significand: bigint;
  readonly exponent: bigint;
  readonly precisionBits: number;
}
