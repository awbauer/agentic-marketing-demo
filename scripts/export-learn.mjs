// Writes docs/learn.md: the whole Learn page as Markdown, with every diagram as Mermaid.
// It's generated from the page's own sources, so it can't drift from what the page shows.
// Usage: pnpm learn:export          (rewrite docs/learn.md)
//        pnpm learn:export --check  (fail when docs/learn.md is out of date; part of learn:check)
import { readFileSync, writeFileSync } from "node:fs";
import { detailsAsHtml } from "../apps/web/src/learn/details.ts";
import { diagramSpecsFor, learnFor } from "../apps/web/src/learn/host.ts";
import { DIAGRAM_SPECS } from "../apps/web/src/learn/diagram-specs.ts";
import { PART_LESSONS, SECTION_LESSONS } from "../apps/web/src/learn/lessons.ts";
import { LEARN_REFERENCE, REFERENCE_KINDS } from "../apps/web/src/learn/reference.ts";

export const LEARN_MARKDOWN = "docs/learn.md";
/** The same course as a reader on the Google Cloud deployment sees it (ADR-018). */
export const LEARN_MARKDOWN_GOOGLE_CLOUD = "docs/learn-google-cloud.md";
let LEARN_TITLE;
let LEARN_LEDE;
let LEARN_PARTS;
let GLOSSARY;
let SPECS = DIAGRAM_SPECS;

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
function anchors() {
  const seen = new Map();
  return (heading) => {
    const base = heading
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

const quote = (text) => text.replaceAll('"', "#quot;");
const box = (step, prefix = "") =>
  `"${quote(`${prefix}${step.glyph ? `${step.glyph} ` : ""}${step.title}`)}${
    step.caption ? `<br/>${quote(step.caption)}` : ""
  }"`;

/** One Mermaid flowchart per diagram block, mirroring what the page draws. */
function mermaid(block, id) {
  const lines = [];
  const chain = (steps, prefix, numbered = false, indent = "  ") => {
    steps.forEach((step, index) => {
      lines.push(`${indent}${prefix}${index}[${box(step, numbered ? `${index + 1}. ` : "")}]`);
    });
    if (steps.length > 1)
      lines.push(`${indent}${steps.map((_, index) => `${prefix}${index}`).join(" --> ")}`);
  };
  switch (block.kind) {
    case "flow":
      // A long row would shrink to fit the page, so long flows run top to bottom.
      lines.push(block.steps.length > 3 ? "flowchart TB" : "flowchart LR");
      chain(block.steps, `${id}_`, block.numbered);
      break;
    case "lanes":
      lines.push("flowchart TB");
      block.lanes.forEach((lane, index) => {
        lines.push(`  subgraph ${id}_lane${index}["${quote(lane.label)}"]`, "    direction LR");
        chain(lane.steps, `${id}_${index}_`, false, "    ");
        lines.push("  end");
      });
      // Invisible links stack the lanes top to bottom, as the page does.
      if (block.lanes.length > 1)
        lines.push(`  ${block.lanes.map((_, index) => `${id}_lane${index}`).join(" ~~~ ")}`);
      break;
    case "cards":
      lines.push("flowchart LR");
      block.cards.forEach((card, index) => {
        const points = (card.points ?? []).map((point) => `<br/>• ${quote(point)}`).join("");
        lines.push(`  ${id}_${index}[${box(card).slice(0, -1)}${points}"]`);
      });
      break;
    case "chips":
      lines.push("flowchart LR");
      lines.push(`  subgraph ${id}_chips["${quote(block.label)}"]`, "    direction LR");
      block.items.forEach((item, index) => {
        lines.push(`    ${id}_${index}["✓ ${quote(item)}"]`);
      });
      lines.push("  end");
      break;
    case "context-window":
      lines.push("flowchart TB");
      lines.push(`  subgraph ${id}_window["Context window: everything the model can see"]`);
      lines.push("    direction LR");
      block.segments.forEach((segment, index) => {
        lines.push(
          `    ${id}_s${index}["${quote(segment.name)} (${segment.share}%)<br/>${quote(segment.detail)}"]`,
        );
      });
      lines.push("  end");
      chain(block.steps, `${id}_`);
      lines.push(`  ${id}_window --> ${id}_0`);
      break;
    case "memory-layers":
      lines.push("flowchart TB");
      block.layers.forEach((layer, index) => {
        lines.push(
          `  ${id}_${index}["${quote(layer.name)}<br/>${quote(layer.where)}<br/>${quote(layer.reader)} · ${quote(layer.life)}"]`,
        );
      });
      break;
    case "graph-path":
      lines.push("flowchart LR");
      for (const node of block.nodes)
        lines.push(`  ${node.id}(("${quote(node.name)}<br/>${quote(node.label)}"))`);
      for (const edge of block.edges)
        lines.push(
          edge.path
            ? `  ${edge.from} ==>|${edge.type}| ${edge.to}`
            : `  ${edge.from} -.->|${edge.type}| ${edge.to}`,
        );
      break;
    case "graph-tools": {
      lines.push("flowchart TB");
      // One box listing every tool reads better than nine boxes Mermaid would lay out in a row.
      lines.push(
        `  ${id}_tools["Curated tools${block.tools
          .map((tool) => `<br/>${tool.name}: ${quote(tool.question)}`)
          .join("")}"]`,
      );
      const [first, second] = block.stores;
      lines.push(`  ${id}_a[${box(first)}]`, `  ${id}_b[${box(second)}]`);
      lines.push(`  ${id}_tools --> ${id}_a`, `  ${id}_a <-.->|identical results| ${id}_b`);
      break;
    }
    case "architecture":
      lines.push("flowchart TB");
      block.tiers.forEach((tier, index) => {
        lines.push(`  subgraph ${id}_tier${index}["${quote(tier.label)}"]`, "    direction LR");
        tier.steps.forEach((step, stepIndex) => {
          lines.push(`    ${id}_${index}_${stepIndex}[${box(step)}]`);
        });
        lines.push("  end");
      });
      lines.push(`  ${block.tiers.map((_, index) => `${id}_tier${index}`).join(" --> ")}`);
      break;
    default:
      throw new Error(
        `No Mermaid for the "${block.kind}" diagram block; add it to ${import.meta.url}.`,
      );
  }
  return ["```mermaid", ...lines, "```"].join("\n");
}

function diagram(diagramId) {
  const spec = SPECS[diagramId];
  if (!spec) throw new Error(`No diagram spec for ${diagramId}.`);
  const id = diagramId.replaceAll("-", "_");
  return [
    `**Diagram: ${spec.label}**`,
    ...spec.blocks.map((block, index) => mermaid(block, `${id}${index}`)),
    `*${spec.caption}*`,
  ].join("\n\n");
}

export function renderLearnMarkdown(host = "cloudflare") {
  ({
    title: LEARN_TITLE,
    lede: LEARN_LEDE,
    parts: LEARN_PARTS,
    glossary: GLOSSARY,
  } = learnFor(host));
  // Each edition uses its host's default AI platform: Workers AI on Cloudflare, Vertex AI on Google Cloud.
  SPECS = diagramSpecsFor(host);
  const anchor = anchors();
  const out = [];
  const push = (...blocks) => out.push(...blocks.filter((block) => block !== null));

  const sectionHeadings = new Map();
  const partHeading = (part) => `Part ${PART_LESSONS[part.id].number}: ${part.title}`;
  const sectionHeading = (part, index) =>
    `${PART_LESSONS[part.id].number}.${index + 1} ${part.sections[index].title}`;

  // Anchors are assigned in document order, so compute them once up front.
  const toc = [];
  for (const part of LEARN_PARTS) {
    const lesson = PART_LESSONS[part.id];
    const heading = partHeading(part);
    toc.push(
      `- [${heading}](#${anchor(heading)}): ${lesson.tagline} (${part.sections.length} lessons, ${lesson.minutes} min)`,
    );
    part.sections.forEach((section, index) => {
      const text = sectionHeading(part, index);
      const slug = anchor(text);
      sectionHeadings.set(section.id, { text, slug });
      toc.push(`  - [${text}](#${slug})`);
    });
    anchor("Check your understanding");
  }
  toc.push(`- [Glossary](#${anchor("Glossary")})`);
  toc.push(
    `- [Reference: every concept in the code](#${anchor("Reference: every concept in the code")})`,
  );

  push(
    `# ${LEARN_TITLE}`,
    "> Generated from the Learn page's sources in `apps/web/src/learn` by `pnpm learn:export`. Don't edit it by hand: `pnpm learn:check` fails when it's out of date.",
    LEARN_LEDE,
    "## Contents",
    toc.join("\n"),
  );

  for (const part of LEARN_PARTS) {
    const lesson = PART_LESSONS[part.id];
    push(
      `## ${partHeading(part)}`,
      `*${lesson.tagline}* · ${part.sections.length} lessons · ${lesson.minutes} min`,
      part.intro,
      `**You'll be able to**\n\n${lesson.outcomes.map((outcome) => `- ${outcome}`).join("\n")}`,
    );
    part.sections.forEach((section, index) => {
      const sectionLesson = SECTION_LESSONS[section.id];
      push(
        `### ${sectionHeading(part, index)}`,
        `*${section.summary}*`,
        sectionLesson ? diagram(sectionLesson.diagram) : null,
        sectionLesson ? `> **Key idea:** ${sectionLesson.keyIdea}` : null,
        detailsAsHtml(section.body),
        sectionLesson?.tryIt?.length
          ? `**Try it**\n\n${sectionLesson.tryIt
              .map((action) =>
                action.kind === "prompt"
                  ? `- ${action.label}: “${action.prompt}”`
                  : `- ${action.label} (opens the ${action.view} view)`,
              )
              .join("\n")}`
          : null,
        section.inDemo?.length
          ? `**In this demo**\n\n${section.inDemo.map((item) => `- ${item}`).join("\n")}`
          : null,
        section.resources.length
          ? `**Learn more**\n\n${section.resources
              .map((resource) => `- ${resource.kind}: [${resource.label}](${resource.url})`)
              .join("\n")}`
          : null,
      );
    });
    const { check } = lesson;
    push(
      "### Check your understanding",
      check.question,
      check.options.map((option, index) => `${index + 1}. ${option}`).join("\n"),
      `<details><summary>Answer</summary>\n\n**${check.answer + 1}. ${check.options[check.answer]}** ${check.explain}\n\n</details>`,
    );
  }

  push(
    "## Glossary",
    GLOSSARY.map((entry) => `- **${entry.term}**: ${entry.definition}`).join("\n"),
    "## Reference: every concept in the code",
  );
  for (const kind of REFERENCE_KINDS) {
    const entries = LEARN_REFERENCE.filter((entry) => entry.kind === kind);
    push(
      `### ${kind}s (${entries.length})`,
      [
        "| Name | What it is | Taught in |",
        "| --- | --- | --- |",
        ...entries.map((entry) => {
          const section = sectionHeadings.get(entry.section);
          if (!section) throw new Error(`Reference entry ${entry.name} names an unknown section.`);
          return `| \`${entry.name}\` | ${entry.summary.replaceAll("|", "\\|")} | [${section.text}](#${section.slug}) |`;
        }),
      ].join("\n"),
    );
  }
  return `${out.join("\n\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const editions = [
    [LEARN_MARKDOWN, renderLearnMarkdown("cloudflare")],
    [LEARN_MARKDOWN_GOOGLE_CLOUD, renderLearnMarkdown("google-cloud")],
  ];
  if (process.argv.includes("--check")) {
    for (const [path, markdown] of editions) {
      let current = "";
      try {
        current = readFileSync(path, "utf8");
      } catch {}
      if (current !== markdown) {
        console.error(
          `${path} is out of date with the Learn page. Run \`pnpm learn:export\` and commit it.`,
        );
        process.exit(1);
      }
      console.log(`${path} matches the Learn page.`);
    }
  } else {
    for (const [path, markdown] of editions) {
      writeFileSync(path, markdown);
      console.log(`Wrote ${path} (${markdown.split("\n").length} lines).`);
    }
  }
}
