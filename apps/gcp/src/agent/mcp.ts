import {
  Client,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type ServerCapabilities,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  StreamableHTTPClientTransport,
  type Tool,
} from "@modelcontextprotocol/client";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { AgentStorage } from "./storage";
import { TokenEncryptionUnavailableError, type TokenVault } from "./token-vault";

/** The connection states `agents` reports, so `connectorFromMcp` reads them unchanged. */
export type McpConnectionState =
  | "authenticating"
  | "connecting"
  | "connected"
  | "discovering"
  | "ready"
  | "failed";

export interface McpServerRow {
  id: string;
  name: string;
  server_url: string;
  callback_url: string | null;
  auth_url: string | null;
}

export interface McpServerSummary {
  auth_url: string | null;
  capabilities: ServerCapabilities | null;
  error: string | null;
  instructions: string | null;
  name: string;
  server_url: string;
  state: McpConnectionState | "not-connected";
}

export type McpToolDescriptor = Tool & { serverId: string };

export interface McpServersState {
  prompts: unknown[];
  resources: unknown[];
  servers: Record<string, McpServerSummary>;
  tools: McpToolDescriptor[];
}

export interface PreRegisteredClient {
  client_id: string;
  client_secret?: string;
}

export interface McpManagerHost {
  storage: AgentStorage;
  vault: TokenVault;
  /** MCP implementation name sent during negotiation; `agents` uses the agent class name. */
  clientName: string;
  /** OAuth `client_name` for dynamic registration; `agents` uses the agent instance name. */
  oauthClientName: string;
  preRegisteredClient: PreRegisteredClient | undefined;
  waitUntil(promise: Promise<unknown>): void;
  onServerStateChanged(): void;
}

export type McpCallbackResult =
  | { authSuccess: true; serverId: string }
  | { authSuccess: false; serverId?: string; authError: string };

const STATE_EXPIRATION_MS = 10 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_ERROR_LENGTH = 500;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to strip them.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BLOCKED_HOSTNAMES = new Set(["0.0.0.0", "[::]", "metadata.google.internal", "metadata"]);

/** Same rules as `agents`' `normalizeServerId`, since the id is embedded in AI SDK tool names. */
export function normalizeServerId(input: string) {
  let id = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (id.length === 0 || !/^[a-z]/.test(id)) id = `id-${id}`.replace(/-+$/g, "");
  if (id.length > 64) id = id.slice(0, 64).replace(/-+$/g, "");
  return id;
}

/** On Cloud Run the metadata server and VPC ranges are reachable, so refuse them as MCP targets. */
export function isBlockedMcpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  const octets = host.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
    const [a = 0, b = 0] = octets.map(Number);
    if (a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31)) return true;
    if ((a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  }
  if (host.startsWith("[") && /^\[(fc|fd|fe[89ab])/.test(host)) return true;
  return false;
}

function sanitizeError(error: string | null) {
  if (error === null) return null;
  const clean = error.replace(CONTROL_CHARS, "");
  return clean.length > MAX_ERROR_LENGTH ? `${clean.slice(0, MAX_ERROR_LENGTH)}...` : clean;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Mirrors `agents`' detection: the SDK surfaces 401s as status codes or as wrapped messages. */
function isUnauthorized(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const record = error as { code?: unknown; status?: unknown; cause?: unknown };
  if (record.code === 401 || record.status === 401) return true;
  if (record.cause && isUnauthorized(record.cause, depth + 1)) return true;
  const message = errorMessage(error);
  return message.includes("Unauthorized") || message.includes("401");
}

function vaultFailure(error: unknown, depth = 0): TokenEncryptionUnavailableError | undefined {
  if (error instanceof TokenEncryptionUnavailableError) return error;
  if (!error || typeof error !== "object" || depth > 4) return undefined;
  return vaultFailure((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * OAuth client state for one MCP server, persisted in the agent's own storage so it travels with the
 * snapshot. Secrets go through the vault; the state nonce is not secret and stays readable.
 */
class AgentOAuthProvider implements OAuthClientProvider {
  authUrl: string | undefined;
  /** The first vault refusal during a flow; the SDK may wrap it, so the manager reports this one. */
  vaultError: TokenEncryptionUnavailableError | undefined;

  constructor(
    private readonly host: McpManagerHost,
    readonly serverId: string,
    readonly callbackUrl: string,
  ) {}

  get redirectUrl() {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.host.oauthClientName,
      client_uri: new URL(this.callbackUrl).origin,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [this.callbackUrl],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  key(suffix: string) {
    return `mcp:${this.serverId}:${suffix}`;
  }

  async state() {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    this.host.storage.kvPut(this.key(`state:${nonce}`), JSON.stringify({ createdAt: Date.now() }));
    return `${nonce}.${this.serverId}`;
  }

  checkState(state: string): { valid: true } | { valid: false; error: string } {
    const [nonce, serverId, extra] = state.split(".");
    if (!nonce || !serverId || extra !== undefined)
      return { valid: false, error: "Invalid state format" };
    if (serverId !== this.serverId) return { valid: false, error: "State serverId mismatch" };
    const stored = this.host.storage.kvGet(this.key(`state:${nonce}`));
    if (!stored) return { valid: false, error: "State not found or already used" };
    const { createdAt } = JSON.parse(stored) as { createdAt: number };
    if (Date.now() - createdAt > STATE_EXPIRATION_MS) {
      this.host.storage.kvDelete(this.key(`state:${nonce}`));
      return { valid: false, error: "State expired" };
    }
    return { valid: true };
  }

  consumeState(state: string) {
    const [nonce] = state.split(".");
    if (nonce) this.host.storage.kvDelete(this.key(`state:${nonce}`));
  }

  async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
    if (this.host.preRegisteredClient) return { ...this.host.preRegisteredClient };
    return this.#read<StoredOAuthClientInformation>("client");
  }

  async saveClientInformation(info: StoredOAuthClientInformation) {
    await this.#write("client", info);
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> {
    return this.#read<StoredOAuthTokens>("tokens");
  }

  async saveTokens(tokens: StoredOAuthTokens) {
    await this.#write("tokens", tokens);
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.authUrl = authorizationUrl.toString();
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.#write("verifier", codeVerifier);
  }

  async codeVerifier() {
    const verifier = await this.#read<string>("verifier");
    if (!verifier) throw new Error("No PKCE code verifier is stored for this authorization.");
    return verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const keys: string[] = [];
    if (scope === "all" || scope === "client") keys.push(this.key("client"));
    if (scope === "all" || scope === "tokens") keys.push(this.key("tokens"));
    if (scope === "all" || scope === "verifier") keys.push(this.key("verifier"));
    this.host.storage.kvDelete(...keys);
  }

  async #read<T>(suffix: string): Promise<T | undefined> {
    const key = this.key(suffix);
    const sealed = this.host.storage.kvGet(key);
    return sealed === undefined ? undefined : this.host.vault.open<T>(sealed, key);
  }

  async #write(suffix: string, value: unknown) {
    const key = this.key(suffix);
    try {
      this.host.storage.kvPut(key, await this.host.vault.seal(value, key));
    } catch (error) {
      if (error instanceof TokenEncryptionUnavailableError) this.vaultError ??= error;
      throw error;
    }
  }
}

class McpConnection {
  state: McpConnectionState = "connecting";
  error: string | null = null;
  tools: Tool[] = [];
  instructions: string | null = null;
  capabilities: ServerCapabilities | null = null;
  client: Client;
  #transport: StreamableHTTPClientTransport | undefined;
  #pendingAuthTransport: StreamableHTTPClientTransport | undefined;

  constructor(
    readonly id: string,
    readonly url: URL,
    readonly authProvider: AgentOAuthProvider | undefined,
    readonly clientName: string,
    readonly headers: Record<string, string> | undefined,
  ) {
    this.client = this.#createClient();
  }

  #createClient() {
    return new Client({ name: this.clientName, version: "0.0.1" });
  }

  #createTransport() {
    return new StreamableHTTPClientTransport(this.url, {
      ...(this.authProvider ? { authProvider: this.authProvider } : {}),
      ...(this.headers ? { requestInit: { headers: this.headers } } : {}),
    });
  }

  async connect(): Promise<McpConnectionState> {
    if (this.#transport) {
      this.#transport = undefined;
      await this.client.close().catch(() => {});
      this.client = this.#createClient();
    }
    this.state = "connecting";
    this.error = null;
    const transport = this.#createTransport();
    try {
      await this.client.connect(transport);
      this.#transport = transport;
      this.#pendingAuthTransport = undefined;
      this.state = "connected";
    } catch (error) {
      const refused = this.authProvider?.vaultError ?? vaultFailure(error);
      if (refused) {
        this.state = "failed";
        this.error = refused.message;
      } else if (isUnauthorized(error) && this.authProvider) {
        this.#pendingAuthTransport = transport;
        this.state = "authenticating";
      } else {
        this.state = "failed";
        this.error = errorMessage(error);
      }
    }
    return this.state;
  }

  /** Exchanges the authorization code; the next `connect` then carries the bearer token. */
  async finishAuth(params: URLSearchParams) {
    const transport = this.#pendingAuthTransport ?? this.#createTransport();
    this.#pendingAuthTransport = undefined;
    try {
      await transport.finishAuth(params);
    } finally {
      await transport.close().catch(() => {});
    }
    await this.client.close().catch(() => {});
    this.client = this.#createClient();
    this.#transport = undefined;
  }

  async discover(): Promise<{ success: true } | { success: false; error: string }> {
    if (this.state !== "connected" && this.state !== "ready")
      return { success: false, error: `Discovery skipped - connection in ${this.state} state` };
    this.state = "discovering";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Discovery timed out after ${DISCOVERY_TIMEOUT_MS}ms`)),
          DISCOVERY_TIMEOUT_MS,
        );
      });
      await Promise.race([this.#discoverTools(), timeout]);
      this.state = "ready";
      return { success: true };
    } catch (error) {
      this.state = isUnauthorized(error) ? "authenticating" : "connected";
      return { success: false, error: errorMessage(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async #discoverTools() {
    this.capabilities = this.client.getServerCapabilities() ?? null;
    if (!this.capabilities) throw new Error("The MCP Server failed to return server capabilities");
    this.instructions = this.client.getInstructions() ?? null;
    if (!this.capabilities.tools) {
      this.tools = [];
      return;
    }
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    this.tools = tools;
  }

  async close() {
    const transport = this.#transport;
    this.#transport = undefined;
    if (transport?.sessionId) await transport.terminateSession().catch(() => {});
    await this.client.close().catch(() => {});
  }
}

/**
 * The agent's MCP client: the subset of `agents`' MCPClientManager the orchestrator relies on,
 * over the streamable-HTTP transport with authorization-code + PKCE OAuth.
 */
export class McpClientManager {
  readonly mcpConnections: Record<string, McpConnection> = {};
  readonly #pending = new Map<string, Promise<unknown>>();
  readonly #schemaCache = new WeakMap<Tool, { input: z.ZodType; output?: z.ZodType }>();

  constructor(private readonly host: McpManagerHost) {
    this.#ensureSchema();
  }

  #ensureSchema() {
    this.host.storage.sql`create table if not exists cf_agents_mcp_servers (
      id text primary key,
      name text not null,
      server_url text not null,
      callback_url text,
      auth_url text
    )`;
  }

  listServers(): McpServerRow[] {
    return this.host.storage.sql<McpServerRow>`
      select id, name, server_url, callback_url, auth_url from cf_agents_mcp_servers`;
  }

  listTools(): McpToolDescriptor[] {
    return Object.entries(this.mcpConnections).flatMap(([serverId, conn]) =>
      conn.tools.map((tool) => ({ ...tool, serverId })),
    );
  }

  summary(): McpServersState {
    const servers: Record<string, McpServerSummary> = {};
    for (const row of this.listServers()) {
      const conn = this.mcpConnections[row.id];
      servers[row.id] = {
        auth_url: row.auth_url,
        capabilities: conn?.capabilities ?? null,
        error: sanitizeError(conn?.error ?? null),
        instructions: conn?.instructions ?? null,
        name: row.name,
        server_url: row.server_url,
        state: conn?.state ?? (row.auth_url ? "authenticating" : "not-connected"),
      };
    }
    return { prompts: [], resources: [], servers, tools: this.listTools() };
  }

  /**
   * Rebuilds connections after the instance is (re)loaded from a snapshot. A server waiting on an
   * OAuth callback stays in "authenticating" so the callback still lands after an eviction.
   */
  restore() {
    this.#ensureSchema();
    for (const row of this.listServers()) {
      if (this.mcpConnections[row.id]) continue;
      const conn = this.#createConnection(row);
      if (row.auth_url && !this.host.storage.kvGet(`mcp:${row.id}:tokens`)) {
        conn.state = "authenticating";
        if (conn.authProvider) conn.authProvider.authUrl = row.auth_url;
        continue;
      }
      this.#track(row.id, this.#connectWithRetry(row.id));
    }
    this.host.onServerStateChanged();
  }

  /** Registers (or replaces) a server, connects, and discovers; the shape `addMcpServer` returns. */
  async connectServer(row: McpServerRow, headers?: Record<string, string>) {
    if (isBlockedMcpUrl(row.server_url))
      throw new Error(`Refusing to connect to a private or metadata address: ${row.server_url}`);
    this.host.storage.sql`insert or replace into cf_agents_mcp_servers
      (id, name, server_url, callback_url, auth_url)
      values (${row.id}, ${row.name}, ${row.server_url}, ${row.callback_url}, ${null})`;
    const previous = this.mcpConnections[row.id];
    if (previous) await previous.close();
    const conn = this.#createConnection(row, headers);
    this.host.onServerStateChanged();
    const state = await conn.connect();
    this.host.onServerStateChanged();
    if (state === "failed")
      throw new Error(`Failed to connect to MCP server at ${row.server_url}: ${conn.error}`);
    if (state === "authenticating") {
      const authUrl = conn.authProvider?.authUrl;
      if (!authUrl)
        throw new Error(
          "This MCP server requires OAuth authentication. Provide callbackHost in addMcpServer options to enable the OAuth flow.",
        );
      this.#setAuthUrl(row.id, authUrl);
      return { id: row.id, state: "authenticating" as const, authUrl };
    }
    const discovered = await conn.discover();
    this.host.onServerStateChanged();
    if (!discovered.success)
      throw new Error(`Failed to discover MCP server capabilities: ${discovered.error}`);
    return { id: row.id, state: "ready" as const };
  }

  async removeServer(id: string) {
    const conn = this.mcpConnections[id];
    delete this.mcpConnections[id];
    this.#pending.delete(id);
    await conn?.close().catch(() => {});
    this.host.storage.sql`delete from cf_agents_mcp_servers where id = ${id}`;
    this.host.storage.kvDelete(...this.host.storage.kvKeys(`mcp:${id}:`));
    this.host.onServerStateChanged();
  }

  async waitForConnections(options?: { timeout?: number }) {
    if (this.#pending.size === 0) return;
    if (options?.timeout != null && options.timeout <= 0) return;
    const settled = Promise.allSettled(this.#pending.values());
    if (options?.timeout == null) {
      await settled;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      settled,
      new Promise((resolve) => (timer = setTimeout(resolve, options.timeout))),
    ]);
    clearTimeout(timer);
  }

  /** AI SDK tools keyed `tool_${serverId without dashes}_${toolName}`, exactly as `agents` names them. */
  getAITools(): ToolSet {
    const entries: [string, ToolSet[string]][] = [];
    for (const [serverId, conn] of Object.entries(this.mcpConnections)) {
      if (conn.state !== "ready" && conn.state !== "authenticating")
        console.warn(
          `[getAITools] WARNING: Reading tools from connection ${serverId} in state "${conn.state}". Tools may not be loaded yet.`,
        );
      for (const tool of conn.tools) {
        const schemas = this.#schemas(serverId, tool);
        if (!schemas) continue;
        const toolName = tool.name;
        const definition = {
          description: tool.description,
          title: tool.title ?? tool.annotations?.title,
          inputSchema: schemas.input,
          outputSchema: schemas.output,
          execute: async (args: Record<string, unknown>) => {
            const result = await this.callTool({ serverId, name: toolName, arguments: args });
            if (result.isError) {
              const first = result.content?.[0];
              throw new Error(
                first?.type === "text" && first.text ? first.text : "Tool call failed",
              );
            }
            return result;
          },
        };
        entries.push([
          `tool_${serverId.replace(/-/g, "")}_${toolName}`,
          definition as ToolSet[string],
        ]);
      }
    }
    return Object.fromEntries(entries);
  }

  callTool(params: { serverId: string; name: string; arguments?: Record<string, unknown> }) {
    const conn = this.mcpConnections[params.serverId];
    if (!conn) throw new Error(`No MCP connection for server "${params.serverId}".`);
    return conn.client.callTool({
      name: params.name.replace(`${params.serverId}.`, ""),
      arguments: params.arguments,
    });
  }

  isCallbackRequest(request: Request) {
    if (request.method !== "GET") return false;
    const url = new URL(request.url);
    const serverId = url.searchParams.get("state")?.split(".")[1];
    if (!serverId) return false;
    // The state nonce is the real guard; matching the path (not the origin) tolerates proxies
    // that present a different scheme or host to the container than the browser used.
    return this.listServers().some((row) => {
      if (row.id !== serverId || !row.callback_url) return false;
      try {
        return new URL(row.callback_url).pathname === url.pathname;
      } catch {
        return false;
      }
    });
  }

  async handleCallbackRequest(request: Request): Promise<McpCallbackResult> {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    const serverId = state?.split(".")[1];
    if (!state || !serverId)
      return { authSuccess: false, authError: "Unauthorized: no state provided" };
    const conn = this.mcpConnections[serverId];
    const provider = conn?.authProvider;
    if (!conn || !provider)
      return {
        serverId,
        authSuccess: false,
        authError: `No connection found for serverId "${serverId}".`,
      };
    const check = provider.checkState(state);
    if (conn.state === "ready" || conn.state === "connected" || conn.state === "discovering") {
      if (check.valid) provider.consumeState(state);
      return { authSuccess: true, serverId };
    }
    // An unverified callback must not disturb a flow that may still complete.
    if (!check.valid)
      return {
        serverId,
        authSuccess: false,
        authError: params.get("error_description") ?? check.error,
      };
    provider.consumeState(state);
    const denied = params.get("error");
    if (denied || !params.get("code"))
      return this.#fail(
        conn,
        params.get("error_description") ?? denied ?? "Unauthorized: no code provided",
      );
    if (conn.state !== "authenticating" && conn.state !== "failed")
      return this.#fail(conn, `Failed to authenticate from "${conn.state}" state`);
    conn.state = "connecting";
    this.host.onServerStateChanged();
    try {
      await conn.finishAuth(params);
    } catch (error) {
      return this.#fail(conn, provider.vaultError?.message ?? errorMessage(error));
    }
    this.#setAuthUrl(serverId, null);
    this.host.onServerStateChanged();
    return { authSuccess: true, serverId };
  }

  /** After a successful callback: connect with the new token and discover, in the background. */
  establish(serverId: string) {
    const promise = (async () => {
      const conn = this.mcpConnections[serverId];
      if (!conn) return;
      const state = await conn.connect();
      this.host.onServerStateChanged();
      if (state === "connected") {
        await conn.discover();
        this.host.onServerStateChanged();
      }
    })();
    this.#track(serverId, promise);
    return promise;
  }

  async closeAll() {
    const connections = Object.values(this.mcpConnections);
    this.#pending.clear();
    await Promise.allSettled(connections.map((conn) => conn.close()));
  }

  #createConnection(row: McpServerRow, headers?: Record<string, string>) {
    const provider = row.callback_url
      ? new AgentOAuthProvider(this.host, row.id, row.callback_url)
      : undefined;
    const conn = new McpConnection(
      row.id,
      new URL(row.server_url),
      provider,
      this.host.clientName,
      headers,
    );
    this.mcpConnections[row.id] = conn;
    return conn;
  }

  async #connectWithRetry(serverId: string) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const conn = this.mcpConnections[serverId];
      if (!conn) return;
      const state = await conn.connect();
      this.host.onServerStateChanged();
      if (state === "connected") {
        const discovered = await conn.discover();
        this.host.onServerStateChanged();
        if (!discovered.success)
          console.error(`[mcp] discovering ${serverId} failed:`, discovered.error);
        return;
      }
      if (state === "authenticating") {
        if (conn.authProvider?.authUrl) this.#setAuthUrl(serverId, conn.authProvider.authUrl);
        return;
      }
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }

  #track(serverId: string, promise: Promise<unknown>) {
    const settled = promise.catch((error: unknown) =>
      console.error(`[mcp] connecting ${serverId} failed:`, errorMessage(error)),
    );
    this.#pending.set(serverId, settled);
    this.host.waitUntil(
      settled.finally(() => {
        if (this.#pending.get(serverId) === settled) this.#pending.delete(serverId);
      }),
    );
  }

  #fail(conn: McpConnection, error: string): McpCallbackResult {
    conn.state = "failed";
    conn.error = error;
    this.host.onServerStateChanged();
    return { serverId: conn.id, authSuccess: false, authError: error };
  }

  #setAuthUrl(serverId: string, authUrl: string | null) {
    this.host.storage
      .sql`update cf_agents_mcp_servers set auth_url = ${authUrl} where id = ${serverId}`;
  }

  #schemas(serverId: string, tool: Tool) {
    const cached = this.#schemaCache.get(tool);
    if (cached) return cached;
    try {
      const converted = {
        input: z.fromJSONSchema((tool.inputSchema ?? { type: "object" }) as never),
        ...(tool.outputSchema ? { output: z.fromJSONSchema(tool.outputSchema as never) } : {}),
      };
      this.#schemaCache.set(tool, converted);
      return converted;
    } catch (error) {
      console.warn(
        `[getAITools] Skipping tool "${tool.name}" from "${serverId}": ${String(error)}`,
      );
      return undefined;
    }
  }
}
