import type { FormattedNumber, NumberFormatOptions, VerifiedNumber } from "./contracts.js";

const DEFAULT_SCIENTIFIC_NOTATION_THRESHOLD = 12;
const DEFAULT_DECIMAL_SEPARATOR = ",";
const DEFAULT_ELLIPSIS = "...";
const ZERO = 0n;
const ONE = 1n;

export function formatVerifiedNumber(
  value: VerifiedNumber,
  options: NumberFormatOptions = {}
): FormattedNumber {
  const decimalSeparator = options.decimalSeparator ?? DEFAULT_DECIMAL_SEPARATOR;
  const ellipsis = options.ellipsis ?? DEFAULT_ELLIPSIS;
  const scientificNotationThreshold =
    options.scientificNotationThreshold ?? DEFAULT_SCIENTIFIC_NOTATION_THRESHOLD;

  validateFormatOptions(decimalSeparator, scientificNotationThreshold);

  if (value.sign === 0 || value.digits.length === 0 || value.verifiedDigits === 0) {
    return Object.freeze({
      text: `${value.zeroKind === "rounded" ? ellipsis : ""}0`,
      notation: "plain",
      usedVerifiedDigits: 0
    });
  }

  const suffix = needsEllipsis(value) ? ellipsis : "";
  const magnitude = absBigInt(value.exponent10);
  const notation =
    magnitude >= BigInt(scientificNotationThreshold) ? "scientific" : ("plain" as const);
  const unsigned =
    notation === "scientific"
      ? formatScientific(value, decimalSeparator)
      : formatPlain(value, decimalSeparator, suffix);

  return Object.freeze({
    text: `${value.sign < 0 ? "-" : ""}${unsigned}`,
    notation,
    usedVerifiedDigits: value.digits.length
  });
}

function formatPlain(value: VerifiedNumber, decimalSeparator: string, suffix: string): string {
  const integerDigits = value.exponent10 + ONE;

  if (integerDigits <= ZERO) {
    return `0${decimalSeparator}${"0".repeat(safeNumber(-integerDigits))}${value.digits}${suffix}`;
  }

  const integerDigitCount = safeNumber(integerDigits);
  if (value.digits.length <= integerDigitCount) {
    const padding =
      value.valueExact && value.decimalTerminating
        ? "0".repeat(integerDigitCount - value.digits.length)
        : "";

    return `${value.digits}${padding}${suffix}`;
  }

  const integerPart = value.digits.slice(0, integerDigitCount);
  const fractionalPart = value.digits.slice(integerDigitCount);

  return `${integerPart}${decimalSeparator}${fractionalPart}${suffix}`;
}

function formatScientific(value: VerifiedNumber, decimalSeparator: string): string {
  const head = value.digits[0];
  if (head === undefined) {
    return "0";
  }

  const tail = value.digits.slice(1);
  const significand = tail.length === 0 ? head : `${head}${decimalSeparator}${tail}`;

  return `${significand}E${value.exponent10.toString()}`;
}

function needsEllipsis(value: VerifiedNumber): boolean {
  return !(value.valueExact && value.decimalTerminating);
}

function validateFormatOptions(
  decimalSeparator: string,
  scientificNotationThreshold: number
): void {
  if (decimalSeparator !== DEFAULT_DECIMAL_SEPARATOR) {
    throw new Error("Only decimal comma is supported by the core formatter");
  }

  if (!Number.isSafeInteger(scientificNotationThreshold) || scientificNotationThreshold < 1) {
    throw new Error("scientificNotationThreshold must be a positive safe integer");
  }
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Formatted exponent is too large for plain notation");
  }

  return Number(value);
}

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}
