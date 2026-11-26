// Azure AI Foundry and Amazon Bedrock as AI platforms (ADR-023): which settings turn each on, and
// the requests each sends, against a fake fetch.
import {
  OPEN_MODEL_PLATFORMS,
  teamOpenModels,
  teamRunProviderLabel,
} from "@northstar/architecture";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../../../edge/src/architecture/context";
import {
  azureBase,
  azureDeployment,
  azureModels,
  azureServedCatalogId,
  entraToken,
} from "../../../edge/src/platform/azure";
import {
  bedrockModelId,
  bedrockModels,
  bedrockServedCatalogId,
} from "../../../edge/src/platform/bedrock";
import {
  aiPlatformOptions,
  aiPlatforms,
  modelPlatform,
  vendorPlatform,
} from "../../../edge/src/platform/models";
import { providerStatus } from "../../../edge/src/team/run";

type Call = { url: string; init: RequestInit | undefined; body: Record<string, unknown> };

function recorder(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const raw = init?.body ? String(init.body) : "";
    const call = {
      url: String(input instanceof Request ? input.url : input),
      init,
      body: raw.startsWith("{") ? (JSON.parse(raw) as Record<string, unknown>) : {},
    };
    calls.push(call);
    return reply(call);
  };
  return { calls, fetcher };
}

const chatReply = (content: string) =>
  Response.json({
    id: "1",
    object: "chat.completion",
    created: 0,
    model: "gpt-oss-120b",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });

const fakeAi = { run: async () => ({}) } as unknown as Ai;
const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

describe("Azure and Bedrock on the AI platform menu", () => {
  it("leaves both off the menu when nothing for them is set", () => {
    const ids = aiPlatformOptions({ AI: fakeAi }).platforms.map((platform) => platform.id);
    expect(ids).toEqual(["workers-ai", "vertex"]);
  });

  it("lists a half-configured platform as not set up, with what is missing", () => {
    const options = aiPlatformOptions({
      AI: fakeAi,
      AZURE_AI_ENDPOINT: "https://r.openai.azure.com",
      BEDROCK_REGION: "us-west-2",
    });
    expect(options.platforms.filter((platform) => !platform.available)).toEqual([
      expect.objectContaining({ id: "vertex" }),
      expect.objectContaining({
        id: "azure",
        label: "Azure AI Foundry",
        reason: expect.stringContaining("AZURE_AI_API_KEY"),
      }),
      expect.objectContaining({
        id: "bedrock",
        label: "Amazon Bedrock",
        reason: expect.stringContaining("BEDROCK_API_KEY"),
      }),
    ]);
  });

  it("runs each once its credentials are set, beside Workers AI, and honours each request's choice", () => {
    const env = {
      AI: fakeAi,
      AZURE_AI_ENDPOINT: "https://r.openai.azure.com",
      AZURE_AI_API_KEY: "k",
      BEDROCK_API_KEY: "b",
    };
    expect(Object.keys(aiPlatforms(env).available)).toEqual(["workers-ai", "azure", "bedrock"]);
    expect(modelPlatform(env)?.kind).toBe("workers-ai");
    expect(modelPlatform(env, "azure")?.kind).toBe("azure");
    expect(modelPlatform(env, "bedrock")?.kind).toBe("bedrock");
    expect(aiPlatforms(env).registry.languageModel("bedrock:@cf/openai/gpt-oss-20b")).toBeTruthy();
  });

  it("can be the default, run alone (as from Google Cloud), or be left out by AI_PLATFORMS_ENABLED", () => {
    const azure = { AZURE_AI_ENDPOINT: "https://r.openai.azure.com", AZURE_AI_API_KEY: "k" };
    expect(modelPlatform({ AI: fakeAi, AI_PLATFORM: "azure", ...azure })?.kind).toBe("azure");
    expect(modelPlatform({ HOST: "google-cloud", ...azure } as never, "workers-ai")?.kind).toBe(
      "azure",
    );
    const narrowed = { AI: fakeAi, AI_PLATFORMS_ENABLED: "workers-ai", ...azure };
    expect(aiPlatformOptions(narrowed).platforms.map((platform) => platform.id)).toEqual([
      "workers-ai",
    ]);
    expect(modelPlatform(narrowed, "azure")?.kind).toBe("workers-ai");
  });

  it("keeps the host's vendor route when Azure or Bedrock is the default", () => {
    const bedrock = { AI_PLATFORM: "bedrock", BEDROCK_API_KEY: "b" };
    // Google Cloud: Claude stays on Vertex AI.
    const google = {
      HOST: "google-cloud",
      VERTEX_PROJECT: "p",
      GOOGLE_ACCESS_TOKEN: async () => "t",
      ...bedrock,
    };
    expect(modelPlatform(google)?.kind).toBe("bedrock");
    expect(vendorPlatform(google)?.kind).toBe("vertex");
    const anthropic = providerStatus({ env: google } as unknown as Ctx).find(
      (item) => item.id === "anthropic",
    );
    expect(anthropic).toMatchObject({ available: true, label: "Claude on Vertex AI" });
    // Cloudflare: the vendors go through the AI Gateway, as with Workers AI as the default.
    expect(vendorPlatform({ AI: fakeAi, ...bedrock })).toBeNull();
    expect(vendorPlatform({ AI: fakeAi, BEDROCK_API_KEY: "b" })?.kind).toBe("workers-ai");
  });

  it("names the open-model tier for the platform a squad run used", () => {
    expect(teamOpenModels("bedrock")).toBe("bedrock");
    expect(teamOpenModels("unknown", "google-cloud")).toBe("vertex");
    expect(teamRunProviderLabel("cloudflare", "azure")).toBe(OPEN_MODEL_PLATFORMS.azure);
  });
});

describe("Azure AI Foundry models", () => {
  it("runs deployed models and maps the rest to gpt-oss-120b", () => {
    expect(azureServedCatalogId("@cf/openai/gpt-oss-20b")).toBe("@cf/openai/gpt-oss-120b");
    expect(azureDeployment("@cf/zai-org/glm-5.3")).toBe("gpt-oss-120b");
    const deployments = { "@cf/openai/gpt-oss-20b": "oss-small" };
    expect(azureServedCatalogId("@cf/openai/gpt-oss-20b", deployments)).toBe(
      "@cf/openai/gpt-oss-20b",
    );
    expect(azureDeployment("@cf/openai/gpt-oss-20b", deployments)).toBe("oss-small");
    expect(azureBase("https://r.services.ai.azure.com/openai/v1/")).toBe(
      "https://r.services.ai.azure.com",
    );
  });

  it("calls the resource's v1 API with its key, the deployment and the reasoning effort", async () => {
    const { calls, fetcher } = recorder(() => chatReply("hello"));
    const models = azureModels({
      endpoint: "https://r.openai.azure.com/",
      auth: { apiKey: "key-1" },
      fetch: fetcher,
    });
    const result = await generateText({
      model: models.chat("@cf/openai/gpt-oss-120b"),
      prompt: "hi",
      providerOptions: { "workers-ai": { reasoning_effort: "low" } },
    });
    expect(result.text).toBe("hello");
    expect(calls[0]?.url).toBe("https://r.openai.azure.com/openai/v1/chat/completions");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("api-key")).toBe("key-1");
    expect(headers.get("authorization")).toBeNull();
    expect(calls[0]?.body).toMatchObject({ model: "gpt-oss-120b", reasoning_effort: "low" });
  });

  it("uses an Entra token where keys are off, minting it once", async () => {
    const { calls, fetcher } = recorder((call) =>
      call.url.startsWith("https://login.microsoftonline.com/")
        ? Response.json({ access_token: "entra-1", expires_in: 3600 })
        : chatReply("ok"),
    );
    const token = entraToken(
      { tenantId: "tenant", clientId: "client", clientSecret: "secret" },
      { fetch: fetcher },
    );
    const models = azureModels({
      endpoint: "https://r.openai.azure.com",
      auth: { token },
      fetch: fetcher,
    });
    await generateText({ model: models.chat("@cf/openai/gpt-oss-120b"), prompt: "a" });
    await generateText({ model: models.chat("@cf/openai/gpt-oss-120b"), prompt: "b" });
    const minted = calls.filter((call) => call.url.includes("login.microsoftonline.com"));
    expect(minted).toHaveLength(1);
    expect(minted[0]?.url).toBe("https://login.microsoftonline.com/tenant/oauth2/v2.0/token");
    expect(String(minted[0]?.init?.body)).toContain(
      "scope=https%3A%2F%2Fcognitiveservices.azure.com%2F.default",
    );
    const chats = calls.filter((call) => call.url.endsWith("/chat/completions"));
    expect(new Headers(chats[1]?.init?.headers).get("authorization")).toBe("Bearer entra-1");
  });

  it("generates an image with the GPT Image deployment", async () => {
    const { calls, fetcher } = recorder(() =>
      Response.json({ data: [{ b64_json: png.toString("base64") }] }),
    );
    const models = azureModels({
      endpoint: "https://r.openai.azure.com",
      auth: { apiKey: "k" },
      imageDeployment: "image-test",
      fetch: fetcher,
    });
    const bytes = await models.image("@cf/black-forest-labs/flux-2-klein-4b", {
      prompt: "a lake",
      width: 1024,
      height: 1024,
    });
    expect(Buffer.from(bytes ?? []).equals(png)).toBe(true);
    expect(calls[0]?.url).toBe("https://r.openai.azure.com/openai/v1/images/generations");
    expect(calls[0]?.body).toEqual({
      model: "image-test",
      prompt: "a lake",
      n: 1,
      size: "1024x1024",
    });
  });

  it("answers the judge's rubric in Clef's shape", async () => {
    const { fetcher } = recorder(() => chatReply('{"task": 2}'));
    const models = azureModels({
      endpoint: "https://r.openai.azure.com",
      auth: { apiKey: "k" },
      fetch: fetcher,
    });
    const verdict = await models.judge?.("@cf/cloudflare/clef", {
      state: {},
      questions: { task: { instructions: "Did it?", criteria: ["no", "partly", "fully"] } },
    });
    expect(verdict).toEqual({ answers: { task: { type: "score", score: 2 } } });
  });
});

describe("Amazon Bedrock models", () => {
  it("serves both gpt-oss sizes and maps the rest to 120b", () => {
    expect(bedrockModelId("@cf/openai/gpt-oss-20b")).toBe("openai.gpt-oss-20b-1:0");
    expect(bedrockModelId("@cf/openai/gpt-oss-120b")).toBe("openai.gpt-oss-120b-1:0");
    expect(bedrockServedCatalogId("@cf/zai-org/glm-5.3")).toBe("@cf/openai/gpt-oss-120b");
  });

  it("calls the OpenAI-compatible endpoint with the API key as a bearer token", async () => {
    const { calls, fetcher } = recorder(() => chatReply("hello"));
    const models = bedrockModels({ region: "us-west-2", apiKey: "bedrock-key", fetch: fetcher });
    const result = await generateText({
      model: models.chat("@cf/openai/gpt-oss-20b"),
      prompt: "hi",
    });
    expect(result.text).toBe("hello");
    expect(calls[0]?.url).toBe(
      "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions",
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer bedrock-key");
    expect(calls[0]?.body).toMatchObject({ model: "openai.gpt-oss-20b-1:0" });
    expect(models.served("@cf/openai/gpt-oss-20b")).toBe("@cf/openai/gpt-oss-20b");
  });

  it("generates an image with Nova Canvas in its own region", async () => {
    const { calls, fetcher } = recorder(() => Response.json({ images: [png.toString("base64")] }));
    const models = bedrockModels({ region: "us-west-2", apiKey: "k", fetch: fetcher });
    const bytes = await models.image("@cf/black-forest-labs/flux-2-klein-4b", {
      prompt: "a lake",
      width: 1024,
      height: 1024,
      seed: 7,
    });
    expect(Buffer.from(bytes ?? []).equals(png)).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-canvas-v1%3A0/invoke",
    );
    expect(calls[0]?.body).toEqual({
      taskType: "TEXT_IMAGE",
      textToImageParams: { text: "a lake" },
      imageGenerationConfig: { numberOfImages: 1, width: 1024, height: 1024, seed: 7 },
    });
  });
});
