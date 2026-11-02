import {
  type AgentLifecycle,
  type ApprovalState,
  buildWorld,
  type GovernedObject,
  type World,
} from "@northstar/architecture";

type Row = Record<string, unknown>;

export type HistoryRow = {
  id: string;
  urn: string;
  from: ApprovalState;
  to: ApprovalState;
  actor: string;
  actorType: "persona" | "agent" | "system";
  reason: string | null;
  at: string;
};

export type GatewayLogRow = {
  id: string;
  at: string;
  persona: string;
  principalType: string;
  principalId: string;
  action: string;
  resource: string | null;
  decision: "allow" | "deny";
  policyId: string;
  reason: string;
  latencyMs: number;
  correlationId: string;
};

/** D1 persistence for the architecture's mutable state. Everything is scoped to one evaluator. */
export class ArchitectureStore {
  constructor(
    private readonly db: D1Database,
    readonly subject: string,
  ) {}

  async loadWorld(now = new Date()): Promise<World> {
    const [objects, states] = await Promise.all([
      this.db
        .prepare("SELECT body FROM arch_objects WHERE subject = ? ORDER BY created_at")
        .bind(this.subject)
        .all<Row>(),
      this.db
        .prepare("SELECT urn, state, updated_at FROM arch_state WHERE subject = ?")
        .bind(this.subject)
        .all<Row>(),
    ]);
    return buildWorld({
      now,
      runtime: (objects.results ?? []).map((row) => JSON.parse(String(row.body)) as GovernedObject),
      states: Object.fromEntries(
        (states.results ?? []).map((row) => [
          String(row.urn),
          { state: String(row.state) as ApprovalState, at: String(row.updated_at) },
        ]),
      ),
    });
  }

  async saveObjects(objects: readonly GovernedObject[]) {
    if (objects.length === 0) return;
    await this.db.batch(
      objects.map((object) =>
        this.db
          .prepare(
            "INSERT INTO arch_objects (subject, urn, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (subject, urn) DO NOTHING",
          )
          .bind(this.subject, object.urn, JSON.stringify(object), object.createdAt),
      ),
    );
  }

  /**
   * Moves an object to a new state and appends the history row in one batch. `from` is checked in
   * the same statement, so two reviewers acting at once cannot both succeed.
   */
  async transition(entry: {
    urn: string;
    from: ApprovalState;
    to: ApprovalState;
    actor: string;
    actorType: HistoryRow["actorType"];
    reason?: string | undefined;
    at: string;
  }): Promise<boolean> {
    const current = await this.db
      .prepare("SELECT state FROM arch_state WHERE subject = ? AND urn = ?")
      .bind(this.subject, entry.urn)
      .first<Row>();
    const statements: D1PreparedStatement[] = [];
    if (current) {
      if (String(current.state) !== entry.from) return false;
      statements.push(
        this.db
          .prepare(
            "UPDATE arch_state SET state = ?, updated_at = ? WHERE subject = ? AND urn = ? AND state = ?",
          )
          .bind(entry.to, entry.at, this.subject, entry.urn, entry.from),
      );
    } else {
      statements.push(
        this.db
          .prepare("INSERT INTO arch_state (subject, urn, state, updated_at) VALUES (?, ?, ?, ?)")
          .bind(this.subject, entry.urn, entry.to, entry.at),
      );
    }
    // The history row is written only if the statement above changed a row, in the same batch.
    statements.push(
      this.db
        .prepare(
          "INSERT INTO arch_history (id, subject, urn, from_state, to_state, actor, actor_type, reason, at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0",
        )
        .bind(
          crypto.randomUUID(),
          this.subject,
          entry.urn,
          entry.from,
          entry.to,
          entry.actor,
          entry.actorType,
          entry.reason ?? null,
          entry.at,
        ),
    );
    try {
      const results = await this.db.batch(statements);
      return (results[0]?.meta.changes ?? 0) > 0;
    } catch (error) {
      // Two requests that both saw no row: the second insert hits the primary key.
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) return false;
      throw error;
    }
  }

  async history(urn: string): Promise<HistoryRow[]> {
    const rows = await this.db
      .prepare("SELECT * FROM arch_history WHERE subject = ? AND urn = ? ORDER BY at, rowid")
      .bind(this.subject, urn)
      .all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      urn: String(row.urn),
      from: String(row.from_state) as ApprovalState,
      to: String(row.to_state) as ApprovalState,
      actor: String(row.actor),
      actorType: String(row.actor_type) as HistoryRow["actorType"],
      reason: row.reason === null ? null : String(row.reason),
      at: String(row.at),
    }));
  }

  async countTransitions() {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM arch_history WHERE subject = ?")
      .bind(this.subject)
      .first<Row>();
    return Number(row?.n ?? 0);
  }

  async logGateway(entry: Omit<GatewayLogRow, "id">) {
    await this.db
      .prepare(
        "INSERT INTO arch_gateway_log (id, subject, at, persona, principal_type, principal_id, action, resource, decision, policy_id, reason, latency_ms, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        this.subject,
        entry.at,
        entry.persona,
        entry.principalType,
        entry.principalId,
        entry.action,
        entry.resource,
        entry.decision,
        entry.policyId,
        entry.reason.slice(0, 300),
        entry.latencyMs,
        entry.correlationId,
      )
      .run();
  }

  async gatewayLog(limit = 50): Promise<GatewayLogRow[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM arch_gateway_log WHERE subject = ? ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .bind(this.subject, limit)
      .all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      at: String(row.at),
      persona: String(row.persona),
      principalType: String(row.principal_type),
      principalId: String(row.principal_id),
      action: String(row.action),
      resource: row.resource === null ? null : String(row.resource),
      decision: String(row.decision) as "allow" | "deny",
      policyId: String(row.policy_id),
      reason: String(row.reason),
      latencyMs: Number(row.latency_ms),
      correlationId: String(row.correlation_id),
    }));
  }

  async gatewayStats() {
    const rows = await this.db
      .prepare(
        "SELECT decision, COUNT(*) AS n FROM arch_gateway_log WHERE subject = ? GROUP BY decision",
      )
      .bind(this.subject)
      .all<Row>();
    const count = (decision: string) =>
      Number((rows.results ?? []).find((row) => row.decision === decision)?.n ?? 0);
    return {
      allowed: count("allow"),
      denied: count("deny"),
      total: count("allow") + count("deny"),
    };
  }

  /** Decisions taken (by a person or an agent) against decision grants the gateway allowed. */
  async decisionCoverage() {
    const taken = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM arch_history WHERE subject = ? AND actor_type IN ('persona', 'agent')",
      )
      .bind(this.subject)
      .first<Row>();
    const allowed = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM arch_gateway_log WHERE subject = ? AND decision = 'allow' AND action IN ('transition', 'propose_transition')",
      )
      .bind(this.subject)
      .first<Row>();
    const total = Number(taken?.n ?? 0);
    return { total, withSpan: Math.min(total, Number(allowed?.n ?? 0)) };
  }

  async saveEvalSample(agentId: string, at: string, scores: Record<string, number>) {
    await this.db
      .prepare(
        "INSERT INTO arch_eval_samples (id, subject, agent_id, at, scores) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), this.subject, agentId, at, JSON.stringify(scores))
      .run();
  }

  async evalSamples(agentId: string, limit = 20): Promise<Array<Record<string, number>>> {
    const rows = await this.db
      .prepare(
        "SELECT scores FROM arch_eval_samples WHERE subject = ? AND agent_id = ? ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .bind(this.subject, agentId, limit)
      .all<Row>();
    return (rows.results ?? []).map(
      (row) => JSON.parse(String(row.scores)) as Record<string, number>,
    );
  }

  async agentLifecycles(): Promise<Record<string, AgentLifecycle>> {
    const rows = await this.db
      .prepare("SELECT agent_id, lifecycle FROM arch_agent_state WHERE subject = ?")
      .bind(this.subject)
      .all<Row>();
    return Object.fromEntries(
      (rows.results ?? []).map((row) => [
        String(row.agent_id),
        String(row.lifecycle) as AgentLifecycle,
      ]),
    );
  }

  async agentConstraints() {
    const rows = await this.db
      .prepare("SELECT agent_id, lifecycle, reason, at FROM arch_agent_state WHERE subject = ?")
      .bind(this.subject)
      .all<Row>();
    return (rows.results ?? []).map((row) => ({
      agentId: String(row.agent_id),
      lifecycle: String(row.lifecycle) as AgentLifecycle,
      reason: String(row.reason),
      at: String(row.at),
    }));
  }

  async setLifecycle(agentId: string, lifecycle: AgentLifecycle, reason: string, at: string) {
    await this.db
      .prepare(
        "INSERT INTO arch_agent_state (subject, agent_id, lifecycle, reason, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (subject, agent_id) DO UPDATE SET lifecycle = excluded.lifecycle, reason = excluded.reason, at = excluded.at",
      )
      .bind(this.subject, agentId, lifecycle, reason, at)
      .run();
  }

  async subjectsWithSamples(): Promise<string[]> {
    const rows = await this.db.prepare("SELECT DISTINCT subject FROM arch_eval_samples").all<Row>();
    return (rows.results ?? []).map((row) => String(row.subject));
  }
}

/** Everything in the architecture tables is audit data: it expires with the 24-hour audit. */
export async function pruneArchitecture(db: D1Database, olderThan: Date) {
  const cutoff = olderThan.toISOString();
  await db.batch([
    db.prepare("DELETE FROM arch_history WHERE at < ?").bind(cutoff),
    db.prepare("DELETE FROM arch_gateway_log WHERE at < ?").bind(cutoff),
    db.prepare("DELETE FROM arch_eval_samples WHERE at < ?").bind(cutoff),
    db.prepare("DELETE FROM arch_objects WHERE created_at < ?").bind(cutoff),
    db.prepare("DELETE FROM arch_state WHERE updated_at < ?").bind(cutoff),
    db.prepare("DELETE FROM arch_agent_state WHERE at < ?").bind(cutoff),
  ]);
}
