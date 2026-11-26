import {
  applyChunkToParts,
  isReplayChunk,
  MessageType,
  parseProtocolMessage,
  reconcileMessages,
  resolveToolMergeId,
  sanitizeMessage,
  toolApprovalUpdate,
  toolResultUpdate,
} from "agents/chat";
import type { GenerateTextOnFinishCallback, ToolSet, UIMessage } from "ai";
import { McpClientManager, type McpServersState, normalizeServerId } from "./mcp";
import type { AgentStorage, SqlValue } from "./storage";
import { TokenVault } from "./token-vault";

/**
 * A Node stand-in for `AIChatAgent` from `@cloudflare/ai-chat@0.12.0`. The GCP bundle aliases that
 * module here, so `MarketingOrchestrator` runs unchanged: same members, same persistence semantics,
 * and the same `cf_agent_*` WebSocket frames the `agents/react` and `@cloudflare/ai-chat/react`
 * clients speak. The Durable Object pieces (storage, hibernation, input gates) come from the host.
 */

/** One client socket, as the agent sees it. */
export interface Connection {
  readonly id: string;
  readonly uri?: string;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

/** The slice of `DurableObjectState` the orchestrator touches, plus the instance's storage. */
export interface AgentContext {
  readonly id: { readonly name: string; toString(): string };
  readonly storage: AgentStorage;
  waitUntil(promise: Promise<unknown>): void;
}

/** A client-declared tool schema, as `useAgentChat` sends it. */
export interface ClientToolSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}

export type OnChatMessageOptions = {
  requestId: string;
  abortSignal?: AbortSignal;
  clientTools?: ClientToolSchema[];
  body?: Record<string, unknown>;
  continuation?: boolean;
};

export type ChatResponseResult = {
  message: UIMessage;
  requestId: string;
  continuation: boolean;
  status: "completed" | "error" | "aborted";
  error?: string;
};

export type SaveMessagesResult = {
  requestId: string;
  status: "completed" | "error" | "aborted" | "skipped";
  error?: string;
};

export interface AgentStaticOptions {
  sendIdentityOnConnect?: boolean;
}

export interface AddMcpServerOptions {
  id?: string;
  callbackHost?: string;
  callbackPath?: string;
  agentsPrefix?: string;
  transport?: { type?: "streamable-http" | "auto" | "sse"; headers?: Record<string, string> };
}

export type AddMcpServerResult =
  | { id: string; state: "authenticating"; authUrl: string }
  | { id: string; state: "ready" };

type Frame = { type?: unknown; state?: unknown; id?: unknown; method?: unknown };
type StreamResult = { status: "completed" | "error" | "aborted"; error?: string };
type ChunkData = Parameters<typeof applyChunkToParts>[1];
type Part = UIMessage["parts"][number];

/** Marks "no initialState declared", so `state` stays undefined like the real Agent. */
const DEFAULT_STATE = Symbol("agent.defaultState");
const STATE_KEY = "cf_agent_state";
const RESPONSE = MessageType.CF_AGENT_USE_CHAT_RESPONSE;
const PROVIDER_TOOL_MAX_STRING_LENGTH = 500;

function kebab(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function randomId(length = 21) {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Serializes chat turns the way `agents`' TurnQueue does; a reset turns queued work stale. */
class TurnQueue {
  generation = 0;
  activeRequestId: string | null = null;
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(
    requestId: string,
    epoch: number,
    fn: () => Promise<T>,
  ): Promise<{ stale: true } | { stale: false; value: T }> {
    const turn = async () => {
      if (epoch !== this.generation) return { stale: true as const };
      this.activeRequestId = requestId;
      try {
        return { stale: false as const, value: await fn() };
      } finally {
        this.activeRequestId = null;
      }
    };
    const next = this.#tail.then(turn, turn);
    this.#tail = next.catch(() => {});
    return next;
  }

  reset() {
    this.generation += 1;
  }
}

interface BufferedStream {
  requestId: string;
  chunks: string[];
}

export class AIChatAgent<
  Env = unknown,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  static options: AgentStaticOptions = {};

  readonly ctx: AgentContext;
  readonly env: Env;
  readonly mcp: McpClientManager;
  /** Seed for `state` on first read; a subclass field overrides it. */
  initialState: State = DEFAULT_STATE as State;
  /** The persisted transcript, oldest first. */
  messages: UIMessage[] = [];
  /** Oldest messages beyond this count are deleted on every persist. */
  maxPersistedMessages: number | undefined = undefined;
  /** Whether a chat turn waits for in-flight MCP connections before `onChatMessage`. */
  waitForMcpConnections: boolean | { timeout: number } = { timeout: 10_000 };
  /** The body of the latest chat request, handed to `onChatMessage` as `options.body`. */
  _lastBody: Record<string, unknown> | undefined = undefined;
  _lastClientTools: ClientToolSchema[] | undefined = undefined;
  /** The assistant message being streamed right now, or null between turns. */
  _streamingMessage: UIMessage | null = null;

  readonly #connections = new Map<string, Connection>();
  readonly #turns = new TurnQueue();
  readonly #aborts = new Map<string, AbortController>();
  /** Connections told a stream is resuming; they get live chunks only after they ACK the replay. */
  readonly #pendingResume = new Set<string>();
  /** Accepted turns whose stream has not started, and reconnecting sockets waiting on them. */
  readonly #preStream = {
    accepted: new Set<string>(),
    latest: null as string | null,
    parked: new Map<string, Connection>(),
  };
  #activeStream: BufferedStream | null = null;
  #lastStream: BufferedStream | null = null;
  #stateCache: { value: State } | null = null;
  #pendingResults: ChatResponseResult[] = [];
  #started = false;

  constructor(ctx: AgentContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
    const vars = env as Record<string, unknown>;
    const clientId = typeof vars.SALESFORCE_CLIENT_ID === "string" ? vars.SALESFORCE_CLIENT_ID : "";
    const clientSecret =
      typeof vars.SALESFORCE_CLIENT_SECRET === "string" ? vars.SALESFORCE_CLIENT_SECRET : "";
    this.mcp = new McpClientManager({
      storage: ctx.storage,
      vault: new TokenVault({
        TOKEN_ENCRYPTION_KEY:
          typeof vars.TOKEN_ENCRYPTION_KEY === "string" ? vars.TOKEN_ENCRYPTION_KEY : undefined,
        ENVIRONMENT: typeof vars.ENVIRONMENT === "string" ? vars.ENVIRONMENT : undefined,
      }),
      clientName: new.target.name,
      oauthClientName: ctx.id.name,
      preRegisteredClient: clientId
        ? { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) }
        : undefined,
      waitUntil: (promise) => ctx.waitUntil(promise),
      onServerStateChanged: () => this.#broadcastMcpServers(),
    });
    this.#ensureSchema();
  }

  #ensureSchema() {
    this.ctx.storage.sql`create table if not exists cf_ai_chat_messages (
      id text primary key,
      seq integer not null,
      message text not null
    )`;
    this.ctx.storage.sql`create table if not exists cf_ai_chat_request_context (
      key text primary key,
      value text not null
    )`;
  }

  get name() {
    return this.ctx.id.name;
  }

  // ---------------------------------------------------------------- storage and state

  /** A Durable Object `this.sql`: one statement, rows back as plain objects. */
  sql<T = Record<string, SqlValue>>(strings: TemplateStringsArray, ...values: SqlValue[]): T[] {
    return this.ctx.storage.sql<T>(strings, ...values);
  }

  get state(): State {
    if (this.#stateCache) return this.#stateCache.value;
    const stored = this.ctx.storage.kvGet(STATE_KEY);
    if (stored !== undefined) {
      this.#stateCache = { value: JSON.parse(stored) as State };
      return this.#stateCache.value;
    }
    if (this.initialState === (DEFAULT_STATE as State)) return undefined as State;
    this.ctx.storage.kvPut(STATE_KEY, JSON.stringify(this.initialState));
    this.#stateCache = { value: this.initialState };
    return this.initialState;
  }

  /** Persists and pushes `cf_agent_state` to every connection. */
  setState(state: State) {
    this.#applyState(state, "server");
  }

  /** Called after any state change, from the server or a client. */
  onStateChanged(_state: State, _source: Connection | "server"): void | Promise<void> {}

  // ---------------------------------------------------------------- lifecycle hooks

  onStart(_props?: Props): void | Promise<void> {}

  /** The real Agent answers unclaimed requests with a 404; subclasses fall back to it. */
  onRequest(_request: Request): Response | Promise<Response> {
    return new Response("Not implemented", { status: 404 });
  }

  onConnect(_connection: Connection, _context: { request: Request }): void | Promise<void> {}

  onMessage(_connection: Connection, _message: string | ArrayBuffer): void | Promise<void> {}

  onClose(
    _connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void | Promise<void> {}

  onError(connectionOrError: Connection | unknown, error?: unknown): unknown {
    const theError = error ?? connectionOrError;
    console.error("[AIChatAgent] error:", theError);
    throw theError;
  }

  async onChatMessage(
    _onFinish: GenerateTextOnFinishCallback<ToolSet>,
    _options?: OnChatMessageOptions,
  ): Promise<Response | undefined> {
    throw new Error(
      "received a chat message, override onChatMessage and return a Response to send to the client",
    );
  }

  /** Runs after a turn's assistant message is persisted and the turn lock is released. */
  onChatResponse(_result: ChatResponseResult): void | Promise<void> {}

  /** Last-chance transform before a message is written. */
  sanitizeMessageForPersistence(message: UIMessage): UIMessage {
    return message;
  }

  // ---------------------------------------------------------------- connections

  getConnections(): Iterable<Connection> {
    return this.#connections.values();
  }

  getConnection(id: string) {
    return this.#connections.get(id);
  }

  broadcast(message: string, without: readonly string[] = []) {
    for (const connection of this.#connections.values())
      if (!without.includes(connection.id)) connection.send(message);
  }

  // ---------------------------------------------------------------- chat

  isChatTurnActive() {
    return this.#turns.activeRequestId !== null;
  }

  /** Aborts the active turn and turns queued ones stale; the `cf_agent_chat_clear` handler calls it. */
  resetTurnState() {
    this.#turns.reset();
    for (const controller of this.#aborts.values()) controller.abort();
    this.#aborts.clear();
    this.#releaseParked();
    this.#preStream.accepted.clear();
    this.#preStream.latest = null;
    this.#pendingResults.length = 0;
  }

  abortRequest(requestId: string, reason?: unknown) {
    this.#aborts.get(requestId)?.abort(reason);
  }

  abortAllRequests(reason?: unknown) {
    for (const controller of this.#aborts.values()) controller.abort(reason);
    this.#aborts.clear();
  }

  /**
   * Appends messages and runs a turn through `onChatMessage` exactly like a browser turn, with the
   * last request's body and client tools.
   */
  async saveMessages(
    messages: UIMessage[] | ((current: UIMessage[]) => UIMessage[] | Promise<UIMessage[]>),
    options?: { signal?: AbortSignal },
  ): Promise<SaveMessagesResult> {
    const requestId = randomId();
    const clientTools = this._lastClientTools;
    const body = this._lastBody;
    const epoch = this.#turns.generation;
    let status: SaveMessagesResult["status"] = "completed";
    let error: string | undefined;
    const outcome = await this.#turns.run(requestId, epoch, async () => {
      const resolved = typeof messages === "function" ? await messages(this.messages) : messages;
      if (this.#turns.generation !== epoch) {
        status = "skipped";
        return;
      }
      await this.persistMessages(resolved);
      if (this.#turns.generation !== epoch) {
        status = "skipped";
        return;
      }
      const result = await this.#runProgrammaticTurn(requestId, clientTools, body, options?.signal);
      status = result.status;
      error = result.error;
    });
    if (outcome.stale) status = "skipped";
    await this.#drainChatResponses();
    return { requestId, status, ...(error !== undefined ? { error } : {}) };
  }

  /**
   * Reconciles and upserts messages, optionally deleting rows the caller no longer lists, trims to
   * `maxPersistedMessages`, and broadcasts `cf_agent_chat_messages`.
   */
  async persistMessages(
    messages: UIMessage[],
    excludeBroadcastIds: string[] = [],
    options?: { _deleteStaleRows?: boolean },
  ) {
    const prior = [...this.messages];
    const priorById = new Map(prior.map((message) => [message.id, message]));
    const merged = reconcileMessages(messages, prior, (message) => this.#sanitize(message));
    for (const message of merged) {
      const resolved = resolveToolMergeId(this.#sanitize(message), prior);
      const existing = priorById.get(resolved.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(resolved)) continue;
      this.#upsertMessage(resolved);
    }
    if (options?._deleteStaleRows) {
      const serverIds = new Set(prior.map((message) => message.id));
      if (merged.every((message) => serverIds.has(message.id))) {
        const keep = new Set(merged.map((message) => message.id));
        this.#deleteMessages(this.messages.map((m) => m.id).filter((id) => !keep.has(id)));
      }
    }
    if (this.maxPersistedMessages != null) {
      const excess = this.messages.length - this.maxPersistedMessages;
      if (excess > 0) this.#deleteMessages(this.messages.slice(0, excess).map((m) => m.id));
    }
    this.#broadcastChat(
      { messages: merged, type: MessageType.CF_AGENT_CHAT_MESSAGES },
      excludeBroadcastIds,
    );
  }

  // ---------------------------------------------------------------- MCP

  getMcpServers(): McpServersState {
    return this.mcp.summary();
  }

  async addMcpServer(
    serverName: string,
    url: string,
    callbackHostOrOptions?: string | AddMcpServerOptions,
    agentsPrefix?: string,
    legacyOptions?: Pick<AddMcpServerOptions, "transport">,
  ): Promise<AddMcpServerResult> {
    if (typeof url !== "string")
      throw new Error("MCP servers bound as Durable Objects are not supported on this host.");
    const normalizedUrl = new URL(url).href;
    const options: AddMcpServerOptions =
      typeof callbackHostOrOptions === "object" && callbackHostOrOptions !== null
        ? callbackHostOrOptions
        : {
            callbackHost: callbackHostOrOptions,
            agentsPrefix,
            transport: legacyOptions?.transport,
          };
    const requestedId = options.id ? normalizeServerId(options.id) : undefined;
    const servers = this.mcp.listServers();
    const existing = servers.find(
      (row) => row.name === serverName && new URL(row.server_url).href === normalizedUrl,
    );
    if (requestedId) {
      const conflict = servers.find(
        (row) =>
          row.id === requestedId &&
          (row.name !== serverName || new URL(row.server_url).href !== normalizedUrl),
      );
      if (conflict)
        throw new Error(
          `MCP server id "${requestedId}" is already in use by server "${conflict.name}" (${conflict.server_url}). Stable ids must be unique per (name, url).`,
        );
      if (existing && existing.id !== requestedId) await this.mcp.removeServer(existing.id);
    }
    const existingConn = existing && this.mcp.mcpConnections[existing.id];
    if (existing && existingConn && (!requestedId || existing.id === requestedId)) {
      if (existingConn.state === "authenticating" && existingConn.authProvider?.authUrl)
        return {
          id: existing.id,
          state: "authenticating",
          authUrl: existingConn.authProvider.authUrl,
        };
      if (existingConn.state === "failed")
        throw new Error(`MCP server "${serverName}" is in failed state: ${existingConn.error}`);
      if (existingConn.state === "ready") return { id: existing.id, state: "ready" };
    }
    const transportType = options.transport?.type ?? "auto";
    if (transportType === "sse")
      throw new Error("The SSE MCP transport is not supported on this host; use streamable-http.");
    const sendIdentity =
      (this.constructor as typeof AIChatAgent).options?.sendIdentityOnConnect ?? true;
    if (!sendIdentity && options.callbackHost && !options.callbackPath)
      throw new Error(
        "callbackPath is required in addMcpServer options when sendIdentityOnConnect is false — the default callback URL would expose the instance name.",
      );
    let callbackUrl: string | null = null;
    if (options.callbackHost) {
      const host = options.callbackHost.replace(/\/$/, "");
      callbackUrl = options.callbackPath
        ? `${host}/${options.callbackPath.replace(/^\//, "")}`
        : `${host}/${options.agentsPrefix ?? "agents"}/${kebab(this.constructor.name)}/${this.name}/callback`;
    }
    const id = requestedId ?? existing?.id ?? randomId(8);
    return this.mcp.connectServer(
      {
        id,
        name: serverName,
        server_url: normalizedUrl,
        callback_url: callbackUrl,
        auth_url: null,
      },
      options.transport?.headers,
    );
  }

  async removeMcpServer(id: string) {
    await this.mcp.removeServer(id);
  }

  // ---------------------------------------------------------------- host entry points

  /** @internal Loads caches, restores MCP connections, then runs the subclass's `onStart`. */
  async _hostStart(props?: Props) {
    this.#loadCaches();
    this.mcp.restore();
    this.#started = true;
    this.#broadcastMcpServers();
    await this.onStart(props);
  }

  /** @internal Another process won a snapshot race; adopt its image and tell clients. */
  _hostReloaded() {
    this.#ensureSchema();
    this.#loadCaches();
    this.mcp.restore();
    const state = this.state;
    if (state !== undefined) this.broadcast(JSON.stringify({ state, type: "cf_agent_state" }));
    this.#broadcastChat({ messages: this.messages, type: MessageType.CF_AGENT_CHAT_MESSAGES });
  }

  /** @internal Whether eviction would interrupt work. */
  _hostBusy() {
    return this.#turns.activeRequestId !== null || this.#preStream.accepted.size > 0;
  }

  /** @internal The `fetch` path: MCP OAuth callback, `get-messages`, then `onRequest`. */
  async _hostFetch(request: Request): Promise<Response> {
    try {
      if (this.mcp.isCallbackRequest(request)) {
        const result = await this.mcp.handleCallbackRequest(request);
        if (result.authSuccess) this.ctx.waitUntil(this.mcp.establish(result.serverId));
        else console.warn("[mcp] OAuth callback did not complete:", result.authError);
        return Response.redirect(new URL(request.url).origin, 302);
      }
      if (new URL(request.url).pathname.split("/").pop() === "get-messages")
        return new Response(JSON.stringify(this.messages), {
          headers: { "content-type": "application/json" },
        });
      return (await this.onRequest(request)) ?? new Response("Not found", { status: 404 });
    } catch (error) {
      throw this.onError(error);
    }
  }

  /** @internal A socket was accepted; send the frames the real Agent sends on connect. */
  async _hostConnect(connection: Connection, request: Request) {
    this.#connections.set(connection.id, connection);
    if (this.#activeStream) this.#notifyStreamResuming(connection);
    else this.#park(connection);
    const sendIdentity =
      (this.constructor as typeof AIChatAgent).options?.sendIdentityOnConnect ?? true;
    if (sendIdentity)
      connection.send(
        JSON.stringify({
          type: "cf_agent_identity",
          name: this.name,
          agent: kebab(this.constructor.name),
        }),
      );
    const state = this.state;
    if (state !== undefined) connection.send(JSON.stringify({ type: "cf_agent_state", state }));
    connection.send(JSON.stringify({ mcp: this.getMcpServers(), type: "cf_agent_mcp_servers" }));
    connection.send(
      JSON.stringify({ messages: this.messages, type: MessageType.CF_AGENT_CHAT_MESSAGES }),
    );
    await this.onConnect(connection, { request });
  }

  /** @internal */
  async _hostClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    this.#connections.delete(connection.id);
    this.#pendingResume.delete(connection.id);
    this.#preStream.parked.delete(connection.id);
    await this.onClose(connection, code, reason, wasClean);
  }

  /** @internal One WebSocket frame. Frames are handled concurrently, as a Durable Object would. */
  async _hostMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string") return this.onMessage(connection, message);
    let parsed: Frame | null;
    try {
      parsed = JSON.parse(message) as Frame | null;
    } catch {
      return this.onMessage(connection, message);
    }
    if (typeof parsed !== "object" || parsed === null) return this.onMessage(connection, message);
    if (parsed.type === "cf_agent_state" && "state" in parsed) {
      try {
        this.#applyState(parsed.state as State, connection);
      } catch (error) {
        console.error("[AIChatAgent] state update rejected:", error);
        connection.send(
          JSON.stringify({ type: "cf_agent_state_error", error: "State update rejected" }),
        );
      }
      return;
    }
    if (parsed.type === "rpc") {
      connection.send(
        JSON.stringify({
          type: "rpc",
          id: parsed.id,
          success: false,
          error: `Method ${String(parsed.method)} is not callable`,
        }),
      );
      return;
    }
    const event = parseProtocolMessage(message);
    switch (event?.type) {
      case "chat-request":
        if (event.init.method === "POST" && event.init.body)
          return this.#handleChatRequest(connection, event.id, event.init.body);
        return;
      case "clear":
        return this.#handleClear(connection);
      case "messages":
        return this.persistMessages(event.messages as UIMessage[], [connection.id]);
      case "cancel":
        this.#aborts.get(event.id)?.abort();
        return;
      case "stream-resume-request":
        return this.#handleResumeRequest(connection, event.probeId);
      case "stream-resume-ack":
        return this.#handleResumeAck(connection, event.id);
      case "tool-result":
        return this.#updateToolPart(
          toolResultUpdate(
            event.toolCallId,
            event.output,
            event.state === "output-error" ? "output-error" : undefined,
            event.errorText,
          ),
        );
      case "tool-approval":
        return this.#updateToolPart(toolApprovalUpdate(event.toolCallId, event.approved));
      default:
        return this.onMessage(connection, message);
    }
  }

  // ---------------------------------------------------------------- internals: turns

  async #handleChatRequest(connection: Connection, id: string, rawBody: string) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      console.warn("[AIChatAgent] Received chat request with invalid JSON body, ignoring");
      return;
    }
    const { messages, clientTools, trigger: _trigger, ...customBody } = parsed;
    const requestClientTools =
      Array.isArray(clientTools) && clientTools.length > 0
        ? (clientTools as ClientToolSchema[])
        : undefined;
    const requestBody = Object.keys(customBody).length > 0 ? customBody : undefined;
    const incoming = Array.isArray(messages) ? (messages as UIMessage[]) : [];
    const epoch = this.#turns.generation;
    // Registered before any await so a cancel frame that races the turn still lands.
    const controller = new AbortController();
    this.#aborts.set(id, controller);
    this.#preStream.accepted.add(id);
    this.#preStream.latest = id;
    try {
      const outcome = await this.#turns.run(id, epoch, async () => {
        // Installed only when this turn starts: a request queued behind a running turn must not
        // change the transcript that turn is still appending its answer to, or this turn's own
        // message would no longer be the latest one when it runs.
        this.#broadcastChat({ messages: incoming, type: MessageType.CF_AGENT_CHAT_MESSAGES }, [
          connection.id,
        ]);
        await this.persistMessages(incoming, [connection.id], { _deleteStaleRows: true });
        await this.#awaitMcp();
        this.#setRequestContext(requestClientTools, requestBody);
        const response = await this.#callOnChatMessage(id, {
          requestId: id,
          abortSignal: controller.signal,
          clientTools: requestClientTools,
          body: requestBody,
          continuation: false,
        });
        if (response) await this.#reply(id, response, [connection.id], controller.signal);
        else
          this.#broadcastChat({
            body: "No response was generated by the agent.",
            done: true,
            id,
            type: RESPONSE,
          });
      });
      if (outcome.stale)
        connection.send(JSON.stringify({ body: "", done: true, id, type: RESPONSE }));
    } finally {
      if (this.#aborts.get(id) === controller) this.#aborts.delete(id);
      this.#settlePreStream(id);
    }
    await this.#drainChatResponses();
  }

  async #runProgrammaticTurn(
    requestId: string,
    clientTools: ClientToolSchema[] | undefined,
    body: Record<string, unknown> | undefined,
    externalSignal: AbortSignal | undefined,
  ): Promise<StreamResult> {
    this.#setRequestContext(clientTools, body);
    const controller = new AbortController();
    this.#aborts.set(requestId, controller);
    const forward = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forward();
    else externalSignal?.addEventListener("abort", forward, { once: true });
    try {
      const response = await this.#callOnChatMessage(requestId, {
        requestId,
        abortSignal: controller.signal,
        clientTools,
        body,
        continuation: false,
      });
      const result: StreamResult = response
        ? await this.#reply(requestId, response, [], controller.signal)
        : { status: "completed" };
      return result.status === "completed" && controller.signal.aborted
        ? { status: "aborted" }
        : result;
    } finally {
      externalSignal?.removeEventListener("abort", forward);
      if (this.#aborts.get(requestId) === controller) this.#aborts.delete(requestId);
    }
  }

  /** A throw before streaming would otherwise leave the client's request open forever. */
  async #callOnChatMessage(id: string, options: OnChatMessageOptions) {
    try {
      return (await this.onChatMessage(async () => {}, options)) ?? undefined;
    } catch (error) {
      this.#broadcastChat({ body: errorText(error), done: true, error: true, id, type: RESPONSE });
      throw this.onError(error);
    }
  }

  async #awaitMcp() {
    if (!this.waitForMcpConnections) return;
    const timeout =
      typeof this.waitForMcpConnections === "object"
        ? this.waitForMcpConnections.timeout
        : undefined;
    await this.mcp.waitForConnections(timeout != null ? { timeout } : undefined);
  }

  /** Streams a turn's Response to every socket, buffers it for resume, then persists the message. */
  async #reply(
    id: string,
    response: Response,
    excludeBroadcastIds: string[],
    abortSignal: AbortSignal,
  ): Promise<StreamResult> {
    if (!response.body) {
      this.#broadcastChat({ body: "", done: true, id, type: RESPONSE });
      return { status: "completed" };
    }
    const epoch = this.#turns.generation;
    const message: UIMessage = {
      id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      role: "assistant",
      parts: [],
    };
    this.#startStream(id);
    this._streamingMessage = message;
    const reader = response.body.getReader();
    const isSSE = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    const completed = { value: false };
    let result: StreamResult;
    try {
      result = isSSE
        ? await this.#streamSSE(id, reader, message, completed, abortSignal)
        : await this.#streamPlaintext(id, reader, message, completed, abortSignal);
    } catch (error) {
      result = { status: "error", error: errorText(error) };
      if (!completed.value) {
        this.#finishStream();
        this.#broadcastChat({
          body: errorText(error),
          done: true,
          error: true,
          id,
          type: RESPONSE,
        });
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
      this._streamingMessage = null;
      if (!completed.value) this.#finishStream();
    }
    // A clear during the turn already wiped the transcript; the aborted partial must not reappear.
    if (message.parts.length > 0 && this.#turns.generation === epoch)
      await this.persistMessages([...this.messages, message], excludeBroadcastIds);
    this.#pendingResults.push({
      message,
      requestId: id,
      continuation: false,
      status: result.status,
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
    return result;
  }

  async #streamSSE(
    id: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    message: UIMessage,
    completed: { value: boolean },
    abortSignal: AbortSignal,
  ): Promise<StreamResult> {
    const decoder = new TextDecoder();
    let pending = "";
    const cancel = () => void reader.cancel().catch(() => {});
    abortSignal.addEventListener("abort", cancel, { once: true });
    try {
      while (!abortSignal.aborted) {
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await reader.read();
        } catch (error) {
          if (abortSignal.aborted) break;
          throw error;
        }
        if (!read.done) pending += decoder.decode(read.value, { stream: true });
        else pending += decoder.decode();
        // Unlike the Workers runtime, Node may split an SSE event across reads; keep the tail.
        const lines = pending.split("\n");
        pending = read.done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          const outcome = this.#applySseLine(id, line, message, reader, completed);
          if (outcome) return outcome;
        }
        if (read.done) {
          if (abortSignal.aborted) break;
          this.#finishStream();
          completed.value = true;
          this.#broadcastChat({ body: "", done: true, id, type: RESPONSE });
          return { status: "completed" };
        }
      }
    } finally {
      abortSignal.removeEventListener("abort", cancel);
    }
    this.#finishStream();
    completed.value = true;
    this.#broadcastChat({ body: "", done: true, id, type: RESPONSE });
    return { status: "aborted" };
  }

  #applySseLine(
    id: string,
    line: string,
    message: UIMessage,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    completed: { value: boolean },
  ): StreamResult | undefined {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return undefined;
    let data: ChunkData & Record<string, unknown>;
    try {
      data = JSON.parse(line.slice(6)) as typeof data;
    } catch {
      return undefined;
    }
    const parts = message.parts as Parameters<typeof applyChunkToParts>[0];
    if (isReplayChunk(parts, data)) return undefined;
    const handled = applyChunkToParts(parts, data);
    if (!handled) {
      const metadata = data.messageMetadata as Record<string, unknown> | undefined;
      switch (data.type) {
        case "start":
          if (typeof data.messageId === "string") message.id = data.messageId;
          if (metadata != null) message.metadata = { ...(message.metadata ?? {}), ...metadata };
          break;
        case "finish":
        case "message-metadata":
          if (metadata != null) message.metadata = { ...(message.metadata ?? {}), ...metadata };
          break;
        case "error": {
          const error = typeof data.errorText === "string" ? data.errorText : JSON.stringify(data);
          this.#broadcastChat({ error: true, body: error, done: false, id, type: RESPONSE });
          this.#finishStream();
          void reader.cancel().catch(() => {});
          completed.value = true;
          this.#broadcastChat({ body: "", done: true, id, type: RESPONSE });
          return { status: "error", error };
        }
      }
    }
    let toSend: Record<string, unknown> = data;
    if (data.type === "start" && data.messageId == null)
      toSend = { ...data, messageId: message.id };
    if (data.type === "finish" && "finishReason" in data) {
      const { finishReason, ...rest } = data;
      toSend = { ...rest, type: "finish", messageMetadata: { finishReason } };
    }
    const body = JSON.stringify(toSend);
    this.#activeStream?.chunks.push(body);
    this.#broadcastChat({ body, done: false, id, type: RESPONSE });
    return undefined;
  }

  async #streamPlaintext(
    id: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    message: UIMessage,
    completed: { value: boolean },
    abortSignal: AbortSignal,
  ): Promise<StreamResult> {
    const decoder = new TextDecoder();
    const textPart = {
      type: "text" as const,
      text: "",
      state: "streaming" as "streaming" | "done",
    };
    this.#sendTextEvent(id, { type: "text-start", id });
    message.parts.push(textPart as Part);
    const cancel = () => void reader.cancel().catch(() => {});
    abortSignal.addEventListener("abort", cancel, { once: true });
    let aborted = false;
    try {
      while (true) {
        if (abortSignal.aborted) {
          aborted = true;
          break;
        }
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await reader.read();
        } catch (error) {
          if (abortSignal.aborted) {
            aborted = true;
            break;
          }
          throw error;
        }
        if (read.done) break;
        const chunk = decoder.decode(read.value, { stream: true });
        if (chunk.length === 0) continue;
        textPart.text += chunk;
        this.#sendTextEvent(id, { type: "text-delta", id, delta: chunk });
      }
    } finally {
      abortSignal.removeEventListener("abort", cancel);
    }
    textPart.state = "done";
    this.#sendTextEvent(id, { type: "text-end", id });
    this.#finishStream();
    completed.value = true;
    this.#broadcastChat({ body: "", done: true, id, type: RESPONSE });
    return { status: aborted ? "aborted" : "completed" };
  }

  #sendTextEvent(id: string, event: Record<string, unknown>) {
    const body = JSON.stringify(event);
    this.#activeStream?.chunks.push(body);
    this.#broadcastChat({ body, done: false, id, type: RESPONSE });
  }

  async #drainChatResponses() {
    while (this.#pendingResults.length > 0) {
      const result = this.#pendingResults.shift();
      if (!result) break;
      try {
        await this.onChatResponse(result);
      } catch (error) {
        console.error("[AIChatAgent] onChatResponse threw:", error);
      }
    }
  }

  async #handleClear(connection: Connection) {
    this.resetTurnState();
    this.#deleteMessages(this.messages.map((message) => message.id));
    this.#activeStream = null;
    this.#lastStream = null;
    this.#pendingResume.clear();
    this._lastClientTools = undefined;
    this._lastBody = undefined;
    this.#persistRequestContext();
    this.#broadcastChat({ type: MessageType.CF_AGENT_CHAT_CLEAR }, [connection.id]);
  }

  /** Client tool results and approvals update the matching tool part in place. */
  async #updateToolPart(update: ReturnType<typeof toolResultUpdate>) {
    const matches = (part: Part) => {
      const record = part as Record<string, unknown>;
      return (
        record.toolCallId === update.toolCallId && update.matchStates.includes(String(record.state))
      );
    };
    const streaming = this._streamingMessage;
    if (streaming) {
      const index = streaming.parts.findIndex(matches);
      if (index >= 0) {
        streaming.parts[index] = update.apply(
          streaming.parts[index] as Record<string, unknown>,
        ) as Part;
        return;
      }
    }
    const target = this.messages.find((message) => message.parts.some(matches));
    if (!target) return;
    const updated: UIMessage = {
      ...target,
      parts: target.parts.map((part) =>
        matches(part) ? (update.apply(part as Record<string, unknown>) as Part) : part,
      ),
    };
    this.#upsertMessage(this.#sanitize(updated));
    this.#broadcastChat({ type: MessageType.CF_AGENT_MESSAGE_UPDATED, message: updated });
  }

  // ---------------------------------------------------------------- internals: resume

  #startStream(requestId: string) {
    this.#activeStream = { requestId, chunks: [] };
    for (const connection of this.#preStream.parked.values())
      this.#notifyStreamResuming(connection);
    this.#preStream.parked.clear();
  }

  #finishStream() {
    if (!this.#activeStream) return;
    this.#lastStream = this.#activeStream;
    this.#activeStream = null;
    this.#pendingResume.clear();
  }

  #notifyStreamResuming(connection: Connection, probeId?: string) {
    if (!this.#activeStream) return;
    connection.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_STREAM_RESUMING,
        id: this.#activeStream.requestId,
        ...(probeId ? { probeId } : {}),
      }),
    );
    this.#pendingResume.add(connection.id);
  }

  #park(connection: Connection, probeId?: string) {
    if (this.#preStream.accepted.size === 0) return false;
    this.#preStream.parked.set(connection.id, connection);
    connection.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_STREAM_PENDING,
        ...(this.#preStream.latest ? { id: this.#preStream.latest } : {}),
        ...(probeId ? { probeId } : {}),
      }),
    );
    return true;
  }

  #settlePreStream(requestId: string) {
    this.#preStream.accepted.delete(requestId);
    if (this.#preStream.accepted.size > 0) return;
    this.#preStream.latest = null;
    if (!this.#activeStream) this.#releaseParked();
  }

  #releaseParked() {
    const none = JSON.stringify({ type: MessageType.CF_AGENT_STREAM_RESUME_NONE });
    for (const connection of this.#preStream.parked.values()) connection.send(none);
    this.#preStream.parked.clear();
  }

  #handleResumeRequest(connection: Connection, probeId?: string) {
    if (this.#activeStream) this.#notifyStreamResuming(connection, probeId);
    else if (!this.#park(connection, probeId))
      connection.send(
        JSON.stringify({
          type: MessageType.CF_AGENT_STREAM_RESUME_NONE,
          reason: "idle",
          ...(probeId ? { probeId } : {}),
        }),
      );
  }

  #handleResumeAck(connection: Connection, requestId: string) {
    const replay = (stream: BufferedStream, done: boolean) => {
      for (const body of stream.chunks)
        connection.send(
          JSON.stringify({ body, done: false, id: requestId, type: RESPONSE, replay: true }),
        );
      connection.send(
        JSON.stringify({
          body: "",
          done,
          id: requestId,
          type: RESPONSE,
          replay: true,
          ...(done ? {} : { replayComplete: true }),
        }),
      );
    };
    // Replay and un-exclude in one synchronous step so no live chunk can slip between them.
    if (this.#activeStream?.requestId === requestId) replay(this.#activeStream, false);
    else if (!this.#activeStream) {
      if (this.#lastStream?.requestId === requestId) replay(this.#lastStream, true);
      else
        connection.send(
          JSON.stringify({ body: "", done: true, id: requestId, type: RESPONSE, replay: true }),
        );
    }
    this.#pendingResume.delete(connection.id);
  }

  // ---------------------------------------------------------------- internals: storage

  #broadcastChat(message: Record<string, unknown>, exclude: readonly string[] = []) {
    this.broadcast(JSON.stringify(message), [...exclude, ...this.#pendingResume]);
  }

  #broadcastMcpServers() {
    if (!this.#started) return;
    this.broadcast(JSON.stringify({ mcp: this.getMcpServers(), type: "cf_agent_mcp_servers" }));
  }

  #applyState(state: State, source: Connection | "server") {
    this.ctx.storage.kvPut(STATE_KEY, JSON.stringify(state));
    this.#stateCache = { value: state };
    this.broadcast(
      JSON.stringify({ state, type: "cf_agent_state" }),
      source === "server" ? [] : [source.id],
    );
    this.ctx.waitUntil(
      Promise.resolve()
        .then(() => this.onStateChanged(state, source))
        .catch((error: unknown) => console.error("[AIChatAgent] onStateChanged threw:", error)),
    );
  }

  #loadCaches() {
    this.#stateCache = null;
    this.messages = this.ctx.storage.sql<{
      message: string;
    }>`select message from cf_ai_chat_messages order by seq`.map(
      (row) => JSON.parse(row.message) as UIMessage,
    );
    this._lastBody = undefined;
    this._lastClientTools = undefined;
    for (const row of this.ctx.storage.sql<{ key: string; value: string }>`
      select key, value from cf_ai_chat_request_context`) {
      try {
        if (row.key === "lastBody")
          this._lastBody = JSON.parse(row.value) as Record<string, unknown>;
        else if (row.key === "lastClientTools")
          this._lastClientTools = JSON.parse(row.value) as ClientToolSchema[];
      } catch {}
    }
  }

  #setRequestContext(
    clientTools: ClientToolSchema[] | undefined,
    body: Record<string, unknown> | undefined,
  ) {
    this._lastClientTools = clientTools?.length ? clientTools : undefined;
    this._lastBody = body && Object.keys(body).length > 0 ? body : undefined;
    this.#persistRequestContext();
  }

  #persistRequestContext() {
    const storage = this.ctx.storage;
    if (this._lastBody)
      storage.sql`insert or replace into cf_ai_chat_request_context (key, value)
        values ('lastBody', ${JSON.stringify(this._lastBody)})`;
    else storage.sql`delete from cf_ai_chat_request_context where key = 'lastBody'`;
    if (this._lastClientTools)
      storage.sql`insert or replace into cf_ai_chat_request_context (key, value)
        values ('lastClientTools', ${JSON.stringify(this._lastClientTools)})`;
    else storage.sql`delete from cf_ai_chat_request_context where key = 'lastClientTools'`;
  }

  #upsertMessage(message: UIMessage) {
    const json = JSON.stringify(message);
    const index = this.messages.findIndex((existing) => existing.id === message.id);
    if (index >= 0) {
      this.ctx.storage
        .sql`update cf_ai_chat_messages set message = ${json} where id = ${message.id}`;
      this.messages = this.messages.map((existing, i) => (i === index ? message : existing));
      return;
    }
    this.ctx.storage.sql`insert into cf_ai_chat_messages (id, seq, message)
      values (${message.id}, (select coalesce(max(seq), 0) + 1 from cf_ai_chat_messages), ${json})`;
    this.messages = [...this.messages, message];
  }

  #deleteMessages(ids: string[]) {
    if (ids.length === 0) return;
    for (const id of ids) this.ctx.storage.sql`delete from cf_ai_chat_messages where id = ${id}`;
    const removed = new Set(ids);
    this.messages = this.messages.filter((message) => !removed.has(message.id));
  }

  /** ai-chat's persistence hygiene: provider metadata stripping, payload truncation, user hook. */
  #sanitize(message: UIMessage): UIMessage {
    const cleaned = sanitizeMessage(message);
    return this.sanitizeMessageForPersistence({
      ...cleaned,
      parts: cleaned.parts.map((part) => truncateProviderPayloads(part)),
    });
  }
}

function truncateProviderPayloads(part: Part): Part {
  const record = part as Record<string, unknown>;
  if (!record.providerExecuted) return part;
  const toolName =
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.type === "string" && record.type.startsWith("tool-")
        ? record.type.slice(5)
        : undefined;
  if (toolName === "web_search" || toolName === "web_fetch") return part;
  const result = { ...record };
  if (result.input !== undefined) result.input = truncateStrings(result.input);
  if (result.output !== undefined) result.output = truncateStrings(result.output);
  return result as Part;
}

function truncateStrings(value: unknown, preserve = false): unknown {
  if (typeof value === "string") {
    if (preserve || value.length <= PROVIDER_TOOL_MAX_STRING_LENGTH) return value;
    const marker = `… [truncated, original length: ${value.length}]`;
    return value.slice(0, Math.max(0, PROVIDER_TOOL_MAX_STRING_LENGTH - marker.length)) + marker;
  }
  if (Array.isArray(value)) return value.map((item) => truncateStrings(item, preserve));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        truncateStrings(item, preserve || key.startsWith("encrypted")),
      ]),
    );
  return value;
}
