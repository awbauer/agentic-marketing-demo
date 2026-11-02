// The architecture's operations. Each goes through the gateway; REST and MCP both call these.
import {
  AGENT_REGISTRY,
  type ApprovalState,
  acceptOptimization,
  agentById,
  allowedTransitions,
  approvalBlockers,
  atomizeModule,
  attributeResult,
  attributesOf,
  authorModule,
  type Brand,
  buildApprovalCard,
  type Channel,
  checkReadiness,
  checkTransition,
  claimPacket,
  dataReadiness,
  detectDrift,
  draftBriefFromPlan,
  type EvalTurn,
  evidencePacket,
  farmBlockers,
  type GovernedObject,
  getObject,
  lineage,
  listObjects,
  type ModuleAttributes,
  type OptimizationProposal,
  planContent,
  proposeOptimizations,
  rankModules,
  resolveBrief,
  runFarm,
  runScenario,
  type ScenarioChange,
  scoreTurn,
  searchObjects,
  supersedeClaim,
  versionChain,
  type World,
} from "@northstar/architecture";
import { ArchError, type Ctx, invoke, overridesFor } from "./context";

const ISO = (ctx: Ctx) => ctx.now().toISOString();

async function worldFor(ctx: Ctx) {
  return ctx.store.loadWorld(ctx.now());
}

function need(world: World, urn: unknown, kind?: GovernedObject["kind"]): GovernedObject {
  if (typeof urn !== "string") throw new ArchError(400, "BAD_REQUEST", "A urn is required.");
  const object = getObject(world, urn);
  if (!object) throw new ArchError(404, "NOT_FOUND", `${urn} is not a governed object.`);
  if (kind && object.kind !== kind)
    throw new ArchError(400, "BAD_REQUEST", `${urn} is a ${object.kind}, not a ${kind}.`);
  return object;
}

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
  if (value !== "Harborstone Wealth" && value !== "Coastline Kitchen")
    throw new ArchError(400, "BAD_REQUEST", `Unknown brand ${value}.`);
  return value;
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
): EvalTurn {
  const attributes = module ? attributesOf<ModuleAttributes>(module) : undefined;
  const findings = module ? runFarm(world, module.urn) : [];
  const statements = (attributes?.blocks ?? [])
    .filter((block) => !block.disclosureUrn)
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
    calls: [{ action, decision: "allow" }],
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
    // Agents here are deterministic functions: none can obey text found in an object.
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

export async function runAgentOp(ctx: Ctx, agentId: string, action: string, input: AgentInput) {
  const agent = agentById(agentId);
  if (agent?.status !== "live")
    throw new ArchError(404, "NOT_FOUND", `${agentId} is not a live agent.`);
  const world = await worldFor(ctx);
  const started = Date.now();
  const objectUrn = ["moduleUrn", "briefUrn", "planUrn", "resultUrn", "claimUrn"]
    .map((key) => input[key])
    .find((value) => typeof value === "string") as string | undefined;
  const target = objectUrn ? need(world, objectUrn) : undefined;
  const brand =
    target?.brand ?? (typeof input.brand === "string" ? (input.brand as Brand) : undefined);
  // The resource is the kind of object the agent is scoped to, not whatever it was handed to read.
  const kind = agent.scope === "any" ? undefined : agent.scope;
  const resource = {
    ...(objectUrn ? { urn: objectUrn } : {}),
    ...(kind ? { kind } : {}),
    ...(brand ? { brand } : {}),
  };
  let moduleForEval: GovernedObject | undefined;
  const { value, decision, chain } = await invoke(
    ctx,
    { principal: { type: "agent", id: agentId }, action, resource },
    async () => {
      const actor = `agent:${agentId}`;
      switch (action) {
        case "plan_content": {
          const result = planContent(world, brandOf(input), actor);
          await ctx.store.saveObjects([result.plan]);
          return result;
        }
        case "run_scenario":
          return runScenario(world, str(input, "planUrn"), input.change as ScenarioChange);
        case "draft_brief": {
          const result = draftBriefFromPlan(
            world,
            str(input, "planUrn"),
            str(input, "waveId"),
            actor,
          );
          await ctx.store.saveObjects([result.brief]);
          return {
            ...result,
            resolved: resolveBrief(buildWorldWith(world, [result.brief]), result.brief.urn),
          };
        }
        case "reuse_modules": {
          const brief =
            typeof input.briefUrn === "string" ? need(world, input.briefUrn, "brief") : undefined;
          return rankModules(world, {
            brand: brief?.brand ?? brandOf(input),
            ...(brief ? { briefUrn: brief.urn } : {}),
            ...(typeof input.query === "string" ? { query: input.query } : {}),
            ...(typeof input.channel === "string" ? { channel: input.channel as Channel } : {}),
          });
        }
        case "author_module": {
          const result = authorModule(
            world,
            {
              briefUrn: str(input, "briefUrn"),
              topics: Array.isArray(input.topics) ? input.topics.map(String) : [],
              ...(typeof input.channel === "string" ? { channel: input.channel as Channel } : {}),
            },
            actor,
          );
          await ctx.store.saveObjects([...(result.module ? [result.module] : []), ...result.gaps]);
          if (result.module) moduleForEval = result.module;
          return result;
        }
        case "atomize_module": {
          const variants = atomizeModule(
            world,
            str(input, "moduleUrn"),
            (Array.isArray(input.channels) ? input.channels : ["push", "sms"]) as Channel[],
            actor,
          );
          await ctx.store.saveObjects(variants.map((item) => item.variant));
          return variants;
        }
        case "assemble_evidence":
          return evidencePacket(world, str(input, "moduleUrn"));
        case "check_readiness": {
          const urn = str(input, "moduleUrn");
          return checkReadiness(world, urn, { farmBlockers: farmBlockers(runFarm(world, urn)) });
        }
        case "propose_transition": {
          const urn = str(input, "moduleUrn");
          const module = need(world, urn, "module");
          const readiness = checkReadiness(world, urn, {
            farmBlockers: farmBlockers(runFarm(world, urn)),
          });
          if (module.approvalState !== "draft")
            return {
              proposed: false,
              reason: `Only a draft can be proposed; this one is ${module.approvalState}.`,
              blockers: [],
            };
          if (!readiness.ready)
            return {
              proposed: false,
              reason: "Readiness blocks submission.",
              blockers: readiness.blockers,
            };
          const done = await ctx.store.transition({
            urn,
            from: "draft",
            to: "submitted",
            actor: `agent:${agentId}`,
            actorType: "agent",
            reason: "Readiness passed; proposed for review.",
            at: ISO(ctx),
          });
          return {
            proposed: done,
            reason: done ? "Submitted for review." : "The state changed first.",
            blockers: [],
          };
        }
        case "attribute_result":
          return attributeResult(world, str(input, "resultUrn"));
        case "propose_optimization":
          return proposeOptimizations(
            world,
            typeof input.brand === "string" ? (input.brand as Brand) : undefined,
          );
        case "run_farm": {
          const urn = str(input, "moduleUrn");
          moduleForEval = need(world, urn, "module");
          return runFarm(world, urn);
        }
        case "check_data_readiness":
          return dataReadiness(world, brandOf(input));
        default:
          throw new ArchError(400, "BAD_REQUEST", `${agentId} has no action ${action}.`);
      }
    },
  );
  // Sample the run for the evaluators; drift is judged on the last twenty samples.
  const latency = Date.now() - started;
  const turn = evalTurnFor(
    agentId,
    action,
    input,
    value,
    await worldFor(ctx),
    moduleForEval ?? (target?.kind === "module" ? target : undefined),
    latency,
  );
  const { scores } = scoreTurn(turn);
  await ctx.store.saveEvalSample(agentId, ISO(ctx), scores);
  const drift = await checkDrift(ctx, agentId);
  return {
    agentId,
    action,
    decision,
    chain,
    result: value,
    scores,
    drift: { drifted: drift.drifted, samples: drift.samples },
  };
}

import { buildWorld } from "@northstar/architecture";

function buildWorldWith(world: World, extra: readonly GovernedObject[]) {
  return buildWorld({ now: world.now, runtime: [...world.objects.values(), ...extra] });
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

export async function optimizationsOp(ctx: Ctx, brand?: Brand) {
  return runAgentOp(ctx, "optimization", "propose_optimization", brand ? { brand } : {});
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
