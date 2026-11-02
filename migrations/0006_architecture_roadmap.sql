-- Architecture roadmap (#91): governed objects created at run time, approval state and its
-- append-only history, the gateway decision log, agent evaluation samples and lifecycle overrides.
-- Every row belongs to one evaluator (subject), so each person works in their own sandbox world.
CREATE TABLE arch_objects (
  subject TEXT NOT NULL,
  urn TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subject, urn)
);

CREATE TABLE arch_state (
  subject TEXT NOT NULL,
  urn TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject, urn)
);

CREATE TABLE arch_history (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  urn TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('persona', 'agent', 'system')),
  reason TEXT,
  at TEXT NOT NULL
);
CREATE INDEX arch_history_object ON arch_history (subject, urn, at);

-- History is append-only: a row can be pruned at retention, never edited.
CREATE TRIGGER arch_history_append_only BEFORE UPDATE ON arch_history
BEGIN
  SELECT RAISE(ABORT, 'arch_history is append-only');
END;

CREATE TABLE arch_gateway_log (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  at TEXT NOT NULL,
  persona TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  policy_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  correlation_id TEXT NOT NULL
);
CREATE INDEX arch_gateway_log_subject ON arch_gateway_log (subject, at);

CREATE TABLE arch_eval_samples (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  at TEXT NOT NULL,
  scores TEXT NOT NULL
);
CREATE INDEX arch_eval_samples_agent ON arch_eval_samples (subject, agent_id, at);

CREATE TABLE arch_agent_state (
  subject TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (subject, agent_id)
);
