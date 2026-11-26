// Hard limits on the squad's work (TEAM_LIMITS), above the per-step caps: an agent's assignment
// stops after too many tool calls or failed calls without saving, the lead's turn after too many
// tool calls, and the whole run after too many model calls or tokens. Each check reads the run's
// own event log, which a resumed run rebuilds in full, so a limit holds across people's decisions.
// Hitting one emits a `limit` event (the page shows it with the guardrails) and the work stops
// with a reason the lead, or the person reading, can act on.
import { TEAM_LIMITS, type TeamAgentId, type TeamLimit } from "@northstar/architecture";
import type { TeamRun } from "./run";

export type LimitHit = { scope: "assignment" | "turn" | "run"; limit: TeamLimit; detail: string };

/** The whole run's model calls and tokens, every resume included. */
export function runLimit(run: Pick<TeamRun, "events">): LimitHit | null {
  let calls = 0;
  let tokens = 0;
  for (const event of run.events)
    if (event.type === "model") {
      calls += 1;
      tokens += event.tokens;
    }
  if (calls >= TEAM_LIMITS.runModelCalls)
    return {
      scope: "run",
      limit: "runModelCalls",
      detail: `The run made ${calls} model calls, its limit (${TEAM_LIMITS.runModelCalls}).`,
    };
  if (tokens >= TEAM_LIMITS.runTokens)
    return {
      scope: "run",
      limit: "runTokens",
      detail: `The run used ${tokens.toLocaleString("en-US")} tokens, past its limit (${TEAM_LIMITS.runTokens.toLocaleString("en-US")}).`,
    };
  return null;
}

/** One agent's tool calls and failed calls since its assignment began (event index `since`). */
export function assignmentLimit(
  run: Pick<TeamRun, "events">,
  agent: TeamAgentId,
  since: number,
): LimitHit | null {
  let calls = 0;
  let failures = 0;
  for (const event of run.events.slice(since))
    if (event.type === "tool" && event.agent === agent) {
      calls += 1;
      if (!event.step.ok) failures += 1;
    }
  if (failures >= TEAM_LIMITS.assignmentFailures)
    return {
      scope: "assignment",
      limit: "assignmentFailures",
      detail: `${failures} of its tool calls on this assignment failed, the limit (${TEAM_LIMITS.assignmentFailures}).`,
    };
  if (calls >= TEAM_LIMITS.assignmentToolCalls)
    return {
      scope: "assignment",
      limit: "assignmentToolCalls",
      detail: `It made ${calls} tool calls on this assignment without saving its work, the limit (${TEAM_LIMITS.assignmentToolCalls}).`,
    };
  return null;
}

/** The lead's tool calls since its turn began (event index `since`). */
export function leadTurnLimit(
  run: Pick<TeamRun, "events">,
  lead: TeamAgentId,
  since: number,
): LimitHit | null {
  const calls = run.events
    .slice(since)
    .filter((event) => event.type === "tool" && event.agent === lead).length;
  return calls >= TEAM_LIMITS.leadToolCallsPerTurn
    ? {
        scope: "turn",
        limit: "leadToolCallsPerTurn",
        detail: `The lead made ${calls} tool calls in this turn without reaching a person or the end, the limit (${TEAM_LIMITS.leadToolCallsPerTurn}).`,
      }
    : null;
}

/** Records a limit once: the page shows it, and the scorecard and replay keep it. */
export function recordLimit(run: TeamRun, agent: TeamAgentId, hit: LimitHit) {
  const already = run.events.some(
    (event) => event.type === "limit" && event.limit === hit.limit && event.agent === agent,
  );
  if (already && hit.scope === "run") return;
  run.emit({ type: "limit", agent, ...hit });
}
