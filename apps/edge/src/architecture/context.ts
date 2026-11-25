import {
  type AgentOverrides,
  type Brand,
  buildPolicies,
  type ChainHop,
  DEFAULT_SCOPE,
  type Decision,
  evaluate,
  type GatewayContext,
  type GatewayRequest,
  identityChain,
  mergePolicies,
  mintAgentToken,
  type Persona,
  type Policy,
  type PolicySet,
  type Principal,
  toolBrand,
  toolsAllowed,
  verifyAgentToken,
  type WorkbenchScope,
} from "@northstar/architecture";
import { type AiPlatformId, HOST_TERMS } from "@northstar/contracts";
import { type ArchitectureRepository, type DataPlatform, dataPlatform } from "../platform/data";
import { type ModelBindings, serverHost } from "../platform/models";

export type ArchEnv = ModelBindings & {
  /** D1 on Cloudflare; absent on Google Cloud, which sets DATA instead (ADR-018). */
  APP_DB?: D1Database;
  DATA?: DataPlatform;
  ENVIRONMENT?: string;
  /** "google-cloud" on the GCP host; unset on Cloudflare (ADR-018). */
  HOST?: string;
  ASSETS?: Fetcher;
  DISABLED_AGENTS?: string;
  ARCH_TOKEN_SECRET?: string;
  /** Workers AI, which the agents run on. */
  AI?: Ai;
  AI_GATEWAY_ID?: string;
  /** "scripted" only in the hermetic worker tests; see scripted-model.ts. */
  AGENT_MODEL?: string;
  /**
   * Champions by task class, as JSON (for example {"orchestrate": "@cf/openai/gpt-oss-20b"}), to
   * run a catalog model in place of the ADR-009 champion. A model outside the catalog is ignored.
   */
  AGENT_CHAMPIONS?: string;
};

/** What signs people in on this host, for the identity chain's first hop. */
export const signInName = (env: { HOST?: string }) => HOST_TERMS[serverHost(env)].signIn;

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
  store: ArchitectureRepository;
  user: { subject: string; persona: Persona; brands: readonly Brand[] | "all" };
  correlationId: string;
  now: () => Date;
  /** The AI platform the request chose in the top bar; the server's default when unset (ADR-021). */
  aiPlatform?: AiPlatformId | undefined;
};

export function makeCtx(
  env: ArchEnv,
  user: Ctx["user"],
  correlationId: string,
  now: () => Date = () => new Date(),
  aiPlatform?: AiPlatformId,
): Ctx {
  return {
    env,
    store: dataPlatform(env).architecture(user.subject),
    user,
    correlationId,
    now,
    ...(aiPlatform ? { aiPlatform } : {}),
  };
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

/** Policies a system outside the registry adds, such as the campaign team's. */
export type ExtraPolicies = (overrides: AgentOverrides) => readonly Policy[];

const BASE = "registry";
const builtSets = new Map<string, PolicySet>();
const extraIds = new WeakMap<ExtraPolicies, string>();
let extraCount = 0;

/**
 * The policies in force for this user's request: the registry's, with the operator's overrides,
 * plus any a caller adds. Built once per process for each set of overrides, so the gateway also
 * parses each into Cedar once.
 */
export async function policiesFor(ctx: Ctx, extraPolicies?: ExtraPolicies): Promise<PolicySet> {
  const overrides = await overridesFor(ctx);
  if (extraPolicies && !extraIds.has(extraPolicies)) {
    extraCount += 1;
    extraIds.set(extraPolicies, `extra-${extraCount}`);
  }
  const key = `${extraPolicies ? extraIds.get(extraPolicies) : BASE}:${JSON.stringify(overrides)}`;
  let set = builtSets.get(key);
  if (!set) {
    if (builtSets.size >= 64) builtSets.clear();
    set = mergePolicies(buildPolicies(overrides), extraPolicies?.(overrides) ?? []);
    builtSets.set(key, set);
  }
  return set;
}

/**
 * The only path to an architecture capability. It evaluates the policies (default-deny), logs the
 * decision, mints and verifies a per-invocation token, and only then runs the capability.
 */
export async function invoke<T>(
  ctx: Ctx,
  request: Omit<GatewayRequest, "user">,
  run: () => Promise<T> | T,
  options: { extraPolicies?: ExtraPolicies } = {},
): Promise<Invoked<T>> {
  const started = Date.now();
  const full: GatewayRequest = { ...request, user: ctx.user };
  const decision = evaluate(await policiesFor(ctx, options.extraPolicies), full);
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
      chain: identityChain(full, decision, { tokenVerified: false, signIn: signInName(ctx.env) }),
    });
  }
  const secret = tokenSecret(ctx.env);
  const token = await mintAgentToken(secret, full);
  await verifyAgentToken(secret, token, { action: request.action, user: ctx.user.subject });
  const value = await run();
  await log(Date.now() - started);
  return {
    value,
    decision,
    chain: identityChain(full, decision, { tokenVerified: true, signIn: signInName(ctx.env) }),
  };
}

const scopeUser = (subject: string, scope: WorkbenchScope): Ctx["user"] => ({
  subject,
  persona: scope.persona,
  brands: scope.brand === "all" ? "all" : [scope.brand],
});

/**
 * Authorizes a model-called orchestrator tool as `tool:<name>`, and logs the decision. `context`
 * is the turn's (scenario, intents, done): pass the same one given to chatToolsAllowed, so the
 * call is decided exactly as the offer was.
 */
export async function authorizeTool(
  env: ArchEnv,
  subject: string,
  toolName: string,
  correlationId: string,
  scope: WorkbenchScope = DEFAULT_SCOPE,
  context: GatewayContext = {},
): Promise<Decision> {
  const ctx = makeCtx(env, scopeUser(subject, scope), correlationId);
  const brand = toolBrand(toolName);
  try {
    const { decision } = await invoke(
      ctx,
      {
        principal: { type: "agent", id: "orchestrator" },
        action: `tool:${toolName}`,
        ...(brand ? { resource: { brand } } : {}),
        context: { surface: "chat", brand: scope.brand, ...context },
      },
      () => null,
    );
    return decision;
  } catch (error) {
    if (error instanceof ArchError && error.extra.decision) return error.extra.decision as Decision;
    throw error;
  }
}

/**
 * Which of the orchestrator's tools to offer the model this turn: exactly those authorizeTool
 * would allow with the same scope and context. Not logged; nothing was called.
 */
export async function chatToolsAllowed(
  env: ArchEnv,
  subject: string,
  toolNames: readonly string[],
  scope: WorkbenchScope = DEFAULT_SCOPE,
  context: GatewayContext = {},
): Promise<{ allowed: string[]; decisions: Record<string, Decision> }> {
  const ctx = makeCtx(env, scopeUser(subject, scope), "offer");
  const offer = await offerTools(ctx, {
    principal: { type: "agent", id: "orchestrator" },
    candidates: toolNames.map((name) => `tool:${name}`),
    context: { surface: "chat", brand: scope.brand, ...context },
  });
  return {
    allowed: offer.allowed.map((action) => action.slice("tool:".length)),
    decisions: Object.fromEntries(
      Object.entries(offer.decisions).map(([action, decision]) => [
        action.slice("tool:".length),
        decision,
      ]),
    ),
  };
}

/** What a principal may be offered among some gateway actions, decided as invoke decides calls. */
export async function offerTools(
  ctx: Ctx,
  input: {
    principal: Principal;
    candidates: readonly string[];
    context?: GatewayContext;
    resource?: GatewayRequest["resource"];
    extraPolicies?: ExtraPolicies;
  },
) {
  return toolsAllowed({
    policies: await policiesFor(ctx, input.extraPolicies),
    principal: input.principal,
    user: ctx.user,
    candidates: input.candidates,
    ...(input.context ? { context: input.context } : {}),
    ...(input.resource ? { resource: input.resource } : {}),
  });
}
