-- The campaign squad's run library: the last ten runs, any brand, mode or provider, shared by
-- everyone who opens the page so any of them can be replayed. Not scoped to an evaluator; the squad
-- keeps only the ten most recent rows, and keeps them until newer runs replace them (an approved
-- exception to the 24-hour transcript retention in Section 17; see ADR-016).
-- stamps holds one epoch-millisecond time per event, so a replay keeps the run's pacing.

CREATE TABLE team_run_library (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  scripted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  events TEXT NOT NULL,
  stamps TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX team_run_library_updated ON team_run_library (updated_at);
