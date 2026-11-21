// A squad run: the brief, what each spoke has saved, and the event log every message and tool
// call lands on. The lead and the spokes share this state the way
// an agency shares a project folder; each agent still reaches it only through its tools.
import {
  buildTeamPolicies,
  type CampaignBrief,
  type CampaignStrategy,
  routeModel,
  TEAM_AGENTS,
  type TeamAgentId,
  type TeamAgentState,
  type TeamEvent,
  type TeamMessageKind,
  type TeamOutputs,
  type TeamParty,
  type TeamPlan,
  type TeamGate,
  TEAM_SPECIALISTS,
  TEAM_DIRECTOR,
  TEAM_PROVIDER_LABELS,
  TEAM_PROVIDERS,
  type TeamProvider,
  type TeamSpecialist,
  type TeamToolStep,
} from "@northstar/architecture";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { championsFrom, modelFactory } from "../architecture/agent-runtime";
import { ArchError, type Ctx, invoke } from "../architecture/context";
import { createOpenAI } from "@ai-sdk/openai";
import { anthropicModel, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { bindingCanFetch, GATEWAY_HELD_KEY, gatewayFetch } from "./gateway";
import { teamScriptedModel } from "./scripted";

export type Emit = (event: TeamEvent) => void;

export type Review = "pending" | "accepted" | "revising";

export type TeamRun = {
  id: string;
  ctx: Ctx;
  provider: TeamProvider;
  brief: CampaignBrief;
  emit: Emit;
  events: TeamEvent[];
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
): TeamRun {
  const run: TeamRun = {
    id: `team-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ctx,
    provider,
    brief,
    emit: () => undefined,
    events: [],
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
  /** Overrides claude-opus-5-5. */
  ANTHROPIC_TEAM_MODEL?: string;
  /** Overrides gpt-6-astra. */
  OPENAI_TEAM_MODEL?: string;
  /** An AI Gateway token, only needed if the AI binding cannot send vendor requests itself. */
  CF_AIG_TOKEN?: string;
};
const providerEnv = (ctx: Ctx) => ctx.env as Ctx["env"] & ProviderEnv;

export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";

/** The lead plans and judges, so it thinks harder; the spokes do bounded pieces of work. */
const effortFor = (agent: TeamAgentId) => (agent === TEAM_DIRECTOR ? "medium" : "low");

/** The model each team agent runs on, for a provider. */
export function teamModels(
  ctx: Ctx,
  provider: TeamProvider = "cloudflare",
): Record<TeamAgentId, string> {
  const env = providerEnv(ctx);
  const champions = championsFrom(ctx.env);
  return Object.fromEntries(
    TEAM_AGENTS.map((agent) => [
      agent.id,
      provider === "anthropic"
        ? (env.ANTHROPIC_TEAM_MODEL ?? DEFAULT_ANTHROPIC_MODEL)
        : provider === "openai"
          ? (env.OPENAI_TEAM_MODEL ?? DEFAULT_OPENAI_MODEL)
          : routeModel(agent.taskClass, { champions }).model,
    ]),
  ) as Record<TeamAgentId, string>;
}

/** Whether each provider can run here, and if not, why. All three need the AI Gateway. */
export function providerStatus(ctx: Ctx) {
  const env = providerEnv(ctx);
  const scripted = ctx.env.AGENT_MODEL === "scripted";
  const vendor = (): { available: boolean; reason?: string } => {
    if (scripted) return { available: true };
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
      scripted || ctx.env.AI
        ? { available: true }
        : { available: false, reason: "Workers AI is not bound here. Run pnpm dev:local." },
    anthropic: vendor(),
    openai: vendor(),
  };
  return TEAM_PROVIDERS.map((id) => ({
    id,
    label: TEAM_PROVIDER_LABELS[id],
    ...status[id],
    models: teamModels(ctx, id),
    gateway: ctx.env.AI_GATEWAY_ID ?? null,
    /** Vendor keys are the ones stored on the gateway; Workers AI needs none. */
    keys: id === "cloudflare" ? "none needed" : "stored on the AI Gateway",
  }));
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
  if (provider === "cloudflare") return modelFactory(ctx.env)(modelId);
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
    : openaiModel({ apiKey: GATEWAY_HELD_KEY, model: modelId, effort: effortFor(agent), fetch });
}

/** The gateway check for one team tool call, as `team:<tool>`, on the brief's brand. */
export async function authorizeTeam(ctx: Ctx, agent: TeamAgentId, tool: string, brand = "") {
  const { decision } = await invoke(
    ctx,
    {
      principal: { type: "agent", id: agent },
      action: `team:${tool}`,
      ...(brand ? { resource: { brand: brand as never } } : {}),
    },
    () => null,
    { extraPolicies: buildTeamPolicies },
  );
  return { decision: decision.decision, policyId: decision.policyId, reason: decision.reason };
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
): Promise<unknown> {
  let decision: TeamToolStep["decision"];
  try {
    decision = await authorizeTeam(run.ctx, agent, tool, run.brief.brand);
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

type V3Usage = { inputTokens?: { total?: number }; outputTokens?: { total?: number } } | undefined;
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
      outputTokens: usage?.outputTokens?.total ?? 0,
      latencyMs: Date.now() - started,
      ok,
    });
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
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
    wrapStream: async ({ doStream }) => {
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
export function explainModelError(error: unknown, provider: TeamProvider): Error {
  const message = error instanceof Error ? error.message : String(error);
  const detail = JSON.stringify((error as { error?: unknown })?.error ?? "");
  if (/2044|provider credentials are required/i.test(`${message} ${detail}`))
    return new Error(
      `The AI Gateway has no ${TEAM_PROVIDER_LABELS[provider]} key stored. Add one under AI Gateway → your gateway → Provider keys (alias "default"), then run again. Requests never carry a key, and Cloudflare-billed fallback is off.`,
    );
  if (/401|authentication|invalid x-api-key|incorrect api key/i.test(message))
    return new Error(
      `${TEAM_PROVIDER_LABELS[provider]} rejected the key stored on the AI Gateway: ${message}`,
    );
  return new Error(
    `${TEAM_PROVIDER_LABELS[provider]} call failed through the AI Gateway: ${message}`,
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
          openai: { ...params.providerOptions?.openai, reasoningEffort: options.effort },
        },
      }),
    },
  });
}
