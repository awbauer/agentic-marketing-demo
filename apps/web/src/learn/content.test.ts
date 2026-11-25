import { describe, expect, it } from "vitest";
import { GLOSSARY, LEARN_PARTS } from "./content";
import { DIAGRAM_SPECS } from "./diagram-specs";
import { forGoogleCloud, HOST_NEUTRAL_SECTIONS, learnFor } from "./host";
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

describe("the course on each host (ADR-018)", () => {
  const CLOUDFLARE_NAMES =
    /Cloudflare|Workers AI|AI Gateway|Durable Object|\bD1\b|\bR2\b|\bWorkers?\b|wrangler|\bAccess\b|FLUX|Clef|cf-access/;
  const strings = (value: unknown, key = ""): string[] => {
    if (typeof value === "string") return key === "url" ? [] : [value];
    if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([name, item]) => strings(item, name));
    return [];
  };

  it("serves the Cloudflare course exactly as written", () => {
    const course = learnFor("cloudflare");
    expect(course.parts).toBe(LEARN_PARTS);
    expect(course.glossary).toBe(GLOSSARY);
  });

  it("names no Cloudflare service on Google Cloud outside the lessons that compare hosts", () => {
    const course = learnFor("google-cloud");
    const leftovers = course.parts
      .flatMap((part) =>
        part.sections
          .filter((section) => !HOST_NEUTRAL_SECTIONS.has(section.id))
          .flatMap((section) =>
            strings({ ...section, resources: section.resources.map((item) => item.label) }).map(
              (text) => [section.id, text] as const,
            ),
          ),
      )
      .filter(([, text]) => CLOUDFLARE_NAMES.test(text.replace(/Agents SDK[^)]*\)/g, "")))
      .map(([id, text]) => `${id}: ${text.match(CLOUDFLARE_NAMES)?.[0]}`);
    expect(leftovers).toEqual([]);
    expect(strings(course.glossary).filter((text) => CLOUDFLARE_NAMES.test(text))).toEqual([]);
    expect(
      strings(forGoogleCloud(DIAGRAM_SPECS)).filter((text) => CLOUDFLARE_NAMES.test(text)),
    ).toEqual([]);
  });

  it("keeps every lesson, in order, on both hosts", () => {
    const ids = (host: "cloudflare" | "google-cloud") =>
      learnFor(host).parts.flatMap((part) => part.sections.map((section) => section.id));
    expect(ids("google-cloud")).toEqual(ids("cloudflare"));
    const terms = learnFor("google-cloud").glossary.map((entry) => entry.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
  });
});
