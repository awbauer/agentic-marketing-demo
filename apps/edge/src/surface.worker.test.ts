import { SELF } from "cloudflare:test";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  parseSurfaceTurn,
  surfaceAllowedOrigins,
  surfaceBootstrap,
  surfaceConfirmation,
  surfaceLoginPage,
  surfaceMessage,
} from "./surface";
import { agentStubFor } from "./worker.test-helpers";

const ORIGIN = "https://example.lightning.force.com";
const env = {
  AUTH_MODE: "access",
  ENVIRONMENT: "proof",
  AI_GATEWAY_ID: "gateway",
  SURFACE_ALLOWED_ORIGINS: ` ${ORIGIN} , https://other.lightning.force.com`,
};
// An unsigned token: the login page only reads its expiry; Access has already verified it.
const accessToken = `e30.${btoa(JSON.stringify({ exp: 2_000_000_000 })).replaceAll("=", "")}.x`;

const login = (origin: string | null, token: string | null = accessToken) =>
  surfaceLoginPage(
    new Request(
      `https://workbench.test/api/surface/login${origin ? `?origin=${encodeURIComponent(origin)}` : ""}`,
      { headers: token ? { "Cf-Access-Jwt-Assertion": token } : {} },
    ),
    env,
  );

const principal = {
  subject: "person",
  email: "person@example.test",
  tenantId: "northstar-pot",
} as const;

describe("surface sign-in", () => {
  it("reads the allowed origins from configuration", () => {
    expect(surfaceAllowedOrigins(env)).toEqual([ORIGIN, "https://other.lightning.force.com"]);
    expect(surfaceAllowedOrigins({})).toEqual([]);
  });

  it("hands the token only to an origin it names, and only through postMessage", async () => {
    const response = login(ORIGIN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    const html = await response.text();
    expect(html).toContain(`opener.postMessage(`);
    expect(html).toContain(`, "${ORIGIN}");`);
    expect(html).toContain('"expiresAt":2000000000000');
  });

  it("refuses an origin it doesn't name without revealing the token", async () => {
    for (const origin of [null, "https://evil.example", `${ORIGIN}.evil.example`, "*"]) {
      const response = login(origin);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(accessToken);
    }
  });

  it("fails closed when Access supplied no token", () => {
    expect(login(ORIGIN, null).status).toBe(401);
  });

  it("escapes the hand-off so a token cannot close the script element", async () => {
    const payload = btoa(JSON.stringify({ exp: 1 })).replaceAll("=", "");
    const html = await login(ORIGIN, `e30.${payload}.</script>`).text();
    expect(html).not.toContain('</script>"');
    expect(html).toContain("\\u003c/script>");
  });
});

describe("surface views", () => {
  it("offers the admin role only to a demo admin", () => {
    const personas = (role: "evaluator" | "demo-admin") =>
      surfaceBootstrap({ ...principal, role }, env).personas.map((persona) => persona.value);
    expect(personas("evaluator")).not.toContain("admin");
    expect(personas("demo-admin")).toContain("admin");
  });

  it("serves the use-case library with each case's brand", () => {
    const { useCases, gateway } = surfaceBootstrap({ ...principal, role: "evaluator" }, env);
    expect(useCases.length).toBeGreaterThan(0);
    expect(useCases.every((useCase) => useCase.brand)).toBe(true);
    expect(gateway.id).toBe("gateway");
  });

  it("accepts a bounded message and falls back to the default scope", () => {
    expect(parseSurfaceTurn({ text: " hi ", scope: { brand: "Acme", persona: "wizard" } })).toEqual(
      { text: "hi", scope: { brand: "all", persona: "marketer" } },
    );
    expect(parseSurfaceTurn({ text: "   " })).toBeNull();
    expect(parseSurfaceTurn({ text: "x".repeat(4001) })).toBeNull();
    expect(parseSurfaceTurn(null)).toBeNull();
  });

  it("keeps a tool call, its state, and its trace in the plain view", () => {
    const message = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done. " },
        {
          type: "dynamic-tool",
          toolName: "graph_get_campaign",
          toolCallId: "c1",
          state: "output-available",
          input: { id: "1" },
          output: { secretToken: "abc", body: "x".repeat(20) },
        },
      ],
    } as unknown as UIMessage;
    const view = surfaceMessage(message);
    expect(view.text).toBe("Done.");
    expect(view.toolCalls[0]).toMatchObject({ id: "c1", state: "done" });
    expect(view.trace.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain("abc");
  });

  it("leaves signing material out of a confirmation", () => {
    const view = surfaceConfirmation({
      id: "00000000-0000-4000-8000-000000000000",
      action: "create-review-task",
      recordId: "new",
      principalSubject: "person",
      requestHash: "a".repeat(64),
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      summary: "Create a review task",
      expiresAt: "2030-01-01T00:00:00.000Z",
      status: "pending",
    });
    expect(view).toMatchObject({ action: "create-review-task", permitted: null });
    expect(JSON.stringify(view)).not.toMatch(/idempotency|requestHash|principal/i);
  });
});

describe("surface routes", () => {
  const post = (stub: DurableObjectStub, path: string, body?: unknown) =>
    stub.fetch(`https://workbench.test/agent/surface/${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = (stub: DurableObjectStub, path: string) =>
    stub.fetch(`https://workbench.test/agent/surface/${path}`);

  /** Polls as the Lightning component does, until the turn settles. */
  async function settled(stub: DurableObjectStub) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const progress = (await (await get(stub, "turn")).json()) as { active: boolean };
      if (!progress.active) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("The turn did not settle.");
  }

  it("runs a turn over HTTP through the same route, scope, and history as chat", async () => {
    const stub = await agentStubFor("surface-turn");
    const started = await post(stub, "turn", {
      text: "Publish the campaign now",
      scope: { brand: "Coastline Kitchen", persona: "reviewer" },
    });
    expect(started.status).toBe(202);
    await settled(stub);
    const { messages } = (await (await get(stub, "messages")).json()) as {
      messages: { role: string; text: string; trace: unknown[] }[];
    };
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.text.length).toBeGreaterThan(0);
    expect(messages[1]?.trace.length).toBeGreaterThan(0);
    const { turns } = (await (await stub.fetch("https://workbench.test/agent/turns")).json()) as {
      turns: { route: string; scope?: { brand: string; persona: string } }[];
    };
    expect(turns[0]?.route).toBe("unsupported");
    expect(turns[0]?.scope).toEqual({ brand: "Coastline Kitchen", persona: "reviewer" });
  });

  it("rejects an empty message and an unknown route", async () => {
    const stub = await agentStubFor("surface-invalid");
    expect((await post(stub, "turn", { text: "" })).status).toBe(400);
    expect((await get(stub, "elsewhere")).status).toBe(404);
  });

  it("clears the chat when asked", async () => {
    const stub = await agentStubFor("surface-clear");
    await post(stub, "turn", { text: "Publish the campaign now" });
    await settled(stub);
    expect((await post(stub, "clear")).status).toBe(200);
    const { messages } = (await (await get(stub, "messages")).json()) as { messages: unknown[] };
    expect(messages).toEqual([]);
  });

  it("requires a signed-in principal for the bootstrap", async () => {
    const response = await SELF.fetch("https://example.test/api/surface/bootstrap");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      principal: { role: "evaluator" },
    });
  });
});
