/**
 * The Learn page for where the reader is: the host that served the page (ADR-018) and the AI
 * platform chosen in the top bar (ADR-021). content.ts is written once, with what differs marked
 * inline (variants.ts); this file resolves the markers and swaps the reference links that name
 * one host's or one platform's products. content.test.ts checks the Google Cloud edition names no
 * Cloudflare product outside the lessons that compare the hosts.
 */
import type { AiPlatformId, HostId } from "@northstar/contracts";
import {
  GLOSSARY,
  LEARN_LEDE,
  LEARN_PARTS,
  LEARN_TITLE,
  type LearnPart,
  type Resource,
} from "./content.ts";
import { DIAGRAM_SPECS } from "./diagram-specs.ts";
import { type LearnSetting, learnSetting, resolveFor } from "./variants.ts";

export type { LearnSetting };
export { learnSetting };

const VERTEX_GPT_OSS: Resource = {
  label: "gpt-oss-120b on Vertex AI (managed API)",
  url: "https://cloud.google.com/vertex-ai/generative-ai/docs/maas/openai/gpt-oss-120b",
  kind: "Docs",
};

/** Links to model products, by label, and what replaces them on Vertex AI (null: dropped). */
const PLATFORM_RESOURCES: Record<string, Resource | null> = {
  "Cloudflare Workers AI": VERTEX_GPT_OSS,
  "gpt-oss-20b on Workers AI": VERTEX_GPT_OSS,
  "Cloudflare AI Gateway": null,
  "FLUX.2 klein 4B on Workers AI": {
    label: "Image generation with Gemini on Vertex AI",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation",
    kind: "Docs",
  },
};

/** Links to Cloudflare infrastructure, by label, and what replaces them on Google Cloud. */
const HOST_RESOURCES: Record<string, Resource | null> = {
  "Cloudflare Durable Objects": {
    label: "Cloud Run documentation",
    url: "https://cloud.google.com/run/docs",
    kind: "Docs",
  },
  "Cloudflare R2": {
    label: "Cloud Storage documentation",
    url: "https://cloud.google.com/storage/docs",
    kind: "Docs",
  },
  "Cloudflare D1": {
    label: "Firestore documentation",
    url: "https://cloud.google.com/firestore/docs",
    kind: "Docs",
  },
  "Cloudflare Agents SDK": {
    label: "Agents SDK (the chat agent API the orchestrator is written to)",
    url: "https://developers.cloudflare.com/agents/",
    kind: "Docs",
  },
  "Cloudflare chat agents": {
    label: "Agents SDK chat agents (the protocol the Node agent host speaks)",
    url: "https://developers.cloudflare.com/agents/api-reference/chat-agents/",
    kind: "Docs",
  },
  "MCP on Cloudflare": {
    label: "Model Context Protocol specification",
    url: "https://modelcontextprotocol.io/specification",
    kind: "Spec",
  },
};

/** The evaluation's numbers were measured on Workers AI; on Google Cloud the lesson says so first. */
const EVALUATIONS_NOTE =
  "**On Google Cloud.** The evaluation published below was measured on Cloudflare Workers AI, before the workbench moved to Google Cloud, and is kept as the reference. Here every model call goes to gpt-oss-120b on Vertex AI; re-running `pnpm eval:live` against this deployment produces the Google Cloud numbers.";

/** Lessons that compare the hosts, or report what was measured on one, keep every link. */
export const HOST_NEUTRAL_SECTIONS = new Set(["two-hosts", "evaluations"]);

function resourcesFor(resources: Resource[], setting: LearnSetting) {
  const out: Resource[] = [];
  for (const resource of resources) {
    let next: Resource | null | undefined = resource;
    if (setting.platform === "vertex" && resource.label in PLATFORM_RESOURCES)
      next = PLATFORM_RESOURCES[resource.label];
    if (next && setting.host === "google-cloud" && next.label in HOST_RESOURCES)
      next = HOST_RESOURCES[next.label];
    if (next && !out.some((item) => item.url === next.url)) out.push(next);
  }
  return out;
}

export type LearnContent = {
  title: string;
  lede: string;
  parts: LearnPart[];
  glossary: typeof GLOSSARY;
};

// Each edition is built once: the page re-reads it on every render and diagram.
const courses = new Map<string, LearnContent>();
const diagrams = new Map<string, typeof DIAGRAM_SPECS>();
const keyOf = (setting: LearnSetting) => `${setting.host}:${setting.platform}`;

/** The course for a host and AI platform. */
export function learnFor(host: HostId, platform: AiPlatformId | null = null): LearnContent {
  const setting = learnSetting(host, platform);
  const key = keyOf(setting);
  const cached = courses.get(key);
  if (cached) return cached;
  const course = build(setting);
  courses.set(key, course);
  return course;
}

function build(setting: LearnSetting): LearnContent {
  return {
    title: resolveFor(LEARN_TITLE, setting),
    lede: resolveFor(LEARN_LEDE, setting),
    parts: LEARN_PARTS.map((part) => ({
      ...resolveFor(part, setting),
      sections: part.sections.map((section) => {
        const resolved = resolveFor(section, setting);
        if (HOST_NEUTRAL_SECTIONS.has(section.id)) {
          if (section.id === "evaluations" && setting.host === "google-cloud")
            return { ...resolved, body: `${EVALUATIONS_NOTE}\n\n${resolved.body}` };
          return resolved;
        }
        return { ...resolved, resources: resourcesFor(section.resources, setting) };
      }),
    })),
    glossary: resolveFor(GLOSSARY, setting).sort((a, b) => a.term.localeCompare(b.term)),
  };
}

/** The lesson diagrams for a host and AI platform. */
export function diagramSpecsFor(host: HostId, platform: AiPlatformId | null = null) {
  const setting = learnSetting(host, platform);
  const key = keyOf(setting);
  let specs = diagrams.get(key);
  if (!specs) {
    specs = resolveFor(DIAGRAM_SPECS, setting);
    diagrams.set(key, specs);
  }
  return specs;
}
