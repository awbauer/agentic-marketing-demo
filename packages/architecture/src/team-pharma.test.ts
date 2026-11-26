import { describe, expect, it } from "vitest";
import { teamBriefById } from "./team.ts";
import {
  applyDecision,
  approveJob,
  buildAudience,
  choiceOptions,
  claimsLibrary,
  conceptProblems,
  currentStep,
  CURRENT_LABEL,
  deploymentProblems,
  draftModule,
  finalFormCheck,
  placementsFor,
  prepareForm2253,
  reviewTier,
  traceClaims,
  focusProblems,
  type MlrJob,
  newLifecycle,
  performanceProblems,
  preReviewChecks,
  recordArtifact,
  simulateResults,
} from "./team-pharma.ts";
import { buildWorld } from "./world.ts";

const brief = teamBriefById("lumera-hf-awareness") as NonNullable<ReturnType<typeof teamBriefById>>;
const world = buildWorld();
const module = {
  channel: "email" as const,
  headline: "Cardivance: news from the heart failure congress",
  opening: "See the CARDIO-HF results presented at the congress.",
  claimTopics: ["cardivance-mortality", "cardivance-safety"],
  closing: "See the full prescribing information below.",
  cta: "Read the data",
  assets: [{ assetId: "lt-img-congress-hero", use: "Hero" }],
};

describe("pharma lifecycle rules", () => {
  it("keeps the claims library to the product, and only substantiated claims are usable", () => {
    const library = claimsLibrary(world, "Lumera Therapeutics");
    expect(library.every((claim) => claim.topic.startsWith("cardivance-"))).toBe(true);
    expect(library.filter((claim) => claim.usable).map((claim) => claim.topic)).toEqual([
      "cardivance-mortality",
      "cardivance-safety",
    ]);
  });

  it("refuses focus areas that cite nothing real", () => {
    expect(
      focusProblems(world, brief.brand, [
        { title: "A", rationale: "Because.", sources: ["made-up"], measure: "Clicks" },
        { title: "B", rationale: "Because.", sources: ["lt-sig-congress-data"], measure: "Reach" },
      ]),
    ).toEqual(["Focus area 1 cites made-up, which is not in the brand's data."]);
  });

  it("tells a concept with no claims which topics it may use", () => {
    const problems = conceptProblems(world, brief, [
      { name: "One", bigIdea: "x", claimTopics: [], assets: [{ assetId: "lt-img-logo", use: "" }] },
      { name: "Two", bigIdea: "y", claimTopics: [], assets: [{ assetId: "lt-img-logo", use: "" }] },
    ]);
    const missing = problems.find((problem) => problem.includes("name the claims"));
    expect(missing).toContain("claimTopics");
    expect(missing).toContain("cardivance-mortality (CLM-CRD-0042)");
    // A claim the library refuses for this campaign is not offered.
    expect(missing).not.toContain("cardivance-superior");
  });

  it("refuses a concept carried by an unapproved claim or an out-of-rights image", () => {
    const problems = conceptProblems(world, brief, [
      {
        name: "One",
        bigIdea: "x",
        claimTopics: ["cardivance-superior"],
        assets: [{ assetId: "lt-img-patient-walk", use: "" }],
      },
      {
        name: "Two",
        bigIdea: "y",
        claimTopics: ["cardivance-mortality"],
        assets: [{ assetId: "lt-img-logo", use: "" }],
      },
    ]);
    expect(problems.join(" ")).toMatch(/cardivance-superior can't carry a concept/);
    expect(problems.join(" ")).toMatch(/lt-img-patient-walk can't be used: Usage rights end/);
    expect(problems.some((problem) => problem.startsWith("Concept 2"))).toBe(false);
  });

  it("builds a module from the library's exact text, references and required disclosures", () => {
    const result = draftModule(world, brief, "EM1", module);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.claims[0]).toMatchObject({
      marker: 1,
      references: [{ source: "CARDIO-HF clinical study report" }],
    });
    expect(result.module.disclosures.map((item) => item.id)).toEqual([
      "lt-disc-isi-cardivance",
      "lt-disc-boxed-cardivance",
      "lt-disc-pi",
    ]);
    expect(preReviewChecks(brief, [result.module]).every((check) => check.ok)).toBe(true);
  });

  it("refuses an unsubstantiated claim and wording that asserts on its own", () => {
    const result = draftModule(world, brief, "EM1", {
      ...module,
      headline: "The best heart failure therapy",
      claimTopics: ["cardivance-hfpef"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toMatch(/cardivance-hfpef is refused/);
    expect(result.problems.join(" ")).toMatch(/superiority|assert/);
  });

  it("refuses own words that imply a guideline endorsement or restate an outcome", () => {
    for (const opening of [
      "This positions Cardivance as a guideline‑ready option.",
      "A proven option for your patients.",
      "Cardivance reduced the risk of hospitalization in HFrEF.",
      "It meets upcoming guideline recommendations.",
      "The data demonstrate a significant reduction in hospitalization.",
    ]) {
      const result = draftModule(world, brief, "EM1", { ...module, opening });
      expect(result.ok, opening).toBe(false);
      if (!result.ok)
        expect(result.problems.join(" ")).toMatch(/implies an endorsement or an outcome/);
    }
  });

  it("issues an approval that expires at twelve months or the first reference or claim expiry", () => {
    const drafted = draftModule(world, brief, "EM1", module);
    if (!drafted.ok) throw new Error("draft failed");
    const job: MlrJob = {
      jobCode: "J",
      round: 1,
      modules: [drafted.module],
      checks: [],
      coordinatorNotes: [],
    };
    // Twelve months out would be 2027-11-20; the mortality claim's own approval ends 2027-11-14.
    expect(approveJob(job, "2026-11-20")).toMatchObject({
      documentNumber: "J-A",
      expiresOn: "2027-11-14",
      labelVersion: CURRENT_LABEL.id,
      materials: [
        { moduleId: "EM1", materialId: "J-A-EM1", claimIds: ["CLM-CRD-0042", "CLM-CRD-0043"] },
      ],
    });
    expect(approveJob(job, "2026-01-10").expiresOn).toBe("2027-01-10");
  });

  it("keeps a claim's record: ID, anchors, context, scope, label and expiry", () => {
    const library = claimsLibrary(world, "Lumera Therapeutics", brief.end);
    const mortality = library.find((claim) => claim.topic === "cardivance-mortality");
    expect(mortality).toMatchObject({
      claimId: "CLM-CRD-0042",
      labelVersion: CURRENT_LABEL.id,
      mustNotAppearWith: ["cardivance-superior"],
      references: [{ source: "CARDIO-HF clinical study report", anchor: "p. 7, table 2" }],
    });
    expect(mortality?.context).toMatch(/Absolute rates/);
    // Every usable claim carries its passage anchor, keyed to its governed evidence source.
    for (const claim of library.filter((item) => item.usable))
      expect(
        claim.references.every((reference) => reference.anchor),
        claim.topic,
      ).toBe(true);
    expect(
      library.find((claim) => claim.topic === "cardivance-safety")?.references[0]?.anchor,
    ).toMatch(/section 6\.1/);
  });

  it("refuses the near twins a search returns beside the right claim", () => {
    const library = new Map(
      claimsLibrary(world, "Lumera Therapeutics", brief.end).map((claim) => [claim.topic, claim]),
    );
    expect(library.get("cardivance-mortality-consumer")?.issues.join(" ")).toMatch(/not HCPs/);
    expect(library.get("cardivance-mortality-detail-aid")?.issues.join(" ")).toMatch(
      /detail-aid only/,
    );
    expect(library.get("cardivance-mortality-v3")?.issues.join(" ")).toMatch(/old label/);
    const result = draftModule(world, brief, "EM1", {
      ...module,
      claimTopics: ["cardivance-mortality-v3"],
    });
    expect(result.ok).toBe(false);
  });

  it("inserts each claim by ID with its context, and judges the module as a whole", () => {
    const result = draftModule(world, brief, "EM1", module);
    if (!result.ok) throw new Error("draft failed");
    expect(result.module.claims.map((claim) => claim.claimId)).toEqual([
      "CLM-CRD-0042",
      "CLM-CRD-0043",
    ]);
    expect(result.module.claims[0]?.context).toMatch(/21.0% with Cardivance/);
    const checks = preReviewChecks(brief, [result.module]);
    expect(checks.map((check) => check.check)).toEqual(
      expect.arrayContaining(["Net impression", "Fair balance", "Required context for claim 1"]),
    );
    expect(reviewTier([result.module]).tier).toBe("C");
    const approved = approveJob(
      { jobCode: "J", round: 1, modules: [result.module], checks, coordinatorNotes: [] },
      "2026-11-20",
    );
    const built = finalFormCheck(approved);
    expect(built.variants).toHaveLength(4);
    expect(built.allMatch).toBe(true);
  });

  it("applies consent and the do-not-contact list to the HCP list", () => {
    const audience = buildAudience(brief, {
      include: [{ segmentId: "lt-seg-hf-specialists", deciles: ["high", "mid"] }],
      rationale: "x",
    });
    const [line] = audience.lines;
    expect(line?.prescribers).toBe(3200);
    expect(line?.doNotContact).toBe(46);
    expect(line?.emailReachable).toBe(Math.round((3200 - 46) * 0.71));
  });

  it("schedules only the approved version, inside the window and before expiry", () => {
    const drafted = draftModule(world, brief, "EM1", module);
    if (!drafted.ok) throw new Error("draft failed");
    const approved = approveJob(
      { jobCode: "J", round: 1, modules: [drafted.module], checks: [], coordinatorNotes: [] },
      "2026-11-20",
    );
    const audience = buildAudience(brief, {
      include: [{ segmentId: "lt-seg-hf-specialists", deciles: ["high"] }],
      rationale: "x",
    }).lines;
    expect(deploymentProblems(brief, null, audience, [])).toEqual([
      "Nothing is approved for distribution: MLR must approve the job first.",
    ]);
    const problems = deploymentProblems(brief, approved, audience, [
      {
        moduleId: "EM1",
        channel: "hcp-display",
        segmentIds: ["lt-seg-hf-nurses"],
        start: "2027-01-01",
        end: "2027-02-01",
        budgetUsd: 1000,
      },
    ]);
    expect(problems.join(" ")).toMatch(/approved for email, not Endemic HCP display/);
    expect(problems.join(" ")).toMatch(/lt-seg-hf-nurses is not in the approved audience/);
    expect(problems.join(" ")).toMatch(/outside the brief's window/);
    expect(
      deploymentProblems(brief, approved, audience, [
        {
          moduleId: "EM1",
          channel: "approved-email",
          segmentIds: ["lt-seg-hf-specialists"],
          start: brief.start,
          end: brief.end,
          budgetUsd: 32,
        },
      ]),
    ).toEqual(["Line 1: $32 is under Approved email's $1,000 minimum."]);
    const lines = [
      {
        moduleId: "EM1",
        channel: "approved-email" as const,
        segmentIds: ["lt-seg-hf-specialists"],
        start: brief.start,
        end: brief.end,
        budgetUsd: 20000,
      },
    ];
    expect(deploymentProblems(brief, approved, audience, lines)).toEqual([]);
    // Claim IDs travel into the channel with the placement, and come back with the results.
    const placements = placementsFor(approved, lines);
    expect(placements[0]).toMatchObject({
      placementId: "PL-001",
      materialId: "J-A-EM1",
      claimIds: ["CLM-CRD-0042", "CLM-CRD-0043"],
    });
    expect(prepareForm2253(brief, approved, lines)).toMatchObject({
      currentPi: CURRENT_LABEL.id,
      materials: [{ materialId: "J-A-EM1", firstUse: brief.start }],
    });
    const results = simulateResults(brief, audience, lines, placements);
    expect(results.lines).toHaveLength(1);
    expect(results.byClaim.map((usage) => usage.claimId)).toEqual(["CLM-CRD-0042", "CLM-CRD-0043"]);
    const kept = traceClaims("optimize", approved, placements);
    expect(kept.withdrawal).toBeNull();
    expect(kept.claims[0]).toMatchObject({ claimId: "CLM-CRD-0042", reReviewBy: "2027-09-14" });
    expect(traceClaims("retire", approved, placements).withdrawal).toHaveLength(1);
    expect(
      performanceProblems(
        {
          findings: [{ text: "x", sources: ["nope"] }],
          recommendation: "optimize",
          rationale: "y",
          nextSteps: [],
        },
        new Set(results.lines.map((line) => line.id)),
      ),
    ).toEqual(["Finding 1 cites nope, which is not a result line."]);
  });

  it("walks the phases: people pass steps, changes restart the phase, the last decision finishes", () => {
    const state = newLifecycle();
    expect(currentStep(state)).toMatchObject({ kind: "agent", tool: "propose_focus_areas" });
    expect(() => applyDecision(state, "focus", "approve", { choice: "1" })).toThrow();
    recordArtifact(state, "propose_focus_areas", "audience-analyst", {
      areas: [{ title: "A" }, { title: "B" }],
    });
    expect(choiceOptions(state, "focus").map((option) => option.label)).toEqual(["A", "B"]);
    // Asking for changes sends the phase back to its agent step, in a new round.
    applyDecision(state, "focus", "changes", { note: "Try again." });
    expect(state.rounds.focus).toBe(2);
    expect(currentStep(state)).toMatchObject({ kind: "agent" });
    recordArtifact(state, "propose_focus_areas", "audience-analyst", { areas: [{ title: "C" }] });
    expect(applyDecision(state, "focus", "approve", { choice: "1" })).toEqual({
      finishedPhase: "focus",
      nextPhase: "ideation",
    });
    expect(state.choices.focus).toBe("1");
    // Ideation: the brand lead chooses, then Medical looks at the concept before anything is built.
    recordArtifact(state, "propose_concepts", "art-director", { concepts: [{ name: "X" }] });
    applyDecision(state, "concept", "approve", { choice: "1" });
    expect(currentStep(state)).toMatchObject({ gate: "concept-review" });
    expect(applyDecision(state, "concept-review", "approve").nextPhase).toBe("content");
    // The MLR phase waits on Medical, then Legal, then Regulatory.
    state.phase = "content";
    recordArtifact(state, "draft_modules", "copy-lead", {});
    recordArtifact(state, "submit_mlr_job", "mlr-coordinator", {});
    expect(currentStep(state)).toMatchObject({ gate: "medical" });
    applyDecision(state, "medical", "approve");
    expect(currentStep(state)).toMatchObject({ gate: "legal" });
    applyDecision(state, "legal", "approve");
    expect(applyDecision(state, "regulatory", "approve").nextPhase).toBe("audience");
  });
});
