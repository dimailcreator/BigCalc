import { describe, expect, it } from "vitest";
import {
  rationalScale as r,
  PI_SCALE,
  multiplyScales,
  divideScales,
  powerScale,
  copyScale,
  compileUnitScale
} from "../../../../src/app/modules/units/UnitExpression.js";
import { expectExactFactor } from "./UnitFactorTestHelpers.js";

describe("unit factor representations", () => {
  it("canonicalizes signed rationals and rejects zero denominators", () => {
    expect(r(6n, -9n)).toEqual({ kind: "rational", numerator: -2n, denominator: 3n });
    expect(r(0n, -12n)).toEqual({ kind: "rational", numerator: 0n, denominator: 1n });
    expect(() => r(1n, 0n)).toThrow(RangeError);
  });
  it("keeps rational arithmetic exact across generated fraction products and quotients", () => {
    for (let a = -9n; a <= 9n; a++) {
      for (let b = 1n; b <= 9n; b++) {
        const x = r(a, b);
        const y = r(13n, 7n);
        expectExactFactor(multiplyScales(x, y), a * 13n, b * 7n);
        expectExactFactor(divideScales(x, y), a * 7n, b * 13n);
        expect(divideScales(multiplyScales(x, y), y)).toEqual(x);
      }
    }
  });
  it("compiles only explicit typed factors and parenthesizes negative powers", () => {
    expect(compileUnitScale(divideScales(PI_SCALE, r(180n)))).toBe("(π)/(180)");
    expect(compileUnitScale(multiplyScales(r(3n, 2n), powerScale(PI_SCALE, -2n)))).toBe(
      "((3/2))*((π)^(-2))"
    );
    expect(compileUnitScale(powerScale(r(2n, 3n), 0n))).toBe("1");
    expect(copyScale(powerScale(divideScales(PI_SCALE, r(2n)), -3n))).toEqual(
      powerScale(divideScales(PI_SCALE, r(2n)), -3n)
    );
  });
  it("stores enormous powers symbolically instead of allocating enormous rationals", () => {
    const huge = 999999999999999999999999999999n;
    const result = powerScale(r(10n), huge);
    expect(result).toEqual({ kind: "power", base: r(10n), exponent: huge });
    expect(compileUnitScale(result)).toBe(`(10)^(${String(huge)})`);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
