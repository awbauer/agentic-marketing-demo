// The language checks shared by the services that save content and the red-team probes.

/** A factual statement: a number, a price, a rate or a promise. It needs a cited claim. */
export const FACT = /\d|%|\$|\bapy\b|\bfdic\b|\bwaived?\b|\bfree\b|\bno fees?\b|\bguarantee/i;
/** Absolute promises no claim can support. */
export const ABSOLUTE = /\b(guaranteed?|risk[- ]free|can'?t lose|best returns?)\b/i;

/** Promotional language a pharmaceutical reviewer would reject without head-to-head or label support. */
export const PHARMA_OVERREACH =
  /\b(?:superior|best[- ]in[- ]class|breakthrough|cures?|completely safe|no side effects|better than)\b/i;

/** Words that connect a headline without stating anything. */
const PLAIN_WORDS = new Set(
  "a an the of for to in on at with and or your our you new update updates note from about news this that week today now".split(
    " ",
  ),
);

/** Wording that makes or implies a claim; no short framing sentence may use it. */
const IMPLIES_A_CLAIM =
  /\b(?:how|why|that|which|because|prevent\w*|reduc\w*|lower\w*|improv\w*|treat\w*|cure\w*|protect\w*|reliev\w*|effective|safe\w*|proven|better|best|more|less|fewer|faster|only|first|leading|trusted|results?|outcomes?|benefits?|evidence|data|studies|study|trial)\b/i;
const GREETING = /^(?:hello|hi|hey|dear|greetings|good (?:morning|afternoon|evening))\b/i;
const CALL_TO_ACTION =
  /^(?:please\s+)?(?:see|read|review|visit|explore|download|register|join|talk|speak|contact|ask|reply|call|schedule|request|check|watch|reach out|find out more)\b/i;
const MAX_FRAMING_WORDS = 14;

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * What an agent may put in its own words next to cited claims: a greeting or a short call to
 * action, and nothing else. Anything that could assert something is refused by shape, not by
 * hunting for known bad words: the sentence must be one of those two kinds, short, free of
 * clauses, outcome words and comparisons, and must not name the product or brand.
 */
export function framingShape(text: string, avoid: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/).filter((part) => part.trim())) {
    const trimmed = sentence.trim();
    const words = wordsOf(trimmed);
    const named = words.filter((word) => avoid.has(word));
    if (!GREETING.test(trimmed) && !CALL_TO_ACTION.test(trimmed))
      problems.push(
        `"${trimmed}" is neither a greeting ("Hello ...") nor a call to action ("See the full prescribing information below."). Your own words may only be one of those; the cited claims say everything else.`,
      );
    else if (words.length > MAX_FRAMING_WORDS)
      problems.push(`"${trimmed}" is too long: keep each sentence to ${MAX_FRAMING_WORDS} words.`);
    else if (IMPLIES_A_CLAIM.test(trimmed))
      problems.push(
        `"${trimmed}" has wording that could assert something (an outcome, benefit, comparison or reason). Keep greetings and calls to action plain.`,
      );
    else if (named.length)
      problems.push(
        `"${trimmed}" names the product or brand (${[...new Set(named)].join(", ")}). Do not name it in your own words; the claims do.`,
      );
  }
  return problems;
}

/**
 * A headline is a label, not a sentence. It may reuse the words of the plan wave's theme, the
 * product and brand names, and plain connecting words, so it can't introduce a statement.
 */
export function headlineShape(text: string, allowed: ReadonlySet<string>): string[] {
  const words = wordsOf(text);
  const outside = words.filter((word) => !allowed.has(word) && !PLAIN_WORDS.has(word));
  const problems: string[] = [];
  if (words.length > 10)
    problems.push(`"${text}" is too long for a headline: keep it to 10 words.`);
  if (outside.length)
    problems.push(
      `"${text}" uses words that could assert something (${[...new Set(outside)].join(", ")}). A headline may only reuse the words of the wave's theme, the product name, and plain connecting words such as "for", "your" and "update".`,
    );
  return problems;
}

/**
 * What is wrong with a sentence an agent wrote in its own words (a headline, an opening or a call
 * to action). Facts belong in cited claims, so the agent's own words may not state one.
 */
export function framingProblems(text: string, brand?: string): string[] {
  const problems: string[] = [];
  if (FACT.test(text))
    problems.push(
      `"${text}" states a fact (a number, price, rate or promise). Facts may only come from a cited claim.`,
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
