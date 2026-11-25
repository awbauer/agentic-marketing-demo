// Vertex AI as the model platform on Google Cloud (ADR-018). Chat models go through Vertex's
// OpenAI-compatible endpoint, which serves gpt-oss-120b as a managed model; images come from
// Gemini's image model;
// the squad's Anthropic provider reaches Claude on Vertex. Every call authenticates with the
// service account's own credentials (ADC), so there is no key to store.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { generateText, type LanguageModel, wrapLanguageModel } from "ai";
import { GoogleAuth } from "google-auth-library";
import type { ImageRequest, JudgeVerdict, ModelPlatform } from "../../../edge/src/platform/models";

export type VertexOptions = {
  project: string;
  /** Where gpt-oss runs, such as us-central1. */
  location: string;
  /** Where the image model runs; Gemini image models are served from "global". */
  imageLocation?: string;
  /** Where Claude runs; Anthropic models on Vertex are served from "global" or a few regions. */
  anthropicLocation?: string;
  /** Gemini image model id; gemini-3.1-flash-image by default. */
  imageModel?: string;
  /** JSON object of catalog id → Vertex model id, overriding the defaults below. */
  modelMap?: Record<string, string>;
  /** Tests pass a fake fetch and token; everything else uses ADC. */
  fetch?: typeof fetch;
  accessToken?: () => Promise<string>;
};

/** The open models Vertex hosts as managed models, by catalog id. */
export const VERTEX_DEFAULT_MODELS: Record<string, string> = {
  "@cf/openai/gpt-oss-120b": "openai/gpt-oss-120b-maas",
};

/**
 * The catalog id that serves `modelId` here. Vertex's managed API offers gpt-oss-120b but not
 * gpt-oss-20b or the other Workers AI models (checked 2026-11-25), so every chat model runs on
 * gpt-oss-120b unless VERTEX_MODEL_MAP names another Vertex model for it. The squad's open-model
 * tier and the orchestrator are re-scored on it (WU-077).
 */
export function servedCatalogId(modelId: string, map: Record<string, string> = {}) {
  if (map[modelId] || VERTEX_DEFAULT_MODELS[modelId]) return modelId;
  return "@cf/openai/gpt-oss-120b";
}

export function vertexModelId(modelId: string, map: Record<string, string> = {}) {
  const catalog = servedCatalogId(modelId, map);
  return map[catalog] ?? VERTEX_DEFAULT_MODELS[catalog] ?? catalog;
}

function host(location: string) {
  return location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
}

function adcToken() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("No Google Cloud access token is available (ADC).");
    return token;
  };
}

type CallParams = LanguageModelV4CallOptions;

/**
 * Vertex AI's gpt-oss refuses a forced tool choice ("Forced tool calling is not supported for
 * this model"), and the orchestrator forces a tool on many steps. So a forced step offers only
 * the forced tool, asks for `auto`, and says in a system message to call it now; a step that
 * requires some tool keeps them all and says to call one. The salvage middleware above this model
 * still sees the forced choice, so it still recovers a call written into the reasoning.
 */
export function unforcedToolChoice(params: CallParams): CallParams {
  const choice = params.toolChoice;
  if (choice?.type !== "tool" && choice?.type !== "required") return params;
  const tools =
    choice.type === "tool"
      ? params.tools?.filter((tool) => tool.name === choice.toolName)
      : params.tools;
  const instruction =
    choice.type === "tool"
      ? `Call the \`${choice.toolName}\` tool now. Do not answer in text on this step.`
      : "Call one of the available tools now. Do not answer in text on this step.";
  return {
    ...params,
    ...(tools ? { tools } : {}),
    toolChoice: { type: "auto" },
    prompt: [...params.prompt, { role: "system", content: instruction }],
  };
}

/** Workers AI-style options the shared code sets, translated for the OpenAI-compatible endpoint. */
export function vertexCompatibleParams(params: CallParams): CallParams {
  const unforced = unforcedToolChoice(params);
  const workersAi = unforced.providerOptions?.["workers-ai"] as
    | { reasoning_effort?: string }
    | undefined;
  if (!workersAi?.reasoning_effort) return unforced;
  return {
    ...unforced,
    providerOptions: {
      ...unforced.providerOptions,
      openai: { ...unforced.providerOptions?.openai, reasoningEffort: workersAi.reasoning_effort },
    },
  };
}

function reasoningFromWorkersAi(model: Exclude<LanguageModel, string>) {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => vertexCompatibleParams(params),
    },
  });
}

/** One structured log line per model call, standing in for AI Gateway's request log. */
function loggingFetch(
  base: typeof fetch,
  token: () => Promise<string>,
  service: string,
): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await token()}`);
    headers.delete("x-api-key");
    const response = await base(input, { ...init, headers });
    console.info(
      JSON.stringify({
        event: "model_call",
        service,
        url: String(input instanceof Request ? input.url : input).replace(/\?.*$/, ""),
        status: response.status,
        latencyMs: Date.now() - started,
      }),
    );
    return response;
  };
}

/**
 * Claude on Vertex takes the Anthropic Messages body without `model`, with a Vertex
 * `anthropic_version`, at the model's rawPredict (or streamRawPredict) URL. The squad's Anthropic
 * SDK builds requests for api.anthropic.com; this rewrites them.
 */
export function anthropicOnVertexFetch(options: {
  project: string;
  location: string;
  fetch: typeof fetch;
}): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname !== "api.anthropic.com" || !url.pathname.endsWith("/messages"))
      return options.fetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> & {
      model?: string;
      stream?: boolean;
    };
    const { model, ...rest } = body;
    if (!model) throw new Error("An Anthropic request without a model cannot be routed to Vertex.");
    const method = rest.stream ? "streamRawPredict" : "rawPredict";
    const target = `https://${host(options.location)}/v1/projects/${options.project}/locations/${options.location}/publishers/anthropic/models/${model}:${method}`;
    const headers = new Headers(init?.headers);
    for (const name of ["x-api-key", "anthropic-version", "host", "content-length"])
      headers.delete(name);
    headers.set("content-type", "application/json");
    return options.fetch(target, {
      ...init,
      headers,
      body: JSON.stringify({ ...rest, anthropic_version: "vertex-2023-10-16" }),
    });
  };
}

const decodeBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

export function vertexModels(options: VertexOptions): ModelPlatform {
  const baseFetch = options.fetch ?? fetch;
  const token = options.accessToken ?? adcToken();
  const map = options.modelMap ?? {};
  const authed = loggingFetch(baseFetch, token, "vertex-ai");
  const openai = createOpenAI({
    apiKey: "google-cloud-adc",
    baseURL: `https://${host(options.location)}/v1/projects/${options.project}/locations/${options.location}/endpoints/openapi`,
    fetch: authed,
  });
  const chat = (modelId: string) =>
    reasoningFromWorkersAi(openai.chat(vertexModelId(modelId, map))) as Exclude<
      LanguageModel,
      string
    >;
  const imageModel = options.imageModel ?? "gemini-3.1-flash-image";
  return {
    kind: "vertex",
    label: "Vertex AI",
    chat,
    served: (modelId) => servedCatalogId(modelId, map),
    async image(_model: string, request: ImageRequest) {
      const location = options.imageLocation ?? "global";
      const url = `https://${host(location)}/v1/projects/${options.project}/locations/${location}/publishers/google/models/${imageModel}:generateContent`;
      const response = await authed(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: request.width === request.height ? "1:1" : "16:9" },
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
          },
        }),
      });
      if (!response.ok) throw new Error(`The image model returned ${response.status}.`);
      const result = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
        }>;
      };
      const image = result.candidates?.[0]?.content?.parts?.find((part) =>
        part.inlineData?.mimeType?.startsWith("image/"),
      )?.inlineData;
      return image?.data ? decodeBase64(image.data) : null;
    },
    /**
     * Clef is Workers AI-only; on Vertex the judge is gpt-oss answering the same rubric as JSON,
     * returned in Clef's shape so architecture/judge.ts scores it the same way.
     */
    async judge(_model: string, input: Record<string, unknown>): Promise<JudgeVerdict> {
      const questions = (input.questions ?? {}) as Record<
        string,
        { instructions: string; criteria: readonly string[] }
      >;
      const ids = Object.keys(questions);
      const rubric = ids
        .map(
          (id) =>
            `${id}: ${questions[id]?.instructions} Answer with the index of one of: ${questions[
              id
            ]?.criteria
              .map((label, index) => `${index}=${label}`)
              .join(", ")}.`,
        )
        .join("\n");
      const { text } = await generateText({
        model: chat("@cf/openai/gpt-oss-120b"),
        system:
          "You grade an AI agent's run. Reply with one JSON object mapping each question id to an integer index, nothing else.",
        prompt: `Run:\n${JSON.stringify(input.state)}\n\nQuestions:\n${rubric}`,
        providerOptions: { openai: { reasoningEffort: "low" } },
      });
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<
        string,
        unknown
      >;
      return {
        answers: Object.fromEntries(
          ids.map((id) => [id, { type: "score", score: Number(parsed[id]) }]),
        ),
      };
    },
    vendor(provider) {
      if (provider === "openai")
        return {
          reason:
            "OpenAI models are not served by Google Cloud; this provider stays off here until it is approved (ADR-018).",
        };
      return {
        fetch: anthropicOnVertexFetch({
          project: options.project,
          location: options.anthropicLocation ?? "global",
          fetch: loggingFetch(baseFetch, token, "vertex-ai-anthropic"),
        }),
      };
    },
  };
}
