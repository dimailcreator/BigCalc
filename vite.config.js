import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@bigcalc/core": fileURLToPath(new URL("./src/core/api.ts", import.meta.url))
    }
  },
  build: {
    outDir: "dist-app",
    emptyOutDir: true
  }
});
