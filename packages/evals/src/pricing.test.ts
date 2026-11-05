import { describe, expect, it } from "vitest";
import { formatUsd, NEURON_USD, priceFor, sumCosts, turnCost, WORKERS_AI_PRICING } from "./pricing";

describe("Workers AI pricing", () => {
  it("prices a turn from per-million-token rates", () => {
    const cost = turnCost("@cf/openai/gpt-oss-120b", { inputTokens: 1_000_000, outputTokens: 1e6 });
    expect(cost.usd).toBeCloseTo(1.1, 10);
  });

  it("bills cached input at the cached rate when the model has one", () => {
    const cost = turnCost("@cf/zai-org/glm-5.3", {
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 0,
    });
    expect(cost.usd).toBeCloseTo(0.5 * 1.4 + 0.5 * 0.26, 10);
  });

  it("bills cached tokens at the full rate when the model has no cache discount", () => {
    const cost = turnCost("@cf/openai/gpt-oss-20b", {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(cost.usd).toBeCloseTo(0.2, 10);
  });

  it("matches Cloudflare's published neuron rates", () => {
    // Cloudflare lists 31818 neurons per million gpt-oss-120b input tokens.
    const cost = turnCost("@cf/openai/gpt-oss-120b", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost.neurons).toBeCloseTo(31818, -1);
    expect(cost.usd / cost.neurons).toBeCloseTo(NEURON_USD, 12);
  });

  it("refuses to price an unknown model", () => {
    expect(() => priceFor("@cf/unknown/model")).toThrow(/No Workers AI price/);
  });

  it("sums costs and ignores missing ones", () => {
    expect(sumCosts([{ usd: 1, neurons: 10 }, undefined, { usd: 2, neurons: 5 }])).toEqual({
      usd: 3,
      neurons: 15,
    });
  });

  it("has a positive price for every model", () => {
    for (const price of Object.values(WORKERS_AI_PRICING)) {
      expect(price.input).toBeGreaterThan(0);
      expect(price.output).toBeGreaterThan(0);
    }
  });
});

it.each([
  [0, "$0.0000"],
  [0.001234, "$0.0012"],
  [0.059, "$0.0590"],
  [5.3, "$5.3000"],
])("formats %s USD with four decimal places", (amount, expected) => {
  expect(formatUsd(amount)).toBe(expected);
});
