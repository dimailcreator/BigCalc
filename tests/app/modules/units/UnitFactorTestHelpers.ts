import { expect } from "vitest";
import type { UnitScale } from "../../../../src/app/modules/units/UnitExpression.js";
import {
  UnitDomainError,
  UnitRegistryConfigurationError
} from "../../../../src/app/modules/units/UnitErrors.js";
import type { UnitSourceRange } from "../../../../src/app/modules/units/UnitErrors.js";

export function expectUnitError(
  run: () => unknown,
  expected: { readonly code: string; readonly range?: UnitSourceRange },
  errorType: typeof UnitDomainError | typeof UnitRegistryConfigurationError = UnitDomainError
): void {
  let failure: unknown;
  try {
    run();
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(errorType);
  expect(failure).toMatchObject(expected);
}

/** Independent exact fraction interpreter for bounded test factors; no Core or float math. */
export function exactFactor(scale: UnitScale): readonly [bigint, bigint] {
  switch (scale.kind) {
    case "rational":
      return [scale.numerator, scale.denominator];
    case "pi":
      throw new Error("Symbolic pi is not a rational factor");
    case "product": {
      const [a, b] = exactFactor(scale.left);
      const [c, d] = exactFactor(scale.right);
      return [a * c, b * d];
    }
    case "quotient": {
      const [a, b] = exactFactor(scale.left);
      const [c, d] = exactFactor(scale.right);
      return [a * d, b * c];
    }
    case "power": {
      const [a, b] = exactFactor(scale.base);
      return scale.exponent < 0n
        ? [b ** -scale.exponent, a ** -scale.exponent]
        : [a ** scale.exponent, b ** scale.exponent];
    }
  }
}
export function expectExactFactor(scale: UnitScale, numerator: bigint, denominator = 1n): void {
  const [a, b] = exactFactor(scale);
  expect(a * denominator).toBe(b * numerator);
}
