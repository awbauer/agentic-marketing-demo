import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { DRUG_IDS, HOSPITAL_NAMES } from "../../../../packages/knowledge-graph/src/index.ts";
import { jsonSchema, type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  aprimoReview,
  aprimoSearch,
  drupalContent,
  iqviaTrends,
  lifeSciencesCallPlan,
  MOCK_NOTE,
  reltioOrganization,
  SCREENDRAGON_JOB_IDS,
  screendragonJob,
  screendragonJobs,
  today as dayOf,
  vaultClaims,
  vaultLabel,
} from "./systems.ts";

export const LIFE_SCIENCES_MCP_NAME = "northstar-life-sciences";
/** Tool keys in the orchestrator carry this prefix. */
export const LIFE_SCIENCES_TOOL_PREFIX = "ls_";

export type LifeSciencesDependencies = { now?: () => Date };

const failure = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const success = (system: string, output: Record<string, unknown>) => {
  const body = { system, mock: true, note: MOCK_NOTE, ...output };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
};
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const drug = z
  .enum(DRUG_IDS)
  .describe("Lumera drug ID: drug-cardivance, drug-glucora or drug-neurelva");

/**
 * Builds the life-sciences MCP server: mocked read-only views of the systems a pharmaceutical
 * company's marketing runs on. Aprimo (digital assets and MLR workflow), Reltio (master data),
 * Veeva Vault PromoMats (the claims library and the label), Screendragon (marketing work
 * management), IQVIA (prescription data), Salesforce Life Sciences Cloud (call plans) and Drupal
 * (the HCP website). Each answers from the same fictional drugs, claims, approvals and hospitals as
 * the knowledge graph, so what one system says can be checked against another. None is a live
 * connection, and none can change anything.
 */
export function createLifeSciencesMcpServer(dependencies: LifeSciencesDependencies = {}) {
  const server = new McpServer({ name: LIFE_SCIENCES_MCP_NAME, version: "1.0.0" });
  const now = dependencies.now ?? (() => new Date());

  server.registerTool(
    "aprimo_search_approved_assets",
    {
      title: "Search MLR-approved assets in Aprimo",
      description:
        "Aprimo (digital asset management and MLR workflow, mocked): a Lumera drug's promotional assets with their MLR approval ID, status (Approved, Pending or Expired), approval and expiry dates, whether each is usable now, the claims it carries, the safety information it must ship with, its renditions and usage rights. Optionally filter by channel (email, portal or rep) or status.",
      inputSchema: z.object({
        drug,
        channel: z.enum(["email", "portal", "rep"]).optional(),
        status: z.enum(["Approved", "Pending", "Expired"]).optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId, channel, status }) => {
      const assets = aprimoSearch(drugId, {
        today: dayOf(now()),
        ...(channel ? { channel } : {}),
        ...(status ? { status } : {}),
      });
      return success("Aprimo", {
        drug: drugId,
        assets,
        usableNow: assets.filter((asset) => asset.usableNow).length,
      });
    },
  );

  server.registerTool(
    "aprimo_get_mlr_review",
    {
      title: "Get an MLR review from Aprimo",
      description:
        "Aprimo (mocked): the medical, legal and regulatory review for an MLR approval ID such as MLR-2026-0577: each stage's status and reviewer role, any reviewer comment, when it was submitted and completed, the cycle time, and when the approval expires. Explains why an asset is pending.",
      inputSchema: z.object({
        mlrId: z
          .string()
          .regex(/^MLR-\d{4}-\d{4}$/)
          .describe("An MLR approval ID"),
      }),
      annotations: READ_ONLY,
    },
    async ({ mlrId }) => {
      const review = aprimoReview(mlrId);
      return review
        ? success("Aprimo", { review })
        : failure(`No MLR review ${mlrId} exists in Aprimo.`);
    },
  );

  server.registerTool(
    "reltio_resolve_organization",
    {
      title: "Resolve a hospital in Reltio",
      description:
        "Reltio (master data management, mocked): the golden record for a hospital or health system: its entity ID, hierarchy and affiliated sites, identifiers, the source records merged into it, the match confidence and survivorship rules, possible duplicates awaiting data-steward review, and the prescriber groups mastered under it with data-quality scores. Groups are counts, never people.",
      inputSchema: z.object({
        hospital: z.enum(HOSPITAL_NAMES).describe("Fictional hospital or health system name"),
      }),
      annotations: READ_ONLY,
    },
    async ({ hospital }) => {
      const record = reltioOrganization(hospital);
      return record
        ? success("Reltio", { organization: record })
        : failure(`No Reltio record for ${hospital}.`);
    },
  );

  server.registerTool(
    "vault_list_approved_claims",
    {
      title: "List claims in Veeva Vault PromoMats",
      description:
        "Veeva Vault PromoMats (claims library, mocked): a Lumera drug's clinical claims with their Vault claim ID, status (Approved or Not approved) and the reason, the indication, the supporting references (study and result), and the documents that carry each claim with their MLR approval and its status. Use it to check a claim against the library before it is used.",
      inputSchema: z.object({ drug }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId }) => {
      const claims = vaultClaims(drugId, dayOf(now()));
      return success("Veeva Vault", {
        drug: drugId,
        claims,
        approved: claims.filter((claim) => claim.status === "Approved").length,
        notApproved: claims.filter((claim) => claim.status !== "Approved").length,
      });
    },
  );

  server.registerTool(
    "vault_get_prescribing_information",
    {
      title: "Get the prescribing information from Veeva Vault",
      description:
        "Veeva Vault (mocked): the current prescribing information for a Lumera drug: its version and effective date, the labeled indications, the boxed warning if there is one, superseded versions, and the safety documents promotional content must carry.",
      inputSchema: z.object({ drug }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId }) => success("Veeva Vault", { label: vaultLabel(drugId) }),
  );

  server.registerTool(
    "screendragon_list_jobs",
    {
      title: "List marketing jobs in Screendragon",
      description:
        "Screendragon (marketing work management, mocked): marketing jobs with their stage (Brief, Creative, MLR review, Production, Distribution, Complete), owner role, due date and days until due, budget, the Aprimo asset and MLR approval they depend on, and whether they are at risk. Optionally filter by drug or stage.",
      inputSchema: z.object({
        drug: z.enum(DRUG_IDS).optional(),
        stage: z
          .enum(["Brief", "Creative", "MLR review", "Production", "Distribution", "Complete"])
          .optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId, stage }) => {
      const jobs = screendragonJobs({
        today: dayOf(now()),
        ...(drugId ? { drug: drugId } : {}),
        ...(stage ? { stage } : {}),
      });
      return success("Screendragon", { jobs, atRisk: jobs.filter((job) => job.atRisk).length });
    },
  );

  server.registerTool(
    "screendragon_get_job",
    {
      title: "Get a marketing job from Screendragon",
      description:
        "Screendragon (mocked): one marketing job's workflow, owner, due date, budget and linked asset, and what blocks it, such as an MLR approval that is still pending.",
      inputSchema: z.object({
        jobId: z.enum(SCREENDRAGON_JOB_IDS).describe("A Screendragon job ID, such as SD-1043"),
      }),
      annotations: READ_ONLY,
    },
    async ({ jobId }) => {
      const job = screendragonJob(jobId, dayOf(now()));
      return job ? success("Screendragon", { job }) : failure(`No job ${jobId} in Screendragon.`);
    },
  );

  server.registerTool(
    "iqvia_get_prescribing_trends",
    {
      title: "Get prescribing trends from IQVIA",
      description:
        "IQVIA (prescription data, mocked and invented): six months of prescriptions (TRx) and Lumera's share for a drug at each hospital with patients in its labeled indication, plus new-to-brand prescriptions. Optionally limit to one hospital. Aggregate counts only; no prescriber or patient is identified.",
      inputSchema: z.object({ drug, hospital: z.enum(HOSPITAL_NAMES).optional() }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId, hospital }) => {
      const trends = iqviaTrends(drugId, hospital);
      return trends
        ? success("IQVIA", { trends })
        : failure(`${hospital} has no patients in this drug's indication.`);
    },
  );

  server.registerTool(
    "lsc_get_call_plan",
    {
      title: "Get a hospital call plan from Salesforce Life Sciences Cloud",
      description:
        "Salesforce Life Sciences Cloud (mocked): the field team's quarterly call plan for a hospital: per prescriber group (a specialty and a count), calls planned and completed, how many prescribers are open to rep contact, days since the last call, the approved detail aids to use, and the next best action. Groups are segments, never individual clinicians.",
      inputSchema: z.object({ hospital: z.enum(HOSPITAL_NAMES) }),
      annotations: READ_ONLY,
    },
    async ({ hospital }) => {
      const plan = lifeSciencesCallPlan(hospital);
      return plan
        ? success("Salesforce Life Sciences Cloud", { plan })
        : failure(`No call plan for ${hospital}.`);
    },
  );

  server.registerTool(
    "drupal_list_hcp_site_content",
    {
      title: "List HCP website content in Drupal",
      description:
        "Drupal (the healthcare-professional website, mocked): the pages for a Lumera drug with their node ID, path, state (published or draft), the claims they carry, the MLR approval they rely on and its status, and any compliance issue, such as a page that is live with an expired approval or carries a claim no completed trial supports.",
      inputSchema: z.object({ drug }),
      annotations: READ_ONLY,
    },
    async ({ drug: drugId }) => {
      const pages = drupalContent(drugId, dayOf(now()));
      return success("Drupal", {
        drug: drugId,
        pages,
        nonCompliant: pages.filter((page) => !page.compliant).length,
      });
    },
  );

  return server;
}

/** In-process MCP client for the orchestrator, mirroring the other connectors. */
export async function connectLifeSciencesTools(dependencies: LifeSciencesDependencies = {}) {
  const server = createLifeSciencesMcpServer(dependencies);
  const client = new Client({ name: "northstar-orchestrator", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools: listed } = await client.listTools();
  const tools: ToolSet = Object.fromEntries(
    listed.map((definition) => [
      `${LIFE_SCIENCES_TOOL_PREFIX}${definition.name}`,
      tool({
        description: definition.description ?? definition.name,
        inputSchema: jsonSchema(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (input) =>
          client.callTool({ name: definition.name, arguments: input as Record<string, unknown> }),
      }),
    ]),
  );
  return {
    tools,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
