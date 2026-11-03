// Workers AI list prices, copied from Cloudflare's pricing page. Cloudflare bills in neurons at a
// fixed USD rate and publishes per-token rates alongside, so USD is the source and neurons derive.
export const PRICING_SOURCE = "https://developers.cloudflare.com/workers-ai/platform/pricing/";
export const PRICING_AS_OF = "2026-09-17";
export const NEURON_USD = 0.011 / 1000;
export const FREE_NEURONS_PER_DAY = 10_000;

export type ModelPrice = {
  /** USD per million input tokens. */
  input: number;
  /** USD per million cached input tokens; absent when the model has no cache discount. */
  cachedInput?: number;
  /** USD per million output tokens. */
  output: number;
};

export const WORKERS_AI_PRICING: Readonly<Record<string, ModelPrice>> = {
  "@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75 },
  "@cf/openai/gpt-oss-20b": { input: 0.2, output: 0.3 },
  // No longer run (ADR-011), but the committed report holds their turns and rescoring prices them.
  "@cf/zai-org/glm-4.7-flash": { input: 0.06, output: 0.4 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { input: 0.27, output: 0.85 },
  "@cf/moonshotai/kimi-k2.6": { input: 0.95, cachedInput: 0.16, output: 4 },
  "@cf/zai-org/glm-5.3": { input: 1.4, cachedInput: 0.26, output: 4.4 },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": { input: 1.32, cachedInput: 0.044, output: 3.96 },
};

export type Usage = {
  inputTokens: number;
  /** Portion of inputTokens served from cache; billed at the cached rate when one exists. */
  cachedInputTokens?: number;
  outputTokens: number;
};
export type Cost = { usd: number; neurons: number };

export function priceFor(model: string): ModelPrice {
  const price = WORKERS_AI_PRICING[model];
  // A model without a price would silently cost $0 in every report, so fail loudly instead.
  if (!price) throw new Error(`No Workers AI price recorded for ${model}; add it to pricing.ts.`);
  return price;
}

export function turnCost(model: string, usage: Usage): Cost {
  const price = priceFor(model);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const cachedRate = price.cachedInput ?? price.input;
  const usd =
    ((usage.inputTokens - cached) * price.input +
      cached * cachedRate +
      usage.outputTokens * price.output) /
    1_000_000;
  return { usd, neurons: usd / NEURON_USD };
}

export const sumCosts = (costs: readonly (Cost | undefined)[]): Cost =>
  costs.reduce<Cost>(
    (total, cost) => ({
      usd: total.usd + (cost?.usd ?? 0),
      neurons: total.neurons + (cost?.neurons ?? 0),
    }),
    { usd: 0, neurons: 0 },
  );

export const formatUsd = (usd: number) =>
  usd === 0 ? "$0" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
