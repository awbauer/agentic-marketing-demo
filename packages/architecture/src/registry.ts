import type { Persona } from "./state-machine.ts";
import type { ObjectKind } from "./types.ts";

export const AGENT_DOMAINS = ["commercial", "platform", "partner"] as const;
export type AgentDomain = (typeof AGENT_DOMAINS)[number];

/** The columns of the lifecycle. */
export const STAGES = [
  "plan",
  "audience",
  "brief",
  "create",
  "substantiate",
  "approve",
  "deploy",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  plan: "Plan",
  audience: "Audience",
  brief: "Brief",
  create: "Create",
  substantiate: "Substantiate",
  approve: "Approve",
  deploy: "Deploy & learn",
};

/** Plan → Audience → … → Deploy & learn, with the named person who decides at each stage. */
export const STAGE_OWNERS: Record<Stage, Persona> = {
  plan: "brand-planner",
  audience: "marketer",
  brief: "marketer",
  create: "content-lab",
  substantiate: "compliance",
  approve: "reviewer",
  deploy: "brand-lead",
};

export const LIFECYCLE_STAGES = ["introduce", "test", "monitor", "constrain", "retire"] as const;
export type AgentLifecycle = (typeof LIFECYCLE_STAGES)[number];

export const AUTONOMY_LEVELS = ["assistive", "orchestrated", "agentically-led"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

/** What an action can do. Agents never hold a `decide` action: people decide. */
export const ACTION_RISK = {
  read_object: "read",
  list_objects: "read",
  search_objects: "read",
  get_history: "read",
  read_registry: "read",
  read_trust: "read",
  reuse_modules: "read",
  assemble_evidence: "read",
  check_readiness: "read",
  run_farm: "read",
  check_data_readiness: "read",
  attribute_result: "read",
  evaluate: "read",
  route_model: "read",
  plan_content: "draft",
  run_scenario: "draft",
  draft_brief: "draft",
  author_module: "draft",
  atomize_module: "draft",
  propose_optimization: "draft",
  propose_transition: "propose",
  transition: "decide",
  supersede_claim: "decide",
  accept_optimization: "decide",
} as const;
export type ArchAction = keyof typeof ACTION_RISK;
export type ActionRisk = (typeof ACTION_RISK)[ArchAction];

export type A2ACard = {
  protocol: "a2a";
  endpoint: string;
  identity: string;
  policy: string;
  contract: string;
};

export type AgentManifest = {
  id: string;
  name: string;
  domain: AgentDomain;
  stage: Stage;
  version: string;
  owner: Persona;
  /** The kind of object the agent is scoped to. */
  scope: ObjectKind | "any";
  grants: readonly ArchAction[];
  lifecycle: AgentLifecycle;
  autonomy: Autonomy;
  /** The person who holds the decision for what this agent produces. */
  humanGate: { persona: Persona; stage: Stage };
  /** "live": built and callable. "planned": drawn on the swimlane, not built. */
  status: "live" | "planned";
  taskClass: "orchestrate" | "draft" | "classify" | "judge" | "embed" | "none";
  promptId?: string;
  summary: string;
  a2a?: A2ACard;
};

const live = (
  base: Omit<AgentManifest, "version" | "lifecycle" | "autonomy" | "status" | "humanGate"> &
    Partial<Pick<AgentManifest, "autonomy" | "lifecycle" | "version">>,
): AgentManifest => ({
  version: "1.0.0",
  lifecycle: "monitor",
  autonomy: "assistive",
  status: "live",
  humanGate: { persona: STAGE_OWNERS[base.stage], stage: base.stage },
  ...base,
});
const planned = (
  base: Omit<
    AgentManifest,
    | "version"
    | "lifecycle"
    | "autonomy"
    | "status"
    | "humanGate"
    | "grants"
    | "taskClass"
    | "scope"
    | "owner"
  >,
): AgentManifest => ({
  version: "0.0.0",
  lifecycle: "introduce",
  autonomy: "assistive",
  status: "planned",
  grants: [],
  taskClass: "none",
  scope: "any",
  owner: "admin",
  humanGate: { persona: STAGE_OWNERS[base.stage], stage: base.stage },
  ...base,
});

const partnerCard = (name: string, policy: string): A2ACard => ({
  protocol: "a2a",
  endpoint: `/a2a/${name}`,
  identity: `workload:partner/${name}`,
  policy,
  contract: "Salesforce Hosted MCP action over per-user OAuth; the prompt stays in Salesforce.",
});

/** One register for every agent: versioned, scoped to a named object, granted tools by policy. */
export const AGENT_REGISTRY: readonly AgentManifest[] = [
  live({
    id: "orchestrator",
    name: "Marketing orchestrator",
    domain: "commercial",
    stage: "brief",
    owner: "marketer",
    scope: "any",
    grants: [],
    taskClass: "orchestrate",
    summary: "The chat agent. Every model-called tool passes the gateway as tool:<name>.",
  }),
  live({
    id: "content-plan",
    name: "Content plan agent",
    domain: "commercial",
    stage: "plan",
    owner: "brand-planner",
    scope: "content-plan",
    grants: ["read_object", "list_objects", "plan_content"],
    taskClass: "draft",
    promptId: "content-plan",
    summary: "Turns brand goals, the calendar and past results into structured demand.",
  }),
  live({
    id: "scenario",
    name: "Scenario agent",
    domain: "commercial",
    stage: "plan",
    owner: "brand-planner",
    scope: "content-plan",
    grants: ["read_object", "run_scenario"],
    taskClass: "draft",
    promptId: "scenario",
    summary: "What-if on a wave: move a send, drop a channel, change an audience.",
  }),
  live({
    id: "brief",
    name: "Brief agent",
    domain: "commercial",
    stage: "brief",
    owner: "marketer",
    scope: "brief",
    grants: ["read_object", "draft_brief"],
    taskClass: "draft",
    promptId: "brief",
    summary: "Drafts a brief that inherits its plan by reference, never by copy.",
  }),
  live({
    id: "reuse",
    name: "Reuse agent",
    domain: "commercial",
    stage: "brief",
    owner: "marketer",
    scope: "module",
    grants: ["read_object", "list_objects", "search_objects", "reuse_modules"],
    taskClass: "embed",
    promptId: "reuse",
    summary: "Ranks approved modules for a brief by query and past results.",
  }),
  live({
    id: "module-authoring",
    name: "Module authoring agent",
    domain: "commercial",
    stage: "create",
    owner: "content-lab",
    scope: "module",
    grants: ["read_object", "list_objects", "author_module"],
    taskClass: "draft",
    promptId: "module-authoring",
    summary: "Cites an approved claim or refuses, and writes a gap record instead.",
  }),
  live({
    id: "atomization",
    name: "Atomization agent",
    domain: "commercial",
    stage: "create",
    owner: "content-lab",
    scope: "module",
    grants: ["read_object", "atomize_module"],
    taskClass: "draft",
    promptId: "atomization",
    summary: "Turns a master module into channel variants with their disclosures.",
  }),
  live({
    id: "substantiation",
    name: "Substantiation agent",
    domain: "commercial",
    stage: "substantiate",
    owner: "compliance",
    scope: "module",
    grants: ["read_object", "assemble_evidence"],
    taskClass: "classify",
    promptId: "substantiation",
    summary: "Assembles an evidence packet per claim a module cites.",
  }),
  live({
    id: "readiness",
    name: "Readiness agent",
    domain: "commercial",
    stage: "substantiate",
    owner: "compliance",
    scope: "module",
    grants: ["read_object", "assemble_evidence", "check_readiness", "propose_transition"],
    taskClass: "classify",
    promptId: "readiness",
    summary: "Blocks a module until its claims and disclosures hold up.",
  }),
  live({
    id: "attribution",
    name: "Attribution agent",
    domain: "commercial",
    stage: "deploy",
    owner: "brand-lead",
    scope: "result",
    grants: ["read_object", "attribute_result"],
    taskClass: "classify",
    promptId: "attribution",
    summary: "Ties a result to the module and claim that carried it.",
  }),
  live({
    id: "optimization",
    name: "Optimization agent",
    domain: "commercial",
    stage: "deploy",
    owner: "brand-lead",
    scope: "module",
    grants: ["read_object", "list_objects", "propose_optimization"],
    taskClass: "draft",
    promptId: "optimization",
    summary: "Proposes re-issue, refresh or retire. The brand lead disposes.",
  }),
  live({
    id: "governance-api",
    name: "Governance API",
    domain: "commercial",
    stage: "approve",
    owner: "reviewer",
    scope: "any",
    grants: [],
    taskClass: "none",
    summary: "The state machine: eleven transitions, each attributed and immutable.",
  }),
  live({
    id: "data-readiness",
    name: "Data readiness",
    domain: "platform",
    stage: "plan",
    owner: "admin",
    scope: "any",
    grants: ["read_object", "list_objects", "check_data_readiness"],
    taskClass: "classify",
    promptId: "data-readiness",
    summary: "Feeds every stage clean data, and scores each stage's inputs.",
  }),
  live({
    id: "knowledge-graph",
    name: "Knowledge and graph",
    domain: "platform",
    stage: "brief",
    owner: "admin",
    scope: "any",
    grants: [],
    taskClass: "embed",
    summary: "GraphRAG under brief and reuse (the existing knowledge-graph tools).",
  }),
  live({
    id: "adversarial-farm",
    name: "Adversarial farm",
    domain: "platform",
    stage: "create",
    owner: "admin",
    scope: "module",
    grants: ["read_object", "list_objects", "run_farm"],
    taskClass: "judge",
    promptId: "adversarial-farm",
    summary: "Probes drafts before humans see them. It reports and changes nothing.",
  }),
  live({
    id: "evaluations",
    name: "Evaluations",
    domain: "platform",
    stage: "approve",
    owner: "admin",
    scope: "any",
    grants: ["read_object", "evaluate", "route_model"],
    taskClass: "judge",
    summary: "Thirteen evaluators and drift watch.",
  }),
  planned({
    id: "devops",
    name: "DevOps agent",
    domain: "platform",
    stage: "deploy",
    summary: "Runs the machinery. Not built.",
  }),
  live({
    id: "salesforce-campaign-creation",
    name: "Salesforce Campaign Creation",
    domain: "partner",
    stage: "brief",
    owner: "marketer",
    scope: "any",
    grants: [],
    taskClass: "none",
    summary: "Marketing Cloud Next agent behind Hosted MCP; writes stay confirmed.",
    a2a: partnerCard("sf-campaign-creation", "Default-deny; writes need a signed confirmation."),
  }),
  live({
    id: "salesforce-content-builder",
    name: "Salesforce Content Builder",
    domain: "partner",
    stage: "create",
    owner: "content-lab",
    scope: "any",
    grants: [],
    taskClass: "none",
    summary: "Marketing Cloud Next content drafting; the prompt stays in Salesforce.",
    a2a: partnerCard("sf-content-builder", "Default-deny; read and draft only."),
  }),
  live({
    id: "salesforce-account-discovery",
    name: "Salesforce Account Discovery",
    domain: "partner",
    stage: "audience",
    owner: "marketer",
    scope: "any",
    grants: [],
    taskClass: "none",
    summary: "Answers account questions in its own house; data stays home.",
    a2a: partnerCard("sf-account-discovery", "Default-deny; read only."),
  }),
  planned({
    id: "sf-engagement",
    name: "Salesforce engagement agent",
    domain: "partner",
    stage: "plan",
    summary: "Planning insight from owned engagement data. Not built.",
  }),
  planned({
    id: "sf-activation",
    name: "Salesforce activation agent",
    domain: "partner",
    stage: "deploy",
    summary: "Constructs journeys and activates approved campaigns. Publish is out of scope.",
  }),
];

export const agentById = (id: string) => AGENT_REGISTRY.find((agent) => agent.id === id);

/** Operator and drift overrides applied on top of the manifest. */
export type AgentOverrides = {
  lifecycle?: Readonly<Record<string, AgentLifecycle>>;
  disabled?: readonly string[];
};

export function effectiveAgent(agent: AgentManifest, overrides: AgentOverrides = {}) {
  const lifecycle = overrides.lifecycle?.[agent.id] ?? agent.lifecycle;
  const disabled = overrides.disabled?.includes(agent.id) ?? false;
  // constrain withholds every action that is not a read; retire and disable withhold all.
  const grants =
    disabled || lifecycle === "retire"
      ? []
      : lifecycle === "constrain"
        ? agent.grants.filter((action) => ACTION_RISK[action] === "read")
        : agent.grants;
  return { ...agent, lifecycle, disabled, grants };
}
