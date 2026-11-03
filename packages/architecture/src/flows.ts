// Sample flows: a goal for each brand that the orchestrator plans and delegates. The goal says what
// the brand team wants, not which agent to call when; the orchestrator decides that.
import type { Persona } from "./state-machine.ts";
import type { Brand } from "./types.ts";

export type SampleGoal = {
  id: string;
  brand: Brand;
  title: string;
  /** The situation, for the person watching. */
  situation: string;
  /** The goal as the orchestrator receives it. */
  goal: string;
  /** Who makes the decision no agent may take. */
  decider: Persona;
};

export const SAMPLE_GOALS: readonly SampleGoal[] = [
  {
    id: "lumera-congress",
    brand: "Lumera Therapeutics",
    title: "Get a Cardivance email ready for the heart failure congress",
    situation:
      "The congress is on November 10. Lumera’s approved Q4 plan calls for an outcomes email to opted-in cardiology prescribers. Someone also wants it to say Cardivance beats every ARB.",
    goal: "Get a Cardivance outcomes email ready for the heart failure congress on November 10. It is wave w1 of the approved plan urn:northstar:content-plan:lt-q4-hcp. The brand team wants it to state the outcomes result (claim topic cardivance-mortality) and that Cardivance beats every ARB (claim topic cardivance-superior). Write a new email for this wave (one email with both topics requested), and take it from a brief to the point where a person can approve it, red-teaming it and checking its evidence on the way. Then ask the MLR reviewer to decide. After the decision, find out what last quarter's results suggest the brand do next.",
    decider: "reviewer",
  },
  {
    id: "harborstone-rate",
    brand: "Harborstone Wealth",
    title: "Explain the new Sweep Account rate after the rate decision",
    situation:
      "The sweep rate moved to 4.35% APY on October 1, and the Q4 plan’s first wave explains it. Someone also wants to mention wire fees, and an older fee-waiver email is still sitting in draft.",
    goal: "Write an email explaining the current Sweep Account rate for wave w1 of the approved plan urn:northstar:content-plan:hs-q4-rates. The team also wants it to mention wire fees (claim topics sweep-apy and wire-fees). Write one new email with both topics requested, and take it from a brief to the point where a person can approve it, checking its evidence on the way. Then ask the compliance reviewer to decide. After the decision, the team asks whether the older draft urn:northstar:module:hs-mod-fee-waiver-email can go to review too.",
    decider: "reviewer",
  },
  {
    id: "coastline-cold-front",
    brand: "Coastline Kitchen",
    title: "Turn the Bay Area cold front into a chowder push",
    situation:
      "A cold front reaches the Bay Area on November 9, and Coastline’s plan has a chowder push for it. The planner wonders whether to send two days early.",
    goal: "The planner wonders whether wave w1 of the approved plan urn:northstar:content-plan:ck-q4-weather should go out two days early; find out what that does to expected clicks first, and keep the date unless it helps. Then write a new push for the wave that states the chowder price and the soup hours (claim topics chowder-price and soup-hours), make email and SMS versions of it, and take the push to the point where a person can approve it. Then ask the reviewer to decide. Finally, find out what carried last October's chowder push, result urn:northstar:result:ck-result-chowder-push.",
    decider: "reviewer",
  },
];

export const sampleGoalById = (id: string) => SAMPLE_GOALS.find((goal) => goal.id === id);

/** One tool call a subagent made, as a flow reports it. */
export type FlowToolStep = {
  tool: string;
  input: unknown;
  ok: boolean;
  /** The gateway's decision for this call. */
  decision?: { decision: string; policyId: string; reason: string };
  output?: unknown;
  error?: string;
};

/** What an orchestration streams while it works, in order. */
export type FlowEvent =
  | { type: "start"; id: string; flowId: string; model: string; modelReason: string }
  | { type: "note"; text: string }
  | {
      type: "delegate";
      callId: string;
      agent: string;
      name: string;
      persona: string;
      task: string;
      refs: Record<string, unknown>;
    }
  | { type: "tool"; callId: string; agent: string; step: FlowToolStep }
  | {
      type: "delegated";
      callId: string;
      agent: string;
      ok: boolean;
      summary?: string;
      error?: string;
      model?: string;
      created?: Array<{ ref: string; urn: string; title: string; kind: string }>;
      result?: unknown;
      latencyMs?: number;
      tokens?: number;
    }
  | { type: "await-human"; moduleUrn: string; title: string; why: string; persona: string }
  | { type: "decided"; moduleUrn: string; state: string; persona: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };
