// Evals for the campaign squad. Every run gets a scorecard: checks computed from the run's own
// events (did it reach an outcome, how often the rules refused work, how well the plan fits the
// budget and the audience, how the agents coordinated, how the people's rounds went, what it cost),
// plus a quality judge's rubric scores for the proposal. The same judge model scores every
// provider's runs, so runs on Workers AI, Anthropic and OpenAI can be compared fairly.
import type { CampaignBrief, CampaignStrategy, TeamEvent, TeamProvider } from "./team.ts";
import { teamMarket } from "./team-data.ts";

export type EvalGroup = "outcome" | "quality" | "process" | "people" | "cost";

export type EvalCheck = {
  id: string;
  label: string;
  group: EvalGroup;
  /** 0 to 1, or null when the check does not apply to this run (it is then left out). */
  score: number | null;
  detail: string;
};

export const JUDGE_CRITERIA = {
  on_brief: "Meets the brief's objectives, audience, budget and window.",
  insight_to_execution: "The look, the copy and the channels follow from the audience findings.",
  specificity: "Concrete and actionable, not generic marketing language.",
  brand_fit: "Fits the brand's voice and guidelines, including any required disclosure.",
  coherence: "Reads as one campaign: one idea carried through every piece.",
} as const;
export type JudgeCriterion = keyof typeof JUDGE_CRITERIA;

export type JudgeResult = {
  model: string;
  scores: Array<{ criterion: JudgeCriterion; score: number; reason: string }>;
  summary: string;
};

export type TeamScorecard = {
  runId: string;
  briefId: string;
  brand: string;
  provider: TeamProvider;
  /** 0 to 100: the checks' average, blended 70/30 with the judge's when the judge ran. */
  overall: number;
  checks: EvalCheck[];
  judge: JudgeResult | null;
  tokens: number;
  costUsd: number | null;
  /** Time spent waiting on models, so a run's speed doesn't depend on how long a person took. */
  modelMs: number;
  at: string;
};

const SAVE_TOOLS = new Set(["report_research", "propose_creative", "write_copy", "plan_media"]);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const pct = (value: number) => `${Math.round(value * 100)}%`;

/** The checks a run's events support, scored 0 to 1. */
export function scoreChecks(events: readonly TeamEvent[], brief: CampaignBrief): EvalCheck[] {
  const tools = events.flatMap((event) => (event.type === "tool" ? [event] : []));
  const messages = events.flatMap((event) => (event.type === "message" ? [event] : []));
  const decisions = events.flatMap((event) => (event.type === "decided" ? [event] : []));
  const reviews = events.flatMap((event) => (event.type === "review" ? [event] : []));
  const strategy = [...events]
    .reverse()
    .flatMap((event) =>
      event.type === "delivered" || event.type === "reconciled" ? [event.strategy] : [],
    )[0] as CampaignStrategy | undefined;
  const checks: EvalCheck[] = [];

  // Outcome: a proposal the client approved is the goal.
  const approved = decisions.some(
    (decision) => decision.gate === "client" && decision.decision === "approve",
  );
  const delivered = events.some((event) => event.type === "delivered");
  checks.push({
    id: "outcome",
    label: "Reached an approved proposal",
    group: "outcome",
    score: approved ? 1 : delivered ? 0.6 : strategy ? 0.3 : 0,
    detail: approved
      ? "The client approved the proposal."
      : delivered
        ? "A proposal reached the client, who has not approved it."
        : strategy
          ? "The pieces were reconciled, but no proposal reached the client."
          : "The squad did not reconcile a campaign.",
  });

  // Process: how often the rule services had to refuse work.
  const saves = tools.filter(
    (event) => SAVE_TOOLS.has(event.step.tool) && event.step.decision?.decision === "allow",
  );
  const kept = saves.filter((event) => event.step.ok).length;
  checks.push({
    id: "first-try",
    label: "Saves the rules accepted",
    group: "process",
    score: saves.length ? kept / saves.length : null,
    detail: saves.length
      ? `${kept} of ${saves.length} saves accepted (${pct(kept / saves.length)}); the rest were refused and fixed.`
      : "No saves were attempted.",
  });

  const nudges = tools.filter((event) => event.step.error?.includes("nudging")).length;
  const denied = tools.filter((event) => event.step.decision?.decision === "deny").length;
  const sentBack = reviews.filter((review) => review.verdict === "revise").length;
  checks.push({
    id: "coordination",
    label: "Coordination without waste",
    group: "process",
    score: clamp(1 - 0.1 * nudges - 0.25 * denied - 0.1 * sentBack),
    detail: `${nudges} nudge${nudges === 1 ? "" : "s"} to call a tool, ${denied} gateway denial${denied === 1 ? "" : "s"}, ${sentBack} send-back${sentBack === 1 ? "" : "s"} by the lead.`,
  });

  const questions = messages.filter((message) => message.kind === "question").length;
  const answers = messages.filter((message) => message.kind === "answer").length;
  checks.push({
    id: "collaboration",
    label: "Spokes answered each other",
    group: "process",
    score: questions ? clamp(answers / questions) : null,
    detail: questions
      ? `${answers} of ${questions} side questions answered.`
      : "No spoke asked another a question.",
  });

  // Quality: measurable properties of the plan itself.
  if (strategy) {
    const insights = strategy.audience.insights;
    const cited = insights.length
      ? insights.reduce((sum, insight) => sum + insight.sources.length, 0) / insights.length
      : 0;
    checks.push({
      id: "grounding",
      label: "Findings grounded in data",
      group: "quality",
      score: clamp(cited / 2),
      detail: `${insights.length} finding${insights.length === 1 ? "" : "s"}, citing ${cited.toFixed(1)} data ids each on average (two or more scores full marks).`,
    });

    const use = strategy.media.totalUsd / Math.max(1, brief.budgetUsd);
    checks.push({
      id: "budget",
      label: "Uses the budget well",
      group: "quality",
      score: use > 1 ? 0 : use >= 0.8 ? 1 : clamp(use / 0.8),
      detail: `Plans ${pct(use)} of the budget (80–100% scores full marks).`,
    });

    const market = teamMarket(brief.brand);
    const affinity = (segmentId: string, channel: string) =>
      (
        market.segments.find((segment) => segment.id === segmentId)?.affinity as
          | Record<string, number | undefined>
          | undefined
      )?.[channel] ?? 1;
    const spend = strategy.media.lines.reduce((sum, line) => sum + line.budgetUsd, 0);
    const weighted = spend
      ? strategy.media.lines.reduce(
          (sum, line) => sum + affinity(line.segmentId, line.channel) * line.budgetUsd,
          0,
        ) / spend
      : 0;
    checks.push({
      id: "audience-fit",
      label: "Money goes where the audience is",
      group: "quality",
      score: clamp(weighted / 1.3),
      detail: `Spend-weighted channel affinity ${weighted.toFixed(2)} (1 is a typical audience; 1.3 or more scores full marks).`,
    });

    const bought = new Set(strategy.media.lines.map((line) => line.channel));
    const written = new Set(strategy.messaging.assets.map((asset) => asset.channel));
    const union = new Set([...bought, ...written]);
    const both = [...union].filter((channel) => bought.has(channel) && written.has(channel));
    checks.push({
      id: "consistency",
      label: "Every bought channel has copy",
      group: "quality",
      score: union.size ? both.length / union.size : 0,
      detail: `${both.length} of ${union.size} channels are both bought and written for.`,
    });
  }

  // People: how many rounds the compliance reviewer and the client needed.
  const changes = decisions.filter((decision) => decision.decision === "changes").length;
  checks.push({
    id: "people",
    label: "Accepted by people the first time",
    group: "people",
    score: decisions.length ? clamp(1 - 0.25 * changes) : null,
    detail: decisions.length
      ? `${decisions.length} decision${decisions.length === 1 ? "" : "s"} by people, ${changes} asking for changes.`
      : "No person has decided yet.",
  });
  return checks;
}

/** The run's scorecard: its checks, the judge's scores and what it cost. */
export function scoreRun(input: {
  runId: string;
  provider: TeamProvider;
  brief: CampaignBrief;
  events: readonly TeamEvent[];
  judge: JudgeResult | null;
  costUsd: number | null;
  at: string;
}): TeamScorecard {
  const checks = scoreChecks(input.events, input.brief);
  const models = input.events.flatMap((event) => (event.type === "model" ? [event] : []));
  const scored = checks.flatMap((check) => (check.score === null ? [] : [check.score]));
  const checksAvg = scored.length
    ? scored.reduce((sum, score) => sum + score, 0) / scored.length
    : 0;
  const judgeAvg = input.judge?.scores.length
    ? input.judge.scores.reduce((sum, item) => sum + (item.score - 1) / 4, 0) /
      input.judge.scores.length
    : null;
  const overall = judgeAvg === null ? checksAvg : 0.7 * checksAvg + 0.3 * judgeAvg;
  const tokens = models.reduce((sum, event) => sum + event.tokens, 0);
  return {
    runId: input.runId,
    briefId: input.brief.id,
    brand: input.brief.brand,
    provider: input.provider,
    overall: Math.round(overall * 100),
    checks: [
      ...checks,
      {
        id: "cost",
        label: "Cost and time",
        group: "cost",
        score: null,
        detail: `${tokens.toLocaleString("en-US")} tokens${input.costUsd === null ? "" : `, about $${input.costUsd.toFixed(2)}`}, ${Math.round(models.reduce((sum, event) => sum + event.latencyMs, 0) / 1000)} s of model time.`,
      },
    ],
    judge: input.judge,
    tokens,
    costUsd: input.costUsd,
    modelMs: models.reduce((sum, event) => sum + event.latencyMs, 0),
    at: input.at,
  };
}
