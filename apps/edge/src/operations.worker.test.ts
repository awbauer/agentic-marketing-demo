import { SELF } from "cloudflare:test";
import { parseOperationControls } from "@northstar/contracts";
import { describe, expect, it } from "vitest";
import { writeBlockReason } from "./orchestrator";
import { openCatalogCampaign } from "./worker.test-helpers";

describe("operator controls", () => {
  it("defaults to writes enabled and ignores unknown tool names", () => {
    expect(parseOperationControls({})).toEqual({
      writesEnabled: true,
      memoryEnabled: true,
      disabledTools: [],
      disabledAgents: [],
    });
    expect(parseOperationControls({ MEMORY_ENABLED: "False" }).memoryEnabled).toBe(false);
    expect(
      parseOperationControls({ DISABLED_AGENTS: " reuse, optimization ," }).disabledAgents,
    ).toEqual(["reuse", "optimization"]);
    expect(
      parseOperationControls({
        WRITES_ENABLED: " FALSE ",
        DISABLED_TOOLS: "attach_campaign_image, publish_everything ,summarize_campaign",
      }),
    ).toEqual({
      writesEnabled: false,
      memoryEnabled: true,
      disabledTools: ["summarize_campaign", "attach_campaign_image"],
      disabledAgents: [],
    });
  });

  it("blocks every write when paused and only the disabled write otherwise", () => {
    const paused = parseOperationControls({ WRITES_ENABLED: "false" });
    expect(writeBlockReason(paused, "create-review-task")).toMatch(/paused/);
    const attachOff = parseOperationControls({ DISABLED_TOOLS: "attach_campaign_image" });
    expect(writeBlockReason(attachOff, "attach-generated-image")).toMatch(/turned off/);
    expect(writeBlockReason(attachOff, "create-review-task")).toBeNull();
  });

  it("reports the active controls", async () => {
    const response = await SELF.fetch("https://example.test/agent/operations");
    await expect(response.json()).resolves.toEqual({
      writesEnabled: true,
      memoryEnabled: true,
      disabledTools: [],
      disabledAgents: [],
      knowledgeGraph: "fixture",
    });
  });

  it("exports this user's confirmed-write audit and turn summaries as a download", async () => {
    await openCatalogCampaign();
    await SELF.fetch("https://example.test/agent/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create-review-task",
        recordId: "701jV000004GglIQAS",
        summary: "Create a review task for the current blockers.",
      }),
    });
    const response = await SELF.fetch("https://example.test/agent/audit/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="northstar-audit-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = (await response.json()) as {
      retentionHours: number;
      confirmations: Array<{ action: string; status: string }>;
      turns: unknown[];
    };
    expect(body.retentionHours).toBe(24);
    expect(body.confirmations).toContainEqual(
      expect.objectContaining({ action: "create-review-task", status: "pending" }),
    );
    expect(Array.isArray(body.turns)).toBe(true);
  });
});
