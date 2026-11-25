// Compiles packages/architecture/policies (the Cedar schema and policy files) into a TypeScript
// module every runtime can import: the Worker, the Google Cloud server, the tests and these
// scripts. It validates every policy against the schema first, so a typo fails here and in CI.
//
//   node scripts/generate-policies.mjs          write the module
//   node scripts/generate-policies.mjs --check  fail if the module is out of date
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// A string, not new URL(): under a jsdom test the global URL is jsdom's, which Node refuses.
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
export const POLICY_DIR = "packages/architecture/policies";
export const MODULE_PATH = "packages/architecture/src/cedar/policies.generated.ts";
// Guards first: when several forbids apply, the earliest file names the decision.
const ORDER = [
  "guards.cedar",
  "personas.cedar",
  "agents.cedar",
  "orchestrator.cedar",
  "team.cedar",
  "squad.cedar",
  "lifecycle.cedar",
];

const cedar = createRequire(`${root}package.json`)("@cedar-policy/cedar-wasm/nodejs");

const fail = (message, errors = []) => {
  throw new Error(
    [message, ...errors.map((error) => `  ${error.message ?? JSON.stringify(error)}`)].join("\n"),
  );
};

/** A policy's principal, summarised for display and counting. */
function principalOf(json) {
  const constraint = json.principal;
  const kind = (type) => (type === "Agent" ? "agent" : type === "Persona" ? "persona" : "any");
  if (constraint.op === "==" && constraint.entity)
    return { type: kind(constraint.entity.type), ids: [constraint.entity.id] };
  if (constraint.op === "is") return { type: kind(constraint.entity_type), ids: "*" };
  return { type: "any", ids: "*" };
}

/** Reads, parses and validates the policy files. Pure apart from reading the files. */
export function collectPolicies(dir = `${root}${POLICY_DIR}`) {
  const schema = readFileSync(`${dir}/schema.cedarschema`, "utf8");
  const parsed = cedar.checkParseSchema(schema);
  if (parsed.type !== "success") fail("schema.cedarschema does not parse:", parsed.errors);
  const names = readdirSync(dir).filter((name) => name.endsWith(".cedar"));
  const unknown = names.filter((name) => !ORDER.includes(name));
  if (unknown.length) fail(`Add ${unknown.join(", ")} to ORDER in scripts/generate-policies.mjs.`);
  const policies = [];
  for (const file of ORDER.filter((name) => names.includes(name))) {
    const text = readFileSync(`${dir}/${file}`, "utf8");
    // A policy is one block between blank lines, with the comments right above it.
    const blocks = text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => /@id\(/.test(block));
    const parts = cedar.policySetTextToParts(text);
    if (parts.type !== "success") fail(`${file} does not parse:`, parts.errors);
    if (blocks.length !== parts.policies.length + parts.policy_templates.length)
      fail(
        `${file}: keep each policy in one block, with no blank line inside, and give each an @id.`,
      );
    for (const block of blocks) {
      const template = /\?principal|\?resource/.test(block);
      const answer = template ? cedar.templateToJson(block) : cedar.policyToJson(block);
      if (answer.type !== "success") fail(`${file}: a policy does not parse:`, answer.errors);
      const { annotations = {}, effect } = answer.json;
      if (!annotations.id) fail(`${file}: every policy needs @id("...").`);
      if (!annotations.note) fail(`${file}: ${annotations.id} needs @note("...") for its reason.`);
      if (policies.some((policy) => policy.id === annotations.id))
        fail(`${file}: the id ${annotations.id} is used twice.`);
      policies.push({
        id: annotations.id,
        file,
        kind: template ? "template" : "static",
        effect,
        note: annotations.note,
        principal: principalOf(answer.json),
        text: block,
      });
    }
  }
  const validation = cedar.validate({
    schema,
    policies: {
      staticPolicies: Object.fromEntries(
        policies.filter((p) => p.kind === "static").map((p) => [p.id, p.text]),
      ),
      templates: Object.fromEntries(
        policies.filter((p) => p.kind === "template").map((p) => [p.id, p.text]),
      ),
    },
  });
  if (validation.type !== "success") fail("Validation could not run:", validation.errors);
  if (validation.validationErrors.length)
    fail(
      "Policies do not validate against schema.cedarschema:",
      validation.validationErrors.map((item) => ({
        message: `${item.policyId}: ${item.error.message}`,
      })),
    );
  return { schema, policies };
}

/** The module's source, formatted by Biome so lint and format checks pass. */
export function renderModule({ schema, policies }) {
  const source = [
    "// Generated by scripts/generate-policies.mjs from packages/architecture/policies. Do not edit:",
    "// change the .cedar files and run `pnpm policies:generate`.",
    "",
    `export const CEDAR_SCHEMA = ${JSON.stringify(schema)};`,
    "",
    `export const CEDAR_POLICIES = ${JSON.stringify(policies, null, 2)} as const;`,
    "",
  ].join("\n");
  return execFileSync(
    `${root}node_modules/.bin/biome`,
    ["format", `--stdin-file-path=${MODULE_PATH}`],
    { input: source, cwd: root, encoding: "utf8" },
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const next = renderModule(collectPolicies());
  const path = `${root}${MODULE_PATH}`;
  if (process.argv.includes("--check")) {
    const current = readFileSync(path, "utf8");
    if (current !== next) {
      console.error(`${MODULE_PATH} is out of date: run pnpm policies:generate.`);
      process.exit(1);
    }
    console.log("Cedar policies: the generated module is current and every policy validates.");
  } else {
    writeFileSync(path, next);
    console.log(`Wrote ${MODULE_PATH}.`);
  }
}
