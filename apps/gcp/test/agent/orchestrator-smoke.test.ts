import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentHost } from "../../src/agent/host";
import { MemorySnapshotStore } from "../../src/agent/snapshots";
import { collect, connectClient, deltas, textOf, until, userMessage } from "./harness";

// What the GCP bundle does: the unchanged orchestrator extends this package's AIChatAgent.
vi.mock("@cloudflare/ai-chat", () => import("../../src/agent/ai-chat"));

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("MarketingOrchestrator on the Node host", () => {
  it("starts, answers its HTTP routes, and runs a local chat turn over the socket", async () => {
    const { MarketingOrchestrator } = await import("../../../edge/src/orchestrator");
    const snapshots = new MemorySnapshotStore();
    const host = createAgentHost({
      // Type-wise the import still sees the real package; at runtime it extends ours.
      agentClass: MarketingOrchestrator as never,
      env: { ENVIRONMENT: "local" } as never,
      snapshots,
    });
    const props = { principalSubject: "tester@example.com", workspaceId: "ws" };
    const server = createServer(async (req, res) => {
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method });
      const response = await host.fetch(request, "orchestrator-1", props);
      res.statusCode = response.status;
      for (const [key, value] of response.headers) res.setHeader(key, value);
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    server.on("upgrade", (req, socket, head) =>
      host.upgrade(req, socket, head, "orchestrator-1", props),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    cleanups.push(async () => {
      await host.close();
      server.closeAllConnections();
      server.close();
    });

    const client = await connectClient(port);
    cleanups.push(() => client.close());
    const state = (await client.waitFor((frame) => frame.type === "cf_agent_state")).state as {
      workingSet?: unknown;
    };
    expect(state.workingSet).toBeDefined();

    const status = await fetch(`http://127.0.0.1:${port}/agent/salesforce/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ id: "salesforce", state: "not-configured" });
    const missing = await fetch(`http://127.0.0.1:${port}/agent/definitely-missing`);
    expect(missing.status).toBe(404);

    const chunks = await collect(await client.send([userMessage("Review the sample campaign")]));
    expect(deltas(chunks)).toContain("strongest signal");
    await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/agent/get-messages`);
      const messages = (await response.json()) as UIMessage[];
      return messages.length === 2 && textOf(messages[1]).includes("strongest signal");
    });
    const turns = (await (await fetch(`http://127.0.0.1:${port}/agent/turns`)).json()) as {
      turns: unknown[];
    };
    expect(turns.turns.length).toBeGreaterThan(0);
  });
});
