export type BmiInputError = "invalidSyntax" | "nonPositive" | "nonFinite";

export type ParsedBmiInput =
  | { readonly status: "empty" }
  | { readonly status: "incomplete" }
  | { readonly status: "invalid"; readonly reason: BmiInputError }
  | { readonly status: "valid"; readonly value: number };

export type BmiCategory =
  | "Недостаточная масса"
  | "Норма"
  | "Избыточная масса"
  | "Ожирение I степени"
  | "Ожирение II степени"
  | "Ожирение III степени";

export type BmiResult =
  | { readonly status: "unavailable" }
  | { readonly status: "invalid"; readonly reason: "unrepresentableResult" }
  | {
      readonly status: "valid";
      readonly rawBmi: number;
      readonly formattedBmi: string;
      readonly category: BmiCategory;
    };

export interface BmiDerivation {
  readonly height: ParsedBmiInput;
  readonly weight: ParsedBmiInput;
  readonly result: BmiResult;
}

const formatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function parseBmiInput(text: string): ParsedBmiInput {
  const trimmed = text.trim();
  if (trimmed === "") return { status: "empty" };
  if (/^\d+[,.]$/u.test(trimmed)) return { status: "incomplete" };
  if (!/^-?\d+(?:[,.]\d+)?$/u.test(trimmed)) {
    return { status: "invalid", reason: "invalidSyntax" };
  }
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) return { status: "invalid", reason: "nonFinite" };
  if (value <= 0) return { status: "invalid", reason: "nonPositive" };
  return { status: "valid", value };
}

export function calculateBmi(heightCm: number, weightKg: number): number | null {
  if (!isPositiveFinite(heightCm) || !isPositiveFinite(weightKg)) return null;
  const heightMeters = heightCm / 100;
  // Sequential division avoids overflowing/underflowing the square of a finite height.
  const bmi = weightKg / heightMeters / heightMeters;
  return isPositiveFinite(bmi) ? bmi : null;
}

export function classifyBmi(rawBmi: number): BmiCategory | null {
  if (!isPositiveFinite(rawBmi)) return null;
  if (rawBmi < 18.5) return "Недостаточная масса";
  if (rawBmi < 25) return "Норма";
  if (rawBmi < 30) return "Избыточная масса";
  if (rawBmi < 35) return "Ожирение I степени";
  if (rawBmi < 40) return "Ожирение II степени";
  return "Ожирение III степени";
}

export function formatBmi(rawBmi: number): string | null {
  if (!isPositiveFinite(rawBmi)) return null;
  return formatter.format(rawBmi).replace(".", ",");
}

export function deriveBmiResult(heightText: string, weightText: string): BmiDerivation {
  const height = parseBmiInput(heightText);
  const weight = parseBmiInput(weightText);
  if (height.status !== "valid" || weight.status !== "valid") {
    return { height, weight, result: { status: "unavailable" } };
  }
  const rawBmi = calculateBmi(height.value, weight.value);
  const category = rawBmi === null ? null : classifyBmi(rawBmi);
  const formattedBmi = rawBmi === null ? null : formatBmi(rawBmi);
  if (rawBmi === null || category === null || formattedBmi === null) {
    return { height, weight, result: { status: "invalid", reason: "unrepresentableResult" } };
  }
  return { height, weight, result: { status: "valid", rawBmi, formattedBmi, category } };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
