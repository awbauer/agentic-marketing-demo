import { useEffect, useState } from "react";
import type { executionTrace } from "./turn-trace";

/**
 * Behind the scenes: every model and tool event of an answer, in order. It opens while the answer
 * streams or when something went wrong, and then stays as the person left it.
 */
export function TechnicalTrace({
  rows,
  live,
}: {
  rows: ReturnType<typeof executionTrace>;
  live: boolean;
}) {
  const errors = rows.filter((row) => row.state === "error").length;
  // Opens while the answer streams or when something went wrong, then stays as the person left
  // it: finishing the answer doesn't close it.
  const [open, setOpen] = useState(live || errors > 0);
  useEffect(() => {
    if (live || errors > 0) setOpen(true);
  }, [live, errors]);
  if (rows.length === 0) return null;
  return (
    <details
      className="execution-trace"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Behind the scenes · technical trace
        <span className="trace-summary-meta">
          {` · ${rows.length} events${errors ? ` · ${errors} with issues` : ""}${live ? " · live" : ""}`}
        </span>
      </summary>
      <ol>
        {rows.map((row) => (
          <li className={`trace-${row.state} trace-kind-${row.kind}`} key={row.key}>
            <i className={`trace-indicator indicator-${row.state}`} />
            <div className="trace-detail">
              <div className="trace-heading">
                <strong>{row.label}</strong>
                {row.elapsed && <time className="trace-time">{row.elapsed}</time>}
              </div>
              <span className="trace-copy">{row.detail}</span>
              {row.payload && (
                <details className="payload-viewer">
                  <summary>{row.payloadLabel ?? "Sanitized payload"}</summary>
                  <pre>{row.payload}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="trace-boundary">
        Every model and tool lifecycle event for this turn, in order, with times from the start of
        the turn. Credentials, confirmation material, and personal data are redacted.
      </p>
    </details>
  );
}
