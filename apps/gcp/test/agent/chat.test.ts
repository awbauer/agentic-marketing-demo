import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  collect,
  connectClient,
  deltas,
  startAgentServer,
  TestAgent,
  textOf,
  until,
  userMessage,
} from "./harness";

type Server = Awaited<ReturnType<typeof startAgentServer>>;
type Client = Awaited<ReturnType<typeof connectClient>>;

let server: Server | undefined;
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  TestAgent.releaseSlow = null;
  await server?.close();
  server = undefined;
});

async function open() {
  server = await startAgentServer();
  return server;
}

async function client(port: number) {
  const connected = await connectClient(port);
  clients.push(connected);
  return connected;
}

describe("AIChatAgent over the real agents client protocol", () => {
  it("sends state, MCP servers, and messages on connect, but no identity when it is off", async () => {
    const { port } = await open();
    const a = await client(port);
    await a.waitFor((frame) => frame.type === "cf_agent_chat_messages");
    const types = a.frames.map((frame) => frame.type);
    expect(types.slice(0, 3)).toEqual([
      "cf_agent_state",
      "cf_agent_mcp_servers",
      "cf_agent_chat_messages",
    ]);
    expect(types).not.toContain("cf_agent_identity");
    expect(a.states).toEqual([{ count: 0 }]);
    expect(server?.agent()?.startedWith).toEqual({ principalSubject: "tester", workspaceId: "ws" });
  });

  it("streams a full turn to the client and persists the assistant message", async () => {
    const { port, api } = await open();
    const a = await client(port);
    const observer = await client(port);
    const question = userMessage("hello there");
    const chunks = await collect(await a.send([question], { scope: { brand: "acme" } }));

    expect(deltas(chunks)).toBe("echo: hello there");
    expect(chunks[0]).toMatchObject({ type: "start" });
    expect(chunks.at(-1)).toMatchObject({ type: "finish" });

    const agent = server?.agent();
    expect(agent?.turns[0]?.body).toEqual({ scope: { brand: "acme" } });
    expect(agent?._lastBody).toEqual({ scope: { brand: "acme" } });
    await until(() => (agent?.messages.length ?? 0) === 2);
    expect(agent?.messages[0]?.id).toBe(question.id);
    expect(agent?.messages[1]?.role).toBe("assistant");
    expect(textOf(agent?.messages[1])).toBe("echo: hello there");
    expect(agent?._streamingMessage).toBeNull();

    const stored = (await (await api("/agent/get-messages")).json()) as UIMessage[];
    expect(stored.map((message) => message.role)).toEqual(["user", "assistant"]);
    // Another tab sees the user message and the live stream, then the persisted transcript.
    await observer.waitFor(
      (frame) => frame.type === "cf_agent_use_chat_response" && frame.done === true,
    );
    const synced = await observer.waitFor(
      (frame) =>
        frame.type === "cf_agent_chat_messages" &&
        Array.isArray(frame.messages) &&
        frame.messages.length === 2,
    );
    expect(textOf((synced.messages as UIMessage[])[1])).toBe("echo: hello there");
  });

  it("cancels a running turn and keeps the partial answer", async () => {
    const { port } = await open();
    const a = await client(port);
    const stream = await a.send([userMessage("slow")]);
    const reader = stream.getReader();
    const seen: string[] = [];
    while (!seen.join("").includes("first")) {
      const { value } = await reader.read();
      if (value?.type === "text-delta") seen.push(value.delta);
    }
    expect(a.transport.cancelActiveServerTurn()).toBe(true);
    const agent = server?.agent();
    await until(() => (agent?.abortedTurns.length ?? 0) === 1);
    await until(() => agent?.messages.length === 2);
    expect(textOf(agent?.messages[1])).toBe("first ");
    expect(agent?.isChatTurnActive()).toBe(false);
  });

  it("answers a message queued behind a running turn, not the running turn's answer", async () => {
    const { port } = await open();
    const a = await client(port);
    const b = await client(port);
    const slow = await a.send([userMessage("slow")]);
    const reader = slow.getReader();
    while (TestAgent.releaseSlow === null) await reader.read();
    // A second tab asks while the first turn is still streaming; its turn waits in the queue.
    const queued = b.send([userMessage("second question")]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    TestAgent.releaseSlow?.();
    while (!(await reader.read()).done) {}
    const answer = deltas(await collect(await queued));
    expect(answer).toBe("echo: second question");
  });

  it("clears the transcript for every connection", async () => {
    const { port, api } = await open();
    const a = await client(port);
    const b = await client(port);
    await collect(await a.send([userMessage("one")]));
    await until(() => server?.agent()?.messages.length === 2);

    a.client.send(JSON.stringify({ type: "cf_agent_chat_clear" }));
    await b.waitFor((frame) => frame.type === "cf_agent_chat_clear");
    expect(server?.agent()?.messages).toEqual([]);
    expect(server?.agent()?._lastBody).toBeUndefined();
    expect(await (await api("/agent/get-messages")).json()).toEqual([]);
  });

  it("answers a resume probe with resume-none when no turn is running", async () => {
    const { port } = await open();
    const a = await client(port);
    await expect(a.transport.reconnectToStream({ chatId: "chat" })).resolves.toBeNull();
    const none = await a.waitFor((frame) => frame.type === "cf_agent_stream_resume_none");
    expect(none).toMatchObject({ reason: "idle" });
    expect(typeof none.probeId).toBe("string");
  });

  it("lets a reconnecting client resume an in-flight stream from the buffered chunks", async () => {
    const { port } = await open();
    const a = await client(port);
    const first = await a.send([userMessage("slow")]);
    const firstReader = first.getReader();
    await firstReader.read();
    await until(() => TestAgent.releaseSlow !== null);

    const b = await client(port);
    const resumed = await b.transport.reconnectToStream({ chatId: "chat" });
    expect(resumed).not.toBeNull();
    await b.waitFor(
      (frame) => frame.type === "cf_agent_use_chat_response" && frame.replayComplete === true,
    );
    TestAgent.releaseSlow?.();
    const chunks = await collect(resumed as ReadableStream);
    expect(deltas(chunks)).toBe("first second");
  });

  it("broadcasts setState from a client to others and from the server to everyone", async () => {
    const { port, post } = await open();
    const a = await client(port);
    const b = await client(port);
    a.client.setState({ count: 5 });
    await until(() => b.states.some((state) => (state as { count: number }).count === 5));
    expect(server?.agent()?.state).toEqual({ count: 5 });
    // The sender already holds the value it sent, so it is not echoed back.
    expect(a.states.some((state) => (state as { count: number }).count === 5)).toBe(false);

    await post("/agent/state", { label: "from-server" });
    await until(() =>
      a.states.some((state) => (state as { label?: string }).label === "from-server"),
    );
    await until(() =>
      b.states.some((state) => (state as { label?: string }).label === "from-server"),
    );
  });

  it("runs saveMessages turns through onChatMessage with the last body, like a browser turn", async () => {
    const { port, post } = await open();
    const a = await client(port);
    const response = await post("/agent/turn", { text: "from apex" });
    expect(await response.json()).toMatchObject({ status: "completed" });
    const agent = server?.agent();
    expect(agent?.turns[0]?.body).toEqual({ scope: "surface" });
    expect(textOf(agent?.messages[1])).toBe("echo: from apex");
    await a.waitFor((frame) => frame.type === "cf_agent_use_chat_response" && frame.done === true);
  });

  it("ends the client's request with an error when onChatMessage throws", async () => {
    const { port } = await open();
    const a = await client(port);
    await expect(collect(await a.send([userMessage("boom")]))).rejects.toThrow(
      "the model exploded",
    );
  });

  it("ignores unknown and malformed frames", async () => {
    const { port } = await open();
    const a = await client(port);
    a.client.send(JSON.stringify({ type: "something_new" }));
    a.client.send("not json");
    a.client.send(JSON.stringify(42));
    const chunks = await collect(await a.send([userMessage("still alive")]));
    expect(deltas(chunks)).toBe("echo: still alive");
  });

  it("answers unclaimed HTTP paths with the base 404", async () => {
    const { api } = await open();
    const response = await api("/agent/nothing-here");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not implemented");
  });
});
