import type { UIMessageChunk, UIMessageStreamWriter } from "ai";
import { describe, expect, it } from "vitest";
import { stepToolChoice } from "./orchestrator";
import { MAX_TURN_STEPS } from "./turn-policy";
import { createTurnTracer, describeTurnError } from "./turn-trace";

function harness(
  options: { userAbortSignal?: AbortSignal; composeEmptyAnswer?: () => string | null } = {},
) {
  const written: UIMessageChunk[] = [];
  const writer = {
    write: (chunk: UIMessageChunk) => written.push(chunk),
    merge: () => undefined,
    onError: undefined,
  } as unknown as UIMessageStreamWriter;
  let clock = 0;
  const tracer = createTurnTracer(writer, {
    model: "test-model",
    toolCount: 1,
    timeoutSeconds: 150,
    now: () => (clock += 10),
    ...options,
  });
  const text = () =>
    written
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => (chunk as { delta: string }).delta)
      .join("");
  return { tracer, written, text };
}

function source(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const toolTurn: UIMessageChunk[] = [
  { type: "start" },
  { type: "start-step" },
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: "plan" },
  { type: "reasoning-end", id: "r1" },
  { type: "tool-input-start", toolCallId: "c1", toolName: "sf_summarize_campaign" },
  { type: "tool-input-available", toolCallId: "c1", toolName: "sf_summarize_campaign", input: {} },
  { type: "tool-output-available", toolCallId: "c1", output: { ok: true } },
  { type: "finish-step" },
];

describe("turn tracer", () => {
  it("records every lifecycle event and forwards reasoning and text", async () => {
    const { tracer, written, text } = harness();
    const { outcome, trace } = await tracer.pipe(
      source([
        ...toolTurn,
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Summary." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish", finishReason: "stop" },
      ]),
    );
    expect(outcome).toBe("completed");
    expect(text()).toBe("Summary.");
    expect(trace.events.map((event) => event.kind)).toEqual([
      "turn-start",
      "step-start",
      "reasoning-start",
      "reasoning-end",
      "tool-input-start",
      "tool-input-available",
      "tool-output-available",
      "step-start",
      "text-start",
      "text-end",
      "turn-finish",
    ]);
    expect(written.some((chunk) => chunk.type === "reasoning-delta")).toBe(true);
    expect(written.at(-1)).toMatchObject({ type: "finish" });
    expect(written[0]).toMatchObject({ type: "start" });
  });

  it("explains an empty answer after a completed tool instead of ending silently", async () => {
    const { tracer, text } = harness();
    const { outcome, trace } = await tracer.pipe(source([...toolTurn, { type: "finish" }]));
    expect(outcome).toBe("completed");
    expect(text()).toMatch(/did not write a summary/);
    expect(trace.events.map((event) => event.kind)).toContain("fallback-text");
  });

  it("answers an empty turn with the caller's composed answer when it has one", async () => {
    const { tracer, text } = harness({ composeEmptyAnswer: () => "The agent drafted a brief." });
    const { outcome, trace, answer } = await tracer.pipe(source([...toolTurn, { type: "finish" }]));
    expect(outcome).toBe("completed");
    expect(text()).toBe("The agent drafted a brief.");
    expect(answer).toBe("The agent drafted a brief.");
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "fallback-text", reason: "composed" }),
    );
    // Without a composed answer, the generic recovery message is used.
    const generic = harness({ composeEmptyAnswer: () => null });
    await generic.tracer.pipe(source([...toolTurn, { type: "finish" }]));
    expect(generic.text()).toMatch(/did not write a summary/);
  });

  it("converts stream errors into a visible explanation without forwarding the error chunk", async () => {
    const { tracer, written, text } = harness();
    const { outcome, trace } = await tracer.pipe(
      source([
        ...toolTurn,
        { type: "start-step" },
        { type: "error", errorText: "InferenceUpstreamError: 502" },
      ]),
    );
    expect(outcome).toBe("failed");
    expect(written.some((chunk) => chunk.type === "error")).toBe(false);
    expect(text()).toMatch(/InferenceUpstreamError: 502.*Salesforce did return a result/);
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "error", message: "InferenceUpstreamError: 502" }),
    );
  });

  it("reports a timeout and closes any open text part", async () => {
    const { tracer, written, text } = harness();
    const { outcome } = await tracer.pipe(
      source([
        { type: "start" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Partial" },
        { type: "abort", reason: "TimeoutError: The operation timed out." },
      ]),
    );
    expect(outcome).toBe("timed-out");
    expect(written).toContainEqual({ type: "text-end", id: "t1" });
    expect(text()).toMatch(/^Partial\n\nThis turn reached the 150-second limit/);
  });

  it("does not add a recovery message when the user stopped the turn", async () => {
    const controller = new AbortController();
    controller.abort();
    const { tracer, text } = harness({ userAbortSignal: controller.signal });
    const { outcome } = await tracer.pipe(source([{ type: "start" }, { type: "abort" }]));
    expect(outcome).toBe("aborted");
    expect(text()).toBe("");
  });

  it("explains setup failures that happen before the model stream starts", async () => {
    const { tracer, written, text } = harness();
    const { outcome } = await tracer.pipe(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("bad message"));
        },
      }),
    );
    expect(outcome).toBe("failed");
    expect(written[0]).toMatchObject({ type: "start" });
    expect(text()).toMatch(/TypeError: bad message/);
  });

  it("explains Workers AI daily capacity errors instead of echoing the provider payload", () => {
    const message = describeTurnError(
      new Error(
        'Failed after 3 attempts. Last error: Workers AI API error (429 ): {"errors":[{"message":"AiError: you have used up your daily free allocation of 10,000 neurons"}]}',
      ),
    );
    expect(message).toMatch(/^Workers AI has reached this account's daily capacity/);
    expect(message).toContain("00:00 UTC");
  });

  it("redacts credentials from error messages", () => {
    expect(describeTurnError(new Error("failed with Bearer abc.def"))).toBe(
      "failed with [redacted]",
    );
  });

  it("offers a scenario's tools without forcing one, and none on text-only steps", () => {
    expect(stepToolChoice(undefined, 0)).toBeUndefined();
    expect(stepToolChoice(undefined, MAX_TURN_STEPS - 1)).toEqual({
      toolChoice: "none",
      activeTools: [],
    });
    // The first step must look something up; which tool is the model's choice.
    expect(stepToolChoice("sf_summarize_campaign", 0)).toEqual({
      toolChoice: "required",
      activeTools: ["sf_summarize_campaign"],
    });
    expect(stepToolChoice("sf_summarize_campaign", 1)).toEqual({
      toolChoice: "none",
      activeTools: [],
    });
  });

  it("records an invalid tool call once even though the SDK reports it twice", async () => {
    const { tracer } = harness();
    const { trace } = await tracer.pipe(
      source([
        { type: "start" },
        {
          type: "tool-input-start",
          toolCallId: "bad",
          toolName: "sf_summarize_campaign<|channel|>analysis",
        },
        {
          type: "tool-input-error",
          toolCallId: "bad",
          toolName: "sf_summarize_campaign<|channel|>analysis",
          input: {},
          errorText: "AI_NoSuchToolError",
        },
        { type: "tool-output-error", toolCallId: "bad", errorText: "AI_NoSuchToolError" },
        { type: "finish" },
      ]),
    );
    expect(
      trace.events.filter((event) => event.kind.startsWith("tool-")).map((e) => e.kind),
    ).toEqual(["tool-input-start", "tool-input-error"]);
  });
});
