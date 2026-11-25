import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { AgentContext, AIChatAgent, Connection } from "./ai-chat";
import { SnapshotConflictError, type SnapshotStore } from "./snapshots";
import { AgentStorage } from "./storage";

/**
 * The Durable Object runtime's job, done in one Node process: one live agent per name, its storage
 * loaded from and saved to a snapshot store, its WebSockets, and eviction once it goes quiet.
 */

const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 250;
const SAVE_MAX_DELAY_MS = 2_000;
const RETRY_DELAY_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const DRAIN_TIMEOUT_MS = 5_000;

/** Any subclass: each narrows its constructor, State, and Props, which `unknown` would reject. */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type AgentClass<E> = new (...args: any[]) => AIChatAgent<E, any, any>;

export interface AgentHostOptions<E> {
  agentClass: AgentClass<E>;
  env: E;
  snapshots: SnapshotStore;
  /** Defaults to ten minutes. */
  idleTimeoutMs?: number;
  /** How long `close()` lets in-flight turns finish before aborting them; defaults to five seconds. */
  drainTimeoutMs?: number;
}

export interface AgentHost {
  /** HTTP requests for /agent and /agent/* (non-upgrade). */
  fetch(request: Request, name: string, props: Record<string, unknown>): Promise<Response>;
  /** Node 'upgrade' event for /agent WebSockets; uses the `ws` package (noServer mode). */
  upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    name: string,
    props: Record<string, unknown>,
  ): void;
  /** Writes every dirty instance (or one) to the snapshot store now. */
  flush(name?: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Coalesces an instance's writes into snapshot saves. On a generation conflict another process
 * wrote the chat; that image wins, and the instance adopts it.
 */
class Persister {
  #generation: string | null;
  #dirty = false;
  #dirtySince = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly snapshots: SnapshotStore,
    private readonly storage: AgentStorage,
    generation: string | null,
    private readonly onReloaded: () => void,
  ) {
    this.#generation = generation;
  }

  markDirty() {
    if (!this.#dirty) this.#dirtySince = Date.now();
    this.#dirty = true;
    this.#schedule(SAVE_DEBOUNCE_MS);
  }

  async flush() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    while (this.#saving || this.#dirty) {
      if (this.#saving) await this.#saving;
      else await this.#start();
    }
  }

  dispose() {
    clearTimeout(this.#timer);
  }

  /** Debounces bursts of writes, but never lets a steady stream of them postpone a save forever. */
  #schedule(delay: number) {
    if (this.#saving) return;
    clearTimeout(this.#timer);
    const wait = Math.max(0, Math.min(delay, this.#dirtySince + SAVE_MAX_DELAY_MS - Date.now()));
    this.#timer = setTimeout(() => void this.#start().catch(() => {}), wait);
    this.#timer.unref?.();
  }

  #start() {
    let failed = false;
    this.#saving = this.#save()
      .catch((error: unknown) => {
        failed = true;
        throw error;
      })
      .finally(() => {
        this.#saving = null;
        if (!this.#dirty) return;
        if (failed) {
          clearTimeout(this.#timer);
          this.#timer = setTimeout(() => void this.#start().catch(() => {}), RETRY_DELAY_MS);
          this.#timer.unref?.();
        } else this.#schedule(SAVE_DEBOUNCE_MS);
      });
    return this.#saving;
  }

  async #save() {
    this.#dirty = false;
    const bytes = this.storage.serialize();
    try {
      this.#generation = await this.snapshots.save(this.name, bytes, this.#generation);
    } catch (error) {
      if (!(error instanceof SnapshotConflictError)) {
        console.error(`[agent-host] saving snapshot "${this.name}" failed; will retry:`, error);
        if (!this.#dirty) this.#dirtySince = Date.now();
        this.#dirty = true;
        throw error;
      }
      console.warn(`[agent-host] ${error.message} Reloading the stored snapshot.`);
      const latest = await this.snapshots.load(this.name);
      this.storage.replace(latest?.bytes ?? null);
      this.#generation = latest?.generation ?? null;
      this.#dirty = false;
      this.onReloaded();
    }
  }
}

interface LiveAgent {
  agent: AIChatAgent<unknown, unknown, Record<string, unknown>>;
  storage: AgentStorage;
  persister: Persister;
  sockets: Set<WebSocket>;
  background: Set<Promise<unknown>>;
  inflight: number;
  lastActive: number;
}

interface Slot {
  ready: Promise<LiveAgent>;
  evicting: Promise<void> | null;
}

export function createAgentHost<E>(opts: AgentHostOptions<E>): AgentHost {
  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const drainMs = opts.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
  const slots = new Map<string, Slot>();
  const wss = new WebSocketServer({ noServer: true });
  let closed = false;
  const sweeper = setInterval(() => void sweep(), Math.min(60_000, Math.max(1_000, idleMs / 4)));
  sweeper.unref();

  async function activate(name: string, props: Record<string, unknown>): Promise<LiveAgent> {
    const snapshot = await opts.snapshots.load(name);
    const storage = new AgentStorage(snapshot?.bytes);
    const background = new Set<Promise<unknown>>();
    const ctx: AgentContext = {
      id: { name, toString: () => name },
      storage,
      waitUntil(promise) {
        const tracked = Promise.resolve(promise)
          .catch((error: unknown) =>
            console.error(`[agent-host] background work in "${name}" failed:`, error),
          )
          .finally(() => background.delete(tracked));
        background.add(tracked);
      },
    };
    const agent = new opts.agentClass(ctx, opts.env) as LiveAgent["agent"];
    const persister = new Persister(
      name,
      opts.snapshots,
      storage,
      snapshot?.generation ?? null,
      () => agent._hostReloaded(),
    );
    storage.onWrite(() => persister.markDirty());
    const live: LiveAgent = {
      agent,
      storage,
      persister,
      sockets: new Set(),
      background,
      inflight: 0,
      lastActive: Date.now(),
    };
    try {
      await agent._hostStart(props);
    } catch (error) {
      persister.dispose();
      await agent.mcp.closeAll();
      storage.close();
      throw error;
    }
    return live;
  }

  /** One activation per name; a request that arrives mid-eviction waits and starts a fresh one. */
  async function acquire(name: string, props: Record<string, unknown>): Promise<LiveAgent> {
    for (;;) {
      if (closed) throw new Error("The agent host is closed.");
      const slot = slots.get(name);
      if (slot?.evicting) {
        await slot.evicting.catch(() => {});
        continue;
      }
      if (slot) return slot.ready;
      const ready = activate(name, props);
      const created: Slot = { ready, evicting: null };
      slots.set(name, created);
      ready.catch(() => {
        if (slots.get(name) === created) slots.delete(name);
      });
      return ready;
    }
  }

  function busy(live: LiveAgent) {
    return (
      live.sockets.size > 0 ||
      live.inflight > 0 ||
      live.background.size > 0 ||
      live.agent._hostBusy()
    );
  }

  async function shutdown(live: LiveAgent) {
    await live.persister
      .flush()
      .catch((error: unknown) => console.error("[agent-host] final snapshot save failed:", error));
    live.persister.dispose();
    await live.agent.mcp.closeAll();
    live.storage.close();
  }

  async function sweep() {
    const now = Date.now();
    for (const [name, slot] of slots) {
      if (slot.evicting) continue;
      const live = await slot.ready.catch(() => null);
      if (!live || busy(live) || now - live.lastActive < idleMs || slots.get(name) !== slot)
        continue;
      slot.evicting = shutdown(live).finally(() => {
        if (slots.get(name) === slot) slots.delete(name);
      });
    }
  }

  async function fetch(request: Request, name: string, props: Record<string, unknown>) {
    const live = await acquire(name, props);
    live.inflight += 1;
    live.lastActive = Date.now();
    try {
      return await live.agent._hostFetch(request);
    } finally {
      live.inflight -= 1;
      live.lastActive = Date.now();
    }
  }

  function upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    name: string,
    props: Record<string, unknown>,
  ) {
    if (closed) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const connection: Connection = {
        id: crypto.randomUUID(),
        uri: url,
        send(message) {
          // A send racing a disconnect is dropped, as `sendIfOpen` does on Workers.
          if (ws.readyState === WebSocket.OPEN) ws.send(message);
        },
        close(code, reason) {
          ws.close(code, reason);
        },
      };
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const ready = acquire(name, props).then(async (live) => {
        live.sockets.add(ws);
        live.lastActive = Date.now();
        await live.agent._hostConnect(connection, new Request(url, { headers }));
        return live;
      });
      ready.catch((error: unknown) => {
        console.error(`[agent-host] connecting to "${name}" failed:`, error);
        ws.close(1011, "Agent unavailable");
      });
      // Frames start in arrival order once connected, then run concurrently like DO events.
      ws.on("message", (data: RawData, isBinary: boolean) => {
        void ready
          .then((live) => {
            live.lastActive = Date.now();
            // A chat turn runs inside its frame's handler; tracking it lets close() drain it.
            const handled = Promise.resolve(
              live.agent._hostMessage(connection, isBinary ? toArrayBuffer(data) : data.toString()),
            ).finally(() => {
              live.background.delete(handled);
              live.lastActive = Date.now();
            });
            live.background.add(handled);
            return handled;
          })
          .catch((error: unknown) =>
            console.error(`[agent-host] message on "${name}" failed:`, error),
          );
      });
      let alive = true;
      ws.on("pong", () => {
        alive = true;
      });
      // Idle proxies drop silent sockets; a ping keeps the chat socket open between turns.
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, HEARTBEAT_MS);
      heartbeat.unref();
      ws.on("close", (code: number, reason: Buffer) => {
        clearInterval(heartbeat);
        void ready
          .then((live) => {
            live.sockets.delete(ws);
            live.lastActive = Date.now();
            return live.agent._hostClose(connection, code, reason.toString(), code !== 1006);
          })
          .catch(() => {});
      });
    });
  }

  async function flush(name?: string) {
    const targets = name ? [slots.get(name)] : [...slots.values()];
    await Promise.all(
      targets.map(async (slot) => {
        const live = await slot?.ready.catch(() => null);
        await live?.persister.flush();
      }),
    );
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(sweeper);
    const lives = (
      await Promise.all([...slots.values()].map((slot) => slot.ready.catch(() => null)))
    ).filter((live): live is LiveAgent => live !== null);
    for (const live of lives) for (const ws of live.sockets) ws.close(1001, "Server shutting down");
    await Promise.race([
      Promise.allSettled(lives.flatMap((live) => [...live.background])),
      delay(drainMs),
    ]);
    // Whatever is still running is cut short so its partial answer is persisted before the save.
    for (const live of lives) live.agent.abortAllRequests();
    await Promise.race([
      Promise.allSettled(lives.flatMap((live) => [...live.background])),
      delay(500),
    ]);
    await Promise.all(lives.map((live) => shutdown(live)));
    slots.clear();
    wss.close();
  }

  return { fetch, upgrade, flush, close };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
}

function toArrayBuffer(data: RawData): ArrayBuffer {
  const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
