/**
 * The Playbook page: general guidance for running agentic systems in production. Learn explains
 * how this workbench works; the Playbook explains the practice it follows. The text lives in
 * docs/playbook.md so it can be edited as a plain document; this module splits it into sections
 * and links each one to the Learn sections where the workbench shows it.
 */
import source from "../../../../docs/playbook.md?raw";

export type PlaybookSection = { id: string; title: string; body: string };
export type Playbook = { title: string; byline: string; sections: PlaybookSection[] };

/** "## 5. Failure patterns" → "failure-patterns"; "## The short version" → "the-short-version". */
export function slug(heading: string): string {
  return heading
    .replace(/^\d+\.\s*/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

// The document marks drawings it doesn't carry yet as "[embedded content: …]" (sometimes with the
// bracket escaped). Show them as a visible note rather than as stray markup.
const EMBED = /^[ \t]*(?:&#91;|\\?\[)embedded content:[ \t]*(.+?)\\?\][ \t]*$/gim;

export function parsePlaybook(markdown: string): Playbook {
  const text = markdown.replace(/\r\n/g, "\n").replace(EMBED, (_, label: string) => {
    return `> **Diagram not yet drawn here:** ${label.trim()}`;
  });
  const [head = "", ...chunks] = text.split(/^## /m);
  const title = head.match(/^# (.+)$/m)?.[1]?.trim() ?? "Playbook";
  const byline =
    head
      .replace(/^# .+$/m, "")
      .trim()
      .split("\n")[0]
      ?.replace(/@(?=\S)/g, "")
      .trim() ?? "";
  const sections = chunks.map((chunk) => {
    const [heading = "", ...rest] = chunk.split("\n");
    // The section title is the page's h3, so the document's own subheadings drop one level.
    const body = rest
      .join("\n")
      .replace(/^(#{3,5}) /gm, "#$1 ")
      .trim();
    return { id: slug(heading), title: heading.trim(), body };
  });
  return { title, byline, sections };
}

export const PLAYBOOK = parsePlaybook(source);

/**
 * Where the workbench shows each playbook section in practice, as Learn section ids. Keyed by the
 * section's slug, so renumbering the document doesn't break the links; a section with no entry
 * simply has none.
 */
export const IN_THE_WORKBENCH: Record<string, readonly string[]> = {
  "should-this-be-an-agent-at-all": ["routing", "use-cases"],
  "reference-architecture-one-bounded-agent": ["orchestrator", "gateway", "mcp"],
  "workflow-and-multi-agent-patterns": ["routing", "campaign-squad", "lifecycle"],
  "technology-stack-by-layer": ["two-hosts", "model", "mcp", "graphrag-here"],
  "failure-patterns": ["reliability", "context-risks", "marketing-cloud"],
  "security-safety-and-identity": ["governance", "gateway", "context-risks"],
  "regulated-industries": ["pharma-lifecycle", "lifecycle"],
  "evaluation-framework": ["evaluations", "agent-operations"],
  "llmops-running-it": ["observability", "agent-operations"],
  "operating-model-and-team": ["agent-operations"],
  "go-live-checklist": ["governance", "observability"],
};
