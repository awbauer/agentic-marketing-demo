// The app's own tables behind one seam, so the same feature code runs on Cloudflare (D1) and on
// Google Cloud (Firestore). Cloudflare passes nothing and gets the D1 repositories; the GCP host
// sets `env.DATA` to its Firestore repositories (ADR-018).
import { AUDIT_RETENTION_MS } from "@northstar/contracts";
import { ArchitectureStore, pruneArchitecture } from "../architecture/store";
import { type LibraryRun, listRuns, recordRun, runFromLibrary } from "../team/library";

/** One confirmation's audit row, keyed by confirmation id; the idempotency key is unique too. */
export type ConfirmationAuditEntry = {
  confirmationId: string;
  workspaceId: string;
  principalSubject: string;
  action: string;
  recordId: string;
  requestHash: string;
  idempotencyKey: string;
  status: string;
  sourceRecordId: string | null;
  expiresAt: string;
  at: string;
};

/** The export's row shape, unchanged from the D1 columns so downloaded audits stay comparable. */
export type ConfirmationAuditExportRow = {
  confirmation_id: string;
  action: string;
  record_id: string;
  status: string;
  source_record_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export interface ConfirmationAuditRepository {
  /** Inserts the row, or updates status, source record and updated time when it exists. */
  upsert(entry: ConfirmationAuditEntry): Promise<void>;
  /** This person's rows in this workspace created at or after `since`, newest first. */
  list(
    workspaceId: string,
    principalSubject: string,
    since: string,
    limit: number,
  ): Promise<ConfirmationAuditExportRow[]>;
  /** Deletes rows created before `before`. */
  prune(before: string): Promise<void>;
}

/** A generated campaign image awaiting review; column names kept from the D1 schema. */
export type ImageDraftRow = {
  image_id: string;
  workspace_id: string;
  principal_subject: string;
  campaign_id: string;
  channel: string;
  prompt_summary: string;
  prompt_version: string;
  model_id: string;
  width: number;
  height: number;
  content_hash: string;
  r2_key: string;
  lifecycle: string;
  seed: number | null;
  created_at: string;
  expires_at: string;
};

export interface ImageDraftRepository {
  countForWorkspace(workspaceId: string): Promise<number>;
  insert(draft: ImageDraftRow): Promise<void>;
  find(
    imageId: string,
    workspaceId: string,
    principalSubject: string,
  ): Promise<ImageDraftRow | null>;
  /** Unexpired drafts for one campaign, newest first. */
  listForCampaign(
    workspaceId: string,
    principalSubject: string,
    campaignId: string,
    now: string,
    limit: number,
  ): Promise<ImageDraftRow[]>;
  setLifecycle(imageId: string, workspaceId: string, lifecycle: string): Promise<void>;
}

/** The architecture views' per-evaluator state; ArchitectureStore is the D1 implementation. */
export type ArchitectureRepository = Pick<
  ArchitectureStore,
  | "subject"
  | "loadWorld"
  | "saveObjects"
  | "transition"
  | "history"
  | "countTransitions"
  | "logGateway"
  | "gatewayLog"
  | "gatewayStats"
  | "decisionCoverage"
  | "saveOrchestration"
  | "orchestrationsWithPrefix"
  | "orchestration"
  | "saveEvalSample"
  | "evalSamples"
  | "agentLifecycles"
  | "agentConstraints"
  | "setLifecycle"
  | "subjectsWithSamples"
>;

export type TeamLibraryRun = Parameters<typeof recordRun>[1];

export interface TeamLibraryRepository {
  record(run: TeamLibraryRun, at: string): Promise<void>;
  list(): Promise<LibraryRun[]>;
  get(id: string): Promise<Awaited<ReturnType<typeof runFromLibrary>>>;
}

export type DataPlatform = {
  kind: "d1" | "firestore";
  audit: ConfirmationAuditRepository;
  imageDrafts: ImageDraftRepository;
  architecture(subject: string): ArchitectureRepository;
  /** Everything in the architecture tables older than this goes with the 24-hour audit. */
  pruneArchitecture(olderThan: Date): Promise<void>;
  teamLibrary: TeamLibraryRepository;
};

export type DataBindings = { APP_DB?: D1Database; DATA?: DataPlatform; ENVIRONMENT?: string };

/** The repositories for this environment: the host's own (GCP), or D1 on Cloudflare. */
export function dataPlatform(env: DataBindings): DataPlatform {
  if (env.DATA) return env.DATA;
  if (!env.APP_DB) throw new Error("No data platform: neither DATA nor APP_DB is bound.");
  return d1DataPlatform(env.APP_DB, env.ENVIRONMENT === "local");
}

/** The store's name as the pages show it. */
export function storeLabel(env: DataBindings) {
  return env.DATA?.kind === "firestore" ? "Firestore" : "D1";
}

/** The confirmation audit's retention cutoff for `now`. */
export function auditCutoff(now = Date.now()) {
  return new Date(now - AUDIT_RETENTION_MS).toISOString();
}

const AUDIT_TABLE =
  "CREATE TABLE IF NOT EXISTS confirmation_audit (confirmation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, principal_subject TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL, request_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, source_record_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)";
const IMAGE_TABLE =
  "CREATE TABLE IF NOT EXISTS campaign_image_drafts (image_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, principal_subject TEXT NOT NULL, campaign_id TEXT NOT NULL, channel TEXT NOT NULL, prompt_summary TEXT NOT NULL, prompt_version TEXT NOT NULL, model_id TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, content_hash TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE, lifecycle TEXT NOT NULL, seed INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)";

/**
 * The D1 repositories. Local development has no migrations applied, so it creates the two
 * orchestrator tables on first use, as the orchestrator always did.
 */
export function d1DataPlatform(db: D1Database, local = false): DataPlatform {
  const ensure = async (statement: string) => {
    if (local) await db.exec(statement);
  };
  const audit: ConfirmationAuditRepository = {
    async upsert(entry) {
      await ensure(AUDIT_TABLE);
      await db
        .prepare(
          `INSERT INTO confirmation_audit (
            confirmation_id, workspace_id, principal_subject, action, record_id,
            request_hash, idempotency_key, status, source_record_id, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(confirmation_id) DO UPDATE SET
            status = excluded.status,
            source_record_id = excluded.source_record_id,
            updated_at = excluded.updated_at`,
        )
        .bind(
          entry.confirmationId,
          entry.workspaceId,
          entry.principalSubject,
          entry.action,
          entry.recordId,
          entry.requestHash,
          entry.idempotencyKey,
          entry.status,
          entry.sourceRecordId,
          entry.expiresAt,
          entry.at,
          entry.at,
        )
        .run();
    },
    async list(workspaceId, principalSubject, since, limit) {
      try {
        const rows = await db
          .prepare(
            `SELECT confirmation_id, action, record_id, status, source_record_id, expires_at, created_at, updated_at
             FROM confirmation_audit
             WHERE workspace_id = ? AND principal_subject = ? AND created_at >= ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .bind(workspaceId, principalSubject, since, limit)
          .all<ConfirmationAuditExportRow>();
        return rows.results;
      } catch {
        // The audit table is created on first write; no rows means no confirmed writes yet.
        return [];
      }
    },
    async prune(before) {
      try {
        await db.prepare("DELETE FROM confirmation_audit WHERE created_at < ?").bind(before).run();
      } catch {
        // The table is created on the first confirmation; nothing to prune before that.
      }
    },
  };
  const imageDrafts: ImageDraftRepository = {
    async countForWorkspace(workspaceId) {
      await ensure(IMAGE_TABLE);
      const row = await db
        .prepare("SELECT COUNT(*) AS count FROM campaign_image_drafts WHERE workspace_id = ?")
        .bind(workspaceId)
        .first<{ count: number }>();
      return row?.count ?? 0;
    },
    async insert(draft) {
      await ensure(IMAGE_TABLE);
      await db
        .prepare(
          `INSERT INTO campaign_image_drafts (
            image_id, workspace_id, principal_subject, campaign_id, channel, prompt_summary,
            prompt_version, model_id, width, height, content_hash, r2_key, lifecycle, seed,
            created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          draft.image_id,
          draft.workspace_id,
          draft.principal_subject,
          draft.campaign_id,
          draft.channel,
          draft.prompt_summary,
          draft.prompt_version,
          draft.model_id,
          draft.width,
          draft.height,
          draft.content_hash,
          draft.r2_key,
          draft.lifecycle,
          draft.seed,
          draft.created_at,
          draft.expires_at,
        )
        .run();
    },
    async find(imageId, workspaceId, principalSubject) {
      await ensure(IMAGE_TABLE);
      return db
        .prepare(
          "SELECT * FROM campaign_image_drafts WHERE image_id = ? AND workspace_id = ? AND principal_subject = ?",
        )
        .bind(imageId, workspaceId, principalSubject)
        .first<ImageDraftRow>();
    },
    async listForCampaign(workspaceId, principalSubject, campaignId, now, limit) {
      await ensure(IMAGE_TABLE);
      const rows = await db
        .prepare(
          `SELECT * FROM campaign_image_drafts
           WHERE workspace_id = ? AND principal_subject = ? AND campaign_id = ? AND expires_at > ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(workspaceId, principalSubject, campaignId, now, limit)
        .all<ImageDraftRow>();
      return rows.results;
    },
    async setLifecycle(imageId, workspaceId, lifecycle) {
      await db
        .prepare(
          "UPDATE campaign_image_drafts SET lifecycle = ? WHERE image_id = ? AND workspace_id = ?",
        )
        .bind(lifecycle, imageId, workspaceId)
        .run();
    },
  };
  return {
    kind: "d1",
    audit,
    imageDrafts,
    architecture: (subject) => new ArchitectureStore(db, subject),
    pruneArchitecture: (olderThan) => pruneArchitecture(db, olderThan),
    teamLibrary: {
      record: (run, at) => recordRun(db, run, at),
      list: () => listRuns(db),
      get: (id) => runFromLibrary(db, id),
    },
  };
}
