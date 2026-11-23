export type Source = { name: string; ready: boolean };

/**
 * The data sources in the sidebar, collapsed by default to one line that says how many are ready
 * and names any that aren't. Open it for the full list.
 */
export function SourceList({ sources }: { sources: readonly Source[] }) {
  const down = sources.filter((source) => !source.ready);
  const ready = sources.length - down.length;
  return (
    <details className="source-list">
      <summary>
        <span className="nav-label">Sources</span>
        <span className="source-summary">
          <i className={`dot ${down.length ? "stale" : "ready"}`} aria-hidden="true" />
          {down.length === 0
            ? `All ${sources.length} ready`
            : `${ready} of ${sources.length} ready · ${down.map((source) => source.name).join(", ")} offline`}
        </span>
      </summary>
      {sources.map((source) => (
        <div key={source.name} className="source-row">
          <i className={`dot ${source.ready ? "ready" : "stale"}`} />
          {source.name}
          <span className="sr-only">{source.ready ? " (ready)" : " (offline)"}</span>
        </div>
      ))}
    </details>
  );
}
