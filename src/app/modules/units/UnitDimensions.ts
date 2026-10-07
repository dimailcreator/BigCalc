/** Exact SI exponents in L, M, T, I, Th, N, J order. */
export type UnitDimensions = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export function unitDimensions(
  L = 0n,
  M = 0n,
  T = 0n,
  I = 0n,
  Th = 0n,
  N = 0n,
  J = 0n
): UnitDimensions {
  return Object.freeze([L, M, T, I, Th, N, J]);
}
export function sameDimensions(a: UnitDimensions, b: UnitDimensions): boolean {
  return a.every((exponent, index) => exponent === b[index]);
}
export function multiplyDimensions(a: UnitDimensions, b: UnitDimensions): UnitDimensions {
  return unitDimensions(
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2],
    a[3] + b[3],
    a[4] + b[4],
    a[5] + b[5],
    a[6] + b[6]
  );
}
export function divideDimensions(a: UnitDimensions, b: UnitDimensions): UnitDimensions {
  return unitDimensions(
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
    a[3] - b[3],
    a[4] - b[4],
    a[5] - b[5],
    a[6] - b[6]
  );
}
export function powerDimensions(a: UnitDimensions, exponent: bigint): UnitDimensions {
  return unitDimensions(
    a[0] * exponent,
    a[1] * exponent,
    a[2] * exponent,
    a[3] * exponent,
    a[4] * exponent,
    a[5] * exponent,
    a[6] * exponent
  );
}
