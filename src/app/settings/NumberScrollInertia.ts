export function isValidInertia(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
