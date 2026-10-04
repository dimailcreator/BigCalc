export type AppTheme = "dark" | "light";

export type AppPalette = "lavender" | "blue" | "teal" | "amber" | "rose" | "liquid-glass";

export type DisplaySize = "small" | "medium" | "large";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light";
}

export function isAppPalette(value: unknown): value is AppPalette {
  return (
    value === "lavender" ||
    value === "blue" ||
    value === "teal" ||
    value === "amber" ||
    value === "rose" ||
    value === "liquid-glass"
  );
}

export function isDisplaySize(value: unknown): value is DisplaySize {
  return value === "small" || value === "medium" || value === "large";
}
