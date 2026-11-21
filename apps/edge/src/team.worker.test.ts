import { env, SELF } from "cloudflare:test";
import { TEAM_BRIEFS, TEAM_SPECIALISTS } from "@northstar/architecture";
import { beforeAll, describe, expect, it } from "vitest";
import { ArchitectureStore } from "./architecture/store";
import { createArchitectureTables } from "./worker.test-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed responses are untyped JSON in these tests
type Json = Record<string, any>;

const decide = (id: string, json: unknown, persona: string) =>
  SELF.fetch(`http://example.com/api/arch/team/runs/${id}/decide`, {
    method: "POST",
    headers: { "x-persona": persona, "content-type": "application/json" },
    body: JSON.stringify(json),
  });
const post = (path: string, json: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`http://example.com${path}`, {
    method: "POST",
    headers: { "x-persona": "marketer", "content-type": "application/json", ...headers },
    body: JSON.stringify(json),
  });
const get = (path: string) =>
  SELF.fetch(`http://example.com${path}`, { headers: { "x-persona": "marketer" } });
const events = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);

beforeAll(async () => {
  await createArchitectureTables(env.APP_DB);
});

describe("campaign squad", () => {
  it("lists the roster with each agent's model, the sample briefs and the team's policies", async () => {
    const response = await get("/api/arch/team");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Json;
    expect(body.agents.map((agent: Json) => agent.id)).toEqual([
      "campaign-lead",
      ...TEAM_SPECIALISTS,
      "mlr-coordinator",
      "performance-analyst",
    ]);
    expect(body.agents.every((agent: Json) => typeof agent.model === "string")).toBe(true);
    expect(body.briefs).toHaveLength(TEAM_BRIEFS.length);
    expect(body.policies.find((policy: Json) => policy.id === "team-copy-lead").actions).toContain(
      "team:write_copy",
    );
  });

  it("runs the squad from brief to proposal, one agent at a time", async () => {
    const response = await post("/api/arch/team/runs", { briefId: "coastline-winter-warmup" });
    expect(response.status).toBe(200);
    const stream = await events(response);
    expect(stream[0]).toMatchObject({ type: "start", brief: { id: "coastline-winter-warmup" } });
    const messages = stream.filter((event) => event.type === "message");

    // The client's brief reaches the lead, and the lead sends a work plan to the whole squad.
    expect(messages[0]).toMatchObject({ from: "client", to: "campaign-lead", kind: "brief" });
    expect(stream.find((event) => event.type === "plan").plan.assignments).toHaveLength(4);

    // The lead hands each spoke its assignment, in the order their work depends on.
    expect(
      messages.filter((message) => message.kind === "directive").map((message) => message.to),
    ).toEqual(TEAM_SPECIALISTS);
    // Each spoke hands its work back to the lead (copy twice: it was sent back once).
    const reports = messages.filter((message) => message.kind === "report");
    expect(reports.every((message) => message.to === "campaign-lead")).toBe(true);
    expect(reports.map((message) => message.from)).toEqual([
      "audience-analyst",
      "art-director",
      "copy-lead",
      "copy-lead",
      "channel-planner",
    ]);

    // Spoke to spoke: side questions go straight across, and the other spoke replies.
    const questions = messages.filter((message) => message.kind === "question");
    expect(questions.map((message) => [message.from, message.to])).toEqual([
      ["art-director", "audience-analyst"],
      ["copy-lead", "art-director"],
      ["copy-lead", "art-director"],
      ["channel-planner", "copy-lead"],
    ]);
    expect(messages.filter((message) => message.kind === "answer")).toHaveLength(questions.length);

    // The lead sends one piece back, then keeps all four.
    const reviews = stream.filter((event) => event.type === "review");
    expect(reviews.filter((review) => review.verdict === "revise").map((r) => r.agent)).toEqual([
      "copy-lead",
    ]);
    expect(
      reviews.filter((review) => review.verdict === "accept").map((review) => review.agent),
    ).toEqual(TEAM_SPECIALISTS);
    expect(
      stream.filter((event) => event.type === "output" && event.agent === "copy-lead"),
    ).toHaveLength(2);

    // Reconciling finds a clash between the channel plan and the copy, and the lead resolves it.
    const conflicts = stream.find((event) => event.type === "conflicts").conflicts;
    expect(conflicts.map((conflict: Json) => conflict.id)).toEqual(["uncopied:online-video"]);

    // The proposal goes to the client, within budget.
    const delivered = stream.find((event) => event.type === "delivered").strategy;
    expect(delivered.status).toBe("proposed");
    expect(delivered.media.totalUsd).toBeLessThanOrEqual(18000);
    expect(delivered.media.clicks).toBeGreaterThan(0);
    expect(delivered.resolutions).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({
      from: "campaign-lead",
      to: "client",
      kind: "delivery",
    });
    // The proposal waits for the client, a person; nothing is scored until the run ends.
    expect(stream.at(-2)).toMatchObject({
      type: "await-person",
      gate: "client",
      persona: "brand-lead",
    });
    expect(stream.at(-1)).toMatchObject({ type: "saved", ok: true, store: "D1" });
    expect(stream.some((event) => event.type === "evaluation")).toBe(false);

    // The spokes read through the semantic layer, and the lead's numbers use its formulas.
    const semantic = stream.filter((event) => event.type === "semantic");
    expect(
      semantic.some((event) => event.agent === "channel-planner" && event.metrics.includes("cpm")),
    ).toBe(true);
    expect(semantic.find((event) => event.tool === "define_term").terms).toEqual([
      "paid search CPC",
    ]);
    expect(semantic.find((event) => event.tool === "define_term").metrics).toContain(
      "cost_per_click",
    );
    expect(
      semantic.find((event) => event.agent === "campaign-lead" && event.tool === "reconcile_plan")
        .metrics,
    ).toContain("projected_clicks");

    // Every model call is metered, and the run reports the infrastructure it ran on.
    const models = stream.filter((event) => event.type === "model");
    expect(new Set(models.map((event) => event.purpose))).toEqual(
      new Set(["lead", "work", "answer", "report"]),
    );
    expect(models.every((event) => event.ok && event.tokens > 0)).toBe(true);
    expect(stream[0].infra).toMatchObject({
      provider: "cloudflare",
      store: "D1",
      scripted: true,
      aiGateway: null,
    });
    expect(stream[0].infra.policies).toBe(5);

    // Every tool call passed the gateway under the team's policies.
    const tools = stream.filter((event) => event.type === "tool");
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.every((event) => event.step.decision?.decision === "allow")).toBe(true);
    expect(
      tools.find((event) => event.agent === "copy-lead" && event.step.tool === "write_copy").step
        .decision.policyId,
    ).toBe("team-copy-lead");

    // The waiting run is saved, so a screen can reload it.
    const id = stream[0].id as string;
    const waiting = (await (await get(`/api/arch/team/runs/${id}`)).json()) as Json;
    expect(waiting).toMatchObject({
      status: "waiting",
      waitingOn: "client",
      briefId: "coastline-winter-warmup",
    });
    // The saved log holds everything but the save receipt itself.
    expect(waiting.events.length).toBe(stream.length - 1);

    // Only a person in the client's role may decide, and only on the gate the run waits at.
    expect((await decide(id, { gate: "client", decision: "approve" }, "marketer")).status).toBe(
      403,
    );
    expect(
      (await decide(id, { gate: "compliance", decision: "approve" }, "compliance")).status,
    ).toBe(409);

    // The client approves: the run ends, is scored, and is saved as done.
    const approved = await events(
      await decide(id, { gate: "client", decision: "approve", note: "Looks good." }, "brand-lead"),
    );
    expect(approved[0]).toMatchObject({ type: "decided", gate: "client", decision: "approve" });
    expect(approved.find((event) => event.type === "delivered").strategy.status).toBe("approved");
    const scorecard = approved.find((event) => event.type === "evaluation").scorecard;
    expect(scorecard.provider).toBe("cloudflare");
    expect(scorecard.overall).toBeGreaterThan(50);
    expect(scorecard.checks.find((check: Json) => check.id === "outcome").score).toBe(1);
    expect(scorecard.judge.scores).toHaveLength(5);
    expect(scorecard.costUsd).toBeGreaterThan(0);
    expect(approved.at(-1)).toMatchObject({ type: "saved", ok: true });
    const done = (await (await get(`/api/arch/team/runs/${id}`)).json()) as Json;
    expect(done.status).toBe("done");
    // A decided run cannot be decided again.
    expect((await decide(id, { gate: "client", decision: "approve" }, "brand-lead")).status).toBe(
      409,
    );

    // The evals list holds the scored run.
    const evals = (await (await get("/api/arch/team/evals")).json()) as Json;
    expect(evals.runs.find((run: Json) => run.id === id).scorecard.overall).toBe(scorecard.overall);
  });

  it("holds regulated copy for compliance, and acts on a person's changes", async () => {
    const stream = await events(
      await post("/api/arch/team/runs", { briefId: "harborstone-cash-at-work" }),
    );
    const id = stream[0].id as string;
    // Harborstone's copy goes to compliance before any proposal reaches the client.
    expect(stream.some((event) => event.type === "delivered")).toBe(false);
    expect(stream.at(-2)).toMatchObject({ type: "await-person", gate: "compliance" });
    expect(stream.filter((event) => event.type === "message").at(-1)).toMatchObject({
      from: "campaign-lead",
      to: "compliance",
      kind: "approval-request",
    });

    // The compliance reviewer asks for changes: the lead sends the copy back and asks again.
    expect(
      (await decide(id, { gate: "compliance", decision: "changes", note: "x" }, "compliance"))
        .status,
    ).toBe(400);
    const changed = await events(
      await decide(
        id,
        {
          gate: "compliance",
          decision: "changes",
          note: "Say rates are variable in every headline.",
        },
        "compliance",
      ),
    );
    const revision = changed.find((event) => event.type === "review" && event.verdict === "revise");
    expect(revision).toMatchObject({ agent: "copy-lead" });
    expect(revision.feedback).toContain("rates are variable");
    expect(changed.at(-2)).toMatchObject({ type: "await-person", gate: "compliance" });

    // Approved: now the proposal goes to the client, who sends feedback once, then approves.
    const reviewed = await events(
      await decide(id, { gate: "compliance", decision: "approve" }, "compliance"),
    );
    expect(
      reviewed.find((event) => event.type === "delivered").strategy.messaging.assets[0].disclosure,
    ).toContain("FDIC insured");
    expect(reviewed.at(-2)).toMatchObject({ type: "await-person", gate: "client" });
    const feedback = await events(
      await decide(
        id,
        { gate: "client", decision: "changes", note: "Lead with safety before the rate." },
        "brand-lead",
      ),
    );
    // Changed copy needs compliance again before the client sees it.
    expect(feedback.at(-2)).toMatchObject({ type: "await-person", gate: "compliance" });
    await events(await decide(id, { gate: "compliance", decision: "approve" }, "compliance"));
    const final = await events(
      await decide(id, { gate: "client", decision: "approve" }, "brand-lead"),
    );
    const scorecard = final.find((event) => event.type === "evaluation").scorecard;
    const people = scorecard.checks.find((check: Json) => check.id === "people");
    // Five decisions by people, two asking for changes.
    expect(people.detail).toContain("5 decisions");
    expect(people.score).toBe(0.5);
  });

  it("runs the same squad on each provider, and reports which providers can run", async () => {
    const roster = (await (await get("/api/arch/team")).json()) as Json;
    expect(roster.providers.map((item: Json) => item.id)).toEqual([
      "cloudflare",
      "anthropic",
      "openai",
    ]);
    expect(
      roster.providers.find((item: Json) => item.id === "anthropic").models["campaign-lead"],
    ).toBe("claude-opus-5-5");
    expect(roster.providers.find((item: Json) => item.id === "openai").models["copy-lead"]).toBe(
      "gpt-5.4-mini",
    );
    for (const provider of ["anthropic", "openai"]) {
      const stream = await events(
        await post("/api/arch/team/runs", { briefId: "coastline-winter-warmup", provider }),
      );
      expect(stream[0].infra.provider).toBe(provider);
      expect(stream.some((event) => event.type === "delivered")).toBe(true);
      // The gateway, the semantic layer and the rules are the same whichever model runs.
      expect(
        stream.filter((event) => event.type === "tool").every((event) => event.step.decision),
      ).toBe(true);
      expect(stream.some((event) => event.type === "semantic")).toBe(true);
      const models = new Set(
        stream.filter((event) => event.type === "model").map((event) => event.model),
      );
      // The coordinator runs on the provider's top model, the workers on a smaller one.
      const byAgent = (agent: string) =>
        new Set(
          stream
            .filter((event) => event.type === "model" && event.agent === agent)
            .map((event) => event.model),
        );
      expect([...byAgent("campaign-lead")]).toEqual([
        provider === "anthropic" ? "claude-opus-5-5" : "gpt-6-astra",
      ]);
      expect([...byAgent("copy-lead")]).toEqual([
        provider === "anthropic" ? "claude-sonnet-5-5" : "gpt-5.4-mini",
      ]);
      expect(models.size).toBe(2);
    }
    const bad = await post("/api/arch/team/runs", {
      briefId: "coastline-winter-warmup",
      provider: "skynet",
    });
    expect(bad.status).toBe(400);
  });

  it("enforces each brand's rules on regulated copy", async () => {
    const stream = await events(
      await post("/api/arch/team/runs", { briefId: "harborstone-cash-at-work" }),
    );
    const copy = stream.find((event) => event.type === "reconciled").strategy.messaging;
    expect(copy.assets.every((asset: Json) => asset.disclosure.includes("FDIC insured"))).toBe(
      true,
    );
  });

  it("refuses a brief with problems before the team starts", async () => {
    const response = await post("/api/arch/team/runs", {
      brief: { ...TEAM_BRIEFS[0], budgetUsd: 10, end: "2020-01-01" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Json;
    expect(body.error.code).toBe("BAD_BRIEF");
    expect((await post("/api/arch/team/runs", { briefId: "nope" })).status).toBe(404);
  });

  it("keeps a brand-scoped user to their brand", async () => {
    const response = await post(
      "/api/arch/team/runs",
      { briefId: "coastline-winter-warmup" },
      { "x-brand": "Harborstone Wealth" },
    );
    expect(response.status).toBe(403);
  });

  it("stops at the gateway when the lead is retired, and a constrained spoke cannot save", async () => {
    const store = new ArchitectureStore(env.APP_DB, "local-evaluator");
    const at = new Date().toISOString();
    await store.setLifecycle("campaign-lead", "retire", "Retired for the test.", at);
    const denied = await post("/api/arch/team/runs", { briefId: "coastline-winter-warmup" });
    expect(denied.status).toBe(403);
    await store.setLifecycle("campaign-lead", "monitor", "Restored.", at);

    await store.setLifecycle("channel-planner", "constrain", "Reads only.", at);
    const stream = await events(
      await post("/api/arch/team/runs", { briefId: "coastline-winter-warmup" }),
    );
    const refused = stream.find(
      (event) => event.type === "tool" && event.step.tool === "plan_media",
    );
    expect(refused.step.ok).toBe(false);
    expect(refused.step.decision.decision).toBe("deny");
    expect(stream.some((event) => event.type === "delivered")).toBe(false);
    expect(stream.some((event) => event.type === "done")).toBe(true);
    // A run that stopped is still scored, and the scorecard says it reached no outcome.
    const scorecard = stream.find((event) => event.type === "evaluation").scorecard;
    expect(scorecard.checks.find((check: Json) => check.id === "outcome").score).toBe(0);
    await store.setLifecycle("channel-planner", "monitor", "Restored.", at);
  });
});
