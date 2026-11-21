import { streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openaiModel } from "./run";

// biome-ignore lint/suspicious/noExplicitAny: request bodies are untyped JSON in these tests
type Json = Record<string, any>;

describe("OpenAI provider", () => {
  it("calls the Responses API with the agent's tools, forced choice and reasoning effort", async () => {
    const requests: Array<{ url: string; body: Json }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)) as Json });
      return new Response("upstream unavailable in tests", { status: 503 });
    }) as unknown as typeof globalThis.fetch;
    const result = streamText({
      model: openaiModel({ apiKey: "test", model: "gpt-6-astra", effort: "low", fetch }),
      prompt: "Plan the media.",
      tools: {
        plan_media: tool({
          description: "Save the plan",
          inputSchema: z.object({ total: z.number() }),
        }),
      },
      toolChoice: { type: "tool", toolName: "plan_media" },
      maxRetries: 0,
    });
    await result.consumeStream({ onError: () => undefined });
    const request = requests[0];
    expect(request?.url).toMatch(/\/responses$/);
    expect(request?.body.model).toBe("gpt-6-astra");
    expect(request?.body.reasoning).toMatchObject({ effort: "low" });
    expect(request?.body.tool_choice).toMatchObject({ type: "function", name: "plan_media" });
    expect(request?.body.tools[0]).toMatchObject({ type: "function", name: "plan_media" });
  });
});
