import type { Sign } from "../values/contracts.js";

export type ZeroKind = "exact" | "rounded";

export interface VerifiedNumber {
  readonly sign: Sign;
  readonly digits: string;
  readonly exponent10: bigint;
  readonly verifiedDigits: number;
  readonly valueExact: boolean;
  readonly decimalTerminating: boolean;
  readonly rounded: boolean;
  readonly zeroKind?: ZeroKind;
}

export interface NumberFormatOptions {
  readonly decimalSeparator?: ",";
  readonly scientificNotationThreshold?: number;
  readonly ellipsis?: string;
}

export interface FormattedNumber {
  readonly text: string;
  readonly notation: "plain" | "scientific";
  readonly usedVerifiedDigits: number;
}
