// Per-model request-rate limiter. Cloudflare caps Workers AI text generation at 300 requests per
// minute per account per model, but models that need the Workers Paid plan (the frontier tier)
// at 20 per minute (50 with prepaid AI Gateway credits). Contestant turns, judge calls, and the
// simulated agent all draw on the same per-model limit, so every call goes through one limiter.
import { wrapLanguageModel } from "ai";

const WINDOW_MS = 60_000;
// Stay under the published limits so a slow response or a retry does not tip a burst over.
export const DEFAULT_RPM = 250;
export const PAID_MODEL_RPM = 18;
const PAID_MODELS = new Set([
  "@cf/moonshotai/kimi-k2.6",
  "@cf/zai-org/glm-5.3",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
]);

export const requestsPerMinute = (modelId) =>
  PAID_MODELS.has(modelId) ? PAID_MODEL_RPM : DEFAULT_RPM;

/**
 * A sliding-window limiter: at most `limit` acquisitions in any 60 seconds. Priority 0 (contestant
 * turns, which run against a turn timeout) is served before priority 1 (judge calls, which can wait).
 */
export function createLimiter(
  limit,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const starts = [];
  const waiting = [[], []];
  let running = false;
  async function pump() {
    if (running) return;
    running = true;
    try {
      // Wait for a free slot first, then pick the waiter, so a turn that arrives while a judge
      // call is waiting still goes first.
      while (waiting[0].length || waiting[1].length) {
        const cutoff = now() - WINDOW_MS;
        while (starts.length && starts[0] <= cutoff) starts.shift();
        if (starts.length >= limit) {
          await sleep(starts[0] + WINDOW_MS - now() + 5);
          continue;
        }
        const next = waiting[0].shift() ?? waiting[1].shift();
        starts.push(now());
        next();
      }
    } finally {
      running = false;
    }
  }
  return {
    acquire(priority = 0) {
      return new Promise((resolve) => {
        waiting[priority].push(resolve);
        pump();
      });
    },
  };
}

/**
 * Wraps a provider so every model call waits for its model's rate-limit slot. The returned function
 * serves contestant turns; its `background` variant shares the same limits at lower priority.
 */
export function throttled(provider) {
  const limiters = new Map();
  const limiterFor = (id) => {
    if (!limiters.has(id)) limiters.set(id, createLimiter(requestsPerMinute(id)));
    return limiters.get(id);
  };
  const wrap = (modelId, priority) =>
    wrapLanguageModel({
      model: provider(modelId),
      middleware: {
        wrapGenerate: async ({ doGenerate }) => {
          await limiterFor(modelId).acquire(priority);
          return doGenerate();
        },
        wrapStream: async ({ doStream }) => {
          await limiterFor(modelId).acquire(priority);
          return doStream();
        },
      },
    });
  const model = (modelId) => wrap(modelId, 0);
  model.background = (modelId) => wrap(modelId, 1);
  return model;
}

/** How many turns to run at once for a model: paid frontier models are slow and tightly limited. */
export const concurrencyFor = (modelId) => (requestsPerMinute(modelId) < 100 ? 3 : 6);
