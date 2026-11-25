import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// The Google Cloud server bundle (ADR-018): the shared Worker code and the Node host in one file,
// with the Agents SDK's chat agent swapped for the Node implementation. Google's client libraries
// load files at runtime, so they stay external and are installed beside the bundle.
const external = ["@google-cloud/firestore", "@google-cloud/storage", "google-auth-library", "ws"];
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Exactly the package root: its /react entry is the browser's, never the server's.
      { find: /^@cloudflare\/ai-chat$/, replacement: local("./apps/gcp/src/agent/ai-chat.ts") },
      {
        find: "@northstar/architecture",
        replacement: local("./packages/architecture/src/index.ts"),
      },
      { find: "@northstar/contracts", replacement: local("./packages/contracts/src/index.ts") },
      {
        find: "@northstar/knowledge-graph",
        replacement: local("./packages/knowledge-graph/src/index.ts"),
      },
      { find: "@northstar/evals/pricing", replacement: local("./packages/evals/src/pricing.ts") },
    ],
  },
  ssr: { noExternal: true, external },
  build: {
    ssr: "apps/gcp/src/main.ts",
    outDir: "dist/server",
    emptyOutDir: true,
    target: "node26",
    sourcemap: true,
    rolldownOptions: { external, output: { entryFileNames: "server.mjs", format: "es" } },
  },
  plugins: [
    {
      name: "northstar-server-package",
      // The runtime image installs only the externals, at the versions the workspace pins.
      writeBundle() {
        const pkg = JSON.parse(readFileSync(local("./apps/gcp/package.json"), "utf8")) as {
          dependencies: Record<string, string>;
        };
        const dependencies = Object.fromEntries(
          external.map((name) => [name, pkg.dependencies[name] ?? "*"]),
        );
        writeFileSync(
          local("./dist/server/package.json"),
          `${JSON.stringify({ name: "northstar-gcp-server", private: true, type: "module", dependencies }, null, 2)}\n`,
        );
      },
    },
  ],
});
