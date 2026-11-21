import { streamText } from "ai";
import { describe, expect, it } from "vitest";
import { anthropicModel } from "./anthropic";
import { GATEWAY_HELD_KEY, gatewayFetch } from "./gateway";
import { openaiModel } from "./run";

// biome-ignore lint/suspicious/noExplicitAny: request bodies are untyped JSON in these tests
type Json = Record<string, any>;
type Seen = { url: string; headers: Headers; body: Json };

const claudeReply = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Hello." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 2 },
};

/** An AI binding whose fetch records what it was asked to send. */
function bindingWithFetch(reply: unknown) {
  const seen: Seen[] = [];
  const ai = {
    fetch: async (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer)) as Json,
      });
      return new Response(JSON.stringify(reply), {
        headers: { "content-type": "application/json" },
      });
    },
    gateway: () => ({ getUrl: async () => "unused" }),
  } as unknown as Ai;
  return { ai, seen };
}

describe("AI Gateway route", () => {
  it("sends Claude requests through the AI binding to the gateway, with no vendor key", async () => {
    const { ai, seen } = bindingWithFetch(claudeReply);
    const fetch = gatewayFetch({
      ai,
      gatewayId: "northstar-marketing-pot",
      metadata: { run: "team-1", agent: "copy-lead" },
    });
    const result = streamText({
      model: anthropicModel({ apiKey: GATEWAY_HELD_KEY, effort: "low", fetch }),
      prompt: "Hi",
    });
    expect(await result.text).toBe("Hello.");
    const [request] = seen;
    expect(request?.url).toBe(
      "https://workers-binding.ai/ai-gateway/gateways/northstar-marketing-pot/anthropic/v1/messages",
    );
    // The gateway supplies the stored key only when the request carries none.
    expect(request?.headers.get("x-api-key")).toBeNull();
    expect(request?.headers.get("authorization")).toBeNull();
    expect(request?.headers.get("cf-aig-no-wholesale")).toBe("true");
    expect(JSON.parse(request?.headers.get("cf-aig-metadata") ?? "{}")).toEqual({
      run: "team-1",
      agent: "copy-lead",
    });
    expect(request?.headers.get("anthropic-version")).toBeTruthy();
    expect(request?.body.model).toBe("claude-opus-5-5");
  });

  it("sends OpenAI requests through the binding too, without the bearer key", async () => {
    const { ai, seen } = bindingWithFetch({ error: { message: "test stop" } });
    const fetch = gatewayFetch({ ai, gatewayId: "gw" });
    const result = streamText({
      model: openaiModel({ apiKey: GATEWAY_HELD_KEY, model: "gpt-6-astra", effort: "low", fetch }),
      prompt: "Hi",
      maxRetries: 0,
    });
    await result.consumeStream({ onError: () => undefined });
    expect(seen[0]?.url).toBe(
      "https://workers-binding.ai/ai-gateway/gateways/gw/openai/v1/responses",
    );
    expect(seen[0]?.headers.get("authorization")).toBeNull();
    expect(seen[0]?.body.model).toBe("gpt-6-astra");
  });

  it("falls back to the gateway's public URL with a gateway token, and never goes around it", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response(JSON.stringify(claudeReply), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const ai = {
        gateway: (id: string) => ({
          getUrl: async (provider: string) =>
            `https://gateway.ai.cloudflare.com/v1/acct/${id}/${provider}/`,
        }),
      } as unknown as Ai;
      const fetch = gatewayFetch({ ai, gatewayId: "gw", token: "aig-token" });
      const result = streamText({
        model: anthropicModel({ apiKey: GATEWAY_HELD_KEY, effort: "low", fetch }),
        prompt: "Hi",
      });
      expect(await result.text).toBe("Hello.");
      expect(calls[0]?.url).toBe(
        "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages",
      );
      expect(calls[0]?.headers.get("cf-aig-authorization")).toBe("Bearer aig-token");
      expect(calls[0]?.headers.get("x-api-key")).toBeNull();
      await expect(fetch("https://example.com/v1/messages")).rejects.toThrow(
        "not routed through the AI Gateway",
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
