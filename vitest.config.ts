import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@northstar/architecture": fileURLToPath(
        new URL("./packages/architecture/src/index.ts", import.meta.url),
      ),
      "@northstar/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@northstar/knowledge-graph": fileURLToPath(
        new URL("./packages/knowledge-graph/src/index.ts", import.meta.url),
      ),
      "@northstar/ui": fileURLToPath(new URL("./packages/ui/src/index.tsx", import.meta.url)),
      "@northstar/evals/report": fileURLToPath(
        new URL("./packages/evals/src/report.ts", import.meta.url),
      ),
      "@northstar/evals/pricing": fileURLToPath(
        new URL("./packages/evals/src/pricing.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "apps/web/**/*.test.ts",
      "apps/web/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
