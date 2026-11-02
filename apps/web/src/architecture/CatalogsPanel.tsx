import { useState } from "react";
import { archFetch, type Scope, useArch } from "./api";
import { ErrorNote, Loading, Panel } from "./Shared";

type Prompts = {
  prompts: Array<{
    id: string;
    version: number;
    agentId: string;
    agentName: string;
    template: string;
    variables: Array<{
      name: string;
      kind: string;
      objectKind?: string;
      fields?: string[];
      values?: string[];
    }>;
    evaluators: string[];
    hardRules: string[];
  }>;
  note: string;
};
type Models = {
  models: Array<{
    id: string;
    label: string;
    toolCalling: boolean;
    contextTokens: number;
    tasks: string[];
    score: { passed: number; total: number } | null;
  }>;
  taskClasses: Array<{
    taskClass: string;
    champion: string;
    challengers: Array<{ id: string; promotion: { ok: boolean; reasons: string[] } }>;
  }>;
  routes: Array<{
    agentId: string;
    promptId: string | null;
    taskClass: string;
    model: string;
    reason: string;
  }>;
  shadow: { share: number; dailyCostCapUsd: number };
  note: string;
};
type Evaluations = {
  evaluators: Array<{ id: string; label: string; method: string; threshold: number }>;
  agents: Array<{
    id: string;
    name: string;
    lifecycle: string;
    autonomy: string;
    supported: { level: string; reason: string };
    drift: {
      samples: number;
      drifted: boolean;
      insufficient: boolean;
      evaluators: Array<{ id: string; recent: number; baseline: number; drifted: boolean }>;
    };
  }>;
  notes: string[];
};

export function PromptsPanel({ scope }: { scope: Scope }) {
  const { data, error, loading, reload } = useArch<Prompts>("/prompts", scope);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading label="prompt catalog" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <Panel title="Prompt catalog" kicker="A catalog, not files">
      <p className="arch-note">{data.note}</p>
      <table className="arch-table">
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Agent</th>
            <th>Version</th>
            <th>Variables</th>
            <th>Scored by</th>
          </tr>
        </thead>
        <tbody>
          {data.prompts.map((prompt) => (
            <>
              <tr key={prompt.id}>
                <td>
                  <button
                    type="button"
                    className="arch-link"
                    onClick={() => setOpen(open === prompt.id ? null : prompt.id)}
                    aria-expanded={open === prompt.id}
                  >
                    {prompt.id}
                  </button>
                </td>
                <td>{prompt.agentName}</td>
                <td>v{prompt.version}</td>
                <td>{prompt.variables.map((variable) => variable.name).join(", ")}</td>
                <td>{prompt.evaluators.join(", ")}</td>
              </tr>
              {open === prompt.id && (
                <tr key={`${prompt.id}-detail`} className="arch-detail">
                  <td colSpan={5}>
                    <p>{prompt.template}</p>
                    <ul>
                      {prompt.variables.map((variable) => (
                        <li key={variable.name}>
                          <code>{`{{${variable.name}}}`}</code>{" "}
                          {variable.kind === "urn"
                            ? `a governed ${variable.objectKind}; only ${variable.fields?.join(", ")}`
                            : variable.kind === "enum"
                              ? `one of ${variable.values?.join(", ")}`
                              : variable.kind}
                        </li>
                      ))}
                    </ul>
                    <small>Always enforced: {prompt.hardRules.join(", ")}.</small>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function ModelsPanel({ scope }: { scope: Scope }) {
  const { data, error, loading, reload } = useArch<Models>("/models", scope);
  if (loading && !data) return <Loading label="model catalog" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const label = (id: string) => data.models.find((model) => model.id === id)?.label ?? id;
  return (
    <Panel title="Model catalog and routing" kicker="Routed, not wired">
      <p className="arch-note">{data.note}</p>
      <table className="arch-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Champion</th>
            <th>Challengers</th>
          </tr>
        </thead>
        <tbody>
          {data.taskClasses.map((task) => (
            <tr key={task.taskClass}>
              <td>{task.taskClass}</td>
              <td>{label(task.champion)}</td>
              <td>
                {task.challengers.length === 0 && "none"}
                {task.challengers.map((challenger) => (
                  <div key={challenger.id}>
                    {label(challenger.id)}{" "}
                    <span className={challenger.promotion.ok ? "arch-flag ok" : "arch-flag"}>
                      {challenger.promotion.ok ? "beats the champion" : "not yet"}
                    </span>
                    {!challenger.promotion.ok &&
                      challenger.promotion.reasons.map((reason) => (
                        <small key={reason} className="arch-reason">
                          {reason}
                        </small>
                      ))}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="arch-note">
        Challengers run in shadow on {Math.round(data.shadow.share * 100)}% of turns, capped at $
        {data.shadow.dailyCostCapUsd} a day, and never reach a user. Promotion is a pull request
        that needs a passing evaluation.
      </p>
      <h4>Where each agent is bound today</h4>
      <ul className="arch-routes">
        {data.routes.map((route) => (
          <li key={route.agentId}>
            <strong>{route.agentId}</strong> → {label(route.model)}{" "}
            <small>
              {route.taskClass}
              {route.promptId ? ` · prompt ${route.promptId}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function EvaluationsPanel({
  scope,
  refreshKey,
  onChanged,
}: {
  scope: Scope;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { data, error, loading, reload } = useArch<Evaluations>("/evaluations", scope, refreshKey);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading label="evaluations" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <Panel
      title="Thirteen evaluators, drift watch, staged autonomy"
      kicker="Evidence for autonomy"
      aside={
        <button
          type="button"
          className="arch-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await archFetch("/maintenance", scope, { body: {} });
              onChanged();
              reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          Run drift watch and expiry now
        </button>
      }
    >
      {data.notes.map((note) => (
        <p key={note} className="arch-note">
          {note}
        </p>
      ))}
      <ul className="arch-evaluators">
        {data.evaluators.map((evaluator) => (
          <li key={evaluator.id}>
            <strong>{evaluator.label}</strong>{" "}
            <small>
              {evaluator.method} · passes at {evaluator.threshold}
            </small>
          </li>
        ))}
      </ul>
      <table className="arch-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Lifecycle</th>
            <th>Autonomy now</th>
            <th>Evidence supports</th>
            <th>Samples</th>
            <th>Drift</th>
          </tr>
        </thead>
        <tbody>
          {data.agents.map((agent) => (
            <tr key={agent.id} className={agent.drift.drifted ? "bad" : undefined}>
              <td>{agent.name}</td>
              <td>{agent.lifecycle}</td>
              <td>{agent.autonomy}</td>
              <td>
                {agent.supported.level}
                <small className="arch-reason">{agent.supported.reason}</small>
              </td>
              <td>{agent.drift.samples}</td>
              <td>
                {agent.drift.insufficient
                  ? "needs 5 samples"
                  : agent.drift.drifted
                    ? agent.drift.evaluators
                        .filter((item) => item.drifted)
                        .map((item) => `${item.id} ${item.recent}`)
                        .join(", ")
                    : "none"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
