import { routeModel } from "@northstar/architecture";
import type { ArchEnv } from "./context";

// The answer-quality judge for sampled agent runs. Clef answers typed questions with
// probabilities instead of free text, so a run's quality comes back as a number with no parsing,
// for a fraction of a chat model's cost (input tokens only). It gives no reasons, so the score is
// recorded beside the deterministic evaluators and is not yet part of drift.

const LEVELS = ["Not at all", "Partly", "Mostly", "Fully"];

const QUESTIONS = {
  task: {
    type: "score",
    instructions: "Does the result do what the agent was asked to do?",
    criteria: LEVELS,
  },
  grounded: {
    type: "score",
    instructions:
      "Does the summary describe only what the tool results show, without adding facts of its own?",
    criteria: LEVELS,
  },
  clear: {
    type: "score",
    instructions: "Could a marketer act on the summary without reading the tool trace?",
    criteria: LEVELS,
  },
} as const;

type ScoreAnswer = { type: "score"; score: number };
type Verdict = { answers?: Record<string, ScoreAnswer | undefined> };

/** The mean of the judge's answers, from 0 to 1. Undefined when any answer is missing. */
export function judgeScoreFrom(verdict: Verdict): number | undefined {
  const top = LEVELS.length - 1;
  const scores = Object.keys(QUESTIONS).map((id) => verdict.answers?.[id]?.score);
  if (scores.some((score) => typeof score !== "number")) return undefined;
  const mean = (scores as number[]).reduce((sum, score) => sum + score / top, 0) / scores.length;
  return Math.round(Math.min(1, Math.max(0, mean)) * 1000) / 1000;
}

/**
 * Judges one run. Undefined when no model is bound (tests, local without Workers AI) or the judge
 * fails: answer quality is then reported as not scored, never as a failure of the agent.
 */
export async function judgeRun(
  env: ArchEnv,
  run: { agent: string; task: string; input: unknown; summary: string; result: unknown },
): Promise<number | undefined> {
  if (!env.AI || env.AGENT_MODEL === "scripted") return undefined;
  const { model } = routeModel("score");
  try {
    const verdict = (await env.AI.run(
      model as Parameters<Ai["run"]>[0],
      {
        model: "clef",
        state: {
          agent: run.agent,
          task: run.task,
          input: run.input,
          summary: run.summary,
          result: JSON.stringify(run.result ?? null).slice(0, 6000),
        },
        questions: QUESTIONS,
      } as never,
      env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : {},
    )) as Verdict;
    return judgeScoreFrom(verdict);
  } catch (failure) {
    console.error("Answer-quality judge failed", failure);
    return undefined;
  }
}
