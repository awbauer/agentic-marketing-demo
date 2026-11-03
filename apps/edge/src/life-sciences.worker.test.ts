import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { LIFE_SCIENCES_TOOLS } from "@northstar/contracts";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authorizeTool } from "./architecture/context";
import { createLifeSciencesMcpServer, LIFE_SCIENCES_TOOL_PREFIX } from "./life-sciences/server";
import { createArchitectureTables } from "./worker.test-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed tool output is untyped JSON in these tests
type Json = Record<string, any>;
const NOW = new Date("2026-11-02T12:00:00Z");

async function connect() {
  const server = createLifeSciencesMcpServer({ now: () => NOW });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    return {
      isError: Boolean(result.isError),
      body: (result.isError ? {} : JSON.parse(content[0]?.text ?? "{}")) as Json,
      text: content[0]?.text ?? "",
    };
  };
  return { client, call };
}

describe("life-sciences MCP (mocked systems of record)", () => {
  it("serves the ten read-only tools the contract lists, all marked mock", async () => {
    const { client, call } = await connect();
    const listed = (await client.listTools()).tools;
    expect(listed.map((tool) => tool.name).sort()).toEqual([...LIFE_SCIENCES_TOOLS].sort());
    expect(listed.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(LIFE_SCIENCES_TOOL_PREFIX).toBe("ls_");
    const result = await call("vault_get_prescribing_information", { drug: "drug-glucora" });
    expect(result.body).toMatchObject({ system: "Veeva Vault", mock: true });
    await client.close();
  });

  it("Aprimo: says which assets are usable now, and why one is still pending", async () => {
    const { call } = await connect();
    const assets = (await call("aprimo_search_approved_assets", { drug: "drug-cardivance" })).body;
    expect(assets.assets).toHaveLength(5);
    expect(assets.usableNow).toBe(3);
    // A model that names the drug, or writes the channel in another case, still gets an answer.
    const named = await call("aprimo_search_approved_assets", {
      drug: "Cardivance",
      channel: "Email",
    });
    expect(named.isError).toBe(false);
    expect(named.body.drug).toBe("drug-cardivance");
    expect((await call("aprimo_search_approved_assets", { drug: "aspirin" })).isError).toBe(true);
    const pending = (
      await call("aprimo_search_approved_assets", { drug: "drug-cardivance", status: "Pending" })
    ).body;
    expect(pending.assets.map((asset: Json) => asset.mlrApprovalId).sort()).toEqual([
      "MLR-2026-0577",
      "MLR-2026-0590",
    ]);
    const glucora = (
      await call("aprimo_search_approved_assets", { drug: "drug-glucora", channel: "email" })
    ).body;
    expect(
      glucora.assets.find((asset: Json) => asset.mlrApprovalId === "MLR-2025-0988"),
    ).toMatchObject({ status: "Expired", usableNow: false });

    const review = (await call("aprimo_get_mlr_review", { mlrId: "MLR-2026-0577" })).body.review;
    expect(review.status).toBe("Pending");
    expect(review.stages[0]).toMatchObject({ stage: "Medical", status: "Changes requested" });
    expect(review.stages[0].comment).toMatch(/head-to-head/);
    const offLabel = (await call("aprimo_get_mlr_review", { mlrId: "MLR-2026-0590" })).body.review;
    expect(offLabel.stages.map((stage: Json) => stage.status)).toEqual([
      "Approved",
      "Approved",
      "Changes requested",
    ]);
    expect((await call("aprimo_get_mlr_review", { mlrId: "MLR-2099-0001" })).isError).toBe(true);
  });

  it("Vault: agrees with the graph on which claims are approved", async () => {
    const { call } = await connect();
    const claims = (await call("vault_list_approved_claims", { drug: "drug-cardivance" })).body;
    expect(claims.approved).toBe(2);
    expect(claims.notApproved).toBe(2);
    const byText = (text: string) =>
      claims.claims.find((claim: Json) => claim.text.startsWith(text));
    expect(byText("Superior to every ARB").reason).toMatch(/No substantiating reference/);
    expect(byText("Improves outcomes in heart failure with preserved").reason).toMatch(
      /not on the approved label/,
    );
    expect(byText("Reduced the risk").references[0].citation).toMatch(/CARDIO-HF/);
    const label = (await call("vault_get_prescribing_information", { drug: "drug-cardivance" }))
      .body.label;
    expect(label.boxedWarning).toMatch(/FETAL TOXICITY/);
    expect(
      (await call("vault_get_prescribing_information", { drug: "drug-glucora" })).body.label
        .boxedWarning,
    ).toBeNull();
  });

  it("Drupal: finds the page that is live with an expired approval", async () => {
    const { call } = await connect();
    const pages = (await call("drupal_list_hcp_site_content", { drug: "drug-glucora" })).body;
    expect(pages.nonCompliant).toBe(1);
    const weight = pages.pages.find((page: Json) => page.path === "/hcp/glucora/weight");
    expect(weight).toMatchObject({
      state: "published",
      mlrApprovalId: "MLR-2025-0988",
      mlrStatus: "Expired",
      compliant: false,
    });
    expect(weight.issues[0]).toMatch(/expired on 2026-09-30/);
    const cardivance = (await call("drupal_list_hcp_site_content", { drug: "drug-cardivance" }))
      .body;
    expect(
      cardivance.pages.find((page: Json) => page.path === "/hcp/cardivance/hfpef"),
    ).toMatchObject({ state: "draft", compliant: true });
  });

  it("Screendragon, Reltio, IQVIA and Life Sciences Cloud answer for the same hospitals and assets", async () => {
    const { call } = await connect();
    const jobs = (await call("screendragon_list_jobs", { stage: "MLR review" })).body;
    expect(jobs.jobs.map((job: Json) => job.jobId)).toEqual(["SD-1043", "SD-1044", "SD-1062"]);
    expect(jobs.atRisk).toBe(1);
    const job = (await call("screendragon_get_job", { jobId: "SD-1043" })).body.job;
    expect(job.blockers[0]).toMatch(/MLR-2026-0577 is pending/);
    expect(job.workflow.find((step: Json) => step.status === "In progress").stage).toBe(
      "MLR review",
    );

    const org = (await call("reltio_resolve_organization", { hospital: "Lakeshore Health System" }))
      .body.organization;
    expect(org.hierarchy.parent).toBeTruthy();
    expect(org.prescriberGroups.map((group: Json) => group.specialty).sort()).toEqual([
      "cardiology",
      "neurology",
      "primary-care",
    ]);
    expect(org.sourceRecords.length).toBeGreaterThanOrEqual(3);

    const trends = (
      await call("iqvia_get_prescribing_trends", {
        drug: "drug-cardivance",
        hospital: "St. Brigid Medical Center",
      })
    ).body.trends;
    expect(trends.rows).toHaveLength(1);
    expect(trends.rows[0].monthlyTrx).toHaveLength(6);
    expect(
      (
        await call("iqvia_get_prescribing_trends", {
          drug: "drug-neurelva",
          hospital: "Gulf Coast Heart Institute",
        })
      ).isError,
    ).toBe(true);

    const plan = (await call("lsc_get_call_plan", { hospital: "Mesa Verde Regional Hospital" }))
      .body.plan;
    expect(plan.groups.map((group: Json) => group.specialty)).toEqual(["cardiology", "neurology"]);
    expect(plan.groups[1].nextBestAction).toMatch(/Low rep-visit consent/);
    expect(JSON.stringify(plan)).not.toMatch(/\bDr\.|@/);
  });
});

describe("brand scope at the gateway", () => {
  it("denies another brand's tool and allows the chosen brand's and the shared ones", async () => {
    await createArchitectureTables(env.APP_DB);
    const lumera = { brand: "Lumera Therapeutics", persona: "reviewer" } as const;
    const allowed = await authorizeTool(
      env,
      "scope-user",
      "graph_check_clinical_claims",
      "s1",
      lumera,
    );
    expect(allowed).toMatchObject({ decision: "allow" });
    const denied = await authorizeTool(
      env,
      "scope-user",
      "graph_prepare_deal_release",
      "s2",
      lumera,
    );
    expect(denied).toMatchObject({ decision: "deny", policyId: "forbid-out-of-scope-brand" });
    const shared = await authorizeTool(env, "scope-user", "graph_get_graph_overview", "s3", lumera);
    expect(shared.decision).toBe("allow");
    const open = await authorizeTool(env, "scope-user", "graph_prepare_deal_release", "s4");
    expect(open.decision).toBe("allow");
  });
});
