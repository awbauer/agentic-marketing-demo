import { z } from "zod";
import {
  currentFocusVersion,
  FOCUS_KIND_LABELS,
  type FocusItem,
  FocusKindSchema,
  type WorkingSet,
} from "../../../packages/contracts/src/index.ts";

/**
 * The workspace focus: the draft the chat is building. The orchestrator saves each draft the
 * model writes as structured data with every version kept, so revisions, references to the
 * draft, and confirmed saves all act on the same object. Saving changes only the workspace.
 */

export const MAX_FOCUS_VERSIONS = 20;

export const FocusInputSchema = z.object({
  kind: FocusKindSchema.describe(
    "What is being drafted: push-message, email, brief, campaign, or content",
  ),
  title: z.string().min(1).max(160).describe("Short name for the draft"),
  summary: z.string().max(600).describe("One or two sentences on what it is and why"),
  fields: z
    .array(
      z.object({
        label: z.string().min(1).max(60).describe("Field name, such as Headline or Send time"),
        value: z.string().min(1).max(1200).describe("Field content"),
      }),
    )
    .min(1)
    .max(16)
    .describe("The draft itself as labeled fields"),
  changeNote: z
    .string()
    .max(240)
    .describe("For a revision, what changed; for a first draft, where it came from"),
});
export type FocusInput = z.infer<typeof FocusInputSchema>;

/**
 * Saves a draft as the focus. A draft of the same kind becomes the next version; a different
 * kind starts a new focus. Up to 20 versions are kept.
 */
export function applyFocusUpdate(
  set: WorkingSet,
  input: FocusInput,
  at: Date,
  id: () => string = () => crypto.randomUUID(),
): WorkingSet {
  const basedOn = set.cards.slice(0, 6).map((card) => card.id);
  const same = set.focus && set.focus.kind === input.kind ? set.focus : null;
  const version = {
    version: same ? Math.max(...same.versions.map((entry) => entry.version)) + 1 : 1,
    title: input.title.trim(),
    summary: input.summary.trim(),
    fields: input.fields.map((field) => ({ label: field.label.trim(), value: field.value.trim() })),
    changeNote: input.changeNote.trim() || (same ? "Revised" : "First draft"),
    basedOn,
    createdAt: at.toISOString(),
  };
  const focus: FocusItem = same
    ? {
        ...same,
        current: version.version,
        versions: [...same.versions, version].slice(-MAX_FOCUS_VERSIONS),
      }
    : { id: id(), kind: input.kind, current: 1, versions: [version] };
  return { ...set, startedAt: set.startedAt ?? at.toISOString(), focus };
}

/** Prompt lines describing the focus: the draft that revisions and saves apply to. */
export function focusPrompt(focus: FocusItem | null) {
  if (!focus) return "";
  const current = currentFocusVersion(focus);
  const fields = current.fields.map((field) => `${field.label}: ${field.value}`).join(" | ");
  const saved = focus.saved?.objectType === "Brief" ? focus.saved : undefined;
  const marketing = saved
    ? ` Saved in Marketing Cloud as Brief ${saved.recordId} (version ${saved.version}) with a ${saved.preview?.length ?? 0}-step campaign preview${saved.campaign ? `; campaign ${saved.campaign.id} "${saved.campaign.name}" and its flow were created` : "; the campaign isn't created yet"}.`
    : "";
  return `Current focus (the draft the user is working on; revisions, references to the draft, and saves apply to it): ${FOCUS_KIND_LABELS[focus.kind]} "${current.title}" (version ${current.version}). ${current.summary} Fields: ${fields}.${marketing}`;
}

const LABEL_LINE =
  /^\s*(?:[-*•]\s*)?(?:\*\*|__)([^*_:\n]{1,60}?):?(?:\*\*|__):?\s*(.+?)\s*$|^\s*(?:[-*•]\s*)?([A-Z][\w /&'()-]{0,40}):\s+(.+?)\s*$/;
const stripMarkdown = (text: string) =>
  text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/, "")
    .split("\n")
    .map((part) => part.trim())
    .join("\n")
    .trim();

/**
 * A label on a line of its own, whose value follows on the next lines: "Body:", "**Headline**",
 * "### Ruled out". At most five words, so a sentence isn't mistaken for one.
 */
const LABEL_ONLY =
  /^\s*(?:#{2,4}\s+)?(?:(?:\*\*|__)([A-Z][\w /&'()-]{0,40}?):?(?:\*\*|__):?|([A-Z][\w /&'()-]{0,40}?):)\s*$/;
/** The parts of a draft a label names. A bold line or heading without a colon is a label only if
 * it is one of these; otherwise it's the title or a section of prose. */
const FIELD_NAMES =
  /^(?:headline|subject(?: line)?|preheader|body|copy|cta|call to action|send time|audience|channel|campaign|brand|ruled[- ]out|disclosures?|safety information|key message|description|name|goal|primary goal|kpi|priority|guardrails|offer|images?|assets?|claims? used|evidence)$/i;
const isLabelOnly = (line: string) => {
  const colon = /:\s*(?:\*\*|__)?\s*$/.test(line);
  const match =
    LABEL_ONLY.exec(line) ?? (/^#{2,4}\s+\S/.test(line) ? [line, stripMarkdown(line)] : null);
  const label = match ? stripMarkdown(match[1] ?? match[2] ?? "").replace(/:$/, "") : "";
  if (!label || label.split(/\s+/).length > 5) return "";
  return colon || FIELD_NAMES.test(label) ? label : "";
};
/** A Markdown table row's cells, read as plain text. */
const cellsOf = (line: string) =>
  line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => stripMarkdown(cell));
const isDivider = (line: string) =>
  line.startsWith("|") && cellsOf(line).every((cell) => /^:?-{2,}:?$/.test(cell) || cell === "");
/** A Markdown table row as readable text; the header's divider row reads as nothing. */
const tableRow = (line: string) => {
  const cells = line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => stripMarkdown(cell));
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === "")) return "";
  return cells.filter(Boolean).join(" — ");
};

/**
 * The draft in a model answer as focus input: its title (a heading or a bold first line), a
 * summary (its first plain paragraph), and its labeled parts as fields. A label may carry its value
 * on the same line ("**Headline:** …") or head the lines below it ("Body:" then bullets), and a
 * table reads as one line per row. The orchestrator saves drafts this way, so a drafting turn never
 * depends on the model producing a large structured tool call.
 */
export function focusFromAnswer(
  answer: string,
  options: { kind: FocusInput["kind"]; fallbackTitle: string; changeNote: string },
): FocusInput | null {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const titleLine = lines.find(
    (line) => (/^#{1,4}\s+\S/.test(line) || /^(\*\*|__)[^*_]+\1$/.test(line)) && !isLabelOnly(line),
  );
  const title = titleLine ? stripMarkdown(titleLine).replace(/[.:]+$/, "") : options.fallbackTitle;
  const fields: FocusInput["fields"] = [];
  const seen = new Map<string, number>();
  const prose: string[] = [];
  let open: { label: string; lines: string[] } | null = null;
  const add = (label: string, value: string) => {
    if (!label || !value || fields.length >= 16) return;
    const count = (seen.get(label.toLowerCase()) ?? 0) + 1;
    seen.set(label.toLowerCase(), count);
    fields.push({
      label: (count > 1 ? `${label} ${count}` : label).slice(0, 60),
      value: value.slice(0, 1200),
    });
  };
  const close = () => {
    if (open) add(open.label, open.lines.join("\n"));
    open = null;
  };
  let table: { header: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    if (line === titleLine) continue;
    if (!line.startsWith("|")) table = null;
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      close();
      continue;
    }
    const match = LABEL_LINE.exec(line);
    const label = match ? stripMarkdown(match[1] ?? match[3] ?? "") : "";
    const value = match ? stripMarkdown(match[2] ?? match[4] ?? "") : "";
    if (label && value) {
      close();
      add(label, value);
      continue;
    }
    const heading = isLabelOnly(line);
    if (heading) {
      close();
      open = { label: heading, lines: [] };
      continue;
    }
    // A table outside any label: a header row (the line before its divider), then its rows. With
    // two columns each row is a field ("| Subject | … |"); a wider table becomes one field.
    if (!open && line.startsWith("|")) {
      if (isDivider(line)) continue;
      if (isDivider(lines[index + 1] ?? "")) {
        table = { header: cellsOf(line) };
        if (table.header.filter(Boolean).length > 2)
          open = { label: table.header[0] || "Table", lines: [] };
        continue;
      }
      const cells = cellsOf(line);
      if ((table?.header.length ?? cells.length) <= 2 && cells.length >= 2 && cells[0]) {
        add(cells[0], cells.slice(1).join(" — "));
        continue;
      }
    }
    if (open) {
      const text = line.startsWith("|")
        ? tableRow(line)
        : stripMarkdown(line.replace(/^(?:[-*•]|\d+[.)])\s+/, "• "));
      if (text) open.lines.push(text);
      continue;
    }
    // The summary is the prose before the draft's fields, not a note after them.
    if (!fields.length && !/^[-*•|#]/.test(line) && !/^\d+[.)]/.test(line))
      prose.push(stripMarkdown(line));
  }
  close();
  if (!fields.length) {
    const body = lines
      .filter((line) => line !== titleLine)
      .map(stripMarkdown)
      .join("\n")
      .slice(0, 1200);
    if (!body) return null;
    fields.push({ label: "Draft", value: body });
  }
  return {
    kind: options.kind,
    title: title.slice(0, 160) || options.fallbackTitle,
    summary: (prose[0] ?? "").slice(0, 600),
    fields,
    changeNote: options.changeNote.slice(0, 240),
  };
}
