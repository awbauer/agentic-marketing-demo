import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  AUDIT_RETENTION_HOURS,
  AUDIT_RETENTION_MS,
  type Confirmation,
  ConfirmationSchema,
  type ConnectorState,
  classifyPolicyIntent,
  currentFocusVersion,
  emptyWorkingSet,
  FOCUS_KIND_LABELS,
  type FocusItem,
  GeneratedCampaignImageSchema,
  initialOrchestratorState,
  type MarketingWrite,
  MEMORY_RETENTION_DAYS,
  MEMORY_TOOLS,
  type OrchestratorState,
  type PermissionReport,
  PHASE_2_AUTONOMOUS_TOOLS,
  PHASE_2_CURATED_TOOLS,
  PROOF_DEFAULTS,
  parseOperationControls,
  policyResponse,
  referentFromReply,
  SALESFORCE_AGENTS,
  SALESFORCE_TOOL_DETAILS,
  type SuggestedAction,
  type TurnRecord,
  TurnRecordSchema,
  WRITE_TOOL_BY_ACTION,
} from "@northstar/contracts";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type GenerateTextOnFinishCallback,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
  wrapLanguageModel,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  forgetMemory,
  type GraphBackend,
  KNOWLEDGE_GRAPH_TOOL_SPECS,
  listMemory,
  type MemoryRecordRef,
  recordDecision,
  rememberDraft,
} from "../../../packages/knowledge-graph/src/index.ts";
import { authorizeTool } from "./architecture/context";
import { LOCATIONS } from "./campaign-context/open-meteo";
import {
  CAMPAIGN_CONTEXT_TOOL_PREFIX,
  connectCampaignContextTools,
} from "./campaign-context/server";
import { locationInventory } from "./campaign-context/store-inventory";
import {
  connectExternalServiceTools,
  EXTERNAL_SERVICES_TOOL_PREFIX,
} from "./external-services/server";
import { applyFocusUpdate, type FocusInput, focusFromAnswer } from "./focus";
import { forcedToolCallMiddleware } from "./forced-tool-middleware";
import {
  assessInventoryRisk,
  type DemandResult,
  type ForecastResult,
  type InventoryResult,
  inventoryCaseDetails,
  inventoryRiskPrompt,
} from "./inventory-risk";
import {
  connectKnowledgeGraphTools,
  KNOWLEDGE_GRAPH_TOOL_PREFIX,
  knowledgeGraphBackend,
} from "./knowledge-graph/server";
import {
  agentRequest,
  agentToolInput,
  applyMarketingWrite,
  briefAnswer,
  briefFocusFromAgent,
  fixturePermissionReport,
  idsFromAgentReply,
  localAgentWrite,
  type MarketingReadBack,
  parseMarketingReadBack,
  parsePermissionReport,
  pinBriefToRefinement,
  planMarketingWrite,
  sameBrief,
  toolText,
  withRefreshedPreview,
} from "./marketing-writes";
import {
  focusMemoryDraft,
  localRecallAnswer,
  memoryActorHash,
  memoryStamp,
  memorySubjects,
} from "./memory";
import { buildTurnRecord } from "./turn-history";
import {
  type DraftIntent,
  draftIntent,
  isInventoryCheck,
  isRecallRequest,
  isRememberRequest,
  isRevisionRequest,
  MAX_OUTPUT_TOKENS,
  MAX_TURN_STEPS,
  missingPlannedTool,
  orchestratorSystemPrompt,
  pinCampaignChannel,
  requestedChannel,
  selectToolPlan,
  stepToolChoice,
  TURN_TIMEOUT,
  wantsSalesforceRecord,
} from "./turn-policy";
import { createTurnTracer, describeTurnError, type TurnRoute } from "./turn-trace";
import {
  addCreatedRecord,
  baseToolName,
  ingestToolResult,
  inventoryRiskCard,
  isFailure as isToolFailure,
  mergeIntoWorkingSet,
  openCampaign,
  reopenFromMemory,
  toolPayload,
  workingSetPrompt,
} from "./working-set";

export {
  requestedToolName,
  requiredToolChoice,
  selectRequiredTool,
  stepToolChoice,
} from "./turn-policy";

export type AgentProps = { principalSubject: string; workspaceId: string };
type OrchestratorBindings = CloudflareBindings & {
  SALESFORCE_MCP_URL?: string;
  CONFIRMATION_SIGNING_KEY?: string;
  // Operator kill switches, set as Worker secrets so deploys do not reset them.
  WRITES_ENABLED?: string;
  DISABLED_TOOLS?: string;
  MEMORY_ENABLED?: string;
  // Neo4j Aura Query API credentials (Worker secrets); without them the fixture graph is used.
  NEO4J_QUERY_URL?: string;
  NEO4J_USERNAME?: string;
  NEO4J_PASSWORD?: string;
};

/** The store inventory mock's count date in local development. */
const LOCAL_FIXTURE_COUNT_DATE = "2026-09-27";
const IMAGE_PROMPT_VERSION = "campaign-image-v1";
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// Matches the Apex attachment limit, which keeps the decoded image inside the synchronous heap.
const ATTACH_MAX_BYTES = 3 * 1024 * 1024;
const ACTIVITY_LABELS = {
  "save-marketing-brief": "Brief saved in Marketing Cloud",
  "create-marketing-campaign": "Campaign and flow created in Marketing Cloud",
  "create-review-task": "Review request created",
  "attach-generated-image": "Campaign image attached",
  "create-inventory-case": "Inventory case opened for the store manager",
} as const;
/** What a confirmation being prepared is for. */
const CONFIRMATION_TITLES = {
  "save-marketing-brief": "save the brief in Marketing Cloud",
  "create-marketing-campaign": "create the campaign in Marketing Cloud",
  "create-review-task": "request a review",
  "attach-generated-image": "attach the campaign image",
  "create-inventory-case": "open an inventory case",
} as const;
/** Why a write was linked to records Marketing Cloud already had, instead of saved again. */
const FOUND_NOTES = {
  reused: "already in Marketing Cloud from an earlier attempt; linked, not saved again",
  recovered: "the agent didn't answer in time, but Salesforce shows it was saved",
} as const;
/** The Marketing Cloud agent the workbench asks to save briefs and create campaigns. */
const CAMPAIGN_AGENT = "Northstar_Campaign_Creation";
const IMAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SEMANTIC_FAILURE_PATTERN =
  /no business units|no (?:results|records|data)\b|cannot (?:access|summarize|find|retrieve)|can't (?:access|summarize|find|retrieve)|not (?:available|found)|permission denied|access denied/i;

function collectResultText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value))
    value.forEach((child) => {
      collectResultText(child, output);
    });
  else if (value && typeof value === "object")
    Object.values(value as Record<string, unknown>).forEach((child) => {
      collectResultText(child, output);
    });
  return output;
}

export function classifyToolResult(value: unknown): "success" | "unavailable" | "error" {
  if (value && typeof value === "object" && (value as { isError?: unknown }).isError === true)
    return "error";
  return SEMANTIC_FAILURE_PATTERN.test(collectResultText(value).join(" "))
    ? "unavailable"
    : "success";
}

function latestUserText(messages: Array<{ role: string; parts?: Array<unknown> }>) {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message?.parts) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      ),
    )
    .map((part) => part.text)
    .join(" ");
}

export function evidenceTurnMessages(messages: UIMessage[]): UIMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return [message];
  }
  return [];
}

/** Most recent messages sent to the model, so follow-up requests keep the conversation's context. */
export const CONVERSATION_WINDOW = 8;

/**
 * The bounded conversation for a model turn. Earlier assistant replies keep only their text:
 * stale tool results, reasoning, and trace data never re-enter the prompt, and the system policy
 * tells the model that earlier replies are context, not Salesforce evidence (see WU-030).
 */
export function conversationWindow(
  messages: UIMessage[],
  maxMessages = CONVERSATION_WINDOW,
): UIMessage[] {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (messages[index]?.role === "user") {
      lastUser = index;
      break;
    }
  if (lastUser < 0) return [];
  const window = messages.slice(Math.max(0, lastUser - maxMessages + 1), lastUser + 1);
  const firstUser = window.findIndex((message) => message.role === "user");
  return window.slice(firstUser).flatMap((message, index, all): UIMessage[] => {
    if (message.role === "user") return [message];
    if (message.role !== "assistant" || index === all.length - 1) return [];
    const parts = message.parts.filter(
      (part) => part.type === "text" && part.text.trim().length > 0,
    );
    return parts.length ? [{ ...message, parts }] : [];
  });
}

/** Fixture tool results for local development, shaped like Salesforce agent replies. */
const LOCAL_FIXTURE_RESULTS: Array<[string, unknown]> = [
  [
    "summarize_campaign",
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            source: "local-fixture",
            campaignId: "701jV000004GglIQAS",
            summary:
              "Fall Loyalty Reactivation is in progress; engagement is 8.4 percent above its four-week baseline.",
            openRate: "38.2%",
            clickRate: "6.7%",
          }),
        },
      ],
    },
  ],
  [
    "check_campaign_readiness",
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            source: "local-fixture",
            campaignId: "701jV000004GglIQAS",
            summary: "7 of 9 readiness checks pass; 2 blockers remain before review.",
            blockers: "Accessibility copy; commercial-consent scope",
          }),
        },
      ],
    },
  ],
];

/** Deletes confirmation audit rows older than the 24-hour retention window. */
export async function pruneConfirmationAudit(db: D1Database) {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_MS).toISOString();
  try {
    await db.prepare("DELETE FROM confirmation_audit WHERE created_at < ?").bind(cutoff).run();
  } catch {
    // The table is created on the first confirmation; nothing to prune before that.
  }
}

/** What the local Campaign Creation agent stand-in replies when it drafts the fixture brief. */
function localAgentBrief(keyMessage: string) {
  return [
    "Here is a draft campaign brief (local fixture):",
    "Name: Rainy-day comfort: Spicy Tortilla Soup",
    "Description: Lunch campaign for Coastline app users in Los Angeles, built from the weather and past rainy-day results.",
    `Key Message: ${keyMessage}`,
    "Target Audience: Coastline Kitchen app users in Los Angeles who order at lunch.",
    "Primary Goal: Drive lunch app orders on rainy days.",
    "Primary CTAs: Order now",
    "Primary KPI: Lunch orders from the campaign",
    "Agent Guardrails: Coastline Kitchen brand voice; no discounts over 20 percent. Requested channel: Mobile app push.",
    "Priority: High",
  ].join("\n");
}

/**
 * Local development's stand-in for the Campaign Creation agent's drafting: the fixture brief
 * for a drafting request, and its next version for a revision of an unsaved brief.
 */
function localFixtureDraft(utterance: string, focus: FocusItem | null): FocusInput | null {
  const drafting =
    /\b(?:draft|write|create|plan)\b/i.test(utterance) &&
    /\b(?:push|message|notification|email|brief|content|campaign)\b/i.test(utterance);
  const revising = Boolean(focus) && isRevisionRequest(utterance);
  if (!drafting && !revising) return null;
  return briefFocusFromAgent(
    localAgentBrief(
      revising && !drafting ? "Rain outside? Warm soup is waiting." : "Rain outside? Soup's on.",
    ),
    revising && !drafting
      ? utterance.trim().slice(0, 240)
      : "Drafted by the Campaign Creation agent",
  );
}

type ToolResultListener = (toolName: string, input: unknown, output: unknown) => void;

/** Decides whether the gateway lets the orchestrator call a tool; a denial becomes a tool error. */
type ToolAuthorizer = (toolName: string) => Promise<{ decision: "allow" | "deny"; reason: string }>;

function guardToolResults(
  tools: ToolSet,
  onResult?: ToolResultListener,
  authorize?: ToolAuthorizer,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!("execute" in definition) || typeof definition.execute !== "function")
        return [name, definition];
      const execute = definition.execute;
      return [
        name,
        {
          ...definition,
          execute: async (...args: Parameters<typeof execute>) => {
            const gate = await authorize?.(name);
            if (gate?.decision === "deny")
              return {
                semanticStatus: "error",
                message: `The agentic gateway denied ${name}: ${gate.reason}`,
                upstream: null,
              };
            const upstream = await resolveToolResult(execute(...args));
            const semanticStatus = classifyToolResult(upstream);
            // Successful results feed the chat's working set; a listener error never fails the tool.
            if (semanticStatus === "success")
              try {
                onResult?.(name, args[0], upstream);
              } catch (error) {
                console.error("[orchestrator] working-set ingestion failed", error);
              }
            return semanticStatus === "success"
              ? upstream
              : {
                  semanticStatus,
                  message:
                    semanticStatus === "error"
                      ? "Salesforce reported that the tool call failed. Do not infer missing facts."
                      : "Salesforce returned no usable business result. Do not infer missing facts.",
                  upstream,
                };
          },
        },
      ];
    }),
  );
}

export function validateImageConcept(value: unknown) {
  if (typeof value !== "string") return null;
  const concept = value.trim().replace(/\s+/g, " ");
  if (concept.length < 8 || concept.length > 280) return null;
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(concept)) return null;
  if (/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(concept)) return null;
  if (
    /ignore (?:all |any )?(?:previous|prior) instructions|system prompt|customer list/i.test(
      concept,
    )
  )
    return null;
  return concept;
}

function pngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function connectorFromMcp(
  configured: boolean,
  mcp: ReturnType<MarketingOrchestrator["getMcpServers"]>,
): ConnectorState {
  if (!configured)
    return {
      id: "salesforce",
      label: "Salesforce agents",
      state: "not-configured",
      toolCount: 0,
      message: "The Salesforce MCP portal is not configured in this environment.",
    };
  const server = mcp.servers.salesforce;
  if (!server)
    return {
      id: "salesforce",
      label: "Salesforce agents",
      state: "disconnected",
      toolCount: 0,
      message: "Connect Salesforce to use the curated marketing agent catalog.",
    };
  const discoveredTools = new Set(
    mcp.tools.flatMap((tool) => {
      if (tool.serverId !== "salesforce") return [];
      const governedName = PHASE_2_CURATED_TOOLS.find(
        (name) => tool.name === name || tool.name.endsWith(`_${name}`),
      );
      return governedName ? [governedName] : [];
    }),
  );
  const toolCount = discoveredTools.size;
  if (server.state === "ready" && toolCount !== PHASE_2_CURATED_TOOLS.length)
    return {
      id: "salesforce",
      label: "Salesforce agents",
      state: "error",
      toolCount,
      errorCode: "UPSTREAM_UNAVAILABLE",
      message: `${toolCount} of ${PHASE_2_CURATED_TOOLS.length} governed Salesforce tools are available. Missing: ${PHASE_2_CURATED_TOOLS.filter((name) => !discoveredTools.has(name)).join(", ")}. An administrator must synchronize the portal and enable these tools on its Salesforce server.`,
    };
  if (server.state === "ready")
    return {
      id: "salesforce",
      label: "Salesforce agents",
      state: "ready",
      toolCount,
      message: `${toolCount} curated Salesforce tools are available for this user.`,
    };
  if (
    server.state === "authenticating" ||
    server.state === "connecting" ||
    server.state === "connected" ||
    server.state === "discovering"
  )
    return {
      id: "salesforce",
      label: "Salesforce agents",
      state: "authenticating",
      toolCount,
      message:
        server.state === "authenticating"
          ? "Finish Salesforce authorization in the opened window."
          : "Salesforce is connected. Discovering the curated tool catalog…",
      ...(server.auth_url ? { authUrl: server.auth_url } : {}),
    };
  const failure = classifyMcpFailure(server.error);
  return {
    id: "salesforce",
    label: "Salesforce agents",
    state: server.state === "failed" ? failure.state : "disconnected",
    toolCount,
    message:
      server.state === "failed"
        ? failure.message
        : "Connect Salesforce to use the curated marketing agent catalog.",
    ...(server.state === "failed" ? { errorCode: failure.errorCode } : {}),
  };
}

export function classifyMcpFailure(
  error: string | null | undefined,
): Pick<ConnectorState, "state" | "message" | "errorCode"> {
  const normalized = error?.toLowerCase() ?? "";
  if (
    normalized.includes("expired") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("token")
  )
    return {
      state: "expired",
      errorCode: "AUTH_REQUIRED",
      message: "Your Salesforce authorization expired. Reconnect to continue.",
    };
  if (
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("403")
  )
    return {
      state: "error",
      errorCode: "PERMISSION_DENIED",
      message: "Salesforce denied this user. Verify evaluator permissions, then reconnect.",
    };
  return {
    state: "error",
    errorCode: "UPSTREAM_UNAVAILABLE",
    message: "Salesforce authorization or tool discovery failed. Reconnect to recover.",
  };
}

/**
 * The signed confirmation token Apex verifies: the action, the record or subject it's bound to,
 * the request hash, the idempotency key, the expiry, and the user, under the shared HMAC key.
 */
async function signConfirmation(current: Confirmation, signingKey: string) {
  const confirmationExpiresAt = Math.floor(Date.parse(current.expiresAt) / 1000);
  const canonicalConfirmation = [
    current.action,
    current.recordId,
    current.id,
    current.requestHash,
    current.idempotencyKey,
    String(confirmationExpiresAt),
    current.principalSubject,
  ].join("\n");
  const confirmationSignature = await hmacSha256Hex(signingKey, canonicalConfirmation);
  const principalHex = [...new TextEncoder().encode(current.principalSubject)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    "v1",
    current.id,
    String(confirmationExpiresAt),
    principalHex,
    confirmationSignature,
  ].join(".");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key: string, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function findToolField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (field in value) return (value as Record<string, unknown>)[field];
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findToolField(child, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Logs a Salesforce or agent call that failed and was turned into a user-facing message, so
 * the error and where it was thrown reach Workers Logs. Only the error, never request content.
 */
function logUpstreamFailure(call: string, error: unknown, confirmationId?: string) {
  console.error(`[salesforce] ${call} failed`, {
    call,
    ...(confirmationId ? { confirmationId } : {}),
    error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : undefined,
  });
}

async function resolveToolResult(value: unknown) {
  if (value && typeof value === "object" && Symbol.asyncIterator in value) {
    let last: unknown;
    for await (const part of value as AsyncIterable<unknown>) last = part;
    return last;
  }
  return await Promise.resolve(value);
}

/** A scripted turn with no model call, used for the local fixture and policy responses. */
function scriptedTurnStream(
  texts: string[],
  { reasoning, abortSignal }: { reasoning?: string; abortSignal?: AbortSignal } = {},
): ReadableStream<UIMessageChunk> {
  const reasoningId = crypto.randomUUID();
  const textId = crypto.randomUUID();
  const chunks: UIMessageChunk[] = [
    { type: "start" },
    { type: "start-step" },
    ...(reasoning
      ? ([
          { type: "reasoning-start", id: reasoningId },
          { type: "reasoning-delta", id: reasoningId, delta: reasoning },
          { type: "reasoning-end", id: reasoningId },
        ] satisfies UIMessageChunk[])
      : []),
    { type: "text-start", id: textId },
    ...texts.map((delta) => ({ type: "text-delta" as const, id: textId, delta })),
    { type: "text-end", id: textId },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];
  return new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (!next || abortSignal?.aborted) controller.close();
      else controller.enqueue(next);
    },
  });
}

const POLICY_ROUTER = "Northstar policy router";
const TURN_HISTORY_LIMIT = 200;
type TurnPipeResult = Awaited<ReturnType<ReturnType<typeof createTurnTracer>["pipe"]>>;

function scriptedResponse(
  texts: string[],
  options: {
    model: string;
    route?: TurnRoute;
    reasoning?: string;
    abortSignal?: AbortSignal;
    onComplete?: (result: TurnPipeResult) => Promise<void>;
  },
) {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const tracer = createTurnTracer(writer, {
        model: options.model,
        toolCount: 0,
        timeoutSeconds: TURN_TIMEOUT.totalMs / 1000,
        userAbortSignal: options.abortSignal,
        ...(options.route ? { route: options.route } : {}),
      });
      const result = await tracer.pipe(
        scriptedTurnStream(texts, {
          reasoning: options.reasoning,
          abortSignal: options.abortSignal,
        }),
      );
      await options.onComplete?.(result);
    },
    onError: describeTurnError,
  });
  return createUIMessageStreamResponse({ stream });
}

export function writeBlockReason(
  controls: ReturnType<typeof parseOperationControls>,
  action: keyof typeof WRITE_TOOL_BY_ACTION,
) {
  if (!controls.writesEnabled)
    return "Salesforce writes are paused by an operator. Nothing was changed.";
  if ((controls.disabledTools as readonly string[]).includes(WRITE_TOOL_BY_ACTION[action]))
    return "This Salesforce write is turned off by an operator. Nothing was changed.";
  return null;
}

export class MarketingOrchestrator extends AIChatAgent<
  OrchestratorBindings,
  OrchestratorState,
  AgentProps
> {
  static options = { sendIdentityOnConnect: false };
  initialState = initialOrchestratorState;
  maxPersistedMessages = 100;
  waitForMcpConnections = false;
  private principalSubject = "unknown";

  /** Every model-called tool passes the agentic gateway as `tool:<name>`; a gateway fault fails closed. */
  private async authorizeTool(toolName: string) {
    try {
      return await authorizeTool(this.env, this.principalSubject, toolName, crypto.randomUUID());
    } catch (error) {
      console.error(
        "[gateway] tool authorization failed",
        error instanceof Error ? error.message : error,
      );
      return { decision: "deny" as const, reason: "The gateway could not be reached." };
    }
  }
  private imageGenerationInFlight = false;
  /** Set when the Campaign Creation agent drafted the brief in focus during this turn. */
  private agentBriefThisTurn = false;
  /** This chat's latest forecast, weather-demand map, and stock counts, for the inventory check. */
  private inventoryInputs: {
    forecast?: ForecastResult;
    demand?: DemandResult;
    inventory?: InventoryResult;
  } = {};
  /** Local development's Marketing Cloud records, created by the local agent stand-in. */
  private localMarketing = new Map<string, MarketingReadBack>();

  private async productionChatResponse(
    messages: UIMessage[],
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    const turnMessages = conversationWindow(messages);
    await this.mcp.waitForConnections({ timeout: 10_000 });
    const discoveredTools = this.mcp.getAITools();
    const controls = parseOperationControls(this.env);
    const memory = this.memoryBackend();
    // With memory off, the recall tools are withheld and reported as turned off by an operator.
    const disabledTools = memory
      ? controls.disabledTools
      : [...controls.disabledTools, ...MEMORY_TOOLS];
    // The campaign-context and knowledge-graph MCPs run in-process; both close when the turn ends.
    const context = await connectCampaignContextTools();
    const external = await connectExternalServiceTools();
    const graph = await connectKnowledgeGraphTools(
      memory ?? knowledgeGraphBackend(this.env),
      memory ? { workspaceId: this.state.workspaceId, now: () => new Date() } : undefined,
    );
    const tools = guardToolResults(
      {
        ...Object.fromEntries(
          Object.entries(discoveredTools).filter(([key]) =>
            PHASE_2_AUTONOMOUS_TOOLS.some(
              (name) => key.endsWith(`_${name}`) && !disabledTools.includes(name),
            ),
          ),
        ),
        ...Object.fromEntries(
          Object.entries(graph.tools).filter(
            ([key]) =>
              !(disabledTools as readonly string[]).includes(
                key.slice(KNOWLEDGE_GRAPH_TOOL_PREFIX.length),
              ),
          ),
        ),
        ...Object.fromEntries(
          Object.entries(context.tools).filter(
            ([key]) =>
              !(disabledTools as readonly string[]).includes(
                key.slice(CAMPAIGN_CONTEXT_TOOL_PREFIX.length),
              ),
          ),
        ),
        ...Object.fromEntries(
          Object.entries(external.tools).filter(
            ([key]) =>
              !(disabledTools as readonly string[]).includes(
                key.slice(EXTERNAL_SERVICES_TOOL_PREFIX.length),
              ),
          ),
        ),
      },
      (name, input, output) => this.ingestToolResult(name, input, output),
      (name) => this.authorizeTool(name),
    );
    // Refinements of a saved brief always name it, whatever the model wrote.
    const savedBrief = this.state.workingSet.focus?.saved;
    const briefTools = pinBriefToRefinement(
      tools,
      savedBrief?.objectType === "Brief" ? savedBrief.recordId : undefined,
    );
    const planContext = {
      hasFocus: Boolean(this.state.workingSet.focus),
      focusKind: this.state.workingSet.focus?.kind,
      briefSaved: this.state.workingSet.focus?.saved?.objectType === "Brief",
    };
    this.agentBriefThisTurn = false;
    const workersAI = createWorkersAI({
      binding: this.env.AI,
      gateway: { id: this.env.AI_GATEWAY_ID },
    });
    const workspace = workingSetPrompt(this.state.workingSet);
    const prompt = latestUserText(turnMessages);
    const focus = this.state.workingSet.focus;
    const pinnedTools = pinCampaignChannel(
      briefTools,
      requestedChannel(
        prompt,
        focus
          ? currentFocusVersion(focus).fields.find((field) => /^channel$/i.test(field.label))?.value
          : undefined,
      ),
    );
    const toolPlan = selectToolPlan(prompt, Object.keys(tools), planContext);
    const inventoryPlan = toolPlan?.some((name) => name.endsWith("map_weather_demand"));
    // A drafting or revision turn's answer is saved as the workspace focus when it completes.
    const drafting = draftIntent(prompt, planContext);
    // Readable plan for the trace and history, such as "a → b → c".
    const requiredTool = toolPlan?.join(" → ");
    const missingTool = missingPlannedTool(prompt, Object.keys(tools), planContext);
    if (missingTool) {
      await context.close();
      await external.close();
      await graph.close();
      return scriptedResponse(
        [
          (disabledTools as readonly string[]).includes(missingTool)
            ? `The ${missingTool.replaceAll("_", " ")} tool is turned off by an operator right now, so I did not call it or substitute demo data.`
            : "Salesforce is connected, but the governed tool catalog is not ready for this request. Check the Salesforce connection status and retry. I did not substitute demo data.",
        ],
        {
          model: POLICY_ROUTER,
          route: "catalog-unavailable",
          abortSignal,
          onComplete: (result) =>
            this.recordTurn(prompt, { model: POLICY_ROUTER, route: "catalog-unavailable" }, result),
        },
      );
    }
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const tracer = createTurnTracer(writer, {
          model: PROOF_DEFAULTS.orchestratorModel,
          toolCount: Object.keys(tools).length,
          requiredTool,
          route: "model",
          timeoutSeconds: TURN_TIMEOUT.totalMs / 1000,
          userAbortSignal: abortSignal,
          composeEmptyAnswer: () =>
            this.agentBriefThisTurn ? briefAnswer(this.state.workingSet.focus) : null,
        });
        try {
          const result = streamText({
            model: wrapLanguageModel({
              model: workersAI(PROOF_DEFAULTS.orchestratorModel),
              middleware: forcedToolCallMiddleware,
            }),
            system: orchestratorSystemPrompt(workspace, toolPlan),
            messages: await convertToModelMessages(turnMessages),
            tools: pinnedTools,
            // A revision with no agent to ask rewrites the draft in focus without tools; a brief's
            // revision goes back to the Marketing Cloud agent through its plan.
            prepareStep: ({ stepNumber }: { stepNumber: number }) => {
              if (drafting?.mode === "revise" && !toolPlan)
                return { toolChoice: "none" as const, activeTools: [] as string[] };
              const choice = stepToolChoice(toolPlan, stepNumber);
              // The inventory check is computed by code after the plan's tools run, so the answer
              // step sees the workspace as it is now, including exactly which items are low.
              return inventoryPlan && stepNumber >= (toolPlan?.length ?? 0)
                ? {
                    ...choice,
                    system: orchestratorSystemPrompt(
                      [
                        workingSetPrompt(this.state.workingSet),
                        inventoryRiskPrompt(this.state.inventoryRisk),
                      ].join(" "),
                      toolPlan,
                    ),
                  }
                : choice;
            },
            stopWhen: stepCountIs(MAX_TURN_STEPS),
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            timeout: TURN_TIMEOUT,
            abortSignal,
            onStepFinish: (step) => tracer.recordStepFinish(step),
            onError: ({ error }) => console.error("[orchestrator] turn stream error", error),
          });
          const turn = await tracer.pipe(
            result.toUIMessageStream({ sendReasoning: true, onError: describeTurnError }),
          );
          if (turn.outcome !== "completed")
            console.warn(`[orchestrator] turn ended with outcome ${turn.outcome}`);
          else if (this.agentBriefThisTurn) this.afterAgentBrief(prompt);
          else if (drafting) this.saveDraftFromAnswer(turn.answer, drafting, prompt);
          if (
            turn.outcome === "completed" &&
            toolPlan?.some((name) => name.endsWith("refine_campaign_preview"))
          )
            await this.refreshPreview();
          await this.recordTurn(
            prompt,
            { model: PROOF_DEFAULTS.orchestratorModel, route: "model", requiredTool },
            turn,
          );
        } catch (error) {
          console.error("[orchestrator] turn setup failed", error);
          const turn = await tracer.pipe(
            new ReadableStream({
              start(controller) {
                controller.error(error);
              },
            }),
          );
          await this.recordTurn(
            prompt,
            { model: PROOF_DEFAULTS.orchestratorModel, route: "model", requiredTool },
            turn,
          );
        } finally {
          await context.close();
          await external.close();
          await graph.close();
        }
      },
      onError: describeTurnError,
    });
    return createUIMessageStreamResponse({ stream });
  }

  /** Returns a 503 response when operators have paused writes or turned off this write tool. */
  private writeBlocked(action: keyof typeof WRITE_TOOL_BY_ACTION) {
    const message = writeBlockReason(parseOperationControls(this.env), action);
    return message ? json({ error: { code: "WRITES_DISABLED", message } }, { status: 503 }) : null;
  }

  /** Labels what a follow-up refers to, from the assistant reply before the latest message. */
  private previousReplyReferent() {
    const window = conversationWindow(this.messages);
    const previous = [...window].reverse().find((message) => message.role === "assistant");
    const text = previous?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    return text ? referentFromReply(text) : null;
  }

  private ensureTurnHistory() {
    this.sql`CREATE TABLE IF NOT EXISTS northstar_turn_history (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      record TEXT NOT NULL
    )`;
  }

  /** Stores one turn in this user's agent storage; history never blocks or fails the turn. */
  private async recordTurn(
    utterance: string,
    context: { model: string; route: TurnRecord["route"]; requiredTool?: string },
    result: TurnPipeResult,
  ) {
    try {
      const record = TurnRecordSchema.parse(buildTurnRecord({ utterance, ...context, result }));
      this.ensureTurnHistory();
      this.sql`INSERT INTO northstar_turn_history (id, started_at, record)
        VALUES (${record.id}, ${Date.parse(record.startedAt)}, ${JSON.stringify(record)})`;
      const cutoff = Date.now() - AUDIT_RETENTION_MS;
      this.sql`DELETE FROM northstar_turn_history WHERE started_at < ${cutoff}`;
      this.sql`DELETE FROM northstar_turn_history WHERE id NOT IN (
        SELECT id FROM northstar_turn_history ORDER BY started_at DESC LIMIT ${TURN_HISTORY_LIMIT}
      )`;
    } catch (error) {
      console.error("[orchestrator] could not record turn history", error);
    }
  }

  /** A compact, per-user export of confirmed-write audit rows and turn summaries in retention. */
  private async exportAudit() {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_MS).toISOString();
    let confirmations: Record<string, unknown>[] = [];
    try {
      const rows = await this.env.APP_DB.prepare(
        `SELECT confirmation_id, action, record_id, status, source_record_id, expires_at, created_at, updated_at
         FROM confirmation_audit
         WHERE workspace_id = ? AND principal_subject = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 500`,
      )
        .bind(this.state.workspaceId, this.principalSubject, cutoff)
        .all<Record<string, unknown>>();
      confirmations = rows.results;
    } catch {
      // The audit table is created on first write; no rows means no confirmed writes yet.
    }
    const exportedAt = new Date().toISOString();
    return new Response(
      JSON.stringify(
        {
          exportedAt,
          workspaceId: this.state.workspaceId,
          retentionHours: AUDIT_RETENTION_HOURS,
          operations: parseOperationControls(this.env),
          confirmations,
          memory: this.listMemoryAudit(),
          turns: this.listTurns().map((turn) => ({
            id: turn.id,
            startedAt: turn.startedAt,
            utterance: turn.utterance,
            route: turn.route,
            requiredTool: turn.requiredTool,
            outcome: turn.outcome,
            fallback: turn.fallback,
            durationMs: turn.durationMs,
            tools: turn.tools.map((tool) => ({ toolName: tool.toolName, status: tool.status })),
          })),
        },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="northstar-audit-${exportedAt.slice(0, 10)}.json"`,
        },
      },
    );
  }

  private listTurns(): TurnRecord[] {
    this.ensureTurnHistory();
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    return this.sql<{ record: string }>`SELECT record FROM northstar_turn_history
      WHERE started_at >= ${cutoff} ORDER BY started_at DESC LIMIT ${TURN_HISTORY_LIMIT}`.flatMap(
      (row) => {
        const parsed = TurnRecordSchema.safeParse(JSON.parse(row.record));
        return parsed.success ? [parsed.data] : [];
      },
    );
  }

  private async ensureImageDraftTable() {
    if ((this.env.ENVIRONMENT as string) !== "local") return;
    await this.env.APP_DB.exec(
      "CREATE TABLE IF NOT EXISTS campaign_image_drafts (image_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, principal_subject TEXT NOT NULL, campaign_id TEXT NOT NULL, channel TEXT NOT NULL, prompt_summary TEXT NOT NULL, prompt_version TEXT NOT NULL, model_id TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, content_hash TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE, lifecycle TEXT NOT NULL, seed INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)",
    );
  }

  private async generateCampaignImage(request: Request) {
    if (this.imageGenerationInFlight)
      return json(
        { error: { code: "CONFLICT", message: "An image is already being generated." } },
        { status: 409 },
      );
    const body = (await request.json()) as {
      campaignId?: unknown;
      channel?: unknown;
      concept?: unknown;
      seed?: unknown;
    };
    if (typeof body.campaignId !== "string" || !/^[a-zA-Z0-9]{15,18}$/.test(body.campaignId))
      return json(
        { error: { code: "VALIDATION_FAILED", message: "Choose a valid campaign." } },
        { status: 400 },
      );
    if (body.channel !== "email" && body.channel !== "web" && body.channel !== "social")
      return json(
        { error: { code: "VALIDATION_FAILED", message: "Choose a supported channel." } },
        { status: 400 },
      );
    const concept = validateImageConcept(body.concept);
    if (!concept)
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message:
              "Use a short creative concept without contact details, customer data, or embedded instructions.",
          },
        },
        { status: 400 },
      );
    const seed =
      typeof body.seed === "number" && Number.isInteger(body.seed) && body.seed >= 0
        ? body.seed
        : undefined;
    await this.ensureImageDraftTable();
    const usage = await this.env.APP_DB.prepare(
      "SELECT COUNT(*) AS count FROM campaign_image_drafts WHERE workspace_id = ?",
    )
      .bind(this.state.workspaceId)
      .first<{ count: number }>();
    if ((usage?.count ?? 0) >= 100)
      return json(
        { error: { code: "RATE_LIMITED", message: "The 100-image proof cap has been reached." } },
        { status: 429 },
      );

    this.imageGenerationInFlight = true;
    try {
      const prompt = [
        "Create a polished square campaign image for the fictional Northstar outdoor lifestyle brand.",
        `Channel: ${body.channel}.`,
        `Creative concept: ${concept}.`,
        "Editorial photography, warm natural light, inclusive but no identifiable real person, no text, no logo, no product claims.",
      ].join(" ");
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(1024));
      form.append("height", String(1024));
      if (seed !== undefined) form.append("seed", String(seed));
      const encoded = new Response(form);
      const result = await this.env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
        multipart: {
          body: encoded.body ?? undefined,
          contentType: encoded.headers.get("content-type") ?? undefined,
        },
      });
      if (!result.image)
        return json(
          {
            error: { code: "UPSTREAM_UNAVAILABLE", message: "The image model returned no image." },
          },
          { status: 502 },
        );
      const bytes = decodeBase64(result.image);
      const dimensions = pngDimensions(bytes);
      if (
        bytes.byteLength > IMAGE_MAX_BYTES ||
        dimensions?.width !== 1024 ||
        dimensions.height !== 1024
      )
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "The generated image failed media validation.",
            },
          },
          { status: 502 },
        );
      const id = crypto.randomUUID();
      const contentHash = await sha256Bytes(bytes);
      const ownerHash = (await sha256(this.principalSubject)).slice(0, 24);
      const r2Key = `drafts/${this.state.workspaceId}/${ownerHash}/${id}.png`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + IMAGE_RETENTION_MS).toISOString();
      await this.env.CAMPAIGN_ASSETS.put(r2Key, bytes, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: {
          campaignId: body.campaignId,
          lifecycle: "draft",
          expiresAt,
          promptVersion: IMAGE_PROMPT_VERSION,
        },
      });
      await this.env.APP_DB.prepare(
        `INSERT INTO campaign_image_drafts (
          image_id, workspace_id, principal_subject, campaign_id, channel, prompt_summary,
          prompt_version, model_id, width, height, content_hash, r2_key, lifecycle, seed,
          created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      )
        .bind(
          id,
          this.state.workspaceId,
          this.principalSubject,
          body.campaignId,
          body.channel,
          concept,
          IMAGE_PROMPT_VERSION,
          this.env.CAMPAIGN_IMAGE_MODEL,
          dimensions.width,
          dimensions.height,
          contentHash,
          r2Key,
          seed ?? null,
          now.toISOString(),
          expiresAt,
        )
        .run();
      return json(
        GeneratedCampaignImageSchema.parse({
          id,
          campaignId: body.campaignId,
          imageUrl: `/agent/images/${id}`,
          promptSummary: concept,
          channel: body.channel,
          width: dimensions.width,
          height: dimensions.height,
          contentHash,
          model: this.env.CAMPAIGN_IMAGE_MODEL,
          lifecycle: "draft",
          expiresAt,
        }),
        { status: 201 },
      );
    } finally {
      this.imageGenerationInFlight = false;
    }
  }

  private async findImageDraft(imageId: string) {
    if (!/^[a-f0-9-]{36}$/.test(imageId)) return null;
    await this.ensureImageDraftTable();
    const draft = await this.env.APP_DB.prepare(
      `SELECT image_id, campaign_id, channel, prompt_summary, content_hash, r2_key, lifecycle, expires_at
       FROM campaign_image_drafts
       WHERE image_id = ? AND workspace_id = ? AND principal_subject = ?`,
    )
      .bind(imageId, this.state.workspaceId, this.principalSubject)
      .first<{
        image_id: string;
        campaign_id: string;
        channel: string;
        prompt_summary: string;
        content_hash: string;
        r2_key: string;
        lifecycle: string;
        expires_at: string;
      }>();
    return draft && Date.parse(draft.expires_at) > Date.now() ? draft : null;
  }

  /** Loads the confirmed draft from R2 and re-verifies it against the hash bound into the confirmation. */
  private async loadConfirmedImage(
    confirmation: ReturnType<typeof ConfirmationSchema.parse>,
  ): Promise<
    { imageBase64: string; contentHash: string; title: string; altText: string } | { error: string }
  > {
    const draft = confirmation.imageId ? await this.findImageDraft(confirmation.imageId) : null;
    if (
      draft?.lifecycle !== "draft" ||
      draft.campaign_id !== confirmation.recordId ||
      draft.content_hash !== confirmation.contentHash
    )
      return { error: "The confirmed image draft is no longer available. Generate it again." };
    const object = await this.env.CAMPAIGN_ASSETS.get(draft.r2_key);
    if (!object) return { error: "The confirmed image draft is no longer available." };
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength > ATTACH_MAX_BYTES)
      return { error: "The image is larger than the Salesforce attachment limit." };
    if ((await sha256Bytes(bytes)) !== confirmation.contentHash)
      return { error: "The stored image no longer matches the confirmed content hash." };
    return {
      imageBase64: encodeBase64(bytes),
      contentHash: draft.content_hash,
      title: `Northstar ${draft.channel} campaign image`,
      altText: `Generated campaign image: ${draft.prompt_summary}`,
    };
  }

  /** Lists this user's unexpired variants for a campaign, newest first, for review and selection. */
  private async listImageDrafts(campaignId: string | null) {
    if (!campaignId || !/^[a-zA-Z0-9]{15,18}$/.test(campaignId)) return [];
    await this.ensureImageDraftTable();
    const rows = await this.env.APP_DB.prepare(
      `SELECT image_id, campaign_id, channel, prompt_summary, model_id, width, height, content_hash,
         lifecycle, expires_at
       FROM campaign_image_drafts
       WHERE workspace_id = ? AND principal_subject = ? AND campaign_id = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 24`,
    )
      .bind(this.state.workspaceId, this.principalSubject, campaignId, new Date().toISOString())
      .all<{
        image_id: string;
        campaign_id: string;
        channel: string;
        prompt_summary: string;
        model_id: string;
        width: number;
        height: number;
        content_hash: string;
        lifecycle: string;
        expires_at: string;
      }>();
    return rows.results.flatMap((row) => {
      const parsed = GeneratedCampaignImageSchema.safeParse({
        id: row.image_id,
        campaignId: row.campaign_id,
        imageUrl: `/agent/images/${row.image_id}`,
        promptSummary: row.prompt_summary,
        channel: row.channel,
        width: row.width,
        height: row.height,
        contentHash: row.content_hash,
        model: row.model_id,
        lifecycle: row.lifecycle,
        expiresAt: row.expires_at,
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  private async rejectImageDraft(imageId: string) {
    const draft = await this.findImageDraft(imageId);
    if (draft?.lifecycle !== "draft")
      return json(
        {
          error: {
            code: "CONFLICT",
            message: "Only an unexpired, unattached draft can be rejected.",
          },
        },
        { status: 409 },
      );
    if (this.state.pendingConfirmation?.imageId === imageId)
      return json(
        {
          error: {
            code: "CONFLICT",
            message: "Cancel the pending attachment before rejecting it.",
          },
        },
        { status: 409 },
      );
    await this.env.APP_DB.prepare(
      "UPDATE campaign_image_drafts SET lifecycle = 'rejected' WHERE image_id = ? AND workspace_id = ?",
    )
      .bind(imageId, this.state.workspaceId)
      .run();
    return json({ id: imageId, lifecycle: "rejected" });
  }

  private async markImageAttached(imageId: string) {
    await this.env.APP_DB.prepare(
      "UPDATE campaign_image_drafts SET lifecycle = 'attached' WHERE image_id = ? AND workspace_id = ?",
    )
      .bind(imageId, this.state.workspaceId)
      .run();
  }

  private async serveCampaignImage(imageId: string) {
    await this.ensureImageDraftTable();
    const image = await this.env.APP_DB.prepare(
      `SELECT r2_key, expires_at FROM campaign_image_drafts
       WHERE image_id = ? AND workspace_id = ? AND principal_subject = ?`,
    )
      .bind(imageId, this.state.workspaceId, this.principalSubject)
      .first<{ r2_key: string; expires_at: string }>();
    if (!image || Date.parse(image.expires_at) <= Date.now())
      return json(
        { error: { code: "NOT_FOUND", message: "Image draft not found." } },
        { status: 404 },
      );
    const object = await this.env.CAMPAIGN_ASSETS.get(image.r2_key);
    if (!object)
      return json(
        { error: { code: "NOT_FOUND", message: "Image draft not found." } },
        { status: 404 },
      );
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "image/png",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }

  override async onStart(props?: AgentProps) {
    await super.onStart(props);
    if (props?.principalSubject) this.principalSubject = props.principalSubject;
    // State saved before the working set existed carries static tiles; start it fresh instead.
    const saved = this.state as OrchestratorState & { tiles?: unknown };
    if (!saved.workingSet || "tiles" in saved) {
      const { tiles: _tiles, ...rest } = saved;
      this.setState({ ...rest, workingSet: emptyWorkingSet(), pendingConfirmation: null });
    }
    if (!Array.isArray(this.state.suggestions)) this.setState({ ...this.state, suggestions: [] });
    // Working sets saved before the focus existed have no focus field.
    else if (saved.workingSet.focus === undefined)
      this.setState({ ...saved, workingSet: { ...saved.workingSet, focus: null } });
  }

  /**
   * Prepares a write for human confirmation: validates it, plans record writes from the focus,
   * checks the user's Salesforce permissions, and binds everything into one pending confirmation.
   * The HTTP route, the chat's policy router, and the model's proposal tool all come through here.
   */
  /**
   * Prepares a confirmation and publishes its progress as it goes (the plan, Salesforce's
   * permission check, the one-time confirmation), so the person sees the work while it runs.
   */
  private async prepareConfirmation(body: {
    action?: unknown;
    recordId?: unknown;
    summary?: unknown;
    imageId?: unknown;
  }): Promise<Response> {
    const action = PROOF_DEFAULTS.allowedWrites.find((write) => write === body.action);
    if (!action) return this.buildConfirmation(body);
    this.beginPrepareProgress(action);
    let response: Response;
    try {
      response = await this.buildConfirmation(body);
    } catch (error) {
      this.finishProgress(false, error instanceof Error ? error.message : "Preparing failed.");
      throw error;
    }
    const result = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: { message?: string } } | null;
    this.finishProgress(response.ok, result?.error?.message);
    return response;
  }

  private async buildConfirmation(body: {
    action?: unknown;
    recordId?: unknown;
    summary?: unknown;
    imageId?: unknown;
  }): Promise<Response> {
    const action = body.action;
    if (action === "create-inventory-case") return this.prepareInventoryCase();
    const marketingAction =
      action === "save-marketing-brief" || action === "create-marketing-campaign";
    if (
      !marketingAction &&
      ((action !== "create-review-task" && action !== "attach-generated-image") ||
        typeof body.recordId !== "string" ||
        !/^[a-zA-Z0-9]{15,18}$/.test(body.recordId))
    )
      return json(
        { error: { code: "VALIDATION_FAILED", message: "The confirmation request is invalid." } },
        { status: 400 },
      );
    const preflightBlocked = this.writeBlocked(action as Confirmation["action"]);
    if (preflightBlocked) return preflightBlocked;
    // Marketing Cloud writes are planned from the focus draft; the server authors every value
    // the Campaign Creation agent is asked to save.
    const plan =
      marketingAction && this.state.workingSet.focus
        ? planMarketingWrite(this.state.workingSet.focus)
        : null;
    if (marketingAction && (!plan || plan.action !== action))
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: this.state.workingSet.focus?.saved?.campaign
              ? "This draft's campaign already exists in Marketing Cloud."
              : "Draft a campaign brief in the chat first; the Marketing Cloud agent saves the workspace draft.",
          },
        },
        { status: 400 },
      );
    const recordId = plan ? plan.recordId : (body.recordId as string);
    // Other writes act on the campaign this chat has open, never on a record it hasn't seen.
    if (!plan && openCampaign(this.state.workingSet)?.recordId !== recordId)
      return json(
        {
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: "Open this campaign in the chat first, then confirm the action.",
          },
        },
        { status: 409 },
      );
    // Salesforce decides whether this user may write; the card shows each check it ran.
    this.stepProgress("permissions");
    const permissionCheck = await this.checkWriteAccess(action as Confirmation["action"], recordId);
    if (!permissionCheck.permissions)
      return json(
        {
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message:
              permissionCheck.failure === "catalog-incomplete"
                ? "Salesforce is connected, but its governed tool catalog is incomplete: the permission check is not available. An administrator must refresh the active Salesforce MCP server and synchronize the Cloudflare portal. Nothing was prepared."
                : "Salesforce could not complete the permission check, so nothing was prepared. Reconnect Salesforce and retry; if the problem continues, ask an administrator to verify the permission tool response.",
          },
        },
        { status: 503 },
      );
    const permissions = permissionCheck.permissions;
    if (!permissions.allowed)
      return json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: `Your Salesforce permissions don't allow this: ${permissions.checks
              .filter((check) => !check.passed)
              .map((check) => `${check.label} (${check.detail})`)
              .join("; ")}`,
          },
          permissions,
        },
        { status: 403 },
      );
    this.notePermissions(permissions);
    this.stepProgress("confirm");
    let summary = plan?.summary ?? (typeof body.summary === "string" ? body.summary.trim() : "");
    let image: { imageId: string; contentHash: string } | undefined;
    if (action === "attach-generated-image") {
      const draft =
        typeof body.imageId === "string" ? await this.findImageDraft(body.imageId) : null;
      if (!draft || draft.campaign_id !== recordId || draft.lifecycle !== "draft")
        return json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Choose an unexpired draft image generated for this campaign.",
            },
          },
          { status: 400 },
        );
      image = { imageId: draft.image_id, contentHash: draft.content_hash };
      // The summary is server-authored so the confirmation card states exactly what is attached.
      summary =
        `Attach the selected ${draft.channel} image draft to the campaign as a Salesforce file. Concept: ${draft.prompt_summary}`.slice(
          0,
          500,
        );
    }
    // Brief saves and review requests act on the focus draft when there is one; the server
    // writes the summary from the focus so the card states exactly what will be written.
    const focus = this.state.workingSet.focus;
    let focusRef: Confirmation["focus"];
    if (focus && (plan || action === "create-review-task")) {
      const current = currentFocusVersion(focus);
      focusRef = { id: focus.id, version: current.version, title: current.title };
      if (!plan)
        summary =
          `Review "${current.title}" (version ${current.version}) with current campaign context, readiness findings, a due date, and a human review checklist.`.slice(
            0,
            500,
          );
    }
    if (!summary)
      return json(
        { error: { code: "VALIDATION_FAILED", message: "The confirmation request is invalid." } },
        { status: 400 },
      );
    const id = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const requestHash = await sha256(
      JSON.stringify({
        action,
        recordId,
        summary,
        principal: this.principalSubject,
        ...(image ?? {}),
        ...(focusRef ? { focus: focusRef } : {}),
        ...(plan ? { write: plan.write } : {}),
      }),
    );
    const confirmation = ConfirmationSchema.parse({
      id,
      action,
      recordId,
      principalSubject: this.principalSubject,
      requestHash,
      idempotencyKey,
      summary,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "pending",
      ...(image ?? {}),
      ...(focusRef ? { focus: focusRef } : {}),
      ...(plan ? { write: plan.write } : {}),
      permissions,
    });
    await this.recordConfirmationAudit(confirmation, "pending");
    this.setState({
      ...this.state,
      pendingConfirmation: confirmation,
      // The confirmation card replaces the action card that led to it.
      suggestions: (this.state.suggestions ?? []).filter(
        (item) =>
          item.action !==
          (confirmation.action === "create-review-task" ? "create-review-task" : "save-focus"),
      ),
    });
    return json(confirmation, { status: 201 });
  }

  /**
   * Runs a confirmed write and publishes its progress as it goes, so the person who confirmed it
   * sees each step (checks, the Salesforce call, the read-back) while it runs, not only the end.
   */
  private async runConfirmedWrite(current: Confirmation): Promise<Response> {
    this.beginProgress(current);
    let response: Response;
    try {
      // Briefs and campaigns are created by the Marketing Cloud Campaign Creation agent.
      response = current.write
        ? await this.executeMarketingWrite(current)
        : current.action === "create-inventory-case"
          ? await this.executeInventoryCase(current)
          : await this.executeApexWrite(current);
    } catch (error) {
      this.finishProgress(false, error instanceof Error ? error.message : "The write failed.");
      throw error;
    }
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: { message?: string } } | null;
    this.finishProgress(response.ok, body?.error?.message);
    // A failed Marketing Cloud write spent its confirmation, so offer the save again.
    if (!response.ok && current.write) this.suggestFocusSave();
    return response;
  }

  /** The steps preparing a confirmation goes through, in order, for its live progress. */
  private preparePlan(action: Confirmation["action"]): Array<{ id: string; label: string }> {
    const plan =
      action === "save-marketing-brief" || action === "create-marketing-campaign"
        ? "Planning the save from the workspace draft"
        : action === "create-inventory-case"
          ? "Writing the case from the inventory check"
          : "Checking the campaign open in this chat";
    return [
      { id: "plan", label: plan },
      {
        id: "permissions",
        label: "Salesforce checks your permissions as you (NorthstarCheckWriteAccess)",
      },
      { id: "confirm", label: "Binding exactly what will be written to a one-time confirmation" },
    ];
  }

  /** Starts a confirmation's live progress; nothing is written while it's prepared. */
  private beginPrepareProgress(action: Confirmation["action"]) {
    const now = new Date().toISOString();
    this.setState({
      ...this.state,
      writeProgress: {
        phase: "prepare",
        action,
        title: `Preparing to ${CONFIRMATION_TITLES[action]}`,
        startedAt: now,
        steps: this.preparePlan(action).map((step, index) => ({
          ...step,
          status: index === 0 ? ("active" as const) : ("pending" as const),
          ...(index === 0 ? { startedAt: now } : {}),
        })),
      },
    });
  }

  /** Adds what Salesforce's permission check found to the prepare progress. */
  private notePermissions(permissions: PermissionReport) {
    this.noteProgress(
      "permissions",
      `${permissions.checks.filter((check) => check.passed).length} of ${permissions.checks.length} checks passed${permissions.source === "salesforce" ? ` as ${permissions.user}` : " (local fixture)"}.`,
    );
  }

  /** The steps a confirmed write goes through, in order, for its live progress. */
  private progressPlan(current: Confirmation): Array<{ id: string; label: string }> {
    const agent = SALESFORCE_AGENTS[CAMPAIGN_AGENT].label;
    const signed = (apex: string, does: string, record: string) => [
      { id: "confirm", label: "Checked your confirmation: same user, unexpired, used once" },
      { id: "sign", label: "Signing the confirmation for Salesforce (HMAC)" },
      { id: "call", label: `Salesforce runs ${apex} as you: ${does}` },
      { id: "readback", label: `Reading back the ${record} from Salesforce` },
      { id: "remember", label: "Recording the decision in long-term memory" },
    ];
    if (current.write?.kind === "brief")
      return [
        { id: "confirm", label: "Checked your confirmation: same user, unexpired, used once" },
        { id: "lookup", label: "Checking Marketing Cloud for an earlier attempt at this save" },
        {
          id: "call",
          label: `${agent} agent: Save Campaign Brief, then Draft a Campaign Preview`,
        },
        { id: "readback", label: "Reading back the Brief and its preview steps from Salesforce" },
        { id: "remember", label: "Recording the decision in long-term memory" },
      ];
    if (current.write?.kind === "campaign")
      return [
        { id: "confirm", label: "Checked your confirmation: same user, unexpired, used once" },
        { id: "lookup", label: "Checking whether the brief already has a campaign" },
        { id: "call", label: `${agent} agent: Create Campaign, then Save Campaign` },
        { id: "readback", label: "Reading back the Campaign and its flow from Salesforce" },
        { id: "remember", label: "Recording the decision in long-term memory" },
      ];
    if (current.action === "create-inventory-case")
      return signed(
        "NorthstarCreateInventoryCase",
        `verifies the signature and the case contents, then opens the Case for ${current.inventoryCase?.manager.name ?? "the store manager"}`,
        "Case",
      );
    if (current.action === "attach-generated-image")
      return signed(
        "NorthstarAttachCampaignImage",
        "verifies the signature and the image hash, then attaches the file",
        "file and its campaign link",
      );
    return signed(
      "NorthstarCreateCampaignReviewRequest",
      "verifies the signature, then creates the review Task",
      "Task",
    );
  }

  /** Starts a confirmed write's live progress; the confirmation checks already passed. */
  private beginProgress(current: Confirmation) {
    const now = new Date().toISOString();
    this.setState({
      ...this.state,
      writeProgress: {
        phase: "execute",
        confirmationId: current.id,
        action: current.action,
        title: ACTIVITY_LABELS[current.action],
        startedAt: now,
        steps: this.progressPlan(current).map((step) => ({
          ...step,
          status: step.id === "confirm" ? ("done" as const) : ("pending" as const),
          ...(step.id === "confirm" ? { startedAt: now, endedAt: now } : {}),
        })),
      },
    });
  }

  /**
   * Moves a write's progress to a step: earlier unfinished steps are done (or skipped, when
   * `skipTo` is set), and this one is active, with an optional detail.
   */
  private stepProgress(id: string, detail?: string, skipTo = false) {
    const progress = this.state.writeProgress;
    if (!progress || progress.finishedAt) return;
    const index = progress.steps.findIndex((step) => step.id === id);
    if (index < 0) return;
    const now = new Date().toISOString();
    const steps = progress.steps.map((step, position) => {
      if (position < index && (step.status === "active" || step.status === "pending"))
        return {
          ...step,
          status: skipTo && step.status === "pending" ? ("skipped" as const) : ("done" as const),
          endedAt: now,
        };
      if (position === index)
        return {
          ...step,
          status: "active" as const,
          startedAt: now,
          ...(detail ? { detail } : {}),
        };
      return step;
    });
    this.setState({ ...this.state, writeProgress: { ...progress, steps } });
  }

  /** Adds a detail to a step without moving the progress. */
  private noteProgress(id: string, detail: string) {
    const progress = this.state.writeProgress;
    if (!progress || progress.finishedAt) return;
    this.setState({
      ...this.state,
      writeProgress: {
        ...progress,
        steps: progress.steps.map((step) => (step.id === id ? { ...step, detail } : step)),
      },
    });
  }

  /** Ends a write's progress: every open step done, or the active step failed with why. */
  private finishProgress(ok: boolean, message?: string) {
    const progress = this.state.writeProgress;
    if (!progress || progress.finishedAt) return;
    if (!ok)
      console.warn(`[write] ${progress.phase} ${progress.action} failed`, {
        phase: progress.phase,
        action: progress.action,
        step:
          progress.steps.find((step) => step.status === "active")?.id ??
          progress.steps.find((step) => step.status === "pending")?.id,
        confirmationId: progress.confirmationId,
        message: message?.slice(0, 300),
        ms: Date.now() - Date.parse(progress.startedAt),
      });
    const now = new Date().toISOString();
    const failedAt = ok
      ? -1
      : Math.max(
          0,
          progress.steps.findIndex((step) => step.status === "active"),
          progress.steps.findIndex((step) => step.status === "pending"),
        );
    const steps = progress.steps.map((step, position) => {
      if (ok)
        return step.status === "active" || step.status === "pending"
          ? { ...step, status: "done" as const, endedAt: now }
          : step;
      if (position === failedAt)
        return {
          ...step,
          status: "failed" as const,
          endedAt: now,
          detail: message?.slice(0, 300) ?? "This step failed.",
        };
      return step.status === "active" ? { ...step, status: "done" as const, endedAt: now } : step;
    });
    this.setState({
      ...this.state,
      writeProgress: {
        ...progress,
        steps,
        finishedAt: now,
        outcome: ok ? "succeeded" : "failed",
      },
    });
  }

  /** A review task or image attachment: a signed confirmation run by Apex as the user. */
  private async executeApexWrite(current: Confirmation): Promise<Response> {
    if ((this.env.ENVIRONMENT as string) !== "local") {
      const signingKey = this.env.CONFIRMATION_SIGNING_KEY;
      if (!signingKey)
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "Signed confirmation execution is not configured.",
            },
          },
          { status: 503 },
        );
      await this.mcp.waitForConnections({ timeout: 5_000 });
      const tools = this.mcp.getAITools();
      const toolName = WRITE_TOOL_BY_ACTION[current.action];
      const entry = Object.entries(tools).find(([key]) => key.endsWith(`_${toolName}`));
      const tool = entry?.[1];
      if (!tool || !("execute" in tool) || typeof tool.execute !== "function")
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "The confirmed Salesforce write tool is unavailable. Reconnect and retry.",
            },
          },
          { status: 503 },
        );
      this.stepProgress("sign");
      const signedConfirmation = await signConfirmation(current, signingKey);
      const imagePayload =
        current.action === "attach-generated-image"
          ? await this.loadConfirmedImage(current)
          : undefined;
      if (imagePayload && "error" in imagePayload)
        return json({ error: { code: "CONFLICT", message: imagePayload.error } }, { status: 409 });
      this.stepProgress("call");
      let upstream: unknown;
      try {
        upstream = await resolveToolResult(
          tool.execute(
            {
              inputs: [
                {
                  campaignId: current.recordId,
                  ...(imagePayload ?? {}),
                  confirmationId: signedConfirmation,
                  requestHash: current.requestHash,
                  idempotencyKey: current.idempotencyKey,
                },
              ],
            },
            { toolCallId: current.id, messages: [], context: undefined },
          ),
        );
      } catch (error) {
        logUpstreamFailure(`${current.action} call`, error, current.id);
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message:
                "Salesforce rejected the confirmed write. The request was not recorded as executed; reconnect or ask an administrator to verify the confirmation configuration, then retry.",
            },
          },
          { status: 502 },
        );
      }
      this.stepProgress("readback");
      const campaignId = findToolField(upstream, "campaignId");
      const readBack = findToolField(upstream, "readBack");
      const sourceRecordId =
        current.action === "create-review-task"
          ? findToolField(upstream, "taskId")
          : current.action === "attach-generated-image"
            ? findToolField(upstream, "contentDocumentId")
            : campaignId;
      const imageDetails =
        current.action === "attach-generated-image"
          ? {
              contentVersionId: findToolField(upstream, "contentVersionId"),
              title: findToolField(upstream, "title"),
              contentSize: findToolField(upstream, "contentSize"),
              contentHash: findToolField(upstream, "contentHash"),
            }
          : {};
      const taskDetails =
        current.action === "create-review-task"
          ? {
              subject: findToolField(upstream, "subject"),
              priority: findToolField(upstream, "priority"),
              dueDate: findToolField(upstream, "dueDate"),
              description: findToolField(upstream, "description"),
            }
          : {};
      if (
        typeof sourceRecordId !== "string" ||
        campaignId !== current.recordId ||
        readBack !== true ||
        (current.action === "create-review-task" &&
          (typeof taskDetails.subject !== "string" ||
            typeof taskDetails.priority !== "string" ||
            typeof taskDetails.dueDate !== "string" ||
            typeof taskDetails.description !== "string")) ||
        (current.action === "attach-generated-image" &&
          (typeof imageDetails.contentVersionId !== "string" ||
            typeof imageDetails.title !== "string" ||
            typeof imageDetails.contentSize !== "number" ||
            imageDetails.contentHash !== current.contentHash))
      )
        return json(
          {
            error: {
              code: "CONFLICT",
              message: "Salesforce did not return the required authoritative read-back.",
            },
          },
          { status: 409 },
        );
      const executed = { ...current, status: "executed" as const };
      await this.recordConfirmationAudit(current, "executed", sourceRecordId);
      if (current.imageId) await this.markImageAttached(current.imageId);
      this.setState({
        ...this.state,
        pendingConfirmation: null,
        workingSet: this.withCreatedRecord(
          current.action,
          sourceRecordId,
          typeof taskDetails.subject === "string"
            ? taskDetails.subject
            : typeof imageDetails.title === "string"
              ? imageDetails.title
              : undefined,
        ),
        activity: [
          {
            id: `${current.action}-${sourceRecordId}`,
            label: ACTIVITY_LABELS[current.action],
            detail: `Salesforce read-back · ${sourceRecordId}`,
            occurredAt: "Now",
            status: "complete",
          },
          ...this.state.activity,
        ],
      });
      await this.rememberConfirmedWrite(
        current,
        {
          system: "salesforce",
          objectType:
            current.action === "create-review-task"
              ? "Task"
              : current.action === "attach-generated-image"
                ? "ContentDocument"
                : "Campaign",
          recordId: sourceRecordId,
          title:
            typeof taskDetails.subject === "string"
              ? taskDetails.subject
              : typeof imageDetails.title === "string"
                ? imageDetails.title
                : ACTIVITY_LABELS[current.action],
        },
        {
          outcome: `${ACTIVITY_LABELS[current.action]} (${sourceRecordId}), confirmed and read back from Salesforce.`,
          note:
            typeof taskDetails.dueDate === "string"
              ? `Due ${taskDetails.dueDate}.`
              : current.summary,
          campaignId: typeof campaignId === "string" ? campaignId : undefined,
        },
      );
      return json({
        confirmation: executed,
        result: {
          source: "salesforce",
          recordId: sourceRecordId,
          campaignId,
          status: findToolField(upstream, "status"),
          ...taskDetails,
          ...imageDetails,
          idempotencyKey: current.idempotencyKey,
          readBack: true,
        },
      });
    }
    this.noteProgress("sign", "Local development has no Salesforce; a fixture stands in.");
    this.stepProgress("readback", "Local fixture read-back", true);
    const executed = { ...current, status: "executed" as const };
    // The local fixture still verifies the confirmed image bytes so the flow is exercised end to end.
    const fixtureImage =
      current.action === "attach-generated-image"
        ? await this.loadConfirmedImage(current)
        : undefined;
    if (fixtureImage && "error" in fixtureImage)
      return json({ error: { code: "CONFLICT", message: fixtureImage.error } }, { status: 409 });
    const fixtureRecordId =
      current.action === "create-review-task"
        ? "00T000000000001"
        : current.action === "attach-generated-image"
          ? "069000000000001"
          : current.recordId;
    await this.recordConfirmationAudit(current, "executed", fixtureRecordId);
    if (current.imageId) await this.markImageAttached(current.imageId);
    this.setState({
      ...this.state,
      pendingConfirmation: null,
      workingSet: this.withCreatedRecord(
        current.action,
        fixtureRecordId,
        current.action === "create-review-task"
          ? "Review campaign readiness: VERO Phase 1 Launch"
          : fixtureImage?.title,
      ),
      activity: [
        {
          id: `${current.action}-${current.id}`,
          label: ACTIVITY_LABELS[current.action],
          detail: `Local fixture read-back · ${current.recordId}`,
          occurredAt: "Now",
          status: "complete",
        },
        ...this.state.activity,
      ],
    });
    await this.rememberConfirmedWrite(
      current,
      {
        system: "salesforce",
        objectType:
          current.action === "create-review-task"
            ? "Task"
            : current.action === "attach-generated-image"
              ? "ContentDocument"
              : "Campaign",
        recordId: fixtureRecordId,
        title:
          current.action === "create-review-task"
            ? "Review campaign readiness: VERO Phase 1 Launch"
            : (fixtureImage?.title ?? ACTIVITY_LABELS[current.action]),
      },
      {
        outcome: `${ACTIVITY_LABELS[current.action]} (${fixtureRecordId}), confirmed and read back from the local fixture.`,
        note: current.summary,
        campaignId: current.recordId,
      },
    );
    return json({
      confirmation: executed,
      result: {
        source: "local-fixture",
        recordId: fixtureRecordId,
        campaignId: current.recordId,
        status: "Open",
        ...(current.action === "create-review-task"
          ? {
              subject: "Review campaign readiness: VERO Phase 1 Launch",
              priority: "High",
              dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
              description:
                "Campaign context, readiness findings, and a human review checklist were recorded in Salesforce.",
            }
          : {}),
        ...(fixtureImage
          ? {
              contentVersionId: "068000000000001",
              title: fixtureImage.title,
              contentSize: Math.floor((fixtureImage.imageBase64.length * 3) / 4),
              contentHash: fixtureImage.contentHash,
            }
          : {}),
        idempotencyKey: current.idempotencyKey,
        readBack: true,
      },
    });
  }

  /**
   * Prepares a case for the store manager from this chat's inventory check. The server writes
   * the case contents from the computed low-stock list, and the request hash is the SHA-256 of
   * exactly those contents, so Salesforce can verify it received what the user confirmed.
   */
  private async prepareInventoryCase(): Promise<Response> {
    const blocked = this.writeBlocked("create-inventory-case");
    if (blocked) return blocked;
    const risk = this.state.inventoryRisk;
    if (!risk?.lowItems.length)
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message:
              "Run an inventory check in the chat first; a case is opened only for items the check found low.",
          },
        },
        { status: 400 },
      );
    this.stepProgress("permissions");
    const permissionCheck = await this.checkWriteAccess("create-inventory-case", "new");
    if (!permissionCheck.permissions)
      return json(
        {
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message:
              permissionCheck.failure === "catalog-incomplete"
                ? "Salesforce is connected, but its governed tool catalog is incomplete: the permission check is not available. Nothing was prepared."
                : "Salesforce could not complete the permission check, so nothing was prepared. Reconnect Salesforce and retry.",
          },
        },
        { status: 503 },
      );
    const permissions = permissionCheck.permissions;
    if (!permissions.allowed)
      return json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: `Your Salesforce permissions don't allow this: ${permissions.checks
              .filter((check) => !check.passed)
              .map((check) => `${check.label} (${check.detail})`)
              .join("; ")}`,
          },
          permissions,
        },
        { status: 403 },
      );
    this.notePermissions(permissions);
    this.stepProgress("confirm");
    const detailsJson = inventoryCaseDetails(risk);
    const count = risk.lowItems.length;
    const confirmation = ConfirmationSchema.parse({
      id: crypto.randomUUID(),
      action: "create-inventory-case",
      recordId: `location:${risk.locationId}`,
      principalSubject: this.principalSubject,
      requestHash: await sha256(detailsJson),
      idempotencyKey: crypto.randomUUID(),
      summary:
        `Open a Salesforce case for ${risk.manager.name}, the ${risk.city} store manager: ${count} item${count === 1 ? "" : "s"} won't cover the ${risk.window.days}-day forecast (${risk.conditions.join(", ")}). Nothing is ordered.`.slice(
          0,
          500,
        ),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "pending",
      permissions,
      inventoryCase: {
        locationId: risk.locationId,
        city: risk.city,
        manager: risk.manager,
        conditions: risk.conditions,
        items: risk.lowItems,
        detailsJson,
      },
    });
    await this.recordConfirmationAudit(confirmation, "pending");
    this.setState({
      ...this.state,
      pendingConfirmation: confirmation,
      suggestions: (this.state.suggestions ?? []).filter(
        (item) => item.action !== "create-inventory-case",
      ),
    });
    return json(confirmation, { status: 201 });
  }

  /**
   * Opens the confirmed case: Apex verifies the signed confirmation and that the contents hash to
   * the confirmed request hash, finds the store manager's contact, creates the Case as the user,
   * and reads it back. Local development uses a fixture read-back.
   */
  private async executeInventoryCase(current: Confirmation): Promise<Response> {
    const details = current.inventoryCase;
    if (!details)
      return json(
        { error: { code: "CONFLICT", message: "The confirmation has no case contents." } },
        { status: 409 },
      );
    const subject = `Low stock before forecast weather: Coastline Kitchen ${details.city}`;
    let result: {
      source: "salesforce" | "local-fixture";
      caseId: string;
      caseNumber: string;
      subject: string;
      priority: string;
      status: string;
      contactName: string;
    };
    if ((this.env.ENVIRONMENT as string) === "local") {
      this.noteProgress("sign", "Local development has no Salesforce; a fixture stands in.");
      this.stepProgress("readback", "Local fixture read-back", true);
      result = {
        source: "local-fixture",
        caseId: "500000000000001",
        caseNumber: "00001001",
        subject,
        priority: "High",
        status: "New",
        contactName: details.manager.name,
      };
    } else {
      const signingKey = this.env.CONFIRMATION_SIGNING_KEY;
      if (!signingKey)
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "Signed confirmation execution is not configured.",
            },
          },
          { status: 503 },
        );
      await this.mcp.waitForConnections({ timeout: 5_000 });
      const tool = this.salesforceTool(WRITE_TOOL_BY_ACTION[current.action]);
      if (!tool)
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message:
                "The Salesforce case tool isn't in the catalog. An administrator must enable create_inventory_case on the portal's Salesforce server. Nothing was created.",
            },
          },
          { status: 503 },
        );
      this.stepProgress("sign");
      const signedCase = await signConfirmation(current, signingKey);
      this.stepProgress("call");
      let upstream: unknown;
      try {
        upstream = await resolveToolResult(
          tool.execute(
            {
              inputs: [
                {
                  locationKey: current.recordId,
                  caseDetailsJson: details.detailsJson,
                  confirmationId: signedCase,
                  requestHash: current.requestHash,
                  idempotencyKey: current.idempotencyKey,
                },
              ],
            },
            { toolCallId: current.id, messages: [], context: undefined },
          ),
        );
      } catch (error) {
        logUpstreamFailure(`${current.action} call`, error, current.id);
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message:
                "Salesforce rejected the confirmed case. It was not recorded as created; reconnect and retry.",
            },
          },
          { status: 502 },
        );
      }
      this.stepProgress("readback");
      const field = (name: string) => findToolField(upstream, name);
      if (
        field("readBack") !== true ||
        typeof field("caseId") !== "string" ||
        typeof field("caseNumber") !== "string" ||
        field("locationKey") !== current.recordId
      )
        return json(
          {
            error: {
              code: "CONFLICT",
              message: "Salesforce did not return the required authoritative read-back.",
            },
          },
          { status: 409 },
        );
      result = {
        source: "salesforce",
        caseId: field("caseId") as string,
        caseNumber: field("caseNumber") as string,
        subject: String(field("subject") ?? subject),
        priority: String(field("priority") ?? ""),
        status: String(field("status") ?? ""),
        contactName: String(field("contactName") ?? details.manager.name),
      };
    }
    const executed = { ...current, status: "executed" as const };
    await this.recordConfirmationAudit(current, "executed", result.caseId);
    const title = `Case ${result.caseNumber}: ${result.subject}`;
    this.setState({
      ...this.state,
      pendingConfirmation: null,
      workingSet: addCreatedRecord(
        this.state.workingSet,
        { system: "salesforce", objectType: "Case", recordId: result.caseId, title },
        "create_inventory_case",
        new Date(),
      ),
      activity: [
        {
          id: `create-inventory-case-${result.caseId}`,
          label: ACTIVITY_LABELS["create-inventory-case"],
          detail: `${result.source === "salesforce" ? "Salesforce" : "Local fixture"} read-back · Case ${result.caseNumber} for ${result.contactName}`,
          occurredAt: "Now",
          status: "complete",
        },
        ...this.state.activity,
      ],
    });
    await this.rememberConfirmedWrite(
      current,
      { system: "salesforce", objectType: "Case", recordId: result.caseId, title },
      {
        outcome: `Case ${result.caseNumber} opened for ${result.contactName} (${details.city}), confirmed and read back.`,
        note: details.items
          .map(
            (item) =>
              `${item.name}: ${item.onHand} + ${item.onOrder} on order of ${item.projectedNeed} ${item.unit}`,
          )
          .join("; ")
          .slice(0, 400),
      },
    );
    return json({
      confirmation: executed,
      result: {
        source: result.source,
        recordId: result.caseId,
        caseNumber: result.caseNumber,
        subject: result.subject,
        priority: result.priority,
        status: result.status,
        contactName: result.contactName,
        idempotencyKey: current.idempotencyKey,
        readBack: true,
      },
    });
  }

  /**
   * Asks Salesforce, as the signed-in user, whether it would allow a write: permission set,
   * Marketing User, object and field access, and record access. Local development uses a
   * fixture report. Salesforce enforces the same rules again when the write runs.
   */
  private async checkWriteAccess(
    action: Confirmation["action"],
    recordId: string,
  ): Promise<{
    permissions?: PermissionReport;
    failure?: "catalog-incomplete" | "call-failed" | "invalid-response";
  }> {
    if ((this.env.ENVIRONMENT as string) === "local")
      return { permissions: fixturePermissionReport(action, new Date()) };
    await this.mcp.waitForConnections({ timeout: 5_000 });
    const entry = Object.entries(this.mcp.getAITools()).find(
      ([key]) => key === "check_write_access" || key.endsWith("_check_write_access"),
    );
    const tool = entry?.[1];
    if (!tool || !("execute" in tool) || typeof tool.execute !== "function")
      return { failure: "catalog-incomplete" };
    try {
      const output = await resolveToolResult(
        tool.execute(
          { inputs: [{ action, ...(recordId !== "new" ? { recordId } : {}) }] },
          { toolCallId: crypto.randomUUID(), messages: [], context: undefined },
        ),
      );
      const permissions = parsePermissionReport(output, new Date());
      if (!permissions)
        console.warn("[salesforce] check_write_access returned an unreadable report");
      return permissions ? { permissions } : { failure: "invalid-response" };
    } catch (error) {
      logUpstreamFailure(`check_write_access for ${action}`, error);
      return { failure: "call-failed" };
    }
  }

  /**
   * Runs a confirmed Marketing Cloud write by asking the Campaign Creation agent, through its
   * Hosted MCP tool, to run its standard actions; then reads the result back from Salesforce.
   *
   * The standard actions aren't idempotent, so the write is made safe to retry here: Salesforce
   * is checked first, and a brief or campaign an earlier attempt already created is linked rather
   * than created again. If the agent call fails, Salesforce is checked once more before giving
   * up, since a timeout can come after the agent saved. The confirmation is spent before the
   * agent is called, so a second click can't resend it.
   */
  private async executeMarketingWrite(current: Confirmation) {
    const write = current.write as MarketingWrite;
    this.setState({ ...this.state, pendingConfirmation: null });
    // Only a save this chat already sent (and never saw confirmed) can be linked to what's there;
    // a brief with the same name from another chat is someone else's work.
    this.stepProgress("lookup");
    const attempt = await this.marketingAttemptKey(write);
    const existing =
      write.kind === "campaign" || this.sentBefore(attempt)
        ? await this.existingMarketingRecords(write)
        : null;
    if (existing) {
      this.forgetAttempt(attempt);
      this.noteProgress(
        "lookup",
        write.kind === "brief"
          ? "Found the brief an earlier attempt saved; linking it instead of saving again."
          : "The brief already has its campaign; linking it instead of creating another.",
      );
      this.stepProgress("readback", undefined, true);
      return this.completeMarketingWrite(current, null, existing, "reused");
    }
    this.noteProgress("lookup", "Nothing saved yet; asking the agent.");
    let tool: ReturnType<MarketingOrchestrator["salesforceTool"]> = null;
    if ((this.env.ENVIRONMENT as string) !== "local") {
      await this.mcp.waitForConnections({ timeout: 5_000 });
      tool = this.salesforceTool(WRITE_TOOL_BY_ACTION[current.action]);
      if (!tool)
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message:
                "The Marketing Cloud Campaign Creation agent's tool isn't in the Salesforce catalog. Reconnect Salesforce and prepare the save again. Nothing was saved.",
            },
          },
          { status: 503 },
        );
    }
    // "confirmed" in the audit: sent to the agent, not yet verified in Salesforce.
    await this.recordConfirmationAudit(current, "confirmed");
    this.rememberAttempt(attempt);
    let reply: unknown;
    this.stepProgress(
      "call",
      tool
        ? "Sent through the Salesforce Hosted MCP server; the agent runs as you."
        : "Local stand-in for the agent.",
    );
    try {
      reply = await this.callMarketingAgent(current, write, tool);
    } catch (error) {
      logUpstreamFailure(`${current.action} agent call`, error, current.id);
      this.stepProgress(
        "readback",
        "The agent call didn't finish; checking Salesforce in case it saved.",
      );
      const saved = await this.existingMarketingRecords(write);
      if (saved) {
        this.forgetAttempt(attempt);
        return this.completeMarketingWrite(current, null, saved, "recovered");
      }
      return json(
        {
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: `The Marketing Cloud agent didn't finish (${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}), and Salesforce doesn't show the ${write.kind === "brief" ? "brief" : "campaign"} yet. It may still be saving: wait a minute, then prepare the save again. The workbench checks Marketing Cloud first and links what it finds instead of saving twice.`,
          },
        },
        { status: 502 },
      );
    }
    const done = await this.completeMarketingWrite(current, reply);
    if (done.ok) this.forgetAttempt(attempt);
    return done;
  }

  /** A stable key for one Marketing Cloud write: its action and exact content. */
  private async marketingAttemptKey(write: MarketingWrite) {
    return sha256(JSON.stringify(write));
  }

  private ensureAttempts() {
    this.sql`CREATE TABLE IF NOT EXISTS northstar_marketing_attempts (
      key TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    )`;
  }

  /** Notes that this exact write was sent to the agent, until Salesforce confirms it. */
  private rememberAttempt(key: string) {
    this.ensureAttempts();
    const now = Date.now();
    this.sql`INSERT OR REPLACE INTO northstar_marketing_attempts (key, at) VALUES (${key}, ${now})`;
    this.sql`DELETE FROM northstar_marketing_attempts WHERE at < ${now - AUDIT_RETENTION_MS}`;
  }

  /** Whether this exact write was sent to the agent before without being confirmed. */
  private sentBefore(key: string) {
    this.ensureAttempts();
    return (
      this.sql<{ key: string }>`SELECT key FROM northstar_marketing_attempts WHERE key = ${key}`
        .length > 0
    );
  }

  private forgetAttempt(key: string) {
    this.ensureAttempts();
    this.sql`DELETE FROM northstar_marketing_attempts WHERE key = ${key}`;
  }

  /** Asks the Campaign Creation agent to do a confirmed write; local development uses a stand-in. */
  private async callMarketingAgent(
    current: Confirmation,
    write: MarketingWrite,
    tool: ReturnType<MarketingOrchestrator["salesforceTool"]>,
  ): Promise<unknown> {
    if (!tool) return localAgentWrite(write, this.localMarketing);
    return resolveToolResult(
      tool.execute(await agentToolInput(tool, agentRequest(write)), {
        toolCallId: current.id,
        messages: [],
        context: undefined,
      }),
    );
  }

  /**
   * What an earlier attempt at this write already created in Marketing Cloud: the newest brief
   * with the same name and key message, or the campaign on the brief. Null when there's none.
   */
  private async existingMarketingRecords(write: MarketingWrite) {
    if (write.kind === "campaign") {
      const readBack = await this.readMarketingRecords({ briefId: write.briefId });
      return readBack?.campaign ? readBack : null;
    }
    const readBack = await this.readMarketingRecords({ briefName: write.brief.name });
    return readBack?.brief && sameBrief(readBack.brief, write.brief) ? readBack : null;
  }

  /**
   * Finishes a confirmed Marketing Cloud write: reads back from Salesforce what the Campaign
   * Creation agent says it created, and only then links the focus to the Brief (and Campaign and
   * flow) and adds them to the workspace. The agent's reply is never taken as proof.
   */
  private async completeMarketingWrite(
    current: Confirmation,
    reply: unknown,
    known?: MarketingReadBack,
    found?: "reused" | "recovered",
  ) {
    const write = current.write as MarketingWrite;
    const local = (this.env.ENVIRONMENT as string) === "local";
    this.stepProgress("readback");
    const agentReply = toolText(reply).slice(0, 4000);
    const ids = idsFromAgentReply(agentReply);
    const briefId = write.kind === "campaign" ? write.briefId : ids.briefId;
    const readBack =
      known ??
      (await this.readMarketingRecords(
        briefId ? { briefId } : { briefName: write.kind === "brief" ? write.brief.name : "" },
      ));
    const briefOk =
      readBack?.brief &&
      (write.kind === "campaign" ||
        readBack.brief.name.trim().toLowerCase() === write.brief.name.trim().toLowerCase());
    const campaignOk = write.kind === "brief" || Boolean(readBack?.campaign);
    if (!readBack || !briefOk || !campaignOk)
      return json(
        {
          error: {
            code: "CONFLICT",
            message: `The Marketing Cloud agent replied, but Salesforce doesn't show the ${write.kind === "brief" ? "saved brief" : "campaign"} it describes, so nothing is shown as saved. Agent reply: ${agentReply.slice(0, 240) || "(empty)"}`,
          },
        },
        { status: 409 },
      );
    const brief = readBack.brief as NonNullable<MarketingReadBack["brief"]>;
    const campaign = readBack.campaign;
    const recordId = write.kind === "campaign" && campaign ? campaign.id : brief.id;
    await this.recordConfirmationAudit(current, "executed", recordId);
    const executed = { ...current, status: "executed" as const };
    this.setState({
      ...this.state,
      pendingConfirmation: null,
      workingSet: applyMarketingWrite(this.state.workingSet, current, readBack, new Date()),
      activity: [
        {
          id: `${current.action}-${current.id}`,
          label: ACTIVITY_LABELS[current.action],
          detail: `${
            write.kind === "brief"
              ? `${SALESFORCE_AGENTS[CAMPAIGN_AGENT].label} agent · Brief ${brief.id} · ${readBack.steps.length}-step preview`
              : `${SALESFORCE_AGENTS[CAMPAIGN_AGENT].label} agent · Campaign ${campaign?.id}${campaign?.flow ? ` · ${campaign.flow.label}` : ""}`
          }${found ? ` · ${FOUND_NOTES[found]}` : ""}${local ? " (local fixture)" : ""}`,
          occurredAt: "Now",
          status: "complete",
        },
        ...this.state.activity,
      ],
    });
    // The next step is the campaign itself, so it's offered right away.
    if (write.kind === "brief") this.suggestFocusSave();
    await this.rememberConfirmedWrite(
      current,
      {
        system: "salesforce",
        objectType: write.kind === "brief" ? "Brief" : "Campaign",
        recordId,
        title: write.kind === "brief" ? brief.name : (campaign?.name ?? brief.name),
      },
      {
        outcome:
          write.kind === "brief"
            ? `The Marketing Cloud Campaign Creation agent saved the brief “${brief.name}” (${brief.id}) with a ${readBack.steps.length}-step campaign preview, read back from ${local ? "the local fixture" : "Salesforce"}.`
            : `The Marketing Cloud Campaign Creation agent created the campaign “${campaign?.name}” (${campaign?.id})${campaign?.flow ? ` and its flow “${campaign.flow.label}”` : ""} from the brief “${brief.name}”, read back from ${local ? "the local fixture" : "Salesforce"}.`,
        note: current.focus ? `From version ${current.focus.version} of the draft.` : "",
        campaignId: campaign?.id,
      },
    );
    return json({
      confirmation: executed,
      result: {
        source: local ? "local-fixture" : "salesforce",
        agent: { name: CAMPAIGN_AGENT, ...SALESFORCE_AGENTS[CAMPAIGN_AGENT] },
        actions: SALESFORCE_TOOL_DETAILS[WRITE_TOOL_BY_ACTION[current.action]]?.actions ?? [],
        agentReply,
        ...(found ? { found, note: FOUND_NOTES[found] } : {}),
        brief: { id: brief.id, name: brief.name },
        preview: readBack.steps,
        ...(campaign ? { campaign } : {}),
        recordId,
        readBack: true,
        idempotencyKey: current.idempotencyKey,
      },
    });
  }

  /**
   * Reads a Brief, its preview steps, and its Campaign and flow from Salesforce. Local
   * development reads the fixture records the local agent stand-in created.
   */
  private async readMarketingRecords(input: {
    briefId?: string;
    briefName?: string;
  }): Promise<MarketingReadBack | null> {
    if ((this.env.ENVIRONMENT as string) === "local") {
      const found = input.briefId
        ? this.localMarketing.get(input.briefId)
        : [...this.localMarketing.values()].find((item) => item.brief?.name === input.briefName);
      return found ?? { brief: null, steps: [], campaign: null };
    }
    const tool = this.salesforceTool("get_marketing_records");
    if (!tool) return null;
    try {
      const output = await resolveToolResult(
        tool.execute(
          { inputs: [input] },
          { toolCallId: crypto.randomUUID(), messages: [], context: undefined },
        ),
      );
      return parseMarketingReadBack(output);
    } catch (error) {
      logUpstreamFailure("get_marketing_records", error);
      return null;
    }
  }

  /** A Salesforce Hosted MCP tool by its catalog name, if the connection lists it. */
  private salesforceTool(name: string) {
    const entry = Object.entries(this.mcp.getAITools()).find(
      ([key]) => key === name || key.endsWith(`_${name}`),
    );
    const tool = entry?.[1];
    return tool && "execute" in tool && typeof tool.execute === "function"
      ? (tool as typeof tool & { execute: NonNullable<typeof tool.execute> })
      : null;
  }

  /**
   * Prepares the focus draft's Salesforce save for confirmation and describes the result in
   * plain language: what will be written, the permission checks, and that nothing is written yet.
   */
  private async proposeFocusSave(): Promise<string> {
    const focus = this.state.workingSet.focus;
    if (!focus)
      return "There's no draft in the workspace yet. Draft something first, then save it.";
    const plan = planMarketingWrite(focus);
    if (!plan)
      return "This draft's campaign already exists in Marketing Cloud. Open it from the Workspace to set its audience and activate its flow there.";
    const response = await this.prepareConfirmation({ action: plan.action });
    const body = (await response.json()) as Confirmation & {
      error?: { message?: string };
      permissions?: PermissionReport;
    };
    if (!response.ok)
      return `I couldn't prepare that save. ${body.error?.message ?? "Try again from the Workspace."} Nothing was saved in Marketing Cloud.`;
    const permissions = body.permissions;
    const checked = permissions
      ? `Salesforce checked your permissions${permissions.source === "salesforce" ? ` as ${permissions.user}` : " (local fixture)"}: ${permissions.checks.length} of ${permissions.checks.length} checks passed (${permissions.checks.map((check) => check.label).join(", ")}).`
      : "";
    return [
      `**Ready to confirm:** ${body.summary}`,
      checked,
      `When you confirm, the ${SALESFORCE_AGENTS[CAMPAIGN_AGENT].label} agent (${SALESFORCE_AGENTS[CAMPAIGN_AGENT].kind}) runs ${(SALESFORCE_TOOL_DETAILS[WRITE_TOOL_BY_ACTION[plan.action]]?.actions ?? []).map((item) => item.label.replace("Marketing Cloud: ", "")).join(" → ")}. Nothing is saved until you confirm the card.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** After the agent drafts a brief: offer to save it, or prepare the save if asked to. */
  private afterAgentBrief(prompt: string) {
    if (wantsSalesforceRecord(prompt) || /\bmarketing cloud\b/i.test(prompt))
      void this.proposeFocusSave().catch((error: unknown) =>
        console.error("[orchestrator] could not prepare the Marketing Cloud save", error),
      );
    else this.suggestFocusSave();
  }

  /** Reloads the saved brief's campaign preview from Salesforce after the agent refined it. */
  private async refreshPreview() {
    const briefId = this.state.workingSet.focus?.saved?.recordId;
    if (!briefId) return;
    const readBack = await this.readMarketingRecords({ briefId });
    if (readBack?.brief)
      this.setState({
        ...this.state,
        workingSet: withRefreshedPreview(this.state.workingSet, readBack),
      });
  }

  /**
   * Saves a completed drafting or revision turn's answer as the workspace focus. When the user
   * asked for the record in Salesforce, the save is then prepared for confirmation.
   */
  private saveDraftFromAnswer(answer: string, intent: DraftIntent, prompt: string) {
    const focus = this.state.workingSet.focus;
    const input = focusFromAnswer(answer, {
      kind: intent.kind,
      fallbackTitle: focus
        ? currentFocusVersion(focus).title
        : `${FOCUS_KIND_LABELS[intent.kind]} draft`,
      changeNote: intent.mode === "revise" ? prompt : "First draft",
    });
    if (!input) return;
    this.updateFocus(input);
    if (wantsSalesforceRecord(prompt))
      void this.proposeFocusSave().catch((error: unknown) =>
        console.error("[orchestrator] could not prepare the Salesforce save", error),
      );
    else this.suggestFocusSave();
  }

  /** Adds an action card to the chat, replacing any earlier card for the same action. */
  private suggest(input: Omit<SuggestedAction, "id" | "createdAt">) {
    const suggestion = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.setState({
      ...this.state,
      suggestions: [
        ...(this.state.suggestions ?? []).filter((existing) => existing.action !== input.action),
        suggestion,
      ],
    });
  }

  /** Suggests saving the draft in focus to Salesforce, as a new record or an update. */
  private suggestFocusSave() {
    const focus = this.state.workingSet.focus;
    if (!focus) return;
    const plan = planMarketingWrite(focus);
    if (!plan) return;
    this.suggest({
      action: "save-focus",
      title:
        plan.write.kind === "brief"
          ? `Save “${plan.write.brief.name}” as a Marketing Cloud brief?`
          : `Create the campaign for “${plan.write.briefName}” in Marketing Cloud?`,
      detail: plan.summary,
      cta: plan.write.kind === "brief" ? "Review and save brief" : "Review campaign",
    });
  }

  /**
   * Keeps the inventory check's three inputs and, once all three are in for the same location,
   * computes which weather-driven items won't cover the forecast. The result becomes a context
   * card and, when anything is low, an action card to open a case for the store manager. Code
   * decides what's low; the model only explains it.
   */
  private checkInventory(tool: string | null, output: unknown) {
    const data = toolPayload(output).data;
    if (!data || isToolFailure(output)) return;
    if (tool === "get_weather_forecast")
      this.inventoryInputs.forecast = data as unknown as ForecastResult;
    else if (tool === "map_weather_demand")
      this.inventoryInputs.demand = data as unknown as DemandResult;
    else if (tool === "get_location_inventory")
      this.inventoryInputs.inventory = data as unknown as InventoryResult;
    else return;
    const { forecast, demand, inventory } = this.inventoryInputs;
    const risk = assessInventoryRisk(forecast, demand, inventory);
    if (!risk) return;
    const at = new Date();
    this.setState({
      ...this.state,
      inventoryRisk: risk,
      workingSet: mergeIntoWorkingSet(
        this.state.workingSet,
        { cards: [inventoryRiskCard(risk, at)], records: [] },
        at,
      ),
      suggestions: (this.state.suggestions ?? []).filter(
        (existing) => existing.action !== "create-inventory-case",
      ),
    });
    if (risk.lowItems.length)
      this.suggest({
        action: "create-inventory-case",
        title: `Open a Salesforce case for ${risk.manager.name}, the ${risk.city} store manager?`,
        detail: `${risk.lowItems.length} item${risk.lowItems.length === 1 ? "" : "s"} won't cover the ${risk.window.days}-day forecast (${risk.conditions.join(", ")}): ${risk.lowItems
          .slice(0, 4)
          .map(
            (item) =>
              `${item.name} (${item.onHand + item.onOrder} of ${item.projectedNeed} ${item.unit})`,
          )
          .join("; ")}${risk.lowItems.length > 4 ? "; …" : ""}.`,
        cta: "Review case",
      });
  }

  /** The local inventory check: the plan's three tools with a fixed forecast, then the risk. */
  private async localInventoryCheck(prompt: string) {
    const location =
      (Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>).find((id) =>
        prompt.toLowerCase().includes(LOCATIONS[id].city.toLowerCase()),
      ) ?? "sacramento";
    const start = new Date();
    const date = (offset: number) =>
      new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const forecast = {
      source: "Open-Meteo (local fixture)",
      location,
      city: LOCATIONS[location].city,
      days: [
        {
          date: date(0),
          condition: "clear",
          demandCondition: "clear",
          highF: 84,
          lowF: 58,
          precipitationChance: 0,
        },
        {
          date: date(1),
          condition: "clear",
          demandCondition: "heat",
          highF: 95,
          lowF: 64,
          precipitationChance: 0,
        },
        {
          date: date(2),
          condition: "clear",
          demandCondition: "clear",
          highF: 86,
          lowF: 60,
          precipitationChance: 0,
        },
      ],
      demandConditions: ["clear", "heat"],
    };
    const mcp = (data: unknown) => ({
      structuredContent: data,
      content: [{ type: "text", text: JSON.stringify(data) }],
    });
    this.ingestToolResult("context_get_weather_forecast", { location, days: 3 }, mcp(forecast));
    const spec = KNOWLEDGE_GRAPH_TOOL_SPECS.find((entry) => entry.name === "map_weather_demand");
    const demandInput = { location, conditions: forecast.demandConditions };
    const demand = await spec?.run(knowledgeGraphBackend(this.env), demandInput as never);
    this.ingestToolResult("graph_map_weather_demand", demandInput, mcp(demand));
    this.ingestToolResult(
      "context_get_location_inventory",
      { location },
      // A fixed count date keeps the local check (and its tests) the same every day.
      mcp(locationInventory(location, LOCAL_FIXTURE_COUNT_DATE)),
    );
    const risk = this.state.inventoryRisk;
    if (!risk) return "The inventory check could not complete locally.";
    return [
      `**Inventory check for Coastline Kitchen ${risk.city}** (local fixture forecast: ${risk.conditions.join(", ")}).\n\n`,
      risk.lowItems.length
        ? `${risk.lowItems.length} item${risk.lowItems.length === 1 ? "" : "s"} won't cover the forecast:\n\n${risk.lowItems
            .map(
              (item) =>
                `- **${item.name}:** ${item.onHand} ${item.unit} on hand + ${item.onOrder} on order, ${item.projectedNeed} needed (${item.menuItems.join(", ")})`,
            )
            .join("\n")}\n\n`
        : "Every weather-driven item covers the forecast.\n\n",
      `Store manager: ${risk.manager.name}. ${risk.lowItems.length ? "Use the action card to open a Salesforce case for them; nothing is created until you confirm." : ""} Stock counts come from a randomized mock of the store inventory system.`,
    ].join("");
  }

  /** Accepting an action card prepares its confirmation, with the Salesforce permission check. */
  private async acceptSuggestion(id: string): Promise<Response> {
    const suggestion = (this.state.suggestions ?? []).find((item) => item.id === id);
    if (!suggestion)
      return json(
        { error: { code: "NOT_FOUND", message: "That suggestion is no longer available." } },
        { status: 404 },
      );
    if (suggestion.action === "create-inventory-case")
      return this.prepareConfirmation({ action: "create-inventory-case" });
    if (suggestion.action === "save-focus") {
      const focus = this.state.workingSet.focus;
      if (!focus)
        return json(
          { error: { code: "CONFLICT", message: "There is no draft to save." } },
          { status: 409 },
        );
      const plan = planMarketingWrite(focus);
      if (!plan)
        return json(
          {
            error: {
              code: "CONFLICT",
              message: "This draft's campaign already exists in Marketing Cloud.",
            },
          },
          { status: 409 },
        );
      return this.prepareConfirmation({ action: plan.action });
    }
    return this.prepareConfirmation({
      action: "create-review-task",
      recordId: openCampaign(this.state.workingSet)?.recordId,
      summary:
        "Create a campaign review task with current campaign context, readiness findings, a due date, and a human review checklist.",
    });
  }

  /** Saves a draft (or its revision) as the workspace focus. */
  private updateFocus(input: FocusInput) {
    const workingSet = applyFocusUpdate(this.state.workingSet, input, new Date());
    this.setState({ ...this.state, workingSet });
    return workingSet.focus as FocusItem;
  }

  /** The focus draft's title, which the policy reply names when there is one. */
  private focusReferent() {
    const focus = this.state.workingSet.focus;
    return focus ? currentFocusVersion(focus).title : null;
  }

  /** Adds what a tool returned to the chat's working set. */
  private ingestToolResult(toolName: string, input: unknown, output: unknown) {
    const next = ingestToolResult(this.state.workingSet, {
      toolName,
      input,
      output,
      at: new Date(),
    });
    if (next !== this.state.workingSet) this.setState({ ...this.state, workingSet: next });
    this.checkInventory(baseToolName(toolName), output);
    // The brief the Marketing Cloud agent drafted becomes the focus, field for field.
    if (baseToolName(toolName) === "draft_campaign_brief") {
      const focus = this.state.workingSet.focus;
      const brief = briefFocusFromAgent(
        toolText(output),
        focus?.kind === "brief"
          ? "Revised by the Campaign Creation agent"
          : "Drafted by the Campaign Creation agent",
      );
      if (brief) {
        this.updateFocus(brief);
        this.agentBriefThisTurn = true;
      }
    }
    // A readiness check on an open campaign is a natural moment to ask for a review.
    const campaign = openCampaign(next);
    if (baseToolName(toolName) === "check_campaign_readiness" && campaign)
      this.suggest({
        action: "create-review-task",
        title: `Request a review of ${campaign.title}?`,
        detail:
          "Creates a Salesforce review task with the campaign context, readiness findings, a due date, and a checklist, after Salesforce checks your permissions and you confirm.",
        cta: "Prepare review request",
      });
  }

  /** The working set with the record a confirmed write created. */
  private withCreatedRecord(action: Confirmation["action"], recordId: string, title?: string) {
    const objectType =
      action === "create-review-task"
        ? "Task"
        : action === "attach-generated-image"
          ? "ContentDocument"
          : "Campaign";
    return addCreatedRecord(
      this.state.workingSet,
      {
        system: "salesforce",
        objectType,
        recordId,
        title: title ?? `${ACTIVITY_LABELS[action]} ${recordId}`,
      },
      WRITE_TOOL_BY_ACTION[action],
      new Date(),
    );
  }

  /** A new chat starts with an empty workspace; a pending confirmation belongs to the old one. */
  private resetWorkingSet() {
    // Activity belongs to the chat too; the History view and audit export keep the full record.
    this.setState({
      ...this.state,
      workingSet: emptyWorkingSet(),
      pendingConfirmation: null,
      suggestions: [],
      activity: [],
      inventoryRisk: null,
      writeProgress: null,
    });
    this.inventoryInputs = {};
  }

  /**
   * The graph backend for long-term memory, or null when an operator turned memory off or the
   * graph can't be written. Memory is written only here, on server events; see ADR-007.
   */
  private memoryBackend(): GraphBackend | null {
    if (!parseOperationControls(this.env).memoryEnabled) return null;
    const backend = knowledgeGraphBackend(this.env);
    return backend.kind === "neo4j" && !backend.write ? null : backend;
  }

  private ensureMemoryAudit() {
    this.sql`CREATE TABLE IF NOT EXISTS northstar_memory_audit (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      action TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      detail TEXT NOT NULL
    )`;
  }

  /** Notes a remember, reopen, or forget in this user's agent storage, kept as long as the audit. */
  private auditMemory(
    action: "remember" | "decision" | "forget" | "reopen",
    memoryId: string,
    detail: string,
  ) {
    try {
      this.ensureMemoryAudit();
      const now = Date.now();
      this.sql`INSERT INTO northstar_memory_audit (id, at, action, memory_id, detail)
        VALUES (${crypto.randomUUID()}, ${now}, ${action}, ${memoryId}, ${detail.slice(0, 240)})`;
      this.sql`DELETE FROM northstar_memory_audit WHERE at < ${now - AUDIT_RETENTION_MS}`;
    } catch (error) {
      console.warn("[memory] audit row failed", error instanceof Error ? error.message : error);
    }
  }

  private listMemoryAudit() {
    this.ensureMemoryAudit();
    return this.sql<{ at: number; action: string; memory_id: string; detail: string }>`
      SELECT at, action, memory_id, detail FROM northstar_memory_audit
      WHERE at >= ${Date.now() - AUDIT_RETENTION_MS} ORDER BY at DESC LIMIT 200`.map((row) => ({
      at: new Date(row.at).toISOString(),
      action: row.action,
      memoryId: row.memory_id,
      detail: row.detail,
    }));
  }

  /** Remembers the draft in focus at its current version, on the user's request. */
  private async rememberFocus(): Promise<
    | { ok: true; id: string; created: boolean; title: string; version: number }
    | { ok: false; status: number; code: string; message: string }
  > {
    const backend = this.memoryBackend();
    if (!backend)
      return {
        ok: false,
        status: 503,
        code: "MEMORY_DISABLED",
        message: "Long-term memory is turned off by an operator. Nothing was remembered.",
      };
    const focus = this.state.workingSet.focus;
    if (!focus)
      return {
        ok: false,
        status: 409,
        code: "CONFLICT",
        message: "There's no draft in the workspace to remember yet.",
      };
    const draft = focusMemoryDraft(focus);
    const stamp = memoryStamp(this.state.workspaceId, await memoryActorHash(this.principalSubject));
    const result = await rememberDraft(backend, {
      ...stamp,
      source: "remembered",
      draft,
      // Only what the draft itself names: the campaign open in the chat may be unrelated.
      subjects: memorySubjects({ focus }),
    });
    if (result.created) this.auditMemory("remember", result.id, `${draft.title} v${draft.version}`);
    return { ok: true, ...result, title: draft.title, version: draft.version };
  }

  /**
   * Remembers a confirmed, read-back Salesforce write as a decision, with the draft version it
   * saved. Memory never blocks or fails the write it describes.
   */
  private async rememberConfirmedWrite(
    confirmation: Confirmation,
    record: MemoryRecordRef,
    detail: { outcome: string; note: string; campaignId?: string },
  ) {
    this.stepProgress("remember");
    const backend = this.memoryBackend();
    if (!backend) {
      this.noteProgress("remember", "Long-term memory is turned off; nothing was remembered.");
      return;
    }
    try {
      const actorHash = await memoryActorHash(this.principalSubject);
      const focus = this.state.workingSet.focus;
      const onFocus = Boolean(confirmation.write && focus && confirmation.focus?.id === focus.id);
      const subjects = memorySubjects({
        focus: onFocus ? focus : null,
        confirmation,
        campaignIds: [detail.campaignId],
      });
      if (onFocus && focus && confirmation.focus) {
        const saved = await rememberDraft(backend, {
          ...memoryStamp(this.state.workspaceId, actorHash),
          source: "saved-to-salesforce",
          draft: focusMemoryDraft(focus, confirmation.focus.version),
          subjects,
        });
        if (saved.created)
          this.auditMemory(
            "remember",
            saved.id,
            `${confirmation.focus.title} v${confirmation.focus.version}`,
          );
      }
      const kind =
        confirmation.action === "create-review-task"
          ? ("review" as const)
          : confirmation.action === "attach-generated-image"
            ? ("asset-attached" as const)
            : ("confirmed-write" as const);
      const decision = await recordDecision(backend, {
        ...memoryStamp(this.state.workspaceId, actorHash),
        decision: { kind, outcome: detail.outcome, note: detail.note },
        record,
        ...(onFocus && confirmation.focus
          ? { draftRef: { focusId: confirmation.focus.id, version: confirmation.focus.version } }
          : {}),
        subjects,
      });
      this.auditMemory("decision", decision.id, `${kind}: ${record.objectType} ${record.recordId}`);
    } catch (error) {
      console.warn(
        "[memory] could not remember the confirmed write",
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** The Memory tab's routes: list, remember the current draft, and forget one memory. */
  private async memoryRoute(request: Request, url: URL): Promise<Response | null> {
    if (url.pathname.endsWith("/memory") && request.method === "GET") {
      const backend = this.memoryBackend();
      if (!backend)
        return json({ enabled: false, retentionDays: MEMORY_RETENTION_DAYS, items: [] });
      try {
        return json({
          enabled: true,
          retentionDays: MEMORY_RETENTION_DAYS,
          items: await listMemory(backend, this.state.workspaceId, new Date()),
        });
      } catch (error) {
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: `Memory is unavailable: ${error instanceof Error ? error.message : "unknown error"}.`,
            },
          },
          { status: 502 },
        );
      }
    }
    if (url.pathname.endsWith("/memory/remember") && request.method === "POST") {
      const result = await this.rememberFocus();
      return result.ok
        ? json(result)
        : json(
            { error: { code: result.code, message: result.message } },
            { status: result.status },
          );
    }
    const reopen = url.pathname.match(/\/memory\/([a-f0-9-]{36})\/reopen$/);
    if (reopen?.[1] && request.method === "POST") return this.reopenMemory(reopen[1]);
    const forget = url.pathname.match(/\/memory\/([a-f0-9-]{36})$/);
    if (forget?.[1] && request.method === "DELETE") {
      const backend = this.memoryBackend();
      if (!backend)
        return json(
          { error: { code: "MEMORY_DISABLED", message: "Long-term memory is turned off." } },
          { status: 503 },
        );
      const deleted = await forgetMemory(backend, this.state.workspaceId, forget[1]);
      if (!deleted)
        return json(
          { error: { code: "NOT_FOUND", message: "That memory is not in this workspace." } },
          { status: 404 },
        );
      this.auditMemory("forget", forget[1], "Forgotten from the Memory tab");
      return json({ forgotten: forget[1] });
    }
    return null;
  }

  /**
   * Reopens a remembered draft or decision in the current chat: the draft becomes the focus and
   * its records join the working set as remembered. Only the user can do this, from the Memory tab.
   */
  private async reopenMemory(id: string): Promise<Response> {
    const backend = this.memoryBackend();
    if (!backend)
      return json(
        { error: { code: "MEMORY_DISABLED", message: "Long-term memory is turned off." } },
        { status: 503 },
      );
    const now = new Date();
    const items = await listMemory(backend, this.state.workspaceId, now);
    const item = items.find((entry) => entry.id === id);
    if (!item)
      return json(
        { error: { code: "NOT_FOUND", message: "That memory is not in this workspace." } },
        { status: 404 },
      );
    const draft = item.type === "Draft" ? item : items.find((entry) => entry.id === item.draft?.id);
    const workingSet = reopenFromMemory(this.state.workingSet, item, draft, now);
    this.setState({ ...this.state, workingSet });
    this.auditMemory("reopen", id, `Reopened “${item.title}” in the workspace`);
    return json({
      reopened: id,
      title: item.title,
      focus: Boolean(
        workingSet.focus && draft && workingSet.focus.id === (draft.focusId ?? draft.id),
      ),
      records: item.records.length + (draft && draft !== item ? draft.records.length : 0),
    });
  }

  private syncConnector() {
    const connector = connectorFromMcp(Boolean(this.env.SALESFORCE_MCP_URL), this.getMcpServers());
    this.setState({
      ...this.state,
      connector,
      sourcesConnected:
        (this.env.ENVIRONMENT as string) === "local" ? 3 : connector.state === "ready" ? 3 : 0,
    });
    return connector;
  }

  private async recordConfirmationAudit(
    confirmation: ReturnType<typeof ConfirmationSchema.parse>,
    status: "pending" | "confirmed" | "denied" | "expired" | "executed",
    sourceRecordId?: string,
  ) {
    if ((this.env.ENVIRONMENT as string) === "local")
      await this.env.APP_DB.exec(
        "CREATE TABLE IF NOT EXISTS confirmation_audit (confirmation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, principal_subject TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL, request_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, source_record_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      );
    const now = new Date().toISOString();
    await this.env.APP_DB.prepare(
      `INSERT INTO confirmation_audit (
        confirmation_id, workspace_id, principal_subject, action, record_id,
        request_hash, idempotency_key, status, source_record_id, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(confirmation_id) DO UPDATE SET
        status = excluded.status,
        source_record_id = excluded.source_record_id,
        updated_at = excluded.updated_at`,
    )
      .bind(
        confirmation.id,
        this.state.workspaceId,
        confirmation.principalSubject,
        confirmation.action,
        confirmation.recordId,
        confirmation.requestHash,
        confirmation.idempotencyKey,
        status,
        sourceRecordId ?? null,
        confirmation.expiresAt,
        now,
        now,
      )
      .run();
    // The audit keeps 24 hours; older rows go on every write, and hourly by the cron.
    await pruneConfirmationAudit(this.env.APP_DB);
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/diagnostics/chat") && request.method === "POST") {
      const body = (await request.json()) as { scenario?: unknown };
      if (body.scenario !== "campaign-summary")
        return json(
          { error: { code: "VALIDATION_FAILED", message: "Unknown diagnostic scenario." } },
          { status: 400 },
        );
      return this.productionChatResponse(
        [
          {
            id: crypto.randomUUID(),
            role: "user",
            parts: [
              {
                type: "text",
                text: "Summarize Salesforce Campaign 701jV000004GglIQAS using only live Salesforce evidence.",
              },
            ],
          },
        ],
        request.signal,
      );
    }
    if (
      url.pathname.endsWith("/diagnostics/salesforce-write-preflight") &&
      request.method === "POST"
    ) {
      const result = await this.checkWriteAccess("save-marketing-brief", "new");
      if (!result.permissions)
        return json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message:
                result.failure === "catalog-incomplete"
                  ? "The governed Salesforce catalog is incomplete."
                  : "The Salesforce permission check did not return a valid report.",
            },
          },
          { status: 503 },
        );
      return json({ permissions: result.permissions });
    }
    if (url.pathname.endsWith("/operations") && request.method === "GET")
      return json({
        ...parseOperationControls(this.env),
        knowledgeGraph: knowledgeGraphBackend(this.env).kind,
      });
    if (url.pathname.endsWith("/audit/export") && request.method === "GET")
      return this.exportAudit();
    const memoryResponse = await this.memoryRoute(request, url);
    if (memoryResponse) return memoryResponse;
    if (url.pathname.endsWith("/turns") && request.method === "GET")
      return json({ retentionHours: AUDIT_RETENTION_HOURS, turns: this.listTurns() });
    if (url.pathname.endsWith("/images/generate") && request.method === "POST")
      return this.generateCampaignImage(request);
    if (url.pathname.endsWith("/images") && request.method === "GET")
      return json({ images: await this.listImageDrafts(url.searchParams.get("campaignId")) });
    const rejectMatch = url.pathname.match(/\/images\/([a-f0-9-]{36})\/reject$/);
    if (rejectMatch && request.method === "POST") return this.rejectImageDraft(rejectMatch[1]);
    const imageMatch = url.pathname.match(/\/images\/([a-f0-9-]{36})$/);
    if (imageMatch && request.method === "GET") return this.serveCampaignImage(imageMatch[1]);
    if (url.pathname.endsWith("/salesforce/status")) return json(this.syncConnector());
    if (url.pathname.endsWith("/salesforce/connect") && request.method === "POST") {
      const endpoint = this.env.SALESFORCE_MCP_URL;
      if (!endpoint)
        return json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "Salesforce MCP is not configured." } },
          { status: 503 },
        );
      const existing = this.getMcpServers().servers.salesforce;
      if (existing) await this.removeMcpServer("salesforce");
      const result = await this.addMcpServer("Salesforce marketing", endpoint, {
        id: "salesforce",
        callbackHost: url.origin,
        callbackPath: "/agent/salesforce/callback",
        transport: { type: "streamable-http" },
      });
      const connector = this.syncConnector();
      return json({
        ...connector,
        ...(result.state === "authenticating" ? { authUrl: result.authUrl } : {}),
      });
    }
    if (url.pathname.endsWith("/salesforce/disconnect") && request.method === "POST") {
      if (this.getMcpServers().servers.salesforce) await this.removeMcpServer("salesforce");
      return json(this.syncConnector());
    }
    if (url.pathname.endsWith("/working-set/reset") && request.method === "POST") {
      this.resetWorkingSet();
      return json(this.state.workingSet);
    }
    const suggestionMatch = url.pathname.match(/\/suggestions\/([a-f0-9-]{36})\/(accept|dismiss)$/);
    if (suggestionMatch && request.method === "POST") {
      const [, id, verb] = suggestionMatch;
      if (verb === "accept") return this.acceptSuggestion(id as string);
      this.setState({
        ...this.state,
        suggestions: (this.state.suggestions ?? []).filter((item) => item.id !== id),
      });
      return json({ suggestions: this.state.suggestions });
    }
    if (url.pathname.endsWith("/confirmations") && request.method === "POST")
      return this.prepareConfirmation((await request.json()) as Record<string, unknown>);
    if (url.pathname.endsWith("/confirmations/deny") && request.method === "POST") {
      const current = this.state.pendingConfirmation;
      if (!current)
        return json(
          { error: { code: "CONFLICT", message: "No confirmation is pending." } },
          { status: 409 },
        );
      const denied = { ...current, status: "denied" as const };
      await this.recordConfirmationAudit(current, "denied");
      this.setState({ ...this.state, pendingConfirmation: null });
      return json(denied);
    }
    if (url.pathname.endsWith("/confirmations/execute") && request.method === "POST") {
      const current = this.state.pendingConfirmation;
      if (!current)
        return json(
          { error: { code: "CONFLICT", message: "No confirmation is pending." } },
          { status: 409 },
        );
      const executeBlocked = this.writeBlocked(current.action);
      if (executeBlocked) return executeBlocked;
      if (current.principalSubject !== this.principalSubject)
        return json(
          {
            error: { code: "PERMISSION_DENIED", message: "Only the requesting user can confirm." },
          },
          { status: 403 },
        );
      if (Date.parse(current.expiresAt) <= Date.now()) {
        await this.recordConfirmationAudit(current, "expired");
        this.setState({ ...this.state, pendingConfirmation: null });
        return json(
          { error: { code: "CONFIRMATION_REQUIRED", message: "The confirmation expired." } },
          { status: 409 },
        );
      }
      return this.runConfirmedWrite(current);
    }
    const response = await super.onRequest(request);
    return (
      response ??
      json({ error: { code: "NOT_FOUND", message: "Agent endpoint not found." } }, { status: 404 })
    );
  }

  async onChatMessage(
    _onFinish: GenerateTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    if (options?.abortSignal?.aborted) return new Response(null, { status: 499 });
    const abortSignal = options?.abortSignal;
    // Writes and forbidden actions never reach the model, so it cannot claim they happened.
    const utterance = latestUserText(evidenceTurnMessages(this.messages));
    // "Remember this draft" stores the focus in long-term memory; the server writes it, not the model.
    if (isRememberRequest(utterance)) {
      const result = await this.rememberFocus().catch((error: unknown) => ({
        ok: false as const,
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        message: `Memory is unavailable (${error instanceof Error ? error.message : "unknown error"}).`,
      }));
      const text = result.ok
        ? `${result.created ? "Remembered" : "Already remembered"} **${result.title}** (version ${result.version}) for this workspace for ${MEMORY_RETENTION_DAYS} days. Ask about it in a new chat, or forget it from History → Memory. Nothing was saved to Salesforce.`
        : `${result.message} Nothing was saved to Salesforce.`;
      return scriptedResponse([text], {
        model: POLICY_ROUTER,
        route: "memory",
        abortSignal,
        onComplete: (turn) =>
          this.recordTurn(utterance, { model: POLICY_ROUTER, route: "memory" }, turn),
      });
    }
    const policyIntent = classifyPolicyIntent(utterance);
    // A request to save or create the draft prepares that write for confirmation, with the
    // Salesforce permission check, instead of only pointing at a button.
    // A review request prepares the review task for the open campaign, in the chat.
    if (
      policyIntent === "confirmation-required" &&
      /\breview\b/i.test(utterance) &&
      openCampaign(this.state.workingSet)
    ) {
      const response = await this.prepareConfirmation({
        action: "create-review-task",
        recordId: openCampaign(this.state.workingSet)?.recordId,
        summary:
          "Create a campaign review task with current campaign context, readiness findings, a due date, and a human review checklist.",
      });
      const body = (await response.json()) as Confirmation & { error?: { message?: string } };
      const text = response.ok
        ? `**Ready to confirm:** ${body.summary}\n\nSalesforce checked your permissions; review the confirmation card and confirm it yourself. Nothing is created until you do.`
        : `I couldn't prepare the review request. ${body.error?.message ?? ""} Nothing was created.`;
      return scriptedResponse([text], {
        model: POLICY_ROUTER,
        route: policyIntent,
        abortSignal,
        onComplete: (result) =>
          this.recordTurn(utterance, { model: POLICY_ROUTER, route: policyIntent }, result),
      });
    }
    if (policyIntent === "confirmation-required" && this.state.workingSet.focus) {
      const text = await this.proposeFocusSave();
      return scriptedResponse([text], {
        model: POLICY_ROUTER,
        route: policyIntent,
        abortSignal,
        onComplete: (result) =>
          this.recordTurn(utterance, { model: POLICY_ROUTER, route: policyIntent }, result),
      });
    }
    if (policyIntent)
      return scriptedResponse(
        [policyResponse(policyIntent, this.focusReferent() ?? this.previousReplyReferent())],
        {
          model: POLICY_ROUTER,
          route: policyIntent,
          abortSignal,
          onComplete: (result) =>
            this.recordTurn(utterance, { model: POLICY_ROUTER, route: policyIntent }, result),
        },
      );
    // The first message of a conversation starts a fresh working set, whatever cleared the chat.
    if (!this.messages.some((message) => message.role === "assistant")) this.resetWorkingSet();
    if ((this.env.ENVIRONMENT as string) !== "local")
      return this.productionChatResponse(this.messages, abortSignal);
    // Local development has no model: a recall question reads memory through the same tool.
    const localMemory = this.memoryBackend();
    if (localMemory && isRecallRequest(utterance)) {
      const text = await localRecallAnswer(localMemory, utterance, {
        workspaceId: this.state.workspaceId,
        now: () => new Date(),
      });
      return scriptedResponse([text], {
        model: "local-fixture",
        reasoning: "Local development has no model: answer from the workspace's long-term memory.",
        abortSignal,
        onComplete: (result) =>
          this.recordTurn(utterance, { model: "local-fixture", route: "local-fixture" }, result),
      });
    }
    // Local development has no model: an inventory check runs the same three tools in process,
    // with a fixed forecast, and the workbench computes the same inventory risk.
    if (isInventoryCheck(utterance)) {
      const text = await this.localInventoryCheck(utterance);
      return scriptedResponse([text], {
        model: "local-fixture",
        reasoning:
          "Local development has no model or network: a fixed forecast, the graph's demand map, and the store inventory mock go through the same ingestion and risk check.",
        abortSignal,
        onComplete: (result) =>
          this.recordTurn(utterance, { model: "local-fixture", route: "local-fixture" }, result),
      });
    }
    // Local development has no Salesforce: fixture results go through the same ingestion path
    // as real tool results, so the workspace behaves the same way.
    for (const [toolName, result] of LOCAL_FIXTURE_RESULTS)
      this.ingestToolResult(toolName, { message: "Review the sample campaign" }, result);
    // A change to a saved brief refines its campaign preview, as the agent's refinement does.
    const savedBrief = this.state.workingSet.focus?.saved;
    if (savedBrief?.objectType === "Brief" && isRevisionRequest(utterance)) {
      const stored = this.localMarketing.get(savedBrief.recordId);
      if (stored?.steps[0])
        stored.steps[0] = { ...stored.steps[0], subject: "Rain outside? Warm soup is waiting." };
      await this.refreshPreview();
      return scriptedResponse(
        [
          "The **Northstar Campaign Creation** agent refined the campaign preview (local fixture): the first email's subject is now “Rain outside? Warm soup is waiting.”\n\n",
          "The workspace reloaded the preview from the brief. Nothing was sent or activated.",
        ],
        {
          model: "local-fixture",
          reasoning:
            "Local development has no Salesforce: the local Campaign Creation agent stand-in refines the saved preview.",
          abortSignal,
          onComplete: (result) =>
            this.recordTurn(utterance, { model: "local-fixture", route: "local-fixture" }, result),
        },
      );
    }
    const localDraft = localFixtureDraft(utterance, this.state.workingSet.focus);
    if (localDraft) {
      const focus = this.updateFocus(localDraft);
      this.suggestFocusSave();
      const current = currentFocusVersion(focus);
      return scriptedResponse(
        [
          `The **Northstar Campaign Creation** agent (Marketing Cloud Next) drafted **${current.title}** (version ${current.version}) with its Draft a Campaign Brief action:\n\n`,
          ...current.fields.map((field) => `- **${field.label}:** ${field.value}\n`),
          "\nIt's a draft brief: nothing is saved in Marketing Cloud until you confirm.",
        ],
        {
          model: "local-fixture",
          reasoning:
            "Local development has no model: the local Campaign Creation agent stand-in drafts the fixture brief as the workspace focus.",
          abortSignal,
          onComplete: (result) =>
            this.recordTurn(utterance, { model: "local-fixture", route: "local-fixture" }, result),
        },
      );
    }
    return scriptedResponse(
      [
        "I reviewed the fictional Northstar sample campaign. The **strongest signal is stable engagement**.\n\n",
        "**Readiness blockers**\n\n- Accessibility copy\n- Commercial-consent scope\n\n",
        "I have not changed, published, or sent anything.",
      ],
      {
        model: "local-fixture",
        reasoning:
          "Local development has no Salesforce connection: answer from the fictional local fixture, whose results also fill the workspace.",
        abortSignal,
        onComplete: (result) =>
          this.recordTurn(utterance, { model: "local-fixture", route: "local-fixture" }, result),
      },
    );
  }
}
