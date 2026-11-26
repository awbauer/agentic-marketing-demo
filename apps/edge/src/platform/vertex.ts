// Vertex AI as a model platform, on either host (ADR-018, ADR-021). Chat models go through
// Vertex's OpenAI-compatible endpoint, which serves gpt-oss-120b as a managed model; images come
// from Gemini's image model; the squad's Anthropic provider reaches Claude on Vertex. Plain fetch
// and WebCrypto only, so it runs in a Worker as well as in Node. The caller supplies the access
// token: on Cloud Run the service account's own (ADC, no key stored); elsewhere one minted from a
// service-account key (google-token.ts).
import { createOpenAI } from "@ai-sdk/openai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolCall,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { generateText, type LanguageModel, wrapLanguageModel } from "ai";
import type { ImageRequest, JudgeVerdict, ModelPlatform } from "./models";

export type VertexOptions = {
  project: string;
  /** Where gpt-oss runs, such as us-central1. */
  location: string;
  /** Where the image model runs; Gemini image models are served from "global". */
  imageLocation?: string;
  /** Where Claude runs; Anthropic models on Vertex are served from "global" or a few regions. */
  anthropicLocation?: string;
  /** Gemini image model id; gemini-3.1-flash-image by default. */
  imageModel?: string;
  /** JSON object of catalog id → Vertex model id, overriding the defaults below. */
  modelMap?: Record<string, string>;
  /** Tests pass a fake fetch. */
  fetch?: typeof fetch;
  /** A current Google access token with the cloud-platform scope. */
  accessToken: () => Promise<string>;
};

/** The open models Vertex hosts as managed models, by catalog id. */
export const VERTEX_DEFAULT_MODELS: Record<string, string> = {
  "@cf/openai/gpt-oss-120b": "openai/gpt-oss-120b-maas",
};

/**
 * The catalog id that serves `modelId` here. Vertex's managed API offers gpt-oss-120b but not
 * gpt-oss-20b or the other Workers AI models (checked 2026-11-25), so every chat model runs on
 * gpt-oss-120b unless VERTEX_MODEL_MAP names another Vertex model for it. The squad's open-model
 * tier and the orchestrator are re-scored on it (WU-077).
 */
export function servedCatalogId(modelId: string, map: Record<string, string> = {}) {
  if (map[modelId] || VERTEX_DEFAULT_MODELS[modelId]) return modelId;
  return "@cf/openai/gpt-oss-120b";
}

export function vertexModelId(modelId: string, map: Record<string, string> = {}) {
  const catalog = servedCatalogId(modelId, map);
  return map[catalog] ?? VERTEX_DEFAULT_MODELS[catalog] ?? catalog;
}

function host(location: string) {
  return location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
}

type CallParams = LanguageModelV4CallOptions;

/**
 * Vertex AI's gpt-oss refuses a forced tool choice ("Forced tool calling is not supported for
 * this model"), and the orchestrator forces a tool on many steps. So a forced step offers only
 * the forced tool, asks for `auto`, and says in a system message to call it now; a step that
 * requires some tool keeps them all and says to call one. The salvage middleware above this model
 * still sees the forced choice, so it still recovers a call written into the reasoning.
 */
export function unforcedToolChoice(params: CallParams): CallParams {
  const choice = params.toolChoice;
  if (choice?.type !== "tool" && choice?.type !== "required") return params;
  const tools =
    choice.type === "tool"
      ? params.tools?.filter((tool) => tool.name === choice.toolName)
      : params.tools;
  const instruction =
    choice.type === "tool"
      ? `Call the \`${choice.toolName}\` tool now. Do not answer in text on this step.`
      : "Call one of the available tools now. Do not answer in text on this step.";
  return {
    ...params,
    ...(tools ? { tools } : {}),
    toolChoice: { type: "auto" },
    prompt: [...params.prompt, { role: "system", content: instruction }],
    // Remembered for the fallback below: which tool the step had to call ("*" for any).
    providerOptions: {
      ...params.providerOptions,
      northstar: { mustCall: choice.type === "tool" ? choice.toolName : "*" },
    },
  };
}

type Part = LanguageModelV4StreamPart;
type Tool = NonNullable<CallParams["tools"]>[number];
type GenerateResult = Awaited<ReturnType<LanguageModelV4["doGenerate"]>>;

const mustCallOf = (params: CallParams) =>
  (params.providerOptions?.northstar as { mustCall?: string } | undefined)?.mustCall;

const sumUsage = (a: LanguageModelV4Usage, b: LanguageModelV4Usage): LanguageModelV4Usage => {
  const add = (x: number | undefined, y: number | undefined) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: {
      total: add(a.inputTokens.total, b.inputTokens.total),
      noCache: add(a.inputTokens.noCache, b.inputTokens.noCache),
      cacheRead: add(a.inputTokens.cacheRead, b.inputTokens.cacheRead),
      cacheWrite: add(a.inputTokens.cacheWrite, b.inputTokens.cacheWrite),
    },
    outputTokens: {
      total: add(a.outputTokens.total, b.outputTokens.total),
      text: add(a.outputTokens.text, b.outputTokens.text),
      reasoning: add(a.outputTokens.reasoning, b.outputTokens.reasoning),
    },
  };
};

/**
 * Vertex's gpt-oss endpoint sometimes ends a step that had to call a tool with neither text nor a
 * call: the model wrote the call, and the endpoint dropped it on the way out (finish "stop", the
 * completion tokens spent, only reasoning returned). Seen on about a third of such steps in
 * testing, and on every try of some lifecycle saves, so retrying the same request doesn't help.
 * The same request in JSON-schema mode returns the arguments reliably, so when a must-call step
 * comes back without a call, this asks for the call that way and hands it on as the tool call.
 * Null when there's nothing to recover (the reply can't be read, or names no offered tool).
 */
export async function recoverDroppedCall(
  model: LanguageModelV4,
  params: CallParams,
  mustCall: string,
): Promise<{ call: LanguageModelV4ToolCall; usage: LanguageModelV4Usage } | null> {
  const tools = (params.tools ?? []).filter(
    (tool): tool is Extract<Tool, { type: "function" }> => tool.type === "function",
  );
  const { providerOptions, ...rest } = params;
  const { northstar: _, ...forProvider } = providerOptions ?? {};
  let usage: LanguageModelV4Usage | null = null;
  /** One JSON-schema request over the step's own context, without its tools; null if unreadable. */
  const askJson = async (schema: unknown, name: string, ask: string) => {
    let result: GenerateResult;
    try {
      result = await model.doGenerate({
        ...rest,
        providerOptions: forProvider,
        tools: undefined,
        toolChoice: undefined,
        responseFormat: { type: "json", schema: schema as never, name },
        prompt: [
          // Drop the "call a tool now" instruction: this request offers no tools.
          ...params.prompt.slice(0, -1),
          { role: "user", content: [{ type: "text", text: ask }] },
        ],
      });
    } catch (error) {
      console.warn(
        `[vertex] could not recover a dropped call: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    usage = usage
      ? sumUsage(usage, result.usage as LanguageModelV4Usage)
      : (result.usage as LanguageModelV4Usage);
    const text = result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
    try {
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as unknown;
    } catch {
      return null;
    }
  };
  let target =
    mustCall !== "*"
      ? tools.find((tool) => tool.name === mustCall)
      : tools.length === 1
        ? tools[0]
        : undefined;
  if (!target && mustCall === "*" && tools.length > 1) {
    // Any tool would do: first which one, then its arguments under that tool's own schema, so the
    // call is shaped as the tool requires rather than as a free-form object.
    const pick = (await askJson(
      {
        type: "object",
        properties: { tool: { type: "string", enum: tools.map((tool) => tool.name) } },
        required: ["tool"],
      },
      "tool_choice",
      `Which tool do you call now? Reply with one JSON object naming it ("tool"), nothing else. Tools: ${tools
        .map((tool) => `${tool.name}: ${tool.description ?? ""}`)
        .join("; ")}`,
    )) as { tool?: unknown } | null;
    target = tools.find((tool) => tool.name === pick?.tool);
  }
  if (!target) return null;
  const input = await askJson(
    target.inputSchema,
    target.name,
    `Reply with the arguments for the \`${target.name}\` tool as one JSON object, nothing else.`,
  );
  if (input === null || !usage) return null;
  return {
    call: {
      type: "tool-call",
      toolCallId: `vertex-recovered-${crypto.randomUUID()}`,
      toolName: target.name,
      input: JSON.stringify(input),
    },
    usage,
  };
}

/** Workers AI-style options the shared code sets, translated for the OpenAI-compatible endpoint. */
export function vertexCompatibleParams(params: CallParams): CallParams {
  const unforced = unforcedToolChoice(params);
  const workersAi = unforced.providerOptions?.["workers-ai"] as
    | { reasoning_effort?: string }
    | undefined;
  if (!workersAi?.reasoning_effort) return unforced;
  return {
    ...unforced,
    providerOptions: {
      ...unforced.providerOptions,
      openai: { ...unforced.providerOptions?.openai, reasoningEffort: workersAi.reasoning_effort },
    },
  };
}

function reasoningFromWorkersAi(model: Exclude<LanguageModel, string>) {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => vertexCompatibleParams(params),
      // A must-call step that came back without a call gets one recovered (recoverDroppedCall).
      wrapGenerate: async ({ doGenerate, params, model: inner }) => {
        const result = await doGenerate();
        const mustCall = mustCallOf(params as CallParams);
        if (!mustCall || result.content.some((part) => part.type === "tool-call")) return result;
        const recovered = await recoverDroppedCall(
          inner as unknown as LanguageModelV4,
          params as CallParams,
          mustCall,
        );
        if (!recovered) return result;
        console.warn(`[vertex] recovered a dropped ${recovered.call.toolName} call`);
        return {
          ...result,
          content: [...result.content, recovered.call],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: sumUsage(result.usage as LanguageModelV4Usage, recovered.usage) as never,
        };
      },
      wrapStream: async ({ doStream, params, model: inner }) => {
        const result = await doStream();
        const mustCall = mustCallOf(params as CallParams);
        if (!mustCall) return result;
        // A must-call step's parts are held until it's known whether a call came back.
        const parts: Part[] = [];
        const reader = (result.stream as ReadableStream<Part>).getReader();
        for (let next = await reader.read(); !next.done; next = await reader.read())
          parts.push(next.value);
        let out = parts;
        if (!parts.some((part) => part.type === "tool-call")) {
          const recovered = await recoverDroppedCall(
            inner as unknown as LanguageModelV4,
            params as CallParams,
            mustCall,
          );
          if (recovered) {
            console.warn(`[vertex] recovered a dropped ${recovered.call.toolName} call`);
            const finish = parts.find((part) => part.type === "finish");
            out = [
              ...parts.filter((part) => part.type !== "finish"),
              recovered.call,
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage: finish ? sumUsage(finish.usage, recovered.usage) : recovered.usage,
              },
            ];
          }
        }
        return {
          ...result,
          stream: new ReadableStream({
            start(controller) {
              for (const part of out) controller.enqueue(part);
              controller.close();
            },
          }) as typeof result.stream,
        };
      },
    },
  });
}

/** One structured log line per model call, standing in for AI Gateway's request log. */
function loggingFetch(
  base: typeof fetch,
  token: () => Promise<string>,
  service: string,
): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await token()}`);
    headers.delete("x-api-key");
    const response = await base(input, { ...init, headers });
    console.info(
      JSON.stringify({
        event: "model_call",
        service,
        url: String(input instanceof Request ? input.url : input).replace(/\?.*$/, ""),
        status: response.status,
        latencyMs: Date.now() - started,
      }),
    );
    return response;
  };
}

/**
 * Claude on Vertex takes the Anthropic Messages body without `model`, with a Vertex
 * `anthropic_version`, at the model's rawPredict (or streamRawPredict) URL. The squad's Anthropic
 * SDK builds requests for api.anthropic.com; this rewrites them.
 */
export function anthropicOnVertexFetch(options: {
  project: string;
  location: string;
  fetch: typeof fetch;
}): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname !== "api.anthropic.com" || !url.pathname.endsWith("/messages"))
      return options.fetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> & {
      model?: string;
      stream?: boolean;
    };
    const { model, ...rest } = body;
    if (!model) throw new Error("An Anthropic request without a model cannot be routed to Vertex.");
    const method = rest.stream ? "streamRawPredict" : "rawPredict";
    const target = `https://${host(options.location)}/v1/projects/${options.project}/locations/${options.location}/publishers/anthropic/models/${model}:${method}`;
    const headers = new Headers(init?.headers);
    for (const name of ["x-api-key", "anthropic-version", "host", "content-length"])
      headers.delete(name);
    headers.set("content-type", "application/json");
    return options.fetch(target, {
      ...init,
      headers,
      body: JSON.stringify({ ...rest, anthropic_version: "vertex-2023-10-16" }),
    });
  };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function vertexModels(options: VertexOptions): ModelPlatform {
  const baseFetch = options.fetch ?? fetch;
  const token = options.accessToken;
  const map = options.modelMap ?? {};
  const authed = loggingFetch(baseFetch, token, "vertex-ai");
  const openai = createOpenAI({
    apiKey: "google-cloud-adc",
    baseURL: `https://${host(options.location)}/v1/projects/${options.project}/locations/${options.location}/endpoints/openapi`,
    fetch: authed,
  });
  const chat = (modelId: string) =>
    reasoningFromWorkersAi(openai.chat(vertexModelId(modelId, map))) as Exclude<
      LanguageModel,
      string
    >;
  const imageModel = options.imageModel ?? "gemini-3.1-flash-image";
  return {
    kind: "vertex",
    label: "Vertex AI",
    imageModel,
    chat,
    served: (modelId) => servedCatalogId(modelId, map),
    async image(_model: string, request: ImageRequest) {
      const location = options.imageLocation ?? "global";
      const url = `https://${host(location)}/v1/projects/${options.project}/locations/${location}/publishers/google/models/${imageModel}:generateContent`;
      const response = await authed(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: request.width === request.height ? "1:1" : "16:9" },
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
          },
        }),
      });
      if (!response.ok) throw new Error(`The image model returned ${response.status}.`);
      const result = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
        }>;
      };
      const image = result.candidates?.[0]?.content?.parts?.find((part) =>
        part.inlineData?.mimeType?.startsWith("image/"),
      )?.inlineData;
      return image?.data ? decodeBase64(image.data) : null;
    },
    /**
     * Clef is Workers AI-only; on Vertex the judge is gpt-oss answering the same rubric as JSON,
     * returned in Clef's shape so architecture/judge.ts scores it the same way.
     */
    async judge(_model: string, input: Record<string, unknown>): Promise<JudgeVerdict> {
      const questions = (input.questions ?? {}) as Record<
        string,
        { instructions: string; criteria: readonly string[] }
      >;
      const ids = Object.keys(questions);
      const rubric = ids
        .map(
          (id) =>
            `${id}: ${questions[id]?.instructions} Answer with the index of one of: ${questions[
              id
            ]?.criteria
              .map((label, index) => `${index}=${label}`)
              .join(", ")}.`,
        )
        .join("\n");
      const { text } = await generateText({
        model: chat("@cf/openai/gpt-oss-120b"),
        system:
          "You grade an AI agent's run. Reply with one JSON object mapping each question id to an integer index, nothing else.",
        prompt: `Run:\n${JSON.stringify(input.state)}\n\nQuestions:\n${rubric}`,
        providerOptions: { openai: { reasoningEffort: "low" } },
      });
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<
        string,
        unknown
      >;
      return {
        answers: Object.fromEntries(
          ids.map((id) => [id, { type: "score", score: Number(parsed[id]) }]),
        ),
      };
    },
    vendor(provider) {
      if (provider === "openai")
        return {
          reason:
            "OpenAI models are not served by Google Cloud; this provider stays off here until it is approved (ADR-018).",
        };
      return {
        fetch: anthropicOnVertexFetch({
          project: options.project,
          location: options.anthropicLocation ?? "global",
          fetch: loggingFetch(baseFetch, token, "vertex-ai-anthropic"),
        }),
      };
    },
  };
}
