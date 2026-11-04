import type { LanguageModelMiddleware } from "ai";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type WrapStreamOptions = Parameters<WrapStream>[0];
type StreamResult = Awaited<ReturnType<WrapStreamOptions["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type CallParams = WrapStreamOptions["params"];

/**
 * Bounds a forced tool-call step so a degenerate reasoning loop cannot run until the turn times
 * out. Reasoning counts against it, and a detailed request to a Salesforce agent alone can take
 * several hundred tokens, so a tighter cap cuts the call's JSON off mid-string.
 */
export const FORCED_TOOL_MAX_OUTPUT_TOKENS = 2048;
const MAX_ATTEMPTS = 2;

function forcedToolName(params: CallParams) {
  const choice = params.toolChoice;
  return choice?.type === "tool" ? choice.toolName : undefined;
}

function requiredKeys(params: CallParams, toolName: string): string[] {
  const tool = params.tools?.find((candidate) => candidate.name === toolName);
  const schema = tool && "inputSchema" in tool ? tool.inputSchema : undefined;
  const required = (schema as { required?: unknown } | undefined)?.required;
  return Array.isArray(required) ? required.filter((key) => typeof key === "string") : [];
}

/**
 * gpt-oss on Workers AI sometimes writes a forced tool call's JSON arguments at the end of its
 * reasoning instead of emitting a structured tool call. Returns those arguments when the
 * reasoning ends with a JSON object that satisfies the tool's required keys.
 */
export function salvageToolInput(reasoning: string, required: string[]): string | null {
  const text = reasoning.trimEnd();
  if (!text.endsWith("}")) return null;
  const starts: number[] = [];
  for (let index = text.indexOf("{"); index >= 0; index = text.indexOf("{", index + 1))
    starts.push(index);
  for (const start of starts.reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start));
    } catch {
      // Keep widening the candidate until the braces balance.
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return required.every((key) => key in parsed) ? JSON.stringify(parsed) : null;
  }
  return null;
}

function isJsonObject(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Escapes raw control characters (such as newlines) inside JSON strings. */
function escapeControlCharacters(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (inString && !escaped && code < 0x20)
      out +=
        char === "\n"
          ? "\\n"
          : char === "\r"
            ? "\\r"
            : char === "\t"
              ? "\\t"
              : `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
    if (escaped) escaped = false;
    else if (char === "\\") escaped = inString;
    else if (char === '"') inString = !inString;
  }
  return out;
}

/**
 * The first complete JSON object in the text, ignoring anything after it: gpt-oss sometimes
 * follows a call's arguments with a literal "\n" or channel markup, which fails a strict parse.
 */
function leadingObject(text: string) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = inString;
    else if (char === '"') inString = !inString;
    else if (!inString && char === "{") depth += 1;
    else if (!inString && char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        return isJsonObject(candidate) ? candidate : null;
      }
    }
  }
  return null;
}

/** `<arg_key>name</arg_key><arg_value>value</arg_value>` pairs, a chat-template call format. */
function argumentMarkup(text: string) {
  const pairs = [
    ...text.matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g),
  ];
  if (!pairs.length) return null;
  const args: Record<string, unknown> = {};
  for (const [, key, value] of pairs) {
    const raw = (value ?? "").trim();
    let parsed: unknown = raw;
    if (/^[[{]/.test(raw))
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    args[(key ?? "").trim()] = parsed;
  }
  return JSON.stringify(args);
}

/**
 * A tool call's arguments as a JSON object: as sent, with raw control characters in its strings
 * escaped, without anything trailing the object, or read from argument markup. Null when none of
 * those work, as when the model's output was cut off mid-call.
 */
export function repairToolInput(input: string): string | null {
  if (!input.trim() || isJsonObject(input)) return input;
  const escaped = escapeControlCharacters(input);
  if (isJsonObject(escaped)) return escaped;
  return leadingObject(escaped) ?? argumentMarkup(input);
}

/**
 * gpt-oss sometimes leaks its channel markup into a tool name, such as
 * `summarize_campaign<|channel|>analysis`, or drops part of the MCP namespace prefix, such as
 * `recommend_buyer_group` for `tool_salesforce_…_recommend_buyer_group`. Returns the single
 * offered tool name the call was meant for, or the original name when it is ambiguous.
 */
export function normalizeToolName(name: string, offered: ReadonlySet<string>) {
  if (offered.has(name)) return name;
  const stripped = name.split("<|")[0]?.trim() ?? name;
  if (!stripped) return name;
  if (offered.has(stripped)) return stripped;
  const matches = [...offered].filter((candidate) => candidate.endsWith(`_${stripped}`));
  return matches.length === 1 ? (matches[0] as string) : name;
}

function callNormalizer(params: CallParams) {
  const offered = new Set((params.tools ?? []).map((tool) => tool.name));
  return (part: StreamPart): StreamPart => {
    if (part.type !== "tool-input-start" && part.type !== "tool-call") return part;
    let repaired = part;
    const toolName = normalizeToolName(part.toolName, offered);
    if (toolName !== part.toolName) {
      console.warn("[orchestrator] repaired a malformed tool name from the model");
      repaired = { ...repaired, toolName };
    }
    if (repaired.type === "tool-call") {
      const input = repairToolInput(repaired.input);
      if (input !== null && input !== repaired.input) {
        console.warn(
          `[orchestrator] repaired malformed ${repaired.toolName} arguments from the model`,
        );
        repaired = { ...repaired, input };
      }
    }
    return repaired;
  };
}

const LIVE_PART_TYPES = new Set(["reasoning-start", "reasoning-delta", "reasoning-end"]);

/**
 * Completes a forced tool-call step from the parts held back while its reasoning streamed live.
 * Returns the held parts unchanged when they already contain a tool call or an error, a repaired
 * sequence when the call leaked into reasoning, or null when nothing can be recovered.
 */
export function repairForcedToolStep(
  held: StreamPart[],
  reasoning: string,
  toolName: string,
  required: string[],
): StreamPart[] | null {
  if (held.some((part) => part.type === "error")) return held;
  const calls = held.filter((part) => part.type === "tool-call");
  if (
    calls.length > 0 &&
    calls.every((part) => part.toolName === toolName && repairToolInput(part.input) === part.input)
  )
    return held;
  // Drop calls to any other tool, and calls whose arguments aren't JSON (such as output cut off
  // mid-call); the step must call the forced tool or be recovered/retried.
  const wrongIds = new Set(
    held.flatMap((part) =>
      part.type === "tool-call"
        ? [part.toolCallId]
        : part.type === "tool-input-start" && part.toolName !== toolName
          ? [part.id]
          : [],
    ),
  );
  held = held.filter((part) =>
    part.type === "tool-call"
      ? false
      : part.type === "tool-input-start" ||
          part.type === "tool-input-delta" ||
          part.type === "tool-input-end"
        ? !wrongIds.has(part.id)
        : true,
  );
  // gpt-oss usually leaks the arguments into reasoning, and sometimes into the answer text.
  const text = held.map((part) => (part.type === "text-delta" ? part.delta : "")).join("");
  const fromText = salvageToolInput(text.trim(), required);
  const input = salvageToolInput(reasoning, required) ?? fromText;
  if (!input) return null;
  // Leaked JSON answer text must not reach the user as if it were a reply.
  if (fromText === input)
    held = held.filter(
      (part) =>
        part.type !== "text-start" && part.type !== "text-delta" && part.type !== "text-end",
    );
  const toolCallId = `salvaged-${crypto.randomUUID()}`;
  const finishIndex = held.findIndex((part) => part.type === "finish");
  const finish = finishIndex >= 0 ? held[finishIndex] : undefined;
  const body = finishIndex >= 0 ? held.slice(0, finishIndex) : held;
  return [
    ...body,
    { type: "tool-input-start", id: toolCallId, toolName },
    { type: "tool-input-delta", id: toolCallId, delta: input },
    { type: "tool-input-end", id: toolCallId },
    { type: "tool-call", toolCallId, toolName, input },
    {
      ...(finish?.type === "finish" ? finish : { type: "finish" as const, usage: emptyUsage() }),
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "salvaged-from-reasoning" },
    } as StreamPart,
  ];
}

function emptyUsage() {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function offersNoTools(params: CallParams) {
  return params.toolChoice?.type === "none" || !params.tools?.length;
}

const TOOL_PART_TYPES = new Set([
  "tool-input-start",
  "tool-input-delta",
  "tool-input-end",
  "tool-call",
]);

/**
 * An answer step offers no tools, but gpt-oss sometimes emits a call anyway, often under a name
 * with leaked channel markup; it fails and the turn ends without an answer. Streams the step
 * live without those calls, and retries once when a dropped call was all the step produced.
 */
function answerWithoutTools(
  first: StreamResult,
  doStream: () => PromiseLike<StreamResult>,
): StreamResult {
  const stream = new ReadableStream<StreamPart>({
    async start(controller) {
      try {
        let result = first;
        for (let attempt = 1; ; attempt += 1) {
          let answered = false;
          let dropped = false;
          let finish: StreamPart | undefined;
          const reader = result.stream.getReader();
          for (let next = await reader.read(); !next.done; next = await reader.read()) {
            const part = next.value;
            if (TOOL_PART_TYPES.has(part.type)) dropped = true;
            else if (part.type === "finish") finish = part;
            else if (part.type === "stream-start" && attempt > 1) continue;
            else {
              if (part.type === "text-delta" && part.delta.trim()) answered = true;
              controller.enqueue(part);
            }
          }
          if (!dropped || answered || attempt >= MAX_ATTEMPTS) {
            if (dropped) console.warn("[orchestrator] dropped a tool call from an answer step");
            if (finish?.type === "finish")
              controller.enqueue(
                dropped && finish.finishReason.unified === "tool-calls"
                  ? { ...finish, finishReason: { unified: "stop", raw: "tool-call-dropped" } }
                  : finish,
              );
            controller.close();
            return;
          }
          console.warn("[orchestrator] answer step only called a tool; retrying");
          result = await doStream();
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return { ...first, stream };
}

/**
 * Makes forced tool-call steps dependable: caps their output, streams reasoning live while
 * holding back the rest of the step, recovers a tool call that leaked into reasoning, and
 * retries once when no call can be recovered.
 */
export const forcedToolCallMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) =>
    forcedToolName(params)
      ? {
          ...params,
          maxOutputTokens: Math.min(
            params.maxOutputTokens ?? FORCED_TOOL_MAX_OUTPUT_TOKENS,
            FORCED_TOOL_MAX_OUTPUT_TOKENS,
          ),
        }
      : params,
  wrapStream: async ({ doStream, params }) => {
    const toolName = forcedToolName(params);
    const normalize = callNormalizer(params);
    if (!toolName && offersNoTools(params)) return answerWithoutTools(await doStream(), doStream);
    if (!toolName) {
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<StreamPart, StreamPart>({
            transform(part, controller) {
              controller.enqueue(normalize(part));
            },
          }),
        ),
      };
    }
    const required = requiredKeys(params, toolName);
    const first = await doStream();
    const stream = new ReadableStream<StreamPart>({
      async start(controller) {
        try {
          let result = first;
          for (let attempt = 1; ; attempt += 1) {
            const held: StreamPart[] = [];
            let reasoning = "";
            const reader = result.stream.getReader();
            for (let next = await reader.read(); !next.done; next = await reader.read()) {
              const part = normalize(next.value);
              if (part.type === "reasoning-delta") reasoning += part.delta;
              if (LIVE_PART_TYPES.has(part.type) || (attempt === 1 && part.type === "stream-start"))
                controller.enqueue(part);
              else if (part.type !== "stream-start") held.push(part);
            }
            const repaired = repairForcedToolStep(held, reasoning, toolName, required);
            if (repaired && repaired !== held)
              console.warn(`[orchestrator] recovered ${toolName} call from model reasoning`);
            if (repaired || attempt >= MAX_ATTEMPTS) {
              if (!repaired)
                console.warn(
                  `[orchestrator] forced ${toolName} call missing after ${attempt} attempts`,
                );
              for (const part of repaired ?? held) controller.enqueue(part);
              controller.close();
              return;
            }
            console.warn(
              `[orchestrator] forced ${toolName} call missing on attempt ${attempt}; retrying`,
            );
            result = await doStream();
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return { ...first, stream };
  },
};
