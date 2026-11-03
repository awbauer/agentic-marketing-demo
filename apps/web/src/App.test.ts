import {
  PROOF_DEFAULTS,
  TURN_TRACE_PART_ID,
  TURN_TRACE_PART_TYPE,
  type TurnTrace,
} from "@northstar/contracts";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { executionTrace, readableToolName, sanitizedPayload, sanitizedText } from "./turn-trace";

describe("technical trace hardening", () => {
  it("does not manufacture a trace for an empty assistant record", () => {
    const message: UIMessage = { id: "empty", role: "assistant", parts: [] };
    expect(executionTrace(message)).toEqual([]);
  });

  it("does not echo malformed provider tool names", () => {
    expect(readableToolName("draft_campaign_content<|Channel|>Analysis")).toBe(
      "Unrecognized tool request",
    );
    expect(readableToolName("salesforce_draft_campaign_content")).toBe("Draft Campaign Content");
  });

  it("redacts credentials embedded inside string payloads", () => {
    expect(sanitizedPayload("Authorization: Bearer abc.def.secret-value")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(sanitizedPayload("eyJabcdefghijkl.abcdefghijklmnop.abcdefgh-secret")).toBe(
      "[redacted token]",
    );
  });

  it("redacts personal data inline in reasoning text", () => {
    expect(sanitizedText("Email jo@example.invalid or call 212-555-0182 later")).toBe(
      "Email [redacted email] or call [redacted phone] later",
    );
  });

  it("reconstructs input and output events for legacy messages without a server trace", () => {
    const message = {
      id: "tool-result",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "salesforce_draft_campaign_content",
          toolCallId: "call-1",
          state: "output-available",
          input: { message: "Draft a campaign" },
          output: { isError: false, structuredContent: { message: "Draft complete" } },
        },
      ],
    } as UIMessage;

    expect(executionTrace(message).map(({ label, state }) => ({ label, state }))).toEqual([
      { label: "Step 1 started", state: "complete" },
      { label: "Tool input ready · Draft Campaign Content", state: "complete" },
      { label: "Tool output · Draft Campaign Content", state: "complete" },
    ]);
  });

  it("names the system behind a failed tool, and tells a failure from an empty result", () => {
    const row = (toolName: string, output: unknown) =>
      executionTrace({
        id: toolName,
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "dynamic-tool",
            toolName,
            toolCallId: "c",
            state: "output-available",
            input: {},
            output,
          },
        ],
      } as UIMessage).find((item) => item.label.startsWith("Tool output"))?.detail;
    expect(row("ls_aprimo_search_approved_assets", { semanticStatus: "error" })).toBe(
      "Aprimo reported that the call failed",
    );
    expect(row("graph_check_clinical_claims", { semanticStatus: "unavailable" })).toBe(
      "The knowledge graph returned no usable business result",
    );
    expect(
      row("tool_salesforce_northstar-marketing-salesforce_draft_campaign_brief", {
        semanticStatus: "error",
      }),
    ).toBe("Salesforce reported that the call failed");
  });

  it("renders every server lifecycle event in order with timings and payloads", () => {
    const trace: TurnTrace = {
      startedAt: 1_000,
      events: [
        { kind: "turn-start", at: 1_000, model: PROOF_DEFAULTS.orchestratorModel, toolCount: 3 },
        { kind: "step-start", at: 1_010, step: 0 },
        { kind: "reasoning-start", at: 1_020, index: 0 },
        { kind: "reasoning-end", at: 1_520, index: 0, chars: 12 },
        {
          kind: "tool-input-start",
          at: 1_530,
          toolCallId: "call-1",
          toolName: "salesforce_summarize_campaign",
        },
        {
          kind: "tool-input-available",
          at: 1_540,
          toolCallId: "call-1",
          toolName: "salesforce_summarize_campaign",
        },
        {
          kind: "step-finish",
          at: 1_550,
          step: 0,
          finishReason: "tool-calls",
          inputTokens: 900,
          outputTokens: 40,
        },
        { kind: "tool-output-available", at: 9_540, toolCallId: "call-1" },
        { kind: "step-start", at: 9_550, step: 1 },
        { kind: "text-start", at: 9_700, index: 0 },
        { kind: "text-end", at: 10_000, index: 0, chars: 5 },
        { kind: "step-finish", at: 10_010, step: 1, finishReason: "stop" },
        { kind: "turn-finish", at: 10_020, outcome: "completed" },
      ],
    };
    const message = {
      id: "traced",
      role: "assistant",
      parts: [
        { type: TURN_TRACE_PART_TYPE, id: TURN_TRACE_PART_ID, data: trace },
        { type: "step-start" },
        { type: "reasoning", text: "Plan a call.", state: "done" },
        {
          type: "dynamic-tool",
          toolName: "salesforce_summarize_campaign",
          toolCallId: "call-1",
          state: "output-available",
          input: { campaignId: "701jV000004GglIQAS" },
          output: { structuredContent: { name: "Launch" } },
        },
        { type: "step-start" },
        { type: "text", text: "Done.", state: "done" },
      ],
    } as UIMessage;

    const rows = executionTrace(message);
    expect(rows.map((row) => row.label)).toEqual([
      "Turn started",
      "Step 1 started",
      "Reasoning started",
      "Reasoning ended in 0.50s",
      "Tool call started · Summarize Campaign",
      "Tool input ready · Summarize Campaign",
      "Step 1 finished in 0.54s",
      "Tool output · Summarize Campaign in 8.01s",
      "Step 2 started",
      "Text started",
      "Text ended in 0.30s",
      "Step 2 finished in 0.46s",
      "Turn completed",
    ]);
    expect(rows[3]?.payload).toBe("Plan a call.");
    expect(rows[5]?.payload).toContain("701jV000004GglIQAS");
    expect(rows[6]?.detail).toBe("Finish reason: tool-calls · 900 input tokens · 40 output tokens");
    expect(rows[7]?.payload).toContain("Launch");
    expect(rows.at(-1)).toMatchObject({
      elapsed: "+9.02s",
      detail: "Total 9.02s · 940 tokens · 1 tool call",
    });
  });

  it("surfaces stream errors and timeouts as error events", () => {
    const message = {
      id: "failed",
      role: "assistant",
      parts: [
        {
          type: TURN_TRACE_PART_TYPE,
          id: TURN_TRACE_PART_ID,
          data: {
            startedAt: 0,
            events: [
              { kind: "turn-start", at: 0, model: "m", toolCount: 0 },
              { kind: "abort", at: 150_000, reason: "TimeoutError: timed out" },
              { kind: "fallback-text", at: 150_001, reason: "timed-out" },
              { kind: "turn-finish", at: 150_002, outcome: "timed-out" },
            ],
          },
        },
      ],
    } as UIMessage;
    expect(executionTrace(message).map(({ label, state }) => ({ label, state }))).toEqual([
      { label: "Turn started", state: "complete" },
      { label: "Turn aborted", state: "error" },
      { label: "Recovery message added", state: "complete" },
      { label: "Turn timed out", state: "error" },
    ]);
  });

  it("flags a tool name outside the governed catalog as an error", () => {
    const message = {
      id: "bad-tool",
      role: "assistant",
      parts: [
        {
          type: TURN_TRACE_PART_TYPE,
          id: TURN_TRACE_PART_ID,
          data: {
            startedAt: 0,
            events: [
              {
                kind: "tool-input-start",
                at: 10,
                toolCallId: "bad",
                toolName: "salesforce_summarize_campaign<|channel|>analysis",
              },
            ],
          },
        },
      ],
    } as UIMessage;
    expect(executionTrace(message)[0]).toMatchObject({
      label: "Tool call started · Unrecognized tool request",
      detail: "The model requested a tool outside the governed catalog",
      state: "error",
    });
  });
});
