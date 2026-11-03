import {
  type ApprovalState,
  BRANDS,
  type Brand,
  CHANNELS_EMITTED,
  emitAll,
  type GovernedObject,
  isPersona,
  PERSONA_LABELS,
  PERSONAS,
  type Persona,
  resolveWorkspace,
  WORKSPACES,
  workspaceById,
} from "@northstar/architecture";
import type { Principal } from "@northstar/contracts";
import { type ArchEnv, ArchError, type Ctx, invoke, makeCtx } from "./context";
import {
  acceptOptimizationOp,
  cardOp,
  driftSweep,
  expireOp,
  historyOp,
  listObjectsOp,
  optimizationsOp,
  readObjectOp,
  runAgentOp,
  searchOp,
  supersedeClaimOp,
  transitionOp,
} from "./ops";
import {
  continueOrchestration,
  orchestrationOp,
  startOrchestration,
  streamFlow,
} from "./orchestration";
import {
  a2aCard,
  evaluationsView,
  modelsView,
  promptsView,
  registryView,
  trustView,
} from "./views";

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

export function errorBody(error: ArchError, correlationId: string) {
  return { error: { code: error.code, message: error.message, correlationId, ...error.extra } };
}

/** The signed-in person, as the persona they have chosen to act as, within what their role allows. */
export function contextFor(
  request: Request,
  env: ArchEnv,
  principal: Principal,
  correlationId: string,
): Ctx {
  const requested = request.headers.get("x-persona") ?? "marketer";
  if (!isPersona(requested))
    throw new ArchError(400, "BAD_REQUEST", `Unknown persona ${requested}.`);
  if (requested === "admin" && principal.role !== "demo-admin")
    throw new ArchError(403, "FORBIDDEN", "Only a demo-admin can act as admin.");
  const brand = request.headers.get("x-brand");
  if (brand && !(BRANDS as readonly string[]).includes(brand))
    throw new ArchError(400, "BAD_REQUEST", `Unknown brand ${brand}.`);
  return makeCtx(
    env,
    { subject: principal.subject, persona: requested, brands: brand ? [brand as Brand] : "all" },
    correlationId,
  );
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const OBJECT = /^\/api\/arch\/objects\/([^/]+)(?:\/(history|transition|card|supersede))?$/;
const AGENT_RUN = /^\/api\/arch\/agents\/([^/]+)\/run$/;
const WORKSPACE = /^\/api\/arch\/workspaces\/([^/]+)$/;
const ORCHESTRATION = /^\/api\/arch\/orchestrations\/([^/]+)(?:\/(continue))?$/;
const A2A = /^\/api\/arch\/a2a\/([^/]+)\/agent-card$/;

/** Routes under /api/arch/. Returns null for a path it does not own. */
export async function handleArchitecture(
  request: Request,
  env: ArchEnv,
  principal: Principal,
  correlationId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/arch/")) return null;
  try {
    const ctx = contextFor(request, env, principal, correlationId);
    const method = request.method;
    const path = url.pathname;

    if (path === "/api/arch/session")
      return json({
        persona: ctx.user.persona,
        personas: PERSONAS.filter(
          (persona) => persona !== "admin" || principal.role === "demo-admin",
        ).map((id) => ({ id, label: PERSONA_LABELS[id] })),
        brands: BRANDS,
        brandScope: ctx.user.brands,
        role: principal.role,
      });
    if (path === "/api/arch/objects" && method === "GET") {
      const kind = url.searchParams.get("kind") ?? undefined;
      const brand = url.searchParams.get("brand") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;
      return json({
        objects: await listObjectsOp(ctx, {
          ...(kind ? { kind: kind as GovernedObject["kind"] } : {}),
          ...(brand ? { brand: brand as Brand } : {}),
          ...(state ? { state: state as ApprovalState } : {}),
        }),
      });
    }
    const object = OBJECT.exec(path);
    if (object?.[1]) {
      const urn = decodeURIComponent(object[1]);
      const sub = object[2];
      if (!sub && method === "GET") return json(await readObjectOp(ctx, urn));
      if (sub === "history" && method === "GET")
        return json({ history: await historyOp(ctx, urn) });
      if (sub === "card" && method === "GET") return json(await cardOp(ctx, urn));
      if (sub === "transition" && method === "POST") {
        const input = await body(request);
        return json({
          card: await transitionOp(
            ctx,
            urn,
            String(input.to) as ApprovalState,
            typeof input.reason === "string" ? input.reason : undefined,
          ),
        });
      }
      if (sub === "supersede" && method === "POST") {
        const input = await body(request);
        return json(await supersedeClaimOp(ctx, urn, input as never));
      }
    }
    if (path === "/api/arch/search" && method === "GET")
      return json({ results: await searchOp(ctx, url.searchParams.get("q") ?? "") });
    const run = AGENT_RUN.exec(path);
    if (run?.[1] && method === "POST") {
      const input = await body(request);
      return json(
        await runAgentOp(
          ctx,
          run[1],
          String(input.action ?? ""),
          (input.input as Record<string, unknown>) ?? {},
        ),
      );
    }
    if (path === "/api/arch/orchestrations" && method === "POST") {
      const input = await body(request);
      return streamFlow(startOrchestration(ctx, String(input.flowId ?? "")));
    }
    const flow = ORCHESTRATION.exec(path);
    if (flow?.[1] && flow[2] === "continue" && method === "POST")
      return streamFlow(await continueOrchestration(ctx, decodeURIComponent(flow[1])));
    if (flow?.[1] && !flow[2] && method === "GET")
      return json(await orchestrationOp(ctx, decodeURIComponent(flow[1])));
    if (path === "/api/arch/optimizations" && method === "GET") {
      const brand = url.searchParams.get("brand") ?? undefined;
      return json(await optimizationsOp(ctx, brand as Brand | undefined));
    }
    if (path === "/api/arch/optimizations/accept" && method === "POST")
      return json(await acceptOptimizationOp(ctx, String((await body(request)).proposalId ?? "")));
    if (path === "/api/arch/maintenance" && method === "POST")
      return json({
        ...(await expireOp(ctx)),
        drift: (await driftSweep(ctx)).map((report) => ({
          agentId: report.agentId,
          drifted: report.drifted,
          samples: report.samples,
        })),
      });
    if (path === "/api/arch/workspaces" && method === "GET")
      return json({
        workspaces: WORKSPACES.map(({ id, title, summary, personas }) => ({
          id,
          title,
          summary,
          personas,
        })),
      });
    const workspace = WORKSPACE.exec(path);
    if (workspace?.[1] && method === "GET") {
      const manifest = workspaceById(workspace[1]);
      if (!manifest) throw new ArchError(404, "NOT_FOUND", `No workspace ${workspace[1]}.`);
      const { value } = await invoke(
        ctx,
        { principal: { type: "persona", id: ctx.user.persona }, action: "list_objects" },
        async () =>
          resolveWorkspace(manifest, await ctx.store.loadWorld(ctx.now()), {
            persona: ctx.user.persona,
            brand:
              ctx.user.brands === "all"
                ? ((url.searchParams.get("brand") as Brand | null) ?? undefined)
                : ctx.user.brands[0],
          }),
      );
      return json(value);
    }
    if (path === "/api/arch/registry")
      return json(
        (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "read_registry" },
            () => registryView(ctx),
          )
        ).value,
      );
    if (path === "/api/arch/evaluations")
      return json(
        (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "evaluate" },
            () => evaluationsView(ctx),
          )
        ).value,
      );
    if (path === "/api/arch/models")
      return json(
        (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "route_model" },
            () => modelsView(ctx, request),
          )
        ).value,
      );
    if (path === "/api/arch/prompts")
      return json(
        (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "read_registry" },
            () => promptsView(),
          )
        ).value,
      );
    if (path === "/api/arch/trust")
      return json(
        (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "read_trust" },
            () => trustView(ctx),
          )
        ).value,
      );
    if (path === "/api/arch/gateway/log")
      return json({
        log: (
          await invoke(
            ctx,
            { principal: { type: "persona", id: ctx.user.persona }, action: "read_trust" },
            () => ctx.store.gatewayLog(Number(url.searchParams.get("limit") ?? 50)),
          )
        ).value,
      });
    if (path === "/api/arch/channels" && method === "GET") {
      const urn = url.searchParams.get("urn");
      if (!urn) throw new ArchError(400, "BAD_REQUEST", "urn is required.");
      return json({ channels: CHANNELS_EMITTED, emitted: emitAll(await cardOp(ctx, urn)) });
    }
    const card = A2A.exec(path);
    if (card?.[1]) {
      const found = (
        await invoke(
          ctx,
          { principal: { type: "persona", id: ctx.user.persona }, action: "read_registry" },
          () => a2aCard(card[1] as string, url.origin),
        )
      ).value;
      if (!found) throw new ArchError(404, "NOT_FOUND", `${card[1]} is not a partner agent.`);
      return json(found);
    }
    throw new ArchError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    if (error instanceof ArchError)
      return json(errorBody(error, correlationId), { status: error.status });
    throw error;
  }
}

export type { Persona };
