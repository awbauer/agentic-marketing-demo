// A Google access token from a service-account key, for running Vertex AI models where Google's
// own credentials aren't available (a Cloudflare Worker; ADR-021). The key's private key signs a
// JWT assertion (RS256, WebCrypto via jose), which Google's token endpoint exchanges for an access
// token; tokens are reused until five minutes before they expire. On Cloud Run the GCP host
// supplies the service account's own token instead, and no key exists.
import { importPKCS8, SignJWT } from "jose";

export type ServiceAccountKey = { client_email: string; private_key: string; token_uri?: string };

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function parseServiceAccountKey(json: string): ServiceAccountKey {
  const key = JSON.parse(json) as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key)
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not a service-account key (client_email, private_key).",
    );
  return key as ServiceAccountKey;
}

export function serviceAccountToken(
  key: ServiceAccountKey,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): () => Promise<string> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  const mint = async () => {
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(key.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await importPKCS8(key.private_key, "RS256"));
    const response = await fetcher(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`Google's token endpoint answered ${response.status}.`);
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google's token endpoint returned no access token.");
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
