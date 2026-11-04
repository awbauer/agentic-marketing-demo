import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toolCalls } from "./ToolActivity";

describe("tool activity", () => {
  it("tells a call waiting for its result from one that returned or failed", () => {
    const part = (toolCallId: string, state: string, output?: unknown) => ({
      type: "dynamic-tool",
      toolName: "ls_aprimo_search_approved_assets",
      toolCallId,
      state,
      input: {},
      ...(output ? { output } : {}),
    });
    const calls = toolCalls({
      id: "m",
      role: "assistant",
      parts: [
        part("a", "input-available"),
        part("b", "output-available", { structuredContent: {} }),
        part("c", "output-available", { semanticStatus: "error" }),
      ],
    } as UIMessage);
    expect(calls.map((call) => [call.system, call.state])).toEqual([
      ["Aprimo", "running"],
      ["Aprimo", "done"],
      ["Aprimo", "failed"],
    ]);
  });
});
