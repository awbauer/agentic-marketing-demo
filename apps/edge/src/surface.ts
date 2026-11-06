import {
  BRAND_PLACEHOLDER,
  BRANDS,
  PERSONA_LABELS,
  PERSONAS,
  parseScope,
  type WorkbenchScope,
} from "@northstar/architecture";
import { type Confirmation, type Principal, PROOF_DEFAULTS } from "@northstar/contracts";
import type { UIMessage } from "ai";
import { decodeJwt } from "jose";
import { USE_CASES, useCaseBrand } from "../../web/src/usecases/catalog";
import { executionTrace, toolCalls } from "../../web/src/turn-trace";
import type { AuthBindings } from "./auth";

/**
 * Other surfaces onto the same workspace, such as the Lightning component. They sign in through
 * Cloudflare Access like the browser app and present the same Access token, so they are the same
 * principal with the same agent, Salesforce connection, and history. What lives here is only what
 * a surface that cannot hold the chat WebSocket needs: the sign-in hand-off and plain-JSON views.
 */

export type SurfaceBindings = AuthBindings & {
  SURFACE_ALLOWED_ORIGINS?: string;
  AI_GATEWAY_ID: string;
};

const MAX_TURN_TEXT = 4000;
const MAX_TRACE_PAYLOAD = 4000;

export const surfaceAllowedOrigins = (env: Pick<SurfaceBindings, "SURFACE_ALLOWED_ORIGINS">) =>
  (env.SURFACE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

function page(status: number, nonce: string, script: string, message: string) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northstar sign-in</title></head><body style="font:16px system-ui;margin:3rem;text-align:center"><p id="status">${message}</p><script nonce="${nonce}">${script}</script></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'`,
    },
  });
}

/**
 * Where Login lands once Access has let the person in. Access cookies are HTTP-only and this host
 * is another origin, so this page hands the token to the window that opened it, and only when that
 * window is an origin this Worker names. postMessage's target origin enforces that in the browser.
 */
export function surfaceLoginPage(request: Request, env: SurfaceBindings) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const origin = new URL(request.url).searchParams.get("origin") ?? "";
  if (!surfaceAllowedOrigins(env).includes(origin))
    return page(403, nonce, "", "This Salesforce org isn't allowed to sign in to the workbench.");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return page(401, nonce, "", "Cloudflare Access did not supply a token.");
  const expiresAt = (decodeJwt(token).exp ?? 0) * 1000;
  const handoff = JSON.stringify({ type: "northstar-access", token, expiresAt }).replaceAll(
    "<",
    "\\u003c",
  );
  const script = `const opener = window.opener;
if (opener) {
  opener.postMessage(${handoff}, ${JSON.stringify(origin)});
  document.getElementById("status").textContent = "Signed in. You can close this window.";
  window.close();
} else {
  document.getElementById("status").textContent = "Signed in. Go back to Salesforce and press Login once more.";
}`;
  return page(200, nonce, script, "Signing you in…");
}

/** Everything a surface draws before its first turn, from the same sources as the browser app. */
export function surfaceBootstrap(principal: Principal, env: SurfaceBindings) {
  const admin = principal.role === "demo-admin";
  return {
    principal: { email: principal.email, role: principal.role },
    brands: BRANDS,
    personas: PERSONAS.filter((persona) => persona !== "admin" || admin).map((persona) => ({
      value: persona,
      label: PERSONA_LABELS[persona],
    })),
    placeholders: BRAND_PLACEHOLDER,
    useCases: USE_CASES.map((useCase) => ({ ...useCase, brand: useCaseBrand(useCase) })),
    gateway: { id: env.AI_GATEWAY_ID, model: PROOF_DEFAULTS.orchestratorModel },
    // These run inside the Worker on every turn, so the Access sign-in is what reaches them. The
    // Salesforce MCP is separate: it needs the person's own OAuth through the portal.
    mcpServers: [
      { id: "campaign-context", label: "Campaign context" },
      { id: "external-services", label: "External services" },
      { id: "life-sciences", label: "Life sciences systems" },
      { id: "knowledge-graph", label: "Knowledge graph" },
    ],
  };
}

export function parseSurfaceTurn(body: unknown): { text: string; scope: WorkbenchScope } | null {
  const input = (body && typeof body === "object" ? body : {}) as {
    text?: unknown;
    scope?: unknown;
  };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > MAX_TURN_TEXT) return null;
  return { text, scope: parseScope(input.scope) };
}

/** A chat message as plain JSON: its answer, its tool calls, and the same trace the browser shows. */
export function surfaceMessage(message: UIMessage, live = false) {
  return {
    id: message.id,
    role: message.role,
    live,
    text: message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim(),
    toolCalls: toolCalls(message),
    trace: executionTrace(message).map((row) =>
      row.payload && row.payload.length > MAX_TRACE_PAYLOAD
        ? { ...row, payload: `${row.payload.slice(0, MAX_TRACE_PAYLOAD)}…` }
        : row,
    ),
  };
}

/** The pending write for a confirmation card, without its signing material or idempotency key. */
export function surfaceConfirmation(confirmation: Confirmation | null) {
  if (!confirmation) return null;
  return {
    id: confirmation.id,
    action: confirmation.action,
    summary: confirmation.summary,
    status: confirmation.status,
    expiresAt: confirmation.expiresAt,
    permitted: confirmation.permissions?.allowed ?? null,
  };
}
