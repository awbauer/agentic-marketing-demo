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
  deploymentProblems,
  draftModule,
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

  it("issues an approval that expires at twelve months or the first reference expiry", () => {
    const drafted = draftModule(world, brief, "EM1", module);
    if (!drafted.ok) throw new Error("draft failed");
    const job: MlrJob = {
      jobCode: "J",
      round: 1,
      modules: [drafted.module],
      checks: [],
      coordinatorNotes: [],
    };
    expect(approveJob(job, "2026-11-20")).toMatchObject({
      documentNumber: "J-A",
      expiresOn: "2027-11-20",
    });
    expect(approveJob(job, "2027-06-01").expiresOn).toBe("2028-03-01");
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
    const results = simulateResults(brief, audience, lines);
    expect(results.lines).toHaveLength(1);
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
