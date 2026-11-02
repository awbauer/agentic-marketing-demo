// The prompt catalog gate. Usage: pnpm prompts:check [--write]
//
// Prompts change by pull request, so a change must be visible and deliberate:
// - every entry carries all hard rules, binds every variable to a governed object or an enum,
//   names the evaluators that score it, and belongs to a registered agent;
// - a prompt whose text changed must have a new version, and a new version must change the text;
// - packages/architecture/prompts.lock.json pins each prompt's hash to its version.
// `--write` regenerates the lock after a deliberate change.
import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_REGISTRY } from "../packages/architecture/src/registry.ts";
import {
  catalogLock,
  PROMPT_CATALOG,
  validateCatalog,
} from "../packages/architecture/src/prompts.ts";
import { report } from "./lib/report.mjs";

const LOCK = "packages/architecture/prompts.lock.json";
const write = process.argv.includes("--write");

if (write) {
  const problems = validateCatalog(
    PROMPT_CATALOG,
    undefined,
    AGENT_REGISTRY.map((agent) => agent.id),
  );
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(LOCK, `${JSON.stringify(catalogLock(), null, 2)}\n`);
  console.log(`Wrote ${LOCK} (${PROMPT_CATALOG.length} prompts).`);
  process.exit(0);
}

let lock;
try {
  lock = JSON.parse(readFileSync(LOCK, "utf8"));
} catch {
  console.error(`${LOCK} is missing. Run pnpm prompts:check --write.`);
  process.exit(1);
}
const problems = validateCatalog(
  PROMPT_CATALOG,
  lock,
  AGENT_REGISTRY.map((agent) => agent.id),
);
await report("prompts", {
  status: problems.length ? "failed" : "passed",
  prompts: PROMPT_CATALOG.length,
  problems,
});
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Prompt catalog passed (${PROMPT_CATALOG.length} prompts, lock matches).`);
