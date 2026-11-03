import type { ResolvedTile, Row } from "@northstar/architecture";
import { relative, type Scope, useArch } from "./api";
import { ErrorNote, Loading, StateChip } from "./Shared";

type Resolved = {
  manifest: { id: string; title: string; summary: string; agents: string[]; services: string[] };
  persona: string;
  tiles: ResolvedTile[];
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function RowButton({ row, onOpen }: { row: Row; onOpen: (urn: string) => void }) {
  return (
    <button type="button" className="arch-row" onClick={() => onOpen(row.urn)}>
      <span className="arch-row-title">{row.title}</span>
      <span className="arch-row-meta">
        <StateChip state={row.state} />
        <span>
          {row.kind} · v{row.version}
        </span>
        {row.flags.map((flag) => (
          <span key={flag} className="arch-flag">
            {flag}
          </span>
        ))}
        {row.waitingOn && row.state !== "approved" && (
          <span className="arch-waiting">waiting on {row.waitingOn}</span>
        )}
      </span>
    </button>
  );
}

function Tile({ tile, onOpen }: { tile: ResolvedTile; onOpen: (urn: string) => void }) {
  if (tile.type === "metrics")
    return (
      <div className="arch-metrics">
        {tile.metrics.map((metric) => (
          <div key={metric.label} className="arch-metric">
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            {metric.detail && <small>{metric.detail}</small>}
          </div>
        ))}
      </div>
    );
  if (tile.type === "object-table")
    return tile.rows.length === 0 ? (
      <p className="arch-note">{tile.empty}</p>
    ) : (
      <div className="arch-rows">
        {tile.rows.map((row) => (
          <RowButton key={row.urn} row={row} onOpen={onOpen} />
        ))}
      </div>
    );
  if (tile.type === "stage-board")
    return (
      <ul className="arch-board">
        {tile.stages.map((stage) => (
          <li key={stage.stage} className="arch-column">
            <h5>{stage.label}</h5>
            <small>{stage.owner} decides</small>
            {stage.rows.length === 0 && <p className="arch-note">Nothing here</p>}
            {stage.rows.map((row) => (
              <button
                type="button"
                key={row.urn}
                className="arch-card"
                onClick={() => onOpen(row.urn)}
              >
                <span>{row.title}</span>
                <StateChip state={row.state} />
                {row.flags.slice(0, 2).map((flag) => (
                  <em key={flag}>{flag}</em>
                ))}
                <small>{relative(row.updatedAt)}</small>
              </button>
            ))}
          </li>
        ))}
      </ul>
    );
  return (
    <div className="arch-readiness">
      {tile.stages.map((stage) => (
        <details key={stage.stage}>
          <summary>
            <span>{stage.label}</span>
            <meter min={0} max={1} value={stage.score} aria-label={`${stage.label} readiness`} />
            <strong>{Math.round(stage.score * 100)}%</strong>
          </summary>
          <ul>
            {stage.checks.map((check) => (
              <li key={check.label} className={check.ok ? "ok" : "bad"}>
                {check.ok ? "✓" : "✕"} {check.label}: {check.detail}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** One renderer for every workspace: a manifest in, tiles out. */
export function WorkspaceRenderer({
  id,
  scope,
  refreshKey,
  onOpen,
}: {
  id: string;
  scope: Scope;
  refreshKey: number;
  onOpen: (urn: string) => void;
}) {
  const { data, error, loading, reload } = useArch<Resolved>(
    `/workspaces/${id}`,
    scope,
    refreshKey,
  );
  if (loading && !data) return <Loading label="workspace" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="arch-workspace">
      <p className="arch-lede">
        {data.manifest.summary}{" "}
        <small>
          Composed from {plural(data.manifest.agents.length, "agent")} and{" "}
          {plural(data.manifest.services.length, "service")}.
        </small>
      </p>
      {data.tiles.map((tile) => (
        <section key={tile.id} className="arch-tile" aria-label={tile.title}>
          <h4>{tile.title}</h4>
          <Tile tile={tile} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}
