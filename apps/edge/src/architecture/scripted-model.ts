// A scripted stand-in for a language model, for the hermetic worker tests only. It is selected
// when AGENT_MODEL is "scripted", which only vitest.worker.config.ts sets; every deployed and local
// environment runs the agents on Workers AI. It calls each agent's real tools, so the gateway, the
// services and persistence are exercised exactly as a real model's calls would exercise them.
import type { LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

type Generate = Extract<
  NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>["doGenerate"],
  (...args: never[]) => unknown
>;
type Prompt = Parameters<Generate>[0]["prompt"];

type Done = Array<{ tool: string; output: Record<string, unknown> }>;
type Next = { tool: string; args: Record<string, unknown> } | { text: string };
type Input = Record<string, unknown> & { refs?: Record<string, unknown> };

const has = (done: Done, tool: string) => done.some((item) => item.tool === tool);
const last = (done: Done, tool: string) =>
  [...done].reverse().find((item) => item.tool === tool)?.output;
const step = (done: Done, tool: string, args: Record<string, unknown>, text: string): Next =>
  has(done, tool) ? { text } : { tool, args };

/** The next call each agent makes, given its inputs and what its tools have returned. */
const AGENTS: Record<string, (input: Input, done: Done) => Next> = {
  "content-plan": (_input, done) => {
    if (!has(done, "get_planning_inputs")) return { tool: "get_planning_inputs", args: {} };
    const inputs = last(done, "get_planning_inputs") as {
      today: string;
      calendar: Array<{ date: string; label: string }>;
    };
    const events = inputs.calendar.length
      ? inputs.calendar
      : [{ date: inputs.today, label: "Evergreen send" }];
    return step(
      done,
      "plan_content",
      {
        objective: "Reach the brand's audiences on the dates that matter.",
        waves: events.map((event) => ({
          theme: event.label,
          segment: "all-subscribers",
          audienceSize: 1000,
          channel: "email",
          sendOn: event.date,
          rationale: `${event.label} is on the calendar.`,
        })),
      },
      "Proposed a plan with one wave per calendar date.",
    );
  },
  scenario: (input, done) =>
    step(
      done,
      "run_scenario",
      { planUrn: input.planUrn, change: input.change },
      "Estimated the change.",
    ),
  brief: (input, done) =>
    step(
      done,
      "draft_brief",
      {
        planUrn: input.planUrn,
        waveId: input.waveId,
        objective: "Deliver this wave's message to its audience.",
      },
      "Drafted the brief from the plan.",
    ),
  reuse: (input, done) =>
    step(
      done,
      "reuse_modules",
      { briefUrn: input.briefUrn, query: input.query },
      "Ranked the modules.",
    ),
  "module-authoring": (input, done) => {
    if (!has(done, "list_claims")) return { tool: "list_claims", args: {} };
    return step(
      done,
      "author_module",
      {
        briefUrn: input.briefUrn,
        topics: input.topics ?? [],
        channel: input.channel ?? "email",
        headline: (input.headline as string | undefined) ?? "A note for you",
        framing: [],
      },
      "Wrote the module from approved claims and refused the rest.",
    );
  },
  atomization: (input, done) =>
    step(
      done,
      "atomize_module",
      { moduleUrn: input.moduleUrn, channels: input.channels ?? ["push", "sms"] },
      "Made the channel versions.",
    ),
  substantiation: (input, done) =>
    step(
      done,
      "assemble_evidence",
      { moduleUrn: input.moduleUrn },
      "Assembled the evidence packet.",
    ),
  readiness: (input, done) => {
    if (!has(done, "check_readiness"))
      return { tool: "check_readiness", args: { moduleUrn: input.moduleUrn } };
    const ready = (last(done, "check_readiness") as { ready?: boolean } | undefined)?.ready;
    if (!ready) return { text: "Not submitted: readiness blocks it." };
    return step(
      done,
      "propose_transition",
      { moduleUrn: input.moduleUrn },
      "Submitted it for review.",
    );
  },
  "adversarial-farm": (input, done) =>
    step(done, "run_farm", { moduleUrn: input.moduleUrn }, "Ran the probes."),
  attribution: (input, done) =>
    step(done, "attribute_result", { resultUrn: input.resultUrn }, "Traced the result."),
  optimization: (_input, done) => step(done, "propose_optimization", {}, "Reviewed the signals."),
  "data-readiness": (_input, done) => step(done, "check_data_readiness", {}, "Scored the inputs."),
};

type FlowStep = {
  agent: string;
  refs?: Record<string, unknown>;
  useBrief?: boolean;
  useModule?: boolean;
};

/** Each sample flow's steps, as the scripted orchestrator takes them. */
const FLOWS: Record<string, FlowStep[]> = {
  "lumera-congress": [
    { agent: "brief", refs: { planUrn: "urn:northstar:content-plan:lt-q4-hcp", waveId: "w1" } },
    {
      agent: "module-authoring",
      refs: { topics: ["cardivance-mortality", "cardivance-superior"], channel: "email" },
      useBrief: true,
    },
    { agent: "adversarial-farm", useModule: true },
    { agent: "substantiation", useModule: true },
    { agent: "readiness", useModule: true },
    { agent: "human" },
    { agent: "optimization" },
  ],
  "harborstone-rate": [
    { agent: "brief", refs: { planUrn: "urn:northstar:content-plan:hs-q4-rates", waveId: "w1" } },
    {
      agent: "module-authoring",
      refs: { topics: ["sweep-apy", "wire-fees"], channel: "email" },
      useBrief: true,
    },
    { agent: "substantiation", useModule: true },
    { agent: "readiness", useModule: true },
    { agent: "human" },
    { agent: "readiness", refs: { moduleUrn: "urn:northstar:module:hs-mod-fee-waiver-email" } },
  ],
  "coastline-cold-front": [
    {
      agent: "scenario",
      refs: {
        planUrn: "urn:northstar:content-plan:ck-q4-weather",
        change: { type: "move-send", waveId: "w1", days: -2 },
      },
    },
    {
      agent: "brief",
      refs: { planUrn: "urn:northstar:content-plan:ck-q4-weather", waveId: "w1" },
    },
    {
      agent: "module-authoring",
      refs: { topics: ["chowder-price", "soup-hours"], channel: "push" },
      useBrief: true,
    },
    { agent: "atomization", refs: { channels: ["email", "sms"] }, useModule: true },
    { agent: "readiness", useModule: true },
    { agent: "human" },
    { agent: "attribution", refs: { resultUrn: "urn:northstar:result:ck-result-chowder-push" } },
  ],
};

/** The scripted orchestrator takes its flow's steps in order, carrying urns from earlier results. */
function orchestrate(input: Input, done: Done): Next {
  const steps = FLOWS[String(input.flowId)] ?? [];
  // The first brief and module the flow created; later modules are channel versions.
  const first = (kind: "brief" | "module") => {
    for (const item of done) {
      const created = item.output.created as Array<{ ref: string; kind: string }> | undefined;
      const match = created?.find((object) => object.kind === kind);
      if (match) return match.ref;
    }
    return undefined;
  };
  const next = steps[done.length];
  if (!next)
    return done.some((item) => item.output.finished)
      ? { text: "Finished." }
      : {
          tool: "next_step",
          args: {
            kind: "finish",
            why: "Everything the goal asked for is done.",
            summary: "The flow is complete, step by step as the goal asked.",
          },
        };
  if (next.agent === "human")
    return {
      tool: "next_step",
      args: { kind: "ask_person", why: "It is ready for review.", moduleUrn: first("module") },
    };
  const refs: Record<string, unknown> = { ...next.refs };
  if (next.useBrief) refs.briefUrn = first("brief");
  if (next.useModule) refs.moduleUrn = first("module");
  return {
    tool: "next_step",
    args: {
      kind: "delegate",
      why: `Next, the ${next.agent} step.`,
      agent: next.agent,
      task: `Step for ${next.agent}.`,
      refs,
    },
  };
}

function read(prompt: Prompt) {
  let agent = "";
  let input: Input = {};
  const done: Done = [];
  for (const message of prompt) {
    if (message.role === "system") agent = /agent id: ([a-z-]+)/.exec(message.content)?.[1] ?? "";
    if (message.role === "user")
      for (const part of message.content)
        if (part.type === "text") {
          const json = /Input: (\{.*\})\s*$/s.exec(part.text)?.[1];
          if (json) input = JSON.parse(json) as Input;
        }
    if (message.role === "tool")
      for (const part of message.content)
        if (part.type === "tool-result")
          done.push({
            tool: part.toolName,
            output:
              part.output.type === "json" ? (part.output.value as Record<string, unknown>) : {},
          });
  }
  return { agent, input, done };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

function respond(prompt: Prompt): Next {
  const { agent, input, done } = read(prompt);
  return agent === "orchestrator"
    ? orchestrate(input, done)
    : (AGENTS[agent]?.(input, done) ?? { text: "No script for this agent." });
}

export function scriptedModel(): Exclude<LanguageModel, string> {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const next = respond(options.prompt);
      const callId = `call-${options.prompt.length}`;
      if ("text" in next)
        return {
          content: [{ type: "text", text: next.text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: callId,
            toolName: next.tool,
            input: JSON.stringify(next.args),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const next = respond(options.prompt);
      const callId = `call-${options.prompt.length}`;
      const body =
        "text" in next
          ? [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: next.text },
              { type: "text-end" as const, id: "t" },
            ]
          : [
              {
                type: "tool-call" as const,
                toolCallId: callId,
                toolName: next.tool,
                input: JSON.stringify(next.args),
              },
            ];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            ...body,
            {
              type: "finish" as const,
              finishReason:
                "text" in next
                  ? { unified: "stop" as const, raw: "stop" }
                  : { unified: "tool-calls" as const, raw: "tool_calls" },
              usage,
            },
          ],
        }),
      };
    },
  });
}
