// The Firestore repositories behave as the D1 ones do (the worker tests cover those), run
// against the Firestore emulator. Each test uses its own collection prefix.
import { randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import type { GovernedObject } from "@northstar/architecture";
import { afterAll, describe, expect, it } from "vitest";
import {
  DuplicateIdempotencyKeyError,
  firestoreDataPlatform,
  firestoreMembers,
} from "../../src/platform/firestore";

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const db = emulator ? new Firestore({ projectId: "northstar-test" }) : undefined;
const fresh = () => {
  if (!db) throw new Error("no emulator");
  const prefix = `t${randomUUID().slice(0, 8)}_`;
  return { db, prefix, data: firestoreDataPlatform(db, prefix) };
};

afterAll(async () => {
  await db?.terminate();
});

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

describe.skipIf(!emulator)("Firestore repositories", () => {
  it("upserts the confirmation audit and keeps idempotency keys unique", async () => {
    const { data } = fresh();
    const entry = {
      confirmationId: "c1",
      workspaceId: "w",
      principalSubject: "p",
      action: "save-marketing-brief",
      recordId: "r1",
      requestHash: "h",
      idempotencyKey: "k1",
      status: "pending",
      sourceRecordId: null,
      expiresAt: iso(60_000),
      at: iso(),
    };
    await data.audit.upsert(entry);
    await data.audit.upsert({ ...entry, status: "executed", sourceRecordId: "a0X1", at: iso(1) });
    const rows = await data.audit.list("w", "p", iso(-60_000), 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      confirmation_id: "c1",
      status: "executed",
      source_record_id: "a0X1",
    });
    expect(rows[0]?.created_at).toBe(entry.at);
    await expect(
      data.audit.upsert({ ...entry, confirmationId: "c2", at: iso(2) }),
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
    expect(await data.audit.list("other", "p", iso(-60_000), 10)).toEqual([]);
    await data.audit.prune(iso(60_000));
    expect(await data.audit.list("w", "p", iso(-60_000), 10)).toEqual([]);
    // Pruning frees the key with the row.
    await data.audit.upsert({ ...entry, confirmationId: "c3" });
  });

  it("stores image drafts per person and lists unexpired ones newest first", async () => {
    const { db, prefix, data } = fresh();
    const draft = (id: string, createdOffset: number, expiresOffset: number) => ({
      image_id: id,
      workspace_id: "w",
      principal_subject: "p",
      campaign_id: "701000000000001",
      channel: "email",
      prompt_summary: "spring",
      prompt_version: "v1",
      model_id: "imagen",
      width: 1024,
      height: 1024,
      content_hash: "hash",
      r2_key: `drafts/${id}.png`,
      lifecycle: "draft",
      seed: null,
      created_at: iso(createdOffset),
      expires_at: iso(expiresOffset),
    });
    await data.imageDrafts.insert(draft("a", 0, 60_000));
    await data.imageDrafts.insert(draft("b", 1_000, 60_000));
    await data.imageDrafts.insert(draft("old", 2_000, -1_000));
    expect(await data.imageDrafts.countForWorkspace("w")).toBe(3);
    // Expired drafts are deleted by TTL; the proof's image cap still counts them.
    await db.collection(`${prefix}campaign_image_drafts`).doc("old").delete();
    expect(await data.imageDrafts.countForWorkspace("w")).toBe(3);
    const listed = await data.imageDrafts.listForCampaign("w", "p", "701000000000001", iso(), 24);
    expect(listed.map((row) => row.image_id)).toEqual(["b", "a"]);
    expect(await data.imageDrafts.find("a", "w", "someone-else")).toBeNull();
    await data.imageDrafts.setLifecycle("a", "other-workspace", "rejected");
    expect((await data.imageDrafts.find("a", "w", "p"))?.lifecycle).toBe("draft");
    await data.imageDrafts.setLifecycle("a", "w", "attached");
    expect((await data.imageDrafts.find("a", "w", "p"))?.lifecycle).toBe("attached");
  });

  it("guards architecture transitions and scopes everything to one evaluator", async () => {
    const { data } = fresh();
    const mine = data.architecture("me");
    const theirs = data.architecture("them");
    const at = iso();
    expect(
      await mine.transition({
        urn: "u1",
        from: "draft",
        to: "in_review",
        actor: "a",
        actorType: "persona",
        at,
      }),
    ).toBe(true);
    // A second reviewer who still sees "draft" loses.
    expect(
      await mine.transition({
        urn: "u1",
        from: "draft",
        to: "approved",
        actor: "b",
        actorType: "persona",
        at,
      }),
    ).toBe(false);
    expect(
      await mine.transition({
        urn: "u1",
        from: "in_review",
        to: "approved",
        actor: "b",
        actorType: "agent",
        at: iso(5),
      }),
    ).toBe(true);
    expect((await mine.history("u1")).map((row) => row.to)).toEqual(["in_review", "approved"]);
    expect(await mine.countTransitions()).toBe(2);
    expect(await theirs.countTransitions()).toBe(0);

    for (const decision of ["allow", "allow", "deny"] as const)
      await mine.logGateway({
        at: iso(),
        persona: "brand",
        principalType: "persona",
        principalId: "brand",
        action: "transition",
        resource: null,
        decision,
        policyId: "p1",
        reason: "x".repeat(400),
        latencyMs: 3,
        correlationId: "c",
      });
    expect(await mine.gatewayStats()).toEqual({ allowed: 2, denied: 1, total: 3 });
    const log = await mine.gatewayLog(2);
    expect(log).toHaveLength(2);
    expect(log[0]?.reason).toHaveLength(300);
    expect(await mine.decisionCoverage()).toEqual({ total: 2, withSpan: 2 });

    await mine.saveEvalSample("agent-1", iso(), { quality: 0.5 });
    await mine.saveEvalSample("agent-1", iso(10), { quality: 0.9 });
    expect(await mine.evalSamples("agent-1", 1)).toEqual([{ quality: 0.9 }]);
    expect(await data.architecture("").subjectsWithSamples()).toEqual(["me"]);

    await mine.setLifecycle("agent-1", "constrain", "drift", iso());
    expect(await mine.agentLifecycles()).toEqual({ "agent-1": "constrain" });
    expect(await theirs.agentLifecycles()).toEqual({});
  });

  it("saves objects once and loads them into the world", async () => {
    const { data } = fresh();
    const store = data.architecture("me");
    const before = await store.loadWorld();
    const sample = [...before.objects.values()][0];
    if (!sample) throw new Error("the seed world has no objects");
    const object = { ...sample, urn: `${sample.urn}-copy`, createdAt: iso() } as GovernedObject;
    await store.saveObjects([object]);
    await store.saveObjects([{ ...object, createdAt: iso(5) } as GovernedObject]);
    const after = await store.loadWorld();
    expect(after.objects.get(object.urn)?.createdAt).toBe(object.createdAt);
    expect(after.objects.size).toBe(before.objects.size + 1);
  });

  it("splits large orchestrations across chunks and reads them back whole", async () => {
    const { data } = fresh();
    const store = data.architecture("me");
    const events = Array.from({ length: 3_000 }, (_, index) => ({ index, text: "e".repeat(500) }));
    await store.saveOrchestration({
      id: "o1",
      flowId: "team:brief-1",
      brand: "lumera",
      status: "running",
      waitingOn: null,
      messages: [{ hello: "world" }],
      events,
      at: iso(),
    });
    await store.saveOrchestration({
      id: "o1",
      flowId: "team:brief-1",
      brand: "lumera",
      status: "done",
      waitingOn: null,
      messages: [],
      events: events.slice(0, 10),
      at: iso(5),
    });
    const saved = await store.orchestration("o1");
    expect(saved?.status).toBe("done");
    expect(saved?.events).toHaveLength(10);
    await store.saveOrchestration({
      id: "o2",
      flowId: "other",
      brand: "x",
      status: "done",
      waitingOn: "brand-lead",
      messages: [],
      events,
      at: iso(10),
    });
    const team = await store.orchestrationsWithPrefix("team:");
    expect(team.map((row) => row.id)).toEqual(["o1"]);
    expect((await store.orchestration("o2"))?.events).toHaveLength(3_000);
    await data.pruneArchitecture(new Date(Date.now() + 60_000));
    expect(await store.orchestration("o2")).toBeNull();
  });

  it("keeps the ten newest squad runs in the library", async () => {
    const { data } = fresh();
    for (let index = 0; index < 12; index += 1)
      await data.teamLibrary.record(
        {
          id: `run-${index}`,
          brief: { id: "b", title: `Run ${index}`, brand: "lumera" },
          mode: "squad",
          provider: "cloudflare",
          events: [{ type: "status" }, { type: "done" }],
          stamps: [1_000, 3_000],
          tokens: 10,
          status: "done",
          scripted: true,
        } as unknown as Parameters<typeof data.teamLibrary.record>[0],
        new Date(Date.UTC(2026, 10, 25, 12, 0, index)).toISOString(),
      );
    const runs = await data.teamLibrary.list();
    expect(runs).toHaveLength(10);
    expect(runs[0]).toMatchObject({ id: "run-11", events: 2, durationMs: 2_000, scripted: true });
    expect(await data.teamLibrary.get("run-0")).toBeNull();
    expect((await data.teamLibrary.get("run-11"))?.events).toHaveLength(2);
  });

  it("looks members up by lower-cased email", async () => {
    const { db, prefix } = fresh();
    await db.collection(`${prefix}members`).doc("ada@example.com").set({ role: "evaluator" });
    const members = firestoreMembers(db, prefix);
    expect(await members.lookup("Ada@Example.com")).toEqual({ role: "evaluator" });
    expect(await members.lookup("eve@example.com")).toBeNull();
  });
});
