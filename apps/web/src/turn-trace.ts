import {
  ORCHESTRATOR_TOOLS,
  SALESFORCE_AGENTS,
  SALESFORCE_TOOL_DETAILS,
  TURN_TRACE_PART_TYPE,
  type TurnTrace,
  TurnTraceSchema,
  toolSystem,
} from "@northstar/contracts";
import type { UIMessage } from "ai";
import { turnStats } from "./turn-stats";

export type TraceRow = {
  key: string;
  kind: "turn" | "step" | "reasoning" | "text" | "tool" | "error";
  label: string;
  detail: string;
  state: "active" | "complete" | "error";
  /** Offset from the start of the turn, e.g. "+1.24s". */
  elapsed?: string;
  payloadLabel?: string;
  payload?: string;
};

const REDACTED_KEYS =
  /token|secret|password|authorization|cookie|signature|confirmation|requesthash|idempotency/i;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

function redactCredentials(value: string) {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{8,}\b/g,
      "[redacted token]",
    );
}

export function sanitizedPayload(value: unknown): unknown {
  if (typeof value === "string") {
    if (new RegExp(EMAIL_PATTERN.source, "i").test(value)) return "[redacted personal data]";
    if (new RegExp(PHONE_PATTERN.source).test(value)) return "[redacted personal data]";
    const redacted = redactCredentials(value);
    return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizedPayload);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        REDACTED_KEYS.test(key) ? "[redacted]" : sanitizedPayload(child),
      ]),
    );
  return value;
}

/** Redacts personal data and credentials inline so long prose stays readable. */
export function sanitizedText(value: string, maxLength = 4000) {
  const redacted = redactCredentials(value)
    .replace(EMAIL_PATTERN, "[redacted email]")
    .replace(PHONE_PATTERN, "[redacted phone]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function isKnownTool(name: string) {
  return ORCHESTRATOR_TOOLS.some((tool) => name === tool || name.endsWith(`_${tool}`));
}

export function readableToolName(name: string) {
  const known = ORCHESTRATOR_TOOLS.find((tool) => name === tool || name.endsWith(`_${tool}`));
  if (!known) return "Unrecognized tool request";
  return known.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** "Salesforce agent: X (kind) · subagent · actions" for a tool backed by a Salesforce agent. */
export function salesforceAgentLine(name: string) {
  const tool = Object.keys(SALESFORCE_TOOL_DETAILS).find(
    (candidate) => name === candidate || name.endsWith(`_${candidate}`),
  );
  const detail = tool ? SALESFORCE_TOOL_DETAILS[tool] : undefined;
  if (!detail) return null;
  const actions = detail.actions.map((action) => action.label).join(" → ");
  if (!detail.agent) return `Salesforce Apex action: ${actions}`;
  const agent = SALESFORCE_AGENTS[detail.agent];
  return `Salesforce agent: ${agent.label} (${agent.kind})${detail.subagent ? ` · ${detail.subagent}` : ""} · ${actions}`;
}

function semanticToolFailure(value: unknown): "unavailable" | "error" | null {
  if (!value || typeof value !== "object") return null;
  const status = (value as { semanticStatus?: unknown }).semanticStatus;
  return status === "unavailable" || status === "error" ? status : null;
}

type ToolPartView = {
  toolCallId: string;
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function toolParts(message: UIMessage): ToolPartView[] {
  return message.parts.flatMap((part) => {
    const name =
      part.type === "dynamic-tool"
        ? part.toolName
        : part.type.startsWith("tool-")
          ? part.type.slice(5)
          : null;
    if (!name || !("state" in part) || !("toolCallId" in part)) return [];
    return [
      {
        toolCallId: String(part.toolCallId),
        toolName: name,
        state: String(part.state),
        input: "input" in part ? part.input : undefined,
        output: "output" in part ? part.output : undefined,
        errorText: "errorText" in part ? String(part.errorText) : undefined,
      },
    ];
  });
}

function textsOfType(message: UIMessage, type: "text" | "reasoning") {
  return message.parts.flatMap((part) =>
    part.type === type ? [{ text: part.text, streaming: part.state === "streaming" }] : [],
  );
}

export function turnTrace(message: UIMessage): TurnTrace | null {
  const part = message.parts.find((candidate) => candidate.type === TURN_TRACE_PART_TYPE);
  if (!part || !("data" in part)) return null;
  const parsed = TurnTraceSchema.safeParse(part.data);
  return parsed.success ? parsed.data : null;
}

const ROUTE_DETAIL = {
  "confirmation-required":
    "Handled by the policy router without a model call: writes need the confirmation flow",
  unsupported: "Handled by the policy router without a model call: this action is blocked",
  "catalog-unavailable":
    "Handled without a model call: the governed Salesforce tool catalog is not ready",
  memory: "Handled by the server without a model call: the draft was stored in long-term memory",
} as const;

const json = (value: unknown) => JSON.stringify(sanitizedPayload(value), null, 2);
const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

function seconds(ms: number) {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

function toolOutputRow(key: string, tool: ToolPartView, elapsed?: string): TraceRow {
  const status = semanticToolFailure(tool.output);
  const system = toolSystem(tool.toolName);
  return {
    key,
    kind: "tool",
    label: `Tool output · ${readableToolName(tool.toolName)}`,
    detail:
      status === "error"
        ? `${system} reported that the call failed`
        : status === "unavailable"
          ? `${system} returned no usable business result`
          : "Result returned to the orchestrator",
    state: status ? "error" : "complete",
    elapsed,
    payloadLabel: "Sanitized tool output",
    payload: json({ output: tool.output }),
  };
}

function toolErrorRow(
  key: string,
  tool: ToolPartView | undefined,
  message: string,
  elapsed?: string,
) {
  return {
    key,
    kind: "tool",
    label: `Tool error · ${readableToolName(tool?.toolName ?? "")}`,
    detail: message,
    state: "error",
    elapsed,
  } satisfies TraceRow;
}

function toolInputRow(key: string, tool: ToolPartView | undefined, name: string, elapsed?: string) {
  return {
    key,
    kind: "tool",
    label: `Tool input ready · ${readableToolName(name)}`,
    detail: "Arguments sent through the governed MCP catalog",
    state: tool && !tool.state.startsWith("input") ? "complete" : "active",
    elapsed,
    payloadLabel: "Sanitized tool input",
    payload: json({ input: tool?.input }),
  } satisfies TraceRow;
}

/** Builds the step-by-step timeline from the persisted server trace. */
function rowsFromTrace(message: UIMessage, trace: TurnTrace): TraceRow[] {
  const tools = new Map(toolParts(message).map((tool) => [tool.toolCallId, tool]));
  const reasoning = textsOfType(message, "reasoning");
  const texts = textsOfType(message, "text");
  const openedAt = new Map<string, number>();
  const finished = trace.events.some((event) => event.kind === "turn-finish");
  const tokens = trace.events.reduce(
    (sum, event) =>
      event.kind === "step-finish"
        ? sum + (event.inputTokens ?? 0) + (event.outputTokens ?? 0)
        : sum,
    0,
  );
  const toolCalls = new Set(
    trace.events.flatMap((event) =>
      event.kind === "tool-input-start" ||
      event.kind === "tool-input-available" ||
      event.kind === "tool-input-error"
        ? [event.toolCallId]
        : [],
    ),
  ).size;
  return trace.events.flatMap((event, index): TraceRow[] => {
    const key = `${event.kind}-${index}`;
    const elapsed = `+${seconds(event.at - trace.startedAt)}`;
    const since = (id: string) => {
      const start = openedAt.get(id);
      return start === undefined ? "" : ` in ${seconds(event.at - start)}`;
    };
    switch (event.kind) {
      case "turn-start":
        return [
          {
            key,
            kind: "turn",
            label: "Turn started",
            detail: [
              event.route && event.route !== "model"
                ? ROUTE_DETAIL[event.route]
                : `Model ${event.model}`,
              `${plural(event.toolCount, "governed tool")} available`,
              event.requiredTool
                ? `routed to ${event.requiredTool.split(" → ").map(readableToolName).join(" → ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            state: "complete",
            elapsed,
          },
        ];
      case "step-start":
        openedAt.set(`step-${event.step}`, event.at);
        return [
          {
            key,
            kind: "step",
            label: `Step ${event.step + 1} started`,
            detail: "Model call sent to Workers AI",
            state: "complete",
            elapsed,
          },
        ];
      case "step-finish": {
        const tokens = [
          event.inputTokens !== undefined ? `${plural(event.inputTokens, "input token")}` : null,
          event.outputTokens !== undefined ? `${plural(event.outputTokens, "output token")}` : null,
          event.reasoningTokens ? `${plural(event.reasoningTokens, "reasoning token")}` : null,
        ].filter(Boolean);
        return [
          {
            key,
            kind: "step",
            label: `Step ${event.step + 1} finished${since(`step-${event.step}`)}`,
            detail: [`Finish reason: ${event.finishReason}`, ...tokens].join(" · "),
            state: event.finishReason === "error" ? "error" : "complete",
            elapsed,
          },
        ];
      }
      case "reasoning-start":
        openedAt.set(`reasoning-${event.index}`, event.at);
        return [
          {
            key,
            kind: "reasoning",
            label: "Reasoning started",
            detail: "The model is planning its next action",
            state: reasoning[event.index]?.streaming && !finished ? "active" : "complete",
            elapsed,
          },
        ];
      case "reasoning-end": {
        const text = reasoning[event.index]?.text ?? "";
        return [
          {
            key,
            kind: "reasoning",
            label: `Reasoning ended${since(`reasoning-${event.index}`)}`,
            detail: plural(event.chars, "character"),
            state: "complete",
            elapsed,
            ...(text.trim()
              ? { payloadLabel: "Model reasoning", payload: sanitizedText(text) }
              : {}),
          },
        ];
      }
      case "text-start":
        openedAt.set(`text-${event.index}`, event.at);
        return [
          {
            key,
            kind: "text",
            label: "Text started",
            detail: "Writing the visible response",
            state: texts[event.index]?.streaming && !finished ? "active" : "complete",
            elapsed,
          },
        ];
      case "text-end":
        return [
          {
            key,
            kind: "text",
            label: `Text ended${since(`text-${event.index}`)}`,
            detail: plural(event.chars, "character"),
            state: "complete",
            elapsed,
          },
        ];
      case "tool-input-start":
        openedAt.set(`tool-${event.toolCallId}`, event.at);
        return [
          {
            key,
            kind: "tool",
            label: `Tool call started · ${readableToolName(event.toolName)}`,
            detail: isKnownTool(event.toolName)
              ? (salesforceAgentLine(event.toolName) ?? "The model selected a governed tool")
              : "The model requested a tool outside the governed catalog",
            state: isKnownTool(event.toolName) ? "complete" : "error",
            elapsed,
          },
        ];
      case "tool-input-available":
        if (!openedAt.has(`tool-${event.toolCallId}`))
          openedAt.set(`tool-${event.toolCallId}`, event.at);
        return [toolInputRow(key, tools.get(event.toolCallId), event.toolName, elapsed)];
      case "tool-input-error":
        return [
          toolErrorRow(
            key,
            { toolCallId: event.toolCallId, toolName: event.toolName, state: "" },
            event.message,
            elapsed,
          ),
        ];
      case "tool-output-available": {
        const tool = tools.get(event.toolCallId);
        if (!tool) return [];
        const row = toolOutputRow(key, tool, elapsed);
        return [{ ...row, label: `${row.label}${since(`tool-${event.toolCallId}`)}` }];
      }
      case "tool-output-error":
        return [toolErrorRow(key, tools.get(event.toolCallId), event.message, elapsed)];
      case "abort":
        return [
          {
            key,
            kind: "error",
            label: "Turn aborted",
            detail: event.reason,
            state: "error",
            elapsed,
          },
        ];
      case "error":
        return [
          {
            key,
            kind: "error",
            label: "Stream error",
            detail: event.message,
            state: "error",
            elapsed,
          },
        ];
      case "fallback-text":
        return [
          {
            key,
            kind: "turn",
            label: "Recovery message added",
            detail:
              event.reason === "empty"
                ? "The model wrote no text, so the orchestrator explained the result"
                : event.reason === "composed"
                  ? "The model wrote no text, so the orchestrator wrote the answer from the tool's result"
                  : `The orchestrator explained the ${event.reason} outcome`,
            state: "complete",
            elapsed,
          },
        ];
      case "turn-finish":
        return [
          {
            key,
            kind: "turn",
            label: `Turn ${event.outcome.replace("-", " ")}`,
            detail: `Total ${turnStats(seconds(event.at - trace.startedAt), { tokens, toolCalls })}`,
            state: event.outcome === "completed" ? "complete" : "error",
            elapsed,
          },
        ];
    }
    return [];
  });
}

/** Reconstructs an untimed timeline for messages persisted before server traces existed. */
function rowsFromParts(message: UIMessage): TraceRow[] {
  let step = 0;
  return message.parts.flatMap((part, index): TraceRow[] => {
    const key = `part-${index}`;
    if (part.type === "step-start") {
      step += 1;
      return [
        {
          key,
          kind: "step",
          label: `Step ${step} started`,
          detail: "Model call sent to Workers AI",
          state: "complete",
        },
      ];
    }
    if (part.type === "reasoning") {
      const streaming = part.state === "streaming";
      return [
        {
          key,
          kind: "reasoning",
          label: streaming ? "Reasoning started" : "Reasoning",
          detail: plural(part.text.length, "character"),
          state: streaming ? "active" : "complete",
          ...(part.text.trim()
            ? { payloadLabel: "Model reasoning", payload: sanitizedText(part.text) }
            : {}),
        },
      ];
    }
    if (part.type === "text") {
      if (!part.text.trim()) return [];
      const streaming = part.state === "streaming";
      return [
        {
          key,
          kind: "text",
          label: streaming ? "Text started" : "Text",
          detail: plural(part.text.length, "character"),
          state: streaming ? "active" : "complete",
        },
      ];
    }
    const [tool] = toolParts({ ...message, parts: [part] });
    if (!tool) return [];
    const input = toolInputRow(`${key}-input`, tool, tool.toolName);
    if (tool.state === "output-available") return [input, toolOutputRow(`${key}-output`, tool)];
    if (tool.state === "output-error" || tool.state === "output-denied")
      return [
        input,
        toolErrorRow(`${key}-error`, tool, tool.errorText ?? "Tool call failed safely"),
      ];
    return [input];
  });
}

export function executionTrace(message: UIMessage): TraceRow[] {
  if (message.role !== "assistant") return [];
  const trace = turnTrace(message);
  return trace ? rowsFromTrace(message, trace) : rowsFromParts(message);
}
