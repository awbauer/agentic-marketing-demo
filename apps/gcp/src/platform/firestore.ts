// Firestore implementations of the app's repositories (ADR-018). Every query uses equality
// filters only, or one range on a single field, so Firestore's automatic single-field indexes
// serve it and no composite index has to be deployed; ordering and limits are applied here, over
// data the 24-hour retention keeps small. Large JSON bodies (squad event logs) are split across a
// subcollection because a Firestore document holds at most 1 MiB.
import { createHash, randomUUID } from "node:crypto";
import {
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  Timestamp,
  type Transaction,
} from "@google-cloud/firestore";
import {
  type AgentLifecycle,
  type ApprovalState,
  buildWorld,
  type GovernedObject,
  runAiPlatform,
} from "@northstar/architecture";
import { AUDIT_RETENTION_MS } from "@northstar/contracts";
import type { MemberDirectory } from "../../../edge/src/auth";
import type { GatewayLogRow, HistoryRow } from "../../../edge/src/architecture/store";
import type {
  ArchitectureRepository,
  ConfirmationAuditExportRow,
  ConfirmationAuditRepository,
  DataPlatform,
  ImageDraftRepository,
  ImageDraftRow,
  TeamLibraryRepository,
} from "../../../edge/src/platform/data";
import { alignStamps, LIBRARY_SIZE, type LibraryRun } from "../../../edge/src/team/library";

type Data = Record<string, unknown>;

/** Collection names; a prefix keeps test runs apart from each other and from real data. */
export function collections(prefix = "") {
  const name = (base: string) => `${prefix}${base}`;
  return {
    audit: name("confirmation_audit"),
    auditKeys: name("confirmation_idempotency"),
    imageDrafts: name("campaign_image_drafts"),
    // One counter per workspace for the 100-image proof cap. Drafts expire (TTL); this does not.
    imageCounts: name("campaign_image_counts"),
    objects: name("arch_objects"),
    state: name("arch_state"),
    history: name("arch_history"),
    gatewayLog: name("arch_gateway_log"),
    evalSamples: name("arch_eval_samples"),
    agentState: name("arch_agent_state"),
    orchestrations: name("arch_orchestrations"),
    library: name("team_run_library"),
    members: name("members"),
  };
}
export type Collections = ReturnType<typeof collections>;

/** A document id for a compound key; URNs and subjects may hold characters ids cannot. */
export function keyId(...parts: string[]) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);
}

let sequence = 0;
/** Insertion order within one millisecond, standing in for SQLite's rowid as a tiebreaker. */
function nextSeq() {
  sequence = (sequence + 1) % 1000;
  return Date.now() * 1000 + sequence;
}

/** When a row becomes eligible for Firestore's TTL deletion, as a backstop to the hourly prune. */
function expireAt(from: string, ms = AUDIT_RETENTION_MS) {
  return Timestamp.fromMillis(Date.parse(from) + ms);
}

const CHUNK_CHARS = 700_000;

/** Stores a JSON value inline, or in ordered chunks under the document when it is too big. */
function jsonField(ref: DocumentReference, field: string, value: unknown, tx: Transaction) {
  const text = JSON.stringify(value);
  if (text.length <= CHUNK_CHARS) return { [field]: text, [`${field}_chunks`]: 0 };
  const count = Math.ceil(text.length / CHUNK_CHARS);
  for (let index = 0; index < count; index += 1) {
    const chunk = ref.collection(`${field}_chunks`).doc(String(index).padStart(4, "0"));
    tx.set(chunk, { text: text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) });
  }
  return { [field]: null, [`${field}_chunks`]: count };
}

async function readJson<T>(snapshot: DocumentSnapshot, field: string): Promise<T> {
  const data = snapshot.data() ?? {};
  const count = Number(data[`${field}_chunks`] ?? 0);
  if (!count) return JSON.parse(String(data[field])) as T;
  const chunks = await snapshot.ref
    .collection(`${field}_chunks`)
    .orderBy("__name__")
    .limit(count)
    .get();
  return JSON.parse(chunks.docs.map((doc) => String(doc.get("text"))).join("")) as T;
}

/** Deletes every document a query matches, with its chunk subcollections. */
async function deleteAll(db: Firestore, query: Query) {
  const snapshot = await query.get();
  if (snapshot.empty) return 0;
  const writer = db.bulkWriter();
  for (const doc of snapshot.docs) {
    for (const field of ["events_chunks", "messages_chunks"])
      if (Number(doc.get(field) ?? 0) > 0) {
        const chunks = await doc.ref.collection(field).get();
        for (const chunk of chunks.docs) void writer.delete(chunk.ref);
      }
    void writer.delete(doc.ref);
  }
  await writer.close();
  return snapshot.size;
}

const byDesc =
  <T>(...keys: Array<(row: T) => number | string>) =>
  (a: T, b: T) => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      if (left < right) return 1;
      if (left > right) return -1;
    }
    return 0;
  };

export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super("UNIQUE constraint failed: confirmation_audit.idempotency_key");
  }
}

function auditRepository(db: Firestore, names: Collections): ConfirmationAuditRepository {
  return {
    async upsert(entry) {
      const ref = db.collection(names.audit).doc(entry.confirmationId);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
          tx.update(ref, {
            status: entry.status,
            source_record_id: entry.sourceRecordId,
            updated_at: entry.at,
          });
          return;
        }
        // The idempotency key is unique across confirmations, as D1's UNIQUE constraint makes it.
        const keyRef = db.collection(names.auditKeys).doc(keyId(entry.idempotencyKey));
        if ((await tx.get(keyRef)).exists) throw new DuplicateIdempotencyKeyError();
        tx.create(keyRef, { confirmation_id: entry.confirmationId, expireAt: expireAt(entry.at) });
        tx.create(ref, {
          confirmation_id: entry.confirmationId,
          workspace_id: entry.workspaceId,
          principal_subject: entry.principalSubject,
          action: entry.action,
          record_id: entry.recordId,
          request_hash: entry.requestHash,
          idempotency_key: entry.idempotencyKey,
          status: entry.status,
          source_record_id: entry.sourceRecordId,
          expires_at: entry.expiresAt,
          created_at: entry.at,
          updated_at: entry.at,
          expireAt: expireAt(entry.at),
        });
      });
    },
    async list(workspaceId, principalSubject, since, limit) {
      const snapshot = await db
        .collection(names.audit)
        .where("workspace_id", "==", workspaceId)
        .where("principal_subject", "==", principalSubject)
        .get();
      return snapshot.docs
        .map((doc) => doc.data())
        .filter((row) => String(row.created_at) >= since)
        .sort(byDesc((row) => String(row.created_at)))
        .slice(0, limit)
        .map(
          (row): ConfirmationAuditExportRow => ({
            confirmation_id: String(row.confirmation_id),
            action: String(row.action),
            record_id: String(row.record_id),
            status: String(row.status),
            source_record_id: row.source_record_id == null ? null : String(row.source_record_id),
            expires_at: String(row.expires_at),
            created_at: String(row.created_at),
            updated_at: String(row.updated_at),
          }),
        );
    },
    async prune(before) {
      const old = await db.collection(names.audit).where("created_at", "<", before).get();
      if (old.empty) return;
      const writer = db.bulkWriter();
      for (const doc of old.docs) {
        void writer.delete(doc.ref);
        void writer.delete(
          db.collection(names.auditKeys).doc(keyId(String(doc.get("idempotency_key")))),
        );
      }
      await writer.close();
    },
  };
}

const imageRow = (data: Data): ImageDraftRow => ({
  image_id: String(data.image_id),
  workspace_id: String(data.workspace_id),
  principal_subject: String(data.principal_subject),
  campaign_id: String(data.campaign_id),
  channel: String(data.channel),
  prompt_summary: String(data.prompt_summary),
  prompt_version: String(data.prompt_version),
  model_id: String(data.model_id),
  width: Number(data.width),
  height: Number(data.height),
  content_hash: String(data.content_hash),
  r2_key: String(data.r2_key),
  lifecycle: String(data.lifecycle),
  seed: data.seed == null ? null : Number(data.seed),
  created_at: String(data.created_at),
  expires_at: String(data.expires_at),
});

function imageDraftRepository(db: Firestore, names: Collections): ImageDraftRepository {
  const drafts = () => db.collection(names.imageDrafts);
  const counter = (workspaceId: string) => db.collection(names.imageCounts).doc(workspaceId);
  // Drafts are deleted by TTL after seven days, so counting them would refill the proof's
  // 100-image allowance. The cap counts every image ever made in the workspace instead; a
  // workspace with drafts from before the counter existed starts it from those drafts.
  const rowCount = async (workspaceId: string) =>
    (await drafts().where("workspace_id", "==", workspaceId).count().get()).data().count;
  return {
    async countForWorkspace(workspaceId) {
      const snapshot = await counter(workspaceId).get();
      return snapshot.exists ? Number(snapshot.get("count")) : rowCount(workspaceId);
    },
    async insert(draft) {
      const seed = (await counter(draft.workspace_id).get()).exists
        ? null
        : await rowCount(draft.workspace_id);
      await db.runTransaction(async (transaction) => {
        const ref = counter(draft.workspace_id);
        const current = await transaction.get(ref);
        const count = current.exists ? Number(current.get("count")) : (seed ?? 0);
        transaction.create(drafts().doc(draft.image_id), {
          ...draft,
          expireAt: Timestamp.fromMillis(Date.parse(draft.expires_at)),
        });
        transaction.set(ref, { count: count + 1, updated_at: draft.created_at });
      });
    },
    async find(imageId, workspaceId, principalSubject) {
      const snapshot = await drafts().doc(imageId).get();
      const data = snapshot.data();
      if (!data || data.workspace_id !== workspaceId || data.principal_subject !== principalSubject)
        return null;
      return imageRow(data);
    },
    async listForCampaign(workspaceId, principalSubject, campaignId, now, limit) {
      const snapshot = await drafts()
        .where("workspace_id", "==", workspaceId)
        .where("principal_subject", "==", principalSubject)
        .where("campaign_id", "==", campaignId)
        .get();
      return snapshot.docs
        .map((doc) => imageRow(doc.data()))
        .filter((row) => row.expires_at > now)
        .sort(byDesc((row) => row.created_at))
        .slice(0, limit);
    },
    async setLifecycle(imageId, workspaceId, lifecycle) {
      const ref = drafts().doc(imageId);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (snapshot.get("workspace_id") === workspaceId) tx.update(ref, { lifecycle });
      });
    },
  };
}

/** The architecture views' state for one evaluator, mirroring ArchitectureStore on D1. */
export class FirestoreArchitectureStore implements ArchitectureRepository {
  constructor(
    private readonly db: Firestore,
    private readonly names: Collections,
    readonly subject: string,
  ) {}

  private col(name: keyof Collections) {
    return this.db.collection(this.names[name]);
  }
  private mine(name: keyof Collections) {
    return this.col(name).where("subject", "==", this.subject);
  }

  async loadWorld(now = new Date()) {
    const [objects, states] = await Promise.all([
      this.mine("objects").get(),
      this.mine("state").get(),
    ]);
    return buildWorld({
      now,
      runtime: objects.docs
        .map((doc) => doc.data())
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((row) => JSON.parse(String(row.body)) as GovernedObject),
      states: Object.fromEntries(
        states.docs.map((doc) => [
          String(doc.get("urn")),
          { state: String(doc.get("state")) as ApprovalState, at: String(doc.get("updated_at")) },
        ]),
      ),
    });
  }

  async saveObjects(objects: readonly GovernedObject[]) {
    await Promise.all(
      objects.map((object) =>
        this.col("objects")
          .doc(keyId(this.subject, object.urn))
          .create({
            subject: this.subject,
            urn: object.urn,
            body: JSON.stringify(object),
            created_at: object.createdAt,
            expireAt: expireAt(object.createdAt),
          })
          .catch((error: { code?: number }) => {
            // ON CONFLICT DO NOTHING: the object is already saved.
            if (error.code !== 6) throw error;
          }),
      ),
    );
  }

  /** Checks `from` and writes the new state and its history row in one transaction. */
  async transition(entry: {
    urn: string;
    from: ApprovalState;
    to: ApprovalState;
    actor: string;
    actorType: HistoryRow["actorType"];
    reason?: string | undefined;
    at: string;
  }) {
    const ref = this.col("state").doc(keyId(this.subject, entry.urn));
    return this.db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.exists && String(current.get("state")) !== entry.from) return false;
      tx.set(ref, {
        subject: this.subject,
        urn: entry.urn,
        state: entry.to,
        updated_at: entry.at,
        expireAt: expireAt(entry.at),
      });
      const id = randomUUID();
      tx.create(this.col("history").doc(id), {
        id,
        subject: this.subject,
        urn: entry.urn,
        from_state: entry.from,
        to_state: entry.to,
        actor: entry.actor,
        actor_type: entry.actorType,
        reason: entry.reason ?? null,
        at: entry.at,
        seq: nextSeq(),
        expireAt: expireAt(entry.at),
      });
      return true;
    });
  }

  async history(urn: string): Promise<HistoryRow[]> {
    const rows = await this.mine("history").where("urn", "==", urn).get();
    return rows.docs
      .map((doc) => doc.data())
      .sort((a, b) => String(a.at).localeCompare(String(b.at)) || Number(a.seq) - Number(b.seq))
      .map((row) => ({
        id: String(row.id),
        urn: String(row.urn),
        from: String(row.from_state) as ApprovalState,
        to: String(row.to_state) as ApprovalState,
        actor: String(row.actor),
        actorType: String(row.actor_type) as HistoryRow["actorType"],
        reason: row.reason == null ? null : String(row.reason),
        at: String(row.at),
      }));
  }

  async countTransitions() {
    return (await this.mine("history").count().get()).data().count;
  }

  async logGateway(entry: Omit<GatewayLogRow, "id">) {
    const id = randomUUID();
    await this.col("gatewayLog")
      .doc(id)
      .create({
        id,
        subject: this.subject,
        at: entry.at,
        persona: entry.persona,
        principal_type: entry.principalType,
        principal_id: entry.principalId,
        action: entry.action,
        resource: entry.resource,
        decision: entry.decision,
        policy_id: entry.policyId,
        reason: entry.reason.slice(0, 300),
        latency_ms: entry.latencyMs,
        correlation_id: entry.correlationId,
        seq: nextSeq(),
        expireAt: expireAt(entry.at),
      });
  }

  async gatewayLog(limit = 50): Promise<GatewayLogRow[]> {
    const rows = await this.mine("gatewayLog").get();
    return rows.docs
      .map((doc) => doc.data())
      .sort(
        byDesc(
          (row) => String(row.at),
          (row) => Number(row.seq),
        ),
      )
      .slice(0, limit)
      .map((row) => ({
        id: String(row.id),
        at: String(row.at),
        persona: String(row.persona),
        principalType: String(row.principal_type),
        principalId: String(row.principal_id),
        action: String(row.action),
        resource: row.resource == null ? null : String(row.resource),
        decision: String(row.decision) as "allow" | "deny",
        policyId: String(row.policy_id),
        reason: String(row.reason),
        latencyMs: Number(row.latency_ms),
        correlationId: String(row.correlation_id),
      }));
  }

  async gatewayStats() {
    const count = async (decision: string) =>
      (await this.mine("gatewayLog").where("decision", "==", decision).count().get()).data().count;
    const [allowed, denied] = await Promise.all([count("allow"), count("deny")]);
    return { allowed, denied, total: allowed + denied };
  }

  async decisionCoverage() {
    const [taken, allowed] = await Promise.all([
      this.mine("history").where("actor_type", "in", ["persona", "agent"]).count().get(),
      this.mine("gatewayLog")
        .where("decision", "==", "allow")
        .where("action", "in", ["transition", "propose_transition"])
        .count()
        .get(),
    ]);
    const total = taken.data().count;
    return { total, withSpan: Math.min(total, allowed.data().count) };
  }

  async saveOrchestration(row: {
    id: string;
    flowId: string;
    brand: string;
    status: string;
    waitingOn: string | null;
    messages: unknown[];
    events: unknown[];
    at: string;
  }) {
    const ref = this.col("orchestrations").doc(keyId(this.subject, row.id));
    await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const base = existing.exists
        ? {}
        : { subject: this.subject, id: row.id, flow_id: row.flowId, brand: row.brand };
      tx.set(
        ref,
        {
          ...base,
          status: row.status,
          waiting_on: row.waitingOn,
          ...jsonField(ref, "messages", row.messages, tx),
          ...jsonField(ref, "events", row.events, tx),
          updated_at: row.at,
          expireAt: expireAt(row.at),
        },
        { merge: true },
      );
    });
  }

  async orchestrationsWithPrefix(prefix: string, limit = 50) {
    const rows = await this.mine("orchestrations").get();
    const matching = rows.docs
      .filter((doc) => String(doc.get("flow_id")).startsWith(prefix))
      .sort(byDesc((doc) => String(doc.get("updated_at"))))
      .slice(0, limit);
    return Promise.all(
      matching.map(async (doc) => ({
        id: String(doc.get("id")),
        flowId: String(doc.get("flow_id")),
        brand: String(doc.get("brand")),
        status: String(doc.get("status")),
        updatedAt: String(doc.get("updated_at")),
        events: await readJson<unknown[]>(doc, "events"),
      })),
    );
  }

  async orchestration(id: string) {
    const doc = await this.col("orchestrations").doc(keyId(this.subject, id)).get();
    if (!doc.exists) return null;
    return {
      id: String(doc.get("id")),
      flowId: String(doc.get("flow_id")),
      brand: String(doc.get("brand")),
      status: String(doc.get("status")),
      waitingOn: doc.get("waiting_on") ? String(doc.get("waiting_on")) : null,
      messages: await readJson<unknown[]>(doc, "messages"),
      events: await readJson<unknown[]>(doc, "events"),
    };
  }

  async saveEvalSample(agentId: string, at: string, scores: Record<string, number>) {
    await this.col("evalSamples")
      .doc(randomUUID())
      .create({
        subject: this.subject,
        agent_id: agentId,
        at,
        scores: JSON.stringify(scores),
        seq: nextSeq(),
        expireAt: expireAt(at),
      });
  }

  async evalSamples(agentId: string, limit = 20) {
    const rows = await this.mine("evalSamples").where("agent_id", "==", agentId).get();
    return rows.docs
      .map((doc) => doc.data())
      .sort(
        byDesc(
          (row) => String(row.at),
          (row) => Number(row.seq),
        ),
      )
      .slice(0, limit)
      .map((row) => JSON.parse(String(row.scores)) as Record<string, number>);
  }

  async agentLifecycles(): Promise<Record<string, AgentLifecycle>> {
    const rows = await this.mine("agentState").get();
    return Object.fromEntries(
      rows.docs.map((doc) => [
        String(doc.get("agent_id")),
        String(doc.get("lifecycle")) as AgentLifecycle,
      ]),
    );
  }

  async agentConstraints() {
    const rows = await this.mine("agentState").get();
    return rows.docs.map((doc) => ({
      agentId: String(doc.get("agent_id")),
      lifecycle: String(doc.get("lifecycle")) as AgentLifecycle,
      reason: String(doc.get("reason")),
      at: String(doc.get("at")),
    }));
  }

  async setLifecycle(agentId: string, lifecycle: AgentLifecycle, reason: string, at: string) {
    await this.col("agentState")
      .doc(keyId(this.subject, agentId))
      .set({
        subject: this.subject,
        agent_id: agentId,
        lifecycle,
        reason,
        at,
        expireAt: expireAt(at),
      });
  }

  async subjectsWithSamples() {
    const rows = await this.col("evalSamples").select("subject").get();
    return [...new Set(rows.docs.map((doc) => String(doc.get("subject"))))];
  }
}

async function pruneArchitecture(db: Firestore, names: Collections, olderThan: Date) {
  const cutoff = olderThan.toISOString();
  const older = (name: keyof Collections, field: string) =>
    deleteAll(db, db.collection(names[name]).where(field, "<", cutoff));
  await Promise.all([
    older("history", "at"),
    older("gatewayLog", "at"),
    older("evalSamples", "at"),
    older("objects", "created_at"),
    older("state", "updated_at"),
    older("agentState", "at"),
    older("orchestrations", "updated_at"),
    // team_run_library keeps its last ten runs instead (ADR-016).
  ]);
}

function teamLibraryRepository(db: Firestore, names: Collections): TeamLibraryRepository {
  const library = () => db.collection(names.library);
  return {
    async record(run, at) {
      const ref = library().doc(run.id);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        const prior = existing.exists
          ? (JSON.parse(String(existing.get("stamps"))) as number[])
          : [];
        const stamps = alignStamps(run.events.length, run.stamps, prior, Date.parse(at));
        tx.set(ref, {
          id: run.id,
          brief_id: run.brief.id,
          title: run.brief.title,
          brand: run.brief.brand,
          mode: run.mode,
          provider: run.provider,
          ai_platform: runAiPlatform(run.events) ?? null,
          scripted: run.scripted,
          status: run.status,
          tokens: run.tokens,
          event_count: run.events.length,
          ...jsonField(ref, "events", run.events, tx),
          stamps: JSON.stringify(stamps),
          created_at: existing.exists ? String(existing.get("created_at")) : at,
          updated_at: at,
          seq: nextSeq(),
        });
      });
      // Keep the ten newest runs.
      const all = await library().select("updated_at", "seq", "events_chunks").get();
      const stale = all.docs
        .sort(
          byDesc(
            (doc) => String(doc.get("updated_at")),
            (doc) => Number(doc.get("seq")),
          ),
        )
        .slice(LIBRARY_SIZE);
      if (stale.length)
        await deleteAll(
          db,
          library().where("__name__", "in", stale.map((doc) => doc.ref).slice(0, 30)),
        );
    },
    async list(): Promise<LibraryRun[]> {
      const all = await library()
        .select(
          "id",
          "brief_id",
          "title",
          "brand",
          "mode",
          "provider",
          "ai_platform",
          "scripted",
          "status",
          "tokens",
          "event_count",
          "stamps",
          "created_at",
          "updated_at",
          "seq",
        )
        .get();
      return all.docs
        .map((doc) => doc.data())
        .sort(
          byDesc(
            (row) => String(row.updated_at),
            (row) => Number(row.seq),
          ),
        )
        .slice(0, LIBRARY_SIZE)
        .map((row) => {
          const stamps = JSON.parse(String(row.stamps)) as number[];
          return {
            id: String(row.id),
            briefId: String(row.brief_id),
            title: String(row.title),
            brand: String(row.brand),
            mode: String(row.mode),
            provider: String(row.provider),
            ...(row.ai_platform ? { aiPlatform: String(row.ai_platform) } : {}),
            scripted: Boolean(row.scripted),
            status: String(row.status),
            tokens: Number(row.tokens),
            events: Number(row.event_count),
            durationMs: stamps.length ? (stamps.at(-1) as number) - (stamps[0] as number) : 0,
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        });
    },
    async get(id) {
      const doc = await library().doc(id).get();
      if (!doc.exists) return null;
      return {
        id: String(doc.get("id")),
        title: String(doc.get("title")),
        brand: String(doc.get("brand")),
        mode: String(doc.get("mode")),
        provider: String(doc.get("provider")),
        status: String(doc.get("status")),
        events: await readJson(doc, "events"),
        stamps: JSON.parse(String(doc.get("stamps"))) as number[],
      };
    },
  };
}

/** All of the app's tables on Firestore. */
export function firestoreDataPlatform(db: Firestore, prefix = ""): DataPlatform {
  const names = collections(prefix);
  return {
    kind: "firestore",
    audit: auditRepository(db, names),
    imageDrafts: imageDraftRepository(db, names),
    architecture: (subject) => new FirestoreArchitectureStore(db, names, subject),
    pruneArchitecture: (olderThan) => pruneArchitecture(db, names, olderThan),
    teamLibrary: teamLibraryRepository(db, names),
  };
}

/** The member allowlist: `members/{email}` with `role` and optional `tenantId`. */
export function firestoreMembers(db: Firestore, prefix = ""): MemberDirectory {
  const names = collections(prefix);
  return {
    async lookup(email) {
      const doc = await db.collection(names.members).doc(email.toLowerCase()).get();
      if (!doc.exists) return null;
      const role = doc.get("role");
      const tenantId = doc.get("tenantId");
      return typeof role === "string"
        ? { role, ...(typeof tenantId === "string" ? { tenantId } : {}) }
        : null;
    },
  };
}
