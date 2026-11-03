-- A sample flow's orchestration, kept while it waits for a person's decision. The messages are
-- the orchestrator's conversation so far; it resumes from them once the person has decided.
-- Rows expire with the rest of the architecture data (24 hours).

CREATE TABLE arch_orchestrations (
  subject TEXT NOT NULL,
  id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  status TEXT NOT NULL,
  waiting_on TEXT,
  messages TEXT NOT NULL,
  events TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject, id)
);
