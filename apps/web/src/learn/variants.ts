/**
 * Learn text that depends on where the reader is: the host that served the page (ADR-018) and
 * the AI platform chosen in the top bar (ADR-021). The course is written once, with the parts
 * that differ marked inline:
 *
 *   {{cloudflare: a Durable Object || google-cloud: the Cloud Run agent host}}
 *   {{workers-ai: gpt-oss-20b on Workers AI || vertex: gpt-oss-120b on Vertex AI}}
 *
 * A marker's keys are all hosts or all AI platforms. A key left out reads as nothing, so
 * `{{google-cloud: …}}` adds a sentence only on Google Cloud. Markers don't nest.
 */
import type { AiPlatformId, HostId } from "@northstar/contracts";

// Listed here rather than imported, so the Node export script (type stripping only) can load this.
const HOSTS: readonly HostId[] = ["cloudflare", "google-cloud"];
const AI_PLATFORMS: readonly AiPlatformId[] = ["workers-ai", "vertex"];

export type LearnSetting = { host: HostId; platform: AiPlatformId };

const MARKER = /\{\{([\s\S]*?)\}\}/g;
const OPTION = /^([a-z-]+):(?: |$)([\s\S]*)$/;
const isHost = (key: string): key is HostId => (HOSTS as readonly string[]).includes(key);
const isPlatform = (key: string): key is AiPlatformId =>
  (AI_PLATFORMS as readonly string[]).includes(key);

/** The options of one marker by key, or why the marker is malformed. */
export function parseMarker(body: string): Map<string, string> | string {
  const options = new Map<string, string>();
  for (const part of body.split(" || ")) {
    const match = OPTION.exec(part);
    if (!match) return `"${part.slice(0, 40)}" is not "key: text"`;
    const [, key, text] = match as unknown as [string, string, string];
    if (!isHost(key) && !isPlatform(key)) return `unknown key "${key}"`;
    if (options.has(key)) return `"${key}" appears twice`;
    options.set(key, text);
  }
  const keys = [...options.keys()];
  if (!keys.every(isHost) && !keys.every(isPlatform))
    return "mixes host and AI platform keys in one marker";
  return options;
}

/** Text with each marker replaced by the option for this setting. */
export function resolveText(text: string, setting: LearnSetting): string {
  return text.replace(MARKER, (_, body: string) => {
    const options = parseMarker(body);
    if (typeof options === "string") throw new Error(`Learn marker {{${body}}}: ${options}.`);
    const key = isHost([...options.keys()][0] ?? "") ? setting.host : setting.platform;
    return options.get(key) ?? "";
  });
}

/** Every string in a value resolved for this setting; links and ids are left alone. */
export function resolveFor<T>(value: T, setting: LearnSetting, key = ""): T {
  if (typeof value === "string")
    return (key === "url" || key === "id" ? value : resolveText(value, setting)) as T;
  if (Array.isArray(value)) return value.map((item) => resolveFor(item, setting, key)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, resolveFor(item, setting, name)]),
    ) as T;
  return value;
}

/** Every marker in a value, for checking that each parses. */
export function markersIn(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(MARKER)].map((match) => match[1] ?? "");
  if (Array.isArray(value)) return value.flatMap(markersIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(markersIn);
  return [];
}

/** Google Cloud offers Vertex AI alone, whatever a stored choice says. */
export function learnSetting(host: HostId, platform: AiPlatformId | null): LearnSetting {
  return {
    host,
    platform: host === "google-cloud" ? "vertex" : (platform ?? "workers-ai"),
  };
}
