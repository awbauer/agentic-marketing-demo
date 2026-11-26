// Amazon Bedrock as a model platform (ADR-023), called from either host the way Vertex AI is.
// Chat models go through Bedrock's OpenAI-compatible Chat Completions endpoint, which serves
// gpt-oss-120b and gpt-oss-20b; campaign images come from Amazon Nova Canvas through InvokeModel.
// Both take a Bedrock API key as a bearer token, so no request signing is needed and plain fetch
// runs in a Worker as well as in Node.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ImageRequest, ModelPlatform } from "./models";
import { openModelCompat, rubricJudge } from "./vertex";

export type BedrockOptions = {
  /** Where gpt-oss runs, such as us-west-2. */
  region: string;
  /** Where the image model runs; Nova Canvas is served from fewer regions (us-east-1). */
  imageRegion?: string;
  /** Nova Canvas by default. */
  imageModel?: string;
  /** A Bedrock API key, sent as a bearer token. */
  apiKey: string;
  /** Catalog id → Bedrock model id, overriding the defaults below. */
  modelMap?: Record<string, string>;
  /** Tests pass a fake fetch. */
  fetch?: typeof fetch;
};

/** The open models Bedrock serves, by catalog id. */
export const BEDROCK_DEFAULT_MODELS: Record<string, string> = {
  "@cf/openai/gpt-oss-120b": "openai.gpt-oss-120b-1:0",
  "@cf/openai/gpt-oss-20b": "openai.gpt-oss-20b-1:0",
};

/** The catalog id that serves `modelId`: one Bedrock serves, else gpt-oss-120b. */
export function bedrockServedCatalogId(modelId: string, map: Record<string, string> = {}) {
  if (map[modelId] || BEDROCK_DEFAULT_MODELS[modelId]) return modelId;
  return "@cf/openai/gpt-oss-120b";
}

export function bedrockModelId(modelId: string, map: Record<string, string> = {}) {
  const catalog = bedrockServedCatalogId(modelId, map);
  return map[catalog] ?? BEDROCK_DEFAULT_MODELS[catalog] ?? catalog;
}

const runtime = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`;

/** Adds the API key and logs one line per model call, as Vertex's calls do. */
function bedrockFetch(base: typeof fetch, apiKey: string): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    const response = await base(input, { ...init, headers });
    console.info(
      JSON.stringify({
        event: "model_call",
        service: "amazon-bedrock",
        url: String(input instanceof Request ? input.url : input).replace(/\?.*$/, ""),
        status: response.status,
        latencyMs: Date.now() - started,
      }),
    );
    return response;
  };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bedrockModels(options: BedrockOptions): ModelPlatform {
  const map = options.modelMap ?? {};
  const authed = bedrockFetch(options.fetch ?? fetch, options.apiKey);
  const openai = createOpenAI({
    apiKey: "amazon-bedrock",
    baseURL: `${runtime(options.region)}/openai/v1`,
    fetch: authed,
  });
  const chat = (modelId: string) =>
    openModelCompat(openai.chat(bedrockModelId(modelId, map))) as Exclude<LanguageModel, string>;
  const imageModel = options.imageModel ?? "amazon.nova-canvas-v1:0";
  return {
    kind: "bedrock",
    label: "Amazon Bedrock",
    imageModel,
    chat,
    served: (modelId) => bedrockServedCatalogId(modelId, map),
    async image(_model: string, request: ImageRequest) {
      const region = options.imageRegion ?? "us-east-1";
      const response = await authed(
        `${runtime(region)}/model/${encodeURIComponent(imageModel)}/invoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            taskType: "TEXT_IMAGE",
            textToImageParams: { text: request.prompt.slice(0, 1024) },
            imageGenerationConfig: {
              numberOfImages: 1,
              width: request.width,
              height: request.height,
              ...(request.seed !== undefined ? { seed: request.seed } : {}),
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`The image model returned ${response.status}.`);
      const result = (await response.json()) as { images?: string[] };
      const image = result.images?.[0];
      return image ? decodeBase64(image) : null;
    },
    // Clef is Workers AI-only; here gpt-oss answers the same rubric.
    judge: rubricJudge(chat),
  };
}
