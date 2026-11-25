import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isBlockedMcpUrl, normalizeServerId } from "../../src/agent/mcp";
import { MemorySnapshotStore } from "../../src/agent/snapshots";
import { startAgentServer, type TestEnv, until } from "./harness";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ACCESS_TOKEN = "access-token-that-must-never-be-stored-in-clear";

/** An OAuth-protected streamable-HTTP MCP server: PRM + AS metadata, DCR, PKCE token exchange. */
async function startProtectedMcp() {
  const log = { registrations: 0, tokenRequests: [] as URLSearchParams[] };
  let base = "";
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return send(200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (
      url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
      url.pathname.startsWith("/.well-known/openid-configuration")
    )
      return send(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    if (url.pathname === "/register") {
      log.registrations += 1;
      return send(201, { ...JSON.parse(body), client_id: "dynamic-client" });
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(body);
      log.tokenRequests.push(form);
      if (form.get("code") !== "the-code" || !form.get("code_verifier"))
        return send(400, { error: "invalid_grant" });
      return send(200, {
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-token",
      });
    }
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`)
        return send(
          401,
          { error: "invalid_token" },
          {
            "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          },
        );
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      const response = await createMcpHandler(() => {
        const mcp = new McpServer({ name: "fake", version: "1.0.0" });
        mcp.registerTool(
          "echo_text",
          { description: "Echo text", inputSchema: z.object({ text: z.string() }) },
          async ({ text }) => ({ content: [{ type: "text", text: `echo ${text}` }] }),
        );
        return mcp;
      }).fetch(
        new Request(url, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "DELETE" ? undefined : body,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      return res.end();
    }
    send(404, { error: "not_found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${base}/mcp`,
    log,
    close: async () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

type AgentServer = Awaited<ReturnType<typeof startAgentServer>>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function agentServer(env: TestEnv, snapshots = new MemorySnapshotStore()) {
  const server = await startAgentServer({ env, snapshots });
  cleanups.push(() => server.close());
  return server;
}

async function protectedMcp() {
  const mcp = await startProtectedMcp();
  cleanups.push(mcp.close);
  return mcp;
}

async function serverState(server: AgentServer) {
  const body = (await (await server.api("/agent/mcp/servers")).json()) as {
    servers: Record<string, { state: string; error: string | null; auth_url: string | null }>;
    tools: { name: string; serverId: string }[];
  };
  return body;
}

async function authorize(server: AgentServer, authUrl: string) {
  const state = new URL(authUrl).searchParams.get("state");
  const callback = await server.api(`/agent/mcp/callback?code=the-code&state=${state}`, {
    redirect: "manual",
  });
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(`${server.origin}/`);
}

describe("MCP client over streamable HTTP with OAuth", () => {
  it("runs the authorization-code + PKCE flow, names tools like agents, and seals tokens", async () => {
    const mcp = await protectedMcp();
    const snapshots = new MemorySnapshotStore();
    const server = await agentServer(
      { ENVIRONMENT: "production", TOKEN_ENCRYPTION_KEY: KEY },
      snapshots,
    );

    const started = (await (await server.post("/agent/mcp/connect", { url: mcp.url })).json()) as {
      state: string;
      authUrl: string;
    };
    expect(started.state).toBe("authenticating");
    const authUrl = new URL(started.authUrl);
    expect(authUrl.searchParams.get("client_id")).toBe("dynamic-client");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(`${server.origin}/agent/mcp/callback`);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await serverState(server)).servers["test-server"]).toMatchObject({
      state: "authenticating",
      auth_url: started.authUrl,
    });

    await authorize(server, started.authUrl);
    await until(async () => (await serverState(server)).servers["test-server"]?.state === "ready");
    expect(mcp.log.tokenRequests[0]?.get("code_verifier")).toBeTruthy();
    const listed = await serverState(server);
    expect(listed.tools).toEqual([
      expect.objectContaining({ name: "echo_text", serverId: "test-server" }),
    ]);
    expect(listed.servers["test-server"]?.auth_url).toBeNull();

    const called = (await (
      await server.post("/agent/mcp/call", {
        name: "tool_testserver_echo_text",
        args: { text: "hi" },
      })
    ).json()) as { names: string[]; result: { content: { text: string }[] } };
    expect(called.names).toEqual(["tool_testserver_echo_text"]);
    expect(called.result.content[0]?.text).toBe("echo hi");

    const storage = server.agent()?.ctx.storage;
    const sealed = storage?.kvGet("mcp:test-server:tokens") ?? "";
    expect(sealed.startsWith("aesgcm:v1:")).toBe(true);
    await server.host.flush();
    const image = Buffer.from((await snapshots.load("chat-1"))?.bytes ?? new Uint8Array());
    expect(image.includes(ACCESS_TOKEN)).toBe(false);
    expect(image.includes("refresh-token")).toBe(false);

    // A new process restores the connection from the sealed tokens, without asking the user again.
    await server.close();
    cleanups.splice(cleanups.length - 1, 1);
    const revived = await agentServer(
      { ENVIRONMENT: "production", TOKEN_ENCRYPTION_KEY: KEY },
      snapshots,
    );
    const again = (await (
      await revived.post("/agent/mcp/call", {
        name: "tool_testserver_echo_text",
        args: { text: "back" },
      })
    ).json()) as { result: { content: { text: string }[] } };
    expect(again.result.content[0]?.text).toBe("echo back");
    expect(mcp.log.tokenRequests).toHaveLength(1);
  });

  it("uses SALESFORCE_CLIENT_ID as a pre-registered client instead of registering", async () => {
    const mcp = await protectedMcp();
    const server = await agentServer({
      ENVIRONMENT: "local",
      SALESFORCE_CLIENT_ID: "pre-registered-client",
    });
    const started = (await (await server.post("/agent/mcp/connect", { url: mcp.url })).json()) as {
      authUrl: string;
    };
    expect(new URL(started.authUrl).searchParams.get("client_id")).toBe("pre-registered-client");
    expect(mcp.log.registrations).toBe(0);
  });

  it("refuses to start OAuth when tokens could not be encrypted", async () => {
    const mcp = await protectedMcp();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await agentServer({ ENVIRONMENT: "production" });
    const response = await server.post("/agent/mcp/connect", { url: mcp.url });
    expect(response.status).toBe(502);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("TOKEN_ENCRYPTION_KEY is not set");
    expect(server.agent()?.ctx.storage.kvKeys("mcp:")).toEqual([]);
    expect(mcp.log.tokenRequests).toHaveLength(0);
    expect((await serverState(server)).servers["test-server"]?.state).toBe("failed");
  });

  it("ignores a callback whose state was never issued", async () => {
    const mcp = await protectedMcp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await agentServer({ ENVIRONMENT: "local" });
    await server.post("/agent/mcp/connect", { url: mcp.url });
    const forged = await server.api("/agent/mcp/callback?code=the-code&state=forged.test-server", {
      redirect: "manual",
    });
    expect(forged.status).toBe(302);
    expect((await serverState(server)).servers["test-server"]?.state).toBe("authenticating");
    expect(mcp.log.tokenRequests).toHaveLength(0);
  });
});

describe("MCP helpers", () => {
  it("normalizes server ids like agents", () => {
    expect(normalizeServerId("salesforce")).toBe("salesforce");
    expect(normalizeServerId("GitHub MCP!")).toBe("github-mcp");
    expect(normalizeServerId("42-things")).toBe("id-42-things");
  });

  it("blocks metadata and private-network targets but allows loopback for local development", () => {
    expect(isBlockedMcpUrl("http://169.254.169.254/computeMetadata/v1/")).toBe(true);
    expect(isBlockedMcpUrl("http://metadata.google.internal/")).toBe(true);
    expect(isBlockedMcpUrl("https://10.1.2.3/mcp")).toBe(true);
    expect(isBlockedMcpUrl("http://127.0.0.1:8787/mcp")).toBe(false);
    expect(isBlockedMcpUrl("https://api.salesforce.com/platform/mcp")).toBe(false);
  });
});
