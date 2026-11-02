import { type TurnRecord, TurnRecordSchema } from "@northstar/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryPanel } from "./MemoryPanel";
import { turnStats } from "./turn-stats";
import { readableToolName } from "./turn-trace";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; turns: TurnRecord[]; retentionHours: number };

type Filter = "all" | "issues" | "tools" | "policy";

const ROUTE_LABELS: Record<TurnRecord["route"], string> = {
  model: "Model",
  "confirmation-required": "Needs confirmation",
  unsupported: "Blocked action",
  "catalog-unavailable": "Catalog unavailable",
  memory: "Memory",
  "local-fixture": "Local fixture",
};

const OUTCOME_LABELS: Record<TurnRecord["outcome"], string> = {
  completed: "Completed",
  aborted: "Stopped",
  "timed-out": "Timed out",
  failed: "Failed",
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const payload = (value: unknown) =>
  value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

function hasIssue(turn: TurnRecord) {
  return (
    turn.outcome !== "completed" ||
    turn.fallback ||
    turn.tools.some((tool) => tool.status === "error")
  );
}

export function HistoryView({
  refreshKey,
  onClose,
  focusTitle,
}: {
  refreshKey: number;
  /** Returns to the workspace; after reopening a memory, the chat shows what was reopened. */
  onClose: () => void;
  focusTitle?: string;
}) {
  const [tab, setTab] = useState<"turns" | "memory">("turns");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    fetch("/agent/turns", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Turn history returned HTTP ${response.status}.`);
        const body = (await response.json()) as { turns?: unknown[]; retentionHours?: number };
        const turns = (body.turns ?? []).flatMap((turn) => {
          const parsed = TurnRecordSchema.safeParse(turn);
          return parsed.success ? [parsed.data] : [];
        });
        setState({ status: "ready", turns, retentionHours: body.retentionHours ?? 24 });
      })
      .catch((error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Turn history is unavailable.",
        }),
      );
  }, []);

  // refreshKey changes whenever a chat turn settles, so the list picks up the new turn.
  useEffect(() => {
    if (refreshKey >= 0) load();
  }, [load, refreshKey]);

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.turns.filter((turn) =>
      filter === "issues"
        ? hasIssue(turn)
        : filter === "tools"
          ? turn.tools.length > 0
          : filter === "policy"
            ? turn.route !== "model" && turn.route !== "local-fixture"
            : true,
    );
  }, [state, filter]);

  return (
    <section className="evaluations-view" aria-labelledby="history-title">
      <div className="section-header">
        <div>
          <p className="kicker">Audit</p>
          <h2 id="history-title">{tab === "turns" ? "Turn history" : "Memory"}</h2>
        </div>
        <fieldset className="evaluation-tabs history-tabs">
          <legend className="sr-only">History section</legend>
          <button type="button" aria-pressed={tab === "turns"} onClick={() => setTab("turns")}>
            Turns
          </button>
          <button type="button" aria-pressed={tab === "memory"} onClick={() => setTab("memory")}>
            Memory
          </button>
        </fieldset>
        <a className="text-button evaluations-back" href="/agent/audit/export" download>
          Export audit (JSON)
        </a>
        <button type="button" className="text-button" onClick={onClose}>
          Back to workspace
        </button>
      </div>
      <div className="evaluations-body">
        {tab === "memory" && (
          <MemoryPanel refreshKey={refreshKey} focusTitle={focusTitle} onReopened={onClose} />
        )}
        {tab === "turns" && state.status === "loading" && (
          <p role="status">Loading turn history…</p>
        )}
        {tab === "turns" && state.status === "error" && (
          <div className="error-banner" role="alert">
            {state.message}{" "}
            <button type="button" className="text-button" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {tab === "turns" && state.status === "ready" && (
          <>
            <div className="evaluation-card-heading">
              <p className="evaluation-meta">
                {state.turns.length} turns · kept for {state.retentionHours} hours · each utterance
                with the orchestrator's interpretation, tool calls, and outcome
              </p>
              <fieldset className="evaluation-tabs">
                <legend className="sr-only">Filter turns</legend>
                {(
                  [
                    ["all", "All"],
                    ["issues", "With issues"],
                    ["tools", "Used tools"],
                    ["policy", "Policy routed"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
            {visible.length === 0 ? (
              <div className="evaluation-empty" role="status">
                <strong>
                  {state.turns.length === 0
                    ? "No turns recorded yet."
                    : "No turns match this filter."}
                </strong>
                {state.turns.length === 0 && (
                  <p>Send a message in the workspace; each completed turn appears here.</p>
                )}
              </div>
            ) : (
              <ol className="history-list">
                {visible.map((turn) => (
                  <TurnCard turn={turn} key={turn.id} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function TurnCard({ turn }: { turn: TurnRecord }) {
  const issue = hasIssue(turn);
  return (
    <li className={`history-turn evaluation-card ${issue ? "has-issue" : ""}`}>
      <details>
        <summary>
          <span className="history-utterance">{turn.utterance || "(empty message)"}</span>
          <span className="history-badges">
            <time dateTime={turn.startedAt}>{new Date(turn.startedAt).toLocaleString()}</time>
            <span className="history-badge">{ROUTE_LABELS[turn.route]}</span>
            {turn.tools.map((tool) => (
              <span
                className={`history-badge tool-${tool.status}`}
                key={tool.toolCallId}
                title={tool.toolName}
              >
                {readableToolName(tool.toolName)}
              </span>
            ))}
            <span className={`history-badge outcome-${issue ? "issue" : "ok"}`}>
              {OUTCOME_LABELS[turn.outcome]}
              {turn.fallback ? " · recovered" : ""}
            </span>
            <span>
              {turnStats(seconds(turn.durationMs), {
                tokens: turn.inputTokens + turn.outputTokens,
                toolCalls: turn.tools.length,
              })}
            </span>
          </span>
        </summary>
        <dl className="evaluation-definitions history-details">
          <div>
            <dt>Interpretation</dt>
            <dd>{turn.interpretation}</dd>
          </div>
          {turn.scope && (
            <div>
              <dt>Brand and role</dt>
              <dd>
                {turn.scope.brand === "all" ? "All brands" : turn.scope.brand} ·{" "}
                {turn.scope.persona.replace("-", " ")}
              </dd>
            </div>
          )}
          <div>
            <dt>Model and routing</dt>
            <dd>
              <code>{turn.model}</code>
              {turn.requiredTool && (
                <>
                  {" "}
                  · required tool <code>{readableToolName(turn.requiredTool)}</code>
                </>
              )}{" "}
              · {turn.steps} step{turn.steps === 1 ? "" : "s"} · {turn.inputTokens.toLocaleString()}{" "}
              input / {turn.outputTokens.toLocaleString()} output tokens
            </dd>
          </div>
          {turn.reasoning && (
            <div>
              <dt>Model reasoning</dt>
              <dd>
                <details className="payload-viewer">
                  <summary>Show reasoning</summary>
                  <pre>{turn.reasoning}</pre>
                </details>
              </dd>
            </div>
          )}
          {turn.tools.length > 0 && (
            <div>
              <dt>Tool calls</dt>
              <dd>
                <ol className="history-tools">
                  {turn.tools.map((tool) => (
                    <li key={tool.toolCallId}>
                      <strong>{readableToolName(tool.toolName)}</strong>{" "}
                      <span className={`history-badge tool-${tool.status}`}>
                        {tool.status === "ok" ? "returned" : tool.status}
                      </span>
                      {tool.durationMs !== undefined && ` · ${seconds(tool.durationMs)}`}
                      {tool.error && <p className="history-error">{tool.error}</p>}
                      <details className="payload-viewer">
                        <summary>Input</summary>
                        <pre>{payload(tool.input)}</pre>
                      </details>
                      <details className="payload-viewer">
                        <summary>Result</summary>
                        <pre>{payload(tool.output)}</pre>
                      </details>
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          )}
          <div>
            <dt>Outcome</dt>
            <dd>
              {OUTCOME_LABELS[turn.outcome]}
              {turn.fallback && " · the orchestrator added a recovery message"}
              {turn.failure && <p className="history-error">{turn.failure}</p>}
            </dd>
          </div>
          <div>
            <dt>Answer</dt>
            <dd className="history-answer">{turn.answer || "No text"}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}
