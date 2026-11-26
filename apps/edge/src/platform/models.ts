// The AI platforms: where a turn's models run, chosen apart from the host (ADR-021). Each one is
// an AI SDK provider in one registry, so the feature code asks for `vertex:@cf/openai/gpt-oss-120b`
// or `workers-ai:@cf/openai/gpt-oss-120b` through the same interface, and the browser picks which
// with each message.
//
// - Workers AI runs through the Worker's AI binding (and its AI Gateway); only Cloudflare has it.
// - Vertex AI runs with Google credentials: Cloud Run's own service account on Google Cloud, or a
//   service-account key (GOOGLE_SERVICE_ACCOUNT_KEY) from a Cloudflare Worker.
// - Azure AI Foundry and Amazon Bedrock run from either host with their own credentials (ADR-023):
//   the resource's key or an Entra service principal, and a Bedrock API key.
//
// Feature code asks for a model by its catalog id (`@cf/openai/gpt-oss-120b`) either way; a
// platform that doesn't host an id maps it to the nearest model it does.
import type { LanguageModelV4, ProviderV4 } from "@ai-sdk/provider";
import {
  AI_PLATFORM_TERMS,
  AI_PLATFORMS,
  type AiPlatformId,
  type AiPlatformOptions,
  type HostId,
  isAiPlatformId,
  isHostId,
} from "@northstar/contracts";
import { createProviderRegistry, type LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { azureModels, entraToken } from "./azure";
import { bedrockModels } from "./bedrock";
import {
  parseServiceAccountKey,
  parseWorkloadIdentity,
  serviceAccountToken,
  workloadIdentityToken,
} from "./google-token";
import { vertexModels } from "./vertex";

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

export type ModelProvider = AiPlatformId;

export type ModelPlatform = {
  kind: AiPlatformId;
  /** Shown on the route map: the service every model call goes through. */
  label: string;
  /** An AI SDK model for a catalog id. */
  chat(modelId: string): Exclude<LanguageModel, string>;
  /** The catalog id actually served for `modelId` (Vertex maps ids it does not host). */
  served(modelId: string): string;
  /** A PNG for the prompt, or null when the model returned none. */
  image(model: string, request: ImageRequest): Promise<Uint8Array | null>;
  /** The image model that serves image(), as recorded with each draft. */
  imageModel: string;
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

/**
 * What configures the AI platforms. Every field is optional; what's set decides which platforms
 * exist. MODELS injects one outright (tests). AI_PLATFORM names the default when more than one
 * exists; otherwise Workers AI is the default where it's bound.
 */
export type ModelBindings = {
  MODELS?: ModelPlatform;
  AI_PLATFORM?: string;
  /**
   * Which platforms the AI platform menu may offer, comma-separated (`workers-ai,vertex`). A
   * platform left out is neither listed nor run, even when it is configured. Unset: all of them.
   */
  AI_PLATFORMS_ENABLED?: string;
  /** Workers AI: the Worker's binding, and the AI Gateway its calls go through. */
  AI?: Ai;
  AI_GATEWAY_ID?: string;
  /** Vertex AI: the project and locations. */
  VERTEX_PROJECT?: string;
  GCP_PROJECT?: string;
  VERTEX_LOCATION?: string;
  GCP_REGION?: string;
  VERTEX_IMAGE_LOCATION?: string;
  VERTEX_ANTHROPIC_LOCATION?: string;
  VERTEX_IMAGE_MODEL?: string;
  VERTEX_MODEL_MAP?: string;
  /** Vertex AI credentials: the host's own token source, or a service-account key (JSON). */
  GOOGLE_ACCESS_TOKEN?: () => Promise<string>;
  GOOGLE_SERVICE_ACCOUNT_KEY?: string;
  /** Or a workload-identity credential (JSON), for where service-account keys are banned. */
  GOOGLE_WORKLOAD_IDENTITY?: string;
  /** Azure AI Foundry: the resource's endpoint, and its key or an Entra service principal. */
  AZURE_AI_ENDPOINT?: string;
  AZURE_AI_API_KEY?: string;
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  /** JSON object of catalog id → deployment name; and the GPT Image deployment. */
  AZURE_AI_DEPLOYMENTS?: string;
  AZURE_AI_IMAGE_DEPLOYMENT?: string;
  /** Amazon Bedrock: the regions, the API key, and optional model overrides. */
  BEDROCK_REGION?: string;
  BEDROCK_IMAGE_REGION?: string;
  BEDROCK_API_KEY?: string;
  BEDROCK_MODEL_MAP?: string;
  BEDROCK_IMAGE_MODEL?: string;
};

/** Which host this server is: the GCP host sets HOST; the Worker leaves it unset. */
export function serverHost(env: { HOST?: string }): HostId {
  return isHostId(env.HOST) ? env.HOST : "cloudflare";
}

export type AiPlatforms = {
  /** The platforms this server can run, by id. */
  available: Partial<Record<AiPlatformId, ModelPlatform>>;
  /** The platform a request gets when it names none, or names one that isn't here. */
  default: AiPlatformId | null;
  /** Why each missing platform is missing, for the top bar. */
  missing: Partial<Record<AiPlatformId, string>>;
  /** Every available platform's chat models, as AI SDK `platform:catalog-id` ids. */
  registry: ReturnType<typeof createProviderRegistry>;
};

const configured = new WeakMap<object, AiPlatforms>();

/** The AI platforms this environment can run; built once per environment object. */
export function aiPlatforms(env: ModelBindings): AiPlatforms {
  let platforms = configured.get(env);
  if (!platforms) {
    platforms = buildPlatforms(env);
    configured.set(env, platforms);
  }
  return platforms;
}

/**
 * The models for a request: the platform it chose when this server has it, else the default.
 * Null when none is configured (tests, offline local).
 */
export function modelPlatform(env: ModelBindings, choice?: unknown): ModelPlatform | null {
  const platforms = aiPlatforms(env);
  if (isAiPlatformId(choice) && platforms.available[choice]) return platforms.available[choice];
  return platforms.default ? (platforms.available[platforms.default] ?? null) : null;
}

/** What the top bar's AI platform menu lists. */
export function aiPlatformOptions(env: ModelBindings): AiPlatformOptions {
  const platforms = aiPlatforms(env);
  return {
    default: platforms.default,
    platforms: AI_PLATFORMS.filter(
      // A host lists only what it could ever run (Google Cloud has no Workers AI binding), and
      // only what AI_PLATFORMS_ENABLED allows. Azure and Bedrock are listed once some of their
      // settings are present, so a server that never meant to use them doesn't offer them.
      (id) =>
        platforms.available[id] ||
        (enabledAiPlatforms(env).has(id) &&
          (id === "vertex"
            ? true
            : id === "workers-ai"
              ? Boolean(env.AI)
              : Boolean(platforms.missing[id]))),
    ).map((id) => ({
      id,
      label: AI_PLATFORM_TERMS[id].label,
      available: Boolean(platforms.available[id]),
      ...(platforms.missing[id] ? { reason: platforms.missing[id] } : {}),
    })),
  };
}

/** An AI SDK provider over a platform's chat models, for the registry. */
function asProvider(platform: ModelPlatform): ProviderV4 {
  const none = (kind: string) => () => {
    throw new Error(`${platform.label} serves no ${kind} models through the registry.`);
  };
  return {
    specificationVersion: "v4",
    languageModel: (modelId) => platform.chat(modelId) as LanguageModelV4,
    embeddingModel: none("embedding"),
    imageModel: none("image"),
  };
}

/** The platforms AI_PLATFORMS_ENABLED allows: every one when it is unset or blank. */
export function enabledAiPlatforms(env: Pick<ModelBindings, "AI_PLATFORMS_ENABLED">) {
  const listed = (env.AI_PLATFORMS_ENABLED ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (listed.length === 0) return new Set<AiPlatformId>(AI_PLATFORMS);
  const unknown = listed.filter((id) => !isAiPlatformId(id));
  if (unknown.length > 0)
    console.warn(
      `[models] AI_PLATFORMS_ENABLED lists ${unknown.join(", ")}; use ${AI_PLATFORMS.join(", ")}.`,
    );
  return new Set(listed.filter(isAiPlatformId));
}

function buildPlatforms(env: ModelBindings): AiPlatforms {
  const available: Partial<Record<AiPlatformId, ModelPlatform>> = {};
  const missing: Partial<Record<AiPlatformId, string>> = {};
  const enabled = enabledAiPlatforms(env);
  if (env.MODELS) {
    available[env.MODELS.kind] = env.MODELS;
  } else {
    if (env.AI && enabled.has("workers-ai"))
      available["workers-ai"] = workersAiModels(env.AI, env.AI_GATEWAY_ID);
    if (enabled.has("vertex")) {
      const vertex = vertexFromEnv(env);
      if ("platform" in vertex) available.vertex = vertex.platform;
      else missing.vertex = vertex.reason;
    }
    if (enabled.has("azure")) {
      const azure = azureFromEnv(env);
      if (azure && "platform" in azure) available.azure = azure.platform;
      else if (azure) missing.azure = azure.reason;
    }
    if (enabled.has("bedrock")) {
      const bedrock = bedrockFromEnv(env);
      if (bedrock && "platform" in bedrock) available.bedrock = bedrock.platform;
      else if (bedrock) missing.bedrock = bedrock.reason;
    }
  }
  if (enabled.size === 0)
    console.warn("[models] AI_PLATFORMS_ENABLED allows no platform; no models will run.");
  const requested = isAiPlatformId(env.AI_PLATFORM) ? env.AI_PLATFORM : null;
  if (env.AI_PLATFORM && !requested)
    console.warn(
      `[models] AI_PLATFORM must be one of ${AI_PLATFORMS.join(", ")}, not ${env.AI_PLATFORM}.`,
    );
  const ids = AI_PLATFORMS.filter((id) => available[id]);
  const fallback = ids[0] ?? null;
  const preferred = requested && available[requested] ? requested : fallback;
  return {
    available,
    missing,
    default: preferred,
    registry: createProviderRegistry(
      Object.fromEntries(ids.map((id) => [id, asProvider(available[id] as ModelPlatform)])),
    ),
  };
}

function vertexFromEnv(env: ModelBindings): { platform: ModelPlatform } | { reason: string } {
  const project = env.VERTEX_PROJECT ?? env.GCP_PROJECT;
  if (!project) return { reason: "Set VERTEX_PROJECT to the Google Cloud project to use." };
  let token = env.GOOGLE_ACCESS_TOKEN;
  if (!token && env.GOOGLE_WORKLOAD_IDENTITY) {
    try {
      token = workloadIdentityToken(parseWorkloadIdentity(env.GOOGLE_WORKLOAD_IDENTITY));
    } catch (error) {
      return {
        reason: error instanceof Error ? error.message : "The credential could not be read.",
      };
    }
  }
  if (!token && env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      token = serviceAccountToken(parseServiceAccountKey(env.GOOGLE_SERVICE_ACCOUNT_KEY));
    } catch (error) {
      return { reason: error instanceof Error ? error.message : "The key could not be read." };
    }
  }
  if (!token)
    return {
      reason:
        "Set GOOGLE_WORKLOAD_IDENTITY (or GOOGLE_SERVICE_ACCOUNT_KEY) to a credential for a service account with Vertex AI access.",
    };
  let modelMap: Record<string, string> = {};
  try {
    modelMap = JSON.parse(env.VERTEX_MODEL_MAP ?? "{}") as Record<string, string>;
  } catch {
    console.warn("[models] VERTEX_MODEL_MAP is not valid JSON; using the default models.");
  }
  return {
    platform: vertexModels({
      project,
      location: env.VERTEX_LOCATION ?? env.GCP_REGION ?? "us-central1",
      accessToken: token,
      modelMap,
      ...(env.VERTEX_IMAGE_LOCATION ? { imageLocation: env.VERTEX_IMAGE_LOCATION } : {}),
      ...(env.VERTEX_ANTHROPIC_LOCATION
        ? { anthropicLocation: env.VERTEX_ANTHROPIC_LOCATION }
        : {}),
      ...(env.VERTEX_IMAGE_MODEL ? { imageModel: env.VERTEX_IMAGE_MODEL } : {}),
    }),
  };
}

/** A JSON object of strings from a setting, or {} (with a warning) when it isn't one. */
function jsonMap(value: string | undefined, name: string): Record<string, string> {
  try {
    return JSON.parse(value ?? "{}") as Record<string, string>;
  } catch {
    console.warn(`[models] ${name} is not valid JSON; using the default models.`);
    return {};
  }
}

/**
 * Azure AI Foundry from the environment: null when nothing for it is set, a reason when it is
 * half set up.
 */
function azureFromEnv(env: ModelBindings): { platform: ModelPlatform } | { reason: string } | null {
  const principal = env.AZURE_TENANT_ID || env.AZURE_CLIENT_ID || env.AZURE_CLIENT_SECRET;
  if (!env.AZURE_AI_ENDPOINT && !env.AZURE_AI_API_KEY && !principal) return null;
  if (!env.AZURE_AI_ENDPOINT)
    return { reason: "Set AZURE_AI_ENDPOINT to the Azure AI Foundry resource's endpoint." };
  let auth: Parameters<typeof azureModels>[0]["auth"] | null = null;
  if (env.AZURE_AI_API_KEY) auth = { apiKey: env.AZURE_AI_API_KEY };
  else if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET)
    auth = {
      token: entraToken({
        tenantId: env.AZURE_TENANT_ID,
        clientId: env.AZURE_CLIENT_ID,
        clientSecret: env.AZURE_CLIENT_SECRET,
      }),
    };
  if (!auth)
    return {
      reason:
        "Set AZURE_AI_API_KEY, or AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET for a service principal with the Cognitive Services OpenAI User role.",
    };
  return {
    platform: azureModels({
      endpoint: env.AZURE_AI_ENDPOINT,
      auth,
      deployments: jsonMap(env.AZURE_AI_DEPLOYMENTS, "AZURE_AI_DEPLOYMENTS"),
      ...(env.AZURE_AI_IMAGE_DEPLOYMENT ? { imageDeployment: env.AZURE_AI_IMAGE_DEPLOYMENT } : {}),
    }),
  };
}

/** Amazon Bedrock from the environment: null when nothing for it is set. */
function bedrockFromEnv(
  env: ModelBindings,
): { platform: ModelPlatform } | { reason: string } | null {
  if (!env.BEDROCK_REGION && !env.BEDROCK_API_KEY) return null;
  if (!env.BEDROCK_API_KEY)
    return {
      reason:
        "Set BEDROCK_API_KEY to a Bedrock API key for an IAM identity that may invoke the models.",
    };
  return {
    platform: bedrockModels({
      region: env.BEDROCK_REGION ?? "us-west-2",
      apiKey: env.BEDROCK_API_KEY,
      modelMap: jsonMap(env.BEDROCK_MODEL_MAP, "BEDROCK_MODEL_MAP"),
      ...(env.BEDROCK_IMAGE_REGION ? { imageRegion: env.BEDROCK_IMAGE_REGION } : {}),
      ...(env.BEDROCK_IMAGE_MODEL ? { imageModel: env.BEDROCK_IMAGE_MODEL } : {}),
    }),
  };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export const WORKERS_AI_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export function workersAiModels(ai: Ai, gatewayId?: string): ModelPlatform {
  const gateway = gatewayId ? { gateway: { id: gatewayId } } : {};
  const workersAI = createWorkersAI({ binding: ai, ...gateway });
  return {
    kind: "workers-ai",
    label: "Workers AI",
    imageModel: WORKERS_AI_IMAGE_MODEL,
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
