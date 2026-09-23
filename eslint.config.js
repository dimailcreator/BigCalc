import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-app/**",
      "dist-test/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**"
    ]
  },
  {
    files: ["**/*.js"],
    ...js.configs.recommended
  },
  {
    files: ["benchmarks/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      globals: { process: "readonly", console: "readonly", structuredClone: "readonly" }
    }
  },
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.core.json",
          "./tsconfig.app.json",
          "./tsconfig.app-test.json",
          "./tsconfig.test.json"
        ],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-extraneous-class": "off"
    }
  },
  {
    files: ["src/app/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.{1,2}/)+(?:.*?/)*core(?:/|$)|^src/core(?:/|$)|^@bigcalc/core/",
              message: "Application code must import Core only through @bigcalc/core."
            }
          ]
        }
      ]
    }
  }
);
