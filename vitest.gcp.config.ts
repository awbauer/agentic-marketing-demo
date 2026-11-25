import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// The Google Cloud target (ADR-018): adapters and the Node host, tested in plain Node.
export default defineConfig({
  resolve: {
    alias: [
      // Exactly the package root: its /react entry is the browser's, never the server's.
      {
        find: /^@cloudflare\/ai-chat$/,
        replacement: fileURLToPath(new URL("./apps/gcp/src/agent/ai-chat.ts", import.meta.url)),
      },
      {
        find: "@northstar/architecture",
        replacement: fileURLToPath(
          new URL("./packages/architecture/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@northstar/contracts",
        replacement: fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      },
      {
        find: "@northstar/knowledge-graph",
        replacement: fileURLToPath(
          new URL("./packages/knowledge-graph/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@northstar/evals/pricing",
        replacement: fileURLToPath(new URL("./packages/evals/src/pricing.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["apps/gcp/**/*.test.ts"],
    globalSetup: ["./apps/gcp/test/firestore-emulator.ts"],
    testTimeout: 30_000,
  },
});
