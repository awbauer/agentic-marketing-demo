// The shared library of recent squad runs: the last ten, any brand, mode or provider, kept on the
// server for everyone who opens the page. Picking one loads its event log and the time each event
// was sent, so the page can replay it at the pace it ran instead of starting a new run.
import { type TeamEvent, teamOpenModels } from "@northstar/architecture";
import { AI_PLATFORM_TERMS, hostTerms } from "@northstar/contracts";
import { useEffect, useState } from "react";
import { type ArchApiError, archFetch, type Scope, useArch } from "../architecture/api";
import { ErrorNote } from "../architecture/Shared";

/** What this host calls its infrastructure (ADR-018). */
const HOST = hostTerms();

export type LibraryRunSummary = {
  id: string;
  briefId: string;
  title: string;
  brand: string;
  mode: string;
  provider: string;
  /** Where the open-model tier ran; absent on runs from before it was recorded. */
  aiPlatform?: string;
  scripted: boolean;
  status: string;
  tokens: number;
  events: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryRun = {
  id: string;
  title: string;
  events: TeamEvent[];
  stamps: number[];
};

const PROVIDERS: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
};

const STATUS: Record<string, string> = {
  done: "Finished",
  waiting: "Waiting on a person",
  stopped: "Stopped",
};

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const length = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

/** A button that opens the last ten runs; choosing one hands its log to the page to replay. */
export function RunLibrary({
  scope,
  disabled,
  currentId,
  onPick,
}: {
  scope: Scope;
  disabled?: boolean;
  /** The run on the page now, marked in the list. */
  currentId?: string | null;
  onPick: (run: LibraryRun) => void;
}) {
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [brand, setBrand] = useState("all");
  const [mode, setMode] = useState("all");
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<ArchApiError | null>(null);
  const library = useArch<{ runs: LibraryRunSummary[] }>(
    open ? "/team/library" : null,
    { persona: scope.persona, brand: "all" },
    refresh,
  );
  // Escape closes the list, as it would any popover.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const runs = library.data?.runs ?? [];
  const brands = [...new Set(runs.map((run) => run.brand))].sort();
  const shown = runs.filter(
    (run) => (brand === "all" || run.brand === brand) && (mode === "all" || run.mode === mode),
  );

  async function pick(id: string) {
    setLoading(id);
    setFailed(null);
    try {
      const run = await archFetch<LibraryRun>(`/team/library/${encodeURIComponent(id)}`, {
        persona: scope.persona,
        brand: "all",
      });
      setOpen(false);
      onPick(run);
    } catch (failure) {
      setFailed(failure as ArchApiError);
    }
    setLoading(null);
  }

  return (
    <div className="team-library">
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        aria-controls="team-library-panel"
        disabled={disabled}
        onClick={() => {
          if (!open) setRefresh((value) => value + 1);
          setOpen(!open);
        }}
      >
        {open ? "Close recent runs" : "Replay a recent run"}
      </button>
      {open && (
        <section
          id="team-library-panel"
          className="team-library-panel"
          aria-labelledby="team-library-title"
        >
          <header>
            <h4 id="team-library-title">Recent runs</h4>
            <p className="arch-note">
              The last ten runs anyone started here, newest first. Replaying one calls no model.
            </p>
            {runs.length > 0 && (
              <div className="team-library-filters">
                <label>
                  Brand{" "}
                  <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                    <option value="all">All brands</option>
                    {brands.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mode{" "}
                  <select value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="all">Both</option>
                    <option value="squad">Squad</option>
                    <option value="lifecycle">Pharma lifecycle</option>
                  </select>
                </label>
              </div>
            )}
          </header>
          {library.error ? (
            <ErrorNote error={library.error} onRetry={() => setRefresh((value) => value + 1)} />
          ) : library.loading && !library.data ? (
            <p className="arch-note" role="status">
              Loading recent runs…
            </p>
          ) : runs.length === 0 ? (
            <p className="arch-note">
              No runs yet. Start one and it will be kept here for anyone to replay.
            </p>
          ) : shown.length === 0 ? (
            <p className="arch-note">No recent run matches these filters.</p>
          ) : (
            <ol className="team-library-list">
              {shown.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    disabled={loading !== null}
                    aria-current={run.id === currentId ? "true" : undefined}
                    onClick={() => void pick(run.id)}
                  >
                    <strong>{run.title}</strong>
                    <span>
                      {run.brand} · {run.mode === "lifecycle" ? "Pharma lifecycle" : "Squad"} ·{" "}
                      {run.provider === "cloudflare"
                        ? AI_PLATFORM_TERMS[teamOpenModels(run.aiPlatform, HOST.id)].label
                        : (PROVIDERS[run.provider] ?? run.provider)}
                      {run.scripted ? " (scripted)" : ""}
                    </span>
                    <small>
                      {STATUS[run.status] ?? run.status} · {when(run.updatedAt)} · {run.events}{" "}
                      events · {length(run.durationMs)} · {run.tokens.toLocaleString("en-US")}{" "}
                      tokens
                      {run.id === currentId ? " · on the page now" : ""}
                      {loading === run.id ? " · loading…" : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {failed && <ErrorNote error={failed} />}
        </section>
      )}
    </div>
  );
}
