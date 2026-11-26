import { describe, expect, it } from "vitest";
import { GLOSSARY, LEARN_PARTS } from "./content";
import { DIAGRAM_SPECS } from "./diagram-specs";
import { detailsAsHtml, lessonParts, unclosedDetails } from "./details";
import { diagramSpecsFor, HOST_NEUTRAL_SECTIONS, learnFor } from "./host";
import { learnSetting, markersIn, parseMarker, resolveFor, resolveText } from "./variants";
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

  it("closes every collapsible detail block and gives it a title", () => {
    for (const section of sections) {
      expect(unclosedDetails(section.body), section.id).toBe(0);
      for (const part of lessonParts(section.body))
        if (part.kind === "details") expect(part.title.length, section.id).toBeGreaterThan(3);
    }
    const body = "Lead.\n\n::: details More\nDeep.\n:::\n\nTail.";
    expect(lessonParts(body).map((part) => part.kind)).toEqual(["text", "details", "text"]);
    expect(detailsAsHtml(body)).toContain("<details>\n<summary>More</summary>\n\nDeep.");
  });

  it("keeps the glossary sorted for scanning, as written for Cloudflare", () => {
    const terms = resolveFor(GLOSSARY, learnSetting("cloudflare", "workers-ai")).map(
      (entry) => entry.term,
    );
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

describe("the course on each host and AI platform (ADR-018, ADR-021)", () => {
  const CLOUDFLARE_NAMES =
    /Cloudflare|Workers AI|AI Gateway|Durable Object|\bD1\b|\bR2\b|\bWorkers?\b|wrangler|\bAccess\b|FLUX|Clef|cf-access/;
  const strings = (value: unknown, key = ""): string[] => {
    if (typeof value === "string") return key === "url" ? [] : [value];
    if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([name, item]) => strings(item, name));
    return [];
  };
  const settings = [
    ["cloudflare", "workers-ai"],
    ["cloudflare", "vertex"],
    ["google-cloud", "vertex"],
  ] as const;

  it("writes every marker as hosts or as AI platforms, and leaves none unresolved", () => {
    const markers = markersIn([LEARN_PARTS, GLOSSARY, DIAGRAM_SPECS]);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.filter((body) => typeof parseMarker(body) === "string")).toEqual([]);
    for (const [host, platform] of settings) {
      const course = learnFor(host, platform);
      expect(
        strings([course, diagramSpecsFor(host, platform)]).filter((text) => text.includes("{{")),
      ).toEqual([]);
    }
  });

  it("resolves a marker by host or by AI platform, and a missing option to nothing", () => {
    const setting = learnSetting("cloudflare", "vertex");
    expect(resolveText("{{cloudflare: D1 || google-cloud: Firestore}}", setting)).toBe("D1");
    expect(resolveText("on {{workers-ai: Workers AI || vertex: Vertex AI}}", setting)).toBe(
      "on Vertex AI",
    );
    expect(resolveText("a{{google-cloud: b}}c", setting)).toBe("ac");
    // Google Cloud has only Vertex AI, whatever the browser remembered.
    expect(learnSetting("google-cloud", "workers-ai").platform).toBe("vertex");
    expect(typeof parseMarker("cloudflare: a || vertex: b")).toBe("string");
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
      strings(diagramSpecsFor("google-cloud")).filter((text) => CLOUDFLARE_NAMES.test(text)),
    ).toEqual([]);
  });

  it("follows the AI platform chosen on Cloudflare: Vertex AI's models, no AI Gateway hop", () => {
    const vertex = learnFor("cloudflare", "vertex");
    const model = vertex.parts.flatMap((part) => part.sections).find((s) => s.id === "model");
    expect(model?.title).toContain("Vertex AI");
    expect(model?.body).toContain("gpt-oss-120b");
    expect(model?.resources.map((item) => item.label)).not.toContain("Cloudflare AI Gateway");
    const images = vertex.parts.flatMap((part) => part.sections).find((s) => s.id === "images");
    expect(images?.body).toContain("Gemini");
    // The host stays Cloudflare: sign-in and storage keep their Cloudflare names.
    expect(strings(vertex).some((text) => text.includes("Cloudflare Access"))).toBe(true);
    expect(strings(diagramSpecsFor("cloudflare", "vertex").architecture)).toContain("Vertex AI");
    const workers = learnFor("cloudflare", "workers-ai");
    expect(
      workers.parts.flatMap((part) => part.sections).find((s) => s.id === "model")?.title,
    ).toContain("Workers AI");
  });

  it("keeps every lesson, in order, in every edition", () => {
    const ids = (host: "cloudflare" | "google-cloud", platform: "workers-ai" | "vertex") =>
      learnFor(host, platform).parts.flatMap((part) => part.sections.map((section) => section.id));
    for (const [host, platform] of settings)
      expect(ids(host, platform)).toEqual(ids("cloudflare", "workers-ai"));
    const terms = learnFor("google-cloud").glossary.map((entry) => entry.term);
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
  });
});
