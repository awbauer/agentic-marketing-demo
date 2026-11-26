// Azure AI Foundry as a model platform (ADR-023), called from either host the way Vertex AI is.
// Chat models go through the resource's OpenAI-compatible v1 API, where gpt-oss-120b runs as a
// deployment; campaign images come from a GPT Image deployment on the same resource. Plain fetch
// only, so it runs in a Worker as well as in Node. The resource is reached with its API key, or
// with a Microsoft Entra service principal where the resource has key access turned off.
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ImageRequest, ModelPlatform } from "./models";
import { openModelCompat, rubricJudge } from "./vertex";

/** How the Worker proves itself to the resource: its key, or an Entra access token. */
export type AzureAuth = { apiKey: string } | { token: () => Promise<string> };

export type AzureOptions = {
  /** The resource's endpoint, such as https://northstar.openai.azure.com. */
  endpoint: string;
  auth: AzureAuth;
  /** Catalog id → deployment name, overriding the defaults below. */
  deployments?: Record<string, string>;
  /** The GPT Image deployment; gpt-image-1 by default. */
  imageDeployment?: string;
  /** Tests pass a fake fetch. */
  fetch?: typeof fetch;
};

/** The deployments a Foundry resource is expected to hold, by catalog id. */
export const AZURE_DEFAULT_DEPLOYMENTS: Record<string, string> = {
  "@cf/openai/gpt-oss-120b": "gpt-oss-120b",
};

/** The catalog id that serves `modelId`: a deployed model, else gpt-oss-120b. */
export function azureServedCatalogId(modelId: string, deployments: Record<string, string> = {}) {
  if (deployments[modelId] || AZURE_DEFAULT_DEPLOYMENTS[modelId]) return modelId;
  return "@cf/openai/gpt-oss-120b";
}

export function azureDeployment(modelId: string, deployments: Record<string, string> = {}) {
  const catalog = azureServedCatalogId(modelId, deployments);
  return deployments[catalog] ?? AZURE_DEFAULT_DEPLOYMENTS[catalog] ?? catalog;
}

/** The endpoint without a trailing slash or API path, so either form of it can be configured. */
export function azureBase(endpoint: string) {
  return endpoint.replace(/\/+$/, "").replace(/\/openai(\/v1)?$/, "");
}

/**
 * An Entra access token for Azure AI services from a service principal's client secret, reused
 * until five minutes before it expires.
 */
export function entraToken(
  credential: { tenantId: string; clientId: string; clientSecret: string },
  options: { fetch?: typeof fetch; now?: () => number } = {},
): () => Promise<string> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  const mint = async () => {
    const response = await fetcher(
      `https://login.microsoftonline.com/${encodeURIComponent(credential.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credential.clientId,
          client_secret: credential.clientSecret,
          scope: "https://cognitiveservices.azure.com/.default",
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Microsoft Entra's token endpoint answered ${response.status}.`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Microsoft Entra returned no access token.");
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  };
  return async () => {
    if (cached && cached.expiresAt - now() > 5 * 60_000) return cached.token;
    pending ??= mint().finally(() => {
      pending = null;
    });
    return pending;
  };
}

/** Adds the resource's credential and logs one line per model call, as Vertex's calls do. */
function azureFetch(base: typeof fetch, auth: AzureAuth): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    if ("apiKey" in auth) headers.set("api-key", auth.apiKey);
    else headers.set("authorization", `Bearer ${await auth.token()}`);
    const response = await base(input, { ...init, headers });
    console.info(
      JSON.stringify({
        event: "model_call",
        service: "azure-ai-foundry",
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

export function azureModels(options: AzureOptions): ModelPlatform {
  const base = `${azureBase(options.endpoint)}/openai/v1`;
  const deployments = options.deployments ?? {};
  const authed = azureFetch(options.fetch ?? fetch, options.auth);
  const openai = createOpenAI({ apiKey: "azure-ai-foundry", baseURL: base, fetch: authed });
  const chat = (modelId: string) =>
    openModelCompat(openai.chat(azureDeployment(modelId, deployments))) as Exclude<
      LanguageModel,
      string
    >;
  const imageModel = options.imageDeployment ?? "gpt-image-1";
  return {
    kind: "azure",
    label: "Azure AI Foundry",
    imageModel,
    chat,
    served: (modelId) => azureServedCatalogId(modelId, deployments),
    async image(_model: string, request: ImageRequest) {
      const response = await authed(`${base}/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: imageModel,
          prompt: request.prompt,
          n: 1,
          size: request.width === request.height ? "1024x1024" : "1536x1024",
        }),
      });
      if (!response.ok) throw new Error(`The image model returned ${response.status}.`);
      const result = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const image = result.data?.[0]?.b64_json;
      return image ? decodeBase64(image) : null;
    },
    // Clef is Workers AI-only; here gpt-oss answers the same rubric.
    judge: rubricJudge(chat),
  };
}
