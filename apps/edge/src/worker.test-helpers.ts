import { env, runInDurableObject } from "cloudflare:test";
import { PROOF_DEFAULTS } from "@northstar/contracts";
import { getAgentByName } from "agents";
import { deriveAgentKey } from "./auth";

export const CATALOG_CAMPAIGN_ID = "701jV000004GglIQAS";

/** A user's agent stub, addressed exactly as the Worker router does after authentication. */
export async function agentStubFor(subject = "local-evaluator") {
  const name = await deriveAgentKey(
    {
      subject,
      email:
        subject === "local-evaluator"
          ? "evaluator@northstar.example"
          : `${subject}@northstar.example`,
      role: "evaluator",
      tenantId: "northstar-pot",
    },
    PROOF_DEFAULTS.workspaceId,
  );
  return getAgentByName(env.MarketingOrchestrator, name, {
    props: { principalSubject: subject, workspaceId: PROOF_DEFAULTS.workspaceId },
  });
}

/**
 * Opens the catalog campaign in a user's working set through the real ingestion path, as a
 * Salesforce summary tool result would during a chat.
 */
export async function openCatalogCampaign(subject = "local-evaluator") {
  const stub = await agentStubFor(subject);
  await runInDurableObject(stub, (instance) => {
    (
      instance as unknown as {
        ingestToolResult: (name: string, input: unknown, output: unknown) => void;
      }
    ).ingestToolResult(
      "tool_salesforce_northstar-marketing-salesforce_summarize_campaign",
      { message: `Summarize campaign ${CATALOG_CAMPAIGN_ID}` },
      { content: [{ type: "text", text: "Fall Loyalty Reactivation is in progress." }] },
    );
  });
  return stub;
}

/** Creates the architecture tables from the real migration, so tests exercise the shipped schema. */
export async function createArchitectureTables(db: D1Database) {
  const { default: sql } = (await import(
    "../../../migrations/0006_architecture_roadmap.sql?raw"
  )) as {
    default: string;
  };
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/\n\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
}
