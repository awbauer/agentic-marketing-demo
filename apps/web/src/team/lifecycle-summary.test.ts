import {
  LIFECYCLE_ROLES,
  newLifecycle,
  PHARMA_PHASES,
  recordArtifact,
  type TeamEvent,
} from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { plainStatus } from "./LifecycleSummary";
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
