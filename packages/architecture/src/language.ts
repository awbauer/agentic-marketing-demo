// The language checks shared by the services that save content and the red-team probes.

/** A factual statement: a number, a price, a rate or a promise. It needs a cited claim. */
export const FACT = /\d|%|\$|\bapy\b|\bfdic\b|\bwaived?\b|\bfree\b|\bno fees?\b|\bguarantee/i;
/** Absolute promises no claim can support. */
export const ABSOLUTE = /\b(guaranteed?|risk[- ]free|can'?t lose|best returns?)\b/i;

/** Promotional language a pharmaceutical reviewer would reject without head-to-head or label support. */
export const PHARMA_OVERREACH =
  /\b(?:superior|best[- ]in[- ]class|first[- ]in[- ]class|breakthrough|cures?|completely safe|no side effects|better than)\b/i;

/** Dates and times say when, not what: "on November 10", "2026-11-10", "at 5 pm". */
const WHEN =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi;
/** Phrases that use a fact word without stating a fact. */
const IDIOMS = /\bfeel free\b/gi;

/** Whether the text states a fact that needs a cited claim. Dates and times don't. */
export const statesFact = (text: string) => FACT.test(text.replace(WHEN, "").replace(IDIOMS, ""));

/**
 * Wording that asserts what a product does or how good it is: an outcome, a benefit, a comparison
 * or a reason. The cited claims say those, word for word, so the agent's own sentences may not.
 */
const ASSERTS =
  /\b(?:why|because|prevent\w*|reduc\w*|lower\w*|improv\w*|treat\w*|cure\w*|protect\w*|reliev\w*|relief|effective\w*|efficac\w*|safe|safer|safest|safely|well[- ]tolerated|tolerat\w*|proven|proves?|demonstrat\w*|shows?|showed|shown|confirm\w*|deliver\w*|helps?|helped|works|better|best|fewer|faster|leading|trust\w*|benefits?|meaningful|significant\w*|positive|strong\w*|promising|remarkable|powerful|impressive|impact\w*|underscor\w*|harder|grow\w*|earn\w*|boost\w*)\b/gi;

const GREETING =
  /^(?:hello|hi|hey|dear|greetings|thanks|thank you|good (?:morning|afternoon|evening))\b/i;
const CALL_TO_ACTION =
  /^(?:please\s+)?(?:see|read|review|visit|explore|download|register|join|talk|speak|contact|ask|reply|call|schedule|request|check|watch|reach out|find out more)\b/i;
/** Words that end no sentence: a reader would see "See the" as broken. */
const DANGLING = new Set(
  "a an the of for to in on at with and or your our you this that from about".split(" "),
);
const MAX_SENTENCE_WORDS = 30;
const MAX_HEADLINE_WORDS = 12;

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
/** Sign-offs that use an assertion word without asserting anything. */
const SIGN_OFFS = /\b(?:best regards|best wishes|all the best|with best)\b/gi;
/** The words in a sentence that assert what a product does or how good it is. */
export const assertionWords = (text: string) => asserted(text);
const asserted = (text: string) => [
  ...new Set((text.replace(SIGN_OFFS, "").match(ASSERTS) ?? []).map((word) => word.toLowerCase())),
];

/** A sentence a reader would see as broken: a bare verb ("See"), or one that stops mid-phrase. */
function isFragment(sentence: string) {
  const words = wordsOf(sentence);
  if (GREETING.test(sentence)) return false;
  if (words.length < 2) return true;
  if (CALL_TO_ACTION.test(sentence) && wordsOf(sentence.replace(CALL_TO_ACTION, "")).length === 0)
    return true;
  return DANGLING.has(words.at(-1) ?? "");
}

/**
 * What an agent may write in its own words around the cited claims: natural sentences that greet
 * the reader, set the occasion, say what to do next and sign off. They may name the product, the
 * occasion and its date. They may not assert anything a claim would have to support (an outcome, a
 * benefit, a comparison, a reason, a number), and each must read as a complete sentence.
 */
export function framingShape(text: string): string[] {
  const problems: string[] = [];
  for (const sentence of sentencesOf(text)) {
    const words = wordsOf(sentence);
    const claims = asserted(sentence);
    if (words.length > MAX_SENTENCE_WORDS)
      problems.push(
        `"${sentence}" is too long: keep each sentence to ${MAX_SENTENCE_WORDS} words.`,
      );
    else if (isFragment(sentence))
      problems.push(
        `"${sentence}" is not a complete sentence. Write it as a reader would expect, as in "See the full prescribing information below."`,
      );
    else if (claims.length)
      problems.push(
        `"${sentence}" has wording that could assert something (${claims.join(", ")}): an outcome, a benefit, a comparison or a reason. Set the occasion or say what to do next; the cited claims say what the product does.`,
      );
  }
  return problems;
}

/**
 * A headline (an email's subject) names the occasion and the product. It may not assert anything
 * a claim would have to support.
 */
export function headlineShape(text: string): string[] {
  const problems: string[] = [];
  if (wordsOf(text).length > MAX_HEADLINE_WORDS)
    problems.push(`"${text}" is too long for a headline: keep it to ${MAX_HEADLINE_WORDS} words.`);
  const claims = asserted(text);
  if (claims.length)
    problems.push(
      `"${text}" uses words that could assert something (${claims.join(", ")}). Name the occasion and the product; the cited claims say what it does.`,
    );
  return problems;
}

/**
 * What is wrong with a sentence an agent wrote in its own words (a headline, an opening or a
 * closing). Facts belong in cited claims, so the agent's own words may not state one.
 */
export function framingProblems(text: string, brand?: string): string[] {
  const problems: string[] = [];
  if (statesFact(text))
    problems.push(
      `"${text}" states a fact (a number, price, rate or promise). Facts may only come from a cited claim; dates are fine.`,
    );
  if (ABSOLUTE.test(text)) problems.push(`"${text}" makes an absolute promise.`);
  if (/\b(?:vs\.?|versus|compared (?:with|to)|than)\b/i.test(text))
    problems.push(`"${text}" makes a comparison, which only a cited claim can make.`);
  if (/urn:|【|\[\d+\]/.test(text))
    problems.push(
      `"${text}" carries a citation; cited text is inserted for you, so write plain words.`,
    );
  if (brand === "Lumera Therapeutics" && PHARMA_OVERREACH.test(text))
    problems.push(`"${text}" uses superiority or absolute-safety language.`);
  return problems;
}
