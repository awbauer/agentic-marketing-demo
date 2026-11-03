// Runs an architecture agent on a real model. The agent gets its catalog prompt (with its hard
// rules), the model the router binds to its task class, and only the tools its registry grants
// name. Every tool call passes the gateway; the services behind the tools enforce the rules.
import {
  type AgentManifest,
  type Brand,
  claimPacket,
  type GovernedObject,
  getObject,
  HARD_RULES,
  listObjects,
  MODEL_CATALOG,
  PERSONA_LABELS,
  type PromptEntry,
  planningInputs,
  promptById,
  renderPrompt,
  routeModel,
  successorOf,
  TASK_CLASSES,
  type TaskClass,
  type World,
} from "@northstar/architecture";
import { generateText, type LanguageModel, stepCountIs, streamText, wrapLanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { forcedToolCallMiddleware } from "../forced-tool-middleware";
import { objectView, type RunState, type ToolStep, toolsFor } from "./agent-tools";
import { type ArchEnv, ArchError, type Ctx } from "./context";
import { scriptedModel } from "./scripted-model";

export type ModelFactory = (modelId: string) => Exclude<LanguageModel, string>;

/**
 * Generation settings every architecture agent and the orchestrator use. Workers AI's default
 * output limit is small enough that gpt-oss can spend it all reasoning and stop mid-step; low
 * reasoning effort keeps each step quick, since the services do the checking.
 */
export const AGENT_GENERATION = {
  maxOutputTokens: 4096,
  providerOptions: { "workers-ai": { reasoning_effort: "low" } },
} as const;

/**
 * The models the agents run on: Workers AI through AI Gateway. `AGENT_MODEL=scripted` selects a
 * scripted stand-in that only the hermetic worker tests set; no deployed environment sets it.
 */
export function modelFactory(env: ArchEnv): ModelFactory {
  if (env.AGENT_MODEL === "scripted") return () => scriptedModel();
  const ai = env.AI;
  if (!ai)
    throw new ArchError(
      503,
      "NO_MODEL",
      "Workers AI is not bound here, so the agents cannot run. Run `pnpm dev:local` for local development with real models.",
    );
  const workersAI = createWorkersAI({
    binding: ai,
    ...(env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : {}),
  });
  return (modelId) => workersAI(modelId as Parameters<typeof workersAI>[0]);
}

/** Champion overrides from AGENT_CHAMPIONS, limited to catalog models that can call tools. */
export function championsFrom(env: ArchEnv): Partial<Record<TaskClass, string>> {
  try {
    const parsed = JSON.parse(env.AGENT_CHAMPIONS ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([task, model]) =>
          (TASK_CLASSES as readonly string[]).includes(task) &&
          MODEL_CATALOG.some((entry) => entry.id === model && entry.toolCalling),
      ),
    ) as Partial<Record<TaskClass, string>>;
  } catch {
    return {};
  }
}

/** The model an agent runs on now, and why. An agent whose task class has no tool-calling model reasons with the draft champion. */
export function modelFor(agent: AgentManifest, env: ArchEnv) {
  const champions = championsFrom(env);
  if (agent.taskClass === "none") return routeModel("draft", { champions });
  const route = routeModel(agent.taskClass, { champions });
  const entry = MODEL_CATALOG.find((model) => model.id === route.model);
  if (entry?.toolCalling) return route;
  const draft = routeModel("draft", { champions });
  return {
    ...draft,
    reason: `${agent.taskClass} binds ${route.model}, which cannot call tools, so the agent reasons with the draft champion.`,
  };
}

/** The action each agent's work centres on: the gateway checks it before the agent runs. */
export const PRIMARY_ACTION: Record<string, string> = {
  "content-plan": "plan_content",
  scenario: "run_scenario",
  brief: "draft_brief",
  reuse: "reuse_modules",
  "module-authoring": "author_module",
  atomization: "atomize_module",
  substantiation: "assemble_evidence",
  readiness: "propose_transition",
  attribution: "attribute_result",
  optimization: "propose_optimization",
  "data-readiness": "check_data_readiness",
  "adversarial-farm": "run_farm",
};

const list = (value: unknown) => (Array.isArray(value) ? value.map(String).join(", ") : "");

/** The task, in words, for an action and its inputs. The model also gets the inputs as JSON. */
export function taskFor(action: string, input: Record<string, unknown>): string {
  switch (action) {
    case "plan_content":
      return "Propose a content plan. Read the planning inputs first, then save a plan whose waves land on the calendar's dates and use the channels that performed, with a rationale for each wave.";
    case "run_scenario":
      return `Estimate the effect of this change to plan ${input.planUrn}: ${JSON.stringify(input.change)}. Then say plainly whether it helps.`;
    case "draft_brief":
      return `Draft a brief for wave ${input.waveId} of plan ${input.planUrn}. Write a one-sentence objective in your own words, saying what the content should achieve for its audience, and save the brief. An objective states no facts, so it cites no claim and needs no claims listed first.`;
    case "reuse_modules":
      return `Find existing modules worth reusing${input.briefUrn ? ` for brief ${input.briefUrn}` : ""}${input.query ? ` for "${input.query}"` : ""}. Say why the best ones fit and flag any that need a refresh.`;
    case "author_module":
      return `Write a ${input.channel ?? "email"} module for brief ${input.briefUrn}. The facts requested: ${list(input.topics)}. List the claims first, then write the module with those topics, a headline and one or two framing sentences in your own words. Say which requested facts were refused and why.`;
    case "atomize_module":
      return `Make ${list(input.channels) || "push and sms"} versions of module ${input.moduleUrn}, keeping every claim whole.`;
    case "assemble_evidence":
      return `Assemble the evidence for module ${input.moduleUrn} and say whether each claim is substantiated, and anything that is not.`;
    case "check_readiness":
      return `Check whether module ${input.moduleUrn} is ready for review, and list anything that blocks it.`;
    case "propose_transition":
      return `Check whether module ${input.moduleUrn} is ready for review, and submit it if it is. If it is blocked, do not submit it; list each blocker.`;
    case "run_farm":
      return `Red-team module ${input.moduleUrn}. Run the automatic probes, then read the module yourself and report anything they missed. Change nothing.`;
    case "attribute_result":
      return `Trace result ${input.resultUrn} to the module and claim that carried it, and explain what that means for the next plan.`;
    case "propose_optimization":
      return "Review the brand's performance signals and recommend what to re-issue, refresh or retire, and why. A person decides.";
    case "check_data_readiness":
      return "Score the inputs each lifecycle stage depends on, and say which stage is least ready and why.";
    default:
      throw new ArchError(400, "BAD_REQUEST", `No task is defined for ${action}.`);
  }
}

/** The catalog prompt with whatever the inputs bind; variables they don't bind point at the task. */
export function instructionsFor(prompt: PromptEntry, input: Record<string, unknown>, world: World) {
  const bindings: Record<string, string> = {};
  const source: Record<string, unknown> = {
    brand: input.brand,
    plan: input.planUrn,
    brief: input.briefUrn,
    module: input.moduleUrn,
    result: input.resultUrn,
    wave: input.waveId,
    change: (input.change as { type?: string } | undefined)?.type,
    channel: Array.isArray(input.channels) ? input.channels[0] : input.channel,
  };
  for (const variable of prompt.variables) {
    const value = source[variable.name];
    if (typeof value === "string" && value) bindings[variable.name] = value;
  }
  const unbound = prompt.variables.filter((variable) => !(variable.name in bindings));
  const template = unbound.reduce(
    (text, variable) =>
      text.replaceAll(
        `{{${variable.name}}}`,
        variable.kind === "urn"
          ? `the ${variable.objectKind} named in the task`
          : `the ${variable.name} named in the task`,
      ),
    prompt.template,
  );
  try {
    return renderPrompt(
      {
        ...prompt,
        template,
        variables: prompt.variables.filter((variable) => variable.name in bindings),
      },
      bindings,
      world,
    );
  } catch {
    // An input the catalog rejects (a urn of the wrong kind) is left for the tools to refuse.
    return `${template}\n\nHard rules (always enforced):\n${prompt.hardRules.map((id) => `- ${HARD_RULES[id]}`).join("\n")}`;
  }
}

export function systemFor(
  agent: AgentManifest,
  prompt: PromptEntry,
  instructions: string,
  ctx: Ctx,
  brand: Brand,
) {
  return [
    `You are the ${agent.name} in Northstar's marketing workbench (agent id: ${agent.id}), working for ${PERSONA_LABELS[ctx.user.persona]} on ${brand}. ${agent.summary}`,
    `Your instructions (prompt ${prompt.id}, version ${prompt.version}):\n${instructions}`,
    [
      "How to work:",
      "- Your tools are the only way to read or change anything. The gateway checks every call and may deny one; if it does, say so and stop that line of work.",
      "- Read before you write, and use urns exactly as they are given or returned.",
      "- If a tool returns an error, read it, change what it names, and try once more. Never repeat a call that failed unchanged.",
      "- When the task is done, reply in two to four plain sentences for a marketer: what you did, and what you refused or could not do, and why. No tables, no headings.",
    ].join("\n"),
  ].join("\n\n");
}

export type AgentRunOutput = {
  agentId: string;
  action: string;
  model: string;
  modelReason: string;
  /** The agent's own account of what it did. */
  summary: string;
  /** The output of the tool the action centres on, for screens that show it structurally. */
  result: unknown;
  steps: ToolStep[];
  created: Array<{ urn: string; title: string; kind: GovernedObject["kind"] }>;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
};

/**
 * What an agent would read before acting, given up front so its first call can be its real one.
 * The same services back the read tools, so the agent can still read again if it needs to.
 */
function backgroundFor(agentId: string, world: World, brand: Brand) {
  if (agentId === "module-authoring")
    return {
      label: "The brand's claims (only a substantiated one can be stated)",
      value: listObjects(world, { kind: "claim", brand })
        .filter((claim) => !successorOf(world, claim.urn))
        .map((claim) => {
          const packet = claimPacket(world, claim);
          return { topic: packet.topic, status: packet.status, text: packet.text };
        }),
    };
  if (agentId === "content-plan")
    return { label: "Planning inputs", value: planningInputs(world, brand) };
  return undefined;
}

/** The same call failed twice running: the agent is stuck, so stop rather than spin. */
function repeatedFailure(steps: readonly ToolStep[]) {
  const [before, last] = steps.slice(-2);
  return Boolean(
    before &&
      last &&
      !before.ok &&
      !last.ok &&
      before.tool === last.tool &&
      JSON.stringify(before.input) === JSON.stringify(last.input),
  );
}

/** Runs one agent on its model until it finishes or runs out of steps. */
export async function runModelAgent(
  ctx: Ctx,
  agent: AgentManifest,
  options: {
    action: string;
    input: Record<string, unknown>;
    brand: Brand;
    world: World;
    run: RunState;
    /** A task in the orchestrator's words, instead of the one the action implies. */
    task?: string;
    runTag?: string;
  },
): Promise<AgentRunOutput> {
  const prompt = agent.promptId ? promptById(agent.promptId) : undefined;
  if (!prompt) throw new ArchError(400, "BAD_REQUEST", `${agent.id} has no catalog prompt.`);
  const route = modelFor(agent, ctx.env);
  const model = modelFactory(ctx.env)(route.model);
  const started = Date.now();
  const tools = toolsFor({
    ctx,
    agent,
    brand: options.brand,
    run: options.run,
    ...(options.runTag ? { runTag: options.runTag } : {}),
    ...(Array.isArray(options.input.topics)
      ? { requestedTopics: options.input.topics.map(String) }
      : {}),
  });
  const task = options.task ?? taskFor(options.action, options.input);
  // The tool the action centres on. After a first step to read, the agent must call it: a model
  // can otherwise describe the work in prose without doing it.
  const primaryTool = options.action;
  const done = () => options.run.steps.some((step) => step.tool === primaryTool && step.ok);
  const system = systemFor(
    agent,
    prompt,
    instructionsFor(prompt, { brand: options.brand, ...options.input }, options.world),
    ctx,
    options.brand,
  );
  // The objects the inputs name, so the agent's first call is informed without a read step.
  const named = Object.entries(options.input)
    .filter(([key, value]) => key.endsWith("Urn") && typeof value === "string")
    .flatMap(([, urn]) => {
      const object = getObject(options.world, urn as string);
      return object && object.brand === options.brand ? [objectView(options.world, object)] : [];
    });
  const background = backgroundFor(agent.id, options.world, options.brand);
  const userPrompt = [
    task,
    named.length ? `The objects named in the input:\n${JSON.stringify(named)}` : "",
    background ? `${background.label}:\n${JSON.stringify(background.value)}` : "",
    `Input: ${JSON.stringify(options.input)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Until the action's own tool has succeeded, it is the tool to call: a model may otherwise
  // describe the work in prose, or bury the call in its reasoning, without doing it. If a forced
  // step yields no call at all (the model wanted to read something first), try once more letting it
  // call any tool; the next step is forced again.
  const attempt = async (loose: boolean) => {
    const result = streamText({
      model: wrapLanguageModel({ model, middleware: forcedToolCallMiddleware }),
      system,
      prompt: userPrompt,
      tools,
      stopWhen: [
        stepCountIs(8),
        () => repeatedFailure(options.run.steps),
        // Once the work is done, stop; only the red team goes on to report what it found itself.
        () => done() && agent.id !== "adversarial-farm",
      ],
      prepareStep: ({ stepNumber }) =>
        done() || !(primaryTool in tools)
          ? {}
          : loose && stepNumber === 0
            ? { toolChoice: "required" as const }
            : { toolChoice: { type: "tool" as const, toolName: primaryTool } },
      ...AGENT_GENERATION,
    });
    await result.consumeStream();
    return result;
  };
  let result = await attempt(false);
  let steps = await result.steps;
  if (
    !done() &&
    steps.every((step) => step.toolCalls.length === 0) &&
    options.run.steps.length === 0
  ) {
    result = await attempt(true);
    steps = await result.steps;
  }
  const [usage, messages] = await Promise.all([result.totalUsage, result.responseMessages]);
  // The account of the work comes from one plain call over what happened, without tools: streamed
  // text from the tool loop can arrive with words missing.
  const text = done()
    ? (
        await generateText({
          model,
          system,
          messages: [
            { role: "user", content: userPrompt },
            ...messages,
            {
              role: "user",
              content:
                "Now say what you did in two to four plain sentences for a marketer: what you did, and what was refused or could not be done, and why. Use only what the tool results show.",
            },
          ],
          ...AGENT_GENERATION,
        })
      ).text
    : "";
  // Calls the SDK rejected before they reached a tool (an input that fails the tool's schema, or a
  // tool that doesn't exist) never pass through the tools' own recording; record them too.
  for (const step of steps)
    for (const part of step.content)
      if (
        part.type === "tool-error" &&
        !options.run.steps.some((item) => item.error === String(part.error))
      )
        options.run.steps.push({
          tool: part.toolName,
          input: part.input,
          ok: false,
          error: part.error instanceof Error ? part.error.message : String(part.error),
        });
  const primary =
    options.action === "run_farm"
      ? [
          ...((options.run.outputs.run_farm as unknown[] | undefined) ?? []),
          ...options.run.findings.map((finding) => ({ ...finding, urn: options.input.moduleUrn })),
        ]
      : (options.run.outputs[options.action] ?? null);
  return {
    agentId: agent.id,
    action: options.action,
    model: route.model,
    modelReason: route.reason,
    // The agent's own words, unless it never did the work: then they can't be trusted to say so.
    summary: done()
      ? text.trim() || "The agent finished without a summary."
      : `The agent stopped without completing ${primaryTool.replaceAll("_", " ")}.${
          options.run.steps.at(-1)?.error
            ? ` Its last call failed: ${options.run.steps.at(-1)?.error}`
            : ""
        }`,
    result: primary,
    steps: options.run.steps,
    created: options.run.created.map((object) => ({
      urn: object.urn,
      title: object.title,
      kind: object.kind,
    })),
    usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
    latencyMs: Date.now() - started,
  };
}
