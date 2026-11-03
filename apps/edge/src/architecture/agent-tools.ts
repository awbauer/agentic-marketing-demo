// The tools an architecture agent may call. Each is a backend service (the deterministic code in
// @northstar/architecture) behind the gateway: the agent decides what to ask for and writes its own
// words; the service enforces the rules and the gateway decides, per call, whether the agent may.
import {
  type AgentManifest,
  atomizeModule,
  attributeResult,
  attributesOf,
  authorModule,
  type Brand,
  CHANNELS,
  type ChainHop,
  type ClaimAttributes,
  checkReadiness,
  claimPacket,
  dataReadiness,
  draftBriefFromPlan,
  evidencePacket,
  farmBlockers,
  type GovernedObject,
  getObject,
  listObjects,
  OBJECT_KINDS,
  type PlanAttributes,
  planContent,
  planningInputs,
  proposeOptimizations,
  rankModules,
  resolveBrief,
  runFarm,
  runScenario,
  type ScenarioChange,
  searchObjects,
  successorOf,
  type World,
} from "@northstar/architecture";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { ArchError, type Ctx, invoke } from "./context";
import { ISO, need, persist, worldFor } from "./objects";

/** One tool call as the run records it, for the trace a person reads. */
export type ToolStep = {
  tool: string;
  input: unknown;
  ok: boolean;
  /** The gateway's decision for this call. */
  decision?: { decision: string; policyId: string; reason: string };
  output?: unknown;
  error?: string;
};

/** What a run collects while its agent works. */
export type RunState = {
  steps: ToolStep[];
  /** Objects the agent created, in order. */
  created: GovernedObject[];
  /** The last successful output of each tool, by name. */
  outputs: Record<string, unknown>;
  /** Findings the agent itself reported (the adversarial farm's own review). */
  findings: Array<{ probe: string; severity: "block" | "warn"; message: string }>;
  /** The module the agent wrote or moved forward, which its content scores count against. */
  moduleForEval?: GovernedObject;
  chain?: ChainHop[];
  /** Called as each tool call finishes, so a screen can show the agent working. */
  onStep?: (step: ToolStep) => void;
};

export const newRunState = (): RunState => ({ steps: [], created: [], outputs: {}, findings: [] });

type ToolContext = {
  ctx: Ctx;
  agent: AgentManifest;
  brand: Brand;
  run: RunState;
  /** Makes a sample flow's brief, and what is named after it, new for each run. */
  runTag?: string;
  /** Claim topics the person asked for: always considered, so a refusal is recorded, never dropped. */
  requestedTopics?: readonly string[];
};

/** A compact view of an object for a model to read: no history, nothing it doesn't need. */
export function objectView(world: World, object: GovernedObject) {
  const base = {
    urn: object.urn,
    kind: object.kind,
    title: object.title,
    brand: object.brand,
    state: object.approvalState,
    attributes: object.attributes,
  };
  if (object.kind === "brief") {
    const resolved = resolveBrief(world, object.urn);
    if (resolved) return { ...base, plan: resolved.inheritedFrom, wave: resolved.wave };
    // A brief just drafted is not in this world yet; read its wave from the plan it points at.
    const { planUrn, waveId } = object.attributes as { planUrn?: string; waveId?: string };
    const plan = planUrn ? getObject(world, planUrn) : undefined;
    const wave = plan
      ? attributesOf<PlanAttributes>(plan).waves.find((item) => item.id === waveId)
      : undefined;
    return { ...base, plan: plan ? { urn: plan.urn, version: plan.version } : undefined, wave };
  }
  return base;
}

const brandOnly = (world: World, object: GovernedObject, brand: Brand) => {
  if (object.brand !== brand)
    throw new ArchError(
      403,
      "DENIED",
      `${object.urn} belongs to ${object.brand}; this run is for ${brand}.`,
    );
  return world;
};

/** The tools for one agent: only those its registry grants name. */
export function toolsFor({
  ctx,
  agent,
  brand,
  run,
  runTag,
  requestedTopics = [],
}: ToolContext): Record<string, Tool> {
  const actor = `agent:${agent.id}`;
  const kind = agent.scope === "any" ? undefined : agent.scope;

  /** Runs one service call through the gateway, and records it. Errors go back to the model. */
  async function call<T>(
    name: string,
    grant: string,
    input: unknown,
    urn: string | undefined,
    work: (world: World) => Promise<T> | T,
  ): Promise<T | { error: string }> {
    try {
      const { value, decision, chain } = await invoke(
        ctx,
        {
          principal: { type: "agent", id: agent.id },
          action: grant,
          resource: { ...(urn ? { urn } : {}), ...(kind ? { kind } : {}), brand },
        },
        async () => work(await worldFor(ctx)),
      );
      run.chain ??= chain;
      run.outputs[name] = value;
      const step: ToolStep = { tool: name, input, ok: true, decision, output: value };
      run.steps.push(step);
      run.onStep?.(step);
      return value;
    } catch (failure) {
      const error =
        failure instanceof ArchError || failure instanceof Error
          ? failure.message
          : String(failure);
      const decision =
        failure instanceof ArchError
          ? (failure.extra.decision as ToolStep["decision"] | undefined)
          : undefined;
      const step: ToolStep = {
        tool: name,
        input,
        ok: false,
        error,
        ...(decision ? { decision } : {}),
      };
      run.steps.push(step);
      run.onStep?.(step);
      return { error };
    }
  }

  const save = async (world: World, objects: GovernedObject[]) => {
    await persist(ctx, world, objects);
    run.created.push(...objects);
  };
  const module = (world: World, urn: string) => {
    const object = need(world, urn, "module");
    brandOnly(world, object, brand);
    return object;
  };

  const all: Record<string, { grant: string; tool: Tool }> = {
    read_object: {
      grant: "read_object",
      tool: tool({
        description:
          "Read one governed object (plan, brief, module, claim, result, evidence, gap) by its urn.",
        inputSchema: z.object({ urn: z.string() }),
        execute: async (input) =>
          call("read_object", "read_object", input, input.urn, (world) => {
            const object = need(world, input.urn);
            return objectView(brandOnly(world, object, brand), object);
          }),
      }),
    },
    list_objects: {
      grant: "list_objects",
      tool: tool({
        description: "List this brand's governed objects of one kind, with their urns and states.",
        inputSchema: z.object({ kind: z.enum(OBJECT_KINDS) }),
        execute: async (input) =>
          call("list_objects", "list_objects", input, undefined, (world) =>
            listObjects(world, { kind: input.kind, brand }).map((object) => ({
              urn: object.urn,
              title: object.title,
              state: object.approvalState,
            })),
          ),
      }),
    },
    search_objects: {
      grant: "search_objects",
      tool: tool({
        description: "Search this brand's governed objects by meaning.",
        inputSchema: z.object({ query: z.string().min(2) }),
        execute: async (input) =>
          call("search_objects", "search_objects", input, undefined, (world) =>
            searchObjects(world, input.query, { brands: [brand] })
              .slice(0, 8)
              .map((hit) => ({ urn: hit.object.urn, title: hit.object.title, score: hit.score })),
          ),
      }),
    },
    get_planning_inputs: {
      grant: "read_object",
      tool: tool({
        description:
          "Read what a plan is built from: today's date, the brand's upcoming calendar, past results indexed against the channel baseline, and the waves already planned.",
        inputSchema: z.object({}),
        execute: async (input) =>
          call("get_planning_inputs", "read_object", input, undefined, (world) =>
            planningInputs(world, brand),
          ),
      }),
    },
    list_claims: {
      grant: "read_object",
      tool: tool({
        description:
          "List the brand's claims by topic, with their exact text and whether each is substantiated. Only a substantiated claim can be stated.",
        inputSchema: z.object({}),
        execute: async (input) =>
          call("list_claims", "read_object", input, undefined, (world) =>
            listObjects(world, { kind: "claim", brand })
              .filter((claim) => !successorOf(world, claim.urn))
              .map((claim) => {
                const packet = claimPacket(world, claim);
                return {
                  urn: claim.urn,
                  topic: attributesOf<ClaimAttributes>(claim).topic,
                  text: packet.text,
                  status: packet.status,
                  approvalState: claim.approvalState,
                };
              }),
          ),
      }),
    },
    plan_content: {
      grant: "plan_content",
      tool: tool({
        description:
          "Save a content plan for the brand: an objective and one or more waves. Each wave needs a theme, segment, audienceSize, channel, sendOn (YYYY-MM-DD, today or later) and a rationale that cites the calendar or past results.",
        inputSchema: z.object({
          objective: z.string().min(10),
          waves: z
            .array(
              z.object({
                theme: z.string(),
                segment: z.string(),
                audienceSize: z.number(),
                channel: z.enum(CHANNELS),
                sendOn: z.string(),
                rationale: z.string(),
              }),
            )
            .min(1)
            .max(6),
        }),
        execute: async (input) =>
          call("plan_content", "plan_content", input, undefined, async (world) => {
            const result = planContent(world, brand, actor, input);
            await save(world, [result.plan]);
            return { plan: objectView(world, result.plan), basis: result.basis };
          }),
      }),
    },
    run_scenario: {
      grant: "run_scenario",
      tool: tool({
        description:
          "Estimate what a change to a plan does to expected clicks. change.type is move-send (waveId, days: negative is earlier), drop-channel (channel) or change-audience (waveId, segment, audienceSize).",
        inputSchema: z.object({
          planUrn: z.string(),
          change: z.union([
            z.object({ type: z.literal("move-send"), waveId: z.string(), days: z.number() }),
            z.object({ type: z.literal("drop-channel"), channel: z.enum(CHANNELS) }),
            z.object({
              type: z.literal("change-audience"),
              waveId: z.string(),
              segment: z.string(),
              audienceSize: z.number(),
            }),
          ]),
        }),
        execute: async (input) =>
          call("run_scenario", "run_scenario", input, input.planUrn, (world) => {
            brandOnly(world, need(world, input.planUrn, "content-plan"), brand);
            return runScenario(world, input.planUrn, input.change as ScenarioChange);
          }),
      }),
    },
    draft_brief: {
      grant: "draft_brief",
      tool: tool({
        description:
          "Save a brief for one wave of a plan. Write the objective in one sentence of your own: what the content should achieve for its audience. An objective states no facts, so it needs no claim. The brief points at the plan for its audience, channel and timing.",
        inputSchema: z.object({
          planUrn: z.string(),
          waveId: z.string(),
          objective: z.string().min(10),
        }),
        execute: async (input) =>
          call("draft_brief", "draft_brief", input, input.planUrn, async (world) => {
            brandOnly(world, need(world, input.planUrn, "content-plan"), brand);
            const { brief } = draftBriefFromPlan(
              world,
              input.planUrn,
              input.waveId,
              actor,
              runTag,
              input.objective,
            );
            await save(world, [brief]);
            return { brief: objectView(world, brief) };
          }),
      }),
    },
    reuse_modules: {
      grant: "reuse_modules",
      tool: tool({
        description:
          "Rank this brand's existing modules for a brief or a query, by meaning and past results, with any that need a refresh flagged.",
        inputSchema: z.object({
          briefUrn: z.string().optional(),
          query: z.string().optional(),
          channel: z.enum(CHANNELS).optional(),
        }),
        execute: async (input) =>
          call("reuse_modules", "reuse_modules", input, input.briefUrn, (world) =>
            rankModules(world, {
              brand,
              ...(input.briefUrn ? { briefUrn: input.briefUrn } : {}),
              ...(input.query ? { query: input.query } : {}),
              ...(input.channel ? { channel: input.channel } : {}),
            }),
          ),
      }),
    },
    author_module: {
      grant: "author_module",
      tool: tool({
        description:
          "Write and save a module for a brief. Pass every topic that was requested, even ones you expect to be refused: the service inserts each substantiated claim's exact text with the disclosures it requires, and refuses the rest and records each as a gap. Write the rest as an email a person would read, in natural sentences. headline: the subject line, 12 words or fewer, naming the occasion and the product. opening: one or two short paragraphs before the claims, greeting the reader and setting the occasion (the meeting, the season, the date). closing: one or two short paragraphs after the claims, saying what to do next and signing off. Your own words may name the product, the occasion and dates, but may not state a number, price, outcome, benefit, comparison or reason: the claims say what the product does, word for word. A sentence that does is rejected with the words that did it.",
        inputSchema: z.object({
          briefUrn: z.string(),
          topics: z.array(z.string()).min(1),
          channel: z.enum(CHANNELS),
          headline: z.string().min(3).max(120),
          opening: z.array(z.string()).max(2),
          closing: z.array(z.string()).max(2),
        }),
        execute: async (input) =>
          call("author_module", "author_module", input, input.briefUrn, async (world) => {
            brandOnly(world, need(world, input.briefUrn, "brief"), brand);
            const topics = [...new Set([...input.topics, ...requestedTopics])];
            const result = authorModule(world, { ...input, topics }, actor);
            await save(world, [...(result.module ? [result.module] : []), ...result.gaps]);
            if (result.module) run.moduleForEval = result.module;
            return {
              module: result.module ? objectView(world, result.module) : undefined,
              refused: result.refused,
              gaps: result.gaps.map((gap) => ({ urn: gap.urn, title: gap.title })),
              assetsPassed: result.assetsPassed,
            };
          }),
      }),
    },
    atomize_module: {
      grant: "atomize_module",
      tool: tool({
        description:
          "Make channel versions of a module. Every claim stays whole; tight channels use each disclosure's short form. You may give each channel a headline in your own words (no facts).",
        inputSchema: z.object({
          moduleUrn: z.string(),
          channels: z.array(z.enum(CHANNELS)).min(1),
          headlines: z
            .object({ email: z.string(), push: z.string(), sms: z.string() })
            .partial()
            .optional(),
        }),
        execute: async (input) =>
          call("atomize_module", "atomize_module", input, input.moduleUrn, async (world) => {
            module(world, input.moduleUrn);
            const variants = atomizeModule(
              world,
              input.moduleUrn,
              input.channels,
              actor,
              input.headlines ?? {},
            );
            await save(
              world,
              variants.map((item) => item.variant),
            );
            run.moduleForEval = variants[0]?.variant;
            return variants.map((item) => ({ ...item, variant: objectView(world, item.variant) }));
          }),
      }),
    },
    assemble_evidence: {
      grant: "assemble_evidence",
      tool: tool({
        description:
          "Assemble the evidence packet for a module: for each cited claim, its evidence, expiry, supersession and conflicts.",
        inputSchema: z.object({ moduleUrn: z.string() }),
        execute: async (input) =>
          call("assemble_evidence", "assemble_evidence", input, input.moduleUrn, (world) => {
            module(world, input.moduleUrn);
            return evidencePacket(world, input.moduleUrn);
          }),
      }),
    },
    check_readiness: {
      grant: "check_readiness",
      tool: tool({
        description:
          "Check whether a module is ready for review: every claim substantiated, every disclosure present, no blocking probe findings.",
        inputSchema: z.object({ moduleUrn: z.string() }),
        execute: async (input) =>
          call("check_readiness", "check_readiness", input, input.moduleUrn, (world) => {
            module(world, input.moduleUrn);
            return checkReadiness(world, input.moduleUrn, {
              farmBlockers: farmBlockers(runFarm(world, input.moduleUrn)),
            });
          }),
      }),
    },
    propose_transition: {
      grant: "propose_transition",
      tool: tool({
        description:
          "Submit a draft module for review. The service refuses unless readiness passes. Submitting is the furthest an agent can move anything; a person decides after this.",
        inputSchema: z.object({ moduleUrn: z.string() }),
        execute: async (input) =>
          call(
            "propose_transition",
            "propose_transition",
            input,
            input.moduleUrn,
            async (world) => {
              const target = module(world, input.moduleUrn);
              const readiness = checkReadiness(world, input.moduleUrn, {
                farmBlockers: farmBlockers(runFarm(world, input.moduleUrn)),
              });
              if (target.approvalState !== "draft")
                return {
                  proposed: false,
                  reason: `Only a draft can be proposed; this one is ${target.approvalState}.`,
                  blockers: [],
                };
              if (!readiness.ready)
                return {
                  proposed: false,
                  reason: "Readiness blocks submission.",
                  blockers: readiness.blockers,
                };
              const done = await ctx.store.transition({
                urn: input.moduleUrn,
                from: "draft",
                to: "submitted",
                actor,
                actorType: "agent",
                reason: "Readiness passed; proposed for review.",
                at: ISO(ctx),
              });
              if (done) run.moduleForEval = target;
              return {
                proposed: done,
                reason: done ? "Submitted for review." : "The state changed first.",
                blockers: [],
              };
            },
          ),
      }),
    },
    run_farm: {
      grant: "run_farm",
      tool: tool({
        description:
          "Run the automatic probes on a module: uncited factual statements, instruction-like text, off-brand language and consent gaps.",
        inputSchema: z.object({ moduleUrn: z.string() }),
        execute: async (input) =>
          call("run_farm", "run_farm", input, input.moduleUrn, (world) => {
            module(world, input.moduleUrn);
            return runFarm(world, input.moduleUrn);
          }),
      }),
    },
    report_finding: {
      grant: "run_farm",
      tool: tool({
        description:
          "Report a concern you found yourself in the module's text that the automatic probes missed. It is advice to the reviewer, shown with the probes' findings; it does not block anything, because only the deterministic probes can.",
        inputSchema: z.object({
          probe: z.enum(["claim-attacker", "injection-prober", "brand-checker", "consent-prober"]),
          message: z.string().min(5),
        }),
        execute: async (input) =>
          call("report_finding", "run_farm", input, undefined, () => {
            run.findings.push({ ...input, severity: "warn" });
            return { recorded: true, note: "Recorded as a warning for the reviewer." };
          }),
      }),
    },
    attribute_result: {
      grant: "attribute_result",
      tool: tool({
        description: "Trace a result to the module and the claim that carried it.",
        inputSchema: z.object({ resultUrn: z.string() }),
        execute: async (input) =>
          call("attribute_result", "attribute_result", input, input.resultUrn, (world) => {
            brandOnly(world, need(world, input.resultUrn, "result"), brand);
            return attributeResult(world, input.resultUrn);
          }),
      }),
    },
    propose_optimization: {
      grant: "propose_optimization",
      tool: tool({
        description:
          "Read the brand's performance signals: modules running below their channel baseline, and modules citing a superseded claim, each with a suggested action.",
        inputSchema: z.object({}),
        execute: async (input) =>
          call("propose_optimization", "propose_optimization", input, undefined, (world) =>
            proposeOptimizations(world, brand),
          ),
      }),
    },
    check_data_readiness: {
      grant: "check_data_readiness",
      tool: tool({
        description:
          "Score the inputs each lifecycle stage depends on for this brand, with reasons.",
        inputSchema: z.object({}),
        execute: async (input) =>
          call("check_data_readiness", "check_data_readiness", input, undefined, (world) =>
            dataReadiness(world, brand),
          ),
      }),
    },
  };

  return Object.fromEntries(
    Object.entries(all)
      .filter(([, entry]) => (agent.grants as readonly string[]).includes(entry.grant))
      .map(([name, entry]) => [name, entry.tool]),
  );
}

/** The object a run is about, from the urns it was given, so the brand can be checked. */
export function targetOf(world: World, input: Record<string, unknown>) {
  for (const key of ["moduleUrn", "briefUrn", "planUrn", "resultUrn", "claimUrn"]) {
    const value = input[key];
    if (typeof value === "string") return getObject(world, value);
  }
  return undefined;
}
