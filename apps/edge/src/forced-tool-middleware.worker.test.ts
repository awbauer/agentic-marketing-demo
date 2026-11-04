import { describe, expect, it } from "vitest";
import {
  FORCED_TOOL_MAX_OUTPUT_TOKENS,
  forcedToolCallMiddleware,
  normalizeToolName,
  repairForcedToolStep,
  repairToolInput,
  salvageToolInput,
} from "./forced-tool-middleware";

type Middleware = typeof forcedToolCallMiddleware;
type WrapOptions = Parameters<NonNullable<Middleware["wrapStream"]>>[0];
const wrapStream = forcedToolCallMiddleware.wrapStream as NonNullable<Middleware["wrapStream"]>;
const transformParams = forcedToolCallMiddleware.transformParams as NonNullable<
  Middleware["transformParams"]
>;
type Params = WrapOptions["params"];
type Result = Awaited<ReturnType<WrapOptions["doStream"]>>;
type Part = Result["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 0, reasoning: 1 },
};
const leaked: Part[] = [
  { type: "stream-start", warnings: [] },
  { type: "reasoning-start", id: "r" },
  {
    type: "reasoning-delta",
    id: "r",
    delta: "We need to call the function salesforce_summarize_campaign.",
  },
  { type: "reasoning-delta", id: "r", delta: '{"message":"Summarize the sample campaign"}' },
  { type: "reasoning-end", id: "r" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];
const structured: Part[] = [
  { type: "tool-input-start", id: "c", toolName: "salesforce_summarize_campaign" },
  { type: "tool-input-end", id: "c" },
  { type: "tool-call", toolCallId: "c", toolName: "salesforce_summarize_campaign", input: "{}" },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
];
const empty: Part[] = [
  { type: "reasoning-start", id: "r" },
  { type: "reasoning-delta", id: "r", delta: " tool tool tool" },
  { type: "reasoning-end", id: "r" },
  { type: "finish", finishReason: { unified: "length", raw: "length" }, usage },
];

const params = {
  prompt: [],
  toolChoice: { type: "tool", toolName: "salesforce_summarize_campaign" },
  tools: [
    {
      type: "function",
      name: "salesforce_summarize_campaign",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  ],
} as unknown as Params;

async function read(stream: ReadableStream<Part>) {
  const parts: Part[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read())
    parts.push(next.value);
  return parts;
}

function run(attempts: Part[][], callParams: Params = params) {
  let calls = 0;
  const doStream = async () =>
    ({
      stream: new ReadableStream({
        start(c) {
          for (const p of attempts[calls++] ?? []) c.enqueue(p);
          c.close();
        },
      }),
    }) as Result;
  return wrapStream({
    doStream,
    doGenerate: async () => {
      throw new Error("unused");
    },
    params: callParams,
    model: {} as WrapOptions["model"],
  }).then(async (result) => ({ parts: await read(result.stream), calls: () => calls }));
}

describe("forced tool call middleware", () => {
  it("salvages trailing JSON arguments only when required keys are present", () => {
    expect(salvageToolInput('Call it.{"message":"hi"}\n', ["message"])).toBe('{"message":"hi"}');
    expect(salvageToolInput('Call it.{"other":"hi"}', ["message"])).toBeNull();
    expect(salvageToolInput('An example {"message":"hi"} then more words', ["message"])).toBeNull();
    expect(salvageToolInput('{"a":{"b":1}}', [])).toBe('{"a":{"b":1}}');
    expect(salvageToolInput("no json }", [])).toBeNull();
  });

  it("leaves structured tool calls untouched", () => {
    expect(repairForcedToolStep(structured, "", "salesforce_summarize_campaign", ["message"])).toBe(
      structured,
    );
  });

  it("streams reasoning live and turns a leaked tool call into a structured call", async () => {
    const { parts, calls } = await run([leaked]);
    expect(calls()).toBe(1);
    expect(parts.slice(0, 5).map((part) => part.type)).toEqual([
      "stream-start",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-delta",
      "reasoning-end",
    ]);
    const call = parts.find((part) => part.type === "tool-call");
    expect(call).toMatchObject({
      toolName: "salesforce_summarize_campaign",
      input: '{"message":"Summarize the sample campaign"}',
    });
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } });
  });

  it("retries once when no tool call can be recovered, keeping the first reasoning visible", async () => {
    const { parts, calls } = await run([empty, structured]);
    expect(calls()).toBe(2);
    expect(parts).toEqual([...empty.slice(0, 3), ...structured]);
  });

  it("returns the last attempt when every attempt fails", async () => {
    const { parts, calls } = await run([empty, empty, structured]);
    expect(calls()).toBe(2);
    expect(parts.filter((part) => part.type === "finish")).toHaveLength(1);
    expect(parts.some((part) => part.type === "tool-call")).toBe(false);
  });

  it("does not buffer or cap steps without a forced tool", async () => {
    const auto = { ...params, toolChoice: { type: "auto" } } as Params;
    const { calls } = await run([empty], auto);
    expect(calls()).toBe(1);
    await expect(
      transformParams({
        params: auto,
        type: "stream",
        model: {} as WrapOptions["model"],
      }),
    ).resolves.toBe(auto);
    await expect(
      transformParams({
        params,
        type: "stream",
        model: {} as WrapOptions["model"],
      }),
    ).resolves.toMatchObject({ maxOutputTokens: FORCED_TOOL_MAX_OUTPUT_TOKENS });
  });

  it("repairs tool names that contain leaked channel markup", async () => {
    const offered = new Set(["salesforce_summarize_campaign"]);
    expect(normalizeToolName("salesforce_summarize_campaign<|channel|>analysis", offered)).toBe(
      "salesforce_summarize_campaign",
    );
    expect(normalizeToolName("other_tool<|channel|>analysis", offered)).toBe(
      "other_tool<|channel|>analysis",
    );
    const namespaced = new Set([
      "tool_salesforce_ns_recommend_buyer_group",
      "tool_salesforce_ns_draft_campaign_content",
      "tool_salesforce_ns_draft_campaign_brief",
    ]);
    expect(normalizeToolName("recommend_buyer_group", namespaced)).toBe(
      "tool_salesforce_ns_recommend_buyer_group",
    );
    expect(normalizeToolName("salesforce_ns_draft_campaign_content", namespaced)).toBe(
      "tool_salesforce_ns_draft_campaign_content",
    );
    expect(normalizeToolName("campaign_brief<|channel|>commentary", namespaced)).toBe(
      "tool_salesforce_ns_draft_campaign_brief",
    );
    expect(normalizeToolName("draft", namespaced)).toBe("draft");
    const garbled = "salesforce_summarize_campaign<|channel|>analysis";
    const { parts } = await run([
      [
        { type: "tool-input-start", id: "c", toolName: garbled },
        { type: "tool-input-end", id: "c" },
        { type: "tool-call", toolCallId: "c", toolName: garbled, input: '{"message":"x"}' },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
      ],
    ]);
    expect(
      parts.flatMap((part) =>
        part.type === "tool-call" || part.type === "tool-input-start" ? [part.toolName] : [],
      ),
    ).toEqual(["salesforce_summarize_campaign", "salesforce_summarize_campaign"]);
  });

  it("retries a forced step that only called some other tool", async () => {
    const { parts, calls } = await run([
      [
        { type: "tool-input-start", id: "x", toolName: "other_tool" },
        { type: "tool-call", toolCallId: "x", toolName: "other_tool", input: "{}" },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
      ],
      structured,
    ]);
    expect(calls()).toBe(2);
    expect(parts).toEqual(structured);
  });

  it("recovers a forced call whose arguments leaked into the answer text, hiding that text", async () => {
    const { parts, calls } = await run([
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: '{"message":"Draft content for the audience"}' },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "error", raw: "stream-truncated" }, usage },
      ],
    ]);
    expect(calls()).toBe(1);
    expect(parts.some((part) => part.type === "text-delta")).toBe(false);
    expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
      input: '{"message":"Draft content for the audience"}',
    });
  });
  it("repairs tool arguments with raw newlines or argument markup, and rejects cut-off JSON", () => {
    expect(repairToolInput('{"message":"hi"}')).toBe('{"message":"hi"}');
    expect(JSON.parse(repairToolInput('{"message":"line one\nline two\t\\"ok\\""}') ?? "")).toEqual(
      {
        message: 'line one\nline two\t"ok"',
      },
    );
    expect(
      JSON.parse(
        repairToolInput(
          "<tool_call>salesforce_draft<arg_key>message</arg_key><arg_value>Draft a brief.</arg_value></tool_call>",
        ) ?? "",
      ),
    ).toEqual({ message: "Draft a brief." });
    expect(
      repairToolInput(
        '{"message":"Draft a campaign brief for Coastline Kitchen. Objective: Email c',
      ),
    ).toBeNull();
    // Anything after the object is dropped: a literal "\n" the model appended, or channel markup.
    expect(
      JSON.parse(repairToolInput('{"inputs":[{"briefId":"21yjV0000004NpFQAU"}]}\\n') ?? ""),
    ).toEqual({
      inputs: [{ briefId: "21yjV0000004NpFQAU" }],
    });
    expect(JSON.parse(repairToolInput('{"message":"Use {braces} here"}<|call|>') ?? "")).toEqual({
      message: "Use {braces} here",
    });
  });

  it("retries a forced call whose arguments were cut off, instead of passing them on", async () => {
    const cutOff: Part[] = [
      { type: "tool-input-start", id: "c", toolName: "salesforce_summarize_campaign" },
      { type: "tool-input-delta", id: "c", delta: '{"message":"Summarize the sam' },
      { type: "tool-input-end", id: "c" },
      {
        type: "tool-call",
        toolCallId: "c",
        toolName: "salesforce_summarize_campaign",
        input: '{"message":"Summarize the sam',
      },
      { type: "finish", finishReason: { unified: "length", raw: "length" }, usage },
    ];
    const { parts, calls } = await run([cutOff, structured]);
    expect(calls()).toBe(2);
    expect(parts).toEqual(structured);
  });

  it("repairs a forced call's arguments in place when they only need escaping", async () => {
    const { parts, calls } = await run([
      [
        {
          type: "tool-call",
          toolCallId: "c",
          toolName: "salesforce_summarize_campaign",
          input: '{"message":"one\ntwo"}',
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
      ],
    ]);
    expect(calls()).toBe(1);
    expect(parts.find((part) => part.type === "tool-call")).toMatchObject({
      input: '{"message":"one\\ntwo"}',
    });
  });
  it("keeps tool calls out of an answer step, retrying once when a call was all it produced", async () => {
    const answerParams = {
      prompt: [],
      toolChoice: { type: "none" },
      tools: [],
    } as unknown as Params;
    const strayCall: Part[] = [
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "r" },
      { type: "reasoning-delta", id: "r", delta: "Call the tool again." },
      { type: "reasoning-end", id: "r" },
      { type: "tool-input-start", id: "x", toolName: "draft_campaign_brief<|channel|>analysis" },
      {
        type: "tool-call",
        toolCallId: "x",
        toolName: "draft_campaign_brief<|channel|>analysis",
        input: "{}",
      },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
    ];
    const answer: Part[] = [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Here is the brief." },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ];
    const retried = await run([strayCall, answer], answerParams);
    expect(retried.calls()).toBe(2);
    expect(retried.parts.some((part) => part.type === "tool-call")).toBe(false);
    expect(retried.parts.map((part) => part.type)).toEqual([
      "stream-start",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);

    // With an answer, a stray call is dropped and the step simply stops.
    const withText = await run([[...answer.slice(0, 4), ...strayCall.slice(4)]], answerParams);
    expect(withText.calls()).toBe(1);
    expect(withText.parts.some((part) => part.type === "tool-call")).toBe(false);
    expect(withText.parts.at(-1)).toMatchObject({ finishReason: { unified: "stop" } });
  });
});
