// The Google Cloud server end to end, on a real port: the shared routes, IAP sign-in, the
// scheduler route, static files, and the orchestrator's HTTP face through the Node agent host.
// Data lives in the Firestore emulator; models are absent, so no turn calls one.
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkbenchEnv } from "../../edge/src/app";
import { MemorySnapshotStore } from "../src/agent/snapshots";
import { firestoreDataPlatform, firestoreMembers } from "../src/platform/firestore";
import { staticAssets } from "../src/platform/static";
import { createGcpServer } from "../src/server";

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulator)("the Google Cloud server", () => {
  let base = "";
  let close: () => Promise<void> = async () => undefined;
  let firestore: Firestore;
  const snapshots = new MemorySnapshotStore();
  const verified: string[] = [];

  beforeAll(async () => {
    firestore = new Firestore({ projectId: "northstar-test" });
    const prefix = `s${randomUUID().slice(0, 8)}_`;
    const root = await mkdtemp(join(tmpdir(), "northstar-server-"));
    await writeFile(join(root, "index.html"), "<html>workbench</html>");
    const env = {
      ENVIRONMENT: "local",
      AUTH_MODE: "development",
      PROOF_WORKSPACE_ID: "northstar-demo",
      CAMPAIGN_IMAGE_MODEL: "test-image",
      SALESFORCE_MCP_URL: "",
      SURFACE_ALLOWED_ORIGINS: "",
      AGENT_MODEL: "scripted",
      NEO4J_QUERY_URL: "",
      NEO4J_USERNAME: "",
      NEO4J_PASSWORD: "",
      DATA: firestoreDataPlatform(firestore, prefix),
      MEMBERS: firestoreMembers(firestore, prefix),
      CAMPAIGN_ASSETS: { get: async () => null, put: async () => undefined },
    } as unknown as WorkbenchEnv;
    const app = createGcpServer({
      env,
      snapshots,
      assets: staticAssets(root),
      verifyScheduler: async (authorization) => {
        verified.push(String(authorization));
        return authorization === "Bearer scheduler";
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    close = app.close;
  });

  afterAll(async () => {
    await close();
    await firestore?.terminate();
  });

  it("answers health and readiness with the Google Cloud checks", async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health).toMatchObject({ status: "ok", service: "northstar-edge", environment: "local" });
    const ready = (await (await fetch(`${base}/api/ready`)).json()) as { checks: object };
    expect(ready.checks).toMatchObject({ agentHost: true, firestore: true, cloudStorage: true });
  });

  it("serves the app for page routes and 404s unknown API routes", async () => {
    expect(await (await fetch(`${base}/campaigns/1`)).text()).toBe("<html>workbench</html>");
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it("gives the local evaluator a session and an agent key", async () => {
    const session = (await (await fetch(`${base}/api/session`)).json()) as { agentKey: string };
    expect(session.agentKey).toMatch(/^wk_[a-f0-9]{32}$/);
  });

  it("reaches the orchestrator over HTTP through the agent host", async () => {
    const operations = await fetch(`${base}/agent/operations`);
    expect(operations.status).toBe(200);
    expect(await operations.json()).toHaveProperty("writesEnabled");
    const turns = (await (await fetch(`${base}/agent/turns`)).json()) as { turns: unknown[] };
    expect(turns.turns).toEqual([]);
    const audit = (await (await fetch(`${base}/agent/audit/export`)).json()) as {
      confirmations: unknown[];
    };
    expect(audit.confirmations).toEqual([]);
  });

  it("runs maintenance only for the scheduler's token", async () => {
    expect((await fetch(`${base}/internal/scheduled`, { method: "POST" })).status).toBe(403);
    expect(
      (
        await fetch(`${base}/internal/scheduled`, {
          method: "POST",
          headers: { authorization: "Bearer scheduler" },
        })
      ).status,
    ).toBe(204);
    expect((await fetch(`${base}/internal/scheduled`)).status).toBe(405);
    expect(verified).toContain("Bearer scheduler");
  });

  it("serves the squad page's data, with the run library on Firestore", async () => {
    const team = (await (await fetch(`${base}/api/arch/team`)).json()) as {
      providers: Array<{ id: string; available: boolean }>;
    };
    expect(team.providers.map((provider) => provider.id)).toEqual([
      "cloudflare",
      "anthropic",
      "openai",
    ]);
    const library = (await (await fetch(`${base}/api/arch/team/library`)).json()) as {
      runs: unknown[];
    };
    expect(library.runs).toEqual([]);
  });
});
