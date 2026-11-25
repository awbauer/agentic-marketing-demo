import { jwtVerify, SignJWT } from "jose";
import { type CedarContext, cedar, type EntityJson } from "./cedar/engine.ts";
import { CEDAR_POLICIES, CEDAR_SCHEMA } from "./cedar/policies.generated.ts";
import {
  ACTION_RISK,
  AGENT_REGISTRY,
  type AgentManifest,
  type AgentOverrides,
  effectiveAgent,
} from "./registry.ts";
import { toolBrand } from "./scope.ts";
import { PERSONAS, type Persona } from "./state-machine.ts";
import type { Brand, ObjectKind } from "./types.ts";

// The agentic gateway. Every call (a person's workbench action, an architecture agent's
// capability, a chat tool, a campaign team tool) is one Cedar request, decided by the real Cedar
// engine against the policy files in packages/architecture/policies. The same decision answers
// "may this be offered?" (toolsAllowed) and "may this run?" (evaluate), so they cannot differ.

export type Principal = { type: "persona"; id: Persona } | { type: "agent"; id: string };

/** What a call is made in, beyond who and what: the same at offer time and at call time. */
export type GatewayContext = {
  /** workbench (default), chat, team, squad or lifecycle. */
  surface?: string;
  /** The chat scenario id. */
  scenario?: string;
  /** The pharma lifecycle step: its save tool. */
  stage?: string;
  /** The request classifier's labels for the turn. */
  intents?: readonly string[];
  /** Tools that already ran and worked this turn or step. */
  done?: readonly string[];
  /** Chat: the tools a scenario runs before it drafts in Marketing Cloud. */
  prerequisites?: readonly string[];
  /** The brand chosen in the header; defaults from the user's brand scope. */
  brand?: string;
};

export type GatewayRequest = {
  /** The signed-in user the call is made for. */
  user: { subject: string; persona: Persona; brands: readonly Brand[] | "all" };
  /** Who is calling: the user's persona directly, or an agent acting for them. */
  principal: Principal;
  /** A capability (author_module), tool:<name> for a chat tool, or team:<name> for the team's. */
  action: string;
  resource?: { urn?: string; kind?: ObjectKind; brand?: Brand };
  context?: GatewayContext;
};

export type Decision = {
  decision: "allow" | "deny";
  policyId: string;
  reason: string;
  effect: "permit" | "forbid" | "default";
};

/** One Cedar policy in force, with what the views need to show it. */
export type Policy = {
  /** The Cedar policy id: its @id, or the link's id for a policy linked from a template. */
  id: string;
  effect: "permit" | "forbid";
  /** The file under packages/architecture/policies it comes from. */
  file: string;
  /** Who it names; "*" for a type, or for a rule that tests the principal in its condition. */
  principal: { type: "persona" | "agent" | "any"; ids: readonly string[] | "*" };
  /** The gateway actions a linked grant names, for display; empty for a written rule. */
  actions: readonly string[];
  /** The @note: the reason a decision it makes gives. */
  note: string;
  /** The policy's Cedar text, comments included. */
  cedar: string;
  /** For a linked policy, the template it links. */
  template?: string;
};

/** What the gateway knows about an agent: the Cedar Agent entity's attributes. */
export type AgentFacts = {
  name: string;
  grants: readonly string[];
  scope: string;
  lifecycle: string;
  disabled: boolean;
  role?: string;
  deliverable?: string;
};

/**
 * The policies in force and the entity data they were compiled with: the agents' attributes
 * (registry plus overrides) and the risk of team tools. Build with buildPolicies or
 * buildTeamPolicies, and combine with mergePolicies.
 */
export type PolicySet = readonly Policy[] & {
  readonly agents: Readonly<Record<string, AgentFacts>>;
  readonly risks: Readonly<Record<string, string>>;
};

type FilePolicy = (typeof CEDAR_POLICIES)[number];
const FILE_POLICIES: readonly FilePolicy[] = CEDAR_POLICIES;

const fromFile = (policy: FilePolicy): Policy => ({
  id: policy.id,
  effect: policy.effect,
  file: policy.file,
  principal: policy.principal,
  actions: [],
  note: policy.note,
  cedar: `// packages/architecture/policies/${policy.file}\n${policy.text}`,
});

/** The written (static) policies of some policy files, in file order. */
export const filePolicies = (...files: readonly string[]): Policy[] =>
  FILE_POLICIES.filter((policy) => policy.kind === "static" && files.includes(policy.file)).map(
    fromFile,
  );

/** A template from the policy files, linked to one agent as its own policy. */
export function linkPolicy(
  templateId: string,
  id: string,
  agentId: string,
  actions: readonly string[],
  note: string,
): Policy {
  const template = FILE_POLICIES.find((policy) => policy.id === templateId);
  if (template?.kind !== "template") throw new Error(`No Cedar template ${templateId}.`);
  return {
    id,
    effect: template.effect,
    file: template.file,
    principal: { type: "agent", ids: [agentId] },
    actions,
    note,
    template: templateId,
    cedar: `// packages/architecture/policies/${template.file}: ${templateId} linked to ${agentId}\n${template.text
      .replace(`@id("${templateId}")`, `@id("${id}")`)
      .replaceAll("?principal", `Agent::${JSON.stringify(agentId)}`)}`,
  };
}

export function policySet(
  policies: readonly Policy[],
  agents: Readonly<Record<string, AgentFacts>> = {},
  risks: Readonly<Record<string, string>> = {},
): PolicySet {
  return Object.assign([...policies], { agents, risks });
}

/** One set from several, keeping the first of any policy id and every set's entity data. */
export function mergePolicies(...sets: readonly (PolicySet | readonly Policy[])[]): PolicySet {
  const seen = new Set<string>();
  const policies = sets.flat().filter((policy) => !seen.has(policy.id) && seen.add(policy.id));
  return policySet(
    policies,
    Object.assign({}, ...sets.map((set) => (set as Partial<PolicySet>).agents ?? {})),
    Object.assign({}, ...sets.map((set) => (set as Partial<PolicySet>).risks ?? {})),
  );
}

/**
 * Compiles the registry into the base policy set: the guards, the persona permits, one link of
 * the agent-grants template per live agent with grants, and the orchestrator's policies. Each
 * agent's attributes carry its overrides: constrain keeps reads, retire and disable keep nothing.
 */
export function buildPolicies(
  overrides: AgentOverrides = {},
  registry: readonly AgentManifest[] = AGENT_REGISTRY,
): PolicySet {
  const agents: Record<string, AgentFacts> = {};
  const links: Policy[] = [];
  for (const base of registry) {
    const agent = effectiveAgent(base, overrides);
    agents[agent.id] = {
      name: agent.name,
      grants: agent.grants,
      scope: agent.scope,
      lifecycle: agent.lifecycle,
      disabled: agent.disabled,
    };
    // The orchestrator's policies are written in orchestrator.cedar.
    if (agent.status !== "live" || agent.id === "orchestrator" || agent.grants.length === 0)
      continue;
    links.push(
      linkPolicy(
        "agent-grants",
        `agent-${agent.id}`,
        agent.id,
        agent.grants,
        `${agent.name} (${agent.lifecycle}) may call its registered grants on ${agent.scope}.`,
      ),
    );
  }
  return policySet(
    [
      ...filePolicies("guards.cedar", "personas.cedar"),
      ...links,
      ...filePolicies("orchestrator.cedar"),
    ],
    agents,
  );
}

/** The schema and policy files, as generated from packages/architecture/policies. */
export { CEDAR_POLICIES, CEDAR_SCHEMA };

// Requests -------------------------------------------------------------------------------------

const ACTION = { type: "Action", id: "call" } as const;

/** The Cedar resource a gateway action names: tool:<x> and team:<x> are tools, the rest capabilities. */
function resourceOf(action: string, risks: Readonly<Record<string, string>>): EntityJson {
  if (action.startsWith("tool:")) {
    const name = action.slice(5);
    const brand = toolBrand(name);
    return {
      uid: { type: "Tool", id: name },
      attrs: { name, ...(brand ? { brand } : {}) },
      parents: [],
    };
  }
  if (action.startsWith("team:")) {
    const name = action.slice(5);
    return {
      uid: { type: "TeamTool", id: name },
      attrs: { name, risk: risks[action] ?? "draft" },
      parents: [],
    };
  }
  const risk = (ACTION_RISK as Record<string, string>)[action] ?? "unknown";
  return { uid: { type: "Capability", id: action }, attrs: { name: action, risk }, parents: [] };
}

const UNKNOWN_AGENT = (id: string): AgentFacts => ({
  name: id,
  grants: [],
  scope: "any",
  lifecycle: "monitor",
  disabled: false,
});

function principalOf(principal: Principal, agents: Readonly<Record<string, AgentFacts>>) {
  if (principal.type === "persona")
    return {
      facts: undefined,
      entity: { uid: { type: "Persona", id: principal.id }, attrs: {}, parents: [] } as EntityJson,
    };
  const facts = agents[principal.id] ?? UNKNOWN_AGENT(principal.id);
  const { role, deliverable, ...rest } = facts;
  return {
    facts,
    entity: {
      uid: { type: "Agent", id: principal.id },
      attrs: {
        ...rest,
        grants: [...facts.grants],
        ...(role ? { role } : {}),
        ...(deliverable ? { deliverable } : {}),
      },
      parents: [],
    } as EntityJson,
  };
}

function contextOf(request: GatewayRequest, resource: EntityJson): CedarContext {
  const { user, context = {} } = request;
  const brands = user.brands === "all" ? ["all"] : [...user.brands];
  const ownBrand = (resource.attrs as { brand?: string }).brand;
  const target = {
    ...(request.resource?.kind ? { kind: request.resource.kind } : {}),
    ...(request.resource?.brand || ownBrand ? { brand: request.resource?.brand ?? ownBrand } : {}),
  };
  return {
    persona: user.persona,
    brand: context.brand ?? (brands.length === 1 ? (brands[0] as string) : "all"),
    brands,
    surface: context.surface ?? "workbench",
    ...(context.scenario ? { scenario: context.scenario } : {}),
    ...(context.stage ? { stage: context.stage } : {}),
    intents: [...(context.intents ?? [])],
    done: [...(context.done ?? [])],
    ...(context.prerequisites ? { prerequisites: [...context.prerequisites] } : {}),
    ...(Object.keys(target).length ? { target } : {}),
  } as CedarContext;
}

// Compiling ------------------------------------------------------------------------------------

type Compiled = { id: string; order: ReadonlyMap<string, number> };
const compiledBySet = new WeakMap<readonly Policy[], Compiled>();
const compiledByKey = new Map<string, Compiled>();
const MAX_COMPILED = 32;

/**
 * Parses a policy set into the engine once and keeps it there, keyed by its policies: overrides
 * change rarely, so a process holds a handful of sets and each request only names one.
 */
function compile(policies: readonly Policy[]): Compiled {
  const known = compiledBySet.get(policies);
  if (known) return known;
  const key = policies.map((policy) => `${policy.id}<${policy.template ?? ""}`).join("|");
  let compiled = compiledByKey.get(key);
  if (!compiled) {
    if (compiledByKey.size >= MAX_COMPILED) compiledByKey.clear();
    const text = (id: string) => FILE_POLICIES.find((policy) => policy.id === id)?.text ?? "";
    const id = `set-${compiledByKey.size}`;
    const answer = cedar().preparsePolicySet(id, {
      staticPolicies: Object.fromEntries(
        policies.filter((policy) => !policy.template).map((policy) => [policy.id, text(policy.id)]),
      ),
      templates: Object.fromEntries(
        [...new Set(policies.flatMap((policy) => (policy.template ? [policy.template] : [])))].map(
          (template) => [template, text(template)],
        ),
      ),
      templateLinks: policies.flatMap((policy) =>
        policy.template
          ? [
              {
                templateId: policy.template,
                newId: policy.id,
                values: {
                  "?principal": { type: "Agent", id: (policy.principal.ids as string[])[0] ?? "" },
                },
              },
            ]
          : [],
      ),
    });
    if (answer.type !== "success")
      throw new Error(
        `The Cedar policies do not parse: ${answer.errors.map((error) => error.message).join("; ")}`,
      );
    compiled = { id, order: new Map(policies.map((policy, index) => [policy.id, index])) };
    compiledByKey.set(key, compiled);
  }
  compiledBySet.set(policies, compiled);
  return compiled;
}

const fill = (note: string, values: Record<string, string | undefined>) =>
  note.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);

/**
 * Default-deny, decided by Cedar: a call is allowed only if a permit matches and no forbid does.
 * The decision names the policy that made it (the first in file order when several did).
 */
export function evaluate(policies: readonly Policy[], request: GatewayRequest): Decision {
  const set = policies as Partial<PolicySet>;
  const compiled = compile(policies);
  const resource = resourceOf(request.action, set.risks ?? {});
  const principal = principalOf(request.principal, set.agents ?? {});
  const context = contextOf(request, resource);
  const answer = cedar().statefulIsAuthorized({
    principal: principal.entity.uid,
    action: ACTION,
    resource: resource.uid,
    context,
    preparsedPolicySetId: compiled.id,
    entities: [principal.entity, resource],
  });
  if (answer.type !== "success")
    throw new Error(
      `The gateway could not evaluate ${request.action}: ${answer.errors.map((error) => error.message).join("; ")}`,
    );
  const { decision, diagnostics } = answer.response;
  if (diagnostics.errors.length)
    console.warn(
      "[gateway] policy errors",
      diagnostics.errors.map((error) => `${error.policyId}: ${error.error.message}`).join("; "),
    );
  const deciding = diagnostics.reason
    .map((id) => policies[compiled.order.get(id) ?? -1])
    .filter((policy): policy is Policy => policy !== undefined)
    .sort((a, b) => (compiled.order.get(a.id) ?? 0) - (compiled.order.get(b.id) ?? 0))[0];
  if (!deciding)
    return {
      decision: "deny",
      policyId: "default-deny",
      effect: "default",
      reason: `No policy grants ${request.principal.type} ${request.principal.id} the action ${request.action}.`,
    };
  const target = (context as { target?: { brand?: string } }).target;
  return {
    decision,
    policyId: deciding.id,
    effect: deciding.effect,
    reason: fill(deciding.note, {
      agent: principal.facts?.name ?? request.principal.id,
      lifecycle: principal.facts?.lifecycle,
      scope: principal.facts?.scope,
      grants: principal.facts?.grants.join(", "),
      brand: target?.brand,
      tool: (resource.attrs as { name: string }).name,
    }),
  };
}

/**
 * Which of some candidate actions a principal may call in a context: what to offer a model.
 * Each is decided exactly as evaluate decides the call, so offering and allowing never differ.
 */
export function toolsAllowed(input: {
  principal: Principal;
  user: GatewayRequest["user"];
  /** Gateway action strings, as evaluate takes them: author_module, tool:<x>, team:<x>. */
  candidates: readonly string[];
  context?: GatewayContext;
  resource?: GatewayRequest["resource"];
  policies?: readonly Policy[];
}): { allowed: string[]; decisions: Record<string, Decision> } {
  const policies = input.policies ?? buildPolicies();
  const decisions: Record<string, Decision> = {};
  for (const action of input.candidates)
    decisions[action] = evaluate(policies, {
      user: input.user,
      principal: input.principal,
      action,
      ...(input.resource ? { resource: input.resource } : {}),
      ...(input.context ? { context: input.context } : {}),
    });
  return {
    allowed: input.candidates.filter((action) => decisions[action]?.decision === "allow"),
    decisions,
  };
}

/** A policy's Cedar text as it runs, for display. */
export const toCedar = (policy: Policy): string => policy.cedar;

/** Validates every policy file against the schema with the engine; an empty list means valid. */
export function validatePolicies(): string[] {
  const statics = FILE_POLICIES.filter((policy) => policy.kind === "static");
  const templates = FILE_POLICIES.filter((policy) => policy.kind === "template");
  const answer = cedar().validate({
    schema: CEDAR_SCHEMA,
    policies: {
      staticPolicies: Object.fromEntries(statics.map((policy) => [policy.id, policy.text])),
      templates: Object.fromEntries(templates.map((policy) => [policy.id, policy.text])),
    },
  });
  if (answer.type !== "success") return answer.errors.map((error) => error.message);
  return answer.validationErrors.map((item) => `${item.policyId}: ${item.error.message}`);
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
  options: { tokenVerified: boolean; partner?: string; signIn?: string } = { tokenVerified: false },
): ChainHop[] {
  const brands = request.user.brands === "all" ? "all brands" : request.user.brands.join(", ");
  const chain: ChainHop[] = [
    {
      hop: "user",
      label: "User",
      identity: request.user.subject,
      detail: `${options.signIn ?? "Cloudflare Access"} sign-in`,
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
