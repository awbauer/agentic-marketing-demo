import { stepCountIs, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { anthropicModel, toAnthropic } from "./anthropic";

// biome-ignore lint/suspicious/noExplicitAny: request bodies are untyped JSON in these tests
type Json = Record<string, any>;

/** A stand-in for the Messages API: records each request body and replies from a script. */
function fakeApi(replies: Json[]) {
  const bodies: Json[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Json);
    const reply = replies[bodies.length - 1] ?? replies.at(-1);
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const message = (content: Json[], stop_reason: string) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
});

describe("Anthropic adapter", () => {
  it("runs a tool loop through the Anthropic SDK and replays Claude's turns unchanged", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
    const api = fakeApi([
      message(
        [
          thinking,
          { type: "tool_use", id: "toolu_1", name: "get_segments", input: { brand: "x" } },
        ],
        "tool_use",
      ),
      message([{ type: "text", text: "Lunch commuters are the core audience." }], "end_turn"),
    ]);
    const result = streamText({
      model: anthropicModel({ apiKey: "test", effort: "low", fetch: api.fetch }),
      system: "You are the audience analyst.",
      prompt: "Find the audience.",
      tools: {
        get_segments: tool({
          description: "Segments",
          inputSchema: z.object({ brand: z.string() }),
          execute: async () => ({ segments: ["ck-seg-lunch-commuters"] }),
        }),
      },
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "get_segments" } } : {},
      stopWhen: stepCountIs(4),
    });
    expect(await result.text).toBe("Lunch commuters are the core audience.");
    expect(api.bodies).toHaveLength(2);
    const [first, second] = api.bodies as [Json, Json];

    // Opus 5.5 rejects forced tool choice: ask for auto, and name the tool in a system message.
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tool_choice).toEqual({ type: "auto" });
    expect(first.messages.at(-1)).toEqual({
      role: "system",
      content: "Call the get_segments tool now. Do not answer in prose.",
    });
    expect(first.system).toBe("You are the audience analyst.");
    expect(first.output_config).toEqual({ effort: "low" });
    expect(first.fallbacks).toBe("default");
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.tools[0]).toMatchObject({
      name: "get_segments",
      input_schema: { type: "object" },
    });
    expect(first.thinking).toBeUndefined();

    // The second request replays Claude's turn exactly, thinking block and signature included,
    // then the tool result in a user turn.
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: [
        thinking,
        { type: "tool_use", id: "toolu_1", name: "get_segments", input: { brand: "x" } },
      ],
    });
    expect(second.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: JSON.stringify({ segments: ["ck-seg-lunch-commuters"] }),
        },
      ],
    });
    expect(second.tool_choice).toEqual({ type: "auto" });
    expect(second.messages.some((item: Json) => item.role === "system")).toBe(false);
  });

  it("reports Claude's usage, including cached input", async () => {
    const reply = message([{ type: "text", text: "Done." }], "end_turn");
    reply.usage = {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: 0,
    };
    const api = fakeApi([reply]);
    const result = streamText({
      model: anthropicModel({ apiKey: "test", effort: "medium", fetch: api.fetch }),
      prompt: "Hi",
    });
    const usage = await result.totalUsage;
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(5);
    expect(api.bodies[0]?.output_config).toEqual({ effort: "medium" });
  });

  it("turns error tool results into is_error blocks", () => {
    const { messages } = toAnthropic([
      { role: "user", content: [{ type: "text", text: "Go" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "t1", toolName: "plan_media", input: "{}" }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "plan_media",
            output: { type: "error-text", value: "Over budget." },
          },
        ],
      },
    ]);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "Over budget.", is_error: true },
      ],
    });
  });
});
