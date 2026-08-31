export const CORE_INTERNAL_MODULES = [
  "syntax",
  "registry",
  "values",
  "backend",
  "evaluation",
  "math",
  "resources",
  "formatting",
  "history",
  "errors"
] as const;

export type CoreInternalModule = (typeof CORE_INTERNAL_MODULES)[number];
