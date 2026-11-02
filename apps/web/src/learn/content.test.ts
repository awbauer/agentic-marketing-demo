import { describe, expect, it } from "vitest";
import { GLOSSARY, LEARN_PARTS } from "./content";
import { DIAGRAM_IDS } from "./diagrams";
import { PART_LESSONS, SECTION_LESSONS } from "./lessons";
import { LEARN_REFERENCE } from "./reference";
import { SECTION_SOURCES } from "./sources";

describe("learn page content", () => {
  const sections = LEARN_PARTS.flatMap((part) => part.sections);

  it("covers the context primer, the GraphRAG primer, and every demo concept", () => {
    expect(LEARN_PARTS.map((part) => part.id)).toEqual(["context", "graphrag", "concepts"]);
    for (const id of [
      "orchestrator",
      "model",
      "mcp",
      "salesforce",
      "routing",
      "reliability",
      "governance",
      "ui",
      "observability",
      "evaluations",
      "images",
      "campaign-context",
      "long-term-memory",
      "marketing-cloud",
      "use-cases",
      "object-model",
      "gateway",
      "lifecycle",
      "agent-operations",
    ])
      expect(
        sections.some((section) => section.id === id),
        id,
      ).toBe(true);
  });

  it("uses unique anchors and links every section to https resources", () => {
    const ids = [
      ...LEARN_PARTS.map((part) => part.id),
      ...sections.map((section) => section.id),
      "glossary",
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of sections) {
      expect(section.resources.length, section.id).toBeGreaterThan(0);
      for (const resource of section.resources)
        expect(resource.url, resource.label).toMatch(/^https:\/\//);
    }
  });

  it("keeps the glossary sorted for scanning", () => {
    const terms = GLOSSARY.map((entry) => entry.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
  });

  it("gives every part a path, outcomes, and a quick check with a valid answer", () => {
    LEARN_PARTS.forEach((part, index) => {
      const lesson = PART_LESSONS[part.id];
      expect(lesson?.number).toBe(index + 1);
      expect(lesson?.outcomes.length).toBeGreaterThan(0);
      expect(lesson?.check.options[lesson.check.answer]).toBeDefined();
    });
  });

  it("gives every lesson a diagram that exists and one key idea", () => {
    for (const section of sections) {
      const lesson = SECTION_LESSONS[section.id];
      expect(lesson, section.id).toBeDefined();
      expect(DIAGRAM_IDS).toContain(lesson?.diagram);
      expect(lesson?.keyIdea.length).toBeGreaterThan(20);
    }
    expect(Object.keys(SECTION_LESSONS).sort()).toEqual(sections.map((s) => s.id).sort());
  });

  it("links every reference entry and source mapping to a real section", () => {
    const ids = new Set(sections.map((section) => section.id));
    for (const entry of LEARN_REFERENCE) expect(ids.has(entry.section), entry.name).toBe(true);
    expect(Object.keys(SECTION_SOURCES).sort()).toEqual([...ids].sort());
  });
});
