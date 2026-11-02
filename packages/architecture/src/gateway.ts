import { jwtVerify, SignJWT } from "jose";
import {
  ACTION_RISK,
  AGENT_REGISTRY,
  type AgentManifest,
  type AgentOverrides,
  effectiveAgent,
} from "./registry.ts";
import { PERSONAS, type Persona } from "./state-machine.ts";
import type { Brand, ObjectKind } from "./types.ts";

export type Principal = { type: "persona"; id: Persona } | { type: "agent"; id: string };

export type GatewayRequest = {
  /** The signed-in user the call is made for. */
  user: { subject: string; persona: Persona; brands: readonly Brand[] | "all" };
  /** Who is calling: the user's persona directly, or an agent acting for them. */
  principal: Principal;
  action: string;
  resource?: { urn?: string; kind?: ObjectKind; brand?: Brand };
};

export type Decision = {
  decision: "allow" | "deny";
  policyId: string;
  reason: string;
  effect: "permit" | "forbid" | "default";
};

export type Policy = {
  id: string;
  effect: "permit" | "forbid";
  /** A principal type and ids; "*" matches all of that type. */
  principal: { type: "persona" | "agent"; ids: readonly string[] | "*" };
  /** Exact actions, or a prefix ending in "*", such as "tool:*". */
  actions: readonly string[];
  kinds?: readonly ObjectKind[] | undefined;
  note: string;
};

const matchesAction = (patterns: readonly string[], action: string) =>
  patterns.some((pattern) =>
    pattern.endsWith("*") ? action.startsWith(pattern.slice(0, -1)) : pattern === action,
  );

const matchesPrincipal = (policy: Policy, principal: Principal) =>
  policy.principal.type === principal.type &&
  (policy.principal.ids === "*" || policy.principal.ids.includes(principal.id));

const DECIDE_ACTIONS = Object.entries(ACTION_RISK)
  .filter(([, risk]) => risk === "decide")
  .map(([action]) => action);

/** Persona (human) grants. Which transition a persona may take is the state machine's check. */
const PERSONA_PERMITS: Policy[] = [
  {
    id: "persona-read",
    effect: "permit",
    principal: { type: "persona", ids: "*" },
    actions: Object.entries(ACTION_RISK)
      .filter(([, risk]) => risk === "read" || risk === "draft")
      .map(([action]) => action),
    note: "Every signed-in persona can read and ask for drafts.",
  },
  {
    id: "persona-transition",
    effect: "permit",
    principal: { type: "persona", ids: "*" },
    actions: ["transition", "propose_transition"],
    note: "Any persona may attempt a transition; the state machine decides which one.",
  },
  {
    id: "persona-supersede-claim",
    effect: "permit",
    principal: { type: "persona", ids: ["compliance", "admin"] },
    actions: ["supersede_claim"],
    kinds: ["claim"],
    note: "Compliance owns the evidence, so it owns a claim's supersession.",
  },
  {
    id: "persona-accept-optimization",
    effect: "permit",
    principal: { type: "persona", ids: ["brand-lead", "admin"] },
    actions: ["accept_optimization"],
    note: "The brand lead disposes on optimization.",
  },
];

const FORBIDS: Policy[] = [
  {
    id: "forbid-agent-decisions",
    effect: "forbid",
    principal: { type: "agent", ids: "*" },
    actions: DECIDE_ACTIONS,
    note: "Agents propose; only a person decides, so no agent can hold a decision action.",
  },
];

/** Compiles the registry into per-agent permits, then adds the persona permits and forbids. */
export function buildPolicies(
  overrides: AgentOverrides = {},
  registry: readonly AgentManifest[] = AGENT_REGISTRY,
): Policy[] {
  const agentPolicies: Policy[] = [];
  for (const base of registry) {
    const agent = effectiveAgent(base, overrides);
    if (agent.status !== "live") continue;
    if (agent.id === "orchestrator") {
      if (!agent.disabled && agent.lifecycle !== "retire")
        agentPolicies.push({
          id: "agent-orchestrator-tools",
          effect: "permit",
          principal: { type: "agent", ids: ["orchestrator"] },
          actions: ["tool:*"],
          note: "The orchestrator may call any tool the operator has not withheld.",
        });
      continue;
    }
    if (agent.grants.length === 0) continue;
    agentPolicies.push({
      id: `agent-${agent.id}`,
      effect: "permit",
      principal: { type: "agent", ids: [agent.id] },
      actions: agent.grants,
      kinds: agent.scope === "any" ? undefined : [agent.scope],
      note: `${agent.name} (${agent.lifecycle}) may call its registered grants on ${agent.scope}.`,
    });
  }
  return [...PERSONA_PERMITS, ...agentPolicies, ...FORBIDS];
}

/** Default-deny. A matching forbid beats any permit, as in Cedar. */
export function evaluate(policies: readonly Policy[], request: GatewayRequest): Decision {
  const { resource, user } = request;
  if (resource?.brand && user.brands !== "all" && !user.brands.includes(resource.brand))
    return {
      decision: "deny",
      policyId: "forbid-out-of-scope-brand",
      effect: "forbid",
      reason: `${resource.brand} is outside this user's brand scope.`,
    };
  const applicable = policies.filter(
    (policy) =>
      matchesPrincipal(policy, request.principal) &&
      matchesAction(policy.actions, request.action) &&
      (!policy.kinds || !resource?.kind || policy.kinds.includes(resource.kind)),
  );
  const forbid = applicable.find((policy) => policy.effect === "forbid");
  if (forbid)
    return { decision: "deny", policyId: forbid.id, effect: "forbid", reason: forbid.note };
  const permit = applicable.find((policy) => policy.effect === "permit");
  if (permit)
    return { decision: "allow", policyId: permit.id, effect: "permit", reason: permit.note };
  return {
    decision: "deny",
    policyId: "default-deny",
    effect: "default",
    reason: `No policy grants ${request.principal.type} ${request.principal.id} the action ${request.action}.`,
  };
}

/** The Cedar text for a policy, for display. The evaluator above is the typed equivalent. */
export function toCedar(policy: Policy): string {
  const principal =
    policy.principal.ids === "*"
      ? `principal is ${policy.principal.type === "agent" ? "Agent" : "Persona"}`
      : `principal in [${policy.principal.ids.map((id) => `${policy.principal.type === "agent" ? "Agent" : "Persona"}::"${id}"`).join(", ")}]`;
  const actions = `action in [${policy.actions.map((action) => `Action::"${action}"`).join(", ")}]`;
  const resource = policy.kinds
    ? `resource is Object when { resource.kind in [${policy.kinds.map((kind) => `"${kind}"`).join(", ")}] }`
    : "resource";
  return `${policy.effect} (\n  ${principal},\n  ${actions},\n  ${resource}\n); // ${policy.note}`;
}

// Workload identity ---------------------------------------------------------------------------

const ISSUER = "northstar-gateway";
const encode = (secret: string) => new TextEncoder().encode(secret);

export type AgentTokenClaims = {
  /** "agent:<id>" or "persona:<id>". */
  sub: string;
  /** The user the call acts for (RFC 8693 `act`). */
  act: { sub: string };
  action: string;
  jti: string;
};

/** A short-lived token minted per invocation; no shared credentials, no agent acting as itself. */
export async function mintAgentToken(
  secret: string,
  request: GatewayRequest,
  ttlSeconds = 60,
): Promise<string> {
  return new SignJWT({ act: { sub: request.user.subject }, action: request.action })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`${request.principal.type}:${request.principal.id}`)
    .setIssuer(ISSUER)
    .setAudience("northstar-services")
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encode(secret));
}

/** What a service does before it acts: verify the token, and that it was minted for this action. */
export async function verifyAgentToken(
  secret: string,
  token: string,
  expected: { action: string; user: string },
): Promise<AgentTokenClaims> {
  const { payload } = await jwtVerify(token, encode(secret), {
    issuer: ISSUER,
    audience: "northstar-services",
  });
  const claims = payload as unknown as AgentTokenClaims;
  if (claims.action !== expected.action)
    throw new Error("Token was minted for a different action.");
  if (claims.act?.sub !== expected.user) throw new Error("Token acts for a different user.");
  return claims;
}

// Identity chain ------------------------------------------------------------------------------

export type ChainHop = {
  hop: "user" | "surface" | "bff" | "gateway" | "agent" | "service" | "partner";
  label: string;
  identity: string;
  detail: string;
  verified: boolean;
};

export function identityChain(
  request: GatewayRequest,
  decision: Decision,
  options: { tokenVerified: boolean; partner?: string } = { tokenVerified: false },
): ChainHop[] {
  const brands = request.user.brands === "all" ? "all brands" : request.user.brands.join(", ");
  const chain: ChainHop[] = [
    {
      hop: "user",
      label: "User",
      identity: request.user.subject,
      detail: "Cloudflare Access sign-in",
      verified: true,
    },
    {
      hop: "surface",
      label: "Surface",
      identity: `persona:${request.user.persona}`,
      detail: `Role, brand and market resolved: ${brands}, US`,
      verified: true,
    },
    {
      hop: "bff",
      label: "BFF",
      identity: "worker:northstar-edge",
      detail: "Context applied and access enforced",
      verified: true,
    },
    {
      hop: "gateway",
      label: "Agentic gateway",
      identity: `policy:${decision.policyId}`,
      detail: `${decision.decision.toUpperCase()}: ${decision.reason}`,
      verified: true,
    },
  ];
  if (decision.decision === "deny") return chain;
  chain.push({
    hop: "agent",
    label: request.principal.type === "agent" ? "Agent" : "Persona",
    identity: `${request.principal.type}:${request.principal.id}`,
    detail: options.tokenVerified ? "Per-invocation workload token" : "Token not checked",
    verified: options.tokenVerified,
  });
  chain.push({
    hop: "service",
    label: "Service or tool",
    identity: request.action,
    detail: `Scoped to ${request.resource?.kind ?? "any object"}; least privilege`,
    verified: options.tokenVerified,
  });
  if (options.partner)
    chain.push({
      hop: "partner",
      label: "Partner agent",
      identity: options.partner,
      detail: "Identity verified per call over A2A; data stays home",
      verified: true,
    });
  return chain;
}

export const isPersona = (value: unknown): value is Persona =>
  typeof value === "string" && (PERSONAS as readonly string[]).includes(value);
