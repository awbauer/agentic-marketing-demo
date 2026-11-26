// The AI platform choice (ADR-021): which platforms a server can run, which one a request gets,
// and the service-account token that lets a Cloudflare Worker call Vertex AI.
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../../../edge/src/architecture/context";
import { aiPlatformOptions, aiPlatforms, modelPlatform } from "../../../edge/src/platform/models";
import { providerStatus, runAiPlatformFor } from "../../../edge/src/team/run";
import {
  parseServiceAccountKey,
  parseWorkloadIdentity,
  serviceAccountToken,
  workloadIdentityToken,
} from "../../../edge/src/platform/google-token";

const fakeAi = { run: async () => ({}) } as unknown as Ai;

describe("AI platforms", () => {
  it("offers Workers AI alone on a Worker with no Google credentials", () => {
    const env = { AI: fakeAi };
    expect(Object.keys(aiPlatforms(env).available)).toEqual(["workers-ai"]);
    expect(aiPlatformOptions(env)).toMatchObject({
      default: "workers-ai",
      platforms: [
        { id: "workers-ai", available: true },
        { id: "vertex", available: false, reason: expect.stringContaining("VERTEX_PROJECT") },
      ],
    });
  });

  it("offers both on a Worker with a project and a key, and honours each request's choice", () => {
    const env = {
      AI: fakeAi,
      VERTEX_PROJECT: "p",
      GOOGLE_ACCESS_TOKEN: async () => "t",
    };
    expect(modelPlatform(env)?.kind).toBe("workers-ai");
    expect(modelPlatform(env, "vertex")?.kind).toBe("vertex");
    expect(modelPlatform(env, "workers-ai")?.kind).toBe("workers-ai");
    // An unknown choice gets the default rather than an error.
    expect(modelPlatform(env, "openrouter")?.kind).toBe("workers-ai");
    expect(aiPlatforms(env).registry.languageModel("vertex:@cf/openai/gpt-oss-120b")).toBeTruthy();
  });

  it("lets AI_PLATFORM pick the default", () => {
    const env = {
      AI: fakeAi,
      AI_PLATFORM: "vertex",
      VERTEX_PROJECT: "p",
      GOOGLE_ACCESS_TOKEN: async () => "t",
    };
    expect(modelPlatform(env)?.kind).toBe("vertex");
    expect(aiPlatformOptions(env).default).toBe("vertex");
  });

  it("offers Vertex AI alone on Google Cloud, and falls back to it when Workers AI is asked for", () => {
    const env = { HOST: "google-cloud", VERTEX_PROJECT: "p", GOOGLE_ACCESS_TOKEN: async () => "t" };
    expect(modelPlatform(env, "workers-ai")?.kind).toBe("vertex");
    expect(aiPlatformOptions(env).platforms.map((platform) => platform.id)).toEqual(["vertex"]);
  });

  it("lists and runs only what AI_PLATFORMS_ENABLED allows", () => {
    const both = { AI: fakeAi, VERTEX_PROJECT: "p", GOOGLE_ACCESS_TOKEN: async () => "t" };
    const vertexOnly = { ...both, AI_PLATFORMS_ENABLED: "vertex" };
    expect(aiPlatformOptions(vertexOnly)).toMatchObject({
      default: "vertex",
      platforms: [{ id: "vertex", available: true }],
    });
    // A request can't choose a platform the setting leaves out.
    expect(modelPlatform(vertexOnly, "workers-ai")?.kind).toBe("vertex");
    const workersOnly = { ...both, AI_PLATFORMS_ENABLED: " workers-ai " };
    expect(aiPlatformOptions(workersOnly).platforms.map((platform) => platform.id)).toEqual([
      "workers-ai",
    ]);
    expect(modelPlatform(workersOnly, "vertex")?.kind).toBe("workers-ai");
    // Blank means every platform; unknown ids are ignored.
    expect(aiPlatformOptions({ ...both, AI_PLATFORMS_ENABLED: "" }).platforms).toHaveLength(2);
    expect(
      aiPlatformOptions({ ...both, AI_PLATFORMS_ENABLED: "vertex,openrouter" }).platforms,
    ).toHaveLength(1);
  });

  it("records and labels the squad's open-model tier on the chosen platform", () => {
    const env = { AI: fakeAi, VERTEX_PROJECT: "p", GOOGLE_ACCESS_TOKEN: async () => "t" };
    const ctx = (aiPlatform?: "vertex" | "workers-ai") => ({ env, aiPlatform }) as unknown as Ctx;
    expect(runAiPlatformFor(ctx("vertex"), "cloudflare")).toEqual({ aiPlatform: "vertex" });
    expect(runAiPlatformFor(ctx(), "cloudflare")).toEqual({ aiPlatform: "workers-ai" });
    expect(runAiPlatformFor(ctx("vertex"), "anthropic")).toEqual({});
    const open = providerStatus(ctx("vertex")).find((item) => item.id === "cloudflare");
    expect(open).toMatchObject({ label: "Vertex AI (open models)", gateway: null });
  });

  it("has no platform when nothing is configured", () => {
    expect(modelPlatform({})).toBeNull();
    expect(aiPlatformOptions({}).default).toBeNull();
  });

  it("explains a key that is not a service-account key", () => {
    const env = { AI: fakeAi, VERTEX_PROJECT: "p", GOOGLE_SERVICE_ACCOUNT_KEY: "{}" };
    expect(aiPlatformOptions(env).platforms[1]).toMatchObject({
      available: false,
      reason: expect.stringContaining("client_email"),
    });
  });
});

describe("service-account tokens", () => {
  it("signs a JWT assertion, exchanges it, and reuses the token until near expiry", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const key = parseServiceAccountKey(
      JSON.stringify({
        client_email: "vertex@p.iam.gserviceaccount.com",
        private_key: await exportPKCS8(privateKey),
      }),
    );
    let now = 1_000_000;
    const assertions: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
      assertions.push(assertion);
      return Response.json({ access_token: `token-${assertions.length}`, expires_in: 3600 });
    };
    const token = serviceAccountToken(key, { fetch: fetcher, now: () => now });
    expect(await token()).toBe("token-1");
    expect(await token()).toBe("token-1");
    const { payload } = await jwtVerify(assertions[0] ?? "", publicKey, {
      issuer: "vertex@p.iam.gserviceaccount.com",
      audience: "https://oauth2.googleapis.com/token",
      currentDate: new Date(now),
    });
    expect(payload.scope).toBe("https://www.googleapis.com/auth/cloud-platform");
    now += 56 * 60_000;
    expect(await token()).toBe("token-2");
  });
});

describe("workload-identity tokens", () => {
  it("signs its own JWT, exchanges it at STS, then acts as the service account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const audience =
      "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/pool/providers/worker";
    const credential = parseWorkloadIdentity(
      JSON.stringify({
        type: "northstar-workload-identity",
        issuer: "https://worker.example",
        subject: "northstar-worker",
        audience,
        serviceAccount: "vertex@p.iam.gserviceaccount.com",
        keyId: "k1",
        privateKey: await exportPKCS8(privateKey),
      }),
    );
    const now = 1_000_000;
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: new Headers(init?.headers).get("authorization"),
      });
      return url.startsWith("https://sts.")
        ? Response.json({ access_token: "federated" })
        : Response.json({
            accessToken: "vertex-token",
            expireTime: new Date(now + 3600_000).toISOString(),
          });
    };
    const token = workloadIdentityToken(credential, { fetch: fetcher, now: () => now });
    expect(await token()).toBe("vertex-token");
    expect(await token()).toBe("vertex-token");
    expect(calls).toHaveLength(2);
    const { payload, protectedHeader } = await jwtVerify(
      String(calls[0]?.body.subjectToken),
      publicKey,
      {
        issuer: "https://worker.example",
        subject: "northstar-worker",
        audience: `https:${audience}`,
        currentDate: new Date(now),
      },
    );
    expect(protectedHeader.kid).toBe("k1");
    expect(payload.sub).toBe("northstar-worker");
    expect(calls[0]?.body).toMatchObject({ audience });
    expect(calls[1]?.url).toContain(
      "serviceAccounts/vertex%40p.iam.gserviceaccount.com:generateAccessToken",
    );
    expect(calls[1]?.auth).toBe("Bearer federated");
  });

  it("explains a credential of the wrong shape", () => {
    const env = {
      AI: fakeAi,
      VERTEX_PROJECT: "p",
      GOOGLE_WORKLOAD_IDENTITY: JSON.stringify({ type: "something-else" }),
    };
    expect(aiPlatformOptions(env).platforms[1]).toMatchObject({
      available: false,
      reason: expect.stringContaining("workload-identity"),
    });
  });
});
