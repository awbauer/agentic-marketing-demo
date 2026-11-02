import type { ReactNode } from "react";
import type { ArchApiError } from "./api";

export function StateChip({ state }: { state: string }) {
  return <span className={`arch-state arch-state-${state}`}>{state.replace("_", " ")}</span>;
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="arch-note" role="status">
      Loading {label}…
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: ArchApiError; onRetry?: () => void }) {
  return (
    <div className="arch-error" role="alert">
      <strong>
        {error.status === 403
          ? "Not allowed"
          : error.status === 404
            ? "Not found"
            : "Something went wrong"}
      </strong>
      <p>{error.message}</p>
      {error.code === "DENIED" && (
        <small>The agentic gateway denied this call. It is recorded in the Trust view.</small>
      )}
      {onRetry && (
        <button type="button" className="text-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Panel({
  title,
  kicker,
  children,
  aside,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="arch-panel">
      <header>
        <div>
          {kicker && <p className="kicker">{kicker}</p>}
          <h3>{title}</h3>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Json({ value, label = "Raw response" }: { value: unknown; label?: string }) {
  return (
    <details className="arch-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
