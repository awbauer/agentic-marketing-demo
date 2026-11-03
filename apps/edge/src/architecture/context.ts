import {
  type AgentOverrides,
  type Brand,
  buildPolicies,
  type ChainHop,
  DEFAULT_SCOPE,
  type Decision,
  evaluate,
  type GatewayRequest,
  identityChain,
  mintAgentToken,
  type Persona,
  toolBrand,
  verifyAgentToken,
  type WorkbenchScope,
} from "@northstar/architecture";
import { ArchitectureStore } from "./store";

export type ArchEnv = {
  APP_DB: D1Database;
  ASSETS?: Fetcher;
  DISABLED_AGENTS?: string;
  ARCH_TOKEN_SECRET?: string;
  /** Workers AI, which the agents run on. */
  AI?: Ai;
  AI_GATEWAY_ID?: string;
  /** "scripted" only in the hermetic worker tests; see scripted-model.ts. */
  AGENT_MODEL?: string;
  /**
   * Champions by task class, as JSON (for example {"orchestrate": "@cf/moonshotai/kimi-k2.6"}), to
   * run a catalog model in place of the ADR-009 champion. A model outside the catalog is ignored.
   */
  AGENT_CHAMPIONS?: string;
};

export class ArchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type Ctx = {
  env: ArchEnv;
  store: ArchitectureStore;
  user: { subject: string; persona: Persona; brands: readonly Brand[] | "all" };
  correlationId: string;
  now: () => Date;
};

export function makeCtx(
  env: ArchEnv,
  user: Ctx["user"],
  correlationId: string,
  now: () => Date = () => new Date(),
): Ctx {
  return { env, store: new ArchitectureStore(env.APP_DB, user.subject), user, correlationId, now };
}

export const disabledAgents = (env: ArchEnv) =>
  (env.DISABLED_AGENTS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

// Without a configured secret each isolate mints its own, so tokens never outlive the Worker.
let isolateSecret: string | undefined;
function tokenSecret(env: ArchEnv) {
  if (env.ARCH_TOKEN_SECRET) return env.ARCH_TOKEN_SECRET;
  isolateSecret ??= [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return isolateSecret;
}

export async function overridesFor(ctx: Ctx): Promise<AgentOverrides> {
  // The kill switch is configuration and always applies; lifecycle constraints come from D1 and are
  // skipped, with a report, if the table is unavailable rather than taking every tool down.
  try {
    return { lifecycle: await ctx.store.agentLifecycles(), disabled: disabledAgents(ctx.env) };
  } catch (error) {
    console.error(
      "[gateway] agent lifecycles unavailable",
      error instanceof Error ? error.message : error,
    );
    return { disabled: disabledAgents(ctx.env) };
  }
}

export type Invoked<T> = { value: T; decision: Decision; chain: ChainHop[] };

/**
 * The only path to an architecture capability. It evaluates the policies (default-deny), logs the
 * decision, mints and verifies a per-invocation token, and only then runs the capability.
 */
export async function invoke<T>(
  ctx: Ctx,
  request: Omit<GatewayRequest, "user">,
  run: () => Promise<T> | T,
): Promise<Invoked<T>> {
  const started = Date.now();
  const full: GatewayRequest = { ...request, user: ctx.user };
  const policies = buildPolicies(await overridesFor(ctx));
  const decision = evaluate(policies, full);
  // A failed audit write is reported, never allowed to take the call down with it.
  const log = (latencyMs: number) =>
    ctx.store
      .logGateway({
        at: ctx.now().toISOString(),
        persona: ctx.user.persona,
        principalType: request.principal.type,
        principalId: request.principal.id,
        action: request.action,
        resource: request.resource?.urn ?? request.resource?.kind ?? null,
        decision: decision.decision,
        policyId: decision.policyId,
        reason: decision.reason,
        latencyMs,
        correlationId: ctx.correlationId,
      })
      .catch((error) =>
        console.error(
          "[gateway] audit write failed",
          error instanceof Error ? error.message : error,
        ),
      );
  if (decision.decision === "deny") {
    await log(Date.now() - started);
    throw new ArchError(403, "DENIED", decision.reason, {
      decision,
      chain: identityChain(full, decision),
    });
  }
  const secret = tokenSecret(ctx.env);
  const token = await mintAgentToken(secret, full);
  await verifyAgentToken(secret, token, { action: request.action, user: ctx.user.subject });
  const value = await run();
  await log(Date.now() - started);
  return { value, decision, chain: identityChain(full, decision, { tokenVerified: true }) };
}

/** Authorizes a model-called orchestrator tool as `tool:<name>`, and logs the decision. */
export async function authorizeTool(
  env: ArchEnv,
  subject: string,
  toolName: string,
  correlationId: string,
  scope: WorkbenchScope = DEFAULT_SCOPE,
): Promise<Decision> {
  const ctx = makeCtx(
    env,
    { subject, persona: scope.persona, brands: scope.brand === "all" ? "all" : [scope.brand] },
    correlationId,
  );
  const brand = toolBrand(toolName);
  try {
    const { decision } = await invoke(
      ctx,
      {
        principal: { type: "agent", id: "orchestrator" },
        action: `tool:${toolName}`,
        ...(brand ? { resource: { brand } } : {}),
      },
      () => null,
    );
    return decision;
  } catch (error) {
    if (error instanceof ArchError && error.extra.decision) return error.extra.decision as Decision;
    throw error;
  }
}
