// The judge panel: cross-family Workers AI models rate each answer against the scenario rubric on
// anchored 1-5 scales. A model never judges its own family, and each judge sees the tool evidence
// so it can catch invented facts.
import { generateText } from "ai";
import { z } from "zod";
import { turnCost } from "../../packages/evals/src/pricing.ts";
import {
  DIMENSION_META,
  dimensionMeans,
  QUALITY_DIMENSIONS,
  qualityIndex,
} from "../../packages/evals/src/quality.ts";
import { scenarioRubrics } from "../../packages/evals/src/rubric.ts";

export const JUDGES = [
  { id: "@cf/zai-org/glm-5.3", label: "GLM-5.3", family: "zai" },
  // DeepSeek V4 Pro was retired on 2026-11-20; V4.1 Flash keeps a DeepSeek-family judge.
  {
    id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    label: "DeepSeek V4.1 Flash",
    family: "deepseek",
  },
];

const EVIDENCE_LIMIT = 1500;

/** Judges whose family differs from the contestant's, so no model scores its own kind. */
export const judgesFor = (contestantFamily) =>
  JUDGES.filter((judge) => judge.family !== contestantFamily);

const VerdictSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  evidence: z.record(z.string(), z.string()).default({}),
  rationale: z.string().default(""),
});

/** The dimensions a scenario is judged on: its weighted ones, and only actionIntent with a persona. */
export function scenarioDimensions(caseId) {
  const rubric = scenarioRubrics[caseId];
  if (!rubric) return [];
  return QUALITY_DIMENSIONS.filter(
    (dimension) =>
      (rubric.weights[dimension] ?? 0) > 0 && (dimension !== "actionIntent" || rubric.persona),
  );
}

export function judgePrompt({ caseId, prompt, answer, trace }) {
  const rubric = scenarioRubrics[caseId];
  const dimensions = scenarioDimensions(caseId);
  const scales = dimensions
    .map((dimension) => {
      const meta = DIMENSION_META[dimension];
      const anchors = meta.anchors.map((text, index) => `  ${index + 1} = ${text}`).join("\n");
      return `- ${dimension}: ${meta.question}\n${anchors}`;
    })
    .join("\n");
  const evidence = trace.length
    ? trace
        .map(
          (item) =>
            `[${item.name}] request: ${item.request.slice(0, 300)}\nresult: ${item.output.slice(0, EVIDENCE_LIMIT)}`,
        )
        .join("\n\n")
    : "(no tools were called)";
  return `You are a strict, calibrated evaluator of an AI marketing assistant. Score only what is on the page; do not reward length or confident tone.

Scenario goal: ${rubric.goal}
${rubric.persona ? `Audience persona (answer "actionIntent" as this person would): ${rubric.persona}\n` : ""}User request: ${prompt}

Tool evidence (the only facts that are true):
${evidence}

Assistant answer to score:
"""
${answer}
"""

Score each dimension as an integer from 1 to 5 using these anchors. Use the full range; 3 is average, and 5 is rare.
${scales}

Return only one JSON object, no other text:
{"scores":{${dimensions.map((d) => `"${d}":<1-5>`).join(",")}},"evidence":{"<dimension>":"<a quote of at most 20 words from the answer that justifies the score>"},"rationale":"<two sentences at most>"}`;
}

function parseVerdict(text, dimensions) {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("no JSON object in judge output");
  const verdict = VerdictSchema.parse(JSON.parse(json));
  const missing = dimensions.filter((dimension) => verdict.scores[dimension] === undefined);
  if (missing.length) throw new Error(`missing scores: ${missing.join(", ")}`);
  // Keep only requested dimensions, so a judge cannot add its own.
  return {
    scores: Object.fromEntries(dimensions.map((d) => [d, verdict.scores[d]])),
    evidence: Object.fromEntries(
      Object.entries(verdict.evidence)
        .filter(([key]) => dimensions.includes(key))
        .map(([key, value]) => [key, String(value).slice(0, 200)]),
    ),
    rationale: verdict.rationale.slice(0, 400),
  };
}

/** One judge's verdict on one answer, retried once on unparseable output. Returns the verdict and its cost. */
export async function judgeOnce(provider, judge, input) {
  const dimensions = scenarioDimensions(input.caseId);
  const prompt = judgePrompt(input);
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model: provider(judge.id),
        prompt: attempt
          ? `${prompt}\n\nYour previous reply was not valid JSON (${lastError}). Reply with the JSON object only.`
          : prompt,
        temperature: 0,
        // Both judges are reasoning models: at default effort they spend the whole budget thinking
        // and return no text. Low effort gives the same scores in a fraction of the tokens.
        providerOptions: { "workers-ai": { reasoning_effort: "low" } },
        maxOutputTokens: 3000,
      });
      usage.inputTokens += result.usage.inputTokens ?? 0;
      usage.outputTokens += result.usage.outputTokens ?? 0;
      usage.cachedInputTokens += result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
      return {
        verdict: { model: judge.id, ...parseVerdict(result.text, dimensions) },
        cost: turnCost(judge.id, usage),
      };
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error).slice(0, 120);
    }
  }
  return {
    error: lastError,
    cost: usage.inputTokens ? turnCost(judge.id, usage) : { usd: 0, neurons: 0 },
  };
}

/** Every eligible judge on one answer, in parallel. */
export async function judgeAnswer(provider, contestantFamily, input) {
  const outcomes = await Promise.all(
    judgesFor(contestantFamily).map((judge) => judgeOnce(provider, judge, input)),
  );
  return {
    judges: outcomes.flatMap((outcome) => (outcome.verdict ? [outcome.verdict] : [])),
    errors: outcomes.flatMap((outcome) => (outcome.error ? [outcome.error] : [])),
    costs: outcomes.map((outcome) => outcome.cost),
  };
}

/** The `quality` block stored on a result: verdicts, per-dimension means, and the weighted index. */
export function buildQuality(caseId, { judges, errors }) {
  const means = dimensionMeans(judges);
  const weights = scenarioRubrics[caseId].weights;
  if (!judges.length)
    return {
      judges: [],
      dimensionMeans: {},
      index: 0,
      judgeError: (errors[0] ?? "no judge available").slice(0, 240),
    };
  return { judges, dimensionMeans: means, index: qualityIndex(means, weights) };
}
