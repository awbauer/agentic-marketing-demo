// The campaign squad's run library: the last ten runs, shared by everyone who opens the page, so a
// reader can replay a recent run instead of starting a new one. Each row keeps the run's event log
// and the time each event was sent, so a replay plays at the pace the run had. Rows are not scoped
// to an evaluator; only ten are kept, and they stay until newer runs replace them (ADR-016).
import type { TeamEvent } from "@northstar/architecture";
import type { TeamRun } from "./run";

/** How many runs the library keeps. */
export const LIBRARY_SIZE = 10;

type Row = Record<string, unknown>;

export type LibraryRun = {
  id: string;
  briefId: string;
  title: string;
  brand: string;
  mode: string;
  provider: string;
  /** Where the open-model tier ran, from the run's start event (ADR-021); absent on older runs. */
  aiPlatform?: string;
  scripted: boolean;
  status: string;
  tokens: number;
  events: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * One stamp per event. A run restored after a person's decision only stamped the events it sent
 * this time, so the earlier ones take the library's stamps (or the first new stamp, if the library
 * never saw them).
 */
export function alignStamps(
  eventCount: number,
  fresh: readonly number[],
  prior: readonly number[],
  now: number,
): number[] {
  const offset = Math.max(0, eventCount - fresh.length);
  const fallback = fresh[0] ?? prior.at(-1) ?? now;
  return Array.from({ length: eventCount }, (_, index) =>
    index < offset ? (prior[index] ?? fallback) : (fresh[index - offset] ?? fallback),
  );
}

/** Saves a run (or its latest state) to the library and drops all but the ten newest. */
export async function recordRun(
  db: D1Database,
  run: Pick<TeamRun, "id" | "brief" | "mode" | "provider" | "events" | "stamps" | "tokens"> & {
    status: string;
    scripted: boolean;
  },
  at: string,
) {
  const existing = await db
    .prepare("SELECT stamps, created_at FROM team_run_library WHERE id = ?")
    .bind(run.id)
    .first<Row>();
  const prior = existing ? (JSON.parse(String(existing.stamps)) as number[]) : [];
  const stamps = alignStamps(run.events.length, run.stamps, prior, Date.parse(at));
  await db.batch([
    db
      .prepare(
        "INSERT INTO team_run_library (id, brief_id, title, brand, mode, provider, scripted, status, tokens, events, stamps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, tokens = excluded.tokens, events = excluded.events, stamps = excluded.stamps, updated_at = excluded.updated_at",
      )
      .bind(
        run.id,
        run.brief.id,
        run.brief.title,
        run.brief.brand,
        run.mode,
        run.provider,
        run.scripted ? 1 : 0,
        run.status,
        run.tokens,
        JSON.stringify(run.events),
        JSON.stringify(stamps),
        existing ? String(existing.created_at) : at,
        at,
      ),
    db
      .prepare(
        "DELETE FROM team_run_library WHERE id NOT IN (SELECT id FROM team_run_library ORDER BY updated_at DESC, rowid DESC LIMIT ?)",
      )
      .bind(LIBRARY_SIZE),
  ]);
}

/** The library, newest first, without the event logs. */
export async function listRuns(db: D1Database): Promise<LibraryRun[]> {
  const { results } = await db
    .prepare(
      "SELECT id, brief_id, title, brand, mode, provider, json_extract(events, '$[0].infra.aiPlatform') AS ai_platform, scripted, status, tokens, json_array_length(events) AS event_count, stamps, created_at, updated_at FROM team_run_library ORDER BY updated_at DESC, rowid DESC LIMIT ?",
    )
    .bind(LIBRARY_SIZE)
    .all<Row>();
  return (results ?? []).map((row) => {
    const stamps = JSON.parse(String(row.stamps)) as number[];
    return {
      id: String(row.id),
      briefId: String(row.brief_id),
      title: String(row.title),
      brand: String(row.brand),
      mode: String(row.mode),
      provider: String(row.provider),
      ...(row.ai_platform ? { aiPlatform: String(row.ai_platform) } : {}),
      scripted: Number(row.scripted) === 1,
      status: String(row.status),
      tokens: Number(row.tokens),
      events: Number(row.event_count),
      durationMs: stamps.length ? (stamps.at(-1) as number) - (stamps[0] as number) : 0,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  });
}

/** One library run with its event log and stamps, or null. */
export async function runFromLibrary(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM team_run_library WHERE id = ?").bind(id).first<Row>();
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    brand: String(row.brand),
    mode: String(row.mode),
    provider: String(row.provider),
    status: String(row.status),
    events: JSON.parse(String(row.events)) as TeamEvent[],
    stamps: JSON.parse(String(row.stamps)) as number[],
  };
}
