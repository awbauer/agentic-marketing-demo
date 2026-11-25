// The Google Cloud adapters that need no cloud: Vertex request shapes against a fake fetch, IAP
// assertions signed by a local key, static files, and the scheduler's token check.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { resolvePrincipal } from "../../../edge/src/auth";
import { schedulerVerifier } from "../../src/platform/scheduler";
import { staticAssets } from "../../src/platform/static";
import {
  anthropicOnVertexFetch,
  servedCatalogId,
  vertexModelId,
  vertexModels,
} from "../../src/platform/vertex";

type Call = { url: string; init: RequestInit | undefined; body: Record<string, unknown> };

function recorder(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const call = {
      url: String(input instanceof Request ? input.url : input),
      init,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
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
    model: "openai/gpt-oss-120b-maas",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });

describe("Vertex AI models", () => {
  it("serves every chat model on gpt-oss-120b unless the map names another", () => {
    expect(servedCatalogId("@cf/openai/gpt-oss-120b")).toBe("@cf/openai/gpt-oss-120b");
    expect(servedCatalogId("@cf/openai/gpt-oss-20b")).toBe("@cf/openai/gpt-oss-120b");
    expect(servedCatalogId("@cf/zai-org/glm-5.3")).toBe("@cf/openai/gpt-oss-120b");
    expect(vertexModelId("@cf/deepseek-ai/deepseek-v4.1-flash-1017")).toBe(
      "openai/gpt-oss-120b-maas",
    );
    const map = { "@cf/zai-org/glm-5.3": "zai-org/glm-5-maas" };
    expect(servedCatalogId("@cf/zai-org/glm-5.3", map)).toBe("@cf/zai-org/glm-5.3");
    expect(vertexModelId("@cf/zai-org/glm-5.3", map)).toBe("zai-org/glm-5-maas");
  });

  it("calls the OpenAI-compatible endpoint with an ADC token and the Workers AI reasoning effort", async () => {
    const { calls, fetcher } = recorder(() => chatReply("hello"));
    const models = vertexModels({
      project: "p",
      location: "us-central1",
      fetch: fetcher,
      accessToken: async () => "token-1",
    });
    const result = await generateText({
      model: models.chat("@cf/openai/gpt-oss-120b"),
      prompt: "hi",
      providerOptions: { "workers-ai": { reasoning_effort: "low" } },
    });
    expect(result.text).toBe("hello");
    expect(calls[0]?.url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi/chat/completions",
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer token-1");
    expect(calls[0]?.body).toMatchObject({
      model: "openai/gpt-oss-120b-maas",
      reasoning_effort: "low",
    });
  });

  it("generates a PNG with Gemini's image model", async () => {
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    const { calls, fetcher } = recorder(() =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "here" },
                { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
              ],
            },
          },
        ],
      }),
    );
    const models = vertexModels({
      project: "p",
      location: "us-central1",
      imageModel: "image-test",
      fetch: fetcher,
      accessToken: async () => "t",
    });
    const bytes = await models.image("@cf/black-forest-labs/flux-2-klein-4b", {
      prompt: "a lake",
      width: 1024,
      height: 1024,
      seed: 7,
    });
    expect(Buffer.from(bytes ?? []).equals(png)).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/image-test:generateContent",
    );
    expect(calls[0]?.body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "a lake" }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
        seed: 7,
      },
    });
  });

  it("answers the judge's rubric in Clef's shape", async () => {
    const { fetcher } = recorder(() => chatReply('Sure: {"task": 3, "grounded": 2}'));
    const models = vertexModels({
      project: "p",
      location: "us-central1",
      fetch: fetcher,
      accessToken: async () => "t",
    });
    const verdict = await models.judge?.("@cf/cloudflare/clef", {
      state: { summary: "done" },
      questions: {
        task: { instructions: "Did it?", criteria: ["no", "partly", "mostly", "fully"] },
        grounded: { instructions: "Grounded?", criteria: ["no", "partly", "mostly", "fully"] },
      },
    });
    expect(verdict).toEqual({
      answers: { task: { type: "score", score: 3 }, grounded: { type: "score", score: 2 } },
    });
  });

  it("keeps OpenAI off and routes Anthropic requests to Claude on Vertex", async () => {
    const models = vertexModels({
      project: "p",
      location: "us-central1",
      accessToken: async () => "t",
    });
    expect(models.vendor?.("openai", {})).toHaveProperty("reason");
    const { calls, fetcher } = recorder(() => Response.json({ ok: true }));
    const routed = anthropicOnVertexFetch({ project: "p", location: "global", fetch: fetcher });
    await routed("https://api.anthropic.com/v1/messages?beta=true", {
      method: "POST",
      headers: { "x-api-key": "held", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-opus-5-5", stream: true, messages: [] }),
    });
    expect(calls[0]?.url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/anthropic/models/claude-opus-5-5:streamRawPredict",
    );
    expect(calls[0]?.body).toEqual({
      stream: true,
      messages: [],
      anthropic_version: "vertex-2023-10-16",
    });
    expect(new Headers(calls[0]?.init?.headers).has("x-api-key")).toBe(false);
  });
});

describe("IAP sign-in", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", kid: "k" }],
  });
  const audience = "/projects/1/locations/us-central1/services/northstar-workbench";
  const sign = (claims: Record<string, unknown>, aud = audience) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "k" })
      .setIssuer("https://cloud.google.com/iap")
      .setAudience(aud)
      .setSubject("accounts.google.com:123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  const env = {
    AUTH_MODE: "iap",
    ENVIRONMENT: "proof",
    IAP_AUDIENCE: audience,
    IAP_JWKS: jwks,
    MEMBERS: {
      lookup: async (email: string) => (email === "ada@example.com" ? { role: "evaluator" } : null),
    },
  };
  const request = (token?: string) =>
    new Request("https://x/api/session", {
      headers: token ? { "x-goog-iap-jwt-assertion": token } : {},
    });

  it("accepts a member's assertion and refuses everything else", async () => {
    await expect(
      resolvePrincipal(request(await sign({ email: "Ada@Example.com" })), env),
    ).resolves.toEqual({
      subject: "accounts.google.com:123",
      email: "ada@example.com",
      role: "evaluator",
      tenantId: "northstar-pot",
    });
    await expect(resolvePrincipal(request(), env)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      resolvePrincipal(request(await sign({ email: "eve@example.com" })), env),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      resolvePrincipal(request(await sign({ email: "ada@example.com" }, "/projects/1/other")), env),
    ).rejects.toThrow();
    await expect(
      resolvePrincipal(request(await sign({ email: "ada@example.com" })), {
        ...env,
        MEMBERS: undefined,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("static assets", () => {
  it("serves files, falls back to the app, and never leaves the build directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "northstar-static-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<html>app</html>");
    await writeFile(join(root, "assets", "app-1.js"), "console.log(1)");
    const serve = staticAssets(root);
    const get = (path: string) => serve(new Request(`https://x${path}`));
    const js = await get("/assets/app-1.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await (await get("/campaigns/42")).text()).toBe("<html>app</html>");
    expect(await (await get("/../../etc/passwd")).text()).toBe("<html>app</html>");
    expect(await (await get("/%2e%2e/%2e%2e/etc/passwd")).text()).toBe("<html>app</html>");
  });
});

describe("scheduler token", () => {
  const client = (email: string, ok = true) => ({
    verifyIdToken: async () => {
      if (!ok) throw new Error("bad token");
      return { getPayload: () => ({ email, email_verified: true }) } as never;
    },
  });
  it("accepts only the scheduler's service account", async () => {
    const options = { audience: "https://svc", serviceAccount: "sched@p.iam.gserviceaccount.com" };
    expect(
      await schedulerVerifier({ ...options, client: client("sched@p.iam.gserviceaccount.com") })(
        "Bearer t",
      ),
    ).toBe(true);
    expect(
      await schedulerVerifier({ ...options, client: client("other@p.iam.gserviceaccount.com") })(
        "Bearer t",
      ),
    ).toBe(false);
    expect(
      await schedulerVerifier({
        ...options,
        client: client("sched@p.iam.gserviceaccount.com", false),
      })("Bearer t"),
    ).toBe(false);
    expect(
      await schedulerVerifier({ ...options, client: client("sched@p.iam.gserviceaccount.com") })(
        null,
      ),
    ).toBe(false);
  });
});
