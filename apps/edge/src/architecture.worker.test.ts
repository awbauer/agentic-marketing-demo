import { env, SELF } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it } from "vitest";
import { authorizeTool, makeCtx } from "./architecture/context";
import { createWorkbenchMcpServer } from "./architecture/mcp";
import { ArchitectureStore, pruneArchitecture } from "./architecture/store";
import { createArchitectureTables } from "./worker.test-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed responses are untyped JSON in these tests
type Json = Record<string, any>;

async function call(
  path: string,
  init: RequestInit & { persona?: string; brand?: string; json?: unknown } = {},
) {
  const { persona, brand, json, ...rest } = init;
  const response = await SELF.fetch(`http://example.com${path}`, {
    ...rest,
    headers: {
      "x-persona": persona ?? "marketer",
      ...(brand ? { "x-brand": brand } : {}),
      ...(json ? { "content-type": "application/json" } : {}),
    },
    ...(json ? { body: JSON.stringify(json), method: rest.method ?? "POST" } : {}),
  });
  return { status: response.status, body: (await response.json()) as Json };
}
const run = (agent: string, action: string, input: unknown, persona = "marketer") =>
  call(`/api/arch/agents/${agent}/run`, { persona, json: { action, input } });

const HS_BRIEF = "urn:northstar:brief:hs-brief-w1";
const urn = (value: string) => encodeURIComponent(value);

beforeAll(async () => {
  await createArchitectureTables(env.APP_DB);
});

describe("architecture API", () => {
  it("reads governed objects with lineage and the transitions the persona may take", async () => {
    const { status, body } = await call(
      `/api/arch/objects/${urn("urn:northstar:module:hs-mod-fdic-explainer-email")}`,
      { persona: "reviewer" },
    );
    expect(status).toBe(200);
    expect(body.object.approvalState).toBe("in_review");
    expect(body.allowed.sort()).toEqual(["approved", "changes_requested", "escalated", "rejected"]);
    expect(body.lineage.outgoing.some((edge: Json) => edge.type === "CITES")).toBe(true);
    expect(body.chain.map((hop: Json) => hop.hop)).toContain("service");
    expect((await call(`/api/arch/objects/${urn("urn:northstar:module:nope")}`)).status).toBe(404);
  });

  it("limits admin to a demo-admin and rejects unknown personas", async () => {
    expect((await call("/api/arch/session", { persona: "admin" })).status).toBe(403);
    expect((await call("/api/arch/session", { persona: "wizard" })).status).toBe(400);
    const session = await call("/api/arch/session", { persona: "reviewer" });
    expect(session.body.personas.map((item: Json) => item.id)).not.toContain("admin");
  });

  it("runs an agent through the gateway, persists what it creates, and samples it for the evaluators", async () => {
    const result = await run("module-authoring", "author_module", {
      briefUrn: HS_BRIEF,
      topics: ["sweep-apy", "wire-fees"],
    });
    expect(result.status).toBe(200);
    expect(result.body.decision).toMatchObject({
      decision: "allow",
      policyId: "agent-module-authoring",
    });
    expect(result.body.chain.find((hop: Json) => hop.hop === "agent").verified).toBe(true);
    expect(result.body.result.gaps).toHaveLength(1);
    expect(result.body.scores["cite-or-refuse"]).toBe(1);
    const module = result.body.result.module.urn as string;
    const read = await call(`/api/arch/objects/${urn(module)}`);
    expect(read.body.object.createdBy).toBe("agent:module-authoring");
    expect(read.body.packet.complete).toBe(true);
    const listed = await call("/api/arch/objects?kind=gap");
    expect(listed.body.objects.map((item: Json) => item.urn)).toContain(
      result.body.result.gaps[0].urn,
    );
  });

  it("denies an agent that tries an action outside its grants, and records the denial", async () => {
    const denied = await run("reuse", "author_module", {
      briefUrn: HS_BRIEF,
      topics: ["sweep-apy"],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: "DENIED" });
    expect(denied.body.error.decision).toMatchObject({
      decision: "deny",
      policyId: "default-deny",
    });
    expect(denied.body.error.chain.at(-1).hop).toBe("gateway");
    const log = await call("/api/arch/gateway/log?limit=20");
    expect(
      log.body.log.some(
        (row: Json) =>
          row.decision === "deny" && row.action === "author_module" && row.principalId === "reuse",
      ),
    ).toBe(true);
  });

  it("forbids an agent from approving, even one that may propose", async () => {
    const attempt = await run("readiness", "transition", {
      moduleUrn: "urn:northstar:module:hs-mod-fdic-explainer-email",
    });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.decision).toMatchObject({
      policyId: "forbid-agent-decisions",
      effect: "forbid",
    });
    const direct = await call(
      `/api/arch/objects/${urn("urn:northstar:module:hs-mod-fdic-explainer-email")}/transition`,
      { persona: "marketer", json: { to: "approved" } },
    );
    expect(direct.status).toBe(403);
    expect(direct.body.error.code).toBe("NOT_PERMITTED");
  });

  it("moves an object only along valid transitions, with a reason where one is required", async () => {
    const target = urn("urn:northstar:module:hs-mod-fdic-explainer-email");
    expect(
      (
        await call(`/api/arch/objects/${target}/transition`, {
          persona: "reviewer",
          json: { to: "draft" },
        })
      ).body.error.code,
    ).toBe("INVALID_TRANSITION");
    expect(
      (
        await call(`/api/arch/objects/${target}/transition`, {
          persona: "reviewer",
          json: { to: "rejected" },
        })
      ).body.error.code,
    ).toBe("REASON_REQUIRED");
    const approved = await call(`/api/arch/objects/${target}/transition`, {
      persona: "reviewer",
      json: { to: "approved" },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.card.state).toBe("approved");
    const history = await call(`/api/arch/objects/${target}/history`);
    expect(history.body.history).toEqual([
      expect.objectContaining({
        from: "in_review",
        to: "approved",
        actor: "reviewer",
        actorType: "persona",
      }),
    ]);
    // The same move again is no longer valid: approved cannot return to approved.
    expect(
      (
        await call(`/api/arch/objects/${target}/transition`, {
          persona: "reviewer",
          json: { to: "approved" },
        })
      ).body.error.code,
    ).toBe("INVALID_TRANSITION");
  });

  it("blocks approval while readiness fails", async () => {
    const stale = "urn:northstar:module:hs-mod-fee-waiver-email";
    await call(`/api/arch/objects/${urn(stale)}/transition`, {
      persona: "marketer",
      json: { to: "submitted" },
    });
    await call(`/api/arch/objects/${urn(stale)}/transition`, {
      persona: "reviewer",
      json: { to: "in_review" },
    });
    const blocked = await call(`/api/arch/objects/${urn(stale)}/transition`, {
      persona: "reviewer",
      json: { to: "approved" },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("BLOCKED");
    expect(
      blocked.body.error.blockers.some((item: Json) => item.code === "claim-expired-evidence"),
    ).toBe(true);
  });

  it("lets the readiness agent propose a ready draft, and no more", async () => {
    const authored = await run("module-authoring", "author_module", {
      briefUrn: HS_BRIEF,
      topics: ["fdic-coverage"],
      channel: "email",
    });
    const moduleUrn = authored.body.result.module.urn as string;
    const proposed = await run("readiness", "propose_transition", { moduleUrn });
    expect(proposed.body.result).toMatchObject({ proposed: true });
    const history = await call(`/api/arch/objects/${urn(moduleUrn)}/history`);
    expect(history.body.history[0]).toMatchObject({
      to: "submitted",
      actorType: "agent",
      actor: "agent:readiness",
    });
    const again = await run("readiness", "propose_transition", { moduleUrn });
    expect(again.body.result.proposed).toBe(false);
  });

  it("supersedes a claim as compliance, flags citing modules, and records the withdrawal as the system", async () => {
    const claim = urn("urn:northstar:claim:hs-fomc-date");
    const body = {
      text: "The Federal Open Market Committee next announces its rate decision on December 16.",
      evidence: {
        source: "Federal Reserve meeting calendar",
        asOf: "2026-11-06",
        expiresOn: "2027-12-31",
      },
    };
    expect(
      (await call(`/api/arch/objects/${claim}/supersede`, { persona: "marketer", json: body }))
        .status,
    ).toBe(403);
    const done = await call(`/api/arch/objects/${claim}/supersede`, {
      persona: "compliance",
      json: body,
    });
    expect(done.status).toBe(200);
    expect(done.body.flagged.map((item: Json) => item.urn)).toContain(
      "urn:northstar:module:hs-mod-fomc-push",
    );
    const history = await call(`/api/arch/objects/${claim}/history`);
    expect(history.body.history[0]).toMatchObject({ to: "withdrawn", actorType: "system" });
    const module = await call(`/api/arch/objects/${urn("urn:northstar:module:hs-mod-fomc-push")}`);
    expect(module.body.packet.claims[0].status).toBe("superseded");
  });

  it("closes the loop: proposals, then a revised plan that cites the result", async () => {
    const proposals = await call("/api/arch/optimizations", { persona: "brand-lead" });
    const soup = proposals.body.result.find((item: Json) =>
      item.moduleUrn.endsWith("ck-mod-soup-email"),
    );
    expect(soup.action).toBe("refresh");
    expect(
      (
        await call("/api/arch/optimizations/accept", {
          persona: "marketer",
          json: { proposalId: soup.id },
        })
      ).status,
    ).toBe(403);
    const accepted = await call("/api/arch/optimizations/accept", {
      persona: "brand-lead",
      json: { proposalId: soup.id },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.plan.supersedes).toBe("urn:northstar:content-plan:ck-q4-weather");
    const plan = await call(`/api/arch/objects/${urn(accepted.body.plan.urn)}`);
    expect(plan.body.versions.map((item: Json) => item.version)).toEqual([1, 2]);
  });

  it("refuses to regenerate an existing object with different content", async () => {
    const input = { briefUrn: HS_BRIEF, topics: ["sweep-apy"], channel: "sms" };
    const first = await run("module-authoring", "author_module", input);
    expect(first.status).toBe(200);
    // Same inputs, same content: a no-op, not a conflict.
    expect((await run("module-authoring", "author_module", input)).status).toBe(200);
    const moduleUrn = first.body.result.module.urn as string;
    // Supersede the cited claim, then regenerate: the new text must not inherit this module's state.
    await call(`/api/arch/objects/${urn("urn:northstar:claim:hs-sweep-apy-v2")}/supersede`, {
      persona: "compliance",
      json: {
        text: "The Harborstone Sweep Account pays 4.00% APY (as of November 2).",
        evidence: {
          source: "Treasury rate sheet, November 2",
          asOf: "2026-11-02",
          expiresOn: "2027-02-28",
        },
      },
    });
    // Approve the new claim version through the state machine, then regenerate the same module.
    const next = urn("urn:northstar:claim:hs-sweep-apy-v3");
    await call(`/api/arch/objects/${next}/transition`, {
      persona: "compliance",
      json: { to: "submitted" },
    });
    await call(`/api/arch/objects/${next}/transition`, {
      persona: "reviewer",
      json: { to: "in_review" },
    });
    await call(`/api/arch/objects/${next}/transition`, {
      persona: "reviewer",
      json: { to: "approved" },
    });
    // The agent is told, through its tool, that the module exists with other content; nothing is saved.
    const regenerated = await run("module-authoring", "author_module", input);
    const attempt = regenerated.body.steps.find((step: Json) => step.tool === "author_module");
    expect(attempt).toMatchObject({ ok: false });
    expect(attempt.error).toMatch(/already exists with different content/);
    const kept = await call(`/api/arch/objects/${urn(moduleUrn)}`);
    expect(kept.body.object.attributes.blocks[0].text).toContain("4.35%");
    expect(kept.body.object.approvalState).toBe("draft");
  });

  it("records a transition once when two requests race", async () => {
    const target = "urn:northstar:module:hs-mod-fomc-push";
    const store = new ArchitectureStore(env.APP_DB, "local-evaluator");
    const at = new Date().toISOString();
    const move = (to: "expired" | "withdrawn") =>
      store.transition({
        urn: target,
        from: "approved",
        to,
        actor: "system",
        actorType: "system",
        at,
      });
    const results = await Promise.all([move("expired"), move("withdrawn")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.history(target)).toHaveLength(1);
    // A loser that read a state that is no longer current writes nothing.
    expect(
      await store.transition({
        urn: target,
        from: "approved",
        to: "expired",
        actor: "system",
        actorType: "system",
        at,
      }),
    ).toBe(false);
    expect(await store.history(target)).toHaveLength(1);
  });

  it("applies an optimization proposal once", async () => {
    const proposals = await call("/api/arch/optimizations", { persona: "brand-lead" });
    const chowder = proposals.body.result.find((item: Json) =>
      item.moduleUrn.endsWith("ck-mod-chowder-push"),
    );
    expect(
      (
        await call("/api/arch/optimizations/accept", {
          persona: "brand-lead",
          json: { proposalId: chowder.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/arch/optimizations/accept", {
          persona: "brand-lead",
          json: { proposalId: chowder.id },
        })
      ).status,
    ).toBe(404);
    const again = await call("/api/arch/optimizations", { persona: "brand-lead" });
    expect(again.body.result.some((item: Json) => item.id === chowder.id)).toBe(false);
  });

  it("constrains an agent that drifts, then denies its write actions", async () => {
    const store = new ArchitectureStore(env.APP_DB, "local-evaluator");
    for (let index = 0; index < 6; index += 1)
      await store.saveEvalSample("atomization", new Date().toISOString(), {
        "claim-accuracy": 0,
        "pii-leakage": 1,
        latency: 1,
        cost: 1,
        "policy-adherence": 1,
      });
    const swept = await call("/api/arch/maintenance", { json: {} });
    expect(swept.body.drift.find((item: Json) => item.agentId === "atomization").drifted).toBe(
      true,
    );
    const registry = await call("/api/arch/registry");
    const agent = registry.body.agents.find((item: Json) => item.id === "atomization");
    expect(agent.lifecycle).toBe("constrain");
    expect(agent.effectiveGrants).toEqual(["read_object"]);
    const denied = await run("atomization", "atomize_module", {
      moduleUrn: "urn:northstar:module:hs-mod-fomc-push",
    });
    expect(denied.status).toBe(403);
    const evaluations = await call("/api/arch/evaluations");
    const row = evaluations.body.agents.find((item: Json) => item.id === "atomization");
    expect(row.supported.level).toBe("assistive");
    expect(evaluations.body.evaluators).toHaveLength(13);
  });

  it("expires approved claims whose evidence lapsed, recorded as the system", async () => {
    // The drift test's maintenance sweep already ran the expiry job; a second run finds nothing.
    expect((await call("/api/arch/maintenance", { json: {} })).body.expired).toEqual([]);
    const history = await call(
      `/api/arch/objects/${urn("urn:northstar:claim:hs-fee-waiver")}/history`,
    );
    expect(history.body.history[0]).toMatchObject({
      from: "approved",
      to: "expired",
      actorType: "system",
    });
  });

  it("keeps each evaluator's world separate", async () => {
    const mine = new ArchitectureStore(env.APP_DB, "local-evaluator");
    const theirs = new ArchitectureStore(env.APP_DB, "someone-else");
    expect((await mine.loadWorld()).objects.size).toBeGreaterThan(
      (await theirs.loadWorld()).objects.size,
    );
    expect(await theirs.history("urn:northstar:module:hs-mod-fdic-explainer-email")).toEqual([]);
  });

  it("scopes by brand", async () => {
    const response = await SELF.fetch("http://example.com/api/arch/objects", {
      headers: { "x-persona": "marketer", "x-brand": "Coastline Kitchen" },
    });
    const body = (await response.json()) as Json;
    expect(body.objects.every((item: Json) => item.brand === "Coastline Kitchen")).toBe(true);
    const other = await SELF.fetch(
      `http://example.com/api/arch/objects/${urn("urn:northstar:module:hs-mod-fomc-push")}`,
      { headers: { "x-persona": "marketer", "x-brand": "Coastline Kitchen" } },
    );
    expect(other.status).toBe(403);
  });

  it("serves workspaces, the registry, prompts, models, channels, partner cards and the trust view", async () => {
    const center = await call("/api/arch/workspaces/command-center");
    expect(center.body.tiles.map((tile: Json) => tile.type)).toEqual([
      "metrics",
      "stage-board",
      "stage-readiness",
    ]);
    const registry = await call("/api/arch/registry");
    expect(new Set(registry.body.agents.map((agent: Json) => agent.domain))).toEqual(
      new Set(["commercial", "platform", "partner"]),
    );
    expect(registry.body.policies.some((policy: Json) => policy.cedar.startsWith("forbid"))).toBe(
      true,
    );
    expect((await call("/api/arch/prompts")).body.prompts.length).toBeGreaterThan(8);
    const models = await call("/api/arch/models");
    expect(
      models.body.taskClasses.find((item: Json) => item.taskClass === "orchestrate").champion,
    ).toBe("@cf/openai/gpt-oss-20b");
    const channels = await call(
      `/api/arch/channels?urn=${urn("urn:northstar:module:hs-mod-fee-waiver-email")}`,
      { persona: "reviewer" },
    );
    expect(Object.keys(channels.body.emitted).sort()).toEqual([
      "adaptive-card",
      "lwc",
      "mcp-app",
      "react",
    ]);
    expect(channels.body.emitted["adaptive-card"].type).toBe("AdaptiveCard");
    const card = await call("/api/arch/a2a/salesforce-campaign-creation/agent-card");
    expect(card.body.name).toBe("Salesforce Campaign Creation");
    expect((await call("/api/arch/a2a/reuse/agent-card")).status).toBe(404);
    const trust = await call("/api/arch/trust");
    expect(trust.body.matrix.map((row: Json) => row.threat)).toHaveLength(6);
    expect(trust.body.gateway.denied).toBeGreaterThan(0);
    expect(trust.body.chains.length).toBeGreaterThan(0);
  });

  it("prunes architecture audit data at retention but never edits history in place", async () => {
    await expect(env.APP_DB.prepare("UPDATE arch_history SET reason = 'x'").run()).rejects.toThrow(
      /append-only/,
    );
    await pruneArchitecture(env.APP_DB, new Date(Date.now() + 60_000));
    const store = new ArchitectureStore(env.APP_DB, "local-evaluator");
    expect(await store.countTransitions()).toBe(0);
  });
});

describe("agentic gateway at the edge", () => {
  it("authorizes a model-called tool as tool:<name> and honors the operator kill switch", async () => {
    const allowed = await authorizeTool(env, "local-evaluator", "get_graph_overview", "t1");
    expect(allowed).toMatchObject({ decision: "allow", policyId: "agent-orchestrator-tools" });
    const killed = await authorizeTool(
      { ...env, DISABLED_AGENTS: "orchestrator" },
      "local-evaluator",
      "get_graph_overview",
      "t2",
    );
    expect(killed.decision).toBe("deny");
    const log = await new ArchitectureStore(env.APP_DB, "local-evaluator").gatewayLog(5);
    expect(log[0]).toMatchObject({
      action: "tool:get_graph_overview",
      decision: "deny",
      principalId: "orchestrator",
    });
  });

  it("exposes the workbench to an MCP client through the same gateway, with no decision tool", async () => {
    const ctx = makeCtx(
      env,
      { subject: "local-evaluator", persona: "marketer", brands: "all" },
      "mcp",
    );
    const server = createWorkbenchMcpServer(ctx);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual(["list_objects", "propose_transition", "read_object", "search_objects"]);
    const read = await client.callTool({
      name: "read_object",
      arguments: { urn: "urn:northstar:module:hs-mod-fomc-push" },
    });
    expect(JSON.stringify(read.content)).toContain("hs-mod-fomc-push");
    const missing = await client.callTool({
      name: "read_object",
      arguments: { urn: "urn:northstar:module:ghost" },
    });
    expect(missing.isError).toBe(true);
    await client.close();
  });
});

describe("sample flows", () => {
  const LT = "Lumera Therapeutics";
  const flow = async (tag: string) => {
    const brief = await call("/api/arch/agents/brief/run", {
      brand: LT,
      json: {
        action: "draft_brief",
        input: { planUrn: "urn:northstar:content-plan:lt-q4-hcp", waveId: "w1", runTag: tag },
      },
    });
    const briefUrn = brief.body.result.brief.urn;
    const authored = await call("/api/arch/agents/module-authoring/run", {
      persona: "content-lab",
      brand: LT,
      json: {
        action: "author_module",
        input: {
          briefUrn,
          topics: ["cardivance-mortality", "cardivance-superior"],
          channel: "email",
        },
      },
    });
    const moduleUrn = authored.body.result.module.urn;
    const proposed = await call("/api/arch/agents/readiness/run", {
      persona: "content-lab",
      brand: LT,
      json: { action: "propose_transition", input: { moduleUrn } },
    });
    for (const to of ["in_review", "approved"])
      expect(
        (
          await call(`/api/arch/objects/${urn(moduleUrn)}/transition`, {
            persona: "reviewer",
            brand: LT,
            json: { to },
          })
        ).status,
      ).toBe(200);
    return { briefUrn, moduleUrn, refused: authored.body.result.refused, proposed };
  };

  it("runs a flow from brief to approval, and again with a new run tag", async () => {
    const first = await flow("run-a");
    expect(first.briefUrn).toMatch(/^urn:northstar:brief:lt-q4-hcp-w1-run-a-/);
    expect(first.refused.map((item: Json) => item.topic)).toEqual(["cardivance-superior"]);
    expect(first.proposed.body.result.proposed).toBe(true);
    const second = await flow("run-b");
    expect(second.moduleUrn).not.toBe(first.moduleUrn);
    expect(second.proposed.body.result.proposed).toBe(true);
  });

  it("does not hold an agent's correct refusal of a flawed module against it", async () => {
    for (let index = 0; index < 6; index += 1) {
      const refused = await run(
        "readiness",
        "propose_transition",
        { moduleUrn: "urn:northstar:module:hs-mod-fee-waiver-email" },
        "content-lab",
      );
      // The readiness agent checks first, and does not submit a module that readiness blocks.
      expect(refused.status).toBe(200);
      expect(refused.body.result?.proposed ?? false).toBe(false);
      const check = refused.body.steps.find((step: Json) => step.tool === "check_readiness");
      expect(check.output.ready).toBe(false);
    }
    const registry = await call("/api/arch/registry");
    const readiness = registry.body.agents.find((item: Json) => item.id === "readiness");
    expect(readiness.lifecycle).not.toBe("constrain");
  });

  it("scopes optimization proposals to the brand in the header", async () => {
    const proposals = await call("/api/arch/optimizations", { persona: "brand-lead", brand: LT });
    expect(proposals.status).toBe(200);
    expect(proposals.body.result.every((item: Json) => item.brand === LT)).toBe(true);
  });
});

describe("orchestration", () => {
  const events = async (response: Response) =>
    (await response.text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Json);
  const post = (path: string, json: unknown, persona = "marketer") =>
    SELF.fetch(`http://example.com${path}`, {
      method: "POST",
      headers: { "x-persona": persona, "content-type": "application/json" },
      body: JSON.stringify(json),
    });

  it("delegates each step to its subagent, waits for a person, then finishes", async () => {
    const started = await events(
      await post("/api/arch/orchestrations", { flowId: "lumera-congress" }),
    );
    expect(started[0]).toMatchObject({ type: "start", flowId: "lumera-congress" });
    expect(
      started.filter((event) => event.type === "delegate").map((event) => event.agent),
    ).toEqual(["brief", "module-authoring", "adversarial-farm", "substantiation", "readiness"]);
    // Each subagent acts for the person who owns its step.
    expect(
      started.find((event) => event.type === "delegate" && event.agent === "substantiation")
        .persona,
    ).toBe("compliance");
    const authored = started.find(
      (event) => event.type === "delegated" && event.agent === "module-authoring",
    );
    expect(authored.result.refused.map((item: Json) => item.topic)).toEqual([
      "cardivance-superior",
    ]);
    // Every tool call a subagent made went through the gateway.
    expect(started.some((event) => event.type === "tool" && event.step.decision)).toBe(true);
    const waiting = started.at(-1);
    expect(waiting).toMatchObject({ type: "await-human", persona: "reviewer" });
    const id = started[0].id as string;

    // The flow can't go on until a person decides.
    expect((await post(`/api/arch/orchestrations/${id}/continue`, {})).status).toBe(409);
    for (const to of ["in_review", "approved"])
      expect(
        (await post(`/api/arch/objects/${urn(waiting.moduleUrn)}/transition`, { to }, "reviewer"))
          .status,
      ).toBe(200);
    const resumed = await events(await post(`/api/arch/orchestrations/${id}/continue`, {}));
    expect(resumed[0]).toMatchObject({ type: "decided", state: "approved" });
    expect(
      resumed.some((event) => event.type === "delegate" && event.agent === "optimization"),
    ).toBe(true);
    expect(resumed.at(-1)).toMatchObject({ type: "done" });
    const saved = await call(`/api/arch/orchestrations/${id}`);
    expect(saved.body.status).toBe("done");
  });

  it("rejects a flow that does not exist", async () => {
    expect((await post("/api/arch/orchestrations", { flowId: "nope" })).status).toBe(404);
  });
});
