// The Learn gate: keeps the Learn page in step with the code, so it neither drifts nor misses
// new concepts. Usage: pnpm learn:check
//
// 1. Reference coverage: every tool, write action, graph node and relationship type, operator
//    control, and Salesforce component in the code has a Learn reference entry, and no entry
//    names something that no longer exists.
// 2. Source map: every code file is mapped to the Learn section that teaches it (or listed as
//    untaught, with a reason), every mapped path exists, and "Where to see it" paths exist.
// 3. Drift: when this branch changes code a section explains, that section (its text, lesson, or
//    reference entries) must change too, unless a commit carries a trailer such as
//    `Learn-Reviewed: routing, workspace (the change doesn't alter what a reader learns)`.
//    The branch is compared with its merge base on LEARN_BASE_REF, the PR base, or origin/main.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LEARN_PARTS } from "../apps/web/src/learn/content.ts";
import { SECTION_LESSONS } from "../apps/web/src/learn/lessons.ts";
import { LEARN_REFERENCE, REFERENCE_KINDS } from "../apps/web/src/learn/reference.ts";
import {
  DRIFT_IGNORED,
  SECTION_SOURCES,
  TAUGHT_ROOTS,
  UNTAUGHT_SOURCES,
} from "../apps/web/src/learn/sources.ts";
import { AGENT_TOOL_NAMES } from "../packages/architecture/src/flows.ts";
import { ConfirmationSchema, ORCHESTRATOR_TOOLS } from "../packages/contracts/src/index.ts";
import {
  buildDataset,
  MEMORY_LABELS,
  MEMORY_RELATIONSHIPS,
} from "../packages/knowledge-graph/src/index.ts";
import { report } from "./lib/report.mjs";

const LEARN_FILES = [
  "apps/web/src/learn/content.ts",
  "apps/web/src/learn/lessons.ts",
  "apps/web/src/learn/reference.ts",
];
const SALESFORCE = "salesforce/force-app/main/default";
const failures = [];
const notices = [];
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = (text) => text.split("\n").filter(Boolean);

// 1. Reference coverage -------------------------------------------------------------------------

function operatorControls() {
  const source = readFileSync("packages/contracts/src/index.ts", "utf8");
  const signature = source.match(/export function parseOperationControls\(env: \{([^}]*)\}/);
  return [...(signature?.[1] ?? "").matchAll(/([A-Z][A-Z_]+)\?:/g)].map((match) => match[1]);
}

function salesforceComponents() {
  const classes = lines(git("ls-files", `${SALESFORCE}/classes`))
    .filter((path) => path.endsWith(".cls") && !path.endsWith("Test.cls"))
    .map((path) =>
      path
        .split("/")
        .at(-1)
        .replace(/\.cls$/, ""),
    );
  const objects = lines(git("ls-files", `${SALESFORCE}/objects`))
    .map((path) => path.split("/")[5])
    .filter((name) => name?.endsWith("__c"));
  return [...new Set([...classes, ...objects])];
}

const dataset = buildDataset();
const inventory = {
  Tool: [...ORCHESTRATOR_TOOLS, ...AGENT_TOOL_NAMES],
  "Write action": [...ConfirmationSchema.shape.action.options],
  "Graph node": [...new Set(dataset.nodes.map((node) => node.label)), ...MEMORY_LABELS],
  "Graph relationship": [
    ...new Set(dataset.relationships.map((relationship) => relationship.type)),
    ...MEMORY_RELATIONSHIPS,
  ],
  "Operator control": operatorControls(),
  "Salesforce component": salesforceComponents(),
};

const sections = LEARN_PARTS.flatMap((part) => part.sections);
const sectionIds = new Set(sections.map((section) => section.id));
const seen = new Set();
for (const entry of LEARN_REFERENCE) {
  const key = `${entry.kind}:${entry.name}`;
  if (seen.has(key)) failures.push(`Reference: ${entry.kind} ${entry.name} is listed twice.`);
  seen.add(key);
  if (!sectionIds.has(entry.section))
    failures.push(
      `Reference: ${entry.kind} ${entry.name} points to unknown section "${entry.section}".`,
    );
  if (entry.summary.trim().length < 20)
    failures.push(`Reference: ${entry.kind} ${entry.name} needs a one-sentence summary.`);
}
for (const kind of REFERENCE_KINDS) {
  const expected = new Set(inventory[kind]);
  const listed = new Set(LEARN_REFERENCE.filter((e) => e.kind === kind).map((e) => e.name));
  for (const name of expected)
    if (!listed.has(name))
      failures.push(
        `New concept: ${kind} "${name}" has no Learn reference entry. Add one to apps/web/src/learn/reference.ts, pointing at the section that teaches it, and teach it there.`,
      );
  for (const name of listed)
    if (!expected.has(name))
      failures.push(
        `Stale reference: ${kind} "${name}" no longer exists in the code. Remove or rename its entry in apps/web/src/learn/reference.ts and update the sections that mention it.`,
      );
}

// 2. Source map ----------------------------------------------------------------------------------

const matches = (path, prefix) =>
  prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
const untracked = lines(git("ls-files", "--others", "--exclude-standard"));
const files = [...new Set([...lines(git("ls-files")), ...untracked])].filter((path) =>
  existsSync(path),
);

for (const id of sectionIds)
  if (!(id in SECTION_SOURCES))
    failures.push(`Source map: section "${id}" is missing from apps/web/src/learn/sources.ts.`);
for (const [id, prefixes] of Object.entries(SECTION_SOURCES)) {
  if (!sectionIds.has(id)) failures.push(`Source map: "${id}" is not a Learn section.`);
  for (const prefix of prefixes)
    if (!files.some((path) => matches(path, prefix)))
      failures.push(`Source map: "${prefix}" (section ${id}) matches no file. Update the map.`);
}
for (const { path } of UNTAUGHT_SOURCES)
  if (!files.some((file) => matches(file, path)))
    failures.push(`Source map: untaught path "${path}" matches no file. Remove it.`);

const mapped = (path) =>
  Object.values(SECTION_SOURCES).some((prefixes) => prefixes.some((p) => matches(path, p))) ||
  UNTAUGHT_SOURCES.some((entry) => matches(path, entry.path));
const ignored = (path) => DRIFT_IGNORED.some((pattern) => pattern.test(path));
for (const path of files)
  if (
    TAUGHT_ROOTS.some((root) => path.startsWith(root)) &&
    /\.(?:ts|tsx|mjs|cls)$/.test(path) &&
    !ignored(path) &&
    !mapped(path)
  )
    failures.push(
      `New code: ${path} isn't mapped to a Learn section. Add it to SECTION_SOURCES in apps/web/src/learn/sources.ts (and teach it in that section), or to UNTAUGHT_SOURCES with a reason.`,
    );

const PATH_REFERENCE = /\b(?:apps|packages|scripts|salesforce|docs|infra)\/[\w./-]*[\w/]/g;
for (const section of sections)
  for (const line of section.inDemo ?? [])
    for (const reference of line.match(PATH_REFERENCE) ?? [])
      if (!files.some((path) => path === reference || path.startsWith(reference)))
        failures.push(
          `Learn section "${section.id}" points to ${reference} under "Where to see it", which doesn't exist.`,
        );

// 3. Drift ---------------------------------------------------------------------------------------

const fingerprint = (content, lessons, reference, id) =>
  JSON.stringify({
    section: content.flatMap((part) => part.sections).find((section) => section.id === id) ?? null,
    lesson: lessons[id] ?? null,
    reference: reference.filter((entry) => entry.section === id),
  });

async function baseLearn(mergeBase) {
  const dir = mkdtempSync(join(tmpdir(), "learn-base-"));
  try {
    for (const path of LEARN_FILES) {
      let source = "";
      try {
        source = git("show", `${mergeBase}:${path}`);
      } catch {
        // The file is new on this branch.
      }
      writeFileSync(join(dir, path.split("/").at(-1)), source || "export {};\n");
    }
    const load = (name) => import(pathToFileURL(join(dir, name)).href);
    const [content, lessons, reference] = await Promise.all(
      ["content.ts", "lessons.ts", "reference.ts"].map(load),
    );
    return {
      content: content.LEARN_PARTS ?? [],
      lessons: lessons.SECTION_LESSONS ?? {},
      reference: reference.LEARN_REFERENCE ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function reviewed(mergeBase) {
  const messages = [
    git("log", "--format=%B", `${mergeBase}..HEAD`),
    process.env.LEARN_REVIEWED ?? "",
  ]
    .join("\n")
    .split("\n");
  const ids = new Set();
  for (const line of messages) {
    const trailer = line.match(/^\s*Learn-Reviewed:\s*([^()]+?)\s*\((.+)\)\s*$/i);
    if (!trailer) {
      if (/^\s*Learn-Reviewed:/i.test(line))
        failures.push(`"${line.trim()}" needs a reason: Learn-Reviewed: <section ids> (<why>).`);
      continue;
    }
    for (const id of trailer[1].split(/[\s,]+/).filter(Boolean)) ids.add(id);
  }
  return ids;
}

const baseRef =
  process.env.LEARN_BASE_REF ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
let mergeBase = null;
try {
  mergeBase = git("merge-base", baseRef, "HEAD");
} catch {
  notices.push(`No merge base with ${baseRef}; skipped the drift check. Fetch it to enable.`);
}

const drift = [];
if (mergeBase) {
  const changed = [
    ...new Set([...lines(git("diff", "--name-only", mergeBase)), ...untracked]),
  ].filter((path) => !ignored(path) && !path.startsWith("apps/web/src/learn/"));
  const affected = new Map();
  for (const path of changed)
    for (const [id, prefixes] of Object.entries(SECTION_SOURCES))
      if (prefixes.some((prefix) => matches(path, prefix)))
        affected.set(id, [...(affected.get(id) ?? []), path]);
  if (affected.size) {
    const base = await baseLearn(mergeBase);
    const covered = reviewed(mergeBase);
    for (const [id, paths] of affected) {
      const before = fingerprint(base.content, base.lessons, base.reference, id);
      const after = fingerprint(LEARN_PARTS, SECTION_LESSONS, LEARN_REFERENCE, id);
      const status =
        before !== after ? "updated" : covered.has(id) || covered.has("all") ? "reviewed" : "stale";
      drift.push({ section: id, status, paths });
    }
  }
  const stale = drift.filter((item) => item.status === "stale");
  if (stale.length)
    failures.push(
      [
        "Learn drift: this branch changes code that these Learn sections explain, but the sections didn't change:",
        ...stale.map(
          (item) =>
            `  • ${item.section} (“${sections.find((s) => s.id === item.section)?.title}”) ← ${item.paths.join(", ")}`,
        ),
        "Update each section in apps/web/src/learn/content.ts (or its lesson or reference entries) so it teaches the change.",
        "If nothing a reader learns has changed, say so in a commit trailer:",
        `  Learn-Reviewed: ${stale.map((item) => item.section).join(", ")} (why no Learn update is needed)`,
      ].join("\n"),
    );
}

await report("learn", {
  status: failures.length ? "failed" : "passed",
  baseRef,
  mergeBase,
  inventory: Object.fromEntries(
    Object.entries(inventory).map(([kind, names]) => [kind, names.length]),
  ),
  drift,
  notices,
  failures,
});
for (const notice of notices) console.log(`Notice: ${notice}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
const counted = Object.values(inventory).reduce((sum, names) => sum + names.length, 0);
console.log(
  `Learn gate passed: ${counted} concepts have reference entries; ${drift.length} affected sections (${drift.filter((item) => item.status === "updated").length} updated, ${drift.filter((item) => item.status === "reviewed").length} reviewed).`,
);
