// A scripted stand-in for the campaign team's models, for the hermetic worker tests only. It is
// selected when AGENT_MODEL is "scripted", which only vitest.worker.config.ts sets. It calls each
// agent's real tools in a plausible order, so the gateway, the services, the message bus and the
// director's rules are exercised exactly as a real model's calls would exercise them.
import type { LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

type Generate = Extract<
  NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>["doGenerate"],
  (...args: never[]) => unknown
>;
type Prompt = Parameters<Generate>[0]["prompt"];
// biome-ignore lint/suspicious/noExplicitAny: tool outputs and inputs are untyped JSON here
type Json = Record<string, any>;
type Done = Array<{ tool: string; output: Json }>;
type Next = { tool: string; args: Json } | { text: string };

const has = (done: Done, tool: string) => done.some((item) => item.tool === tool);
const last = (done: Done, tool: string) =>
  [...done].reverse().find((item) => item.tool === tool)?.output ?? {};
const saved = (done: Done, tool: string) =>
  done.some((item) => item.tool === tool && item.output.saved);

const SPECIALISTS = ["audience-analyst", "art-director", "copy-lead", "channel-planner"];

function director(input: Json, done: Done, lastUser = ""): Next {
  const n = done.length;
  const call = (args: Json): Next => ({ tool: "next_step", args });
  if (n === 0)
    return call({
      kind: "plan",
      why: "Map the brief's deliverables to the specialists.",
      plan: {
        deliverables: [
          "Audience and market insights",
          "Creative concept",
          "Channel copy",
          "Media plan",
        ],
        assignments: [
          {
            agent: "audience-analyst",
            task: "Analyze the audience and competitors.",
            dependsOn: [],
          },
          { agent: "art-director", task: "Develop the concept.", dependsOn: ["audience-analyst"] },
          { agent: "copy-lead", task: "Write the channel copy.", dependsOn: ["art-director"] },
          {
            agent: "channel-planner",
            task: "Plan the media mix within budget.",
            dependsOn: ["audience-analyst", "art-director"],
          },
        ],
        budgetGuidance: "Keep a little in reserve.",
      },
    });
  const script: Json[] = [
    { kind: "delegate", agent: "audience-analyst", task: "Find the audience to win and why." },
    { kind: "review", agent: "audience-analyst", verdict: "accept" },
    { kind: "delegate", agent: "art-director", task: "Develop the concept from the research." },
    { kind: "review", agent: "art-director", verdict: "accept" },
    { kind: "delegate", agent: "copy-lead", task: "Write copy for email and search." },
    { kind: "review", agent: "copy-lead", verdict: "revise", feedback: "Add a display asset." },
    { kind: "review", agent: "copy-lead", verdict: "accept" },
    { kind: "delegate", agent: "channel-planner", task: "Plan the media mix within budget." },
    { kind: "review", agent: "channel-planner", verdict: "accept" },
  ];
  const scripted = script[n - 1];
  if (scripted) return call({ why: `Step ${n}.`, ...scripted });
  const previous = done[n - 1]?.output ?? {};
  const propose = call({
    kind: "propose",
    why: "Ready for the client.",
    message: "Here is our proposal for your review.",
  });
  // Resumed after a person decided: act on what they said.
  if (previous.waiting) {
    if (/approved the copy/.test(lastUser)) return propose;
    if (/asked for changes|sent feedback/.test(lastUser))
      return call({
        kind: "review",
        why: "A person asked for changes.",
        agent: "copy-lead",
        verdict: "revise",
        feedback: `A person asked: ${lastUser.split(":").slice(1).join(":").trim().split("\n")[0]}`,
      });
    return { text: "Waiting for a person." };
  }
  if (typeof previous.next === "string" && previous.next.startsWith("Review the revision"))
    return call({
      kind: "review",
      why: "The revision fits.",
      agent: "copy-lead",
      verdict: "accept",
    });
  if (previous.reconciled)
    return typeof previous.next === "string" && previous.next.includes("compliance")
      ? call({
          kind: "request_review",
          why: "Regulated copy needs compliance first.",
          message: "Please check the copy and its disclosures before the client sees it.",
        })
      : propose;
  const reconciliation = {
    kind: "reconcile",
    why: "All four pieces are kept.",
    positioning: `Warm, local ${input.brief?.brand ?? ""} campaign.`,
    milestones: [
      { date: input.brief?.start, label: "Launch" },
      { date: input.brief?.end, label: "Wrap-up and read-out" },
    ],
    successMetrics: ["Clicks against plan", "Cost per click"],
  };
  const conflicts = (previous.conflicts as Json[] | undefined) ?? [];
  return call({
    ...reconciliation,
    resolutions: conflicts.map((conflict) => ({
      conflictId: conflict.id,
      resolution: "Reuse the display creative for this channel.",
    })),
  });
}

function research(_input: Json, done: Done): Next {
  for (const tool of ["get_audience_segments", "get_competitors", "get_market_signals"])
    if (!has(done, tool)) return { tool, args: {} };
  if (saved(done, "report_research")) return { text: "Research saved." };
  const segments = last(done, "get_audience_segments").segments as Json[];
  const competitors = last(done, "get_competitors").competitors as Json[];
  const signals = last(done, "get_market_signals").signals as Json[];
  return {
    tool: "report_research",
    args: {
      primarySegmentId: segments[0]?.id,
      secondarySegmentIds: [segments[1]?.id],
      insights: [{ text: signals[0]?.signal, sources: [signals[0]?.id, segments[0]?.id] }],
      opportunities: ["Own the seasonal moment before competitors do."],
      competitorWatch: [
        { competitorId: competitors[0]?.id, implication: "Avoid their price-led framing." },
      ],
    },
  };
}

function creative(_input: Json, done: Done): Next {
  if (!has(done, "get_brand_guidelines")) return { tool: "get_brand_guidelines", args: {} };
  if (!has(done, "ask_teammate"))
    return {
      tool: "ask_teammate",
      args: {
        to: "audience-analyst",
        question: "Which segment should the visuals speak to first?",
      },
    };
  if (saved(done, "propose_creative")) return { text: "Concept saved." };
  const palette = (last(done, "get_brand_guidelines").palette as Json[])
    .slice(0, 2)
    .map((c) => c.hex);
  return {
    tool: "propose_creative",
    args: {
      name: "Warm Up",
      bigIdea: "The season's comfort, close to home.",
      visualDirection: "Close crops with natural light.",
      palette,
      mood: "Cozy",
      keyVisuals: [
        { format: "display", description: "A close crop with soft morning light." },
        { format: "email hero", description: "The team at work, candid." },
      ],
      rationale: "Speaks to the research's primary segment.",
    },
  };
}

function copy(input: Json, done: Done): Next {
  if (!has(done, "get_channel_specs")) return { tool: "get_channel_specs", args: {} };
  if (!has(done, "ask_teammate"))
    return {
      tool: "ask_teammate",
      args: { to: "art-director", question: "What tone should the headlines carry?" },
    };
  if (!has(done, "define_term")) return { tool: "define_term", args: { term: "paid search CPC" } };
  if (!has(done, "get_brand_guidelines")) return { tool: "get_brand_guidelines", args: {} };
  if (saved(done, "write_copy")) return { text: "Copy saved." };
  const disclosure = last(done, "get_brand_guidelines").requiredDisclosure as string | null;
  const asset = (channel: string) => ({
    channel,
    headline: "Warm up with us",
    body: "Seasonal favorites are here.",
    cta: "Learn more",
    ...(disclosure ? { disclosure } : {}),
  });
  const channels = input.feedback ? ["email", "paid-search", "display"] : ["email", "paid-search"];
  return {
    tool: "write_copy",
    args: {
      tagline: "Warm up with us",
      pillars: ["Seasonal", "Local"],
      assets: channels.map(asset),
    },
  };
}

function media(input: Json, done: Done): Next {
  if (!has(done, "get_channel_benchmarks")) return { tool: "get_channel_benchmarks", args: {} };
  if (!has(done, "ask_teammate"))
    return {
      tool: "ask_teammate",
      args: { to: "copy-lead", question: "Which channels do you have copy for?" },
    };
  if (saved(done, "plan_media")) return { text: "Plan saved." };
  const { budgetUsd, window } = last(done, "get_channel_benchmarks");
  const folder = Array.isArray(input.folder) ? (input.folder as Json[]) : [];
  const segmentId = folder.find((item) => item.agent === "audience-analyst")?.work
    ?.primarySegmentId;
  const shares: Array<[string, number]> = [
    ["paid-search", 0.4],
    ["email", 0.15],
    ["display", 0.2],
    ["online-video", 0.15],
  ];
  return {
    tool: "plan_media",
    args: {
      lines: shares.map(([channel, share]) => ({
        channel,
        budgetUsd: Math.round(budgetUsd * share),
        start: window.start,
        end: window.end,
        segmentId,
        objective: "Drive visits.",
      })),
      kpis: ["Clicks", "Cost per click"],
      rationale: "Search captures intent; display and video build reach.",
    },
  };
}

const AGENTS: Record<string, (input: Json, done: Done, lastUser?: string) => Next> = {
  "campaign-lead": director,
  "audience-analyst": research,
  "art-director": creative,
  "copy-lead": copy,
  "channel-planner": media,
};

function read(prompt: Prompt) {
  let agent = "";
  let mode = "work";
  let input: Json = {};
  let lastUser = "";
  const done: Done = [];
  for (const message of prompt) {
    if (message.role === "system") {
      agent = /agent id: ([a-z-]+)/.exec(message.content)?.[1] ?? "";
      mode = /Mode: (work|answer|report)/.exec(message.content)?.[1] ?? "work";
    }
    if (message.role === "user")
      for (const part of message.content)
        if (part.type === "text") {
          lastUser = part.text;
          const json = /Input: (\{.*\})\s*$/s.exec(part.text)?.[1];
          if (json && Object.keys(input).length === 0) input = JSON.parse(json) as Json;
        }
    if (message.role === "tool")
      for (const part of message.content)
        if (part.type === "tool-result")
          done.push({
            tool: part.toolName,
            output: part.output.type === "json" ? (part.output.value as Json) : {},
          });
  }
  return { agent, mode, input, done, lastUser };
}

function respond(prompt: Prompt): Next {
  const { agent, mode, input, done, lastUser } = read(prompt);
  if (agent === "squad-judge")
    return done.some((item) => item.tool === "score_proposal")
      ? { text: "Scored." }
      : {
          tool: "score_proposal",
          args: {
            scores: [
              { criterion: "on_brief", score: 4, reason: "Meets the objectives and window." },
              {
                criterion: "insight_to_execution",
                score: 4,
                reason: "Channels follow the audience.",
              },
              { criterion: "specificity", score: 3, reason: "Copy is short but generic." },
              { criterion: "brand_fit", score: 5, reason: "Disclosures and voice are right." },
              { criterion: "coherence", score: 4, reason: "One idea throughout." },
            ],
            summary: "A sound, on-brief plan. The copy could be more specific.",
          },
        };
  if (mode === "answer") return { text: `${agent} answers from its saved work.` };
  if (mode === "report") return { text: `${agent} delivered its work.` };
  if (SPECIALISTS.includes(agent) || agent === "campaign-lead")
    return AGENTS[agent]?.(input, done, lastUser) ?? { text: "No script." };
  return { text: "No script for this agent." };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

export function teamScriptedModel(): Exclude<LanguageModel, string> {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const next = respond(options.prompt);
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
            toolCallId: `call-${options.prompt.length}`,
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
                toolCallId: `call-${options.prompt.length}`,
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
