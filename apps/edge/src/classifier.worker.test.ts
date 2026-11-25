import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { classifyByRules, classifyRequest, isOffTopic } from "./classifier";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const replying = (text: string) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });

describe("the request classifier (ADR-020)", () => {
  it("labels the scenarios the rules name, and claims about a drug's effects", () => {
    expect(classifyByRules("Are Cardivance's clinical claims supported?")).toContain("claims");
    expect(classifyByRules("Can we say Cardivance reduces mortality in our email?")).toContain(
      "claims",
    );
    expect(classifyByRules("Which hospitals should Lumera prioritize for Cardivance?")).toContain(
      "target-list",
    );
    expect(classifyByRules("What did the Fed announce, and which approved content fits?")).toEqual(
      new Set(["fed-news"]),
    );
    expect(
      classifyByRules("Markets are tumbling; what approved content can we send clients?"),
    ).toEqual(new Set(["market-volatility"]));
    expect(classifyByRules("Hello there")).toEqual(new Set());
  });

  it("lets the model add what the rules missed, but never remove a rule's label", async () => {
    const paraphrase = "Is it OK to tell doctors our heart drug cuts deaths by a fifth?";
    expect(classifyByRules(paraphrase).has("claims")).toBe(false);
    const added = await classifyRequest(paraphrase, {
      model: replying('Here: {"intents":["claims","not-a-label"]}'),
    });
    expect(added).toMatchObject({ intents: ["claims"], by: "model", modelAdded: ["claims"] });

    const kept = await classifyRequest("Can we say Cardivance reduces mortality?", {
      model: replying('{"intents":["general"]}'),
    });
    expect(kept.intents).toEqual(["claims"]);
    expect(kept.by).toBe("rules");
  });

  it("falls back to the rules when the model fails, and to general when nothing fits", async () => {
    const failing = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("model down");
      },
    });
    expect(
      (await classifyRequest("Can we say Cardivance reduces mortality?", { model: failing }))
        .intents,
    ).toEqual(["claims"]);
    expect(await classifyRequest("Hello there")).toMatchObject({
      intents: ["general"],
      by: "none",
    });
  });

  it("marks an unrelated request off topic, but never one a scenario names", async () => {
    const lottery = await classifyRequest("What are this week's winning lottery numbers?", {
      model: replying('{"intents":["off-topic"]}'),
    });
    expect(lottery).toMatchObject({ intents: ["off-topic"], by: "model" });
    expect(isOffTopic(lottery)).toBe(true);
    // A rule's scenario wins over the model's "off topic".
    const claims = await classifyRequest("Can we say Cardivance reduces mortality?", {
      model: replying('{"intents":["off-topic"]}'),
    });
    expect(claims.intents).toEqual(["claims"]);
    expect(isOffTopic(claims)).toBe(false);
    // "off-topic" mixed with a real label is not off topic.
    const mixed = await classifyRequest("Draft a campaign and tell me the lottery numbers", {
      model: replying('{"intents":["campaign-draft","off-topic"]}'),
    });
    expect(mixed.intents).toEqual(["campaign-draft"]);
  });
});
