// Every tool the squad's agents can be granted, for reference: what it does (the Learn reference's
// own line for it), what kind of tool it is, which agents the gateway grants it to, and whether it
// ran in this run or earlier in this browser session.
import { TEAM_AGENTS, TEAM_READ_TOOLS, TEAM_TOOL_NAMES } from "@northstar/architecture";
import { useMemo, useState } from "react";
import { LEARN_REFERENCE } from "../learn/reference";
import { sessionTools, useSessionMetrics } from "./session-metrics";
import type { TeamState } from "./team-state";

type Kind = "Coordination" | "Shared" | "Reads data" | "Saves work";

const COORDINATION = new Set([
  "plan_campaign",
  "delegate_task",
  "review_work",
  "reconcile_plan",
  "request_compliance_review",
  "send_proposal",
  "request_decision",
  "lifecycle_step",
]);
const SHARED = new Set([
  "read_team_output",
  "query_semantic_layer",
  "define_term",
  "ask_teammate",
  "answer_teammate",
]);
const READS = new Set<string>(TEAM_READ_TOOLS);

const kindOf = (tool: string): Kind =>
  COORDINATION.has(tool)
    ? "Coordination"
    : SHARED.has(tool)
      ? "Shared"
      : READS.has(tool)
        ? "Reads data"
        : "Saves work";

const SUMMARIES = new Map(
  LEARN_REFERENCE.filter((entry) => entry.kind === "Tool").map((entry) => [
    entry.name,
    entry.summary,
  ]),
);
/** The pharma lead's one tool isn't in the team's grant list: the lifecycle offers it directly. */
const EXTRA: Record<string, { summary: string; agents: string[] }> = {
  lifecycle_step: {
    summary:
      "The pharma campaign lead's one tool: assign the next agent step, or ask the next person to decide. Offered, not forced; the server refuses a step out of order.",
    agents: ["Campaign lead"],
  },
};

export type ToolRow = {
  name: string;
  kind: Kind;
  summary: string;
  agents: string[];
  /** Calls in the run on the page, and how many a guardrail stopped. */
  calls: number;
  stopped: number;
  /** Called by a run recorded earlier in this browser session. */
  inSession: boolean;
};

/** The library's rows, in the team's own order, with this run's and this session's use. */
export function toolRows(
  state: Pick<TeamState, "agents">,
  session: ReadonlySet<string>,
): ToolRow[] {
  const steps = Object.values(state.agents).flatMap((view) => view.tools);
  return [...TEAM_TOOL_NAMES, ...Object.keys(EXTRA)].map((name) => {
    const calls = steps.filter((step) => step.tool === name);
    return {
      name,
      kind: kindOf(name),
      summary: SUMMARIES.get(name) ?? EXTRA[name]?.summary ?? "",
      agents:
        EXTRA[name]?.agents ??
        TEAM_AGENTS.filter((agent) => (agent.tools as readonly string[]).includes(name)).map(
          (agent) => agent.name,
        ),
      calls: calls.length,
      stopped: calls.filter((step) => !step.ok).length,
      inSession: session.has(name),
    };
  });
}

const KINDS: Kind[] = ["Coordination", "Shared", "Reads data", "Saves work"];

export function ToolLibrary({ state }: { state: Pick<TeamState, "agents"> }) {
  const metrics = useSessionMetrics();
  const rows = useMemo(() => toolRows(state, sessionTools(metrics)), [state, metrics]);
  const [query, setQuery] = useState("");
  const [usedOnly, setUsedOnly] = useState(false);
  const term = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (!usedOnly || row.calls > 0 || row.inSession) &&
      (!term ||
        row.name.includes(term) ||
        row.summary.toLowerCase().includes(term) ||
        row.agents.some((agent) => agent.toLowerCase().includes(term))),
  );
  const usedNow = rows.filter((row) => row.calls > 0).length;
  const usedSession = rows.filter((row) => row.calls > 0 || row.inSession).length;
  return (
    <div className="team-tool-library">
      <p className="arch-note">
        Every tool the gateway can grant the squad's agents ({rows.length}). {usedNow} ran in this
        run and {usedSession} in this session; they're highlighted. Each call is checked as{" "}
        <code>team:&lt;tool&gt;</code>.
      </p>
      <div className="team-tool-filters">
        <input
          type="search"
          placeholder="Filter by tool, purpose or agent"
          aria-label="Filter tools"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={usedOnly}
            onChange={(event) => setUsedOnly(event.target.checked)}
          />
          Only tools used this session
        </label>
      </div>
      {KINDS.map((kind) => {
        const group = shown.filter((row) => row.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind} className="team-table-wrap">
            <table className="team-table team-tool-table">
              <caption>{kind}</caption>
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Granted to</th>
                  <th scope="col">Used</th>
                </tr>
              </thead>
              <tbody>
                {group.map((row) => (
                  <tr
                    key={row.name}
                    className={row.calls > 0 ? "used-run" : row.inSession ? "used-session" : ""}
                  >
                    <th scope="row">
                      <code>{row.name}</code>
                    </th>
                    <td>{row.summary}</td>
                    <td>{row.agents.join(", ") || "—"}</td>
                    <td>
                      {row.calls > 0
                        ? `${row.calls}× this run${row.stopped ? ` · ${row.stopped} stopped` : ""}`
                        : row.inSession
                          ? "Earlier this session"
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {shown.length === 0 && <p className="arch-note">No tool matches.</p>}
    </div>
  );
}
