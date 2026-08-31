import type { Sign } from "../values/contracts.js";

export type RoundingMode = "nearest" | "towardNegativeInfinity" | "towardPositiveInfinity";

export interface InternalFloat {
  readonly kind: "internal-float";
  readonly sign: Sign;
  readonly significand: bigint;
  readonly exponent: bigint;
  readonly precisionBits: number;
}

export interface NonNegativeInternalFloat {
  readonly kind: "internal-float";
  readonly sign: 0 | 1;
  readonly significand: bigint;
  readonly exponent: bigint;
  readonly precisionBits: number;
}
