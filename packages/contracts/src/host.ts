// Where the workbench is running, and what each piece of infrastructure is called there
// (ADR-018). The browser, the server and the Learn page name things from this one table, so a
// deployment on Google Cloud never talks about Cloudflare, and the reverse.

export const HOSTS = ["cloudflare", "google-cloud"] as const;
export type HostId = (typeof HOSTS)[number];

export type HostTerms = {
  id: HostId;
  /** The cloud: "Cloudflare" or "Google Cloud". */
  platform: string;
  /** What runs the server code. */
  runtime: string;
  /** Sign-in in front of the app. */
  signIn: string;
  /** Where the models run. */
  models: string;
  /** The model gateway in front of them, if any. */
  modelGateway: string | null;
  /** The image model campaign images come from. */
  imageModel: string;
  /** Where each chat's agent and its storage live. */
  chatRuntime: string;
  /** The app's database (audit, drafts, architecture store, squad library). */
  database: string;
  /** Where generated images are stored. */
  objectStore: string;
  /** What runs the hourly maintenance job. */
  scheduler: string;
  /** Where model prices come from. */
  pricing: string;
};

export const HOST_TERMS: Record<HostId, HostTerms> = {
  cloudflare: {
    id: "cloudflare",
    platform: "Cloudflare",
    runtime: "Cloudflare Worker",
    signIn: "Cloudflare Access",
    models: "Workers AI",
    modelGateway: "AI Gateway",
    imageModel: "FLUX on Workers AI",
    chatRuntime: "Durable Object",
    database: "D1",
    objectStore: "R2",
    scheduler: "the Worker's cron trigger",
    pricing: "Cloudflare list prices",
  },
  "google-cloud": {
    id: "google-cloud",
    platform: "Google Cloud",
    runtime: "Cloud Run service",
    signIn: "Identity-Aware Proxy",
    models: "Vertex AI",
    modelGateway: null,
    imageModel: "Gemini image on Vertex AI",
    chatRuntime: "Cloud Run agent host",
    database: "Firestore",
    objectStore: "Cloud Storage",
    scheduler: "Cloud Scheduler",
    // The model evaluation was measured on Workers AI; its prices stay those it was run at.
    pricing: "Cloudflare list prices (the evaluation ran on Workers AI)",
  },
};

/** The `<meta>` the Google Cloud server adds to the page; Cloudflare serves the page untouched. */
export const HOST_META_NAME = "northstar-host";

export const isHostId = (value: unknown): value is HostId =>
  typeof value === "string" && (HOSTS as readonly string[]).includes(value);

/** The host this page was served from, read once from its `<meta>`; Cloudflare when absent. */
export function pageHost(
  doc: { querySelector(selector: string): Element | null } | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
): HostId {
  const value = doc?.querySelector(`meta[name="${HOST_META_NAME}"]`)?.getAttribute("content");
  return isHostId(value) ? value : "cloudflare";
}

/** The page's host terms: what the browser should call each piece of infrastructure. */
export const hostTerms = (host: HostId = pageHost()) => HOST_TERMS[host];

// The AI platform, chosen apart from the host (ADR-021): where a turn's models run. A Cloudflare
// deployment offers Workers AI and, with a Google service-account key, Vertex AI; a Google Cloud
// deployment offers Vertex AI. The browser sends its choice with each message, like the brand.

export const AI_PLATFORMS = ["workers-ai", "vertex"] as const;
export type AiPlatformId = (typeof AI_PLATFORMS)[number];

export type AiPlatformTerms = {
  id: AiPlatformId;
  /** "Workers AI" or "Vertex AI". */
  label: string;
  /** The cloud that runs it. */
  cloud: string;
  /** The model gateway its calls pass through, if any. */
  gateway: string | null;
  /** The image model campaign images come from. */
  imageModel: string;
};

export const AI_PLATFORM_TERMS: Record<AiPlatformId, AiPlatformTerms> = {
  "workers-ai": {
    id: "workers-ai",
    label: "Workers AI",
    cloud: "Cloudflare",
    gateway: "AI Gateway",
    imageModel: "FLUX on Workers AI",
  },
  vertex: {
    id: "vertex",
    label: "Vertex AI",
    cloud: "Google Cloud",
    gateway: null,
    imageModel: "Gemini image on Vertex AI",
  },
};

export const isAiPlatformId = (value: unknown): value is AiPlatformId =>
  typeof value === "string" && (AI_PLATFORMS as readonly string[]).includes(value);

/** What /api/ai-platforms reports: what this server can run, and what it runs by default. */
export type AiPlatformOptions = {
  default: AiPlatformId | null;
  platforms: Array<{ id: AiPlatformId; label: string; available: boolean; reason?: string }>;
};
