import type { UnitDimensions } from "./UnitDimensions.js";
import type { UnitSourceRange } from "./UnitErrors.js";

/** Whitelisted exact/symbolic factor nodes; never raw unit text or a floating-point factor. */
export type UnitScale =
  | { readonly kind: "rational"; readonly numerator: bigint; readonly denominator: bigint }
  | { readonly kind: "pi" }
  | { readonly kind: "product" | "quotient"; readonly left: UnitScale; readonly right: UnitScale }
  | { readonly kind: "power"; readonly base: UnitScale; readonly exponent: bigint };

export function rationalScale(numerator: bigint, denominator = 1n): UnitScale {
  if (denominator === 0n) throw new RangeError("Unit scale denominator must be nonzero");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return Object.freeze({
    kind: "rational",
    numerator: numerator / a,
    denominator: denominator / a
  });
}
export const PI_SCALE: UnitScale = Object.freeze({ kind: "pi" });
export function multiplyScales(left: UnitScale, right: UnitScale): UnitScale {
  if (left.kind === "rational" && right.kind === "rational")
    return rationalScale(left.numerator * right.numerator, left.denominator * right.denominator);
  return Object.freeze({ kind: "product", left, right });
}
export function divideScales(left: UnitScale, right: UnitScale): UnitScale {
  if (left.kind === "rational" && right.kind === "rational")
    return rationalScale(left.numerator * right.denominator, left.denominator * right.numerator);
  return Object.freeze({ kind: "quotient", left, right });
}
export function powerScale(base: UnitScale, exponent: bigint): UnitScale {
  if (exponent === 0n) return rationalScale(1n);
  if (exponent === 1n) return base;
  // Keep powers symbolic: a large syntactically valid exponent must not expand a huge factor.
  return Object.freeze({ kind: "power", base, exponent });
}
export function decimalScale(exponent: bigint): UnitScale {
  return powerScale(rationalScale(10n), exponent);
}
export function copyScale(scale: UnitScale): UnitScale {
  switch (scale.kind) {
    case "rational":
      return rationalScale(scale.numerator, scale.denominator);
    case "pi":
      return PI_SCALE;
    case "product":
      return multiplyScales(copyScale(scale.left), copyScale(scale.right));
    case "quotient":
      return divideScales(copyScale(scale.left), copyScale(scale.right));
    case "power":
      return powerScale(copyScale(scale.base), scale.exponent);
  }
}
/** Produces deterministic mathematical source only; no evaluation or Core dependency. */
export function compileUnitScale(scale: UnitScale): string {
  switch (scale.kind) {
    case "rational":
      return scale.denominator === 1n
        ? String(scale.numerator)
        : `(${String(scale.numerator)}/${String(scale.denominator)})`;
    case "pi":
      return "π";
    case "product":
      return `(${compileUnitScale(scale.left)})*(${compileUnitScale(scale.right)})`;
    case "quotient":
      return `(${compileUnitScale(scale.left)})/(${compileUnitScale(scale.right)})`;
    case "power":
      return `(${compileUnitScale(scale.base)})^(${String(scale.exponent)})`;
  }
}

/** Base temperature = (input + inputOffset) * scale. Rankine retains affine policy. */
export interface UnitAffineTransform {
  readonly inputOffset: UnitScale;
  readonly scale: UnitScale;
}
export type UnitValue =
  | {
      readonly kind: "linear";
      readonly dimensions: UnitDimensions;
      readonly scale: UnitScale;
      readonly standaloneUnitId: string | null;
    }
  | {
      readonly kind: "affine";
      readonly dimensions: UnitDimensions;
      readonly transform: UnitAffineTransform;
      readonly standaloneUnitId: string;
    };
export type UnitSyntax =
  | {
      readonly kind: "atom";
      readonly unitId: string;
      readonly prefixId: string | null;
      readonly range: UnitSourceRange;
    }
  | { readonly kind: "group"; readonly expression: UnitSyntax; readonly range: UnitSourceRange }
  | {
      readonly kind: "power";
      readonly base: UnitSyntax;
      readonly exponent: bigint;
      readonly range: UnitSourceRange;
    }
  | {
      readonly kind: "product" | "quotient";
      readonly left: UnitSyntax;
      readonly right: UnitSyntax;
      readonly range: UnitSourceRange;
    };
export interface ParsedUnitExpression {
  readonly source: string;
  readonly syntax: UnitSyntax;
  readonly value: UnitValue;
}
