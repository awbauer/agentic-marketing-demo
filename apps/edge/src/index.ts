import { createMcpHandler } from "@modelcontextprotocol/server";
import { AUDIT_RETENTION_MS, HealthSchema, PROOF_DEFAULTS } from "@northstar/contracts";
import { getAgentByName } from "agents";
import {
  EXPLORER_MAX_ROWS,
  GraphNodeNotFoundError,
  graphNeighbors,
  graphOverview,
  sweepMemory,
} from "../../../packages/knowledge-graph/src/index.ts";
import { contextFor, handleArchitecture } from "./architecture/api";
import { makeCtx } from "./architecture/context";
import { createWorkbenchMcpServer } from "./architecture/mcp";
import { driftSweep, expireOp } from "./architecture/ops";
import { ArchitectureStore, pruneArchitecture } from "./architecture/store";
import { type AuthBindings, AuthError, deriveAgentKey, resolvePrincipal } from "./auth";
import { createCampaignContextMcpServer } from "./campaign-context/server";
import { createKnowledgeGraphMcpServer, knowledgeGraphBackend } from "./knowledge-graph/server";
import { pruneConfirmationAudit } from "./orchestrator";

export { MarketingOrchestrator } from "./orchestrator";

type Env = CloudflareBindings & AuthBindings;

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}
function correlationId(request: Request) {
  return (
    request.headers.get("cf-ray") ?? request.headers.get("x-correlation-id") ?? crypto.randomUUID()
  );
}
function errorResponse(error: unknown, id: string) {
  if (error instanceof AuthError)
    return json(
      { error: { code: error.code, message: error.message, correlationId: id } },
      { status: error.code === "UNAUTHENTICATED" ? 401 : 403 },
    );
  console.error(
    JSON.stringify({
      event: "request_failed",
      correlationId: id,
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        correlationId: id,
      },
    },
    { status: 500 },
  );
}

const NEIGHBORS_PATH = /^\/api\/graph\/nodes\/([^/]+)\/neighbors$/;

/** Read-only graph snapshots for the Graph explorer page; fixed Cypher, never user queries. */
async function graphExplorerResponse(url: URL, env: Env, id: string): Promise<Response> {
  const backend = knowledgeGraphBackend(
    env as Parameters<typeof knowledgeGraphBackend>[0],
    undefined,
    { maxRows: EXPLORER_MAX_ROWS },
  );
  try {
    if (url.pathname === "/api/graph/overview") return json(await graphOverview(backend));
    const neighbors = NEIGHBORS_PATH.exec(url.pathname);
    if (neighbors?.[1])
      return json(await graphNeighbors(backend, decodeURIComponent(neighbors[1])));
  } catch (error) {
    if (error instanceof GraphNodeNotFoundError)
      return json(
        { error: { code: "NOT_FOUND", message: error.message, correlationId: id } },
        { status: 404 },
      );
    return json(
      {
        error: {
          code: "GRAPH_UNAVAILABLE",
          message: error instanceof Error ? error.message : "The knowledge graph is unavailable.",
          correlationId: id,
        },
      },
      { status: 502 },
    );
  }
  return json(
    { error: { code: "NOT_FOUND", message: "Endpoint not found.", correlationId: id } },
    { status: 404 },
  );
}

// Stateless streamable HTTP: each request gets a fresh server from the factory.
const campaignContextMcpHandler = createMcpHandler(() => createCampaignContextMcpServer());

/** Hourly: prune architecture audit data, expire claims whose evidence lapsed, and watch for drift. */
async function maintainArchitecture(env: Env) {
  try {
    await pruneArchitecture(env.APP_DB, new Date(Date.now() - AUDIT_RETENTION_MS));
    const subjects = await new ArchitectureStore(env.APP_DB, "").subjectsWithSamples();
    for (const subject of subjects) {
      const ctx = makeCtx(env, { subject, persona: "admin", brands: "all" }, "cron");
      await expireOp(ctx);
      await driftSweep(ctx);
    }
  } catch (error) {
    console.warn(
      "[architecture] scheduled maintenance failed",
      error instanceof Error ? error.message : error,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = correlationId(request);
    try {
      if (url.pathname === "/api/health")
        return json(
          HealthSchema.parse({
            status: "ok",
            service: "northstar-edge",
            environment: env.ENVIRONMENT,
            correlationId: id,
          }),
        );
      if (url.pathname === "/api/ready")
        return json({
          status: "ok",
          checks: {
            durableObject: true,
            staticAssets: Boolean(env.ASSETS),
            workersAi: Boolean(env.AI),
            d1: Boolean(env.APP_DB),
            r2: Boolean(env.CAMPAIGN_ASSETS),
          },
          correlationId: id,
        });
      if (url.pathname === "/api/session") {
        const principal = await resolvePrincipal(request, env);
        const agentKey = await deriveAgentKey(principal, PROOF_DEFAULTS.workspaceId);
        return json({ workspaceId: PROOF_DEFAULTS.workspaceId, principal, agentKey });
      }
      if (url.pathname.startsWith("/api/arch/")) {
        const principal = await resolvePrincipal(request, env);
        const response = await handleArchitecture(request, env, principal, id);
        if (response) return response;
      }
      if (url.pathname === "/mcp/workbench") {
        const principal = await resolvePrincipal(request, env);
        const ctx = contextFor(request, env, principal, id);
        return createMcpHandler(() => createWorkbenchMcpServer(ctx)).fetch(request);
      }
      if (url.pathname.startsWith("/api/graph/")) {
        await resolvePrincipal(request, env);
        return await graphExplorerResponse(url, env, id);
      }
      if (url.pathname === "/mcp/knowledge-graph") {
        await resolvePrincipal(request, env);
        const backend = knowledgeGraphBackend(env as Parameters<typeof knowledgeGraphBackend>[0]);
        return createMcpHandler(() => createKnowledgeGraphMcpServer(backend)).fetch(request);
      }
      if (url.pathname === "/mcp/campaign-context") {
        // Same Access-authenticated principal requirement as the rest of the API.
        await resolvePrincipal(request, env);
        return campaignContextMcpHandler.fetch(request);
      }
      if (url.pathname === "/agent" || url.pathname.startsWith("/agent/")) {
        const principal = await resolvePrincipal(request, env);
        const name = await deriveAgentKey(principal, PROOF_DEFAULTS.workspaceId);
        const stub = await getAgentByName(env.MarketingOrchestrator, name, {
          props: { principalSubject: principal.subject, workspaceId: PROOF_DEFAULTS.workspaceId },
        });
        return stub.fetch(request);
      }
      if (url.pathname.startsWith("/api/"))
        return json(
          { error: { code: "NOT_FOUND", message: "Endpoint not found.", correlationId: id } },
          { status: 404 },
        );
      return env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error, id);
    }
  },
  // Hourly: prune the 24-hour audit, sweep expired long-term memory, and keep Aura Free awake
  // (it pauses after three idle days).
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await pruneConfirmationAudit(env.APP_DB);
    await maintainArchitecture(env);
    const backend = knowledgeGraphBackend(env as Parameters<typeof knowledgeGraphBackend>[0]);
    if (backend.kind !== "neo4j") return;
    try {
      await backend.query("RETURN 1 AS ok", {});
      const swept = await sweepMemory(backend, new Date());
      if (swept > 0) console.info(`[memory] swept ${swept} expired memory nodes`);
    } catch (error) {
      console.warn(
        "[knowledge-graph] scheduled maintenance failed",
        error instanceof Error ? error.message : error,
      );
    }
  },
} satisfies ExportedHandler<Env>;
