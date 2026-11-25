// The environment the shared code sees on Google Cloud: the same variables the Worker reads,
// plus objects in place of Cloudflare bindings (ADR-018). Everything comes from the Cloud Run
// service's environment, with secrets mounted from Secret Manager as environment variables.
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import type { WorkbenchEnv } from "../../edge/src/app";
import { MemorySnapshotStore } from "./agent/snapshots";
import { firestoreDataPlatform, firestoreMembers } from "./platform/firestore";
import { gcsObjectStore, gcsSnapshotStore } from "./platform/gcs";
import { staticAssets } from "./platform/static";
import { vertexModels } from "./platform/vertex";

export type GcpConfig = {
  project: string;
  location: string;
  bucket: string;
  staticDir: string;
  /** Prefix for Firestore collections; empty in production. */
  collectionPrefix: string;
  scheduler: { audience: string; serviceAccount: string } | null;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): GcpConfig {
  const project = source.GCP_PROJECT ?? source.GOOGLE_CLOUD_PROJECT ?? "";
  const location = source.GCP_REGION ?? "us-central1";
  return {
    project,
    location,
    bucket: source.GCP_ASSET_BUCKET ?? (project ? `${project}-campaign-assets` : ""),
    staticDir: source.STATIC_DIR ?? "dist/client/client",
    collectionPrefix: source.FIRESTORE_COLLECTION_PREFIX ?? "",
    scheduler:
      source.SCHEDULER_AUDIENCE && source.SCHEDULER_SERVICE_ACCOUNT
        ? { audience: source.SCHEDULER_AUDIENCE, serviceAccount: source.SCHEDULER_SERVICE_ACCOUNT }
        : null,
  };
}

/** The Worker's string variables, with the defaults wrangler.jsonc gives the proof Worker. */
function variables(source: NodeJS.ProcessEnv) {
  const strings = Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    ENVIRONMENT: "proof",
    HOST: "google-cloud",
    AUTH_MODE: "iap",
    PROOF_WORKSPACE_ID: "northstar-demo",
    CAMPAIGN_IMAGE_MODEL: "gemini-3.1-flash-image",
    SALESFORCE_MCP_URL: "",
    SURFACE_ALLOWED_ORIGINS: "",
    ...strings,
  };
}

export function buildEnv(config: GcpConfig, source: NodeJS.ProcessEnv = process.env) {
  const vars = variables(source);
  // Without a project (local runs against the emulator) the clients get placeholder names; the
  // emulator accepts any project, and SNAPSHOT_STORE=memory keeps chats off Cloud Storage.
  const projectId = config.project || "northstar-local";
  const firestore = new Firestore({ projectId });
  const bucket = new Storage({ projectId }).bucket(config.bucket || "northstar-local-assets");
  const assets = staticAssets(config.staticDir, "google-cloud");
  let modelMap: Record<string, string> = {};
  try {
    modelMap = JSON.parse(source.VERTEX_MODEL_MAP ?? "{}") as Record<string, string>;
  } catch {
    console.warn("[gcp] VERTEX_MODEL_MAP is not valid JSON; using the default models.");
  }
  const env = {
    ...vars,
    DATA: firestoreDataPlatform(firestore, config.collectionPrefix),
    MEMBERS: firestoreMembers(firestore, config.collectionPrefix),
    MODELS: config.project
      ? vertexModels({
          project: config.project,
          location: source.VERTEX_LOCATION ?? config.location,
          ...(source.VERTEX_IMAGE_LOCATION ? { imageLocation: source.VERTEX_IMAGE_LOCATION } : {}),
          ...(source.VERTEX_ANTHROPIC_LOCATION
            ? { anthropicLocation: source.VERTEX_ANTHROPIC_LOCATION }
            : {}),
          imageModel: vars.CAMPAIGN_IMAGE_MODEL,
          modelMap,
        })
      : undefined,
    CAMPAIGN_ASSETS: gcsObjectStore(bucket),
    ASSETS: { fetch: (input: Request | string) => assets(new Request(input)) },
  } as unknown as WorkbenchEnv;
  // SNAPSHOT_STORE=memory keeps chats in this process only, for local runs without a bucket.
  const snapshots =
    source.SNAPSHOT_STORE === "memory" ? new MemorySnapshotStore() : gcsSnapshotStore(bucket);
  return { env, assets, firestore, snapshots };
}
