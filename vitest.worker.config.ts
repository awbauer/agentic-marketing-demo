import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
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
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: { bindings: { ENVIRONMENT: "local", AUTH_MODE: "development" } },
    }),
  ],
  test: { include: ["apps/edge/**/*.worker.test.ts"] },
});
