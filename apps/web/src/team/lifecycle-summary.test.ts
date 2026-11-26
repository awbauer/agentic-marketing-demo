import {
  LIFECYCLE_ROLES,
  newLifecycle,
  PHARMA_PHASES,
  recordArtifact,
  type TeamEvent,
} from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { plainStatus } from "./LifecycleSummary";
import { provenanceOf, stagesOf } from "./TeamLifecycle";
import { foldTeam } from "./team-state";

describe("the lifecycle in a content team's words", () => {
  it("says where a paused run stands without the lead's instruction to itself", () => {
    const state = newLifecycle();
    expect(plainStatus(state)).toBe(
      "Paused in Business focus (Brief & strategy). Next: the insights and targeting agent hands in two or three focus areas, each citing its data.",
    );
    recordArtifact(state, "propose_focus_areas", "audience-analyst", { areas: [] });
    expect(plainStatus(state)).toBe(
      "Paused in Business focus (Brief & strategy). Waiting on the brand lead: choose the focus area.",
    );
    expect(plainStatus({ ...state, finished: true })).toBe(
      "The campaign has been through every phase.",
    );
  });

  it("gives every phase a familiar name and every agent step a hand-in and a role", () => {
    for (const phase of PHARMA_PHASES) {
      expect(phase.familiar).toBeTruthy();
      for (const step of phase.steps)
        if (step.kind === "agent") {
          expect(step.delivers).toBeTruthy();
          expect(LIFECYCLE_ROLES[step.agent].assists).toBeTruthy();
        }
    }
  });

  it("records which version of the work each sign-off was on, and when", () => {
    const at = "2027-01-14T10:32:00.000Z";
    const state = foldTeam([
      {
        type: "artifact",
        phase: "focus",
        name: "propose_focus_areas",
        by: "audience-analyst",
        version: 2,
        round: 2,
        data: { areas: [] },
      },
      {
        type: "decided",
        gate: "focus",
        decision: "approve",
        note: "Heart failure first.",
        persona: "brand-lead",
        at,
      },
    ] as TeamEvent[]);
    expect(state.decisions[0]).toMatchObject({
      at,
      signedOff: { name: "propose_focus_areas", version: 2 },
    });
  });
});

describe("the content phase as two stages, and where module copy comes from", () => {
  it("splits content into copy and creative, then MLR review and approval", () => {
    const content = PHARMA_PHASES.find((phase) => phase.id === "content");
    if (!content) throw new Error("no content phase");
    const stages = stagesOf(content);
    expect(stages.map((stage) => [stage.letter, stage.title, stage.steps.length])).toEqual([
      ["a", "Copy & creative", 1],
      ["b", "MLR review & approval", 4],
    ]);
    // A phase without stages stays one step on the path.
    expect(stagesOf(PHARMA_PHASES[0])).toHaveLength(1);
  });

  it("counts verbatim claims, AI-written lines and system-attached text", () => {
    const module = {
      id: "email-1",
      channel: "email",
      headline: "After the congress",
      opening: "Dear Doctor,",
      closing: "",
      cta: "Read the data",
      claims: [
        {
          topic: "a",
          claimId: "CLM-1",
          text: "x",
          marker: 1,
          references: [],
          context: "In CARDIO-HF.",
          labelVersion: null,
        },
        {
          topic: "b",
          claimId: null,
          text: "y",
          marker: 2,
          references: [],
          context: null,
          labelVersion: null,
        },
      ],
      disclosures: [{ id: "isi", title: "ISI", text: "…" }],
      safetyPlacement: "beside-claims",
      assets: [],
    } as const;
    expect(provenanceOf(module as never)).toEqual({
      verbatim: 1,
      written: 3,
      required: 2,
      unmatched: 1,
    });
  });
});
