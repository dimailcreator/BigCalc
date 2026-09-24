import { isValidInertia } from "../settings/NumberScrollInertia.js";

const MOMENTUM_THRESHOLD_PX_PER_MS = 0.35;
const MOMENTUM_HORIZON_MS = 150;

export function dragDigitSteps(distancePx: number, slotWidthPx: number, inertia: number): number {
  validateMotion(distancePx, slotWidthPx, inertia);
  const raw = Math.round((distancePx / slotWidthPx) * inertia);
  return Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, raw));
}

/** Pointer velocity is positive to the right; logical digit motion is positive to the left. */
export function momentumDigitSteps(
  pointerVelocityPxPerMs: number,
  slotWidthPx: number,
  inertia: number,
  visibleSlots: number
): number {
  validateMotion(pointerVelocityPxPerMs, slotWidthPx, inertia);
  if (!Number.isSafeInteger(visibleSlots) || visibleSlots < 1) {
    throw new RangeError("visibleSlots must be a positive safe integer");
  }
  if (Math.abs(pointerVelocityPxPerMs) < MOMENTUM_THRESHOLD_PX_PER_MS) return 0;
  const raw = Math.round(((-pointerVelocityPxPerMs * MOMENTUM_HORIZON_MS) / slotWidthPx) * inertia);
  const limit = visibleSlots * 4;
  return Math.max(-limit, Math.min(limit, raw));
}

function validateMotion(distance: number, slotWidth: number, inertia: number): void {
  if (!Number.isFinite(distance) || !Number.isFinite(slotWidth) || slotWidth <= 0) {
    throw new RangeError("Motion and slot width must be finite; slot width must be positive");
  }
  if (!isValidInertia(inertia)) throw new RangeError("Inertia must be finite and positive");
}
