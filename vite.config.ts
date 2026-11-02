import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "apps/web",
  plugins: [
    agents(),
    react(),
    cloudflare({
      configPath: process.env.NORTHSTAR_E2E ? "../../wrangler.e2e.jsonc" : "../../wrangler.jsonc",
    }),
  ],
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
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
