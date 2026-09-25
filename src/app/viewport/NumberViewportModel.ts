import type { VerifiedNumberDto } from "../calculation/CalculationProtocol.js";

export type NumberSlotKind =
  "digit" | "placeholder" | "comma" | "ellipsis" | "sign" | "exponent" | "padding";

export interface NumberSlot {
  readonly kind: NumberSlotKind;
  readonly text: string;
  /** Index zero is the first significant digit in VerifiedNumber.digits. */
  readonly digitIndex?: bigint;
}

export interface ComputedDigitRange {
  readonly start: 0;
  readonly endExclusive: number;
}

export interface NumberViewportInput {
  readonly value: VerifiedNumberDto;
  readonly availableSlots: number;
  /** Index of the first visible digit relative to the first significant digit. */
  readonly logicalStart?: bigint;
  /** Core currently provides a prefix; this may be shorter than the supplied test value. */
  readonly computedRange?: ComputedDigitRange;
}

export interface NumberViewportView {
  readonly representation: "decimal" | "scientific" | "pending" | "displayError";
  readonly slots: readonly NumberSlot[];
  readonly text: string;
  readonly logicalStart: bigint;
  readonly firstDigitIndex: bigint | null;
  readonly lastDigitIndex: bigint | null;
  readonly exactEndIndex: bigint | null;
  readonly canScrollLeft: boolean;
  readonly canScrollRight: boolean;
  /** A Core significant-digit request; null means no further request is needed. */
  readonly precisionDemand: number | null;
  readonly zeroKind?: "exact" | "rounded";
}

interface Layout {
  readonly slots: NumberSlot[];
  readonly lastDigitIndex: bigint | null;
  readonly commaVisible: boolean;
  readonly significantCapacity: number;
}

const DISPLAY_ERROR = "Ошибка отображения";
const PRECISION_BLOCK = 50;
const MAX_VISUAL_SLOTS = 256;

/** Pure, bounded formatter for one discrete window of a VerifiedNumber. */
export function createNumberViewportModel(input: NumberViewportInput): NumberViewportView {
  const { value, availableSlots } = input;
  if (
    !Number.isSafeInteger(availableSlots) ||
    availableSlots < 1 ||
    availableSlots > MAX_VISUAL_SLOTS
  ) {
    throw new RangeError("availableSlots must be between 1 and 256");
  }
  if (!/^\d*$/u.test(value.digits) || value.verifiedDigits !== value.digits.length) {
    throw new TypeError("VerifiedNumber digits and verifiedDigits disagree");
  }
  const computedEnd = input.computedRange?.endExclusive ?? value.verifiedDigits;
  if (!Number.isSafeInteger(computedEnd) || computedEnd < 0 || computedEnd > value.verifiedDigits) {
    throw new RangeError("computedRange must fit inside the verified prefix");
  }

  if (value.sign === 0 && value.verifiedDigits === 0 && value.zeroKind === undefined) {
    const slots = Array.from({ length: availableSlots }, (): NumberSlot => ({
      kind: "placeholder",
      text: " "
    }));
    return {
      representation: "pending",
      slots,
      text: " ".repeat(availableSlots),
      logicalStart: 0n,
      firstDigitIndex: null,
      lastDigitIndex: null,
      exactEndIndex: null,
      canScrollLeft: false,
      canScrollRight: false,
      precisionDemand: initialViewportPrecisionDemand(availableSlots)
    };
  }
  if (value.sign === 0) {
    const slots = padLeft([{ kind: "digit", text: "0", digitIndex: 0n }], availableSlots);
    return {
      ...view("decimal", slots, 0n, 0n, 0n, 0n, false, false, null),
      ...(value.zeroKind === undefined ? {} : { zeroKind: value.zeroKind })
    };
  }
  if (value.digits.length === 0 && value.valueExact) {
    throw new TypeError("An exact nonzero number must have digits");
  }

  const exactEndIndex = finiteEnd(value);
  const possibleInitial = value.exponent10 < 0n ? value.exponent10 : 0n;
  const initialDecimal = decimalLayout(
    value,
    possibleInitial,
    availableSlots,
    computedEnd,
    exactEndIndex
  );
  const initialStart = decimalUsable(initialDecimal, value.exponent10, exactEndIndex)
    ? possibleInitial
    : 0n;
  const requested = input.logicalStart ?? initialStart;
  const rightBoundary =
    exactEndIndex === null
      ? null
      : lastFilledStart(value, initialStart, exactEndIndex, availableSlots, computedEnd);
  const logicalStart = clamp(requested, initialStart, rightBoundary);
  const decimal = decimalLayout(value, logicalStart, availableSlots, computedEnd, exactEndIndex);
  const layout = decimalUsable(decimal, value.exponent10, exactEndIndex)
    ? decimal
    : scientificLayout(value, logicalStart, availableSlots, computedEnd, exactEndIndex);
  if (layout === null) return displayError(logicalStart, exactEndIndex);

  const representation = layout === decimal ? "decimal" : "scientific";
  const slots = padLeft(layout.slots, availableSlots);
  const last = layout.lastDigitIndex;
  const canScrollRight = last !== null && (exactEndIndex === null || last < exactEndIndex);
  const precisionDemand = demandForSlots(
    slots,
    computedEnd,
    exactEndIndex,
    logicalStart === initialStart
  );
  return view(
    representation,
    slots,
    logicalStart,
    last === null ? null : logicalStart,
    last,
    exactEndIndex,
    logicalStart > initialStart,
    canScrollRight,
    precisionDemand
  );
}

/** Find the earliest final window that still contains the last finite digit. */
function lastFilledStart(
  value: VerifiedNumberDto,
  initialStart: bigint,
  end: bigint,
  slots: number,
  computedEnd: number
): bigint {
  const first = end - BigInt(slots) > initialStart ? end - BigInt(slots) : initialStart;
  for (let start = first; start <= end; start += 1n) {
    const decimal = decimalLayout(value, start, slots, computedEnd, end);
    const layout = decimalUsable(decimal, value.exponent10, end)
      ? decimal
      : scientificLayout(value, start, slots, computedEnd, end);
    if (layout?.lastDigitIndex === end) return start;
  }
  return end;
}

/** Before the first result reveals its exponent, one slot can need at most one digit. */
export function initialViewportPrecisionDemand(availableSlots: number): number {
  if (
    !Number.isSafeInteger(availableSlots) ||
    availableSlots < 1 ||
    availableSlots > MAX_VISUAL_SLOTS
  ) {
    throw new RangeError("availableSlots must be between 1 and 256");
  }
  return availableSlots;
}

function finiteEnd(value: VerifiedNumberDto): bigint | null {
  if (!value.valueExact || !value.decimalTerminating) {
    return value.rounded ? BigInt(value.digits.length - 1) : null;
  }
  const significantEnd = BigInt(value.digits.replace(/0+$/u, "").length - 1);
  return value.exponent10 > significantEnd ? value.exponent10 : significantEnd;
}

function decimalLayout(
  value: VerifiedNumberDto,
  start: bigint,
  availableSlots: number,
  computedEnd: number,
  exactEnd: bigint | null
): Layout {
  const slots = prefixSlots(value, start);
  let index = start;
  let lastDigitIndex: bigint | null = null;
  let commaVisible = false;
  let significantCapacity = 0;
  const commaBefore = value.exponent10 + 1n;
  while (slots.length < availableSlots && (exactEnd === null || index <= exactEnd)) {
    if (index === commaBefore) {
      slots.push({ kind: "comma", text: "," });
      commaVisible = true;
      if (slots.length === availableSlots) break;
    }
    slots.push(digitSlot(value, index, computedEnd));
    lastDigitIndex = index;
    if (index >= 0n) significantCapacity += 1;
    index += 1n;
  }
  return { slots, lastDigitIndex, commaVisible, significantCapacity };
}

function decimalUsable(layout: Layout, exponent10: bigint, exactEnd: bigint | null): boolean {
  if (layout.commaVisible && layout.significantCapacity > 0) return true;
  return exactEnd !== null && exactEnd === exponent10 && layout.lastDigitIndex === exactEnd;
}

function scientificLayout(
  value: VerifiedNumberDto,
  start: bigint,
  availableSlots: number,
  computedEnd: number,
  exactEnd: bigint | null
): Layout | null {
  const prefix = prefixSlots(value, start);
  // Reserve room for two significant digit positions even if an exact result ends sooner.
  for (let capacity = availableSlots - prefix.length - 1; capacity >= 2; capacity -= 1) {
    const available =
      exactEnd === null ? BigInt(capacity) : min(BigInt(capacity), exactEnd - start + 1n);
    if (available <= 0n) return null;
    const actual = Number(available);
    const last = start + available - 1n;
    const exponent = value.exponent10 - last;
    const exponentText = `E${exponent.toString()}`;
    if (prefix.length + capacity + exponentText.length > availableSlots) continue;
    const slots = [...prefix];
    for (let offset = 0; offset < actual; offset += 1) {
      slots.push(digitSlot(value, start + BigInt(offset), computedEnd));
    }
    for (const text of exponentText) slots.push({ kind: "exponent", text });
    return { slots, lastDigitIndex: last, commaVisible: false, significantCapacity: capacity };
  }
  return null;
}

function prefixSlots(value: VerifiedNumberDto, start: bigint): NumberSlot[] {
  const slots: NumberSlot[] = [];
  if (value.sign < 0) slots.push({ kind: "sign", text: "-" });
  if (start > 0n || (start < 0n && value.exponent10 < 0n && start > value.exponent10)) {
    slots.push({ kind: "ellipsis", text: ".." });
  }
  return slots;
}

function digitSlot(value: VerifiedNumberDto, index: bigint, computedEnd: number): NumberSlot {
  if (index < 0n) return { kind: "digit", text: "0", digitIndex: index };
  if (value.valueExact && value.decimalTerminating && index < BigInt(value.digits.length)) {
    return { kind: "digit", text: value.digits[Number(index)] ?? "0", digitIndex: index };
  }
  if (index < BigInt(computedEnd)) {
    return { kind: "digit", text: value.digits[Number(index)] ?? "0", digitIndex: index };
  }
  if (value.valueExact && value.decimalTerminating && index >= BigInt(value.digits.length)) {
    return { kind: "digit", text: "0", digitIndex: index };
  }
  return { kind: "placeholder", text: " ", digitIndex: index };
}

function demandForSlots(
  slots: readonly NumberSlot[],
  computedEnd: number,
  exactEnd: bigint | null,
  initialWindow: boolean
): number | null {
  if (exactEnd !== null) return null;
  let required = 0n;
  for (const slot of slots) {
    if (slot.kind !== "placeholder" || slot.digitIndex === undefined) continue;
    if (slot.digitIndex + 1n > required) required = slot.digitIndex + 1n;
  }
  if (required <= BigInt(computedEnd)) return null;
  if (required > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const requested = Number(required);
  if (initialWindow || computedEnd === 0) return Math.max(2, requested);
  const blockCount = Math.ceil((requested - computedEnd) / PRECISION_BLOCK);
  const demand = computedEnd + blockCount * PRECISION_BLOCK;
  return Number.isSafeInteger(demand) ? demand : null;
}

function padLeft(slots: NumberSlot[], availableSlots: number): NumberSlot[] {
  const missing = Math.max(0, availableSlots - slots.length);
  return [
    ...Array.from({ length: missing }, (): NumberSlot => ({ kind: "padding", text: " " })),
    ...slots
  ];
}

function displayError(start: bigint, exactEnd: bigint | null): NumberViewportView {
  return {
    representation: "displayError",
    slots: [],
    text: DISPLAY_ERROR,
    logicalStart: start,
    firstDigitIndex: null,
    lastDigitIndex: null,
    exactEndIndex: exactEnd,
    canScrollLeft: false,
    canScrollRight: false,
    precisionDemand: null
  };
}

function view(
  representation: "decimal" | "scientific",
  slots: NumberSlot[],
  logicalStart: bigint,
  firstDigitIndex: bigint | null,
  lastDigitIndex: bigint | null,
  exactEndIndex: bigint | null,
  canScrollLeft: boolean,
  canScrollRight: boolean,
  precisionDemand: number | null
): NumberViewportView {
  return {
    representation,
    slots,
    text: slots.map((slot) => slot.text).join(""),
    logicalStart,
    firstDigitIndex,
    lastDigitIndex,
    exactEndIndex,
    canScrollLeft,
    canScrollRight,
    precisionDemand
  };
}

function clamp(value: bigint, lower: bigint, upper: bigint | null): bigint {
  if (value < lower) return lower;
  if (upper !== null && value > upper) return upper;
  return value;
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
