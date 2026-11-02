// Read models for the registry, evaluations, models, prompts and trust views.
import {
  AGENT_DOMAINS,
  AGENT_REGISTRY,
  agentRoutes,
  baselineFor,
  buildPolicies,
  buildRiskMatrix,
  CHALLENGERS,
  CHAMPIONS,
  canPromote,
  detectDrift,
  EVALUATORS,
  effectiveAgent,
  identityChain,
  listObjects,
  MODEL_CATALOG,
  type ModelScore,
  type Persona,
  PROMPT_CATALOG,
  PROOF_RETENTION,
  runFarm,
  SHADOW_DAILY_COST_CAP_USD,
  SHADOW_SHARE,
  STAGE_LABELS,
  STAGE_OWNERS,
  STAGES,
  supportedAutonomy,
  TASK_CLASSES,
  toCedar,
} from "@northstar/architecture";
import { type Ctx, overridesFor } from "./context";

export async function registryView(ctx: Ctx) {
  const overrides = await overridesFor(ctx);
  const constraints = await ctx.store.agentConstraints();
  const agents = await Promise.all(
    AGENT_REGISTRY.map(async (agent) => {
      const effective = effectiveAgent(agent, overrides);
      const drift = detectDrift(agent.id, await ctx.store.evalSamples(agent.id, 20));
      return {
        ...agent,
        lifecycle: effective.lifecycle,
        disabled: effective.disabled,
        effectiveGrants: effective.grants,
        constraint: constraints.find((item) => item.agentId === agent.id) ?? null,
        samples: drift.samples,
      };
    }),
  );
  return {
    domains: AGENT_DOMAINS,
    stages: STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      owner: STAGE_OWNERS[stage],
    })),
    agents,
    policies: buildPolicies(overrides).map((policy) => ({ ...policy, cedar: toCedar(policy) })),
    lifecycle: ["introduce", "test", "monitor", "constrain", "retire"],
  };
}

export async function evaluationsView(ctx: Ctx) {
  const agents = await Promise.all(
    AGENT_REGISTRY.filter((agent) => agent.status === "live" && agent.grants.length > 0).map(
      async (agent) => {
        const samples = await ctx.store.evalSamples(agent.id, 20);
        const drift = detectDrift(agent.id, samples);
        const supported = supportedAutonomy(drift);
        return {
          id: agent.id,
          name: agent.name,
          lifecycle: effectiveAgent(agent, { lifecycle: await ctx.store.agentLifecycles() })
            .lifecycle,
          autonomy: agent.autonomy,
          supported,
          baseline: baselineFor(agent.id),
          drift,
        };
      },
    ),
  );
  return {
    evaluators: EVALUATORS.map(({ id, label, method, threshold }) => ({
      id,
      label,
      method,
      threshold,
    })),
    agents,
    notes: [
      "Deterministic evaluators score every agent run from its trace. The judge evaluator needs a judge run, so sampled production turns carry no judge score.",
      "Baselines are what a healthy deterministic agent scores: 1 on every evaluator its prompt names.",
      "Raising an agent's autonomy is a pull request; the evidence above only shows what it would support.",
    ],
  };
}

type EvalReport = { summaries?: Array<{ model: string; passed: number; total: number }> };

async function evalScores(ctx: Ctx, request: Request): Promise<Record<string, ModelScore>> {
  if (!ctx.env.ASSETS) return {};
  try {
    const response = await ctx.env.ASSETS.fetch(
      new Request(new URL("/evals/latest.json", request.url)),
    );
    if (!response.ok) return {};
    const report = (await response.json()) as EvalReport;
    const scores: Record<string, ModelScore> = {};
    for (const item of report.summaries ?? []) {
      const current = scores[item.model] ?? { passed: 0, total: 0 };
      scores[item.model] = {
        passed: current.passed + item.passed,
        total: current.total + item.total,
      };
    }
    return scores;
  } catch {
    return {};
  }
}

export async function modelsView(ctx: Ctx, request: Request) {
  const scores = await evalScores(ctx, request);
  return {
    models: MODEL_CATALOG.map((model) => ({ ...model, score: scores[model.id] ?? null })),
    taskClasses: TASK_CLASSES.map((taskClass) => {
      const champion = CHAMPIONS[taskClass];
      return {
        taskClass,
        champion,
        challengers: CHALLENGERS[taskClass].map((id) => ({
          id,
          promotion: canPromote(scores[champion], scores[id]),
        })),
      };
    }),
    routes: agentRoutes(AGENT_REGISTRY.filter((agent) => agent.status === "live")),
    shadow: { share: SHADOW_SHARE, dailyCostCapUsd: SHADOW_DAILY_COST_CAP_USD },
    adr: "docs/decisions/ADR-009-model-catalog-and-routing.md",
    note: "Routing governs the architecture agents. The chat orchestrator stays pinned to its champion (ADR-005) until a challenger beats it on the same evaluations and a pull request changes the catalog.",
  };
}

export function promptsView() {
  const agents = new Map(AGENT_REGISTRY.map((agent) => [agent.id, agent.name]));
  return {
    prompts: PROMPT_CATALOG.map((prompt) => ({
      ...prompt,
      agentName: agents.get(prompt.agentId) ?? prompt.agentId,
    })),
    note: "Prompts change by pull request. `pnpm prompts:check` fails when a prompt changes without a version bump, drops a hard rule, or binds free text.",
  };
}

export async function trustView(ctx: Ctx) {
  const world = await ctx.store.loadWorld(ctx.now());
  const [log, stats, coverage, transitions, constraints] = await Promise.all([
    ctx.store.gatewayLog(200),
    ctx.store.gatewayStats(),
    ctx.store.decisionCoverage(),
    ctx.store.countTransitions(),
    ctx.store.agentConstraints(),
  ]);
  const live = AGENT_REGISTRY.filter((agent) => agent.status === "live" && agent.grants.length > 0);
  const samples = (
    await Promise.all(live.map((agent) => ctx.store.evalSamples(agent.id, 20)))
  ).flat();
  const mean = (id: string) => {
    const values = samples.flatMap((sample) =>
      sample[id] === undefined ? [] : [sample[id] as number],
    );
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const findings = listObjects(world, { kind: "module" }).flatMap((module) =>
    runFarm(world, module.urn),
  );
  const drifted = (
    await Promise.all(
      live.map(async (agent) => detectDrift(agent.id, await ctx.store.evalSamples(agent.id, 20))),
    )
  )
    .filter((report) => report.drifted)
    .map((report) => report.agentId);
  const deniedDecisions = log.filter(
    (row) =>
      row.decision === "deny" &&
      /^(transition|supersede_claim|accept_optimization)$/.test(row.action),
  ).length;
  const matrix = buildRiskMatrix({
    gateway: {
      ...stats,
      recentDenies: log
        .filter((row) => row.decision === "deny")
        .slice(0, 5)
        .map((row) => ({
          action: row.action,
          principal: `${row.principalType}:${row.principalId}`,
          policyId: row.policyId,
          at: row.at,
        })),
    },
    traceCoverage: coverage,
    gapRecords: listObjects(world, { kind: "gap" }).length,
    groundingMean: mean("grounding"),
    farmFindings: {
      block: findings.filter((finding) => finding.severity === "block").length,
      warn: findings.filter((finding) => finding.severity === "warn").length,
    },
    piiMean: mean("pii-leakage"),
    transitions,
    deniedDecisions,
    constrainedAgents: constraints
      .filter((item) => item.lifecycle === "constrain")
      .map((item) => item.agentId),
    driftedAgents: drifted,
    agentsWithBaselines: live.length,
  });
  const chains = log.slice(0, 8).map((row) => {
    const request = {
      user: { subject: ctx.user.subject, persona: row.persona as Persona, brands: ctx.user.brands },
      principal: { type: row.principalType, id: row.principalId } as never,
      action: row.action,
    };
    const decision = {
      decision: row.decision,
      policyId: row.policyId,
      reason: row.reason,
      effect: "default" as const,
    };
    return {
      id: row.id,
      at: row.at,
      action: row.action,
      principal: `${row.principalType}:${row.principalId}`,
      decision: row.decision,
      correlationId: row.correlationId,
      chain: identityChain(request, decision, { tokenVerified: row.decision === "allow" }),
    };
  });
  return {
    matrix,
    chains,
    gateway: stats,
    retention: PROOF_RETENTION,
    kinds: [
      "Entra-style SSO is Cloudflare Access here; every other hop is verified in the gateway.",
    ],
  };
}

export const a2aCard = (agentId: string, origin: string) => {
  const agent = AGENT_REGISTRY.find((item) => item.id === agentId);
  if (!agent?.a2a) return null;
  return {
    name: agent.name,
    description: agent.summary,
    url: new URL(agent.a2a.endpoint, origin).toString(),
    version: agent.version,
    provider: { organization: "Salesforce (sandbox)", url: "https://developer.salesforce.com" },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [{ id: agent.id, name: agent.name, description: agent.a2a.contract }],
    "x-northstar": {
      identity: agent.a2a.identity,
      policy: agent.a2a.policy,
      humanGate: agent.humanGate,
      lifecycle: agent.lifecycle,
    },
  };
};
