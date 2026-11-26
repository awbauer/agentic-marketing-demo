// Turns a squad run's event log into what the page draws: where each agent is, the messages they
// passed, the tool calls each made, every saved version of each spoke's work, the work plan, any
// clashes, and the proposal the client gets. Pure, so a live run, a reloaded run and a
// replay all render the same way.
import {
  type ArtifactName,
  applyDecision,
  type CampaignBrief,
  type CampaignStrategy,
  type ClaimGap,
  type Conflict,
  type LifecycleState,
  newLifecycle,
  phaseOfGate,
  recordArtifact,
  type SeededFlaw,
  TEAM_AGENTS,
  TEAM_SPECIALISTS,
  type TeamAgentId,
  type TeamAgentState,
  type TeamEvent,
  type TeamGate,
  type TeamMessageKind,
  type TeamMode,
  type TeamParty,
  type TeamPlan,
  type TeamScorecard,
  type TeamSpecialist,
  type TeamToolStep,
} from "@northstar/architecture";

export type TeamMessage = {
  id: string;
  from: TeamParty;
  to: TeamParty;
  kind: TeamMessageKind;
  text: string;
};

export type AgentView = {
  state: TeamAgentState;
  note?: string;
  /** What the agent last did, from its latest tool call. */
  activity?: string;
  tools: TeamToolStep[];
  versions: Array<{ version: number; output: unknown; tokens: number; latencyMs: number }>;
  review?: { verdict: "accept" | "revise"; feedback: string };
  revisions: number;
};

/** What each kind of message is called on the page. */
export const KIND_LABELS: Record<TeamMessageKind, string> = {
  brief: "Brief",
  plan: "Work plan",
  directive: "Assignment",
  report: "Work returned",
  question: "Side question",
  answer: "Reply",
  review: "Kept",
  revision: "Sent back",
  proposal: "Combined",
  delivery: "Proposal",
  "approval-request": "Review request",
  decision: "Decision",
  handoff: "Sent on",
};

/** The phases a run moves through, shown as a progress strip. */
export const TEAM_PHASES = [
  { id: "brief", label: "Brief in" },
  { id: "plan", label: "Work plan" },
  { id: "pieces", label: "Pieces kept" },
  { id: "reconcile", label: "Reconciled" },
  { id: "proposal", label: "Proposal sent" },
  { id: "approved", label: "Client approved" },
] as const;
export type TeamPhase = (typeof TEAM_PHASES)[number]["id"];

/**
 * A guardrail that stopped an agent: a rule check refusing a save, the policy gateway denying a
 * call, or a tool's input contract rejecting it. The same refusal repeated in a row is one hit
 * with a count; a hit is fixed once the same agent's next call to that tool succeeds.
 */
export type GuardrailHit = {
  agent: TeamAgentId;
  tool: string;
  kind: "rule" | "gateway" | "contract" | "limit";
  /** What the guardrail said, as the agent received it. */
  detail: string;
  policyId?: string;
  count: number;
  fixed: boolean;
};

const REFUSED = /^Refused\. Fix every problem and save again:\s*/;
const REJECTED = /^Rejected before it ran:\s*/;

/** The guardrail a tool call ran into, if any. A prose answer the worker nudges is not one. */
export function guardrailOf(
  step: TeamToolStep,
): Pick<GuardrailHit, "kind" | "detail" | "policyId"> | null {
  if (step.decision?.decision === "deny")
    return { kind: "gateway", detail: step.decision.reason, policyId: step.decision.policyId };
  if (step.ok || !step.error) return null;
  if (REFUSED.test(step.error)) return { kind: "rule", detail: step.error.replace(REFUSED, "") };
  if (REJECTED.test(step.error))
    return { kind: "contract", detail: step.error.replace(REJECTED, "") };
  return null;
}

/** Adds a tool call to the guardrail log: a new hit, a repeat of the last one, or a fix. */
function logGuardrail(hits: GuardrailHit[], agent: TeamAgentId, step: TeamToolStep) {
  const hit = guardrailOf(step);
  if (!hit) {
    if (!step.ok) return hits;
    // A call that went through fixes what stopped this agent's earlier calls to the same tool.
    return hits.some((item) => item.agent === agent && item.tool === step.tool && !item.fixed)
      ? hits.map((item) =>
          item.agent === agent && item.tool === step.tool ? { ...item, fixed: true } : item,
        )
      : hits;
  }
  const last = hits.at(-1);
  if (
    last &&
    !last.fixed &&
    last.agent === agent &&
    last.tool === step.tool &&
    last.kind === hit.kind &&
    last.detail === hit.detail
  )
    return [...hits.slice(0, -1), { ...last, count: last.count + 1 }];
  return [...hits, { agent, tool: step.tool, ...hit, count: 1, fixed: false }];
}

export type TeamState = {
  id: string | null;
  mode: TeamMode;
  /** Where a lifecycle run is, folded with the same rules the server applies. */
  lifecycle: LifecycleState | null;
  /** Every artifact a lifecycle run produced, in order, each with the phase it belongs to. */
  artifacts: Array<Extract<TeamEvent, { type: "artifact" }>>;
  brief: CampaignBrief | null;
  models: Partial<Record<TeamAgentId, string>>;
  agents: Record<TeamAgentId, AgentView>;
  messages: TeamMessage[];
  plan: TeamPlan | null;
  conflicts: Conflict[];
  strategy: CampaignStrategy | null;
  /** Phases reached. Pieces counts as reached once all four spokes' work is kept. */
  phases: Set<TeamPhase>;
  /** Spokes whose work the lead has kept. */
  kept: number;
  /** The message passing now: the diagram lights its edge. */
  latest: TeamMessage | null;
  done: { summary: string; tokens: number; latencyMs: number } | null;
  error: string | null;
  toolCalls: number;
  denied: number;
  /** Every guardrail an agent ran into, in order (repeats merged). */
  guardrails: GuardrailHit[];
  /** The infrastructure the run reported at its start. */
  infra: Extract<TeamEvent, { type: "start" }>["infra"] | null;
  modelCalls: Array<{
    agent: TeamAgentId;
    model: string;
    purpose: string;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    latencyMs: number;
    ok: boolean;
  }>;
  /** Each distinct system prompt an agent sent, with its tools and settings. */
  prompts: Array<Extract<TeamEvent, { type: "prompt" }>>;
  semantic: Array<{
    agent: TeamAgentId;
    tool: string;
    entity?: string;
    metrics: string[];
    terms?: string[];
  }>;
  /** Saves the rule services accepted, and saves they refused. */
  rules: { accepted: number; refused: number };
  saved: boolean | null;
  /** The person the run is waiting for, if any. */
  waiting: Extract<TeamEvent, { type: "await-person" }> | null;
  /** Decisions people have taken on this run, in order. */
  decisions: Array<
    Extract<TeamEvent, { type: "decided" }> & {
      choiceLabel?: string;
      /** The latest version of the work in the decision's phase, when the person decided. */
      signedOff?: { name: string; version: number };
    }
  >;
  /** The run's scorecard, once it has ended. */
  scorecard: TeamScorecard | null;
  /** Points the squad couldn't support with approved content: the gap log. */
  gaps: ClaimGap[];
  /** A flaw the MLR system seeded into the review queue, if the run seeds one. */
  seeded: SeededFlaw | null;
  /** Practices switched on for the run. */
  practice: { seededFlaw: boolean };
  events: number;
  /** The layer of the infrastructure the latest event touched. */
  layer: InfraLayer | null;
};

export type InfraLayer =
  | "experience"
  | "coordination"
  | "models"
  | "gateway"
  | "semantic"
  | "rules"
  | "bus"
  | "state"
  | "people";

export const SAVE_TOOLS = new Set([
  "report_research",
  "propose_creative",
  "write_copy",
  "plan_media",
  "propose_focus_areas",
  "propose_concepts",
  "draft_modules",
  "submit_mlr_job",
  "build_audience",
  "schedule_deployment",
  "prepare_form_2253",
  "report_performance",
]);
const toolLayer = (tool: string): InfraLayer =>
  SAVE_TOOLS.has(tool)
    ? "rules"
    : [
          "plan_campaign",
          "delegate_task",
          "review_work",
          "reconcile_plan",
          "send_proposal",
          "request_decision",
        ].includes(tool)
      ? "coordination"
      : ["ask_teammate", "answer_teammate", "read_team_output"].includes(tool)
        ? "bus"
        : "semantic";
const ACTIVITY: Record<string, string> = {
  get_audience_segments: "Reading segments",
  get_competitors: "Reading competitors",
  get_market_signals: "Reading market signals",
  get_brand_guidelines: "Reading the brand book",
  get_channel_specs: "Reading channel limits",
  get_channel_benchmarks: "Reading benchmarks",
  query_semantic_layer: "Querying the semantic layer",
  define_term: "Looking up a term",
  read_team_output: "Reading a teammate's work",
  ask_teammate: "Asking a teammate",
  answer_teammate: "Answering a teammate",
  report_research: "Saving findings",
  propose_creative: "Saving the look",
  write_copy: "Saving copy",
  plan_media: "Saving the channel plan",
  plan_campaign: "Writing the work plan",
  delegate_task: "Handing out a piece",
  review_work: "Reviewing a piece",
  reconcile_plan: "Reconciling the pieces",
  send_proposal: "Sending the proposal",
  request_decision: "Asking a person",
  get_past_results: "Reading past results",
  get_claims_library: "Reading the claims library",
  find_approved_assets: "Searching the asset library",
  get_hcp_universe: "Reading the HCP universe",
  get_approved_job: "Reading the approved job",
  get_campaign_results: "Reading the results",
  propose_focus_areas: "Saving focus areas",
  propose_concepts: "Saving concepts",
  draft_modules: "Saving modules",
  submit_mlr_job: "Submitting to MLR",
  build_audience: "Saving the HCP list",
  schedule_deployment: "Saving the schedule",
  prepare_form_2253: "Preparing Form 2253",
  report_performance: "Saving the performance read",
};

const blank = (): AgentView => ({ state: "idle", tools: [], versions: [], revisions: 0 });

export function emptyTeamState(): TeamState {
  return {
    id: null,
    mode: "squad",
    lifecycle: null,
    artifacts: [],
    brief: null,
    models: {},
    agents: Object.fromEntries(TEAM_AGENTS.map((agent) => [agent.id, blank()])) as Record<
      TeamAgentId,
      AgentView
    >,
    messages: [],
    plan: null,
    conflicts: [],
    strategy: null,
    phases: new Set(),
    kept: 0,
    latest: null,
    done: null,
    error: null,
    toolCalls: 0,
    denied: 0,
    guardrails: [],
    infra: null,
    modelCalls: [],
    prompts: [],
    semantic: [],
    rules: { accepted: 0, refused: 0 },
    saved: null,
    waiting: null,
    decisions: [],
    scorecard: null,
    gaps: [],
    seeded: null,
    practice: { seededFlaw: false },
    events: 0,
    layer: null,
  };
}

/** The work a lifecycle decision signed off: the latest artifact in that gate's phase. */
function signedOff(state: TeamState, gate: TeamGate) {
  const phase = phaseOfGate(gate)?.id;
  const latest = phase
    ? state.artifacts.filter((artifact) => artifact.phase === phase).at(-1)
    : undefined;
  return latest ? { signedOff: { name: latest.name, version: latest.version } } : {};
}

/** Applies one event. Returns a new state; the old one is left as it was. */
export function reduceTeam(state: TeamState, event: TeamEvent): TeamState {
  // A run saved by an older roster names agents this one doesn't have; skip those events.
  if ("agent" in event && !(event.agent in state.agents)) return state;
  const next: TeamState = {
    ...state,
    agents: { ...state.agents },
    phases: new Set(state.phases),
    events: state.events + 1,
  };
  const agent = (id: TeamAgentId) => {
    next.agents[id] = { ...next.agents[id] };
    return next.agents[id];
  };
  switch (event.type) {
    case "start":
      return {
        ...emptyTeamState(),
        id: event.id,
        mode: event.mode ?? "squad",
        lifecycle: event.mode === "lifecycle" ? newLifecycle() : null,
        brief: event.brief,
        models: event.models,
        infra: event.infra ?? null,
        practice: event.practice ?? { seededFlaw: false },
        events: 1,
        layer: "experience",
        phases: new Set<TeamPhase>(["brief"]),
      };
    case "status": {
      const view = agent(event.agent);
      view.state = event.state;
      if (event.state !== "working" && event.state !== "revising") delete view.activity;
      if (event.note) view.note = event.note;
      else delete view.note;
      return next;
    }
    case "message": {
      const message: TeamMessage = {
        id: event.id,
        from: event.from,
        to: event.to,
        kind: event.kind,
        text: event.text,
      };
      next.messages = [...state.messages, message];
      next.latest = message;
      next.layer = "bus";
      if (event.kind === "proposal") next.phases.add("reconcile");
      if (event.kind === "delivery") next.phases.add("proposal");
      return next;
    }
    case "plan":
      next.plan = event.plan;
      next.layer = "coordination";
      next.phases.add("plan");
      return next;
    case "tool": {
      const view = agent(event.agent);
      view.tools = [...view.tools, event.step];
      next.toolCalls += 1;
      if (event.step.decision?.decision === "deny") next.denied += 1;
      next.guardrails = logGuardrail(state.guardrails, event.agent, event.step);
      const label = ACTIVITY[event.step.tool] ?? event.step.tool;
      view.activity = event.step.ok ? label : `${label}: refused, fixing`;
      if (SAVE_TOOLS.has(event.step.tool) && event.step.decision?.decision === "allow")
        next.rules = {
          accepted: state.rules.accepted + (event.step.ok ? 1 : 0),
          refused: state.rules.refused + (event.step.ok ? 0 : 1),
        };
      next.layer =
        event.step.decision?.decision === "deny" ? "gateway" : toolLayer(event.step.tool);
      return next;
    }
    case "output": {
      const view = agent(event.agent);
      view.versions = [
        ...view.versions,
        {
          version: event.version,
          output: event.output,
          tokens: event.tokens,
          latencyMs: event.latencyMs,
        },
      ];
      next.layer = "state";
      return next;
    }
    case "review": {
      const view = agent(event.agent);
      view.review = { verdict: event.verdict, feedback: event.feedback };
      next.layer = "coordination";
      if (event.verdict === "revise") view.revisions += 1;
      if (event.verdict === "accept") {
        next.kept = TEAM_SPECIALISTS.filter(
          (id) => next.agents[id].review?.verdict === "accept",
        ).length;
        if (next.kept === TEAM_SPECIALISTS.length) next.phases.add("pieces");
      }
      return next;
    }
    case "conflicts":
      next.conflicts = event.conflicts;
      return next;
    case "delivered":
      next.strategy = event.strategy;
      next.phases.add("proposal");
      if (event.strategy.status === "approved") next.phases.add("approved");
      return next;
    case "model":
      next.modelCalls = [
        ...state.modelCalls,
        {
          agent: event.agent,
          model: event.model,
          purpose: event.purpose,
          tokens: event.tokens,
          ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
          ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
          ...(event.cachedInputTokens !== undefined
            ? { cachedInputTokens: event.cachedInputTokens }
            : {}),
          latencyMs: event.latencyMs,
          ok: event.ok,
        },
      ];
      next.layer = "models";
      return next;
    case "prompt":
      next.prompts = [...state.prompts, event];
      return next;
    case "semantic":
      next.semantic = [
        ...state.semantic,
        {
          agent: event.agent,
          tool: event.tool,
          metrics: event.metrics,
          ...(event.entity ? { entity: event.entity } : {}),
          ...(event.terms ? { terms: event.terms } : {}),
        },
      ];
      next.layer = "semantic";
      return next;
    case "reconciled":
      next.strategy = event.strategy;
      next.phases.add("reconcile");
      next.layer = "coordination";
      return next;
    case "await-person":
      next.waiting = event;
      next.latest = null;
      next.layer = "people";
      return next;
    case "decided":
      next.waiting = null;
      next.decisions = [
        ...state.decisions,
        {
          ...event,
          ...signedOff(state, event.gate),
          // The option's name, from the card the person chose on.
          ...(event.choice
            ? {
                choiceLabel:
                  state.waiting?.options?.find((option) => option.id === event.choice)?.label ??
                  event.choice,
              }
            : {}),
        },
      ];
      next.layer = "people";
      if (state.lifecycle && !["compliance", "client"].includes(event.gate)) {
        const lifecycle = structuredClone(state.lifecycle);
        try {
          applyDecision(lifecycle, event.gate, event.decision, {
            note: event.note,
            ...(event.choice ? { choice: event.choice } : {}),
          });
          next.lifecycle = lifecycle;
        } catch {
          // A log from an older lifecycle; leave the state as it was.
        }
      }
      return next;
    case "artifact": {
      if (state.lifecycle) {
        const lifecycle = structuredClone(state.lifecycle);
        recordArtifact(lifecycle, event.name as ArtifactName, event.by, event.data);
        next.lifecycle = lifecycle;
      }
      next.artifacts = [...state.artifacts, event];
      next.layer = event.by === "system" ? "rules" : "state";
      return next;
    }
    case "phase":
      next.layer = "coordination";
      return next;
    case "evaluation":
      next.scorecard = event.scorecard;
      return next;
    case "claim-gap":
      next.gaps = [...state.gaps, event.gap];
      next.layer = "rules";
      return next;
    case "seeded-flaw":
      next.seeded = event.seeded;
      return next;
    case "saved":
      next.saved = event.ok;
      next.layer = "state";
      return next;
    case "limit": {
      // A hard limit stopped work: shown with the guardrails, never merged with another hit.
      next.guardrails = [
        ...state.guardrails,
        {
          agent: event.agent,
          tool: event.limit,
          kind: "limit",
          detail: event.detail,
          count: 1,
          fixed: false,
        },
      ];
      return next;
    }
    case "done":
      next.done = { summary: event.summary, tokens: event.tokens, latencyMs: event.latencyMs };
      next.latest = null;
      return next;
    case "error":
      next.error = event.message;
      next.latest = null;
      // Whatever was mid-step when the run failed is stuck, not still working.
      for (const id of Object.keys(next.agents) as TeamAgentId[])
        if (["working", "revising"].includes(next.agents[id].state))
          next.agents[id] = { ...next.agents[id], state: "blocked", note: "Stopped by an error" };
      return next;
  }
}

export const foldTeam = (events: readonly TeamEvent[]) =>
  events.reduce(reduceTeam, emptyTeamState());

/** Whether a message went straight from one spoke to another, not through the lead. */
export const isPeerMessage = (message: TeamMessage) =>
  (TEAM_SPECIALISTS as readonly string[]).includes(message.from) &&
  (TEAM_SPECIALISTS as readonly string[]).includes(message.to);

/** The latest saved version of a spoke's work. */
export const latestWork = (state: TeamState, id: TeamSpecialist) =>
  state.agents[id].versions.at(-1)?.output;
