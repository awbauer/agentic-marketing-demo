// The campaign team: a hub-and-spoke squad of agents. A campaign lead sits at the hub, turns a
// client's brief into a work plan, hands each piece to the spoke that owns it, checks what comes
// back, reconciles the pieces where they disagree, and sends the client one proposal. Spokes answer
// to the lead and can also put a question straight to another spoke. Each message is logged, and
// each tool call is checked by the agentic gateway under the policies below.
import type { AgentOverrides } from "./registry.ts";
import type { Policy } from "./gateway.ts";
import { MEDIA_CHANNELS, type MediaChannel } from "./team-data.ts";
import { BRANDS, type Brand } from "./types.ts";

/**
 * Where the squad's models run. The agents, tools, gateway, semantic layer, rules and message bus
 * are the same for all three; only the model behind each agent changes.
 */
export const TEAM_PROVIDERS = ["cloudflare", "anthropic", "openai"] as const;
export type TeamProvider = (typeof TEAM_PROVIDERS)[number];
export const TEAM_PROVIDER_LABELS: Record<TeamProvider, string> = {
  cloudflare: "Cloudflare Workers AI",
  anthropic: "Anthropic Claude API",
  openai: "OpenAI Responses API",
};
export const isTeamProvider = (value: unknown): value is TeamProvider =>
  (TEAM_PROVIDERS as readonly unknown[]).includes(value);

export const TEAM_SPECIALISTS = [
  "audience-analyst",
  "art-director",
  "copy-lead",
  "channel-planner",
] as const;
export type TeamSpecialist = (typeof TEAM_SPECIALISTS)[number];
export const TEAM_DIRECTOR = "campaign-lead" as const;
export type TeamAgentId = typeof TEAM_DIRECTOR | TeamSpecialist;
/**
 * A party to a message: an agent, the whole team (a broadcast), or the client who sent the brief
 * and receives the strategy.
 */
export type TeamParty = TeamAgentId | "client" | "team";

export type TeamAgent = {
  id: TeamAgentId;
  name: string;
  role: "hub" | "spoke";
  /** The model task class the router binds the agent to. */
  taskClass: "orchestrate" | "draft";
  summary: string;
  /** What the lead's roster says the spoke owns. */
  use: string;
  /** Tools the gateway grants the agent; it gets no others. */
  tools: readonly TeamTool[];
  /** The tool its work centres on: the agent must call it before it reports. */
  deliverable: TeamTool | null;
};

/** Every tool on the team. The gateway checks each call as `team:<tool>`. */
export const TEAM_TOOL_NAMES = [
  // The lead's
  "plan_campaign",
  "delegate_task",
  "review_work",
  "reconcile_plan",
  "send_proposal",
  // Shared
  "read_team_output",
  "query_semantic_layer",
  "define_term",
  "ask_teammate",
  "answer_teammate",
  // Spokes' data reads
  "get_audience_segments",
  "get_competitors",
  "get_market_signals",
  "get_brand_guidelines",
  "get_channel_specs",
  "get_channel_benchmarks",
  // Spokes' save tools
  "report_research",
  "propose_creative",
  "write_copy",
  "plan_media",
] as const;
export type TeamTool = (typeof TEAM_TOOL_NAMES)[number];

/** Tools that only read. A constrained agent keeps these and loses the rest. */
export const TEAM_READ_TOOLS: readonly TeamTool[] = [
  "read_team_output",
  "query_semantic_layer",
  "define_term",
  "get_audience_segments",
  "get_competitors",
  "get_market_signals",
  "get_brand_guidelines",
  "get_channel_specs",
  "get_channel_benchmarks",
];

const SEMANTIC: readonly TeamTool[] = ["query_semantic_layer", "define_term"];
const SHARED: readonly TeamTool[] = [
  "read_team_output",
  "ask_teammate",
  "answer_teammate",
  ...SEMANTIC,
];

export const TEAM_AGENTS: readonly TeamAgent[] = [
  {
    id: "campaign-lead",
    name: "Campaign lead",
    role: "hub",
    taskClass: "orchestrate",
    summary:
      "Sits at the hub. Turns the brief into a work plan, hands out the pieces, checks each one, reconciles them and sends the client a single proposal.",
    use: "",
    tools: [
      "plan_campaign",
      "delegate_task",
      "review_work",
      "reconcile_plan",
      "send_proposal",
      "read_team_output",
    ],
    deliverable: null,
  },
  {
    id: "audience-analyst",
    name: "Audience analyst",
    role: "spoke",
    taskClass: "draft",
    summary:
      "Works out who to win and why: sizes the segments, reads the competition and the market signals, and cites the data behind every finding.",
    use: "who the campaign should win, how big each group is, what rivals are doing and which signals point to an opening",
    tools: [
      "get_audience_segments",
      "get_competitors",
      "get_market_signals",
      "report_research",
      ...SHARED,
    ],
    deliverable: "report_research",
  },
  {
    id: "art-director",
    name: "Art director",
    role: "spoke",
    taskClass: "draft",
    summary:
      "Sets the look: a named idea, a palette drawn from the brand book, and the key images each placement needs.",
    use: "the campaign idea, its look and palette, and the key images",
    tools: ["get_brand_guidelines", "propose_creative", ...SHARED],
    deliverable: "propose_creative",
  },
  {
    id: "copy-lead",
    name: "Copy lead",
    role: "spoke",
    taskClass: "draft",
    summary:
      "Finds the words: a line, the themes the campaign keeps returning to, and copy for each placement that fits its character limits.",
    use: "the campaign line, its recurring themes and the copy for each placement",
    tools: ["get_brand_guidelines", "get_channel_specs", "write_copy", ...SHARED],
    deliverable: "write_copy",
  },
  {
    id: "channel-planner",
    name: "Channel planner",
    role: "spoke",
    taskClass: "draft",
    summary:
      "Decides where the money goes: which channels, how much in each, when each runs, and what it should return, priced from benchmarks.",
    use: "which channels to buy, the spend and dates for each, and the results to expect",
    tools: ["get_channel_benchmarks", "get_audience_segments", "plan_media", ...SHARED],
    deliverable: "plan_media",
  },
];

export const teamAgentById = (id: string) => TEAM_AGENTS.find((agent) => agent.id === id);
export const isTeamSpecialist = (id: string): id is TeamSpecialist =>
  (TEAM_SPECIALISTS as readonly string[]).includes(id);

export const TEAM_PARTY_LABELS: Record<TeamParty, string> = {
  client: "Client",
  team: "Whole squad",
  "campaign-lead": "Campaign lead",
  "audience-analyst": "Audience analyst",
  "art-director": "Art director",
  "copy-lead": "Copy lead",
  "channel-planner": "Channel planner",
};

/**
 * The team's policies, compiled from its roster. Each agent may call only its own tools; an
 * operator's kill switch or a retired lifecycle withholds all of them, and constrain keeps reads.
 */
export function buildTeamPolicies(overrides: AgentOverrides = {}): Policy[] {
  return TEAM_AGENTS.flatMap((agent) => {
    const lifecycle = overrides.lifecycle?.[agent.id];
    if (overrides.disabled?.includes(agent.id) || lifecycle === "retire") return [];
    const tools =
      lifecycle === "constrain"
        ? agent.tools.filter((tool) => TEAM_READ_TOOLS.includes(tool))
        : agent.tools;
    if (tools.length === 0) return [];
    return [
      {
        id: `team-${agent.id}`,
        effect: "permit" as const,
        principal: { type: "agent" as const, ids: [agent.id] },
        actions: tools.map((tool) => `team:${tool}`),
        note: `${agent.name} may call its own tools: ${tools.join(", ")}.`,
      },
    ];
  });
}

// Briefs --------------------------------------------------------------------------------------

/** What a client hands the squad. */
export type CampaignBrief = {
  id: string;
  brand: Brand;
  title: string;
  objectives: string;
  audience: string;
  budgetUsd: number;
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
  guidelines: string;
};

export const TEAM_BRIEFS: readonly CampaignBrief[] = [
  {
    id: "coastline-winter-warmup",
    brand: "Coastline Kitchen",
    title: "Winter Warm-Up: soup season at Coastline Kitchen",
    objectives:
      "Grow weekday lunch visits 15% through the cold months and get lapsed loyalty members back for the new winter soup menu.",
    audience: "Bay Area diners who eat out at lunch, plus our loyalty members.",
    budgetUsd: 18000,
    start: "2026-12-01",
    end: "2027-01-31",
    guidelines:
      "Keep it local and warm. Food photography over people shots. No discount-led messaging.",
  },
  {
    id: "harborstone-cash-at-work",
    brand: "Harborstone Wealth",
    title: "Put idle cash to work: Sweep Account awareness",
    objectives:
      "Move existing clients' idle checking balances into the Sweep Account and win rate-shopping prospects, without promising returns.",
    audience: "Existing clients with idle cash, and investors comparing savings rates.",
    budgetUsd: 60000,
    start: "2027-01-05",
    end: "2027-02-28",
    guidelines:
      "Calm and precise. Lead with safety and access, then the rate. Every ad carries the rate disclosure.",
  },
  {
    id: "lumera-hf-awareness",
    brand: "Lumera Therapeutics",
    title: "Cardivance after the congress: HCP awareness",
    objectives:
      "Build awareness of the congress outcomes data among cardiologists and heart failure nurse practitioners ahead of the spring guideline update.",
    audience: "US cardiologists and heart failure nurse practitioners.",
    budgetUsd: 120000,
    start: "2027-01-12",
    end: "2027-03-31",
    guidelines:
      "HCP only. Fair balance on every asset. No comparative claims against other therapies.",
  },
];

export const teamBriefById = (id: string) => TEAM_BRIEFS.find((brief) => brief.id === id);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a brief a person edited; an empty list means the team can work on it. */
export function briefProblems(brief: Partial<CampaignBrief>): string[] {
  const problems: string[] = [];
  if (!brief.brand || !(BRANDS as readonly string[]).includes(brief.brand))
    problems.push(`brand must be one of ${BRANDS.join(", ")}.`);
  for (const field of ["title", "objectives", "audience"] as const) {
    const value = brief[field];
    if (typeof value !== "string" || value.trim().length < 5)
      problems.push(`${field} needs a few words.`);
    else if (value.length > 600) problems.push(`${field} must be 600 characters or fewer.`);
  }
  if (typeof brief.guidelines === "string" && brief.guidelines.length > 600)
    problems.push("guidelines must be 600 characters or fewer.");
  if (
    typeof brief.budgetUsd !== "number" ||
    !(brief.budgetUsd >= 1000 && brief.budgetUsd <= 1_000_000)
  )
    problems.push("budgetUsd must be between 1,000 and 1,000,000.");
  if (!brief.start || !DATE.test(brief.start) || !brief.end || !DATE.test(brief.end))
    problems.push("start and end must be dates (YYYY-MM-DD).");
  else if (brief.start > brief.end) problems.push("start must be on or before end.");
  return problems;
}

// What the spokes produce ---------------------------------------------------------------------

export type ResearchReport = {
  primarySegmentId: string;
  secondarySegmentIds: string[];
  /** Each insight cites the ids of the segments, competitors or signals it rests on. */
  insights: Array<{ text: string; sources: string[] }>;
  opportunities: string[];
  competitorWatch: Array<{ competitorId: string; implication: string }>;
};

export type CreativeConcept = {
  name: string;
  bigIdea: string;
  visualDirection: string;
  /** Hex colors, all from the brand palette. */
  palette: string[];
  mood: string;
  keyVisuals: Array<{ format: string; description: string }>;
  rationale: string;
};

export type CopyAsset = {
  channel: MediaChannel;
  headline: string;
  body: string;
  cta: string;
  /** The brand's required disclosure, when it has one. */
  disclosure?: string;
};

export type CopyPackage = {
  tagline: string;
  pillars: string[];
  assets: CopyAsset[];
};

export type MediaLine = {
  channel: MediaChannel;
  budgetUsd: number;
  start: string;
  end: string;
  segmentId: string;
  objective: string;
};

export type MediaPlan = { lines: MediaLine[]; kpis: string[]; rationale: string };

export type TeamOutputs = {
  "audience-analyst"?: ResearchReport;
  "art-director"?: CreativeConcept;
  "copy-lead"?: CopyPackage;
  "channel-planner"?: MediaPlan;
};

/** The lead's work plan: what the client gets, and who does which piece in what order. */
export type TeamPlan = {
  deliverables: string[];
  assignments: Array<{ agent: TeamSpecialist; task: string; dependsOn: TeamSpecialist[] }>;
  budgetGuidance: string;
};

export type Conflict = {
  id: string;
  between: [TeamSpecialist, TeamSpecialist];
  detail: string;
};

export type MediaProjection = MediaLine & {
  impressions: number;
  clicks: number;
  costPerClickUsd: number;
};

/** The lead's reconciliation: how the pieces fit together, and how each clash is resolved. */
export type Reconciliation = {
  positioning: string;
  resolutions: Array<{ conflictId: string; resolution: string }>;
  milestones: Array<{ date: string; label: string }>;
  successMetrics: string[];
};

/** What the client receives: a proposal, which the client decides whether to run. */
export type CampaignStrategy = {
  briefId: string;
  brand: Brand;
  title: string;
  positioning: string;
  audience: { primary: string; secondary: string[]; insights: ResearchReport["insights"] };
  creative: CreativeConcept;
  messaging: CopyPackage;
  media: {
    lines: MediaProjection[];
    totalUsd: number;
    budgetUsd: number;
    impressions: number;
    clicks: number;
  };
  timeline: Array<{ date: string; label: string }>;
  successMetrics: string[];
  resolutions: Array<{ conflict: string; resolution: string }>;
  status: "proposed";
};

// Events --------------------------------------------------------------------------------------

export type TeamMessageKind =
  | "brief"
  | "plan"
  | "directive"
  | "report"
  | "question"
  | "answer"
  | "review"
  | "revision"
  | "proposal"
  | "delivery";

export type TeamAgentState = "idle" | "working" | "waiting" | "done" | "revising" | "blocked";

export type TeamToolStep = {
  tool: string;
  input: unknown;
  ok: boolean;
  decision?: { decision: string; policyId: string; reason: string };
  output?: unknown;
  error?: string;
};

/** What a team run streams while it works, in order. */
export type TeamEvent =
  | {
      type: "start";
      id: string;
      brief: CampaignBrief;
      models: Record<TeamAgentId, string>;
      /** The infrastructure this run is served by. */
      infra: {
        provider: TeamProvider;
        aiGateway: string | null;
        policies: number;
        store: string;
        scripted: boolean;
      };
    }
  | {
      type: "model";
      agent: TeamAgentId;
      model: string;
      purpose: "lead" | "work" | "answer" | "report";
      tokens: number;
      latencyMs: number;
      ok: boolean;
    }
  | {
      type: "semantic";
      agent: TeamAgentId;
      tool: string;
      entity?: string;
      metrics: string[];
      terms?: string[];
    }
  | { type: "saved"; ok: boolean; store: string }
  | { type: "status"; agent: TeamAgentId; state: TeamAgentState; note?: string }
  | {
      type: "message";
      id: string;
      from: TeamParty;
      to: TeamParty;
      kind: TeamMessageKind;
      text: string;
    }
  | { type: "plan"; plan: TeamPlan }
  | { type: "tool"; agent: TeamAgentId; step: TeamToolStep }
  | {
      type: "output";
      agent: TeamSpecialist;
      version: number;
      output: unknown;
      tokens: number;
      latencyMs: number;
    }
  | { type: "review"; agent: TeamSpecialist; verdict: "accept" | "revise"; feedback: string }
  | { type: "conflicts"; conflicts: Conflict[] }
  | { type: "delivered"; strategy: CampaignStrategy }
  | { type: "done"; summary: string; tokens: number; latencyMs: number }
  | { type: "error"; message: string };

export const isMediaChannel = (value: string): value is MediaChannel =>
  (MEDIA_CHANNELS as readonly string[]).includes(value);
