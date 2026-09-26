import { isValidInertia } from "./NumberScrollInertia.js";

export const MIN_NUMBER_SCROLL_INERTIA = 0.1;
export const MAX_NUMBER_SCROLL_INERTIA = 100;

export function isAcceptedNumberScrollInertia(value: unknown): value is number {
  return (
    isValidInertia(value) &&
    value >= MIN_NUMBER_SCROLL_INERTIA &&
    value <= MAX_NUMBER_SCROLL_INERTIA
  );
}

/** Time is user-facing seconds but the calculation contract uses milliseconds. */
export function parseTimeoutSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:[,.]\d{1,3})?$/u.test(trimmed)) return null;
  const milliseconds = Number(trimmed.replace(",", ".")) * 1000;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

export function parseNumberScrollInertia(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/u.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return isAcceptedNumberScrollInertia(value) ? value : null;
}

export function formatSettingNumber(value: number): string {
  return String(value).replace(".", ",");
}
