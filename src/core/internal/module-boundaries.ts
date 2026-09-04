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
  "transport",
  "errors"
] as const;

export type CoreInternalModule = (typeof CORE_INTERNAL_MODULES)[number];
