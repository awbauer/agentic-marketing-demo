import type { FlowEvent } from "@northstar/architecture";
import { describe, expect, it } from "vitest";
import { assetOf } from "./asset";

const urn = "urn:northstar:module:ck-push";
const allow = { decision: "allow", policyId: "agent-grants", reason: "granted" };
const tool = (callId: string, step: Record<string, unknown>): FlowEvent => ({
  type: "tool",
  callId,
  agent: "x",
  step: { ok: true, input: {}, decision: allow, ...step } as never,
});
const delegate = (callId: string, agent: string, name: string): FlowEvent => ({
  type: "delegate",
  callId,
  agent,
  name,
  persona: "content-lab",
  task: "t",
  refs: {},
});
const moduleView = (over: Record<string, unknown> = {}) => ({
  urn,
  title: "Soup weather",
  state: "draft",
  attributes: {
    headline: "Soup weather",
    channel: "push",
    topics: ["chowder-price", "soup-hours"],
    blocks: [
      { text: "Chowder is $8.", claimUrn: "urn:northstar:claim:price" },
      { text: "Soup until 9pm.", claimUrn: "urn:northstar:claim:hours" },
    ],
  },
  ...over,
});

describe("assetOf", () => {
  it("is empty until the authoring agent writes, and says when it is drafting", () => {
    expect(assetOf([]).master).toBeUndefined();
    expect(assetOf([delegate("a", "module-authoring", "Author")]).drafting).toBe(true);
  });

  it("composes the module, pins findings to the block they quote, and follows the state", () => {
    const events: FlowEvent[] = [
      delegate("b", "brief", "Brief agent"),
      tool("b", {
        tool: "draft_brief",
        output: { brief: { wave: { segment: "app-near-san-francisco", sendOn: "2026-11-09" } } },
      }),
      delegate("a", "module-authoring", "Module authoring agent"),
      tool("a", { tool: "author_module", output: { module: moduleView(), refused: [] } }),
      { type: "delegated", callId: "a", agent: "module-authoring", ok: true },
      delegate("f", "adversarial-farm", "Farm"),
      tool("f", {
        tool: "run_farm",
        input: { moduleUrn: urn },
        output: [
          { probe: "claim-attacker", severity: "block", message: 'Uncited: "Soup until 9pm."' },
          { probe: "consent-prober", severity: "warn", message: "Low push consent." },
        ],
      }),
      tool("f", {
        tool: "report_finding",
        input: { probe: "brand-checker", message: "Feels pushy." },
      }),
      delegate("x", "atomization", "Atomization"),
      tool("x", {
        tool: "atomize_module",
        input: { moduleUrn: urn },
        output: [
          {
            variant: moduleView({
              urn: `${urn}-sms`,
              attributes: { ...moduleView().attributes, channel: "sms" },
            }),
            length: 30,
            limit: 160,
            fits: true,
            blockers: [],
          },
        ],
      }),
      delegate("r", "readiness", "Readiness"),
      tool("r", {
        tool: "check_readiness",
        output: { moduleUrn: urn, ready: true, blockers: [] },
      }),
      tool("r", {
        tool: "propose_transition",
        input: { moduleUrn: urn },
        output: { proposed: true },
      }),
      { type: "decided", moduleUrn: urn, state: "approved", persona: "Reviewer" },
    ];
    const asset = assetOf(events);
    expect(asset.audience?.segment).toBe("app-near-san-francisco");
    expect(asset.master?.blocks.map((block) => [block.role, block.topic])).toEqual([
      ["headline", undefined],
      ["claim", "chowder-price"],
      ["claim", "soup-hours"],
    ]);
    expect(asset.master?.blocks[1]?.by).toEqual({
      agent: "Module authoring agent",
      tool: "author_module",
      policyId: "agent-grants",
    });
    expect(asset.master?.blocks[2]?.findings.map((finding) => finding.probe)).toEqual([
      "claim-attacker",
    ]);
    expect(asset.findings.map((finding) => [finding.probe, finding.byAgent ?? false])).toEqual([
      ["consent-prober", false],
      ["brand-checker", true],
    ]);
    expect(
      asset.variants.map((variant) => [variant.channel, variant.length, variant.limit]),
    ).toEqual([["sms", 30, 160]]);
    expect(asset.readiness?.ready).toBe(true);
    expect(asset.master?.state).toBe("approved");
    expect(asset.drafting).toBe(false);
  });

  it("keeps out refused topics and only the wording the service quoted", () => {
    const asset = assetOf([
      delegate("a", "module-authoring", "Author"),
      tool("a", {
        tool: "author_module",
        ok: false,
        // The service checks each sentence, and quotes only the ones it rejects.
        input: { headline: "Best soup ever", framing: ["Hello there. Cheapest in town."] },
        error:
          '"Best soup ever" makes an absolute promise. "Cheapest in town." makes a comparison, which only a cited claim can make.',
      }),
      tool("a", {
        tool: "author_module",
        ok: false,
        input: { headline: "Best soup ever", framing: [] },
        error: '"Best soup ever" makes an absolute promise.',
      }),
      tool("a", {
        tool: "author_module",
        output: {
          module: moduleView(),
          refused: [{ topic: "free-delivery", reason: "No approved claim exists." }],
        },
      }),
    ]);
    expect(asset.rejected.map((block) => [block.status, block.role, block.text])).toEqual([
      ["rejected", "headline", "Best soup ever"],
      ["rejected", "framing", "Cheapest in town."],
      ["refused", "claim", "free-delivery"],
    ]);
    expect(asset.rejected[0]?.reason).toBe('"Best soup ever" makes an absolute promise.');
    expect(asset.rejected[1]?.reason).toBe(
      '"Cheapest in town." makes a comparison, which only a cited claim can make.',
    );
  });

  it("ignores checks on another module", () => {
    const asset = assetOf([
      tool("a", { tool: "author_module", output: { module: moduleView(), refused: [] } }),
      tool("r", {
        tool: "check_readiness",
        output: { moduleUrn: "urn:northstar:module:old", ready: false, blockers: [] },
      }),
    ]);
    expect(asset.readiness).toBeUndefined();
  });
});
