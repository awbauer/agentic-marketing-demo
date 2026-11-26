// The campaign team: a hub-and-spoke squad of agents. A campaign lead sits at the hub, turns a
// client's brief into a work plan, hands each piece to the spoke that owns it, checks what comes
// back, reconciles the pieces where they disagree, and sends the client one proposal. Spokes answer
// to the lead and can also put a question straight to another spoke. Each message is logged, and
// each tool call is checked by the agentic gateway under the policies below.

import {
  type AgentFacts,
  filePolicies,
  linkPolicy,
  type Policy,
  type PolicySet,
  policySet,
} from "./gateway.ts";
import type { AgentOverrides } from "./registry.ts";
import type { Persona } from "./state-machine.ts";
import { MEDIA_CHANNELS, type MediaChannel, teamMarket } from "./team-data.ts";
import type { TeamScorecard } from "./team-evals.ts";
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
/**
 * A provider's name on a host. On Google Cloud the open-model tier is Vertex AI, not Workers AI
 * (ADR-018); the vendors are reached through Vertex (Claude) or not at all (OpenAI).
 */
export function teamProviderLabel(provider: TeamProvider, host: string = "cloudflare") {
  if (host !== "google-cloud") return TEAM_PROVIDER_LABELS[provider];
  return {
    cloudflare: "Vertex AI (open models)",
    anthropic: "Claude on Vertex AI",
    openai: "OpenAI Responses API",
  }[provider];
}
/**
 * Where a run's open-model tier ran: the AI platform chosen in the top bar (ADR-021), recorded on
 * the run. Runs from before it was recorded fall back to the host's own platform.
 */
export function teamOpenModels(
  aiPlatform: string | null | undefined,
  host: string = "cloudflare",
): "workers-ai" | "vertex" {
  if (aiPlatform === "vertex" || aiPlatform === "workers-ai") return aiPlatform;
  return host === "google-cloud" ? "vertex" : "workers-ai";
}

/** A run's provider by name, with the open-model tier named for the platform it ran on. */
export function teamRunProviderLabel(
  provider: TeamProvider,
  aiPlatform: string | null | undefined,
  host: string = "cloudflare",
) {
  if (provider !== "cloudflare") return teamProviderLabel(provider, host);
  return teamOpenModels(aiPlatform, host) === "vertex"
    ? teamProviderLabel("cloudflare", "google-cloud")
    : TEAM_PROVIDER_LABELS.cloudflare;
}

/** The platform the open-model tier ran on, from a run's start event, if it was recorded. */
export function runAiPlatform(events: readonly TeamEvent[]): "workers-ai" | "vertex" | undefined {
  const start = events[0];
  return start?.type === "start" ? start.infra?.aiPlatform : undefined;
}

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
/** Agents that join only for the pharma lifecycle (see team-pharma.ts). */
export const LIFECYCLE_AGENTS = ["mlr-coordinator", "performance-analyst"] as const;
export type LifecycleAgent = (typeof LIFECYCLE_AGENTS)[number];
export type TeamAgentId = typeof TEAM_DIRECTOR | TeamSpecialist | LifecycleAgent;
/** A lifecycle worker: any agent but the lead. */
export type LifecycleWorker = TeamSpecialist | LifecycleAgent;

/**
 * How a run works. squad: the lead's brief-to-proposal loop. lifecycle: a regulated brand's
 * campaign from business focus to analytics, with MLR review and the human steps around it.
 */
export const TEAM_MODES = ["squad", "lifecycle"] as const;
export type TeamMode = (typeof TEAM_MODES)[number];
/**
 * A party to a message: an agent, the whole team (a broadcast), or the client who sent the brief
 * and receives the strategy.
 */
export type TeamParty =
  | TeamAgentId
  | "client"
  | "team"
  | "compliance"
  /** The people in the pharma lifecycle; the person at the browser plays each. */
  | "brand-lead"
  | "medical"
  | "legal"
  | "regulatory"
  | "marketing-ops"
  | "market";

export type TeamAgent = {
  id: TeamAgentId;
  name: string;
  role: "hub" | "spoke";
  /** Coordinators get each provider's top model; workers a smaller one. */
  tier: "coordinator" | "worker";
  /** The runs the agent takes part in. */
  modes: readonly TeamMode[];
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
  "request_compliance_review",
  "send_proposal",
  "request_decision",
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
  "find_approved_assets",
  // The lifecycle's data reads
  "get_past_results",
  "get_claims_library",
  "get_hcp_universe",
  "get_approved_job",
  "get_campaign_results",
  // Spokes' save tools
  "report_research",
  "propose_creative",
  "write_copy",
  "plan_media",
  // The lifecycle's save tools
  "propose_focus_areas",
  "propose_concepts",
  "draft_modules",
  "submit_mlr_job",
  "build_audience",
  "schedule_deployment",
  "prepare_form_2253",
  "report_performance",
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
  "find_approved_assets",
  "get_past_results",
  "get_claims_library",
  "get_hcp_universe",
  "get_approved_job",
  "get_campaign_results",
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
    tier: "coordinator",
    modes: ["squad", "lifecycle"],
    taskClass: "orchestrate",
    summary:
      "Sits at the hub. Turns the brief into a work plan, hands out the pieces, checks each one, reconciles them and sends the client a single proposal.",
    use: "",
    tools: [
      "plan_campaign",
      "delegate_task",
      "review_work",
      "reconcile_plan",
      "request_compliance_review",
      "send_proposal",
      "request_decision",
      "read_team_output",
    ],
    deliverable: null,
  },
  {
    id: "audience-analyst",
    name: "Audience analyst",
    role: "spoke",
    tier: "worker",
    modes: ["squad", "lifecycle"],
    taskClass: "draft",
    summary:
      "Works out who to win and why: sizes the segments, reads the competition and the market signals, and cites the data behind every finding.",
    use: "who the campaign should win, how big each group is, what rivals are doing and which signals point to an opening",
    tools: [
      "get_audience_segments",
      "get_competitors",
      "get_market_signals",
      "report_research",
      "get_past_results",
      "get_hcp_universe",
      "propose_focus_areas",
      "build_audience",
      ...SHARED,
    ],
    deliverable: "report_research",
  },
  {
    id: "art-director",
    name: "Art director",
    role: "spoke",
    tier: "worker",
    modes: ["squad", "lifecycle"],
    taskClass: "draft",
    summary:
      "Sets the look: a named idea, a palette drawn from the brand book, and the approved images from the brand's asset library each placement uses.",
    use: "the campaign idea, its look and palette, and which approved images from the asset library it uses",
    tools: [
      "get_brand_guidelines",
      "find_approved_assets",
      "propose_creative",
      "get_claims_library",
      "propose_concepts",
      ...SHARED,
    ],
    deliverable: "propose_creative",
  },
  {
    id: "copy-lead",
    name: "Copy lead",
    role: "spoke",
    tier: "worker",
    modes: ["squad", "lifecycle"],
    taskClass: "draft",
    summary:
      "Finds the words: a line, the themes the campaign keeps returning to, and copy for each placement that fits its character limits.",
    use: "the campaign line, its recurring themes and the copy for each placement",
    tools: [
      "get_brand_guidelines",
      "get_channel_specs",
      "write_copy",
      "get_claims_library",
      "find_approved_assets",
      "draft_modules",
      ...SHARED,
    ],
    deliverable: "write_copy",
  },
  {
    id: "channel-planner",
    name: "Channel planner",
    role: "spoke",
    tier: "worker",
    modes: ["squad", "lifecycle"],
    taskClass: "draft",
    summary:
      "Decides where the money goes: which channels, how much in each, when each runs, and what it should return, priced from benchmarks.",
    use: "which channels to buy, the spend and dates for each, and the results to expect",
    tools: [
      "get_channel_benchmarks",
      "get_audience_segments",
      "plan_media",
      "get_approved_job",
      "schedule_deployment",
      ...SHARED,
    ],
    deliverable: "plan_media",
  },
  {
    id: "mlr-coordinator",
    name: "MLR coordinator",
    role: "spoke",
    tier: "coordinator",
    modes: ["lifecycle"],
    taskClass: "orchestrate",
    summary:
      "Runs the Medical, Legal and Regulatory review: anchors every claim to its reference passage, runs the quality check on each module as a whole, sets the review tier, submits the job to the reviewers, and prepares Form FDA 2253 at first use.",
    use: "the MLR job: claim-to-reference anchoring, the quality check and review tier, submission to the reviewers, and Form FDA 2253",
    tools: [
      "get_claims_library",
      "get_approved_job",
      "submit_mlr_job",
      "prepare_form_2253",
      ...SEMANTIC,
    ],
    deliverable: "submit_mlr_job",
  },
  {
    id: "performance-analyst",
    name: "Performance analyst",
    role: "spoke",
    tier: "worker",
    modes: ["lifecycle"],
    taskClass: "draft",
    summary:
      "Reads what happened in market by segment, decile and channel, compares it with past results, and recommends whether to continue, optimize or retire.",
    use: "in-market results, what they mean, and the next action",
    tools: ["get_campaign_results", "get_past_results", "report_performance", ...SEMANTIC],
    deliverable: "report_performance",
  },
];

export const teamAgentById = (id: string) => TEAM_AGENTS.find((agent) => agent.id === id);
export const isTeamSpecialist = (id: string): id is TeamSpecialist =>
  (TEAM_SPECIALISTS as readonly string[]).includes(id);
export const isLifecycleWorker = (id: string): id is LifecycleWorker =>
  isTeamSpecialist(id) || (LIFECYCLE_AGENTS as readonly string[]).includes(id);
/** The agents a run of this mode uses. */
export const teamAgentsFor = (mode: TeamMode) =>
  TEAM_AGENTS.filter((agent) => agent.modes.includes(mode));

export const TEAM_PARTY_LABELS: Record<TeamParty, string> = {
  client: "Client",
  team: "Whole squad",
  compliance: "Compliance",
  "campaign-lead": "Campaign lead",
  "audience-analyst": "Audience analyst",
  "art-director": "Art director",
  "copy-lead": "Copy lead",
  "channel-planner": "Channel planner",
  "mlr-coordinator": "MLR coordinator",
  "performance-analyst": "Performance analyst",
  "brand-lead": "Brand lead",
  medical: "Medical reviewer",
  legal: "Legal reviewer",
  regulatory: "Regulatory reviewer",
  "marketing-ops": "Marketing operations",
  market: "In market",
};

/**
 * The team's policies: the people's decisions (team.cedar), one link of the team-grants template
 * per agent with tools, and the squad and lifecycle rules (squad.cedar, lifecycle.cedar). Each
 * agent may call only its own tools; an operator's kill switch or a retired lifecycle withholds
 * all of them, and constrain keeps reads.
 */
export function buildTeamPolicies(overrides: AgentOverrides = {}): PolicySet {
  const agents: Record<string, AgentFacts> = {};
  const links: Policy[] = [];
  for (const agent of TEAM_AGENTS) {
    const lifecycle = overrides.lifecycle?.[agent.id] ?? "monitor";
    const disabled = overrides.disabled?.includes(agent.id) ?? false;
    const tools =
      disabled || lifecycle === "retire"
        ? []
        : lifecycle === "constrain"
          ? agent.tools.filter((tool) => TEAM_READ_TOOLS.includes(tool))
          : agent.tools;
    agents[agent.id] = {
      name: agent.name,
      grants: tools,
      scope: "any",
      lifecycle,
      disabled,
      role: agent.role,
      ...(agent.deliverable ? { deliverable: agent.deliverable } : {}),
    };
    if (tools.length)
      links.push(
        linkPolicy(
          "team-grants",
          `team-${agent.id}`,
          agent.id,
          tools.map((tool) => `team:${tool}`),
          `${agent.name} may call its own tools: ${tools.join(", ")}.`,
        ),
      );
  }
  const risks: Record<string, string> = Object.fromEntries([
    ...TEAM_TOOL_NAMES.map((tool) => [
      `team:${tool}`,
      TEAM_READ_TOOLS.includes(tool) ? "read" : "draft",
    ]),
    ...Object.values(TEAM_GATES).map((gate) => [gate.action, "decide"]),
  ]);
  return policySet(
    [...teamGatePolicies(), ...links, ...filePolicies("squad.cedar", "lifecycle.cedar")],
    agents,
    risks,
  );
}

// People in the loop ---------------------------------------------------------------------------

/**
 * The decisions no agent may take. A person in the browser takes each one, acting as the role
 * named here; the gateway checks the role, and forbids every agent.
 */
export const TEAM_GATES = {
  compliance: {
    label: "Compliance review",
    decider: "Compliance reviewer",
    personas: ["compliance", "admin"],
    action: "team:decide_compliance",
  },
  client: {
    label: "Client approval",
    decider: "Client (played by the brand lead)",
    personas: ["brand-lead", "admin"],
    action: "team:decide_proposal",
  },
  // The pharma lifecycle's people (team-pharma.ts lists where each one decides).
  focus: {
    label: "Choose the focus area",
    decider: "Brand lead",
    personas: ["brand-lead", "admin"],
    action: "team:decide_focus",
  },
  concept: {
    label: "Choose the concept",
    decider: "Brand lead",
    personas: ["brand-lead", "admin"],
    action: "team:decide_concept",
  },
  "concept-review": {
    label: "Early concept review",
    decider: "Medical reviewer",
    personas: ["reviewer", "admin"],
    action: "team:review_concept",
  },
  medical: {
    label: "Medical review",
    decider: "Medical reviewer",
    personas: ["reviewer", "admin"],
    action: "team:review_medical",
  },
  legal: {
    label: "Legal review",
    decider: "Legal reviewer",
    personas: ["senior", "admin"],
    action: "team:review_legal",
  },
  regulatory: {
    label: "Regulatory review and approval",
    decider: "Regulatory reviewer",
    personas: ["compliance", "admin"],
    action: "team:review_regulatory",
  },
  audience: {
    label: "Approve the HCP list",
    decider: "Marketing operations lead",
    personas: ["marketer", "admin"],
    action: "team:approve_audience",
  },
  "go-live": {
    label: "Approve go-live",
    decider: "Brand lead",
    personas: ["brand-lead", "admin"],
    action: "team:approve_go_live",
  },
  "fda-2253": {
    label: "Submit Form FDA 2253",
    decider: "Regulatory reviewer",
    personas: ["compliance", "admin"],
    action: "team:submit_2253",
  },
  "next-action": {
    label: "Decide the next action",
    decider: "Brand lead",
    personas: ["brand-lead", "admin"],
    action: "team:decide_next_action",
  },
} as const satisfies Record<
  string,
  { label: string; decider: string; personas: readonly Persona[]; action: string }
>;
export type TeamGate = keyof typeof TEAM_GATES;
export const isTeamGate = (value: unknown): value is TeamGate =>
  typeof value === "string" && value in TEAM_GATES;

/** How many times the client may send a proposal back before the run stops. */
export const CLIENT_ROUNDS = 2;

/** Brands whose copy must clear compliance before the client sees it: those with a disclosure. */
export const needsComplianceReview = (brand: Brand) =>
  teamMarket(brand).guidelines.requiredDisclosure !== null;

/**
 * Only these personas may take each decision, as team.cedar writes it (team-person-<gate>);
 * agents are never among them. A test holds the file to TEAM_GATES.
 */
export const teamGatePolicies = (): Policy[] => filePolicies("team.cedar");

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
  /** Approved images from the brand's asset library, each with where it is used. No image is made. */
  assets: Array<{ assetId: string; use: string }>;
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
  /** Proposed to the client; approved once the client says so. */
  status: "proposed" | "approved";
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
  | "delivery"
  | "approval-request"
  | "decision"
  | "handoff";

export type TeamAgentState = "idle" | "working" | "waiting" | "done" | "revising" | "blocked";

export type TeamToolStep = {
  tool: string;
  input: unknown;
  ok: boolean;
  decision?: { decision: string; policyId: string; reason: string };
  output?: unknown;
  error?: string;
};

/**
 * Hard limits on how much work the squad does before it stops and says why (team/limits.ts).
 * They sit above the per-step caps, so a model that keeps calling tools without finishing can't
 * spin through a run's budget.
 */
export const TEAM_LIMITS = {
  /** Tool calls one agent may make on one assignment without saving its work. */
  assignmentToolCalls: 16,
  /** Failed tool calls (refused, denied or rejected) one agent may make on one assignment. */
  assignmentFailures: 6,
  /** The same refusal this many times in a row ends an assignment. */
  sameRefusals: 3,
  /**
   * Tool calls the lead may make in one turn (between people's decisions). A squad turn with every
   * spoke sent back twice needs about 30; the old ceiling was 3 tries of 24 steps.
   */
  leadToolCallsPerTurn: 40,
  /** Model calls across a whole run, every resume included. */
  runModelCalls: 300,
  /** Tokens across a whole run, every resume included. */
  runTokens: 1_500_000,
} as const;
export type TeamLimit = keyof typeof TEAM_LIMITS;

/**
 * The per-step caps under the hard limits: each assignment or lead turn gets up to `tries` model
 * loops, each stopping after this many steps (a step is one model call and the tools it calls).
 */
export const TEAM_STEP_CAPS = {
  tries: 3,
  workerStepsPerTry: 10,
  squadLeadStepsPerTry: 24,
  lifecycleLeadStepsPerTry: 16,
} as const;

/** What a team run streams while it works, in order. */
export type TeamEvent =
  | {
      type: "start";
      id: string;
      /** squad when absent (runs saved before the lifecycle existed). */
      mode?: TeamMode;
      brief: CampaignBrief;
      models: Record<TeamAgentId, string>;
      /** The infrastructure this run is served by. */
      infra: {
        provider: TeamProvider;
        /** Where the open-model tier ran, when the run used it (ADR-021). */
        aiPlatform?: "workers-ai" | "vertex";
        aiGateway: string | null;
        policies: number;
        store: string;
        scripted: boolean;
      };
    }
  | {
      type: "model";
      /** Split, so a run can be priced; total is their sum. */
      inputTokens?: number;
      outputTokens?: number;
      /** Input tokens served from the provider's prompt cache, billed at its lower rate. */
      cachedInputTokens?: number;
      agent: TeamAgentId;
      model: string;
      purpose: "lead" | "work" | "answer" | "report";
      tokens: number;
      latencyMs: number;
      ok: boolean;
    }
  /** The system prompt, tools and settings an agent sent, once per distinct prompt. */
  | {
      type: "prompt";
      agent: TeamAgentId;
      purpose: "lead" | "work" | "answer" | "report";
      model: string;
      provider: TeamProvider;
      system: string;
      tools: string[];
      toolChoice?: string;
      settings: { effort?: string; temperature?: number; maxOutputTokens?: number };
      /** USD per million tokens, or null when the model has no recorded price. */
      price?: { input: number; cachedInput: number; output: number } | null;
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
  | { type: "reconciled"; strategy: CampaignStrategy }
  | {
      type: "await-person";
      gate: TeamGate;
      persona: Persona;
      title: string;
      why: string;
      /** For a choice: the options the person picks from, by id. */
      options?: Array<{ id: string; label: string; detail?: string }>;
    }
  | {
      type: "decided";
      gate: TeamGate;
      decision: "approve" | "changes";
      note: string;
      persona: Persona;
      /** The option the person chose, for a choice. */
      choice?: string;
    }
  /** The lifecycle moved into a phase, or finished one. */
  | { type: "phase"; phase: string; state: "active" | "done"; round: number }
  /** Something the lifecycle produced: an agent's saved work, or what the system issued. */
  | {
      type: "artifact";
      phase: string;
      name: string;
      by: TeamAgentId | "system";
      version: number;
      round: number;
      data: unknown;
    }
  | { type: "delivered"; strategy: CampaignStrategy }
  | { type: "evaluation"; scorecard: TeamScorecard }
  | {
      /** A hard limit stopped work: one agent's assignment, the lead's turn, or the whole run. */
      type: "limit";
      scope: "assignment" | "turn" | "run";
      agent: TeamAgentId;
      limit: TeamLimit;
      detail: string;
    }
  | { type: "done"; summary: string; tokens: number; latencyMs: number }
  | { type: "error"; message: string };

export const isMediaChannel = (value: string): value is MediaChannel =>
  (MEDIA_CHANNELS as readonly string[]).includes(value);
