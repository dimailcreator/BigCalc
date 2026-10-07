import { describe, expect, it } from "vitest";
import {
  unitDimensions as d,
  sameDimensions,
  multiplyDimensions,
  divideDimensions,
  powerDimensions
} from "../../../../src/app/modules/units/UnitDimensions.js";

describe("exact seven-dimensional algebra", () => {
  it("uses immutable bigint exponents in the documented SI order", () => {
    const vector = d(1n, 2n, 3n, 4n, 5n, 6n, 7n);
    expect(vector).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    expect(Object.isFrozen(vector)).toBe(true);
    expect(sameDimensions(vector, d(1n, 2n, 3n, 4n, 5n, 6n, 7n))).toBe(true);
    expect(sameDimensions(vector, d(1n, 2n, 3n, 4n, 5n, 6n, 8n))).toBe(false);
  });
  it("preserves product/quotient and power identities over generated signed vectors", () => {
    for (let i = -12n; i <= 12n; i++) {
      const a = d(i, i * i, -i, 1n, 0n, 3n, -7n);
      const b = d(2n, 3n, i, -2n, i * i, 5n, 1n);
      expect(divideDimensions(multiplyDimensions(a, b), b)).toEqual(a);
      expect(multiplyDimensions(a, b)).toEqual(multiplyDimensions(b, a));
      expect(powerDimensions(multiplyDimensions(a, b), i)).toEqual(
        multiplyDimensions(powerDimensions(a, i), powerDimensions(b, i))
      );
      expect(powerDimensions(a, 0n)).toEqual(d());
      expect(powerDimensions(a, -1n)).toEqual(divideDimensions(d(), a));
    }
  });
  it("never rounds or overflows exponents beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 9007199254740993n;
    expect(powerDimensions(d(huge, 0n, 1n), huge)).toEqual(d(huge * huge, 0n, huge));
    expect(multiplyDimensions(d(huge), d(1n))).toEqual(d(9007199254740994n));
  });
});
