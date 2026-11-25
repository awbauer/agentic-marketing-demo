import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketChatTransport } from "agents/chat/transport";
import { AgentClient } from "agents/client";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { AIChatAgent, type OnChatMessageOptions } from "../../src/agent/ai-chat";
import { createAgentHost } from "../../src/agent/host";
import { MemorySnapshotStore, type SnapshotStore } from "../../src/agent/snapshots";

export type TestState = { count: number; label?: string };
export type TestEnv = {
  ENVIRONMENT?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SALESFORCE_CLIENT_ID?: string;
};

/** A chat agent small enough to reason about: echoes, streams slowly on cue, or fails on cue. */
export class TestAgent extends AIChatAgent<TestEnv, TestState> {
  static override options = { sendIdentityOnConnect: false };
  static readonly instances = new Map<string, TestAgent>();
  static releaseSlow: (() => void) | null = null;

  override initialState: TestState = { count: 0 };
  startedWith: Record<string, unknown> | undefined;
  readonly turns: OnChatMessageOptions[] = [];
  readonly abortedTurns: string[] = [];

  constructor(...args: ConstructorParameters<typeof AIChatAgent<TestEnv, TestState>>) {
    super(...args);
    TestAgent.instances.set(this.name, this);
  }

  override async onStart(props?: Record<string, unknown>) {
    await super.onStart(props);
    this.startedWith = props;
    this.sql`create table if not exists notes (id integer primary key, body text not null)`;
  }

  override async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    if (options) this.turns.push(options);
    const last = this.messages.at(-1);
    const text = last?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
    if (text === "boom") throw new Error("the model exploded");
    const signal = options?.abortSignal;
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: "t1" });
        if (text === "slow") {
          writer.write({ type: "text-delta", id: "t1", delta: "first " });
          const released = await new Promise<boolean>((resolve) => {
            TestAgent.releaseSlow = () => resolve(true);
            signal?.addEventListener("abort", () => resolve(false), { once: true });
          });
          if (!released) {
            this.abortedTurns.push(options?.requestId ?? "");
            return;
          }
          writer.write({ type: "text-delta", id: "t1", delta: "second" });
        } else {
          for (const word of `echo: ${text}`.split(/(?= )/))
            writer.write({ type: "text-delta", id: "t1", delta: word });
        }
        writer.write({ type: "text-end", id: "t1" });
        writer.write({ type: "finish" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    if (route === "POST /agent/notes") {
      const { body } = (await request.json()) as { body: string };
      this.sql`insert into notes (body) values (${body})`;
      return Response.json({ ok: true });
    }
    if (route === "GET /agent/notes")
      return Response.json(this.sql<{ body: string }>`select body from notes order by id`);
    if (route === "POST /agent/state") {
      this.setState({ ...this.state, ...((await request.json()) as Partial<TestState>) });
      return Response.json(this.state);
    }
    if (route === "GET /agent/state") return Response.json(this.state);
    if (route === "POST /agent/turn") {
      const { text } = (await request.json()) as { text: string };
      this._lastBody = { scope: "surface" };
      const result = await this.saveMessages((current) => [...current, userMessage(text)]);
      return Response.json(result);
    }
    if (route === "POST /agent/mcp/connect") {
      const { url: serverUrl } = (await request.json()) as { url: string };
      try {
        const result = await this.addMcpServer("Test MCP", serverUrl, {
          id: "test-server",
          callbackHost: url.origin,
          callbackPath: "/agent/mcp/callback",
          transport: { type: "streamable-http" },
        });
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 502 });
      }
    }
    if (route === "GET /agent/mcp/servers") return Response.json(this.getMcpServers());
    if (route === "POST /agent/mcp/call") {
      await this.mcp.waitForConnections({ timeout: 5_000 });
      const tools = this.mcp.getAITools();
      const { name, args } = (await request.json()) as { name: string; args: unknown };
      const tool = tools[name] as unknown as
        | { execute: (input: unknown) => Promise<unknown> }
        | undefined;
      return Response.json({
        names: Object.keys(tools),
        result: tool ? await tool.execute(args) : null,
      });
    }
    return super.onRequest(request);
  }
}

export function userMessage(text: string, id = crypto.randomUUID()): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

export function textOf(message: UIMessage | undefined) {
  return message?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** An HTTP server wired like the Cloud Run entry point: `/agent*` goes to the agent host. */
export async function startAgentServer(
  options: { env?: TestEnv; snapshots?: SnapshotStore; name?: string } = {},
) {
  const snapshots = options.snapshots ?? new MemorySnapshotStore();
  const name = options.name ?? "chat-1";
  const props = { principalSubject: "tester", workspaceId: "ws" };
  const host = createAgentHost({
    agentClass: TestAgent,
    env: options.env ?? { ENVIRONMENT: "local" },
    snapshots,
  });
  const server: Server = createServer(async (req, res) => {
    try {
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(key, value);
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        body,
      });
      const response = await host.fetch(request, name, props);
      res.statusCode = response.status;
      for (const [key, value] of response.headers) res.setHeader(key, value);
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (error) {
      res.statusCode = 500;
      res.end((error as Error).message);
    }
  });
  server.on("upgrade", (req, socket, head) => host.upgrade(req, socket, head, name, props));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    host,
    snapshots,
    origin,
    port,
    agent: () => TestAgent.instances.get(name),
    api: (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init),
    post: (path: string, body: unknown) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    async close() {
      await host.close();
      server.closeAllConnections();
      server.close();
      await once(server, "close").catch(() => {});
    },
  };
}

/**
 * A browser-equivalent client: the real `AgentClient` socket plus the real WebSocketChatTransport,
 * with the few lines of `useAgentChat`'s frame switch that hand resume frames to the transport.
 */
export async function connectClient(port: number) {
  const frames: Record<string, unknown>[] = [];
  const states: unknown[] = [];
  const client = new AgentClient({
    agent: "TestAgent",
    basePath: "agent",
    host: `127.0.0.1:${port}`,
    onStateUpdate: (state, source) => {
      if (source === "server") states.push(state);
    },
  });
  const transport = new WebSocketChatTransport({ agent: client });
  client.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    const data = JSON.parse(event.data) as Record<string, unknown>;
    frames.push(data);
    if (data.type === "cf_agent_stream_resuming")
      transport.handleStreamResuming(data as { id: string });
    if (data.type === "cf_agent_stream_resume_none") transport.handleStreamResumeNone(data);
    if (data.type === "cf_agent_stream_pending") transport.handleStreamPending();
  });
  await new Promise<void>((resolve) =>
    client.addEventListener("open", () => resolve(), { once: true }),
  );
  return {
    client,
    transport,
    frames,
    states,
    send(messages: UIMessage[], body?: Record<string, unknown>) {
      return transport.sendMessages({
        chatId: "chat",
        messages,
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
        ...(body ? { body } : {}),
      });
    },
    /** Resolves once a frame matching `predicate` has arrived (including ones already seen). */
    async waitFor(predicate: (frame: Record<string, unknown>) => boolean, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = frames.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out waiting for a frame");
    },
    close() {
      client.close();
    },
  };
}

export async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

export function deltas(chunks: UIMessageChunk[]) {
  return chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : "")).join("");
}

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met in time");
}
