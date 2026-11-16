import { TURN_TRACE_PART_TYPE, type TurnTrace, toolServer, toolSystem } from "@northstar/contracts";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { latestRoute, type RouteMap, routeMap } from "./turn-route";

type Event = TurnTrace["events"][number];
const START = 1_000;
const SALESFORCE_TOOL = "tool_salesforce_abc_check_campaign_readiness";

const assistant = (events: Event[], parts: unknown[] = []) =>
  ({
    id: "answer",
    role: "assistant",
    parts: [{ type: TURN_TRACE_PART_TYPE, data: { startedAt: START, events } }, ...parts],
  }) as unknown as UIMessage;

const modelStart: Event = {
  kind: "turn-start",
  at: START,
  model: "@cf/openai/gpt-oss-20b",
  toolCount: 18,
  route: "model",
};
const stepStart: Event = { kind: "step-start", at: START + 10, step: 0 };
const toolStart = (toolName: string, toolCallId = "call-1"): Event => ({
  kind: "tool-input-available",
  at: START + 20,
  toolCallId,
  toolName,
});
const toolEnd = (toolCallId = "call-1"): Event => ({
  kind: "tool-output-available",
  at: START + 30,
  toolCallId,
});
const finish = (
  outcome: "completed" | "aborted" | "timed-out" | "failed" = "completed",
): Event => ({
  kind: "turn-finish",
  at: START + 2_500,
  outcome,
});
const toolPart = (toolName: string, output: unknown, toolCallId = "call-1") => ({
  type: "dynamic-tool",
  toolName,
  toolCallId,
  state: "output-available",
  input: {},
  output,
});

const node = (map: RouteMap, id: string) => {
  const found = map.lanes.flatMap((lane) => lane.nodes).find((item) => item.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};
const states = (map: RouteMap, ...ids: string[]) => ids.map((id) => node(map, id).state);
const live = (message: UIMessage | null) => routeMap(message, { surface: "browser", live: true });
const settled = (message: UIMessage | null) =>
  routeMap(message, { surface: "browser", live: false });

describe("toolServer", () => {
  it("names the server behind a tool the way toolSystem names its system", () => {
    expect(toolServer(SALESFORCE_TOOL)).toBe("salesforce");
    expect(toolServer("context_get_weather")).toBe("campaign-context");
    expect(toolServer("ext_get_fed_announcements")).toBe("external-services");
    expect(toolServer("ls_vault_list_approved_claims")).toBe("life-sciences");
    expect(toolServer("graph_get_graph_overview")).toBe("knowledge-graph");
    expect(toolSystem("ls_vault_list_approved_claims")).toBe("Veeva Vault");
    expect(toolSystem("ext_get_fed_announcements")).toBe("The Federal Reserve feed");
    expect(toolSystem("graph_get_graph_overview")).toBe("The knowledge graph");
  });
});

describe("the route of a turn", () => {
  it("lights nothing before a message is sent", () => {
    const map = settled(null);
    expect(map.live).toBe(false);
    const all = map.lanes.flatMap((lane) => lane.nodes);
    expect(all.every((item) => item.state === "idle")).toBe(true);
  });

  it("waits at the policy router until the turn starts", () => {
    const map = live(null);
    expect(states(map, "surface", "access", "router", "model")).toEqual([
      "done",
      "done",
      "active",
      "idle",
    ]);
    expect(map.summary).toBe("The policy router is reading the request");
  });

  it("shows the model working once the router sends the turn to it", () => {
    const map = live(assistant([modelStart, stepStart]));
    expect(states(map, "router", "ai-gateway", "model")).toEqual(["done", "active", "active"]);
    expect(node(map, "model").detail).toBe("gpt-oss-20b");
    expect(map.summary).toBe("Workers AI is choosing the next step");
  });

  it("moves to the tool's system while the model waits on it", () => {
    const map = live(assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL)]));
    expect(states(map, "model", "agentic-gateway", "salesforce", "knowledge-graph")).toEqual([
      "done",
      "active",
      "active",
      "idle",
    ]);
    expect(node(map, "salesforce").detail).toBe("Check Campaign Readiness");
    expect(map.summary).toMatch(/^Waiting on Salesforce: Check Campaign Readiness through /);
  });

  it("lights each system when tools run at once", () => {
    const map = live(
      assistant([
        modelStart,
        stepStart,
        toolStart(SALESFORCE_TOOL, "a"),
        toolStart("graph_get_graph_overview", "b"),
      ]),
    );
    expect(states(map, "salesforce", "knowledge-graph")).toEqual(["active", "active"]);
    expect(map.summary).toBe("Waiting on 2 tool calls");
  });

  it("returns to the model when the tool answers, keeping the path lit", () => {
    const tool = toolPart(SALESFORCE_TOOL, { ok: true });
    const map = live(
      assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL), toolEnd()], [tool]),
    );
    expect(states(map, "model", "agentic-gateway", "salesforce")).toEqual([
      "active",
      "done",
      "done",
    ]);
  });

  it("says when the model is writing", () => {
    const map = live(
      assistant([modelStart, stepStart, { kind: "text-start", at: START + 40, index: 0 }]),
    );
    expect(map.summary).toBe("Workers AI is writing the answer");
  });

  it("stops pulsing and totals the turn when it finishes", () => {
    const tool = toolPart(SALESFORCE_TOOL, { ok: true });
    const map = live(
      assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL), toolEnd(), finish()], [tool]),
    );
    expect(map.live).toBe(false);
    expect(states(map, "model", "salesforce")).toEqual(["done", "done"]);
    expect(map.summary).toBe("Finished in 2.50s · 1 model step · 1 tool call");
  });

  it("never pulses for a turn that is not running, whatever its trace ended on", () => {
    const map = settled(assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL)]));
    expect(map.live).toBe(false);
    expect(states(map, "model", "salesforce")).toEqual(["done", "done"]);
    expect(map.summary).toMatch(/^No ending was recorded/);
  });

  it("leaves the model dark for a turn the policy router answered", () => {
    // Scripted turns emit step events too, and they are not model calls.
    const map = settled(
      assistant([
        { ...modelStart, model: "Northstar policy router", route: "unsupported" },
        stepStart,
        finish(),
      ]),
    );
    expect(states(map, "router", "ai-gateway", "model", "agentic-gateway")).toEqual([
      "done",
      "idle",
      "idle",
      "idle",
    ]);
    expect(map.summary).toBe(
      "Handled by the policy router without a model call: this action is blocked",
    );
  });
});

describe("a route that went wrong", () => {
  it("marks the system that failed, not the gateway in front of it", () => {
    const tool = toolPart(SALESFORCE_TOOL, { semanticStatus: "error", message: "It failed" });
    const map = settled(
      assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL), toolEnd(), finish()], [tool]),
    );
    expect(states(map, "agentic-gateway", "salesforce")).toEqual(["done", "error"]);
  });

  it("marks the gateway for a denial, since the system was never reached", () => {
    const tool = toolPart(SALESFORCE_TOOL, {
      semanticStatus: "error",
      message: `The agentic gateway denied ${SALESFORCE_TOOL}: not for this role`,
    });
    const map = settled(
      assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL), toolEnd(), finish()], [tool]),
    );
    expect(states(map, "agentic-gateway", "salesforce")).toEqual(["error", "idle"]);
  });

  it("stops a tool outside the catalog at the gateway", () => {
    const map = settled(assistant([modelStart, stepStart, toolStart("drop_all_tables"), finish()]));
    expect(states(map, "agentic-gateway", "salesforce")).toEqual(["error", "idle"]);
  });

  it("marks where a timed-out turn was waiting", () => {
    const map = live(
      assistant([modelStart, stepStart, toolStart(SALESFORCE_TOOL), finish("timed-out")]),
    );
    expect(states(map, "model", "salesforce")).toEqual(["done", "error"]);
    expect(map.summary).toMatch(/^The turn timed out after 2\.50s/);
  });

  it("marks the model when a turn fails with no tool out", () => {
    const map = settled(assistant([modelStart, stepStart, finish("failed")]));
    expect(states(map, "ai-gateway", "model")).toEqual(["error", "error"]);
  });
});

describe("the latest route in a chat", () => {
  const sent = (metadata?: unknown) =>
    ({ id: "question", role: "user", parts: [], metadata }) as UIMessage;
  const done = assistant([modelStart, stepStart, finish()]);
  const ids = (map: RouteMap) => map.lanes[0]?.nodes.map((item) => item.id);

  it("starts over when a new message follows a finished turn", () => {
    const map = latestRoute([sent(), done, sent()], true);
    expect(node(map, "router").state).toBe("active");
    expect(node(map, "model").state).toBe("idle");
  });

  it("keeps the finished route between turns", () => {
    expect(node(latestRoute([sent(), done], false), "model").state).toBe("done");
  });

  it("shows the hops of the surface that sent the turn, whichever surface is looking", () => {
    expect(ids(latestRoute([sent({ surface: "lightning" }), done], false))).toContain("relay");
    expect(ids(latestRoute([sent(), done], false))).not.toContain("relay");
    expect(ids(latestRoute([sent({ surface: "lightning" }), done, sent()], true))).not.toContain(
      "relay",
    );
  });
});
