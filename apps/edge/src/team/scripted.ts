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
  if (!has(done, "find_approved_assets")) return { tool: "find_approved_assets", args: {} };
  if (saved(done, "propose_creative")) return { text: "Concept saved." };
  const palette = (last(done, "get_brand_guidelines").palette as Json[])
    .slice(0, 2)
    .map((c) => c.hex);
  const usable = (last(done, "find_approved_assets").assets as Json[]).filter(
    (asset) => asset.usable,
  );
  return {
    tool: "propose_creative",
    args: {
      name: "Warm Up",
      bigIdea: "The season's comfort, close to home.",
      visualDirection: "Close crops with natural light.",
      palette,
      mood: "Cozy",
      assets: usable.slice(0, 2).map((asset, index) => ({
        assetId: asset.assetId,
        use: index === 0 ? "Email hero and display" : "Sign-off",
      })),
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

// The pharma lifecycle ------------------------------------------------------------------------

/** The lifecycle lead follows the step each result names, with a task or a message for a person. */
function lifecycleLead(input: Json, done: Done, lastUser: string, resumed: boolean): Next {
  // A person's decision arrives as a user message after the lead's last call.
  const previous = resumed ? {} : (done[done.length - 1]?.output ?? {});
  if (previous.waiting) return { text: "Waiting for a person." };
  const latest = /Input: (\{.*\})\s*$/s.exec(lastUser)?.[1];
  const fromUser = latest ? (JSON.parse(latest) as Json).nextStep : input.nextStep;
  const next = (previous.nextStep as Json | undefined) ?? fromUser;
  if (!next || next.kind === "finished") return { text: "The lifecycle is complete." };
  const call = (args: Json): Next => ({ tool: "lifecycle_step", args });
  if (next.kind === "agent")
    return call({
      kind: "assign",
      why: `${next.phaseTitle} needs ${next.agent}.`,
      agent: next.agent,
      task: `${next.does}${next.notes ? ` A person asked: ${next.notes}` : ""}`,
    });
  return call({
    kind: "request_decision",
    why: `${next.decider} decides here.`,
    message: `Ready for you: ${next.does}`,
  });
}

const failed = (done: Done, tool: string) =>
  done.some((item) => item.tool === tool && typeof item.output.error === "string");

function lifecycleWorker(step: string, input: Json, done: Done): Next {
  const read = (tools: string[]): Next | null => {
    for (const tool of tools) if (!has(done, tool)) return { tool, args: {} };
    return null;
  };
  if (saved(done, step)) return { text: "Saved." };
  if (step === "propose_focus_areas") {
    const first = read(["get_audience_segments", "get_market_signals", "get_past_results"]);
    if (first) return first;
    const segments = last(done, "get_audience_segments").segments as Json[];
    const signals = last(done, "get_market_signals").signals as Json[];
    const results = last(done, "get_past_results").results as Json[];
    return {
      tool: step,
      args: {
        areas: [
          {
            title: "Bring the congress outcomes data to heart failure specialists",
            rationale: signals[0]?.signal,
            sources: [signals[0]?.id, segments[0]?.id, results[0]?.id],
            measure: "Click rate on the outcomes email against last year's",
          },
          {
            title: "Reach heart failure nurse practitioners with the safety profile",
            rationale: signals[1]?.signal,
            sources: [signals[1]?.id, segments[2]?.id],
            measure: "Reach among HF nurse practitioners",
          },
        ],
      },
    };
  }
  if (step === "propose_concepts" || step === "draft_modules") {
    const first = read(["get_claims_library", "find_approved_assets"]);
    if (first) return first;
    const claims = (last(done, "get_claims_library").claims as Json[]).filter(
      (claim) => claim.usable,
    );
    const assets = (last(done, "find_approved_assets").assets as Json[]).filter(
      (asset) => asset.usable,
    );
    const topics = claims.map((claim) => claim.topic);
    const images = assets.slice(0, 2).map((asset, index) => ({
      assetId: asset.assetId,
      use: index === 0 ? "Hero" : "Product shot",
    }));
    if (step === "propose_concepts")
      return {
        tool: step,
        args: {
          concepts: [
            {
              name: "The data, in full",
              bigIdea: "Lead with the outcomes data, plainly.",
              claimTopics: topics,
              assets: images,
            },
            {
              name: "What the congress showed",
              bigIdea: "Bring the congress to the clinic.",
              claimTopics: topics.slice(0, 1),
              assets: images.slice(0, 1),
            },
          ],
        },
      };
    // The first draft reaches for a claim the library refuses; the service says so and the second
    // draft drops it, as a real writer's would after the refusal.
    const reach = failed(done, step) || input.notes ? [] : ["cardivance-superior"];
    const module = (channel: string) => ({
      channel,
      headline: "Cardivance: news from the heart failure congress",
      opening: "See the CARDIO-HF results presented at the congress.",
      claimTopics: [...topics, ...reach],
      closing: "See the full prescribing information below.",
      cta: "Read the data",
      assets: channel === "email" ? images : [],
    });
    return { tool: step, args: { modules: [module("email"), module("display")] } };
  }
  if (step === "submit_mlr_job") {
    const first = read(["get_claims_library"]);
    if (first) return first;
    return {
      tool: step,
      args: {
        notes: [
          "Every claim is annotated to its reference; fair balance is attached to both modules.",
        ],
      },
    };
  }
  if (step === "build_audience") {
    const first = read(["get_hcp_universe"]);
    if (first) return first;
    const segments = last(done, "get_hcp_universe").segments as Json[];
    return {
      tool: step,
      args: {
        include: [
          { segmentId: segments[0]?.segmentId, deciles: ["high", "mid"] },
          { segmentId: segments[2]?.segmentId, deciles: ["high"] },
        ],
        rationale:
          "The highest-writing specialists, and the nurse practitioners who manage titration.",
      },
    };
  }
  if (step === "schedule_deployment") {
    const first = read(["get_approved_job"]);
    if (first) return first;
    const job = last(done, "get_approved_job");
    const segmentIds = (job.audience as Json[]).map((line) => line.segmentId);
    const modules = job.approved.modules as Json[];
    return {
      tool: step,
      args: {
        lines: modules.map((module) => ({
          moduleId: module.id,
          channel: module.channel === "email" ? "approved-email" : "hcp-display",
          segmentIds,
          start: job.window.start,
          end: job.window.end,
          budgetUsd: Math.round(job.budgetUsd * (module.channel === "email" ? 0.2 : 0.6)),
        })),
      },
    };
  }
  if (step === "prepare_form_2253") {
    const first = read(["get_approved_job"]);
    if (first) return first;
    return { tool: step, args: { note: "Approved materials and the current PI, at first use." } };
  }
  if (step === "report_performance") {
    const first = read(["get_campaign_results"]);
    if (first) return first;
    const lines = last(done, "get_campaign_results").lines as Json[];
    return {
      tool: step,
      args: {
        findings: [{ text: "Specialists opened the email most.", sources: [lines[0]?.id] }],
        recommendation: "optimize",
        rationale: "Email outperforms display; move display budget to email.",
        nextSteps: ["Shift display budget to email for specialists."],
      },
    };
  }
  return { text: "No script for this step." };
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
  let lifecycle = "";
  let resumed = false;
  let input: Json = {};
  let lastUser = "";
  const done: Done = [];
  for (const message of prompt) {
    if (message.role === "system") {
      agent = /agent id: ([a-z-]+)/.exec(message.content)?.[1] ?? "";
      mode = /Mode: (work|answer|report)/.exec(message.content)?.[1] ?? "work";
      lifecycle =
        /Lifecycle step: ([a-z_0-9]+)/.exec(message.content)?.[1] ??
        (/Lifecycle lead\./.test(message.content) ? "lead" : "");
    }
    if (message.role === "user") resumed = true;
    if (message.role === "tool") resumed = false;
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
  return { agent, mode, input, done, lastUser, lifecycle, resumed };
}

function respond(prompt: Prompt): Next {
  const { agent, mode, input, done, lastUser, lifecycle, resumed } = read(prompt);
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
  if (agent === "pharma-judge")
    return done.some((item) => item.tool === "score_proposal")
      ? { text: "Scored." }
      : {
          tool: "score_proposal",
          args: {
            scores: [
              {
                criterion: "fair_balance",
                score: 5,
                reason: "Safety information sits beside every claim.",
              },
              {
                criterion: "net_impression",
                score: 4,
                reason:
                  "The modules say no more than their claims, though the headline leans hopeful.",
              },
              {
                criterion: "claim_discipline",
                score: 5,
                reason: "Every fact is an approved claim.",
              },
              {
                criterion: "fit_to_brief",
                score: 4,
                reason: "Serves the specialists the brief names.",
              },
            ],
            summary: "Compliant, balanced modules on brief. The headline could be plainer.",
          },
        };
  if (mode === "answer") return { text: `${agent} answers from its saved work.` };
  if (lifecycle === "lead") return lifecycleLead(input, done, lastUser, resumed && done.length > 0);
  if (lifecycle && mode === "report") return { text: `${agent} saved ${lifecycle}.` };
  if (lifecycle) return lifecycleWorker(lifecycle, input, done);
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
