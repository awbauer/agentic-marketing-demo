import { assertionWords, type Brand, framingProblems, statesFact } from "@northstar/architecture";
import type { DraftReview, FocusVersion, WorkingSet } from "@northstar/contracts";

// A chat draft checked the way Journeys checks a module: every sentence that states a fact or
// asserts what the product does must be an approved claim's exact text. The approved claims are
// the ones the claims check in this chat found usable; with no claims check, there is nothing to
// check against and the draft carries no review.

/** Fields that carry required legal text, identifiers or logistics, not the draft's own claims. */
const UNCHECKED_FIELDS =
  /safety|disclosure|isi|prescribing information|mlr|approval|ruled[- ]out|asset|send time|schedule|audience|channel|campaign|brand|priority|kpi/i;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/[‐-―-]/g, " ")
    .replace(/[^a-z0-9%. ]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/\.$/, ""))
    .filter(Boolean);
const normal = (text: string) => words(text).join(" ");

/** The share of a claim's words a sentence repeats. */
function overlap(sentence: string, claim: string) {
  const mine = new Set(words(sentence));
  const theirs = words(claim);
  return theirs.length ? theirs.filter((word) => mine.has(word)).length / theirs.length : 0;
}

const sentencesOf = (value: string) =>
  value
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.replace(/^[•\-*]\s*/, "").trim())
    .filter((part) => part.length > 3);

/** The claims the chat's claims check marked usable, and those it blocked, by their exact text. */
export function checkedClaims(set: WorkingSet) {
  const items = set.cards
    .filter((card) => card.toolName === "check_clinical_claims")
    .flatMap((card) => card.items ?? []);
  return {
    approved: items.filter((item) => item.status === "ok").map((item) => item.title),
    blocked: items.filter((item) => item.status !== "ok").map((item) => item.title),
  };
}

/** The draft's review, or undefined when no claims were checked in this chat. */
export function reviewDraft(
  version: Pick<FocusVersion, "title" | "fields">,
  set: WorkingSet,
  brand?: Brand,
): DraftReview | undefined {
  const { approved, blocked } = checkedClaims(set);
  if (!approved.length && !blocked.length) return undefined;
  const used = new Set<string>();
  const issues: DraftReview["issues"] = [];
  const fields = [
    { label: "Title", value: version.title },
    ...version.fields.filter((field) => !UNCHECKED_FIELDS.test(field.label)),
  ];
  for (const field of fields)
    for (const sentence of sentencesOf(field.value)) {
      const exact = approved.find((claim) => normal(sentence).includes(normal(claim)));
      if (exact) {
        used.add(exact);
        continue;
      }
      const flag = (reason: string) =>
        issues.length < 20 && issues.push({ field: field.label, text: sentence, reason });
      const nearBlocked = blocked.find((claim) => overlap(sentence, claim) >= 0.6);
      if (nearBlocked) {
        flag(`Says what the blocked claim “${nearBlocked}” says; it can't be used.`);
        continue;
      }
      // A third of a claim's words, with an assertion or a fact, is a rewording of it.
      const near = approved.find((claim) => overlap(sentence, claim) >= 0.34);
      const asserts = assertionWords(sentence);
      const problems = [
        ...framingProblems(sentence, brand),
        ...(statesFact(sentence) ? ["states a fact"] : []),
      ];
      if (near && (asserts.length || problems.length)) {
        flag(`Rewords the approved claim “${near}”. Use its exact text.`);
        continue;
      }
      if (asserts.length)
        flag(
          `Asserts what the product does (${asserts.join(", ")}) in words no approved claim uses.`,
        );
      else if (problems.length)
        flag("States a fact, number or comparison that isn't an approved claim's text.");
    }
  return { approvedUsed: [...used].slice(0, 12), issues };
}

/** The working set with the review attached to the focus's current version. */
export function withDraftReview(set: WorkingSet, brand?: Brand): WorkingSet {
  const focus = set.focus;
  if (!focus) return set;
  return {
    ...set,
    focus: {
      ...focus,
      versions: focus.versions.map((version) => {
        if (version.version !== focus.current) return version;
        const review = reviewDraft(version, set, brand);
        const { review: _previous, ...rest } = version;
        return review ? { ...rest, review } : rest;
      }),
    },
  };
}

/** Why a draft can't be saved yet, or null when it can. */
export function reviewBlocker(set: WorkingSet) {
  const focus = set.focus;
  const version = focus?.versions.find((entry) => entry.version === focus.current);
  const issues = version?.review?.issues ?? [];
  if (!issues.length) return null;
  return `${issues.length} sentence${issues.length === 1 ? "" : "s"} in this draft ${issues.length === 1 ? "isn't" : "aren't"} approved claim text: ${issues
    .slice(0, 3)
    .map((issue) => `“${issue.text}” (${issue.reason})`)
    .join("; ")}. Revise the draft to use the approved claims word for word, then save it.`;
}
