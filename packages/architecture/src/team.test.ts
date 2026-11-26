import { describe, expect, it } from "vitest";
import { evaluate } from "./gateway.ts";
import {
  briefProblems,
  buildTeamPolicies,
  needsComplianceReview,
  type TeamEvent,
  type CopyPackage,
  type MediaPlan,
  type ResearchReport,
  TEAM_AGENTS,
  TEAM_BRIEFS,
  TEAM_TOOL_NAMES,
  runAiPlatform,
  teamBriefById,
  teamOpenModels,
  teamRunProviderLabel,
} from "./team.ts";
import { TEAM_MARKETS } from "./team-data.ts";
import { scoreChecks, scoreRun } from "./team-evals.ts";
import {
  costPerClick,
  defineTerm,
  projectedClicks,
  projectedImpressions,
  semanticQuery,
} from "./team-semantic.ts";
import {
  assetChoices,
  copyProblems,
  creativeProblems,
  findConflicts,
  reconcileCampaign,
  projectMedia,
  researchProblems,
} from "./team-services.ts";

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing");
  return value;
};
const coastline = must(teamBriefById("coastline-winter-warmup"));
const user = { subject: "u", persona: "marketer" as const, brands: "all" as const };

const research: ResearchReport = {
  primarySegmentId: "ck-seg-lunch-commuters",
  secondarySegmentIds: ["ck-seg-loyalty-regulars"],
  insights: [{ text: "Chowder searches rise in the cold.", sources: ["ck-sig-cold-weather"] }],
  opportunities: ["Own soup season."],
  competitorWatch: [{ competitorId: "ck-comp-bowl-bar", implication: "Lead on dine-in." }],
};
const copy: CopyPackage = {
  tagline: "Soup season is here",
  pillars: ["Warm", "Local"],
  assets: [
    {
      channel: "email",
      headline: "Soup's on",
      body: "Our winter menu is here.",
      cta: "See the menu",
    },
    {
      channel: "paid-search",
      headline: "Chowder near you",
      body: "Warm up downtown.",
      cta: "Find us",
    },
  ],
};
const media: MediaPlan = {
  lines: [
    {
      channel: "paid-search",
      budgetUsd: 8000,
      start: "2026-12-01",
      end: "2027-01-31",
      segmentId: "ck-seg-lunch-commuters",
      objective: "Capture intent",
    },
    {
      channel: "email",
      budgetUsd: 2000,
      start: "2026-12-01",
      end: "2027-01-15",
      segmentId: "ck-seg-loyalty-regulars",
      objective: "Win back",
    },
  ],
  kpis: ["Visits"],
  rationale: "Intent first.",
};
const creative = {
  name: "Warm Up",
  bigIdea: "Comfort close to home.",
  visualDirection: "Steam and fog.",
  palette: ["#1F4E79", "#f1e9da"],
  mood: "Cozy",
  assets: [{ assetId: "ck-img-chowder-hero", use: "Email hero" }],
  rationale: "Fits the commuters.",
};

describe("campaign squad", () => {
  it("gives each agent only its own tools, and every tool belongs to someone", () => {
    const policies = buildTeamPolicies();
    const allowed = (agent: string, tool: string) =>
      evaluate(policies, { user, principal: { type: "agent", id: agent }, action: `team:${tool}` })
        .decision;
    expect(allowed("copy-lead", "write_copy")).toBe("allow");
    expect(allowed("copy-lead", "plan_media")).toBe("deny");
    expect(allowed("audience-analyst", "delegate_task")).toBe("deny");
    expect(allowed("campaign-lead", "write_copy")).toBe("deny");
    const granted = new Set(TEAM_AGENTS.flatMap((agent) => agent.tools));
    expect([...granted].sort()).toEqual([...TEAM_TOOL_NAMES].sort());
  });

  it("withholds a disabled or retired agent's tools, and a constrained one keeps reads", () => {
    const deny = (overrides: Parameters<typeof buildTeamPolicies>[0], tool: string) =>
      evaluate(buildTeamPolicies(overrides), {
        user,
        principal: { type: "agent", id: "channel-planner" },
        action: `team:${tool}`,
      }).decision;
    expect(deny({ disabled: ["channel-planner"] }, "get_channel_benchmarks")).toBe("deny");
    expect(deny({ lifecycle: { "channel-planner": "retire" } }, "get_channel_benchmarks")).toBe(
      "deny",
    );
    expect(deny({ lifecycle: { "channel-planner": "constrain" } }, "get_channel_benchmarks")).toBe(
      "allow",
    );
    expect(deny({ lifecycle: { "channel-planner": "constrain" } }, "plan_media")).toBe("deny");
  });

  it("ships briefs that pass their own checks, and refuses broken ones", () => {
    for (const brief of TEAM_BRIEFS) expect(briefProblems(brief)).toEqual([]);
    expect(briefProblems({ ...coastline, budgetUsd: 5 })).toHaveLength(1);
    expect(briefProblems({ ...coastline, start: "2027-02-01", end: "2027-01-01" })).toEqual([
      "start must be on or before end.",
    ]);
  });

  it("only lets research cite data that exists", () => {
    expect(researchProblems("Coastline Kitchen", research)).toEqual([]);
    const invented = researchProblems("Coastline Kitchen", {
      ...research,
      insights: [
        { text: "Everyone loves soup.", sources: [] },
        { text: "x y z", sources: ["made-up"] },
      ],
    });
    expect(invented).toHaveLength(2);
  });

  it("holds the creative to the brand palette and approved, in-rights assets", () => {
    const window = { campaignEnd: coastline.end };
    expect(creativeProblems("Coastline Kitchen", creative, window)).toEqual([]);
    const off = creativeProblems(
      "Coastline Kitchen",
      {
        ...creative,
        palette: ["#00FF00"],
        assets: [
          { assetId: "ck-img-soup-counter", use: "Hero" },
          { assetId: "ck-img-price-tile", use: "Price" },
          { assetId: "ck-img-made-up", use: "Hero" },
        ],
      },
      window,
    ).join(" ");
    expect(off).toContain("#00FF00");
    // Its rights end before the campaign does.
    expect(off).toContain("ck-img-soup-counter can't be used: Usage rights end 2026-11-07");
    // It shows a price claim the content doesn't carry.
    expect(off).toContain("ck-img-price-tile can't be used: It shows chowder-price");
    expect(off).toContain("ck-img-made-up is not in Coastline Kitchen's asset library");
    // Pending and expired approvals are never usable.
    const lumera = assetChoices("Lumera Therapeutics", "2027-03-31");
    expect(lumera.find((item) => item.asset.id === "lt-img-superiority-chart")?.reason).toContain(
      "Pending",
    );
    expect(lumera.filter((item) => item.usable).map((item) => item.asset.id)).toEqual([
      "lt-img-congress-hero",
      "lt-img-cardivance-pack",
      "lt-img-logo",
    ]);
    // The Glucora hero's rights end in January, before this campaign does.
    expect(lumera.find((item) => item.asset.id === "lt-img-glucora-hero")?.reason).toContain(
      "2027-01-31",
    );
    // A chart that shows a claim is usable once the content cites that claim.
    expect(
      assetChoices("Coastline Kitchen", coastline.end, ["chowder-price"]).find(
        (item) => item.asset.id === "ck-img-price-tile",
      )?.usable,
    ).toBe(true);
  });

  it("checks copy limits, banned phrases as whole words, and required disclosures", () => {
    expect(copyProblems("Coastline Kitchen", copy)).toEqual([]);
    const long = copyProblems("Coastline Kitchen", {
      ...copy,
      assets: [{ ...must(copy.assets[1]), headline: "x".repeat(31) }],
    });
    expect(long[0]).toContain("limit is 30");
    const harborstone = TEAM_MARKETS["Harborstone Wealth"].guidelines;
    const missing = copyProblems("Harborstone Wealth", copy);
    expect(missing.filter((problem) => problem.includes("disclosure"))).toHaveLength(2);
    const disclosed = copyProblems("Harborstone Wealth", {
      ...copy,
      assets: copy.assets.map((asset) => ({
        ...asset,
        disclosure: must(harborstone.requiredDisclosure),
      })),
    });
    expect(disclosed).toEqual([]);
    // "cure" is banned for Lumera; "secure" is not.
    const lumera = must(TEAM_MARKETS["Lumera Therapeutics"].guidelines.requiredDisclosure);
    const asset = {
      channel: "email" as const,
      headline: "Secure your spot",
      body: "Data.",
      cta: "Read",
    };
    expect(
      copyProblems("Lumera Therapeutics", { ...copy, assets: [{ ...asset, disclosure: lumera }] }),
    ).toEqual([]);
    expect(
      copyProblems("Lumera Therapeutics", {
        ...copy,
        assets: [{ ...asset, headline: "A cure at last", disclosure: lumera }],
      }),
    ).toHaveLength(1);
  });

  it("projects media from benchmarks and refuses plans over budget or outside the window", () => {
    const projected = projectMedia(coastline, media);
    expect(projected.problems).toEqual([]);
    // $8,000 at a $38 CPM is 210,526 impressions; × 4.5% CTR × 1.3 affinity is 12,316 clicks.
    expect(projected.lines[0]).toMatchObject({ impressions: 210526, clicks: 12316 });
    expect(projected.remainingUsd).toBe(8000);
    const over = projectMedia(coastline, {
      ...media,
      lines: [{ ...must(media.lines[0]), budgetUsd: 20000, end: "2027-03-01" }],
    });
    expect(over.problems.join(" ")).toContain("over the $18,000 budget");
    expect(over.problems.join(" ")).toContain("outside the brief's window");
    const thin = projectMedia(coastline, {
      ...media,
      lines: [{ ...must(media.lines[0]), channel: "display", budgetUsd: 500 }],
    });
    expect(thin.problems).toEqual([
      "Line 1 (Display): $500 is under the $1000 minimum worth buying.",
    ]);
  });

  it("finds clashes between spokes, and reconciles only once each is resolved", () => {
    const outputs = {
      "audience-analyst": research,
      "art-director": creative,
      "copy-lead": copy,
      "channel-planner": {
        ...media,
        lines: [
          ...media.lines,
          { ...must(media.lines[0]), channel: "display" as const, budgetUsd: 2000 },
        ],
      },
    };
    expect(findConflicts(outputs).map((conflict) => conflict.id)).toEqual(["uncopied:display"]);
    const base = {
      positioning: "Soup season, close to the office.",
      milestones: [],
      successMetrics: [],
    };
    const refused = reconcileCampaign(coastline, outputs, { ...base, resolutions: [] });
    expect(refused.ok).toBe(false);
    const settled = reconcileCampaign(coastline, outputs, {
      ...base,
      resolutions: [
        { conflictId: "uncopied:display", resolution: "Display reuses the search copy." },
      ],
    });
    expect(settled.ok && settled.strategy.status).toBe("proposed");
    expect(settled.ok && settled.strategy.media.totalUsd).toBe(12000);
    const missing = reconcileCampaign(
      coastline,
      { "audience-analyst": research },
      { ...base, resolutions: [] },
    );
    expect(!missing.ok && missing.problems).toHaveLength(3);
  });
});

describe("semantic layer", () => {
  it("answers entity queries with governed rows and the definitions of their metrics", () => {
    const channels = semanticQuery("Coastline Kitchen", { entity: "channel", ids: ["email"] });
    expect(channels.rows).toEqual([
      expect.objectContaining({ channel: "email", cpm: 2.5, ctr: 0.031, min_spend: 300 }),
    ]);
    expect(channels.metrics).toContain("cpm");
    expect(channels.definitions.cpm).toContain("media cost ÷ impressions × 1,000");
    expect(channels.source).toBe("Media benchmark set");
    // Lumera does not buy paid social, so the layer has no such row for it.
    expect(
      semanticQuery("Lumera Therapeutics", { entity: "channel" }).rows.map((row) => row.channel),
    ).not.toContain("paid-social");
  });

  it("resolves business terms to the metric or entity they mean", () => {
    const cpc = defineTerm("Coastline Kitchen", "paid search CPC");
    expect(cpc.find((match) => match.kind === "metric")?.id).toBe("cost_per_click");
    expect(cpc.some((match) => match.kind === "entity" && match.id === "paid-search")).toBe(true);
    expect(
      defineTerm("Coastline Kitchen", "lapsed loyalty members").some(
        (match) => match.kind === "entity" && match.id === "ck-seg-loyalty-regulars",
      ),
    ).toBe(true);
    expect(defineTerm("Coastline Kitchen", "   ")).toEqual([]);
  });

  it("is the one source of the projection math", () => {
    const impressions = projectedImpressions(8000, 38);
    const clicks = projectedClicks(impressions, 0.045, 1.3);
    const line = projectMedia(coastline, media).lines[0];
    expect(line?.impressions).toBe(Math.round(impressions));
    expect(line?.clicks).toBe(Math.round(clicks));
    expect(line?.costPerClickUsd).toBe(costPerClick(8000, clicks));
  });
});

describe("people in the loop", () => {
  it("lets only the right people decide, and never an agent", () => {
    const policies = buildTeamPolicies();
    const as = (principal: { type: "persona" | "agent"; id: string }, action: string) =>
      evaluate(policies, { user, principal: principal as never, action }).decision;
    expect(as({ type: "persona", id: "compliance" }, "team:decide_compliance")).toBe("allow");
    expect(as({ type: "persona", id: "marketer" }, "team:decide_compliance")).toBe("deny");
    expect(as({ type: "persona", id: "brand-lead" }, "team:decide_proposal")).toBe("allow");
    expect(as({ type: "persona", id: "compliance" }, "team:decide_proposal")).toBe("deny");
    expect(as({ type: "agent", id: "campaign-lead" }, "team:decide_proposal")).toBe("deny");
    expect(needsComplianceReview("Harborstone Wealth")).toBe(true);
    expect(needsComplianceReview("Lumera Therapeutics")).toBe(true);
    expect(needsComplianceReview("Coastline Kitchen")).toBe(false);
  });
});

describe("squad evals", () => {
  const strategy = must(
    (() => {
      const result = reconcileCampaign(
        coastline,
        {
          "audience-analyst": research,
          "art-director": creative,
          "copy-lead": copy,
          "channel-planner": media,
        },
        { positioning: "Soup season.", milestones: [], successMetrics: [], resolutions: [] },
      );
      return result.ok ? result.strategy : undefined;
    })(),
  );
  const tool = (name: string, ok: boolean) =>
    ({
      type: "tool",
      agent: "copy-lead",
      step: {
        tool: name,
        input: {},
        ok,
        decision: { decision: "allow", policyId: "p", reason: "" },
      },
    }) as const;
  const events = [
    tool("write_copy", false),
    tool("write_copy", true),
    {
      type: "message",
      id: "m1",
      from: "art-director",
      to: "copy-lead",
      kind: "question",
      text: "?",
    },
    { type: "message", id: "m2", from: "copy-lead", to: "art-director", kind: "answer", text: "!" },
    { type: "reconciled", strategy },
    { type: "delivered", strategy },
    {
      type: "decided",
      gate: "client",
      decision: "changes",
      note: "More safety.",
      persona: "brand-lead",
    },
    { type: "decided", gate: "client", decision: "approve", note: "", persona: "brand-lead" },
    {
      type: "model",
      agent: "campaign-lead",
      model: "@cf/openai/gpt-oss-120b",
      purpose: "lead",
      tokens: 1000,
      latencyMs: 2000,
      ok: true,
    },
  ] as unknown as TeamEvent[];

  it("scores people's changes by whether the next version satisfied them", () => {
    const decided = (gate: string, decision: "approve" | "changes") =>
      ({ type: "decided", gate, decision, note: "", persona: "compliance" }) as TeamEvent;
    const people = (list: TeamEvent[]) =>
      scoreChecks(list, coastline).find((check) => check.id === "people");
    // Asked twice before approving: the first request wasn't met, the second was.
    expect(
      people([
        decided("compliance", "changes"),
        decided("compliance", "changes"),
        decided("compliance", "approve"),
      ])?.score,
    ).toBe(0.5);
    // Asked, and the run ended before the person saw a new version.
    expect(people([decided("client", "changes")])?.score).toBe(0);
    // Approved the first time.
    expect(people([decided("client", "approve")])?.detail).toBe(
      "All 1 decision approved the first version.",
    );
  });

  it("scores a run from its own events", () => {
    const checks = Object.fromEntries(
      scoreChecks(events, coastline).map((check) => [check.id, check]),
    );
    expect(checks.outcome?.score).toBe(1);
    expect(checks["first-try"]?.score).toBe(0.5);
    expect(checks.collaboration?.score).toBe(1);
    // The person who asked for changes approved the next version.
    expect(checks.people?.score).toBe(1);
    expect(checks.people?.detail).toContain("1 request for changes; 1 approved on the next review");
    // $10,000 of $18,000 is 56% of the budget: under the 80% that scores full marks.
    expect(checks.budget?.score).toBeCloseTo(0.694, 2);
    expect(checks.consistency?.score).toBe(1);
    expect(checks.grounding?.score).toBe(0.5);
  });

  it("blends the judge in, and leaves checks that don't apply out", () => {
    const withoutJudge = scoreRun({
      runId: "r",
      provider: "cloudflare",
      brief: coastline,
      events: [],
      judge: null,
      costUsd: null,
      at: "2026-11-20T00:00:00Z",
    });
    // Nothing happened: only the outcome applies, so an empty run scores 0, not a tidy 50.
    expect(
      withoutJudge.checks.filter((check) => check.score !== null).map((check) => check.id),
    ).toEqual(["outcome"]);
    expect(withoutJudge.overall).toBe(0);
    // A run that failed with an error scores no higher than how far it got.
    const failed = scoreRun({
      runId: "r",
      provider: "cloudflare",
      brief: coastline,
      events: [...events, { type: "error", message: "Spend limit exceeded" }],
      judge: null,
      costUsd: null,
      at: "2026-11-20T00:00:00Z",
    });
    const outcome = failed.checks.find((check) => check.id === "outcome")?.score ?? 0;
    expect(failed.overall).toBeLessThanOrEqual(Math.round(outcome * 100));
    const judged = scoreRun({
      runId: "r",
      provider: "anthropic",
      brief: coastline,
      events,
      judge: {
        model: "@cf/openai/gpt-oss-120b",
        scores: [{ criterion: "on_brief", score: 5, reason: "On brief." }],
        summary: "Good.",
      },
      costUsd: 0.42,
      at: "2026-11-20T00:00:00Z",
    });
    expect(judged.tokens).toBe(1000);
    expect(judged.modelMs).toBe(2000);
    expect(judged.overall).toBeGreaterThan(withoutJudge.overall);
    expect(judged.checks.at(-1)?.detail).toContain("$0.42");
  });
});

describe("the open-model tier's platform (ADR-021)", () => {
  it("names the platform a run recorded, else the host's own", () => {
    expect(teamOpenModels("vertex", "cloudflare")).toBe("vertex");
    expect(teamOpenModels("workers-ai", "google-cloud")).toBe("workers-ai");
    expect(teamOpenModels(undefined, "cloudflare")).toBe("workers-ai");
    expect(teamOpenModels(undefined, "google-cloud")).toBe("vertex");
    expect(teamRunProviderLabel("cloudflare", "vertex", "cloudflare")).toBe(
      "Vertex AI (open models)",
    );
    expect(teamRunProviderLabel("cloudflare", "workers-ai", "cloudflare")).toBe(
      "Cloudflare Workers AI",
    );
    // The vendors keep the host's route whichever platform the open models ran on.
    expect(teamRunProviderLabel("anthropic", "vertex", "cloudflare")).toBe("Anthropic Claude API");
  });

  it("reads the platform from a run's start event", () => {
    const start = {
      type: "start",
      id: "r",
      infra: { provider: "cloudflare", aiPlatform: "vertex" },
    } as unknown as TeamEvent;
    expect(runAiPlatform([start])).toBe("vertex");
    expect(runAiPlatform([])).toBeUndefined();
  });
});
