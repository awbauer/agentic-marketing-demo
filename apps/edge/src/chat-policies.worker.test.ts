// The chat orchestrator's Cedar policies (packages/architecture/policies/orchestrator.cedar):
// what is on offer for a step, decided in the turn's context (ADR-020).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authorizeTool, chatToolsAllowed } from "./architecture/context";
import { draftingPrerequisites, policyToolName } from "./turn-policy";

const BRIEF = "tool_salesforce_ns_draft_campaign_brief";
const CLAIMS = "graph_check_clinical_claims";
const ASSETS = "ls_aprimo_search_approved_assets";
const TARGETS = "graph_build_hcp_target_list";
const scope = { brand: "all", persona: "marketer" } as const;
const offer = (names: string[], context: Parameters<typeof chatToolsAllowed>[4]) =>
  chatToolsAllowed(env as never, "tester", names, scope as never, context).then(
    (result) => result.allowed,
  );

describe("the chat orchestrator's policies", () => {
  it("names tools as the policies do", () => {
    expect(policyToolName(CLAIMS)).toBe("check_clinical_claims");
    expect(policyToolName(ASSETS)).toBe("aprimo_search_approved_assets");
    expect(policyToolName(BRIEF)).toBe("draft_campaign_brief");
    expect(draftingPrerequisites([CLAIMS, ASSETS, BRIEF])).toEqual([
      "check_clinical_claims",
      "aprimo_search_approved_assets",
    ]);
  });

  it("starts a claims request with the claims check, then opens the rest", async () => {
    const names = [TARGETS, CLAIMS, ASSETS];
    expect(await offer(names, { intents: ["claims"], done: [] })).toEqual([CLAIMS]);
    expect(await offer(names, { intents: ["claims"], done: ["check_clinical_claims"] })).toEqual(
      names,
    );
    expect(await offer(names, { intents: ["target-list"], done: [] })).toEqual(names);
  });

  it("offers Marketing Cloud's agents only once the scenario's checks have worked", async () => {
    const names = [CLAIMS, ASSETS, BRIEF];
    const prerequisites = draftingPrerequisites(names);
    expect(await offer(names, { intents: ["campaign-draft"], done: [], prerequisites })).toEqual([
      CLAIMS,
      ASSETS,
    ]);
    expect(
      await offer(names, {
        intents: ["campaign-draft"],
        done: ["check_clinical_claims", "aprimo_search_approved_assets"],
        prerequisites,
      }),
    ).toEqual(names);
  });

  it("offers nothing for an off-topic request, and refuses a call made anyway", async () => {
    expect(await offer([CLAIMS, TARGETS], { intents: ["off-topic"], done: [] })).toEqual([]);
    const decision = await authorizeTool(env as never, "tester", TARGETS, "c1", scope as never, {
      intents: ["off-topic"],
      done: [],
    });
    expect(decision).toMatchObject({ decision: "deny", policyId: "orchestrator-off-topic" });
  });

  it("checks a call against the context it was offered in", async () => {
    const context = { intents: ["claims"], done: [] };
    expect(
      await authorizeTool(env as never, "tester", TARGETS, "c2", scope as never, context),
    ).toMatchObject({ decision: "deny", policyId: "orchestrator-claims-check-first" });
    expect(
      await authorizeTool(env as never, "tester", CLAIMS, "c3", scope as never, context),
    ).toMatchObject({ decision: "allow" });
  });
});
