import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { namedClaimTopics } from "./team/lifecycle-workers";
import { createArchitectureTables } from "./worker.test-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed responses are untyped JSON in these tests
type Json = Record<string, any>;

const post = (path: string, json: unknown, persona = "marketer") =>
  SELF.fetch(`http://example.com${path}`, {
    method: "POST",
    headers: { "x-persona": persona, "content-type": "application/json" },
    body: JSON.stringify(json),
  });
const decide = (id: string, json: unknown, persona: string) =>
  post(`/api/arch/team/runs/${id}/decide`, json, persona);
const events = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Json);
const waitingOn = (stream: Json[]) =>
  [...stream].reverse().find((event) => event.type === "await-person");

beforeAll(async () => {
  await createArchitectureTables(env.APP_DB);
});

describe("pharma campaign lifecycle", () => {
  it("only runs for a prescription brand", async () => {
    const response = await post("/api/arch/team/runs", {
      briefId: "coastline-winter-warmup",
      mode: "lifecycle",
    });
    expect(response.status).toBe(400);
  });

  it("takes a brief from business focus to analytics, with people at every decision", async () => {
    const start = await events(
      await post("/api/arch/team/runs", { briefId: "lumera-hf-awareness", mode: "lifecycle" }),
    );
    expect(start[0]).toMatchObject({ type: "start", mode: "lifecycle" });
    const id = start[0].id as string;

    // Focus: the analyst's areas cite real data, and the brand lead picks from them.
    const focus = waitingOn(start);
    expect(focus).toMatchObject({ gate: "focus", persona: "brand-lead" });
    expect(focus.options.length).toBeGreaterThanOrEqual(2);
    // Only the brand lead chooses, and must choose one of the options.
    expect(
      (await decide(id, { gate: "focus", decision: "approve", choice: "1" }, "marketer")).status,
    ).toBe(403);
    expect(
      (await decide(id, { gate: "focus", decision: "approve", choice: "9" }, "brand-lead")).status,
    ).toBe(400);
    const ideation = await events(
      await decide(id, { gate: "focus", decision: "approve", choice: "1" }, "brand-lead"),
    );
    expect(
      ideation.find((event) => event.type === "phase" && event.state === "done"),
    ).toMatchObject({
      phase: "focus",
    });
    expect(waitingOn(ideation)).toMatchObject({ gate: "concept" });

    // The concept goes to Medical for an early look before anything is built.
    const review = await events(
      await decide(id, { gate: "concept", decision: "approve", choice: "1" }, "brand-lead"),
    );
    expect(waitingOn(review)).toMatchObject({ gate: "concept-review", persona: "reviewer" });
    expect(
      (await decide(id, { gate: "concept-review", decision: "approve" }, "brand-lead")).status,
    ).toBe(403);

    // Content: the first draft reaches for a claim the library refuses; the service says why, the
    // copy lead drops it, and the MLR coordinator submits a job whose checks all pass.
    const content = await events(
      await decide(id, { gate: "concept-review", decision: "approve" }, "reviewer"),
    );
    const drafts = content.filter(
      (event) => event.type === "tool" && event.step.tool === "draft_modules",
    );
    expect(drafts[0].step.ok).toBe(false);
    expect(drafts[0].step.error).toMatch(/cardivance-superior is refused/);
    expect(drafts.at(-1).step.ok).toBe(true);
    const modules = content.find(
      (event) => event.type === "artifact" && event.name === "draft_modules",
    );
    expect(modules.data.modules[0].disclosures.map((item: Json) => item.id)).toEqual(
      expect.arrayContaining(["lt-disc-isi-cardivance", "lt-disc-boxed-cardivance", "lt-disc-pi"]),
    );
    const job = content.find(
      (event) => event.type === "artifact" && event.name === "submit_mlr_job",
    );
    expect(job.data.checks.every((check: Json) => check.ok)).toBe(true);
    expect(job.data.tier.tier).toBe("C");
    expect(modules.data.modules[0].claims[0].claimId).toMatch(/^CLM-CRD-/);
    expect(waitingOn(content)).toMatchObject({ gate: "medical", persona: "reviewer" });

    // Medical asks for changes: the phase starts again, and the resubmitted job is a new round.
    const redo = await events(
      await decide(
        id,
        { gate: "medical", decision: "changes", note: "Lead with the safety profile." },
        "reviewer",
      ),
    );
    const resubmitted = redo.find(
      (event) => event.type === "artifact" && event.name === "submit_mlr_job",
    );
    expect(resubmitted.data.round).toBe(2);
    expect(resubmitted.data.jobCode).not.toBe(job.data.jobCode);
    expect(
      redo.find(
        (event) =>
          event.type === "message" && event.kind === "directive" && event.to === "copy-lead",
      ).text,
    ).toMatch(/safety profile/);
    expect(waitingOn(redo)).toMatchObject({ gate: "medical" });

    // The MLR system routes the job from Medical to Legal to Regulatory without the lead.
    const legal = await events(
      await decide(id, { gate: "medical", decision: "approve" }, "reviewer"),
    );
    expect(legal.filter((event) => event.type === "model")).toHaveLength(0);
    expect(waitingOn(legal)).toMatchObject({ gate: "legal", persona: "senior" });
    const regulatory = await events(
      await decide(id, { gate: "legal", decision: "approve" }, "senior"),
    );
    expect(waitingOn(regulatory)).toMatchObject({ gate: "regulatory", persona: "compliance" });
    const audience = await events(
      await decide(id, { gate: "regulatory", decision: "approve" }, "compliance"),
    );
    const approval = audience.find(
      (event) => event.type === "artifact" && event.name === "mlr_approval",
    );
    expect(approval.data.documentNumber).toMatch(/-A$/);
    expect(approval.data.expiresOn).toBeTruthy();
    expect(approval.data.materials[0].materialId).toMatch(/-A-EM\d$/);
    // Every built variant is checked against the approved version before anything is scheduled.
    expect(
      audience.find((event) => event.type === "artifact" && event.name === "final_form_check").data
        .allMatch,
    ).toBe(true);

    // Audience: consent and do-not-contact are applied; marketing operations approves.
    const list = audience.find(
      (event) => event.type === "artifact" && event.name === "build_audience",
    );
    expect(list.data.totals.emailReachable).toBeLessThan(list.data.totals.prescribers);
    expect(waitingOn(audience)).toMatchObject({ gate: "audience", persona: "marketer" });

    // Publishing: the schedule runs only approved modules; go-live, then Form FDA 2253.
    const publish = await events(
      await decide(id, { gate: "audience", decision: "approve" }, "marketer"),
    );
    const schedule = publish.find(
      (event) => event.type === "artifact" && event.name === "schedule_deployment",
    );
    // The placements carry their material and claim IDs into the channels.
    expect(schedule.data.placements[0].claimIds[0]).toMatch(/^CLM-CRD-/);
    expect(waitingOn(publish)).toMatchObject({ gate: "go-live" });
    const form = await events(
      await decide(id, { gate: "go-live", decision: "approve" }, "brand-lead"),
    );
    expect(
      form.find((event) => event.type === "artifact" && event.name === "prepare_form_2253").data,
    ).toMatchObject({
      form: "FDA Form 2253",
    });
    expect(waitingOn(form)).toMatchObject({ gate: "fda-2253", persona: "compliance" });

    // Analytics: results come in, the analyst recommends, the brand lead decides.
    const analytics = await events(
      await decide(id, { gate: "fda-2253", decision: "approve" }, "compliance"),
    );
    expect(
      analytics.find((event) => event.type === "artifact" && event.name === "campaign_results").data
        .simulated,
    ).toBe(true);
    const next = waitingOn(analytics);
    expect(next).toMatchObject({ gate: "next-action" });
    expect(next.options.map((option: Json) => option.id)).toEqual([
      "continue",
      "optimize",
      "retire",
    ]);
    const end = await events(
      await decide(
        id,
        { gate: "next-action", decision: "approve", choice: "optimize" },
        "brand-lead",
      ),
    );
    expect(end.find((event) => event.type === "done").summary).toMatch(/focus to analytics/);
    // Where every claim is live, by ID, with its re-review date.
    const trace = end.find((event) => event.type === "artifact" && event.name === "claim_trace");
    expect(trace.data.decision).toBe("optimize");
    expect(trace.data.claims[0].placements.length).toBeGreaterThan(0);
    const scorecard = end.find((event) => event.type === "evaluation").scorecard;
    expect(scorecard.checks.find((check: Json) => check.id === "outcome").score).toBe(1);
    // Medical asked for changes once, and approved the resubmitted job.
    const mlr = scorecard.checks.find((check: Json) => check.id === "mlr-rounds");
    expect(mlr.score).toBe(1);
    expect(mlr.detail).toContain("1 request for changes; 1 approved on the next review");
  });
});

describe("claim topics a model names", () => {
  const library = [
    { topic: "cardivance-mortality", claimId: "CLM-CRD-0042" },
    { topic: "cardivance-safety", claimId: "CLM-CRD-0043" },
  ];

  it("maps an ID written with non-breaking hyphens to its topic", () => {
    const topics = namedClaimTopics({ claimTopics: ["CLM\u2011CRD\u20110042"] }, library);
    expect(topics).toEqual(["cardivance-mortality"]);
  });

  it("keeps plain IDs and topics as they are", () => {
    const topics = namedClaimTopics(
      { claimTopics: ["CLM-CRD-0043", "cardivance-mortality"] },
      library,
    );
    expect(topics.sort()).toEqual(["cardivance-mortality", "cardivance-safety"]);
  });
});
