// The Evals tab's run metrics, for this browser's current session only. Each run this reader
// finishes, and each replay they watch to the end (or skip to the end of), is recorded here and
// nowhere else: nothing is sent to the server, other people's runs never appear, and Reset starts
// a fresh session. Replays and scripted (synthetic) runs count, each labelled so.
import type { TeamMode, TeamProvider, TeamScorecard } from "@northstar/architecture";
import { useSyncExternalStore } from "react";

export type SessionRun = {
  /** Unique per entry: a live run is one entry, each replay of a run is another. */
  key: string;
  runId: string;
  title: string;
  brand: string;
  mode: TeamMode;
  provider: TeamProvider;
  /** Where the open-model tier ran (ADR-021); absent on entries recorded before it was kept. */
  aiPlatform?: "workers-ai" | "vertex";
  source: "live" | "replay";
  /** The run ran on the scripted test model, not a real one. */
  scripted: boolean;
  status: "done" | "waiting" | "stopped";
  /** Every tool the run's agents called, for the tool library's session highlights. */
  tools?: string[];
  at: string;
  scorecard: TeamScorecard | null;
};

export type SessionMetrics = { startedAt: string; runs: SessionRun[] };

const KEY = "northstar.team.session-metrics";
/** Enough for a long demo; the oldest entries drop off beyond it. */
const MAX_RUNS = 200;

const fresh = (): SessionMetrics => ({ startedAt: new Date().toISOString(), runs: [] });

function read(): SessionMetrics {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as SessionMetrics;
    return Array.isArray(parsed.runs) && typeof parsed.startedAt === "string" ? parsed : fresh();
  } catch {
    return fresh();
  }
}

let current: SessionMetrics | null = null;
const listeners = new Set<() => void>();

function snapshot(): SessionMetrics {
  current ??= read();
  return current;
}

function write(next: SessionMetrics) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or blocked; the metrics still hold for this page.
  }
  for (const listener of listeners) listener();
}

/**
 * Records a run in the session. A live run updates its own entry (it may be recorded while
 * waiting on a person, then again once it ends); a replay is always a new entry.
 */
export function recordSessionRun(run: Omit<SessionRun, "key" | "at">, at = new Date()) {
  const metrics = snapshot();
  const entry: SessionRun = {
    ...run,
    key: run.source === "live" ? `live:${run.runId}` : `replay:${run.runId}:${at.getTime()}`,
    at: at.toISOString(),
  };
  const runs = [entry, ...metrics.runs.filter((item) => item.key !== entry.key)].slice(0, MAX_RUNS);
  write({ ...metrics, runs });
}

/** Starts a fresh session: every recorded run is forgotten. */
export function resetSessionMetrics() {
  write(fresh());
}

/** For tests: forget the in-memory copy so the next read comes from storage. */
export function reloadSessionMetrics() {
  current = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current session's metrics, updating as runs are recorded or the session is reset. */
export const useSessionMetrics = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Every tool called by a run recorded in this session. */
export const sessionTools = (metrics: SessionMetrics) =>
  new Set(metrics.runs.flatMap((run) => run.tools ?? []));
