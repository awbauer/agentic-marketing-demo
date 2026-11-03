// The orchestrator: a model that plans a sample flow's goal and delegates each step to the subagent
// that owns it. It writes no content and decides nothing a person must decide; when a module is
// submitted for review it asks the person and stops, and resumes once they have decided.
import {
  agentById,
  CHANNELS,
  type FlowEvent,
  getObject,
  HARD_RULES,
  PERSONA_LABELS,
  routeModel,
  sampleGoalById,
} from "@northstar/architecture";
import { type ModelMessage, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { z } from "zod";
import { forcedToolCallMiddleware } from "../forced-tool-middleware";
import { AGENT_GENERATION, championsFrom, modelFactory, PRIMARY_ACTION } from "./agent-runtime";
import { ArchError, type Ctx } from "./context";
import { ISO, worldFor } from "./objects";
import { runAgentOp } from "./ops";

type Emit = (event: FlowEvent) => void;

const DELEGABLE = Object.keys(PRIMARY_ACTION) as [string, ...string[]];

/** When to use each subagent, and what it needs in refs, for the orchestrator's catalog. */
const CATALOG: Record<string, { use: string; needs: string }> = {
  "content-plan": {
    use: "a new content plan from the calendar and past results",
    needs: "nothing",
  },
  scenario: {
    use: "what-if questions about a plan, such as moving a send",
    needs: "planUrn and change {type: move-send, waveId, days (negative is earlier)}",
  },
  brief: { use: "a brief for one wave of an approved plan", needs: "planUrn and waveId" },
  reuse: { use: "finding existing modules to reuse", needs: "briefUrn or query" },
  "module-authoring": {
    use: "writing a new module from approved claims (it refuses unsupported ones and records gaps)",
    needs: "briefUrn, topics (claim topics, as given in the goal) and channel",
  },
  atomization: { use: "channel versions of a module", needs: "moduleUrn and channels" },
  "adversarial-farm": {
    use: "red-teaming a draft module, before it is submitted",
    needs: "moduleUrn",
  },
  substantiation: { use: "the evidence packet for a module's claims", needs: "moduleUrn" },
  readiness: {
    use: "submitting a module for review; it submits only if nothing blocks it",
    needs: "moduleUrn",
  },
  attribution: {
    use: "tracing a result to the module and claim that carried it",
    needs: "resultUrn",
  },
  optimization: {
    use: "what past results suggest doing next: re-issue, refresh or retire",
    needs: "nothing",
  },
  "data-readiness": {
    use: "scoring whether each lifecycle stage's inputs are ready (not for results questions)",
    needs: "nothing",
  },
};

function systemFor(brand: string) {
  const orchestrator = agentById("orchestrator");
  const catalog = DELEGABLE.map((id) => {
    const agent = agentById(id);
    return `- ${id} (${agent?.name}): use for ${CATALOG[id]?.use}. Needs: ${CATALOG[id]?.needs}.`;
  }).join("\n");
  return [
    `You are the ${orchestrator?.name ?? "Marketing orchestrator"} (agent id: orchestrator) for ${brand} in Northstar's marketing workbench. You plan the work toward a goal and delegate each step to the subagent that owns it. You never write content, and you never approve anything.`,
    `Your subagents:\n${catalog}`,
    [
      "How to work:",
      "- Act only through next_step. Delegate one step at a time, and read each result before choosing the next step.",
      "- Put every urn, wave, topic and channel a subagent needs in refs. For something a subagent created, use its ref (such as module-1); for anything else, copy the urn from the goal exactly.",
      "- A subagent may refuse part of a request, find a problem, or be denied by the gateway. Say so in a short note and adapt; never work around a refusal or a block.",
      "- For new content the usual order is: brief, write the module, red-team it, assemble its evidence, then submit it with readiness. Skip a step only if the goal says so.",
      "- When a module has been submitted for review, take next_step with kind ask_person for it. Only a person approves.",
      "- After the person has decided, finish whatever the goal asks for next.",
      "- In why, say what you are about to do and why, in one short sentence for the marketer.",
      "- When everything the goal asks for is done, take next_step with kind finish, and a summary of three to five plain sentences for the marketer: what happened, what each subagent refused or was blocked from, and what a person decided. Say only what the results show.",
    ].join("\n"),
    `Hard rules (always enforced):\n${Object.values(HARD_RULES)
      .map((rule) => `- ${rule}`)
      .join("\n")}`,
  ].join("\n\n");
}

/** A result small enough to hand back to the orchestrator. */
function compact(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= 3000 ? value : `${text.slice(0, 3000)}…`;
}

type State = {
  id: string;
  flowId: string;
  brand: string;
  messages: ModelMessage[];
  events: FlowEvent[];
};

async function drive(ctx: Ctx, state: State, emitOut: Emit) {
  const emit: Emit = (event) => {
    state.events.push(event);
    emitOut(event);
  };
  const route = routeModel("orchestrate", { champions: championsFrom(ctx.env) });
  const model = modelFactory(ctx.env)(route.model);
  let paused: { moduleUrn: string } | null = null;
  let finished: string | null = null;
  const brand = state.brand;

  // Short handles for what this flow created (brief-1, module-1), so the orchestrator never has to
  // copy a long urn. Rebuilt from the saved events when a flow resumes.
  const handles = new Map<string, string>();
  for (const event of state.events)
    if (event.type === "delegated")
      for (const item of event.created ?? []) handles.set(item.ref, item.urn);
  const nameAll = (created: Array<{ urn: string; title: string; kind: string }>) =>
    created.map((item) => {
      const count = [...handles.keys()].filter((key) => key.startsWith(`${item.kind}-`)).length;
      const ref = `${item.kind}-${count + 1}`;
      handles.set(ref, item.urn);
      return { ref, ...item };
    });
  /** A handle, a urn, or a urn the model cut short that matches one object this flow created. */
  const resolve = (value: string) => {
    const known = handles.get(value);
    if (known) return known;
    const urn = value.startsWith("northstar:") ? `urn:${value}` : value;
    const matches = [...handles.values()].filter((item) => item.startsWith(urn));
    return matches.length === 1 ? (matches[0] as string) : urn;
  };
  const resolveAll = (refs: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(refs).map(([key, value]) => [
        key,
        typeof value === "string" && key.endsWith("Urn") ? resolve(value) : value,
      ]),
    );

  async function delegate(
    callId: string,
    agent: string,
    task: string,
    given: Record<string, unknown>,
  ): Promise<unknown> {
    const manifest = agentById(agent);
    const refs = resolveAll(given);
    // A subagent acts for the person who owns its step. Platform agents are owned by Admin;
    // they act for whoever started the flow instead, so a flow never takes on Admin.
    const owner = manifest?.owner && manifest.owner !== "admin" ? manifest.owner : ctx.user.persona;
    emit({
      type: "delegate",
      callId,
      agent,
      name: manifest?.name ?? agent,
      persona: owner,
      task,
      refs,
    });
    // The subagent acts for the person who owns its step, on this flow's brand only.
    const delegated: Ctx = {
      ...ctx,
      user: { ...ctx.user, persona: owner, brands: [brand as never] },
    };
    try {
      const out = await runAgentOp(
        delegated,
        agent,
        PRIMARY_ACTION[agent] as string,
        { ...refs, brand },
        {
          task,
          runTag: state.id,
          onStep: (step) => emit({ type: "tool", callId, agent, step }),
        },
      );
      const created = nameAll(out.created);
      emit({
        type: "delegated",
        callId,
        agent,
        ok: true,
        summary: out.summary,
        model: out.model,
        created,
        result: compact(out.result),
        latencyMs: out.latencyMs,
        tokens: out.usage.inputTokens + out.usage.outputTokens,
      });
      return {
        summary: out.summary,
        created: created.map(({ ref, title, kind }) => ({ ref, kind, title })),
        note: created.length
          ? `Refer to what was created by its ref (${created.map((item) => item.ref).join(", ")}).`
          : undefined,
        result: compact(out.result),
      };
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : String(failure);
      emit({ type: "delegated", callId, agent, ok: false, error });
      return {
        error: `${error} Check the refs: copy urns exactly from the goal or an earlier result.`,
      };
    }
  }

  async function askPerson(moduleUrn: string, why: string): Promise<unknown> {
    const module = getObject(await worldFor(ctx), moduleUrn);
    if (module?.kind !== "module") return { error: `${moduleUrn} is not a module.` };
    if (module.approvalState !== "submitted")
      return {
        error: `It is ${module.approvalState}, not submitted. Only a submitted module goes to a person.`,
      };
    paused = { moduleUrn };
    emit({ type: "await-human", moduleUrn, title: module.title, why, persona: "reviewer" });
    return { waiting: true, note: "A person is deciding. Stop here." };
  }

  // One tool, forced on every step: a model that buries its call in its reasoning can still be
  // understood, which is not possible when it may choose among several tools.
  const tools = {
    next_step: tool({
      description:
        "Take the next step. kind delegate: hand one step to a subagent (give agent, task and refs; a ref such as module-1 works wherever a urn is asked for). kind ask_person: ask a person to decide on a module submitted for review (give moduleUrn, or its ref); the flow waits for them. kind finish: everything the goal asks for is done (give summary). Always give why.",
      inputSchema: z.object({
        kind: z.enum(["delegate", "ask_person", "finish"]),
        why: z.string().min(5),
        agent: z.enum(DELEGABLE).optional(),
        task: z.string().optional(),
        refs: z
          .object({
            planUrn: z.string(),
            waveId: z.string(),
            briefUrn: z.string(),
            moduleUrn: z.string(),
            resultUrn: z.string(),
            topics: z.array(z.string()),
            channel: z.enum(CHANNELS),
            channels: z.array(z.enum(CHANNELS)),
            query: z.string(),
            change: z.object({
              type: z.enum(["move-send", "drop-channel", "change-audience"]),
              waveId: z.string().optional(),
              days: z.number().optional(),
              channel: z.enum(CHANNELS).optional(),
              segment: z.string().optional(),
              audienceSize: z.number().optional(),
            }),
          })
          .partial()
          .optional(),
        moduleUrn: z.string().optional(),
        summary: z.string().optional(),
      }),
      execute: async (input, { toolCallId }) => {
        if (input.kind === "finish") {
          if (!input.summary?.trim()) return { error: "Give the summary for the marketer." };
          finished = input.summary;
          return { finished: true };
        }
        // A retried step repeats its reason; show it once.
        const last = [...state.events].reverse().find((event) => event.type === "note");
        if (last?.type !== "note" || last.text !== input.why)
          emit({ type: "note", text: input.why });
        if (input.kind === "ask_person") {
          const urn = input.moduleUrn ?? input.refs?.moduleUrn;
          if (!urn) return { error: "Give the moduleUrn the person should decide on." };
          return askPerson(resolve(urn), input.why);
        }
        if (!input.agent || !input.task) return { error: "Give the agent and the task." };
        return delegate(toolCallId, input.agent, input.task, input.refs ?? {});
      },
    }),
  };

  // A turn ends when the orchestrator asks a person or finishes. A step that ends without a call
  // the middleware can recover gets a reminder, up to twice.
  for (let attempt = 0; attempt < 3 && !paused && !finished; attempt += 1) {
    if (attempt > 0)
      state.messages.push({
        role: "user",
        content:
          "Continue the goal with next_step: delegate the next step, ask a person to decide, or finish.",
      });
    const result = streamText({
      model: wrapLanguageModel({ model, middleware: forcedToolCallMiddleware }),
      system: systemFor(brand),
      messages: state.messages,
      tools,
      toolChoice: { type: "tool", toolName: "next_step" },
      stopWhen: [stepCountIs(16), () => Boolean(paused || finished)],
      ...AGENT_GENERATION,
    });
    await result.consumeStream();
    state.messages.push(...(await result.responseMessages));
  }
  const waiting = paused as { moduleUrn: string } | null;
  const summary = finished as string | null;
  if (!waiting)
    emit({
      type: "done",
      summary: summary ?? "The orchestrator stopped before finishing the goal.",
    });
  await ctx.store.saveOrchestration({
    id: state.id,
    flowId: state.flowId,
    brand,
    status: waiting ? "waiting" : "done",
    waitingOn: waiting?.moduleUrn ?? null,
    messages: state.messages,
    events: state.events,
    at: ISO(ctx),
  });
}

/**
 * Starts a sample flow: the orchestrator receives the goal and works until it needs a person.
 * Validates before anything streams, so a bad request fails with its status; returns the work.
 */
export function startOrchestration(ctx: Ctx, flowId: string) {
  const goal = sampleGoalById(flowId);
  if (!goal) throw new ArchError(404, "NOT_FOUND", `No sample flow ${flowId}.`);
  const id = `flow-${Date.now().toString(36)}`;
  const route = routeModel("orchestrate", { champions: championsFrom(ctx.env) });
  const state: State = {
    id,
    flowId,
    brand: goal.brand,
    messages: [{ role: "user", content: `${goal.goal}\n\nInput: ${JSON.stringify({ flowId })}` }],
    events: [],
  };
  modelFactory(ctx.env);
  return async (emit: Emit) => {
    const event: FlowEvent = {
      type: "start",
      id,
      flowId,
      model: route.model,
      modelReason: route.reason,
    };
    state.events.push(event);
    emit(event);
    await drive(ctx, state, emit);
  };
}

/** Resumes a flow once the person has decided on the module it is waiting for. */
export async function continueOrchestration(ctx: Ctx, id: string) {
  const saved = await ctx.store.orchestration(id);
  if (!saved) throw new ArchError(404, "NOT_FOUND", `No flow ${id}.`);
  if (saved.status !== "waiting" || !saved.waitingOn)
    throw new ArchError(409, "NOT_WAITING", "This flow is not waiting for a decision.");
  const module = getObject(await worldFor(ctx), saved.waitingOn);
  const decided = module?.approvalState;
  if (!decided || ["submitted", "in_review"].includes(decided))
    throw new ArchError(409, "UNDECIDED", "The module is still waiting for a decision.");
  const event: FlowEvent = {
    type: "decided",
    moduleUrn: saved.waitingOn,
    state: decided,
    persona: PERSONA_LABELS.reviewer,
  };
  const state: State = {
    id,
    flowId: saved.flowId,
    brand: saved.brand,
    messages: [
      ...(saved.messages as ModelMessage[]),
      {
        role: "user",
        content: `The ${PERSONA_LABELS.reviewer} has decided: ${saved.waitingOn} is now ${decided}. Continue with the rest of the goal.`,
      },
    ],
    events: [...(saved.events as FlowEvent[]), event],
  };
  return async (emit: Emit) => {
    emit(event);
    await drive(ctx, state, emit);
  };
}

/** A saved flow, for a screen that reloads while one is waiting. */
export async function orchestrationOp(ctx: Ctx, id: string) {
  const saved = await ctx.store.orchestration(id);
  if (!saved) throw new ArchError(404, "NOT_FOUND", `No flow ${id}.`);
  return { id: saved.id, flowId: saved.flowId, status: saved.status, events: saved.events };
}

/** A response that streams flow events as newline-delimited JSON while the work runs. */
export function streamFlow(work: (emit: Emit) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit: Emit = (event) => {
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => undefined);
  };
  work(emit)
    .catch((failure) =>
      emit({
        type: "error",
        message: failure instanceof Error ? failure.message : String(failure),
      }),
    )
    .finally(() => writer.close().catch(() => undefined));
  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
