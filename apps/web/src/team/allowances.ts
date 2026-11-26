// What one agent is allowed in a run, and how much of it it has used: the hard limits (TEAM_LIMITS)
// and per-step caps (TEAM_STEP_CAPS) that apply to it, read from the run's folded state. The agent
// modal's Guardrails tab shows these, so a reader sees the allowance next to the work.
import {
  TEAM_AGENTS,
  TEAM_LIMITS,
  TEAM_STEP_CAPS,
  type TeamAgentId,
  type TeamLimit,
  type TeamToolStep,
} from "@northstar/architecture";
import { SAVE_TOOLS, type TeamState } from "./team-state";

export type Allowance = {
  /** The limit, or null for a per-step cap, which has no `limit` event. */
  limit: TeamLimit | null;
  label: string;
  allowed: number;
  /** How much the agent has used, or null when the run's events can't tell. */
  used: number | null;
  /** What `used` counts. */
  usedNote?: string;
  /** What happens at the allowance. */
  atLimit: string;
};

const savedWork = (step: TeamToolStep) =>
  step.ok && SAVE_TOOLS.has(step.tool) && step.decision?.decision !== "deny";

/**
 * A worker's tool calls since its last saved work: an assignment ends when its save goes through,
 * so these are the calls the assignment limits count right now.
 */
export function openAssignment(tools: readonly TeamToolStep[]) {
  let last = -1;
  tools.forEach((step, index) => {
    if (savedWork(step)) last = index;
  });
  const open = tools.slice(last + 1);
  return { calls: open.length, failures: open.filter((step) => !step.ok).length };
}

/** The largest number of identical refusals in a row in this agent's tool calls. */
export function longestSameRefusal(tools: readonly TeamToolStep[]) {
  let best = 0;
  let run = 0;
  let last: string | undefined;
  for (const step of tools) {
    if (savedWork(step)) {
      run = 0;
      last = undefined;
      continue;
    }
    if (step.ok || !step.error) continue;
    run = step.error === last ? run + 1 : 1;
    last = step.error;
    best = Math.max(best, run);
  }
  return best;
}

export function agentAllowances(state: TeamState, id: TeamAgentId): Allowance[] {
  const hub = TEAM_AGENTS.find((agent) => agent.id === id)?.role === "hub";
  const tools = state.agents[id].tools;
  const runCalls = state.modelCalls.length;
  const runTokens = state.modelCalls.reduce((sum, call) => sum + call.tokens, 0);
  const steps = hub
    ? state.mode === "lifecycle"
      ? TEAM_STEP_CAPS.lifecycleLeadStepsPerTry
      : TEAM_STEP_CAPS.squadLeadStepsPerTry
    : TEAM_STEP_CAPS.workerStepsPerTry;
  const own: Allowance[] = hub
    ? [
        {
          limit: "leadToolCallsPerTurn",
          label: "Tool calls in one turn",
          allowed: TEAM_LIMITS.leadToolCallsPerTurn,
          used: null,
          usedNote: `${tools.length} in the whole run`,
          atLimit: "The turn ends; a person's next step still reaches them.",
        },
      ]
    : (() => {
        const open = openAssignment(tools);
        return [
          {
            limit: "assignmentToolCalls",
            label: "Tool calls on one assignment without saving",
            allowed: TEAM_LIMITS.assignmentToolCalls,
            used: open.calls,
            usedNote: "since its last saved work",
            atLimit: "It stops and tells the lead, which can reassign or ask a person.",
          },
          {
            limit: "assignmentFailures",
            label: "Failed tool calls on one assignment",
            allowed: TEAM_LIMITS.assignmentFailures,
            used: open.failures,
            usedNote: "since its last saved work",
            atLimit: "It stops and tells the lead, which can reassign or ask a person.",
          },
          {
            limit: "sameRefusals",
            label: "The same refusal in a row",
            allowed: TEAM_LIMITS.sameRefusals,
            used: longestSameRefusal(tools),
            usedNote: "longest streak this run",
            atLimit:
              "The second gets a note to change what it sends; the third ends the assignment.",
          },
        ] satisfies Allowance[];
      })();
  return [
    ...own,
    {
      limit: null,
      label: hub ? "Model loops per turn" : "Model loops per assignment",
      allowed: TEAM_STEP_CAPS.tries,
      used: null,
      atLimit: hub
        ? "Each loop after the first starts with a nudge to carry on."
        : "Each loop after the first starts with a reminder to save, fixing what was refused.",
    },
    {
      limit: null,
      label: "Steps per loop",
      allowed: steps,
      used: null,
      atLimit: "A step is one model call and the tools it calls; the loop ends at the cap.",
    },
    {
      limit: "runModelCalls",
      label: "Model calls in the run (every agent)",
      allowed: TEAM_LIMITS.runModelCalls,
      used: runCalls,
      usedNote: "whole run so far",
      atLimit: "The whole run stops and its summary says why.",
    },
    {
      limit: "runTokens",
      label: "Tokens in the run (every agent)",
      allowed: TEAM_LIMITS.runTokens,
      used: runTokens,
      usedNote: "whole run so far",
      atLimit: "The whole run stops and its summary says why.",
    },
  ];
}
