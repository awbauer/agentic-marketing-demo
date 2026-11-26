import {
  TEAM_DIRECTOR,
  TEAM_LIMITS,
  type TeamEvent,
  type TeamToolStep,
} from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { agentAllowances, longestSameRefusal, openAssignment } from "./allowances";
import { foldTeam } from "./team-state";

const allow = { decision: "allow", policyId: "team-audience", reason: "ok" };
const step = (over: Partial<TeamToolStep>): TeamToolStep => ({
  tool: "build_audience",
  input: {},
  ok: false,
  decision: allow,
  ...over,
});
const refused = (problem: string) =>
  step({ error: `Refused. Fix every problem and save again: ${problem}` });

describe("agent allowances", () => {
  it("counts the open assignment from the last saved work", () => {
    const tools = [
      step({ tool: "get_segments", ok: true }),
      refused("a."),
      step({ ok: true }),
      step({ tool: "get_segments", ok: true }),
      refused("b."),
    ];
    expect(openAssignment(tools)).toEqual({ calls: 2, failures: 1 });
    expect(openAssignment([])).toEqual({ calls: 0, failures: 0 });
  });

  it("finds the longest streak of one refusal, reset by a different one or a save", () => {
    expect(longestSameRefusal([refused("a."), refused("a."), refused("b."), refused("b.")])).toBe(
      2,
    );
    expect(
      longestSameRefusal([refused("a."), refused("a."), step({ ok: true }), refused("a.")]),
    ).toBe(2);
    expect(longestSameRefusal([refused("a."), refused("a."), refused("a.")])).toBe(3);
  });

  it("gives a spoke its assignment limits and the lead its turn limit, both with the run's", () => {
    const state = foldTeam([
      { type: "tool", agent: "art-director", step: refused("a.") } as TeamEvent,
    ]);
    const spoke = agentAllowances(state, "art-director");
    expect(spoke.map((item) => item.limit)).toEqual([
      "assignmentToolCalls",
      "assignmentFailures",
      "sameRefusals",
      null,
      null,
      "runModelCalls",
      "runTokens",
    ]);
    expect(spoke[1]).toMatchObject({ allowed: TEAM_LIMITS.assignmentFailures, used: 1 });
    const lead = agentAllowances(state, TEAM_DIRECTOR);
    expect(lead[0]).toMatchObject({ limit: "leadToolCallsPerTurn", used: null });
    expect(lead.find((item) => item.label === "Steps per loop")?.allowed).toBe(24);
  });
});
