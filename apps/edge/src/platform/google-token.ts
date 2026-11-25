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

/**
 * A workload-identity credential (ADR-021): how a Worker, which can't hold a service-account key
 * where keys are banned, gets Google access tokens. The Worker is its own token issuer: it signs a
 * short-lived JWT with `privateKey`, Google's Security Token Service checks it against the public
 * key uploaded to a workload identity pool's provider, and the federated token it returns is
 * exchanged for an access token of `serviceAccount`, which the pool's subject may act as.
 */
export type WorkloadIdentityCredential = {
  type: "northstar-workload-identity";
  /** The provider's issuer URI; Google never fetches it, the provider holds the public key. */
  issuer: string;
  subject: string;
  /** //iam.googleapis.com/projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER */
  audience: string;
  serviceAccount: string;
  keyId: string;
  privateKey: string;
};

export function parseWorkloadIdentity(json: string): WorkloadIdentityCredential {
  const credential = JSON.parse(json) as Partial<WorkloadIdentityCredential>;
  const missing = (
    ["issuer", "subject", "audience", "serviceAccount", "keyId", "privateKey"] as const
  ).filter((field) => !credential[field]);
  if (credential.type !== "northstar-workload-identity" || missing.length > 0)
    throw new Error(
      `GOOGLE_WORKLOAD_IDENTITY is not a workload-identity credential${missing.length ? ` (missing ${missing.join(", ")})` : ""}.`,
    );
  return credential as WorkloadIdentityCredential;
}

export function workloadIdentityToken(
  credential: WorkloadIdentityCredential,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): () => Promise<string> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  const mint = async () => {
    const issuedAt = Math.floor(now() / 1000);
    // The provider accepts its own resource URL, with https:, as the JWT audience.
    const subjectToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: credential.keyId })
      .setIssuer(credential.issuer)
      .setSubject(credential.subject)
      .setAudience(`https:${credential.audience}`)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 600)
      .sign(await importPKCS8(credential.privateKey, "RS256"));
    const exchanged = await fetcher("https://sts.googleapis.com/v1/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: credential.audience,
        scope: SCOPE,
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectToken,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      }),
    });
    if (!exchanged.ok)
      throw new Error(`Google's Security Token Service answered ${exchanged.status}.`);
    const federated = ((await exchanged.json()) as { access_token?: string }).access_token;
    if (!federated) throw new Error("Google's Security Token Service returned no token.");
    const impersonated = await fetcher(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(credential.serviceAccount)}:generateAccessToken`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${federated}`, "content-type": "application/json" },
        body: JSON.stringify({ scope: [SCOPE], lifetime: "3600s" }),
      },
    );
    if (!impersonated.ok)
      throw new Error(
        `Acting as ${credential.serviceAccount} was refused (${impersonated.status}).`,
      );
    const body = (await impersonated.json()) as { accessToken?: string; expireTime?: string };
    if (!body.accessToken) throw new Error("IAM Credentials returned no access token.");
    const expiresAt = body.expireTime ? Date.parse(body.expireTime) : now() + 3600_000;
    cached = { token: body.accessToken, expiresAt };
    return body.accessToken;
  };
  return async () => {
    if (cached && cached.expiresAt - now() > 5 * 60_000) return cached.token;
    pending ??= mint().finally(() => {
      pending = null;
    });
    return pending;
  };
}
