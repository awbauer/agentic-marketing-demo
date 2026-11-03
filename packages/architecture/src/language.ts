// The language checks shared by the services that save content and the red-team probes.

/** A factual statement: a number, a price, a rate or a promise. It needs a cited claim. */
export const FACT = /\d|%|\$|\bapy\b|\bfdic\b|\bwaived?\b|\bfree\b|\bno fees?\b|\bguarantee/i;
/** Absolute promises no claim can support. */
export const ABSOLUTE = /\b(guaranteed?|risk[- ]free|can'?t lose|best returns?)\b/i;

/** Promotional language a pharmaceutical reviewer would reject without head-to-head or label support. */
export const PHARMA_OVERREACH =
  /\b(?:superior|best[- ]in[- ]class|breakthrough|cures?|completely safe|no side effects|better than)\b/i;

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
