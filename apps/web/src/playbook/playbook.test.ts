import { describe, expect, it } from "vitest";
import { LEARN_PARTS } from "../learn/content";
import { IN_THE_WORKBENCH, PLAYBOOK, parsePlaybook, slug } from "./playbook";

describe("playbook", () => {
  it("splits the document into its sections", () => {
    expect(PLAYBOOK.title).toBe("Agentic Systems in Production: A Playbook");
    expect(PLAYBOOK.sections[0]?.id).toBe("the-short-version");
    expect(PLAYBOOK.sections.map((section) => section.id)).toContain("evaluation-framework");
    for (const section of PLAYBOOK.sections) expect(section.body.length).toBeGreaterThan(0);
  });

  it("turns embedded-content markers into a visible note", () => {
    const parsed = parsePlaybook(
      "# T\n\n## 2. Arch\n\nBefore.\n\n&#91;embedded content: the eval loop\\]\n\n[embedded content: x]\n",
    );
    expect(parsed.sections[0]?.body).toContain("> **Diagram not yet drawn here:** the eval loop");
    expect(parsed.sections[0]?.body).not.toContain("embedded content");
    // The note is its own block: the paragraph after it isn't pulled into the quote.
    expect(
      parsePlaybook("# T\n\n## A\n\n[embedded content: d]\n\nAfter.\n").sections[0]?.body,
    ).toBe("> **Diagram not yet drawn here:** d\n\nAfter.");
  });

  it("drops the document's subheadings one level under the section title", () => {
    expect(parsePlaybook("# T\n\n## A\n\n### Sub\n").sections[0]?.body).toBe("#### Sub");
  });

  it("slugs headings without their numbers", () => {
    expect(slug("6. Security, safety and identity")).toBe("security-safety-and-identity");
    expect(slug("9. LLMOps: running it")).toBe("llmops-running-it");
  });

  // Renaming a playbook heading only drops its links; a Learn section that no longer exists is a bug.
  it("links only to Learn sections that exist", () => {
    const learn = new Set(LEARN_PARTS.flatMap((part) => part.sections.map((s) => s.id)));
    for (const targets of Object.values(IN_THE_WORKBENCH))
      for (const target of targets) expect(learn.has(target), target).toBe(true);
  });
});
