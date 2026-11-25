// The Google Cloud host: one Node server on Cloud Run serving the same routes as the Worker
// (apps/edge/src/app.ts). Chats live in the Node agent host, persisted to Cloud Storage; the app's
// tables in Firestore; models on Vertex AI; sign-in by Identity-Aware Proxy (ADR-018).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { PROOF_DEFAULTS } from "@northstar/contracts";
import {
  handleWorkbenchRequest,
  runScheduledMaintenance,
  type WorkbenchEnv,
} from "../../edge/src/app";
import { AuthError, deriveAgentKey, resolvePrincipal } from "../../edge/src/auth";
import { MarketingOrchestrator } from "../../edge/src/orchestrator";
import { createAgentHost } from "./agent/host";
import type { SnapshotStore } from "./agent/snapshots";
import { buildEnv, loadConfig } from "./env";
import { type SchedulerVerifier, schedulerVerifier } from "./platform/scheduler";

/** A Fetch API request for a Node request, aborted if the client goes away. */
export function toRequest(req: IncomingMessage, res?: ServerResponse): Request {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  const url = new URL(req.url ?? "/", `${proto}://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const abort = new AbortController();
  res?.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    signal: abort.signal,
    ...(hasBody
      ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" as const }
      : {}),
  } as RequestInit);
}

/** Streams a Fetch API response back, chunk by chunk, so server-sent events arrive as they happen. */
export async function sendResponse(res: ServerResponse, response: Response) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((resolve) => res.once("drain", resolve));
    }
  } catch (error) {
    console.warn(
      "[gcp] response stream ended early",
      error instanceof Error ? error.message : error,
    );
  } finally {
    res.end();
  }
}

export type GcpServerOptions = {
  env: WorkbenchEnv;
  snapshots: SnapshotStore;
  assets: (request: Request) => Promise<Response>;
  verifyScheduler: SchedulerVerifier | null;
  readiness?: () => Record<string, boolean>;
};

export function createGcpServer(options: GcpServerOptions) {
  const { env } = options;
  const agents = createAgentHost({
    agentClass: MarketingOrchestrator as unknown as Parameters<
      typeof createAgentHost
    >[0]["agentClass"],
    env,
    snapshots: options.snapshots,
  });
  const props = (subject: string) => ({
    principalSubject: subject,
    workspaceId: PROOF_DEFAULTS.workspaceId,
  });
  const host = {
    agent: (request: Request, principal: { subject: string }, name: string) =>
      agents.fetch(request, name, props(principal.subject)),
    assets: options.assets,
    readiness:
      options.readiness ??
      (() => ({
        agentHost: true,
        staticAssets: true,
        firestore: Boolean((env as { DATA?: unknown }).DATA),
        vertexAi: Boolean((env as { MODELS?: unknown }).MODELS),
        cloudStorage: Boolean(env.CAMPAIGN_ASSETS),
      })),
  };

  const server = createServer(async (req, res) => {
    try {
      const request = toRequest(req, res);
      const url = new URL(request.url);
      if (url.pathname === "/internal/scheduled") {
        if (request.method !== "POST")
          return sendResponse(res, new Response(null, { status: 405 }));
        if (
          !options.verifyScheduler ||
          !(await options.verifyScheduler(request.headers.get("authorization")))
        )
          return sendResponse(res, new Response(null, { status: 403 }));
        await runScheduledMaintenance(env);
        return sendResponse(res, new Response(null, { status: 204 }));
      }
      await sendResponse(res, await handleWorkbenchRequest(request, env, host));
    } catch (error) {
      console.error("[gcp] request failed", error instanceof Error ? error.message : error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "The request failed." } }),
      );
    }
  });

  // The chat's WebSocket: signed in like every other request, then handed to the principal's chat.
  server.on("upgrade", async (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/agent" && !path.startsWith("/agent/")) {
      socket.destroy();
      return;
    }
    try {
      const principal = await resolvePrincipal(toRequest(req), env);
      const name = await deriveAgentKey(principal, PROOF_DEFAULTS.workspaceId);
      agents.upgrade(req, socket, head, name, props(principal.subject));
    } catch (error) {
      const status = error instanceof AuthError && error.code === "UNAUTHENTICATED" ? 401 : 403;
      socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\n\r\n`);
    }
  });

  return {
    server,
    async close() {
      await agents.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Cloud Run's entry point. */
export async function main() {
  const config = loadConfig();
  if (!config.project) console.warn("[gcp] GCP_PROJECT is not set; Vertex AI models are off.");
  const { env, assets, snapshots } = buildEnv(config);
  const app = createGcpServer({
    env,
    snapshots,
    assets,
    verifyScheduler: config.scheduler ? schedulerVerifier(config.scheduler) : null,
  });
  const port = Number(process.env.PORT ?? 8080);
  app.server.listen(port, () => console.info(JSON.stringify({ event: "listening", port })));
  // Cloud Run sends SIGTERM before stopping an instance: save every open chat first.
  process.once("SIGTERM", () => {
    console.info(JSON.stringify({ event: "shutting_down" }));
    app
      .close()
      .catch((error: unknown) => console.error("[gcp] shutdown failed", error))
      .finally(() => process.exit(0));
  });
}
