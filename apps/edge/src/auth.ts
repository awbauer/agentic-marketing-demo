import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { PrincipalSchema, PROOF_DEFAULTS, type Principal } from "@northstar/contracts";

export type AuthBindings = {
  AUTH_MODE: string;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Google Cloud (AUTH_MODE "iap"): the IAP audience, `/projects/<number>/locations/<region>/services/<service>`. */
  IAP_AUDIENCE?: string;
  /** Google Cloud: who may use the workbench and in which role; absent means nobody (ADR-018). */
  MEMBERS?: MemberDirectory;
  /** Tests only: the keys IAP assertions are checked against, in place of Google's. */
  IAP_JWKS?: JWTVerifyGetKey;
};

/** The workbench's allowlist on Google Cloud, where IAP's assertion carries no role or tenant. */
export type MemberDirectory = {
  lookup(email: string): Promise<{ role: string; tenantId?: string } | null>;
};

const IAP_ISSUER = "https://cloud.google.com/iap";
const IAP_KEYS = createRemoteJWKSet(new URL("https://www.gstatic.com/iap/verify/public_key-jwk"));

/**
 * IAP signs every request it lets through; the assertion is checked here as well, so a request
 * that reaches the service some other way is still refused. Only listed members get a principal.
 */
async function resolveIapPrincipal(request: Request, env: AuthBindings): Promise<Principal> {
  const token = request.headers.get("x-goog-iap-jwt-assertion");
  if (!token)
    throw new AuthError("UNAUTHENTICATED", "Identity-Aware Proxy authentication is required.");
  if (!env.IAP_AUDIENCE || !env.MEMBERS)
    throw new AuthError("FORBIDDEN", "The IAP verifier is not configured.");
  const result = await jwtVerify(token, env.IAP_JWKS ?? IAP_KEYS, {
    issuer: IAP_ISSUER,
    audience: env.IAP_AUDIENCE,
    algorithms: ["ES256"],
  });
  const email = typeof result.payload.email === "string" ? result.payload.email.toLowerCase() : "";
  const member = email ? await env.MEMBERS.lookup(email) : null;
  if (!member) throw new AuthError("FORBIDDEN", "This identity is not a member of the workspace.");
  const parsed = PrincipalSchema.safeParse({
    subject: result.payload.sub,
    email,
    role: member.role,
    tenantId: member.tenantId ?? "northstar-pot",
  });
  if (!parsed.success || !PROOF_DEFAULTS.roles.includes(parsed.data.role))
    throw new AuthError("FORBIDDEN", "The IAP identity is not allowed in this workspace.");
  return parsed.data;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
  }
}

export async function resolvePrincipal(request: Request, env: AuthBindings): Promise<Principal> {
  if (env.AUTH_MODE === "development" && env.ENVIRONMENT === "local")
    return {
      subject: "local-evaluator",
      email: "evaluator@northstar.example",
      role: "evaluator",
      tenantId: "northstar-pot",
    };
  if (env.AUTH_MODE === "iap") return resolveIapPrincipal(request, env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token)
    throw new AuthError("UNAUTHENTICATED", "Cloudflare Access authentication is required.");
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    throw new AuthError("FORBIDDEN", "Access verifier is not configured.");
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  const result = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
    { issuer, audience: env.ACCESS_AUD },
  );
  const parsed = PrincipalSchema.safeParse({
    subject: result.payload.sub,
    email: result.payload.email,
    role: result.payload.role ?? "evaluator",
    tenantId: result.payload.tenant_id ?? "northstar-pot",
  });
  if (!parsed.success || !PROOF_DEFAULTS.roles.includes(parsed.data.role))
    throw new AuthError("FORBIDDEN", "The Access identity is not allowed in this workspace.");
  return parsed.data;
}

export async function deriveAgentKey(principal: Principal, workspaceId: string) {
  const bytes = new TextEncoder().encode(
    `${principal.tenantId}:${principal.subject}:${workspaceId}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `wk_${Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
