import type { TurnRecord, TurnTrace } from "@northstar/contracts";
import type { TurnRoute, TurnToolCall } from "./turn-trace";

const STRING_LIMIT = 1000;
const VALUE_JSON_LIMIT = 6000;
const SECRET_KEYS =
  /token|secret|password|authorization|cookie|signature|confirmation|requesthash|idempotency|base64/i;

/** Redacts personal data and credentials and bounds size before a value is stored in history. */
export function redactForHistory(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const redacted = value
      .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
      .replace(/\beyJ[\w-]{12,}\.[\w-]{12,}\.[\w-]{8,}\b/g, "[redacted token]")
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[redacted email]")
      .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[redacted phone]");
    return redacted.length > STRING_LIMIT ? `${redacted.slice(0, STRING_LIMIT)}…` : redacted;
  }
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redactForHistory(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        SECRET_KEYS.test(key) ? "[redacted]" : redactForHistory(child, depth + 1),
      ]),
    );
  return value;
}

function bounded(value: unknown) {
  const redacted = redactForHistory(value);
  const json = JSON.stringify(redacted) ?? "null";
  return json.length > VALUE_JSON_LIMIT
    ? `${json.slice(0, VALUE_JSON_LIMIT)}… [truncated]`
    : redacted;
}

function readable(toolName: string) {
  const bare = toolName.replace(/^(?:tool_salesforce_[\w-]+?_|context_)/, "").replaceAll("_", " ");
  return toolName.includes("_") ? bare : toolName;
}

/** A plain-language account of how the orchestrator decided to handle the turn. */
export function describeInterpretation(route: TurnRecord["route"], requiredTool?: string) {
  switch (route) {
    case "confirmation-required":
      return "Recognized a request to change a Salesforce record. Answered with the confirmation-flow guidance without calling the model.";
    case "unsupported":
      return "Recognized a blocked action such as publish, send, or delete. Refused without calling the model.";
    case "catalog-unavailable":
      return "Matched a governed intent, but its Salesforce tool was not in the connected catalog, so the turn explained the connection state.";
    case "local-fixture":
      return "Local development turn answered from the fictional fixture without a model call.";
    default:
      if (!requiredTool)
        return "No fixed intent matched, so the model chose whether and which governed tools to call.";
      if (requiredTool.includes(" → "))
        return `Matched a multi-step plan and required the tools in order: ${requiredTool
          .split(" → ")
          .map(readable)
          .join(", then ")}. The model then wrote the answer from their results.`;
      return `Matched the ${readable(requiredTool)} intent and required the model to call that governed tool first, then summarize its result.`;
  }
}

export function buildTurnRecord({
  utterance,
  model,
  route,
  requiredTool,
  scope,
  result,
}: {
  utterance: string;
  model: string;
  route: TurnRoute | "local-fixture";
  requiredTool?: string;
  scope?: { brand: string; persona: string };
  result: {
    outcome: TurnRecord["outcome"];
    trace: TurnTrace;
    reasoning: string;
    answer: string;
    failure?: string;
    toolCalls: TurnToolCall[];
  };
}): TurnRecord {
  const { trace } = result;
  const events = trace.events;
  const finished = [...events].reverse().find((event) => event.kind === "turn-finish");
  const stepFinishes = events.filter((event) => event.kind === "step-finish");
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(trace.startedAt).toISOString(),
    durationMs: Math.max(0, (finished?.at ?? trace.startedAt) - trace.startedAt),
    utterance: String(redactForHistory(utterance)).slice(0, 2000),
    model,
    route,
    ...(requiredTool ? { requiredTool } : {}),
    ...(scope ? { scope: { brand: scope.brand, persona: scope.persona } } : {}),
    interpretation: describeInterpretation(route, requiredTool),
    reasoning: String(redactForHistory(result.reasoning)),
    outcome: result.outcome,
    fallback: events.some((event) => event.kind === "fallback-text"),
    ...(result.failure ? { failure: result.failure } : {}),
    answer: String(redactForHistory(result.answer.trim())),
    steps: events.filter((event) => event.kind === "step-start").length,
    inputTokens: stepFinishes.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
    outputTokens: stepFinishes.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
    tools: result.toolCalls.map((call) => ({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      status: call.status,
      ...(call.endedAt !== undefined ? { durationMs: call.endedAt - call.startedAt } : {}),
      input: bounded(call.input),
      output: bounded(call.output),
      ...(call.error ? { error: call.error } : {}),
    })),
  };
}
