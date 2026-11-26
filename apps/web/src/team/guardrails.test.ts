import type { TeamEvent, TeamToolStep } from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { foldTeam, guardrailOf } from "./team-state";

const allow = { decision: "allow", policyId: "team-art-director", reason: "ok" };
const tool = (step: Partial<TeamToolStep>, agent = "art-director"): TeamEvent =>
  ({
    type: "tool",
    agent,
    step: { tool: "propose_concepts", input: {}, ok: false, decision: allow, ...step },
  }) as TeamEvent;
const refused = (problem: string) =>
  tool({ error: `Refused. Fix every problem and save again: ${problem}` });

describe("guardrails at work", () => {
  it("classifies rule refusals, gateway denials and contract rejections, and nothing else", () => {
    expect(
      guardrailOf({
        tool: "x",
        input: {},
        ok: false,
        error: "Refused. Fix every problem and save again: a.",
      }),
    ).toMatchObject({ kind: "rule", detail: "a." });
    expect(
      guardrailOf({
        tool: "x",
        input: {},
        ok: false,
        decision: { decision: "deny", policyId: "lifecycle-propose_concepts", reason: "not here" },
      }),
    ).toMatchObject({ kind: "gateway", policyId: "lifecycle-propose_concepts" });
    expect(
      guardrailOf({ tool: "x", input: {}, ok: false, error: "Rejected before it ran: bad" }),
    ).toMatchObject({ kind: "contract", detail: "bad" });
    // A prose answer the worker nudges, and a call that went through, are not guardrails.
    expect(
      guardrailOf({
        tool: "x",
        input: {},
        ok: false,
        error: "The model answered in prose instead of calling the tool; nudging it.",
      }),
    ).toBeNull();
    expect(guardrailOf({ tool: "x", input: {}, ok: true, decision: allow })).toBeNull();
  });

  it("merges a repeated refusal into one hit with a count, and marks it fixed once a save goes through", () => {
    const looping = foldTeam([
      refused("Concept 1: name the claims."),
      refused("Concept 1: name the claims."),
      refused("Concept 1: name the claims."),
    ]);
    expect(looping.guardrails).toEqual([
      expect.objectContaining({ agent: "art-director", kind: "rule", count: 3, fixed: false }),
    ]);
    const fixed = foldTeam([
      refused("Concept 1: name the claims."),
      refused("Concept 2: an image is out of rights."),
      tool({ ok: true }),
    ]);
    expect(fixed.guardrails.map((hit) => [hit.count, hit.fixed])).toEqual([
      [1, true],
      [1, true],
    ]);
  });
});
