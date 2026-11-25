/**
 * The Learn page for the host it was served from (ADR-018). content.ts is written for Cloudflare;
 * on Google Cloud each lesson is rewritten here, sentence by sentence where the meaning changes
 * and term by term where only the names do, so the course describes the infrastructure the
 * reader is actually using. content.test.ts checks no Cloudflare name survives where it shouldn't.
 */
import type { HostId } from "@northstar/contracts";
import {
  GLOSSARY,
  LEARN_LEDE,
  LEARN_PARTS,
  LEARN_TITLE,
  type LearnPart,
  type Resource,
} from "./content.ts";

type Rule = readonly [string | RegExp, string];

/** Whole sentences whose meaning differs on Google Cloud. Applied first, in order. */
const SENTENCES: readonly Rule[] = [
  [
    "\n- On Google Cloud the same class runs in a Node agent host that speaks the same protocol, with each chat's storage saved to Cloud Storage (see *Two hosts*).",
    "",
  ],
  [
    "An open-weight reasoning model served at the edge, chosen by evaluation.",
    "An open-weight reasoning model, served as a managed model on Vertex AI.",
  ],
  [
    "A stateful Cloudflare agent per user that runs each chat turn.",
    "A stateful agent per user, on Cloud Run, that runs each chat turn.",
  ],
  [
    "The **orchestrator** is a Cloudflare **Agents SDK** chat agent running in a **Durable Object**: a single-threaded, stateful instance with its own SQLite storage.",
    "The **orchestrator** is an **Agents SDK** chat agent, run on Google Cloud by the workbench's own Node agent host on **Cloud Run**: one stateful instance per user with its own SQLite storage, saved to **Cloud Storage** after every change.",
  ],
  [
    /\*\*The Lightning surface\.\*\*[^\n]*/,
    "**The Lightning surface.** A Salesforce Lightning component onto the same agent is part of this demo, but not on Google Cloud: it depends on handing a signed-in person's token to a Salesforce origin, which Identity-Aware Proxy doesn't do. Here the workbench is used from its own page (ADR-018).",
  ],
  [
    "Workers AI defaults to 256 output tokens, which gpt-oss's reasoning could use up before any answer.",
    "A model endpoint's default output limit can be small enough for gpt-oss's reasoning to use up before any answer.",
  ],
  [
    "because Workers can't open Bolt connections",
    "the same way from either host the workbench runs on",
  ],
  ["The model: gpt-oss-20b on Workers AI", "The model: gpt-oss-120b on Vertex AI"],
  [
    "The orchestrator runs **gpt-oss-20b**, OpenAI's open-weight reasoning model, on **Cloudflare Workers AI**, routed through **AI Gateway** for logging and cost visibility.",
    "The orchestrator runs **gpt-oss-120b**, OpenAI's open-weight reasoning model, as a managed model on **Vertex AI**, with every call logged to Cloud Logging. The catalog names gpt-oss-20b, chosen by evaluation, but Vertex serves only 120b, so 120b answers here and the trace names it.",
  ],
  [
    /- \*\*Why 20b:\*\*[^\n]*/,
    "- **Why the catalog names 20b:** in the evaluation it matched or beat gpt-oss-120b through the pipeline at lower latency and cost (see *Evaluations*). On Vertex AI, which has no 20b, the orchestrator runs the 120b it was compared with.",
  ],
  ["behind Cloudflare Access", "behind Identity-Aware Proxy"],
  [
    "- Workers AI capacity errors are explained in plain language.",
    "- Model capacity errors are explained in plain language.",
  ],
  [
    "are Worker secrets that operators can flip without a deploy",
    "are service settings that operators can change without a rebuild",
  ],
  [
    "The path runs from the page through Cloudflare Access to the policy router, then AI Gateway and Workers AI, and out through the agentic gateway to each MCP server. A turn that ran on Google Cloud says so in its trace, and its map shows Identity-Aware Proxy in place of Access. The model hop is the AI platform the turn actually used: Workers AI behind AI Gateway, or Vertex AI called directly with no AI Gateway hop, whichever host served it.",
    "The path runs from the page through Identity-Aware Proxy to the policy router, then Vertex AI, and out through the agentic gateway to each MCP server. The model hop names the AI platform the turn actually ran on (ADR-021).",
  ],
  [
    "- **Where it runs is a choice.** The top bar's **AI platform** menu can send a Cloudflare turn to **Vertex AI** instead (ADR-021). Vertex serves gpt-oss-120b, not 20b, so the turn runs on 120b there, and the trace says so.",
    "- **Where it runs.** The top bar's **AI platform** menu shows where the models run; on Google Cloud that is Vertex AI (ADR-021).",
  ],
  [
    "Beside them, **AI platform** picks where the models run: Workers AI or Vertex AI. It lists only what this server can reach, says why an option isn't set up, and is greyed out when there is only one choice (ADR-021).",
    "Beside them, **AI platform** shows where the models run, Vertex AI here. It lists only what this server can reach, says why an option isn't set up, and is greyed out when there is only one choice (ADR-021).",
  ],
  [
    " With **Vertex AI** chosen in the top bar, Gemini's image model draws it instead, and the draft records which model did.",
    "",
  ],
  [
    "The open-model tier follows the top bar's **AI platform**: Workers AI, or gpt-oss on Vertex AI; the vendors keep the host's route. ",
    "",
  ],
  ["- **Workers Logs** for operators", "- **Cloud Logging** for operators"],
  [
    "against live Workers AI models.",
    "against live models. The published run was measured on Workers AI, before the move to Google Cloud; its numbers are kept as the reference until the suite is re-run on Vertex AI.",
  ],
  [
    "**FLUX.2 klein** on Workers AI generates a 1024×1024 draft from a bounded prompt",
    "**Gemini's image model** on Vertex AI generates a 1024×1024 draft from a bounded prompt",
  ],
  [
    "Drafts are stored privately in **R2** for 7 days, with provenance (model, prompt version, content hash) in **D1**.",
    "Drafts are stored privately in **Cloud Storage** for 7 days, with provenance (model, prompt version, content hash) in **Firestore**.",
  ],
  [
    "Each agent below is a model on Workers AI that",
    "Each agent below is a model on Vertex AI that",
  ],
  [
    "**Where the models run.** Deployed, on Workers AI through AI Gateway.",
    "**Where the models run.** Deployed, on Vertex AI.",
  ],
  [
    /Locally, \\?`pnpm dev:local\\?` uses local D1 and R2 with real Workers AI \([^)]*\)\./,
    "Locally, the Node server runs against the Firestore emulator.",
  ],
  [
    /Answer quality is judged by \*\*Clef\*\*, Cloudflare's decision model \(the \*score\* task class\): it answers three typed questions/,
    "Answer quality is judged by **gpt-oss-120b** on Vertex AI (the *score* task class), answering three typed questions",
  ],
  [
    "with probabilities, not prose, and bills input tokens only.",
    "as an index on each question's scale, returned as JSON.",
  ],
  [
    "The judge is always the Workers AI judge champion, whichever provider ran the squad",
    "The judge is always the same Vertex AI model, whichever provider ran the squad",
  ],
  [
    "A switch runs the same squad on **Cloudflare Workers AI**, **Anthropic** (Claude through the official Anthropic SDK) or **OpenAI** (the Responses API).",
    "A switch runs the same squad on **Vertex AI**'s open models (gpt-oss-120b) or **Anthropic** (Claude on Vertex AI, through the official Anthropic SDK); **OpenAI** (the Responses API) stays off on Google Cloud until it is approved.",
  ],
  [
    /Every request goes through the Cloudflare AI Gateway\. Anthropic and OpenAI requests go through the Worker's AI binding[^.]*\.( On Google Cloud[^.]*\.)?/,
    "Every request goes to Vertex AI with the service's own Google Cloud credentials, so no vendor key is stored anywhere.",
  ],
  ["with the provider, AI Gateway and effort", "with the provider and effort"],
  [
    "in a shared run library in D1 (`team_run_library`; a Firestore collection of that name on Google Cloud)",
    "in a shared run library in Firestore (`team_run_library`)",
  ],
  [
    "GLM-5.3 and DeepSeek V4.1 Flash on Workers AI (a worker re-sends a growing prompt, and DeepSeek's cached input costs $0.006 per million tokens)",
    "and gpt-oss-120b for both on Vertex AI, which serves no other open model here",
  ],
  // The architecture diagram.
  [
    "The browser talks to one Worker behind Cloudflare Access; each user's orchestrator reaches the model and three MCP servers.",
    "The browser talks to one Cloud Run service behind Identity-Aware Proxy; each user's orchestrator reaches the model and three MCP servers.",
  ],
  ["Cloudflare edge", "Google Cloud"],
  ["gpt-oss-20b via AI Gateway", "gpt-oss-120b, managed"],
];

/** Short labels (diagram nodes) replaced only when they are the whole string. */
const LABELS: Record<string, string> = {
  "AI Gateway": "Cloud Logging",
  "logs, cost, caching": "every model call, with its latency",
  "FLUX.2 klein": "Gemini image",
  "Durable Object": "Agent host",
};

/** Names that differ only in what the service is called. Applied after the sentences. */
const TERMS: readonly Rule[] = [
  ["one Worker behind", "one Cloud Run service behind"],
  ["Clef gives no reasons", "The judge gives no reasons"],
  [
    "A single-threaded, stateful Cloudflare instance with its own storage; one per user here.",
    "A single-threaded, stateful instance with its own storage, the shape each user's chat has; the Node agent host on Cloud Run provides it here.",
  ],
  ["Worker + Access", "Cloud Run + IAP"],
  ["Agent Durable Object", "Agent host (Cloud Run)"],
  ["Durable Object per user", "Agent host, chat per user"],
  ["Each user's agent Durable Object", "Each user's chat in the Cloud Run agent host"],
  ["D1 + R2", "Firestore + Cloud Storage"],
  ["R2 draft", "Cloud Storage draft"],
  ["their Access identity", "their IAP identity"],
  ["The Worker's hourly job", "The hourly Cloud Scheduler job"],
  ["the Worker asks", "the server asks"],
  ["the Worker signs", "the server signs"],
  ["come from the Worker", "come from the server"],
  ["as the Worker reports them", "as the server reports them"],
  ["can't reach the Worker without them", "can't reach the server without them"],
  ["called live from the Worker", "called live from the server"],
  [
    "the surface (role, brand, market), the Worker,",
    "the surface (role, brand, market), the server,",
  ],
  ["go to D1, scoped to you", "go to Firestore, scoped to you"],
  ["saved in D1;", "saved in Firestore;"],
  ["the run's state, saved to D1;", "the run's state, saved to Firestore;"],
  ["Cloudflare Access", "Identity-Aware Proxy"],
  ["Cloudflare Workers AI", "Vertex AI"],
  ["Workers AI", "Vertex AI"],
];

/** Reference links that name Cloudflare products, and what to point at on Google Cloud. */
const RESOURCES: Record<string, Resource | null> = {
  "Cloudflare Durable Objects": {
    label: "Cloud Run documentation",
    url: "https://cloud.google.com/run/docs",
    kind: "Docs",
  },
  "Cloudflare Workers AI": {
    label: "gpt-oss-120b on Vertex AI (managed API)",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/maas/openai/gpt-oss-120b",
    kind: "Docs",
  },
  "gpt-oss-20b on Workers AI": {
    label: "gpt-oss-120b on Vertex AI (managed API)",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/maas/openai/gpt-oss-120b",
    kind: "Docs",
  },
  "Cloudflare AI Gateway": null,
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
  "FLUX.2 klein 4B on Workers AI": {
    label: "Image generation with Gemini on Vertex AI",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation",
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

/** Lessons that compare the two hosts, or report what was measured on one, keep their names. */
export const HOST_NEUTRAL_SECTIONS = new Set(["two-hosts", "evaluations"]);

function rewrite(text: string) {
  const label = LABELS[text];
  if (label) return label;
  let out = text;
  for (const [find, replace] of [...SENTENCES, ...TERMS])
    out =
      typeof find === "string" ? out.split(find).join(replace) : out.replace(find, () => replace);
  return out;
}

/** Every string in a value, rewritten for Google Cloud; links and ids are left alone. */
export function forGoogleCloud<T>(value: T, key = ""): T {
  if (typeof value === "string")
    return (key === "url" || key === "id" ? value : rewrite(value)) as T;
  if (Array.isArray(value)) return value.map((item) => forGoogleCloud(item, key)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, forGoogleCloud(item, name)]),
    ) as T;
  return value;
}

function resourcesFor(resources: Resource[]) {
  const out: Resource[] = [];
  for (const resource of resources) {
    const swap = RESOURCES[resource.label];
    if (swap === null) continue;
    const next = swap ?? resource;
    if (!out.some((item) => item.url === next.url)) out.push(next);
  }
  return out;
}

export type LearnContent = {
  title: string;
  lede: string;
  parts: LearnPart[];
  glossary: typeof GLOSSARY;
};

/** The course for a host: as written for Cloudflare, or rewritten for Google Cloud. */
export function learnFor(host: HostId): LearnContent {
  if (host !== "google-cloud")
    return { title: LEARN_TITLE, lede: LEARN_LEDE, parts: LEARN_PARTS, glossary: GLOSSARY };
  return {
    title: LEARN_TITLE,
    lede: LEARN_LEDE,
    parts: LEARN_PARTS.map((part) => ({
      ...forGoogleCloud(part),
      sections: part.sections.map((section) => {
        if (section.id === "evaluations")
          return { ...section, body: `${EVALUATIONS_NOTE}\n\n${section.body}` };
        if (HOST_NEUTRAL_SECTIONS.has(section.id)) return section;
        return { ...forGoogleCloud(section), resources: resourcesFor(section.resources) };
      }),
    })),
    glossary: forGoogleCloud(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term)),
  };
}
