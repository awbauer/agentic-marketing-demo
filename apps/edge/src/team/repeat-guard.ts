// A guardrail against an agent repeating a refused save. Each assignment gives a worker up to three
// tries of ten steps, so a model that keeps sending the same wrong thing could be refused thirty
// times (a lifecycle run on Vertex did exactly that with build_audience). Here the second identical
// refusal says so, and the third ends the assignment: the lead is told the exact problem and can
// reassign with clearer instructions or ask a person, instead of the worker burning its steps.

import { TEAM_LIMITS } from "@northstar/architecture";

/** Identical refusals in a row that end a worker's assignment. */
export const SAME_REFUSAL_LIMIT = TEAM_LIMITS.sameRefusals;

export type SaveState = {
  done: boolean;
  /** The last refusal's problems, and how many times in a row they came back unchanged. */
  lastRefusal?: string;
  repeats: number;
};

export const newSaveState = (): SaveState => ({ done: false, repeats: 0 });

const AGAIN =
  " This is the same refusal as your last try: change what you send (the field names and values the problems name), not the wording.";

/** A refusal for the model, counting repeats of the same problems. */
export function refusal(saved: SaveState, problems: readonly string[]): { error: string } {
  const text = problems.join(" ");
  if (text === saved.lastRefusal) saved.repeats += 1;
  else {
    saved.lastRefusal = text;
    saved.repeats = 1;
  }
  return {
    error: `Refused. Fix every problem and save again: ${text}${saved.repeats > 1 ? AGAIN : ""}`,
  };
}

/** The worker has sent the same refused save too many times in a row to keep going. */
export const stuckOnRefusal = (saved: SaveState) => saved.repeats >= SAME_REFUSAL_LIMIT;

/** What the worker tells the lead when the guard stopped it. */
export const stuckReport = (tool: string, saved: SaveState) =>
  `I stopped after ${tool} was refused ${saved.repeats} times in a row for the same reason: ${saved.lastRefusal ?? ""} Reassign with clearer instructions, or ask a person.`;
