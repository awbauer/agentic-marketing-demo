// A squad run: the brief, what each spoke has saved, and the event log every message and tool
// call lands on. The lead and the spokes share this state the way
// an agency shares a project folder; each agent still reaches it only through its tools.

import { createOpenAI } from "@ai-sdk/openai";
import {
  buildTeamPolicies,
  type CampaignBrief,
  type CampaignStrategy,
  type GatewayContext,
  type LifecycleState,
  newLifecycle,
  shortHash,
  TEAM_AGENTS,
  TEAM_PROVIDER_LABELS,
  TEAM_PROVIDERS,
  TEAM_SPECIALISTS,
  type TeamAgentId,
  type TeamAgentState,
  type TeamEvent,
  type TeamGate,
  type TeamMessageKind,
  type TeamMode,
  type TeamOutputs,
  type TeamParty,
  type TeamPlan,
  type TeamProvider,
  type TeamSpecialist,
  type TeamToolStep,
  teamProviderLabel,
} from "@northstar/architecture";
import type { HostId } from "@northstar/contracts";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { modelFactory } from "../architecture/agent-runtime";
import { ArchError, type Ctx, invoke, overridesFor } from "../architecture/context";
import { modelPlatform, serverHost } from "../platform/models";
import { anthropicModel, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { modelPrice } from "./evals";
import { bindingCanFetch, GATEWAY_HELD_KEY, gatewayFetch } from "./gateway";
import { teamScriptedModel } from "./scripted";

export type Emit = (event: TeamEvent) => void;

export type Review = "pending" | "accepted" | "revising";

export type TeamRun = {
  id: string;
  ctx: Ctx;
  provider: TeamProvider;
  mode: TeamMode;
  /** Where a lifecycle run is; null for a squad run. */
  lifecycle: LifecycleState | null;
  brief: CampaignBrief;
  emit: Emit;
  events: TeamEvent[];
  /** When each event this request emitted was sent (epoch ms), so a replay keeps the run's pacing. */
  stamps: number[];
  plan: TeamPlan | null;
  /** The latest version of each spoke's work, kept or not. */
  outputs: TeamOutputs;
  versions: Partial<Record<TeamSpecialist, number>>;
  reviews: Partial<Record<TeamSpecialist, Review>>;
  revisions: Partial<Record<TeamSpecialist, number>>;
  /** What each spoke told the lead with its latest work. */
  reports: Partial<Record<TeamSpecialist, string>>;
  strategy: CampaignStrategy | null;
  delivered: boolean;
  /** The person the run is waiting for, if any; the lead's loop stops until they decide. */
  waiting: TeamGate | null;
  /** What the lead told the person it is waiting for. */
  waitingWhy?: string;
  /** The client approved the proposal. */
  finished: boolean;
  /** The work versions reconciliation and the compliance approval each describe. */
  reconciledAt: string | null;
  complianceApproved: string | null;
  /** How many times the client sent the proposal back. */
  clientRounds: number;
  /** Send-backs per spoke at the last person's decision; the lead's limit counts from here. */
  revisionBase: Partial<Record<TeamSpecialist, number>>;
  tokens: number;
  started: number;
  messageCount: number;
};

export function newTeamRun(
  ctx: Ctx,
  brief: CampaignBrief,
  emitOut: Emit,
  provider: TeamProvider = "cloudflare",
  mode: TeamMode = "squad",
): TeamRun {
  const run: TeamRun = {
    id: `team-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ctx,
    provider,
    mode,
    lifecycle: mode === "lifecycle" ? newLifecycle() : null,
    brief,
    emit: () => undefined,
    events: [],
    stamps: [],
    plan: null,
    outputs: {},
    versions: {},
    reviews: {},
    revisions: {},
    reports: {},
    strategy: null,
    delivered: false,
    waiting: null,
    finished: false,
    reconciledAt: null,
    complianceApproved: null,
    clientRounds: 0,
    revisionBase: {},
    tokens: 0,
    started: Date.now(),
    messageCount: 0,
  };
  run.emit = (event) => {
    run.events.push(event);
    run.stamps.push(Date.now());
    emitOut(event);
  };
  return run;
}

/**
 * A saved run, rebuilt from its event log so the lead can carry on after a person decides. The
 * log is the record: every piece of state the run needs is derived from it, nothing else is saved.
 */
export function restoreTeamRun(
  ctx: Ctx,
  id: string,
  events: TeamEvent[],
  emitOut: Emit,
  provider: TeamProvider,
): TeamRun {
  const start = events.find((event) => event.type === "start");
  if (start?.type !== "start") throw new ArchError(409, "BROKEN_RUN", `Run ${id} has no start.`);
  const run = newTeamRun(ctx, start.brief, emitOut, provider);
  run.id = id;
  run.events = [...events];
  // The earlier events' times live in the run library; recordRun lines them up again.
  for (const event of events) {
    if (event.type === "plan") run.plan = event.plan;
    else if (event.type === "output") {
      (run.outputs as Record<string, unknown>)[event.agent] = event.output;
      run.versions[event.agent] = event.version;
      run.reviews[event.agent] = "pending";
    } else if (event.type === "review") {
      run.reviews[event.agent] = event.verdict === "accept" ? "accepted" : "revising";
      if (event.verdict === "revise")
        run.revisions[event.agent] = (run.revisions[event.agent] ?? 0) + 1;
    } else if (event.type === "message") {
      run.messageCount += 1;
      if (event.kind === "report" && isSpecialist(event.from)) run.reports[event.from] = event.text;
    } else if (event.type === "reconciled") {
      run.strategy = event.strategy;
      run.reconciledAt = JSON.stringify(run.versions);
    } else if (event.type === "delivered") run.delivered = true;
    else if (event.type === "decided") {
      run.revisionBase = { ...run.revisions };
      if (event.gate === "compliance" && event.decision === "approve")
        run.complianceApproved = JSON.stringify(run.versions);
      if (event.gate === "client" && event.decision === "changes") {
        run.clientRounds += 1;
        run.delivered = false;
      }
    } else if (event.type === "model") run.tokens += event.tokens;
  }
  return run;
}

const isSpecialist = (party: string): party is TeamSpecialist =>
  (TEAM_SPECIALISTS as readonly string[]).includes(party);

export function say(
  run: TeamRun,
  from: TeamParty,
  to: TeamParty,
  kind: TeamMessageKind,
  text: string,
) {
  run.messageCount += 1;
  run.emit({ type: "message", id: `m${run.messageCount}`, from, to, kind, text });
}

export const setStatus = (run: TeamRun, agent: TeamAgentId, state: TeamAgentState, note?: string) =>
  run.emit({ type: "status", agent, state, ...(note ? { note } : {}) });

/**
 * Settings for the Anthropic and OpenAI providers. No vendor key lives here: every request goes
 * through the AI Gateway named by AI_GATEWAY_ID, which supplies the key stored on it (BYOK).
 */
export type ProviderEnv = {
  /** The coordinator's model on Anthropic; overrides claude-opus-5-5. */
  ANTHROPIC_TEAM_MODEL?: string;
  /** The workers' model on Anthropic; overrides claude-sonnet-5-5. */
  ANTHROPIC_WORKER_MODEL?: string;
  /** The coordinator's model on OpenAI; overrides gpt-6-astra. */
  OPENAI_TEAM_MODEL?: string;
  /** The workers' model on OpenAI; overrides gpt-5.4-mini. */
  OPENAI_WORKER_MODEL?: string;
  /** The coordinators' model on Workers AI; overrides glm-5.3. */
  CLOUDFLARE_TEAM_MODEL?: string;
  /** The workers' model on Workers AI; overrides deepseek-v4.1-flash-1017. */
  CLOUDFLARE_WORKER_MODEL?: string;
  /** An AI Gateway token, only needed if the AI binding cannot send vendor requests itself. */
  CF_AIG_TOKEN?: string;
};
const providerEnv = (ctx: Ctx) => ctx.env as Ctx["env"] & ProviderEnv;

export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";

/**
 * Coordinators plan, judge and reconcile, so they get each provider's top model; workers do
 * bounded pieces of work checked by rules, so they get a smaller, cheaper one.
 */
export const MODEL_TIERS = {
  cloudflare: {
    coordinator: "@cf/zai-org/glm-5.3",
    worker: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  },
  anthropic: { coordinator: DEFAULT_ANTHROPIC_MODEL, worker: "claude-sonnet-5-5" },
  openai: { coordinator: DEFAULT_OPENAI_MODEL, worker: "gpt-5.4-mini" },
} as const satisfies Record<TeamProvider, { coordinator: string; worker: string }>;

/** Coordinators plan and judge, so they think harder; workers do bounded pieces of work. */
const effortFor = (agent: TeamAgentId) =>
  TEAM_AGENTS.find((item) => item.id === agent)?.tier === "coordinator" ? "medium" : "low";

/** The model each team agent runs on, for a provider: coordinators on the top tier, workers below. */
export function teamModels(
  ctx: Ctx,
  provider: TeamProvider = "cloudflare",
): Record<TeamAgentId, string> {
  const env = providerEnv(ctx);
  const tiers = {
    cloudflare: {
      coordinator: env.CLOUDFLARE_TEAM_MODEL ?? MODEL_TIERS.cloudflare.coordinator,
      worker: env.CLOUDFLARE_WORKER_MODEL ?? MODEL_TIERS.cloudflare.worker,
    },
    anthropic: {
      coordinator: env.ANTHROPIC_TEAM_MODEL ?? MODEL_TIERS.anthropic.coordinator,
      worker: env.ANTHROPIC_WORKER_MODEL ?? MODEL_TIERS.anthropic.worker,
    },
    openai: {
      coordinator: env.OPENAI_TEAM_MODEL ?? MODEL_TIERS.openai.coordinator,
      worker: env.OPENAI_WORKER_MODEL ?? MODEL_TIERS.openai.worker,
    },
  }[provider];
  // On Vertex the open-model tier is served by the models Vertex hosts; show those (ADR-018).
  const models = provider === "cloudflare" ? modelPlatform(ctx.env, ctx.aiPlatform) : null;
  const served = (id: string) => (models ? models.served(id) : id);
  return Object.fromEntries(
    TEAM_AGENTS.map((agent) => [
      agent.id,
      served(agent.tier === "coordinator" ? tiers.coordinator : tiers.worker),
    ]),
  ) as Record<TeamAgentId, string>;
}

/** Where a run on this provider runs its open-model tier: the top bar's AI platform (ADR-021). */
export function runAiPlatformFor(ctx: Ctx, provider: TeamProvider) {
  if (provider !== "cloudflare" || ctx.env.AGENT_MODEL === "scripted") return {};
  const kind = modelPlatform(ctx.env, ctx.aiPlatform)?.kind;
  return kind ? { aiPlatform: kind } : {};
}

/** Whether each provider can run here, and if not, why. All three need the AI Gateway. */
export function providerStatus(ctx: Ctx) {
  const env = providerEnv(ctx);
  const scripted = ctx.env.AGENT_MODEL === "scripted";
  const platform = modelPlatform(ctx.env);
  const vendor = (id: "anthropic" | "openai"): { available: boolean; reason?: string } => {
    if (scripted) return { available: true };
    if (platform?.vendor) {
      const route = platform.vendor(id, {});
      return "reason" in route ? { available: false, reason: route.reason } : { available: true };
    }
    if (!ctx.env.AI)
      return { available: false, reason: "The AI binding is not set here. Run pnpm dev:local." };
    if (!ctx.env.AI_GATEWAY_ID)
      return {
        available: false,
        reason: "Set AI_GATEWAY_ID: vendor requests only go through the AI Gateway.",
      };
    if (!bindingCanFetch(ctx.env.AI) && !env.CF_AIG_TOKEN)
      return {
        available: false,
        reason:
          "This AI binding cannot send vendor requests itself; set CF_AIG_TOKEN (an AI Gateway token).",
      };
    return { available: true };
  };
  const status: Record<TeamProvider, { available: boolean; reason?: string }> = {
    cloudflare:
      scripted || platform
        ? { available: true }
        : {
            available: false,
            reason:
              serverHost(ctx.env) === "google-cloud"
                ? "Vertex AI is not configured here. Set GCP_PROJECT and sign in to Google Cloud."
                : "Workers AI is not bound here. Run pnpm dev:local.",
          },
    anthropic: vendor("anthropic"),
    openai: vendor("openai"),
  };
  // The open-model tier runs on the AI platform chosen in the top bar; the vendors keep the
  // server's own route (the AI Gateway on Cloudflare, Claude on Vertex on Google Cloud).
  const chosen = modelPlatform(ctx.env, ctx.aiPlatform) ?? platform;
  return TEAM_PROVIDERS.map((id) => {
    const vertex = (id === "cloudflare" ? chosen : platform)?.kind === "vertex";
    return {
      id,
      label: teamProviderLabel(id, vertex ? "google-cloud" : "cloudflare"),
      ...status[id],
      models: teamModels(ctx, id),
      gateway: vertex ? null : (ctx.env.AI_GATEWAY_ID ?? null),
      /** Vendor keys are the ones stored on the gateway; Workers AI needs none. Vertex uses IAM. */
      keys: vertex
        ? serverHost(ctx.env) === "google-cloud"
          ? "none needed (Google Cloud IAM)"
          : "none stored (Workload Identity Federation)"
        : id === "cloudflare"
          ? "none needed"
          : "stored on the AI Gateway",
    };
  });
}

/** Refuses a provider that can't run here, before anything streams. */
export function assertProvider(ctx: Ctx, provider: TeamProvider) {
  const status = providerStatus(ctx).find((item) => item.id === provider);
  if (!status?.available)
    throw new ArchError(
      400,
      "PROVIDER_UNAVAILABLE",
      `${TEAM_PROVIDER_LABELS[provider]} is not available: ${status?.reason}`,
    );
}

/**
 * The model behind one agent on a run's provider. Every vendor request goes through the AI
 * Gateway, labelled with the run and the agent. The hermetic worker tests use a scripted stand-in
 * for every provider; nothing deployed sets AGENT_MODEL.
 */
export function teamModel(
  run: Pick<TeamRun, "ctx" | "provider" | "id">,
  agent: TeamAgentId,
): Exclude<LanguageModel, string> {
  const { ctx, provider } = run;
  if (ctx.env.AGENT_MODEL === "scripted") return teamScriptedModel();
  const modelId = teamModels(ctx, provider)[agent];
  if (provider === "cloudflare") return modelFactory(ctx.env, ctx.aiPlatform)(modelId);
  const platform = modelPlatform(ctx.env);
  if (platform?.vendor) {
    const route = platform.vendor(provider, { run: run.id, agent });
    if ("reason" in route) throw new ArchError(503, "PROVIDER_UNAVAILABLE", route.reason);
    return provider === "anthropic"
      ? anthropicModel({
          apiKey: GATEWAY_HELD_KEY,
          model: modelId,
          effort: effortFor(agent),
          fetch: route.fetch,
        })
      : openaiModel({
          apiKey: GATEWAY_HELD_KEY,
          model: modelId,
          effort: effortFor(agent),
          fetch: route.fetch,
          promptCacheKey: `${run.id}:${agent}`,
        });
  }
  const env = providerEnv(ctx);
  if (!ctx.env.AI || !ctx.env.AI_GATEWAY_ID)
    throw new ArchError(503, "NO_GATEWAY", "Vendor models run only through the AI Gateway.");
  const fetch = gatewayFetch({
    ai: ctx.env.AI,
    gatewayId: ctx.env.AI_GATEWAY_ID,
    ...(env.CF_AIG_TOKEN ? { token: env.CF_AIG_TOKEN } : {}),
    metadata: { app: "northstar-campaign-squad", run: run.id, agent },
  });
  return provider === "anthropic"
    ? anthropicModel({ apiKey: GATEWAY_HELD_KEY, model: modelId, effort: effortFor(agent), fetch })
    : openaiModel({
        apiKey: GATEWAY_HELD_KEY,
        model: modelId,
        effort: effortFor(agent),
        fetch,
        // One cache key per agent per run: each agent's calls share a growing prefix, so OpenAI
        // routes them to the same cache. Anthropic requests cache with top-level cache_control.
        promptCacheKey: `${run.id}:${agent}`,
      });
}

/**
 * The team policy set's version: a hash of every policy the gateway evaluates for the squad, with
 * the operators' current kill switches and lifecycle constraints. A change to any of them is a new
 * version, so each decision can be traced to the exact rules that made it.
 */
export async function teamPolicyVersion(ctx: Ctx): Promise<string> {
  return `pol-${shortHash(JSON.stringify(buildTeamPolicies(await overridesFor(ctx))))}`;
}

/**
 * The gateway check for one team tool call, as `team:<tool>`, on the brief's brand, in the
 * context the tool was offered in (a squad spoke's work, or a lifecycle step).
 */
export async function authorizeTeam(
  ctx: Ctx,
  agent: TeamAgentId,
  tool: string,
  brand = "",
  context: GatewayContext = {},
) {
  const { decision } = await invoke(
    ctx,
    {
      principal: { type: "agent", id: agent },
      action: `team:${tool}`,
      ...(brand ? { resource: { brand: brand as never } } : {}),
      context: { surface: "team", ...context },
    },
    () => null,
    { extraPolicies: buildTeamPolicies },
  );
  return {
    decision: decision.decision,
    policyId: decision.policyId,
    reason: decision.reason,
    policyVersion: await teamPolicyVersion(ctx),
  };
}

/**
 * Runs a tool body behind the gateway and records the call. A denial or a refusal comes back to
 * the model as an error it can read; it never throws through the model's loop.
 */
export async function gated(
  run: TeamRun,
  agent: TeamAgentId,
  tool: string,
  input: unknown,
  body: () => Promise<unknown> | unknown,
  context: GatewayContext = {},
): Promise<unknown> {
  let decision: TeamToolStep["decision"];
  try {
    decision = await authorizeTeam(run.ctx, agent, tool, run.brief.brand, context);
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    const extra = failure instanceof ArchError ? failure.extra.decision : undefined;
    const step: TeamToolStep = {
      tool,
      input,
      ok: false,
      error: `The gateway denied this: ${reason}`,
      ...(extra ? { decision: extra as TeamToolStep["decision"] } : {}),
    };
    run.emit({ type: "tool", agent, step });
    return { error: `${step.error} That is policy; do not retry it.` };
  }
  try {
    const output = await body();
    const refused =
      output && typeof output === "object" && "error" in (output as Record<string, unknown>);
    const step: TeamToolStep = {
      tool,
      input,
      ok: !refused,
      ...(decision ? { decision } : {}),
      ...(refused
        ? { error: String((output as { error: unknown }).error) }
        : { output: compact(output) }),
    };
    run.emit({ type: "tool", agent, step });
    return output;
  } catch (failure) {
    const error = failure instanceof Error ? failure.message : String(failure);
    run.emit({
      type: "tool",
      agent,
      step: { tool, input, ok: false, error, ...(decision ? { decision } : {}) },
    });
    return { error };
  }
}

/** A value small enough for the event stream. */
export function compact(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= 4000 ? value : `${text.slice(0, 4000)}…`;
}

export const addUsage = (run: TeamRun, usage: { inputTokens?: number; outputTokens?: number }) => {
  run.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
};

type V3Usage =
  | { inputTokens?: { total?: number; cacheRead?: number }; outputTokens?: { total?: number } }
  | undefined;
const total = (usage: V3Usage) =>
  (usage?.inputTokens?.total ?? 0) + (usage?.outputTokens?.total ?? 0);

/**
 * Meters every call to a model: which agent made it, on which model, for what, how many tokens and
 * how long it took. The page's infrastructure panel is built from these records.
 */
export function metered(
  run: TeamRun,
  agent: TeamAgentId,
  purpose: "lead" | "work" | "answer" | "report",
  model: Exclude<LanguageModel, string>,
): Exclude<LanguageModel, string> {
  const name = teamModels(run.ctx, run.provider)[agent];
  const record = (started: number, usage: V3Usage, ok: boolean) =>
    run.emit({
      type: "model",
      agent,
      model: name,
      purpose,
      tokens: total(usage),
      inputTokens: usage?.inputTokens?.total ?? 0,
      cachedInputTokens: usage?.inputTokens?.cacheRead ?? 0,
      outputTokens: usage?.outputTokens?.total ?? 0,
      latencyMs: Date.now() - started,
      ok,
    });
  // The prompt and settings this agent actually sent, once per distinct system prompt, so the
  // page can show each agent's real configuration (and a replay carries it).
  const describe = (
    params: Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"],
  ) => {
    const system = params.prompt
      .flatMap((message) => (message.role === "system" ? [message.content] : []))
      .join("\n\n");
    const seen = run.events.some(
      (event) =>
        event.type === "prompt" &&
        event.agent === agent &&
        event.purpose === purpose &&
        event.system === system,
    );
    if (seen) return;
    const choice = params.toolChoice;
    const tools = (params.tools ?? []).map((item) => item.name);
    run.emit({
      type: "prompt",
      agent,
      purpose,
      model: name,
      provider: run.provider,
      system,
      tools,
      version: `pr-${shortHash(JSON.stringify({ system, tools, choice: choice ?? null, temperature: params.temperature ?? null, maxOutputTokens: params.maxOutputTokens ?? null }))}`,
      ...(choice
        ? { toolChoice: choice.type === "tool" ? `tool: ${choice.toolName}` : choice.type }
        : {}),
      settings: {
        ...(run.provider === "anthropic" ? { effort: effortFor(agent) } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.maxOutputTokens !== undefined
          ? { maxOutputTokens: params.maxOutputTokens }
          : {}),
      },
      price: modelPrice(name),
    });
  };
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      describe(params);
      const started = Date.now();
      try {
        const result = await doGenerate();
        record(started, result.usage as V3Usage, true);
        return result;
      } catch (error) {
        record(started, undefined, false);
        throw error;
      }
    },
    wrapStream: async ({ doStream, params }) => {
      describe(params);
      const started = Date.now();
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        record(started, undefined, false);
        throw error;
      }
      let usage: V3Usage;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "finish") usage = part.usage as V3Usage;
              controller.enqueue(part);
            },
            flush() {
              record(started, usage, true);
            },
          }),
        ),
      };
    },
  };
  return wrapLanguageModel({ model, middleware });
}

/**
 * A provider or gateway failure in words a person can act on. The most likely one when switching
 * to a vendor is a missing stored key: the gateway answers 2044 because requests never carry one.
 */
export function explainModelError(
  error: unknown,
  provider: TeamProvider,
  host: HostId = "cloudflare",
): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (host === "google-cloud") {
    const label = teamProviderLabel(provider, host);
    if (/\b404\b|not found or your project does not have access/i.test(message))
      return new Error(
        `${label} is not enabled for this project. Enable the model in Vertex AI Model Garden, then run again.`,
      );
    return new Error(`${label} call failed on Vertex AI: ${message}`);
  }
  const detail = JSON.stringify((error as { error?: unknown })?.error ?? "");
  if (/2044|provider credentials are required/i.test(`${message} ${detail}`))
    return new Error(
      `The AI Gateway has no ${TEAM_PROVIDER_LABELS[provider]} key stored. Add one under AI Gateway → your gateway → Provider keys (alias "default"), then run again. Requests never carry a key, and Cloudflare-billed fallback is off.`,
    );
  if (/401|authentication|invalid x-api-key|incorrect api key/i.test(message))
    return new Error(
      `${TEAM_PROVIDER_LABELS[provider]} rejected the key stored on the AI Gateway: ${message}`,
    );
  const body = String((error as { responseBody?: unknown })?.responseBody ?? "").slice(0, 400);
  return new Error(
    `${TEAM_PROVIDER_LABELS[provider]} call failed through the AI Gateway: ${message}${body ? ` (${body})` : ""}`,
  );
}

/** True for the SDK error a model raises when it won't make the call a step requires. */
export const isToolChoiceViolation = (error: unknown) =>
  error instanceof Error &&
  /ToolChoiceViolation|did not contain a call to the required tool/.test(
    `${error.name} ${error.message}`,
  );

/** An OpenAI model on the Responses API, with the agent's reasoning effort on every call. */
export function openaiModel(options: {
  apiKey: string;
  model: string;
  effort: "low" | "medium";
  baseURL?: string;
  fetch?: typeof fetch;
  promptCacheKey?: string;
}): Exclude<LanguageModel, string> {
  const openai = createOpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return wrapLanguageModel({
    model: openai.responses(options.model),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            reasoningEffort: options.effort,
            ...(options.promptCacheKey ? { promptCacheKey: options.promptCacheKey } : {}),
          },
        },
      }),
    },
  });
}
