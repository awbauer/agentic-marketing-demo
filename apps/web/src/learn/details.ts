/**
 * Collapsible detail in a lesson. The main text says what a reader needs; low-level mechanics,
 * edge cases and file-level detail go in a block the reader opens if they want it:
 *
 *   ::: details How a retry avoids saving twice
 *   Markdown, as long as needed.
 *   :::
 *
 * The page renders each block as a closed <details>; the Markdown export does the same in HTML,
 * which GitHub renders. Blocks don't nest.
 */
export type LessonPart =
  | { kind: "text"; text: string }
  | { kind: "details"; title: string; text: string };

const BLOCK = /^::: details (.+)\n([\s\S]*?)\n:::[ \t]*$/gm;

/** A lesson body split into its text and its collapsible blocks, in order. */
export function lessonParts(body: string): LessonPart[] {
  const parts: LessonPart[] = [];
  let at = 0;
  for (const match of body.matchAll(BLOCK)) {
    const before = body.slice(at, match.index).trim();
    if (before) parts.push({ kind: "text", text: before });
    parts.push({ kind: "details", title: (match[1] ?? "").trim(), text: (match[2] ?? "").trim() });
    at = (match.index ?? 0) + match[0].length;
  }
  const rest = body.slice(at).trim();
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

/** A body with each block as HTML <details>, for the exported Markdown. */
export function detailsAsHtml(body: string): string {
  return lessonParts(body)
    .map((part) =>
      part.kind === "text"
        ? part.text
        : `<details>\n<summary>${part.title}</summary>\n\n${part.text}\n\n</details>`,
    )
    .join("\n\n");
}

/** Blocks the parser would miss: an opening fence with no close, or a stray close. */
export function unclosedDetails(body: string): number {
  const stripped = body.replace(BLOCK, "");
  return (stripped.match(/^::: ?(details)?.*$/gm) ?? []).length;
}
