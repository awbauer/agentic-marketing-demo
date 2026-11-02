import { spawnSync } from "node:child_process";
import { report } from "./lib/report.mjs";
const mode = process.argv[2] ?? "full";
const commands =
  mode === "fast"
    ? [
        ["pnpm", "format:check"],
        ["pnpm", "lint"],
        ["pnpm", "typecheck"],
        ["pnpm", "test:unit"],
        ["pnpm", "sf:metadata:check"],
        ["pnpm", "hxl:check"],
        ["pnpm", "contracts:check"],
        ["pnpm", "docs:check"],
        ["pnpm", "prompts:check"],
        ["pnpm", "learn:check"],
      ]
    : [
        ["pnpm", "types:worker"],
        ["pnpm", "format:check"],
        ["pnpm", "lint"],
        ["pnpm", "typecheck"],
        ["pnpm", "test:unit"],
        ["pnpm", "test:worker"],
        ["pnpm", "sf:metadata:check"],
        ["pnpm", "hxl:check"],
        ["pnpm", "eval"],
        ["pnpm", "contracts:check"],
        ["pnpm", "docs:check"],
        ["pnpm", "prompts:check"],
        ["pnpm", "learn:check"],
        ["pnpm", "build"],
      ];
const results = [];
for (const [command, ...args] of commands) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "/tmp/northstar-wrangler",
    },
  });
  results.push({ command: [command, ...args].join(" "), exitCode: result.status ?? 1 });
  if (result.status !== 0) break;
}
const status =
  results.length === commands.length && results.every((item) => item.exitCode === 0)
    ? "passed"
    : "failed";
await report(`verify-${mode}`, { status, results });
if (status !== "passed") process.exit(1);
console.log(`\nVerification ${mode} passed (${results.length} gates).`);
