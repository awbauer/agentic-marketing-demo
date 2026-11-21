// Claude, through the official Anthropic SDK, as a model the squad's agent loop can drive. The loop,
// the tools, the gateway and the rules stay the same whichever provider runs the agents; this file
// only translates one model call to the Messages API and back.
//
// Three things differ from the other providers:
// - Claude Opus 5.5 does not accept a forced tool choice, so a forced step asks for `auto` and says
//   which tool to call in a mid-conversation system message (the operator channel).
// - Thinking is always on, and its blocks must come back unchanged on the next turn. Each assistant
//   turn's raw content rides along in the AI SDK's provider metadata and is replayed exactly.
// - Refusals fall back server-side (`fallbacks: "default"`), and the prefix is cached.
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import Anthropic from "@anthropic-ai/sdk";
import { simulateStreamingMiddleware, wrapLanguageModel } from "ai";

/** Claude Opus 5.5 is the default; ANTHROPIC_TEAM_MODEL overrides it. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type Block = Anthropic.Beta.BetaContentBlock;
type BlockParam = Anthropic.Beta.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;

const META = "anthropic";

/** The AI SDK prompt as Messages API system text and messages. */
export function toAnthropic(prompt: LanguageModelV3Prompt): {
  system: string;
  messages: MessageParam[];
} {
  const system: string[] = [];
  const messages: MessageParam[] = [];
  const push = (role: "user" | "assistant", content: BlockParam[]) => {
    if (content.length === 0) return;
    const last = messages.at(-1);
    if (last && last.role === role && Array.isArray(last.content))
      (last.content as BlockParam[]).push(...content);
    else messages.push({ role, content });
  };
  for (const message of prompt) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "user") {
      push(
        "user",
        message.content.flatMap((part) =>
          part.type === "text" && part.text ? [{ type: "text" as const, text: part.text }] : [],
        ),
      );
      continue;
    }
    if (message.role === "assistant") {
      // A turn Claude wrote comes back exactly as it was returned: thinking blocks included.
      const raw = message.content
        .map((part) => part.providerOptions?.[META]?.raw)
        .find((value) => Array.isArray(value)) as BlockParam[] | undefined;
      if (raw) {
        push("assistant", raw);
        continue;
      }
      push(
        "assistant",
        message.content.flatMap((part): BlockParam[] => {
          if (part.type === "text" && part.text) return [{ type: "text", text: part.text }];
          if (part.type === "tool-call")
            return [
              {
                type: "tool_use",
                id: part.toolCallId,
                name: part.toolName,
                input:
                  typeof part.input === "string" ? safeJson(part.input) : (part.input as object),
              },
            ];
          return [];
        }),
      );
      continue;
    }
    // Tool results go back to Claude in a user turn.
    push(
      "user",
      message.content.flatMap((part): BlockParam[] => {
        if (part.type !== "tool-result") return [];
        const output = part.output;
        const text =
          output.type === "text" || output.type === "error-text"
            ? output.value
            : output.type === "json" || output.type === "error-json"
              ? JSON.stringify(output.value)
              : output.type === "execution-denied"
                ? `Not run: ${output.reason ?? "denied"}`
                : JSON.stringify(output);
        return [
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: text,
            ...(output.type === "error-text" || output.type === "error-json"
              ? { is_error: true }
              : {}),
          },
        ];
      }),
    );
  }
  return { system: system.join("\n\n"), messages };
}

const safeJson = (text: string): object => {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as object) : {};
  } catch {
    return {};
  }
};

/** What the AI SDK expects back from one call, built from Claude's response. */
export function fromAnthropic(response: Anthropic.Beta.BetaMessage): LanguageModelV3GenerateResult {
  const content: LanguageModelV3Content[] = [];
  for (const block of response.content as Block[]) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "thinking") content.push({ type: "reasoning", text: block.thinking });
    else if (block.type === "tool_use")
      content.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: JSON.stringify(block.input ?? {}),
      });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  // The whole turn, so the next request can replay it unchanged.
  const first = content[0] as LanguageModelV3Content & { providerMetadata?: unknown };
  first.providerMetadata = { [META]: { raw: JSON.parse(JSON.stringify(response.content)) } };
  const reason = response.stop_reason;
  const finishReason: LanguageModelV3FinishReason = {
    unified:
      reason === "tool_use"
        ? "tool-calls"
        : reason === "max_tokens"
          ? "length"
          : reason === "refusal"
            ? "content-filter"
            : "stop",
    raw: reason ?? undefined,
  };
  const usage = response.usage;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    content,
    finishReason,
    usage: {
      inputTokens: {
        total: usage.input_tokens + cacheRead + cacheWrite,
        noCache: usage.input_tokens,
        cacheRead,
        cacheWrite,
      },
      outputTokens: { total: usage.output_tokens, text: undefined, reasoning: undefined },
    },
    response: { id: response.id, modelId: response.model },
    warnings: [],
  };
}

/** The request for one call: tools, the forced-tool instruction, effort, fallback and caching. */
export function requestFor(
  options: LanguageModelV3CallOptions,
  model: string,
  effort: Effort,
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const { system, messages } = toAnthropic(options.prompt);
  const tools = (options.tools ?? []).flatMap((tool) =>
    tool.type === "function"
      ? [
          {
            name: tool.name,
            description: tool.description ?? "",
            input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
          },
        ]
      : [],
  );
  const choice = options.toolChoice;
  const forced =
    choice?.type === "tool"
      ? `Call the ${choice.toolName} tool now. Do not answer in prose.`
      : choice?.type === "required"
        ? "Call one of your tools now. Do not answer in prose."
        : null;
  // A mid-conversation system message must follow a user turn; ours always end on one.
  if (forced && messages.at(-1)?.role === "user")
    messages.push({ role: "system", content: forced });
  const request: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 16000,
    system: forced && messages.at(-1)?.role !== "system" ? `${system}\n\n${forced}` : system,
    messages,
    ...(tools.length
      ? { tools, tool_choice: choice?.type === "none" ? { type: "none" } : { type: "auto" } }
      : {}),
    output_config: { effort },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  return request;
}

/** A model for the squad's loop, backed by Claude through the Anthropic SDK. */
export function anthropicModel(options: {
  apiKey: string;
  model?: string;
  effort: Effort;
  baseURL?: string;
  /** Tests pass a fake fetch; everything else uses the runtime's. */
  fetch?: typeof fetch;
}): Exclude<import("ai").LanguageModel, string> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const modelId = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const base: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "anthropic.messages",
    modelId,
    supportedUrls: {},
    async doGenerate(call) {
      const response = await client.beta.messages.create(
        requestFor(call, modelId, options.effort),
        {
          ...(call.abortSignal ? { signal: call.abortSignal } : {}),
        },
      );
      return fromAnthropic(response);
    },
    async doStream() {
      throw new Error("Streaming is simulated over doGenerate for this model.");
    },
  };
  // The loop streams; one complete response per step is simpler and keeps thinking blocks whole.
  return wrapLanguageModel({ model: base, middleware: simulateStreamingMiddleware() });
}
