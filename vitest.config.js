import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bigcalc/core": fileURLToPath(new URL("./src/core/api.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["tests/app/**/*.test.ts"]
  }
});
