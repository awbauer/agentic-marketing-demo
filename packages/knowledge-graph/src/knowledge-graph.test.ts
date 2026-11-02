import { describe, expect, it } from "vitest";
import { buildDataset, DATASET_VERSION } from "./dataset";
import { queryApiBackend } from "./query-api";
import { type GraphBackend, KNOWLEDGE_GRAPH_TOOL_SPECS } from "./tools";

const fixture: GraphBackend = { kind: "fixture", dataset: buildDataset() };
const tool = (name: string) => {
  const spec = KNOWLEDGE_GRAPH_TOOL_SPECS.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(name);
  return (input: Record<string, unknown>) => spec.run(fixture, spec.input.parse(input) as never);
};

describe("knowledge graph dataset", () => {
  it("is deterministic and inside Aura Free limits", () => {
    const first = buildDataset();
    expect(buildDataset()).toEqual(first);
    expect(first.nodes.length).toBeLessThan(200_000);
    expect(first.relationships.length).toBeLessThan(400_000);
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length);
    const ids = new Set(first.nodes.map((node) => node.id));
    expect(first.relationships.every((rel) => ids.has(rel.from) && ids.has(rel.to))).toBe(true);
  });

  it("contains no contact data: personas are roles and names carry no emails or phones", () => {
    const text = JSON.stringify(buildDataset());
    expect(text).not.toMatch(/@[\w-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}/);
  });
});

describe("knowledge graph tools (fixture backend)", () => {
  it("favors cold items on hot afternoons and hot items on rainy nights", async () => {
    const heat = (await tool("find_similar_past_pushes")({
      location: "fresno",
      daypart: "afternoon",
      condition: "heat",
    })) as { topItems: Array<{ serves: string }>; bestAngle: string };
    expect(heat.topItems[0]?.serves).toBe("cold");
    expect(heat.topItems.filter((item) => item.serves === "cold").length).toBeGreaterThanOrEqual(2);
    expect(heat.bestAngle).toBe("Beat the heat");
    const rain = (await tool("find_similar_past_pushes")({
      location: "san-francisco",
      daypart: "late-night",
      condition: "rain",
    })) as { topItems: Array<{ serves: string }> };
    expect(rain.topItems[0]?.serves).toBe("hot");
    expect(rain.topItems.filter((item) => item.serves === "hot").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the fall hero email failing alt text, matching the readiness blocker", async () => {
    const lineage = (await tool("trace_content_lineage")({ campaign: "camp-fall" })) as {
      assets: Array<{ kind: string; failed: string[] }>;
    };
    expect(lineage.assets.find((asset) => asset.kind === "Hero email")?.failed).toContain(
      "Accessible alt text",
    );
  });

  it("returns bounded evidence paths whose nodes exist in the dataset", async () => {
    const ids = new Set(buildDataset().nodes.map((node) => node.id));
    for (const [name, input] of [
      ["explain_buyer_group", { account: "Acme Outfitters" }],
      ["find_audience_overlap", { campaign: "camp-fall" }],
      ["check_consent_coverage", { campaign: "camp-fall", channel: "email" }],
      ["trace_content_lineage", { campaign: "camp-winter" }],
    ] as const) {
      const result = (await tool(name)(input)) as {
        paths: Array<{ nodes: Array<{ id: string }>; relationships: unknown[] }>;
      };
      expect(result.paths.length, name).toBeGreaterThan(0);
      expect(result.paths.length, name).toBeLessThanOrEqual(25);
      for (const path of result.paths)
        for (const node of path.nodes) expect(ids.has(node.id), node.id).toBe(true);
    }
  });

  it("rejects inputs outside the curated schemas", () => {
    const spec = KNOWLEDGE_GRAPH_TOOL_SPECS.find(
      (candidate) => candidate.name === "explain_buyer_group",
    );
    expect(() => spec?.input.parse({ account: "MATCH (n) DETACH DELETE n" })).toThrow();
  });
});

describe("Neo4j Query API client", () => {
  it("sends read-mode, parameterized statements with basic auth and maps rows", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const backend = queryApiBackend(
      { url: "https://example.databases.neo4j.io/db/x/query/v2", username: "u", password: "p" },
      async (url, init) => {
        captured = { url: String(url), init: init as RequestInit };
        return new Response(JSON.stringify({ data: { fields: ["a", "b"], values: [[1, "x"]] } }), {
          status: 202,
        });
      },
    );
    await expect(
      backend.query("RETURN $a AS a", { a: 1, dataset: DATASET_VERSION }),
    ).resolves.toEqual([{ a: 1, b: "x" }]);
    const body = JSON.parse(String(captured?.init.body));
    expect(body).toMatchObject({ accessMode: "Read", parameters: { a: 1 } });
    expect(new Headers(captured?.init.headers).get("authorization")).toBe(`Basic ${btoa("u:p")}`);
  });

  it("reports failures without echoing credentials", async () => {
    const failing = (status: number, code?: string) =>
      queryApiBackend(
        { url: "https://h/db/x/query/v2", username: "user", password: "secret-pass" },
        async () =>
          new Response(
            JSON.stringify(code ? { errors: [{ code, message: "secret-pass leaked" }] } : {}),
            {
              status,
            },
          ),
      );
    await expect(failing(401).query("RETURN 1", {})).rejects.toThrow(
      "Neo4j rejected the credentials",
    );
    await expect(
      failing(400, "Neo.ClientError.Statement.AccessMode").query("CREATE (n)", {}),
    ).rejects.toThrow("Neo4j query failed (Neo.ClientError.Statement.AccessMode)");
    await expect(
      failing(503, "Neo.TransientError.General.DatabaseUnavailable").query("RETURN 1", {}),
    ).rejects.toThrow("may be paused");
    await failing(400, "X")
      .query("RETURN 1", {})
      .catch((error: Error) => {
        expect(error.message).not.toContain("secret-pass");
      });
  });

  it("connects Coastline Kitchen to Northstar and every push to its campaign, content, audience, and consent", () => {
    const dataset = buildDataset();
    const out = (id: string, type: string) =>
      dataset.relationships
        .filter((edge) => edge.from === id && edge.type === type)
        .map((edge) => edge.to);
    expect(out("brand-coastline-kitchen", "PART_OF")).toEqual(["brand-northstar"]);
    expect(out("consent-push-marketing", "FOR")).toEqual(["channel-mobile-app"]);
    const pushes = dataset.nodes.filter((node) => node.label === "PushSend");
    expect(pushes).toHaveLength(1500);
    for (const push of pushes) {
      expect(out(push.id, "ON")).toEqual(["channel-mobile-app"]);
      expect(out(push.id, "SENT_UNDER")).toEqual(["consent-push-marketing"]);
      expect(out(push.id, "PART_OF")[0]).toMatch(/^camp-coastline-/);
      expect(out(push.id, "USED")[0]).toMatch(/^asset-camp-coastline-/);
      expect(out(push.id, "SENT_TO")[0]).toMatch(/^segment-coastline-/);
    }
    // Restaurant entities belong to the brand: locations it operates and one menu they serve.
    expect(out("brand-coastline-kitchen", "OPERATES")).toHaveLength(5);
    expect(out("location-los-angeles", "SERVES")).toEqual(["menu-coastline-core"]);
    expect(
      dataset.relationships.filter(
        (edge) => edge.type === "ON_MENU" && edge.to === "menu-coastline-core",
      ),
    ).toHaveLength(10);
  });

  it("reports push consent for Coastline's app audiences from segment aggregates", async () => {
    const coverage = (await tool("check_consent_coverage")({
      campaign: "camp-coastline-late-night",
      channel: "push",
    })) as {
      channel: string;
      requiredScope: string;
      campaignUsesChannel: boolean;
      audience: number;
      covered: number;
      segments: unknown[];
      paths: Array<{ nodes: Array<{ label: string }> }>;
    };
    expect(coverage.channel).toBe("mobile-app");
    expect(coverage.requiredScope).toBe("push marketing");
    expect(coverage.campaignUsesChannel).toBe(true);
    expect(coverage.audience).toBe(51200);
    expect(coverage.covered).toBe(31700);
    expect(coverage.segments).toHaveLength(5);
    expect(coverage.paths[0]?.nodes.map((node) => node.label)).toEqual([
      "Campaign",
      "Segment",
      "ConsentScope",
    ]);
  });

  it("returns the push content and consented app audience behind similar past pushes", async () => {
    const result = (await tool("find_similar_past_pushes")({
      location: "los-angeles",
      daypart: "lunch",
      condition: "rain",
    })) as {
      topItems: Array<{ content: string | null }>;
      audience: { segment: string; optedIn: number; consentScope: string };
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.topItems.every((item) => item.content?.endsWith("· push"))).toBe(true);
    expect(result.audience).toEqual({
      segment: "Coastline app · Los Angeles",
      appUsers: 18400,
      channel: "push",
      optedIn: 11900,
      consentScope: "push marketing",
    });
    const types = result.paths.flatMap((path) => path.relationships.map((edge) => edge.type));
    expect(types).toEqual(expect.arrayContaining(["FEATURED", "USED", "SENT_TO"]));
  });

  it("reports email history, email content, and email consent for an email campaign", async () => {
    const result = (await tool("find_similar_past_pushes")({
      location: "los-angeles",
      daypart: "lunch",
      condition: "rain",
      channel: "email",
    })) as {
      history: string;
      topItems: Array<{ content: string | null; avgOpenRate: number }>;
      audience: { optedIn: number; consentScope: string; channel: string };
      note: string;
      paths: Array<{
        nodes: Array<{ label: string; name: string }>;
        relationships: Array<{ type: string }>;
      }>;
    };
    expect(result.history).toBe("email");
    expect(result.topItems.length).toBeGreaterThan(0);
    expect(result.topItems.every((item) => item.content?.endsWith("· email"))).toBe(true);
    const labels = result.paths.flatMap((path) => path.nodes.map((node) => node.label));
    expect(labels).toContain("EmailSend");
    expect(labels).not.toContain("PushSend");
    expect(result.audience).toMatchObject({
      channel: "email",
      optedIn: 13100,
      consentScope: "email marketing",
    });
    expect(result.note).toBe("Fictional email history for demonstration.");
    const scopes = result.paths.flatMap((path) =>
      path.nodes.filter((node) => node.name.endsWith("marketing")).map((node) => node.name),
    );
    expect(scopes).toEqual(["email marketing"]);
    // The emails were sent to this audience, under its email consent.
    expect(result.paths.flatMap((path) => path.relationships.map((edge) => edge.type))).toContain(
      "SENT_TO",
    );
  });

  it("uses push history for SMS, which has none of its own, and says so", async () => {
    const result = (await tool("find_similar_past_pushes")({
      location: "los-angeles",
      daypart: "lunch",
      condition: "rain",
      channel: "sms",
    })) as {
      history: string;
      audience: { optedIn: number; consentScope: string };
      note: string;
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.history).toBe("push");
    expect(result.audience).toMatchObject({ optedIn: 5200, consentScope: "sms marketing" });
    expect(result.note).toMatch(/no SMS send history/);
    expect(
      result.paths.flatMap((path) => path.relationships.map((edge) => edge.type)),
    ).not.toContain("SENT_TO");
  });
});

describe("use-case graph tools", () => {
  it("plans account outreach with consented channels and the account's country", async () => {
    const result = (await tool("plan_account_outreach")({
      account: "Harbor Point Sports",
      limit: 4,
    })) as {
      country: string;
      contacts: Array<{
        persona: string;
        reachableBy: string[];
        lastEngagedDaysAgo: number | null;
      }>;
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.country).toBe("GB");
    expect(result.contacts.length).toBeGreaterThan(0);
    for (const contact of result.contacts)
      expect(contact.persona.startsWith("Harbor Point Sports · ")).toBe(true);
    expect(
      result.paths.some((path) => path.relationships.some((rel) => rel.type === "HAS_CONSENT")),
    ).toBe(true);
  });

  it("assesses a location's affected audience, push reach, and campaigns to pause", async () => {
    const result = (await tool("assess_location_impact")({ location: "san-diego" })) as {
      affectedAppUsers: number;
      reachableByChannel: Array<{ channel: string; optedIn: number; consentScope: string }>;
      campaignsToReview: Array<{ name: string }>;
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    // Each channel has its own marketing consent, counted separately.
    expect(result.reachableByChannel).toEqual([
      { channel: "email", consentScope: "email marketing", optedIn: 7000, coverageRate: 0.714 },
      { channel: "push", consentScope: "push marketing", optedIn: 6600, coverageRate: 0.673 },
      { channel: "sms", consentScope: "sms marketing", optedIn: 2600, coverageRate: 0.265 },
    ]);
    for (const reach of result.reachableByChannel)
      expect(result.affectedAppUsers).toBeGreaterThan(reach.optedIn);
    expect(result.campaignsToReview.map((campaign) => campaign.name)).toContain(
      "Coastline Weather Moments",
    );
    expect(result.paths.map((path) => path.relationships[0]?.type.split(" ")[0])).toEqual(
      expect.arrayContaining(["NEAR", "HAS_CONSENT", "TARGETS"]),
    );
  });

  it("maps forecast weather to lifted dishes, their inventory, and the store manager", async () => {
    const result = (await tool("map_weather_demand")({
      location: "sacramento",
      conditions: ["heat"],
    })) as {
      manager: { name: string } | null;
      menuItems: Array<{ name: string; lift: number }>;
      inventoryItems: Array<{ id: string; usedBy: Array<{ menuItem: string }> }>;
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    // Heat lifts the cold dishes, learned from past push results.
    expect(result.menuItems.map((item) => item.name)).toContain("Açaí Sunrise Bowl");
    expect(result.menuItems.every((item) => item.lift >= 1.15)).toBe(true);
    expect(result.inventoryItems.map((item) => item.id)).toContain("acai");
    expect(result.manager).toEqual({ name: "Tom Okafor" });
    expect(result.paths.map((path) => path.relationships.map((rel) => rel.type).join(">"))).toEqual(
      expect.arrayContaining(["MANAGED_BY", "LIFTS_DEMAND>MADE_WITH"]),
    );
    // The graph holds no contact data about the manager.
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });
});

describe("financial services graph tools", () => {
  type Approval = { id: string; status: string };
  it("matches a rate increase to approved content, and says why the rest is blocked", async () => {
    const result = (await tool("match_news_to_approved_content")({ event: "rate-increase" })) as {
      readyToSend: Array<{
        asset: string;
        channel: string;
        approval: Approval;
        disclosures: string[];
        reachableUnderMarketingConsent: number;
      }>;
      blocked: Array<{ asset: string; reasons: string[] }>;
      speed: { withinSixHours: { avgOpenRate: number }; later: { avgOpenRate: number } };
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.readyToSend.map((asset) => [asset.channel, asset.approval.id])).toEqual([
      ["email", "COMP-2026-0412"],
      ["sms", "COMP-2026-0413"],
    ]);
    // Reach is marketing consent per channel: clients plus subscribers for email, clients for SMS.
    expect(result.readyToSend.map((asset) => asset.reachableUnderMarketingConsent)).toEqual([
      31_400 + 22_500,
      9_800,
    ]);
    expect(result.readyToSend[0]?.disclosures).toContain(
      "Not FDIC insured. No bank guarantee. May lose value.",
    );
    const reasons = Object.fromEntries(result.blocked.map((asset) => [asset.asset, asset.reasons]));
    expect(reasons["Rates rose: time to revisit your bond ladder"]?.[0]).toMatch(/expired/);
    expect(reasons["Higher rates, higher returns"]).toEqual([
      "Approval COMP-2026-0519 is still pending with compliance",
      "Failed compliance check: No performance guarantees",
    ]);
    // Past responses sent within hours of the news opened better than next-day ones.
    expect(result.speed.withinSixHours.avgOpenRate).toBeGreaterThan(result.speed.later.avgOpenRate);
    expect(result.paths.map((path) => path.relationships[0]?.type)).toContain("RESPONDS_TO");
  });

  it("limits approved content to one channel when asked", async () => {
    const result = (await tool("match_news_to_approved_content")({
      event: "rate-hold",
      channel: "sms",
    })) as { readyToSend: unknown[]; blocked: Array<{ channel: string }> };
    expect(result.readyToSend).toEqual([]);
    expect(result.blocked.map((asset) => asset.channel)).toEqual(["sms"]);
  });

  it("orders the embargoed acquisition package and blocks what can't go out", async () => {
    const result = (await tool("prepare_deal_release")({})) as {
      steps: Array<{
        step: number;
        asset: string;
        reachable: number | null;
        reliesOn: string;
        approval: Approval & { embargoed?: boolean };
        ready: boolean;
        blockers: string[];
      }>;
      readyCount: number;
      blockedCount: number;
    };
    expect(result.steps.map((step) => step.step)).toEqual([1, 2, 3, 3, 4, 5]);
    expect(result.readyCount).toBe(4);
    expect(result.blockedCount).toBe(2);
    const letter = result.steps.find((step) => step.asset === "Welcome letter to Bayview clients");
    // Bayview's clients get service notices under their client agreement, never marketing.
    expect(letter).toMatchObject({ ready: true, reachable: 12_600 });
    expect(letter?.reliesOn).toMatch(/service notice/);
    expect(letter?.approval.embargoed).toBe(true);
    const sms = result.steps.find((step) => step.asset === "SMS: news about your account");
    expect(sms?.ready).toBe(false);
    expect(sms?.blockers.join(" ")).toMatch(/Required disclosures present/);
    expect(sms?.blockers.join(" ")).toMatch(/no sms marketing consent/);
  });

  it("builds an AUM account plan from signals, peers, approved content, and consent", async () => {
    const result = (await tool("build_aum_account_plan")({
      client: "Cedar Valley Community Foundation",
    })) as {
      advisor: { name: string };
      walletShare: number;
      plays: Array<{
        product: string;
        estimatedOpportunityMillions: number;
        peerAdoption: string;
        approvedContent: Array<{ asset: string; approval: { id: string } }>;
        blockedContent: Array<{ reasons: string[] }>;
      }>;
      totalOpportunityMillions: number;
      contacts: Array<{
        persona: string;
        reachableBy: string[];
        channelForPlayContent: string | null;
      }>;
      noApprovedContentForTheirChannels: string[];
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.advisor.name).toBe("Marcus Oyelaran");
    expect(result.walletShare).toBeCloseTo(42 / 107, 3);
    // Plays are products the client doesn't hold, largest opportunity first.
    expect(result.plays.map((play) => play.product)).toEqual([
      "Outsourced CIO",
      "Municipal bond ladder",
      "Private credit fund",
      "Securities-based lending",
    ]);
    expect(result.plays[0]).toMatchObject({
      estimatedOpportunityMillions: 16.3,
      peerAdoption: "2 of 3 other foundation clients hold it",
    });
    // Plans use evergreen approved content; a pending approval blocks the private credit play.
    const content = result.plays.flatMap((play) =>
      play.approvedContent.map((asset) => asset.asset),
    );
    expect(content.every((asset) => !/^Rates (?:rose|fell)/.test(asset))).toBe(true);
    expect(result.plays[2]?.approvedContent).toEqual([]);
    expect(result.plays[2]?.blockedContent[0]?.reasons[0]).toMatch(/pending/);
    expect(result.totalOpportunityMillions).toBeCloseTo(
      result.plays.reduce((sum, play) => sum + play.estimatedOpportunityMillions, 0),
      1,
    );
    expect(result.contacts).toHaveLength(3);
    // Play content is email only, so an SMS-only contact has no channel for it.
    for (const contact of result.contacts)
      expect(contact.channelForPlayContent).toBe(
        contact.reachableBy.includes("email") ? "email" : null,
      );
    expect(result.noApprovedContentForTheirChannels).toEqual(
      result.contacts
        .filter(
          (contact) => contact.reachableBy.length > 0 && !contact.reachableBy.includes("email"),
        )
        .map((contact) => contact.persona),
    );
    expect(result.paths.map((path) => path.relationships.map((rel) => rel.type).join(">"))).toEqual(
      expect.arrayContaining(["COVERED_BY", "HAS_SIGNAL>SUGGESTS", "EXPLAINS>APPROVED_UNDER"]),
    );
  });
});

describe("pharma tools: Lumera Therapeutics", () => {
  it("ranks hospitals and prescriber groups by opportunity, with access first where the drug isn't on formulary", async () => {
    const result = (await tool("build_hcp_target_list")({
      drug: "drug-cardivance",
      limit: 16,
    })) as {
      found: boolean;
      targets: Array<{
        rank: number;
        group: string;
        hospital: string;
        formulary: string;
        lumeraShare: number;
        opportunityScore: number;
        reachable: Array<{ channel: string; optedIn: number }>;
        play: string;
      }>;
      paths: Array<{ relationships: Array<{ type: string }> }>;
    };
    expect(result.found).toBe(true);
    const scores = result.targets.map((target) => target.opportunityScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // Cardiology and primary care treat heart failure; endocrinology and neurology never appear.
    expect(result.targets.every((target) => /Cardiology|Primary care/.test(target.group))).toBe(
      true,
    );
    const mesa = result.targets.find(
      (target) => target.hospital === "Mesa Verde Regional Hospital",
    );
    expect(mesa).toMatchObject({ formulary: "Not on formulary" });
    expect(mesa?.play).toMatch(/formulary access first/);
    const gulf = result.targets.find((target) => target.hospital === "Gulf Coast Heart Institute");
    expect(gulf?.play).toMatch(/Defend share/);
    expect(gulf?.reachable.map((entry) => entry.channel).sort()).toEqual([
      "email",
      "portal",
      "rep",
    ]);
    expect(result.paths.some((path) => path.relationships[0]?.type === "ON_FORMULARY")).toBe(true);
  });

  it("blocks an unsupported claim, an off-label claim, and an expired approval", async () => {
    const result = (await tool("check_clinical_claims")({ drug: "drug-cardivance" })) as {
      boxedWarning: boolean;
      claims: Array<{
        claim: string;
        verdict: string;
        onLabel: boolean;
        issues: string[];
        supportedBy: Array<{ trial: string }>;
        content: Array<{ asset: string; usable: boolean; blockers: string[] }>;
      }>;
      usableCount: number;
      blockedCount: number;
    };
    expect(result.boxedWarning).toBe(true);
    const byClaim = (text: string) => result.claims.find((claim) => claim.claim.startsWith(text));
    const mortality = byClaim("Reduced the risk");
    expect(mortality).toMatchObject({ verdict: "Usable", onLabel: true });
    expect(mortality?.supportedBy[0]?.trial).toBe("CARDIO-HF");
    expect(mortality?.content.filter((asset) => asset.usable)).toHaveLength(3);
    const superior = byClaim("Superior to every ARB");
    expect(superior?.verdict).toMatch(/^Blocked/);
    expect(superior?.issues.join(" ")).toMatch(/No trial supports/);
    const hfpef = byClaim("Improves outcomes in heart failure with preserved");
    expect(hfpef?.verdict).toMatch(/^Blocked/);
    expect(hfpef?.issues.join(" ")).toMatch(/not on the approved label/);
    expect(hfpef?.issues.join(" ")).toMatch(/no results yet/);
    expect(result.blockedCount).toBe(2);

    const glucora = (await tool("check_clinical_claims")({
      drug: "drug-glucora",
    })) as typeof result;
    const weight = glucora.claims.find((claim) => claim.claim.startsWith("Patients lost"));
    expect(weight?.content[0]?.blockers.join(" ")).toMatch(/expired on 2026-09-30/);
    const narrowed = (await tool("check_clinical_claims")({
      drug: "drug-glucora",
      channel: "portal",
    })) as typeof result;
    expect(
      narrowed.claims
        .flatMap((claim) => claim.content)
        .every((asset) => asset.asset.includes("dossier")),
    ).toBe(true);
  });

  it("plans a hospital's engagement from its formulary status and its dossier approval", async () => {
    const result = (await tool("plan_hospital_engagement")({
      hospital: "St. Brigid Medical Center",
    })) as {
      access: Array<{
        drug: string;
        status: string;
        ptReviewInDays: number | null;
        needsAccess: boolean;
        patientsAtStake: number;
        dossier: { usable: boolean } | null;
      }>;
      prescriberGroups: Array<{ group: string; reachable: Array<{ channel: string }> }>;
      nextSteps: string[];
    };
    const cardivance = result.access.find((entry) => entry.drug === "Cardivance");
    expect(cardivance).toMatchObject({
      status: "Under P&T review",
      ptReviewInDays: 21,
      needsAccess: true,
      patientsAtStake: 2400,
    });
    expect(cardivance?.dossier?.usable).toBe(true);
    expect(result.nextSteps[0]).toMatch(
      /Submit Cardivance formulary value dossier before the P&T review in 21 days/,
    );
    expect(result.prescriberGroups.map((group) => group.group)).toEqual([
      "Cardiology prescribers at St. Brigid Medical Center",
      "Endocrinology prescribers at St. Brigid Medical Center",
    ]);

    // A dossier still pending MLR is a blocker, not a recommendation to send it.
    const mesa = (await tool("plan_hospital_engagement")({
      hospital: "Mesa Verde Regional Hospital",
    })) as typeof result;
    expect(mesa.nextSteps.join(" ")).toMatch(
      /Neurelva: under p&t review\. Get the value dossier through MLR first/,
    );
  });

  it("keeps people out of the graph: audiences are prescriber groups with counts", () => {
    const text = JSON.stringify(
      buildDataset().nodes.filter((node) => node.label === "PrescriberGroup"),
    );
    expect(text).not.toMatch(/\bDr\.|MD\b/);
  });
});
