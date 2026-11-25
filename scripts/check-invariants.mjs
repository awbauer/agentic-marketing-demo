import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROOF_DEFAULTS } from "../packages/contracts/src/index.ts";
import { report } from "./lib/report.mjs";

const wrangler = await readFile("wrangler.jsonc", "utf8");
const catalog = JSON.parse(await readFile("packages/contracts/src/tool-catalog.json", "utf8"));
const required = [
  PROOF_DEFAULTS.imageModel,
  '"new_sqlite_classes"',
  '"CAMPAIGN_ASSETS"',
  '"APP_DB"',
  '"database_id": "120cf689-0652-476c-9e4e-8af5b83e3627"',
  '"bucket_name": "northstar-marketing-workbench-pot-campaign-assets"',
];
const forbidden = [
  "publish",
  "send",
  "activate",
  "delete",
  "suppress",
  "buyer-group",
  "arbitrary-crud",
];
const orchestratorSource = await readFile("apps/edge/src/orchestrator.ts", "utf8");
// The latest migration that rebuilds the confirmation audit defines its allowed actions.
const confirmationMigration = await readFile("migrations/0005_inventory_case_action.sql", "utf8");
const failures = required
  .filter((value) => !wrangler.includes(value))
  .map((value) => `Missing config invariant: ${value}`);
if (/ORCHESTRATOR_MODEL/.test(wrangler))
  failures.push("Orchestrator model must be set only in PROOF_DEFAULTS, not wrangler.jsonc");
if (!orchestratorSource.includes("models.chat(PROOF_DEFAULTS.orchestratorModel)"))
  failures.push("Orchestrator must read its model from PROOF_DEFAULTS.orchestratorModel");
// ADR-018: feature code reaches D1 and Workers AI only through the platform seam, so the same
// code runs on Google Cloud. Only the seam's Cloudflare adapters and the Worker entry touch them.
const SEAM_ALLOWED = new Set([
  "apps/edge/src/index.ts",
  "apps/edge/src/platform/data.ts",
  "apps/edge/src/platform/models.ts",
  "apps/edge/src/architecture/store.ts",
  "apps/edge/src/team/library.ts",
  "apps/edge/src/team/gateway.ts",
  "apps/edge/src/team/run.ts",
  "apps/edge/src/worker-configuration.d.ts",
]);
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat().filter((path) => /\.ts$/.test(path) && !/\.test(-helpers)?\.ts$/.test(path));
}
for (const path of await sourceFiles("apps/edge/src")) {
  if (SEAM_ALLOWED.has(path)) continue;
  const source = await readFile(path, "utf8");
  if (/\bAPP_DB\s*[.)]|env\.AI\.run\b|createWorkersAI\(/.test(source))
    failures.push(`${path} uses D1 or Workers AI directly; go through apps/edge/src/platform/.`);
}
for (const value of forbidden)
  if (PROOF_DEFAULTS.allowedWrites.some((item) => item.includes(value)))
    failures.push(`Forbidden write exposed: ${value}`);
const auditActionClause = confirmationMigration.match(/action IN \(([\s\S]*?)\)\s*\)/)?.[1] ?? "";
const auditedActions = [...auditActionClause.matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
  .sort();
const allowedActions = [...PROOF_DEFAULTS.allowedWrites].sort();
// Retired actions stay in the audit's CHECK so rows written before they were retired remain valid.
const RETIRED_ACTIONS = ["save-brief", "save-campaign", "save-draft-campaign", "save-message"];
const expectedAudit = [...allowedActions, ...RETIRED_ACTIONS].sort();
if (JSON.stringify(auditedActions) !== JSON.stringify(expectedAudit))
  failures.push(
    `Confirmation audit actions differ from the governed write contract: expected ${expectedAudit.length}, found ${auditedActions.length}`,
  );
for (const tool of catalog.tools) {
  if (!["read", "draft", "write"].includes(tool.riskClass))
    failures.push(`Unapproved tool risk: ${tool.name}/${tool.riskClass}`);
  if (tool.riskClass === "write") {
    if (tool.autonomous !== false) failures.push(`Write tool is autonomous: ${tool.name}`);
    if (!PROOF_DEFAULTS.allowedWrites.includes(tool.allowedWrite))
      failures.push(`Write tool is outside Section 17: ${tool.name}/${tool.allowedWrite}`);
  }
}
await report("contracts", {
  status: failures.length ? "failed" : "passed",
  fixedDefaults: PROOF_DEFAULTS,
  toolCatalog: catalog,
  failures,
});
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Contract invariants passed (${required.length} config checks; ${forbidden.length} forbidden classes; ${auditedActions.length} audited actions).`,
);
