import {
  AI_PLATFORM_TERMS,
  type AiPlatformId,
  pageHost,
  SALESFORCE_AGENTS,
  type ToolServer,
  toolServer,
  toolSystem,
} from "@northstar/contracts";
import type { UIMessage } from "ai";
import { currentAiPlatform } from "./ai-platform";
import {
  isKnownTool,
  plural,
  ROUTE_DETAIL,
  readableToolName,
  salesforceToolDetail,
  seconds,
  semanticToolFailure,
  toolParts,
  turnTrace,
} from "./turn-trace";

export type RouteNodeState = "idle" | "active" | "done" | "error";
export type RouteNode = {
  id: string;
  label: string;
  detail: string;
  state: RouteNodeState;
  stateLabel: string;
  /** One of several alternatives, not the next hop after the node before it. */
  branch?: boolean;
};
export type RouteLane = { id: "request" | "tools"; label: string; nodes: RouteNode[] };
export type RouteMap = { live: boolean; summary: string; lanes: RouteLane[] };
export type TurnSurface = "browser" | "lightning";

const STATE_LABEL: Record<RouteNodeState, string> = {
  idle: "not used",
  active: "working now",
  done: "passed through",
  error: "had a problem",
};
const SERVER_LABEL: Record<ToolServer, string> = {
  salesforce: "Salesforce",
  "campaign-context": "Campaign context",
  "external-services": "External services",
  "life-sciences": "Life sciences",
  "knowledge-graph": "Knowledge graph",
};
const OUTCOME_SUMMARY = {
  aborted: "The turn was stopped",
  "timed-out": "The turn timed out",
  failed: "The turn failed",
} as const;
const GATEWAY_DENIAL = /^The agentic gateway denied /;

type ServerUse = { calls: number; lastTool: string; failed: boolean };

/** What a turn's trace says happened so far, including which tool calls are still out. */
function readTrace(message: UIMessage) {
  const trace = turnTrace(message);
  const tools = new Map(toolParts(message).map((tool) => [tool.toolCallId, tool]));
  const running = new Map<string, string>();
  const seen = new Set<string>();
  const servers = new Map<ToolServer, ServerUse>();
  const open = { text: new Set<number>(), reasoning: new Set<number>() };
  let toolCalls = 0;
  let steps = 0;
  let gatewayFailed = false;
  let modelFailed = false;
  let streamFailed = false;

  const dispatch = (id: string, name: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    // A tool outside the catalog stops at the gateway, whichever system its name resembles.
    if (!isKnownTool(name)) {
      gatewayFailed = true;
      return;
    }
    toolCalls += 1;
    running.set(id, name);
    const server = toolServer(name);
    const use = servers.get(server) ?? { calls: 0, lastTool: "", failed: false };
    servers.set(server, { ...use, calls: use.calls + 1, lastTool: readableToolName(name) });
  };

  const settle = (id: string, failed: boolean, denied = false) => {
    const name = running.get(id);
    running.delete(id);
    if (!name) return;
    const server = toolServer(name);
    const use = servers.get(server);
    if (!use) return;
    if (denied) {
      // The gateway refused it, so the system behind it was never reached.
      gatewayFailed = true;
      if (use.calls === 1) servers.delete(server);
      else servers.set(server, { ...use, calls: use.calls - 1 });
    } else if (failed) servers.set(server, { ...use, failed: true });
  };

  for (const event of trace?.events ?? []) {
    switch (event.kind) {
      case "step-start":
        steps += 1;
        break;
      case "step-finish":
        if (event.finishReason === "error") modelFailed = true;
        break;
      case "text-start":
        open.text.add(event.index);
        break;
      case "text-end":
        open.text.delete(event.index);
        break;
      case "reasoning-start":
        open.reasoning.add(event.index);
        break;
      case "reasoning-end":
        open.reasoning.delete(event.index);
        break;
      case "tool-input-available":
        dispatch(event.toolCallId, event.toolName);
        break;
      case "tool-input-error":
        // The arguments never validated, so the call didn't leave the model.
        modelFailed = true;
        break;
      case "tool-output-available": {
        const output = tools.get(event.toolCallId)?.output;
        const message = (output as { message?: unknown } | undefined)?.message;
        settle(
          event.toolCallId,
          semanticToolFailure(output) !== null,
          typeof message === "string" && GATEWAY_DENIAL.test(message),
        );
        break;
      }
      case "tool-output-error":
        settle(event.toolCallId, true);
        break;
      case "error":
        streamFailed = true;
        break;
      default:
    }
  }
  const events = trace?.events ?? [];
  return {
    trace,
    start: events.find((event) => event.kind === "turn-start"),
    finish: events.find((event) => event.kind === "turn-finish"),
    running,
    servers,
    open,
    toolCalls,
    steps,
    gatewayFailed,
    modelFailed,
    streamFailed,
  };
}

function toolDetail(names: string[], use: ServerUse | undefined) {
  if (names.length > 0) return readableToolName(names[names.length - 1] ?? "");
  if (!use) return "";
  return use.calls === 1 ? use.lastTool : plural(use.calls, "call");
}

function runningSummary(names: string[]) {
  const [name] = names;
  if (!name) return "";
  if (names.length > 1) return `Waiting on ${names.length} tool calls`;
  const agent = salesforceToolDetail(name)?.agent;
  const via = agent ? ` through ${SALESFORCE_AGENTS[agent].label}` : "";
  return `Waiting on ${toolSystem(name)}: ${readableToolName(name)}${via}`;
}

/**
 * Which components a turn has passed through, and which one is working now, read from the same
 * trace as the technical view rather than a script of what should happen. `live` says the turn is
 * still running: without it nothing pulses, whatever the trace looks like. The browser draws this
 * directly, and the Worker sends it to other surfaces so they carry no copy of these rules.
 */
export function routeMap(
  message: UIMessage | null,
  { surface, live }: { surface: TurnSurface; live: boolean },
): RouteMap {
  const seen = message ? readTrace(message) : null;
  const finish = seen?.finish;
  const working = live && !finish;
  const started = Boolean(seen?.start);
  const reached = working || started;
  const viaModel = seen?.start?.route === "model";
  const running = [...(seen?.running.values() ?? [])];
  const failedEnd = Boolean(
    seen?.streamFailed || (finish?.outcome && finish.outcome !== "completed"),
  );
  const thinking = working && viaModel && running.length === 0;
  // A turn's trace names its host; before the first turn, the page's host does.
  const google = (seen?.start ? seen.start.host : pageHost()) === "google-cloud";
  // The models run where the turn's trace says (ADR-021); before the first turn, where the top
  // bar points; failing both, on the host's own platform.
  const platform =
    AI_PLATFORM_TERMS[
      (seen?.start?.aiPlatform ??
        (seen?.start ? null : currentAiPlatform()) ??
        (google ? "vertex" : "workers-ai")) as AiPlatformId
    ];

  const node = (
    id: string,
    label: string,
    state: RouteNodeState,
    detail = "",
    branch = false,
  ): RouteNode => ({
    id,
    label,
    detail,
    state,
    stateLabel: STATE_LABEL[state],
    ...(branch ? { branch } : {}),
  });

  const modelState: RouteNodeState = !viaModel
    ? "idle"
    : seen?.modelFailed || (failedEnd && running.length === 0)
      ? "error"
      : thinking
        ? "active"
        : "done";
  const serverNodes = (Object.keys(SERVER_LABEL) as ToolServer[]).map((server) => {
    const use = seen?.servers.get(server);
    const out = running.filter((name) => toolServer(name) === server);
    const state: RouteNodeState = !viaModel
      ? "idle"
      : use?.failed || (out.length > 0 && failedEnd)
        ? "error"
        : out.length > 0 && working
          ? "active"
          : use
            ? "done"
            : "idle";
    return node(server, SERVER_LABEL[server], state, toolDetail(out, use), true);
  });
  const gatewayState: RouteNodeState = seen?.gatewayFailed
    ? "error"
    : running.length > 0 && working
      ? "active"
      : serverNodes.some((server) => server.state !== "idle")
        ? "done"
        : "idle";

  return {
    live: working,
    summary: routeSummary(seen, { working, failedEnd, viaModel, running }),
    lanes: [
      {
        id: "request",
        label: "Request and model",
        nodes: [
          node(
            "surface",
            surface === "lightning" ? "Lightning page" : "Browser",
            reached ? "done" : "idle",
          ),
          ...(surface === "lightning"
            ? [node("relay", "Apex relay", reached ? "done" : "idle")]
            : []),
          node(
            "access",
            google ? "Identity-Aware Proxy" : "Cloudflare Access",
            reached ? "done" : "idle",
          ),
          node(
            "router",
            "Policy router",
            started ? "done" : working ? "active" : "idle",
            started && !viaModel ? "Answered here" : "",
          ),
          // The classifier's labels decide, through policy, which tools the model is offered.
          ...(seen?.start?.intents?.length
            ? [node("classifier", "Classifier", "done", seen.start.intents.join(", "))]
            : []),
          // Only Workers AI goes through AI Gateway; Vertex AI, Azure AI Foundry and Amazon
          // Bedrock are called directly, from either host.
          ...(platform.gateway ? [node("ai-gateway", platform.gateway, modelState)] : []),
          node(
            "model",
            platform.label,
            modelState,
            viaModel ? (seen?.start?.model.split("/").pop() ?? "") : "",
          ),
        ],
      },
      {
        id: "tools",
        label: "Tools",
        nodes: [node("agentic-gateway", "Agentic gateway", gatewayState), ...serverNodes],
      },
    ],
  };
}

function routeSummary(
  seen: ReturnType<typeof readTrace> | null,
  {
    working,
    failedEnd,
    viaModel,
    running,
  }: { working: boolean; failedEnd: boolean; viaModel: boolean; running: string[] },
) {
  const route = seen?.start?.route;
  if (seen?.start && !viaModel)
    return route && route !== "model" ? ROUTE_DETAIL[route] : "Answered without a model call";
  if (working) {
    if (!seen?.start) return "The policy router is reading the request";
    if (running.length > 0) return runningSummary(running);
    const models =
      AI_PLATFORM_TERMS[
        seen.start.aiPlatform ?? (seen.start.host === "google-cloud" ? "vertex" : "workers-ai")
      ].label;
    if (seen.open.text.size > 0) return `${models} is writing the answer`;
    if (seen.open.reasoning.size > 0) return `${models} is reasoning`;
    return `${models} is choosing the next step`;
  }
  if (!seen?.start) return "Send a message to see which components it passes through";
  const finish = seen.finish;
  const elapsed = finish && seen.trace ? seconds(finish.at - seen.trace.startedAt) : null;
  const totals = `${plural(seen.steps, "model step")} · ${plural(seen.toolCalls, "tool call")}`;
  if (finish?.outcome === "completed" && !failedEnd) return `Finished in ${elapsed} · ${totals}`;
  if (finish && finish.outcome !== "completed")
    return `${OUTCOME_SUMMARY[finish.outcome]} after ${elapsed} · ${totals}`;
  return failedEnd ? `The turn failed · ${totals}` : `No ending was recorded · ${totals}`;
}

/** The route for the newest turn in a chat, started from whichever surface sent its message. */
export function latestRoute(messages: UIMessage[], live: boolean) {
  const last = messages.at(-1);
  const user = messages.filter((message) => message.role === "user").at(-1);
  const { surface } = (user?.metadata ?? {}) as { surface?: unknown };
  return routeMap(last?.role === "assistant" ? last : null, {
    surface: surface === "lightning" ? "lightning" : "browser",
    live,
  });
}
