import { describe, expect, it } from "vitest";
import { collectPolicies } from "../../../../scripts/generate-policies.mjs";
import {
  buildPolicies,
  CEDAR_POLICIES,
  CEDAR_SCHEMA,
  evaluate,
  type GatewayContext,
  type GatewayRequest,
  mergePolicies,
  type Principal,
  policySet,
  toolsAllowed,
  validatePolicies,
} from "../gateway.ts";
import { ACTION_RISK, AGENT_REGISTRY } from "../registry.ts";
import { PERSONAS } from "../state-machine.ts";
import {
  buildTeamPolicies,
  TEAM_AGENTS,
  TEAM_GATES,
  TEAM_READ_TOOLS,
  TEAM_TOOL_NAMES,
} from "../team.ts";
import { PHARMA_PHASES } from "../team-pharma.ts";
import { cedar } from "./engine.ts";

const user: GatewayRequest["user"] = { subject: "u", persona: "marketer", brands: "all" };
const all = () => mergePolicies(buildPolicies(), buildTeamPolicies());
const CAPABILITIES = Object.keys(ACTION_RISK);
const TEAM_ACTIONS = TEAM_TOOL_NAMES.map((tool) => `team:${tool}`);
const GATE_ACTIONS = Object.values(TEAM_GATES).map((gate) => gate.action);
const CHAT_ACTIONS = [
  "tool:get_graph_overview",
  "tool:check_clinical_claims",
  "tool:prepare_deal_release",
  "tool:graph_get_weather_forecast",
];
const CANDIDATES = [...CAPABILITIES, ...TEAM_ACTIONS, ...GATE_ACTIONS, ...CHAT_ACTIONS];
const AGENT_STEPS = PHARMA_PHASES.flatMap((phase) =>
  phase.steps.flatMap((step) => (step.kind === "agent" ? [step] : [])),
);

describe("Cedar policy files", () => {
  it("validate against the schema, and the generated module is current", () => {
    expect(validatePolicies()).toEqual([]);
    const { schema, policies } = collectPolicies();
    expect(schema).toBe(CEDAR_SCHEMA);
    expect(policies).toEqual(CEDAR_POLICIES);
  });

  it("would catch a typo: the validator refuses an attribute the schema lacks", () => {
    const answer = cedar().validate({
      schema: CEDAR_SCHEMA,
      policies: {
        staticPolicies: {
          typo: 'permit (principal is Agent, action == Action::"call", resource is Tool) when { principal.grant.contains(resource.name) };',
        },
      },
    });
    expect(answer.type === "success" && answer.validationErrors.length).toBeGreaterThan(0);
  });

  it("gives every policy an id and a note, and keeps the gates as TEAM_GATES has them", () => {
    for (const policy of CEDAR_POLICIES) expect(policy.note.length).toBeGreaterThan(10);
    const set = buildTeamPolicies();
    for (const [gate, spec] of Object.entries(TEAM_GATES))
      for (const persona of PERSONAS)
        expect(
          evaluate(set, { user, principal: { type: "persona", id: persona }, action: spec.action }),
          `${persona} on ${gate}`,
        ).toMatchObject(
          (spec.personas as readonly string[]).includes(persona)
            ? { decision: "allow", policyId: `team-person-${gate}` }
            : { decision: "deny" },
        );
  });
});

describe("offer equals allow", () => {
  const contexts: GatewayContext[] = [
    {},
    { surface: "chat", intents: ["claims"], done: ["check_clinical_claims"] },
    { surface: "squad" },
    ...AGENT_STEPS.map((step) => ({ surface: "lifecycle", stage: step.tool })),
    { surface: "lifecycle", stage: "a_step_no_file_names" },
  ];
  const principals: Principal[] = [
    ...AGENT_REGISTRY.map((agent) => ({ type: "agent" as const, id: agent.id })),
    ...TEAM_AGENTS.map((agent) => ({ type: "agent" as const, id: agent.id })),
    ...PERSONAS.map((persona) => ({ type: "persona" as const, id: persona })),
  ];

  // Team agents in every context; everyone else where they work. Each pair is decided twice,
  // once as an offer and once as a call, and the two must match.
  const cases = (overrides: Parameters<typeof buildPolicies>[0]) =>
    principals.flatMap((principal) =>
      (TEAM_AGENTS.some((agent) => agent.id === principal.id)
        ? contexts
        : contexts.slice(0, 3)
      ).map((context) => ({ overrides, principal, context })),
    );

  it("offers exactly the candidates each call would be allowed, in every context", () => {
    for (const { overrides, principal, context } of [
      ...cases({}),
      ...cases({ disabled: ["copy-lead", "orchestrator"], lifecycle: { brief: "constrain" } }),
    ]) {
      const policies = mergePolicies(buildPolicies(overrides), buildTeamPolicies(overrides));
      const offer = toolsAllowed({ policies, principal, user, context, candidates: CANDIDATES });
      for (const action of CANDIDATES) {
        const decision = evaluate(policies, { user, principal, action, context });
        expect(offer.decisions[action]).toEqual(decision);
        expect(offer.allowed.includes(action)).toBe(decision.decision === "allow");
      }
    }
  }, 30_000);

  it("never offers an agent more than its grants", () => {
    const policies = all();
    for (const agent of [...AGENT_REGISTRY, ...TEAM_AGENTS]) {
      if (agent.id === "orchestrator") continue;
      const grants: readonly string[] =
        "grants" in agent ? agent.grants : agent.tools.map((tool) => `team:${tool}`);
      for (const context of contexts) {
        const { allowed } = toolsAllowed({
          policies,
          principal: { type: "agent", id: agent.id },
          user,
          context,
          candidates: CANDIDATES,
        });
        for (const action of allowed) expect(grants, `${agent.id} ${action}`).toContain(action);
      }
    }
  });
});

describe("the pharma lifecycle", () => {
  const offered = (agent: string, stage: string) =>
    toolsAllowed({
      policies: all(),
      principal: { type: "agent", id: agent },
      user,
      context: { surface: "lifecycle", stage },
      candidates: TEAM_ACTIONS,
    }).allowed.map((action) => action.slice(5));

  it("offers each step its reads and its save, within the worker's grants", () => {
    expect(offered("audience-analyst", "propose_focus_areas").sort()).toEqual(
      [
        "get_audience_segments",
        "get_competitors",
        "get_market_signals",
        "get_past_results",
        "propose_focus_areas",
      ].sort(),
    );
    expect(offered("audience-analyst", "build_audience").sort()).toEqual(
      ["build_audience", "get_hcp_universe"].sort(),
    );
    expect(offered("mlr-coordinator", "submit_mlr_job").sort()).toEqual(
      ["get_claims_library", "submit_mlr_job"].sort(),
    );
    // The channel planner also holds get_audience_segments; deployment does not read it.
    expect(offered("channel-planner", "schedule_deployment").sort()).toEqual(
      ["get_approved_job", "get_channel_benchmarks", "schedule_deployment"].sort(),
    );
    // A step the file does not name gets its save only.
    expect(offered("copy-lead", "write_copy")).toEqual(["write_copy"]);
  });

  it("offers different tools at different steps, and every step can save", () => {
    const sets = AGENT_STEPS.map((step) => offered(step.agent, step.tool).sort().join(","));
    expect(new Set(sets).size).toBeGreaterThan(5);
    for (const step of AGENT_STEPS) expect(offered(step.agent, step.tool)).toContain(step.tool);
  });

  it("denies a read outside the step at call time, naming the step's policy", () => {
    expect(
      evaluate(all(), {
        user,
        principal: { type: "agent", id: "audience-analyst" },
        action: "team:get_competitors",
        context: { surface: "lifecycle", stage: "build_audience" },
      }),
    ).toMatchObject({ decision: "deny", policyId: "lifecycle-build_audience", effect: "forbid" });
  });
});

describe("decisions", () => {
  it("lets a forbid beat a permit: squad narrows a grant, and no agent decides", () => {
    // The copy lead holds draft_modules (a lifecycle tool), but a squad run does not offer it.
    const copy = { type: "agent", id: "copy-lead" } as const;
    expect(evaluate(all(), { user, principal: copy, action: "team:draft_modules" }).decision).toBe(
      "allow",
    );
    expect(
      evaluate(all(), {
        user,
        principal: copy,
        action: "team:draft_modules",
        context: { surface: "squad" },
      }),
    ).toMatchObject({ decision: "deny", policyId: "squad-spoke-tools", effect: "forbid" });
    expect(
      evaluate(all(), {
        user,
        principal: copy,
        action: "team:write_copy",
        context: { surface: "squad" },
      }),
    ).toMatchObject({ decision: "allow", policyId: "team-copy-lead" });
    // A team agent wrongly granted a person's decision is still refused.
    const facts = all().agents["copy-lead"];
    if (!facts) throw new Error("No facts for the copy lead.");
    const leaky = mergePolicies(
      all(),
      policySet([], { "copy-lead": { ...facts, grants: ["decide_proposal"] } }),
    );
    expect(
      evaluate(leaky, { user, principal: copy, action: "team:decide_proposal" }),
    ).toMatchObject({ decision: "deny", policyId: "forbid-agent-decisions" });
  });

  it("denies another brand's tools and objects, whoever calls", () => {
    const scoped = { ...user, brands: ["Lumera Therapeutics"] as const };
    const orchestrator = { type: "agent", id: "orchestrator" } as const;
    const offer = toolsAllowed({
      policies: all(),
      principal: orchestrator,
      user: scoped,
      context: { surface: "chat" },
      candidates: CHAT_ACTIONS,
    });
    // A graph_ prefix does not hide a tool's brand: the forecast is Coastline Kitchen's.
    expect(offer.allowed).toEqual(["tool:get_graph_overview", "tool:check_clinical_claims"]);
    expect(offer.decisions["tool:prepare_deal_release"]).toMatchObject({
      policyId: "forbid-out-of-scope-brand",
      reason: "Harborstone Wealth is outside this user's brand scope.",
    });
    expect(
      evaluate(all(), {
        user: scoped,
        principal: { type: "agent", id: "copy-lead" },
        action: "team:write_copy",
        resource: { brand: "Coastline Kitchen" },
      }).policyId,
    ).toBe("forbid-out-of-scope-brand");
  });

  it("withholds everything from a killed or retired agent, with the reason", () => {
    const killed = evaluate(buildPolicies({ disabled: ["orchestrator"] }), {
      user,
      principal: { type: "agent", id: "orchestrator" },
      action: "tool:get_graph_overview",
    });
    expect(killed).toMatchObject({ decision: "deny", policyId: "forbid-withheld-agent" });
    expect(killed.reason).toContain("Marketing orchestrator");
    expect(
      evaluate(buildPolicies({ lifecycle: { reuse: "retire" } }), {
        user,
        principal: { type: "agent", id: "reuse" },
        action: "read_object",
      }).policyId,
    ).toBe("forbid-withheld-agent");
  });

  it("names the agent in a linked grant's reason, and keeps scope by kind", () => {
    const decision = evaluate(buildPolicies(), {
      user,
      principal: { type: "agent", id: "reuse" },
      action: "reuse_modules",
      resource: { kind: "module" },
    });
    expect(decision).toMatchObject({
      decision: "allow",
      policyId: "agent-reuse",
      effect: "permit",
    });
    expect(decision.reason).toBe("Reuse agent (monitor) may call its registered grants on module.");
  });

  it("is cheap enough to decide twenty candidates per step", () => {
    const policies = all();
    const candidates = TEAM_ACTIONS.slice(0, 20);
    toolsAllowed({ policies, principal: { type: "agent", id: "copy-lead" }, user, candidates });
    const started = performance.now();
    for (let round = 0; round < 50; round += 1)
      toolsAllowed({
        policies,
        principal: { type: "agent", id: "copy-lead" },
        user,
        context: { surface: "squad" },
        candidates,
      });
    const perStep = (performance.now() - started) / 50;
    expect(perStep).toBeLessThan(20);
  });

  it("decides team tool risk from the roster", () => {
    const risks = buildTeamPolicies().risks;
    for (const tool of TEAM_READ_TOOLS) expect(risks[`team:${tool}`]).toBe("read");
    for (const action of GATE_ACTIONS) expect(risks[action]).toBe("decide");
  });
});
