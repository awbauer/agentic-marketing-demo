// Where the app's models come from. Cloudflare: Workers AI through AI Gateway. Google Cloud: the
// host sets `env.MODELS` to Vertex AI (ADR-018). Feature code asks for a model by its catalog id
// (`@cf/openai/gpt-oss-120b`) either way; the Vertex platform maps the id to its own model.
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";

export type ImageRequest = {
  prompt: string;
  width: number;
  height: number;
  seed?: number | undefined;
};

/**
 * A rubric verdict: `{ answers: { [question]: { type: "score", score } } }`, score 0 to the number
 * of criteria minus one, as Clef returns it. The judge reads it; see architecture/judge.ts.
 */
export type JudgeVerdict = Record<string, unknown>;

export type ModelPlatform = {
  kind: "workers-ai" | "vertex";
  /** Shown on the route map: the service every model call goes through. */
  label: string;
  /** An AI SDK model for a catalog id. */
  chat(modelId: string): Exclude<LanguageModel, string>;
  /** The catalog id actually served for `modelId` (Vertex maps ids it does not host). */
  served(modelId: string): string;
  /** A PNG for the prompt, or null when the model returned none. */
  image(model: string, request: ImageRequest): Promise<Uint8Array | null>;
  /** Runs the answer-quality judge; undefined when this platform has none. */
  judge?(model: string, input: Record<string, unknown>): Promise<JudgeVerdict>;
  /**
   * How the squad's vendor SDKs reach a vendor here: a fetch that routes their requests, or why
   * that vendor cannot run. Undefined on Workers AI, where the AI Gateway path in team/run.ts applies.
   */
  vendor?(
    provider: "anthropic" | "openai",
    metadata: Record<string, string>,
  ): { fetch: typeof fetch } | { reason: string };
};

export type ModelBindings = { AI?: Ai; AI_GATEWAY_ID?: string; MODELS?: ModelPlatform };

/** The models for this environment, or null when none is bound (tests, offline local). */
export function modelPlatform(env: ModelBindings): ModelPlatform | null {
  if (env.MODELS) return env.MODELS;
  if (!env.AI) return null;
  return workersAiModels(env.AI, env.AI_GATEWAY_ID);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function workersAiModels(ai: Ai, gatewayId?: string): ModelPlatform {
  const gateway = gatewayId ? { gateway: { id: gatewayId } } : {};
  const workersAI = createWorkersAI({ binding: ai, ...gateway });
  return {
    kind: "workers-ai",
    label: "Workers AI",
    chat: (modelId) => workersAI(modelId as Parameters<typeof workersAI>[0]),
    served: (modelId) => modelId,
    async image(model, request) {
      const form = new FormData();
      form.append("prompt", request.prompt);
      form.append("width", String(request.width));
      form.append("height", String(request.height));
      if (request.seed !== undefined) form.append("seed", String(request.seed));
      const encoded = new Response(form);
      // Image generation has always gone straight to Workers AI, not through the gateway.
      const result = (await ai.run(model as "@cf/black-forest-labs/flux-2-klein-4b", {
        multipart: {
          body: encoded.body ?? undefined,
          contentType: encoded.headers.get("content-type") ?? undefined,
        },
      })) as { image?: string };
      return result.image ? decodeBase64(result.image) : null;
    },
    async judge(model, input) {
      return (await ai.run(
        model as Parameters<Ai["run"]>[0],
        input as never,
        gateway,
      )) as JudgeVerdict;
    },
  };
}
