// The architecture's operations. Each goes through the gateway; REST and MCP both call these.
import {
  AGENT_REGISTRY,
  type ApprovalState,
  acceptOptimization,
  agentById,
  allowedTransitions,
  approvalBlockers,
  attributesOf,
  BRANDS,
  type Brand,
  buildApprovalCard,
  checkTransition,
  claimPacket,
  detectDrift,
  type EvalTurn,
  evidencePacket,
  FACT,
  farmBlockers,
  type GovernedObject,
  getObject,
  lineage,
  listObjects,
  type ModuleAttributes,
  type OptimizationProposal,
  proposeOptimizations,
  resolveBrief,
  runFarm,
  scoreTurn,
  searchObjects,
  supersedeClaim,
  versionChain,
  type World,
} from "@northstar/architecture";
import { PRIMARY_ACTION, runModelAgent } from "./agent-runtime";

import { newRunState, type ToolStep, targetOf } from "./agent-tools";
import { ArchError, type Ctx, invoke, overridesFor } from "./context";
import { judgeRun } from "./judge";
import { ISO, need, worldFor } from "./objects";

const asPersona = (ctx: Ctx) => ({ type: "persona", id: ctx.user.persona }) as const;

// Reads -----------------------------------------------------------------------------------------

export async function listObjectsOp(
  ctx: Ctx,
  filter: { kind?: GovernedObject["kind"]; brand?: Brand; state?: ApprovalState },
) {
  const { value } = await invoke(
    ctx,
    { principal: asPersona(ctx), action: "list_objects" },
    async () => {
      const world = await worldFor(ctx);
      return listObjects(world, filter).filter(
        (object) => ctx.user.brands === "all" || ctx.user.brands.includes(object.brand),
      );
    },
  );
  return value;
}

export async function readObjectOp(ctx: Ctx, urn: string) {
  const world = await worldFor(ctx);
  const target = need(world, urn);
  const { value, chain, decision } = await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "read_object",
      resource: { urn, kind: target.kind, brand: target.brand },
    },
    async () => {
      const history = await ctx.store.history(urn);
      return {
        object: target,
        lineage: lineage(world, urn),
        versions: versionChain(world, urn).map((item) => ({
          urn: item.urn,
          version: item.version,
          approvalState: item.approvalState,
          supersedes: item.supersedes,
        })),
        history,
        allowed: allowedTransitions(target.approvalState, ctx.user.persona),
        brief: target.kind === "brief" ? resolveBrief(world, urn) : undefined,
        claim: target.kind === "claim" ? claimPacket(world, target) : undefined,
        packet: target.kind === "module" ? evidencePacket(world, urn) : undefined,
        findings: target.kind === "module" ? runFarm(world, urn) : undefined,
      };
    },
  );
  return { ...value, decision, chain };
}

export async function searchOp(ctx: Ctx, query: string) {
  const { value } = await invoke(
    ctx,
    { principal: asPersona(ctx), action: "search_objects" },
    async () => searchObjects(await worldFor(ctx), query, { brands: ctx.user.brands }),
  );
  return value;
}

export async function historyOp(ctx: Ctx, urn: string) {
  const world = await worldFor(ctx);
  const target = need(world, urn);
  const { value } = await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "get_history",
      resource: { urn, kind: target.kind, brand: target.brand },
    },
    () => ctx.store.history(urn),
  );
  return value;
}

export async function cardOp(ctx: Ctx, urn: string) {
  const world = await worldFor(ctx);
  const target = need(world, urn);
  const { value } = await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "read_object",
      resource: { urn, kind: target.kind, brand: target.brand },
    },
    () => buildApprovalCard(world, urn, ctx.user.persona),
  );
  return value;
}

// Decisions: only people, only through the state machine --------------------------------------

const NEEDS_REASON: ReadonlySet<ApprovalState> = new Set([
  "rejected",
  "escalated",
  "changes_requested",
  "withdrawn",
]);

export async function transitionOp(ctx: Ctx, urn: string, to: ApprovalState, reason?: string) {
  const world = await worldFor(ctx);
  const target = need(world, urn);
  await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "transition",
      resource: { urn, kind: target.kind, brand: target.brand },
    },
    () => null,
  );
  const check = checkTransition(target.approvalState, to, ctx.user.persona);
  if (!check.ok)
    throw new ArchError(check.code === "NOT_PERMITTED" ? 403 : 409, check.code, check.message);
  if (NEEDS_REASON.has(to) && !reason?.trim())
    throw new ArchError(400, "REASON_REQUIRED", `Moving to ${to} needs a reason.`);
  if (to === "approved") {
    const farm = target.kind === "module" ? farmBlockers(runFarm(world, urn)) : [];
    const blockers = approvalBlockers(world, urn, farm);
    if (blockers.length)
      throw new ArchError(409, "BLOCKED", "Readiness blocks approval until these are resolved.", {
        blockers,
      });
  }
  const done = await ctx.store.transition({
    urn,
    from: target.approvalState,
    to,
    actor: ctx.user.persona,
    actorType: "persona",
    reason,
    at: ISO(ctx),
  });
  if (!done)
    throw new ArchError(409, "STALE", "Someone moved this object first. Reload and try again.");
  return buildApprovalCard(await worldFor(ctx), urn, ctx.user.persona);
}

// Agents ----------------------------------------------------------------------------------------

type AgentInput = Record<string, unknown>;

const str = (input: AgentInput, key: string) => {
  const value = input[key];
  if (typeof value !== "string" || !value)
    throw new ArchError(400, "BAD_REQUEST", `${key} is required.`);
  return value;
};
const brandOf = (input: AgentInput): Brand => {
  const value = str(input, "brand");
  const brand = BRANDS.find((item) => item === value);
  if (!brand) throw new ArchError(400, "BAD_REQUEST", `Unknown brand ${value}.`);
  return brand;
};

/** What an agent run looked like to the evaluators. */
function evalTurnFor(
  agentId: string,
  action: string,
  input: AgentInput,
  output: unknown,
  world: World,
  module: GovernedObject | undefined,
  latencyMs: number,
  steps: readonly ToolStep[] = [],
): EvalTurn {
  const attributes = module ? attributesOf<ModuleAttributes>(module) : undefined;
  const findings = module ? runFarm(world, module.urn) : [];
  // Factual statements only: a cited claim, or uncited text that states a fact. An agent's own
  // framing is checked to state none when it is saved, so it is not counted against it.
  const statements = (attributes?.blocks ?? [])
    .filter((block) => !block.disclosureUrn && (block.claimUrn || FACT.test(block.text)))
    .map((block) => {
      const claim = block.claimUrn ? getObject(world, block.claimUrn) : undefined;
      return {
        text: block.text,
        ...(block.claimUrn ? { claimUrn: block.claimUrn } : {}),
        substantiated: claim ? claimPacket(world, claim).status === "substantiated" : false,
      };
    });
  const present = new Set(
    (attributes?.blocks ?? []).map((block) => block.disclosureUrn).filter(Boolean),
  );
  return {
    agentId,
    // The gateway's decision, not the call's outcome: wording a service sends back for another try
    // was allowed, and retrying it is the agent doing its job.
    calls: steps.map((step) => ({
      action: step.tool,
      decision: step.decision?.decision === "deny" ? ("deny" as const) : ("allow" as const),
    })),
    expectedAction: action,
    statements,
    requiredDisclosures: attributes?.requiredDisclosures.length ?? 0,
    presentDisclosures: (attributes?.requiredDisclosures ?? []).filter((urn) => present.has(urn))
      .length,
    brandViolations: findings.filter(
      (finding) => finding.probe === "brand-checker" && finding.severity === "block",
    ).length,
    inputs: JSON.stringify(input),
    output: JSON.stringify(output ?? null).slice(0, 4000),
    injectionPresent: findings.some((finding) => finding.probe === "injection-prober"),
    // Sampled runs are not judged for this; the injection probe flags the text, and an obeyed
    // instruction could still only reach the tools the agent's grants name.
    injectionObeyed: false,
    latencyMs,
    costUsd: 0,
  };
}

export async function checkDrift(ctx: Ctx, agentId: string) {
  const report = detectDrift(agentId, await ctx.store.evalSamples(agentId, 20));
  const lifecycles = await ctx.store.agentLifecycles();
  if (report.drifted && lifecycles[agentId] !== "constrain")
    await ctx.store.setLifecycle(
      agentId,
      "constrain",
      `Drift on ${report.evaluators
        .filter((item) => item.drifted)
        .map((item) => item.id)
        .join(", ")}.`,
      ISO(ctx),
    );
  return report;
}

/** The brand a run is for: its object's, or the one asked for, or the one in the header. */
function brandFor(ctx: Ctx, target: GovernedObject | undefined, input: AgentInput): Brand {
  if (target) return target.brand;
  if (typeof input.brand === "string") return brandOf(input);
  if (ctx.user.brands !== "all" && ctx.user.brands[0]) return ctx.user.brands[0];
  throw new ArchError(400, "BAD_REQUEST", "Choose a brand for this agent to work on.");
}

/**
 * Runs an agent on its model. The gateway first checks the action the run centres on; then the
 * agent works through its granted tools, each checked again. The run is sampled for the evaluators.
 */
export async function runAgentOp(
  ctx: Ctx,
  agentId: string,
  action: string,
  input: AgentInput,
  options: { task?: string; runTag?: string; onStep?: (step: ToolStep) => void } = {},
) {
  const agent = agentById(agentId);
  if (agent?.status !== "live" || !PRIMARY_ACTION[agentId])
    throw new ArchError(404, "NOT_FOUND", `${agentId} is not a live agent you can run.`);
  const world = await worldFor(ctx);
  const target = targetOf(world, input);
  if (Object.keys(input).some((key) => key.endsWith("Urn")) && !target)
    throw new ArchError(404, "NOT_FOUND", "That object does not exist.");
  const brand = brandFor(ctx, target, input);
  const kind = agent.scope === "any" ? undefined : agent.scope;
  const run = newRunState();
  if (options.onStep) run.onStep = options.onStep;
  const runTag = options.runTag ?? (typeof input.runTag === "string" ? input.runTag : undefined);
  const { value, decision, chain } = await invoke(
    ctx,
    {
      principal: { type: "agent", id: agentId },
      action,
      resource: { ...(target ? { urn: target.urn } : {}), ...(kind ? { kind } : {}), brand },
    },
    () =>
      runModelAgent(ctx, agent, {
        action,
        input,
        brand,
        world,
        run,
        ...(options.task ? { task: options.task } : {}),
        ...(runTag ? { runTag } : {}),
      }),
  );
  const turn = evalTurnFor(
    agentId,
    action,
    input,
    { summary: value.summary, result: value.result },
    await worldFor(ctx),
    // Content is scored only when the agent wrote it or moved it forward. An agent that inspects
    // a flawed module and reports the flaws did its job; the flaws are not its drift.
    run.moduleForEval,
    value.latencyMs,
    value.steps,
  );
  const judged = await judgeRun(ctx.env, {
    agent: agent.name,
    task: options.task ?? action,
    input,
    summary: value.summary,
    result: value.result,
  });
  if (judged !== undefined) turn.judgeScore = judged;
  const { scores } = scoreTurn(turn);
  await ctx.store.saveEvalSample(agentId, ISO(ctx), scores);
  const drift = await checkDrift(ctx, agentId);
  return {
    ...value,
    decision,
    chain,
    scores,
    drift: { drifted: drift.drifted, samples: drift.samples },
  };
}

// Claims and the loop ---------------------------------------------------------------------------

export async function supersedeClaimOp(
  ctx: Ctx,
  urn: string,
  next: { text: string; evidence: { source: string; asOf: string; expiresOn: string } },
) {
  const world = await worldFor(ctx);
  const claim = need(world, urn, "claim");
  await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "supersede_claim",
      resource: { urn, kind: "claim", brand: claim.brand },
    },
    () => null,
  );
  if (
    !next.text?.trim() ||
    !next.evidence?.source ||
    !next.evidence.asOf ||
    !next.evidence.expiresOn
  )
    throw new ArchError(
      400,
      "BAD_REQUEST",
      "The new text and its evidence (source, asOf, expiresOn) are required.",
    );
  let result: ReturnType<typeof supersedeClaim>;
  try {
    result = supersedeClaim(world, urn, next, `user:${ctx.user.persona}`);
  } catch (error) {
    throw new ArchError(
      409,
      "CONFLICT",
      error instanceof Error ? error.message : "Could not supersede.",
    );
  }
  await ctx.store.saveObjects([result.claim, result.evidence]);
  // The old claim is withdrawn by the supersession, recorded as a system transition with its cause.
  if (claim.approvalState === "approved")
    await ctx.store.transition({
      urn,
      from: "approved",
      to: "withdrawn",
      actor: `supersession by ${ctx.user.persona}`,
      actorType: "system",
      reason: `Superseded by ${result.claim.urn}.`,
      at: ISO(ctx),
    });
  const after = await worldFor(ctx);
  return {
    claim: result.claim,
    withdrawn: urn,
    flagged: result.flagged.map((flagged) => ({
      urn: flagged,
      title: getObject(after, flagged)?.title ?? flagged,
    })),
  };
}

/**
 * The performance signals behind the optimization agent: modules below their channel baseline and
 * modules citing a superseded claim. A read, so the Performance screen doesn't run a model on every
 * view; the agent itself runs from Agents, the Performance tab's form, or a sample flow.
 */
export async function optimizationsOp(ctx: Ctx, requested?: Brand) {
  // The header brand scopes proposals like every other read; a query brand can only narrow it.
  const brand = requested ?? (ctx.user.brands === "all" ? undefined : ctx.user.brands[0]);
  const { value } = await invoke(
    ctx,
    {
      principal: { type: "persona", id: ctx.user.persona },
      action: "list_objects",
      ...(brand ? { resource: { brand } } : {}),
    },
    async () => proposeOptimizations(await worldFor(ctx), brand),
  );
  return { result: value };
}

export async function acceptOptimizationOp(ctx: Ctx, proposalId: string) {
  const world = await worldFor(ctx);
  const proposal: OptimizationProposal | undefined = proposeOptimizations(world).find(
    (item) => item.id === proposalId,
  );
  if (!proposal) throw new ArchError(404, "NOT_FOUND", `${proposalId} is not an open proposal.`);
  await invoke(
    ctx,
    {
      principal: asPersona(ctx),
      action: "accept_optimization",
      resource: { brand: proposal.brand },
    },
    () => null,
  );
  const { plan, waveId } = acceptOptimization(world, proposal, `user:${ctx.user.persona}`);
  await ctx.store.saveObjects([plan]);
  return { plan, waveId, proposal };
}

// Maintenance: expiry and drift --------------------------------------------------------------

/** Approved objects whose evidence has all expired move to `expired`, recorded as the system. */
export async function expireOp(ctx: Ctx) {
  const world = await worldFor(ctx);
  const expired: string[] = [];
  for (const claim of listObjects(world, { kind: "claim", state: "approved" })) {
    if (claimPacket(world, claim).status !== "expired-evidence") continue;
    const done = await ctx.store.transition({
      urn: claim.urn,
      from: "approved",
      to: "expired",
      actor: "system",
      actorType: "system",
      reason: "All evidence for this claim has expired.",
      at: ISO(ctx),
    });
    if (done) expired.push(claim.urn);
  }
  return { expired };
}

export async function driftSweep(ctx: Ctx) {
  const reports = [];
  for (const agent of AGENT_REGISTRY)
    if (agent.status === "live" && agent.grants.length > 0)
      reports.push(await checkDrift(ctx, agent.id));
  return reports;
}

export { overridesFor };
