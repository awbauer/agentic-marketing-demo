import { TEAM_TOOL_NAMES, type TeamEvent } from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { claimIndex, claimsIn } from "./Claims";
import { foldTeam } from "./team-state";
import { toolRows } from "./ToolLibrary";

const call = (agent: string, tool: string, ok = true, output?: unknown): TeamEvent =>
  ({
    type: "tool",
    agent,
    step: {
      tool,
      input: {},
      ok,
      output,
      decision: { decision: "allow", policyId: "p", reason: "" },
    },
  }) as TeamEvent;

describe("the squad's tool library", () => {
  it("lists every tool the team can be granted, each with a purpose and its agents", () => {
    const rows = toolRows(foldTeam([]), new Set());
    expect(rows.map((row) => row.name)).toEqual([...TEAM_TOOL_NAMES, "lifecycle_step"]);
    for (const row of rows) {
      expect(row.summary.length, row.name).toBeGreaterThan(10);
      expect(row.agents.length, row.name).toBeGreaterThan(0);
    }
    expect(rows.find((row) => row.name === "plan_campaign")?.kind).toBe("Coordination");
    expect(rows.find((row) => row.name === "get_claims_library")?.kind).toBe("Reads data");
    expect(rows.find((row) => row.name === "propose_concepts")?.kind).toBe("Saves work");
  });

  it("counts this run's calls and the refused ones, and marks tools used earlier this session", () => {
    const state = foldTeam([
      call("art-director", "propose_concepts", false),
      call("art-director", "propose_concepts"),
    ]);
    const rows = toolRows(state, new Set(["get_competitors"]));
    expect(rows.find((row) => row.name === "propose_concepts")).toMatchObject({
      calls: 2,
      stopped: 1,
    });
    expect(rows.find((row) => row.name === "get_competitors")).toMatchObject({
      calls: 0,
      inSession: true,
    });
  });
});

describe("claim details", () => {
  it("finds a claim by topic or ID, from the library's records before any read", () => {
    const index = claimIndex(foldTeam([]));
    expect(index.get("CLM-CRD-0042")?.topic).toBe("cardivance-mortality");
    expect(index.get("cardivance-mortality")?.labelVersion).toBeTruthy();
    expect(index.get("cardivance-mortality")?.text).toBeUndefined();
  });

  it("uses what the run's agents read from the claims library", () => {
    const claims = [
      {
        topic: "cardivance-mortality",
        claimId: "CLM-CRD-0042",
        text: "Reduced the risk by 20%.",
        status: "substantiated",
        usable: true,
        issues: [],
        references: [],
        requires: ["lt-disc-pi"],
      },
    ];
    const index = claimIndex(
      foldTeam([call("art-director", "get_claims_library", true, JSON.stringify({ claims }))]),
    );
    expect(index.get("CLM-CRD-0042")).toMatchObject({
      text: "Reduced the risk by 20%.",
      usable: true,
      requires: ["lt-disc-pi"],
      type: "efficacy.primary_endpoint",
    });
  });

  it("reads every complete claim from a library result that was cut short", () => {
    const full = JSON.stringify({
      product: "Cardivance",
      claims: [
        { topic: "a", claimId: "CLM-1", text: 'Says "quoted" {braces}' },
        { topic: "b", claimId: "CLM-2", text: "Second" },
      ],
    });
    const cut = full.slice(0, full.indexOf("Second"));
    expect(claimsIn(cut).map((claim) => claim.topic)).toEqual(["a"]);
    expect(claimsIn(full).map((claim) => claim.text)).toEqual(['Says "quoted" {braces}', "Second"]);
  });
});
