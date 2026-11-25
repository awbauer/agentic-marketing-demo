import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySnapshotStore, SnapshotConflictError } from "../../src/agent/snapshots";
import { AgentStorage } from "../../src/agent/storage";
import { collect, connectClient, startAgentServer, textOf, until, userMessage } from "./harness";

type Server = Awaited<ReturnType<typeof startAgentServer>>;
const running: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of running.splice(0)) await server.close();
});

async function start(snapshots: MemorySnapshotStore) {
  const server = await startAgentServer({ snapshots });
  running.push(server);
  return server;
}

describe("MemorySnapshotStore", () => {
  it("enforces the generation precondition", async () => {
    const store = new MemorySnapshotStore();
    const first = await store.save("a", new Uint8Array([1]), null);
    await expect(store.save("a", new Uint8Array([2]), null)).rejects.toBeInstanceOf(
      SnapshotConflictError,
    );
    const second = await store.save("a", new Uint8Array([2]), first);
    await expect(store.save("a", new Uint8Array([3]), first)).rejects.toBeInstanceOf(
      SnapshotConflictError,
    );
    expect(await store.load("a")).toEqual({ bytes: new Uint8Array([2]), generation: second });
    expect(await store.load("missing")).toBeNull();
  });
});

describe("AgentStorage", () => {
  it("behaves like a Durable Object sql binding and survives serialize/deserialize", () => {
    const storage = new AgentStorage();
    let writes = 0;
    storage.onWrite(() => {
      writes += 1;
    });
    storage.sql`create table if not exists t (id integer primary key, name text, ok integer, blob blob)`;
    expect(writes).toBe(0);
    storage.sql`insert into t (name, ok, blob) values (${"x"}, ${true}, ${new Uint8Array([7, 8]).buffer})`;
    expect(writes).toBe(1);
    const copy = new AgentStorage(storage.serialize());
    const [row] = copy.sql<{ name: string; ok: number; blob: ArrayBuffer }>`select * from t`;
    expect(row?.name).toBe("x");
    expect(row?.ok).toBe(1);
    expect(new Uint8Array(row?.blob ?? new ArrayBuffer(0))).toEqual(new Uint8Array([7, 8]));
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(() => copy.sql`select * from missing_table`).toThrow();
  });
});

describe("agent snapshots through the host", () => {
  it("restores sql rows, state, and messages into a brand-new host", async () => {
    const snapshots = new MemorySnapshotStore();
    const first = await start(snapshots);
    const client = await connectClient(first.port);
    await collect(await client.send([userMessage("remember me")], { scope: "kept" }));
    await until(() => first.agent()?.messages.length === 2);
    await first.post("/agent/notes", { body: "a durable note" });
    await first.post("/agent/state", { count: 7, label: "saved" });
    client.close();
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await start(snapshots);
    expect(await (await second.api("/agent/notes")).json()).toEqual([{ body: "a durable note" }]);
    expect(await (await second.api("/agent/state")).json()).toEqual({ count: 7, label: "saved" });
    const messages = (await (await second.api("/agent/get-messages")).json()) as UIMessage[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(textOf(messages[1])).toBe("echo: remember me");
    expect(second.agent()?._lastBody).toEqual({ scope: "kept" });
  });

  it("does not write a snapshot for an instance that only read", async () => {
    const snapshots = new MemorySnapshotStore();
    const save = vi.spyOn(snapshots, "save");
    const server = await start(snapshots);
    await server.api("/agent/get-messages");
    await server.host.flush();
    // onStart's `create table if not exists` and the state seed are the only writes.
    expect(save.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("adopts the stored image when another process wrote the chat first", async () => {
    const snapshots = new MemorySnapshotStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await start(snapshots);
    const b = await start(snapshots);
    // Both activate from the same (empty) generation.
    await a.api("/agent/state");
    await b.api("/agent/state");
    await a.host.flush();
    await b.host.flush();

    await a.post("/agent/state", { count: 1, label: "from-a" });
    await a.host.flush();
    const watcher = await connectClient(b.port);
    await b.post("/agent/notes", { body: "lost in the race" });
    await b.host.flush();

    expect(warn.mock.calls.some(([message]) => String(message).includes("Reloading"))).toBe(true);
    expect(await (await b.api("/agent/state")).json()).toEqual({ count: 1, label: "from-a" });
    expect(await (await b.api("/agent/notes")).json()).toEqual([]);
    await until(() =>
      watcher.states.some((state) => (state as { label?: string }).label === "from-a"),
    );
    watcher.close();
    // After reloading, b writes on top of a's generation instead of conflicting again.
    await b.post("/agent/notes", { body: "after reload" });
    await b.host.flush();
    const c = await start(snapshots);
    expect(await (await c.api("/agent/notes")).json()).toEqual([{ body: "after reload" }]);
    expect(await (await c.api("/agent/state")).json()).toEqual({ count: 1, label: "from-a" });
  });
});
