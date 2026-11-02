import type { ApprovalState } from "./types.ts";

/** Who may take a transition. `system` is the expiry job or a recorded supersession. */
export const ACTOR_CLASSES = ["author", "reviewer", "senior", "admin", "system"] as const;
export type ActorClass = (typeof ACTOR_CLASSES)[number];

/** The people (personas) a demo evaluator can act as, one per human gate on the lifecycle. */
export const PERSONAS = [
  "brand-planner",
  "marketer",
  "content-lab",
  "compliance",
  "reviewer",
  "senior",
  "brand-lead",
  "admin",
] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_LABELS: Record<Persona, string> = {
  "brand-planner": "Brand planner",
  marketer: "Marketer",
  "content-lab": "Content Lab",
  compliance: "Compliance (evidence owner)",
  reviewer: "MLR-style reviewer",
  senior: "Senior reviewer",
  "brand-lead": "Brand lead",
  admin: "Admin",
};

export function actorClassesFor(persona: Persona): ActorClass[] {
  switch (persona) {
    case "reviewer":
      return ["reviewer"];
    case "senior":
      return ["reviewer", "senior"];
    case "admin":
      return ["author", "reviewer", "senior", "admin"];
    default:
      return ["author"];
  }
}

export type Transition = { from: ApprovalState; to: ApprovalState; actors: readonly ActorClass[] };

/** The eleven valid transitions. Every other pair is rejected. */
export const TRANSITIONS: readonly Transition[] = [
  { from: "draft", to: "submitted", actors: ["author"] },
  { from: "submitted", to: "in_review", actors: ["reviewer"] },
  { from: "in_review", to: "changes_requested", actors: ["reviewer"] },
  { from: "changes_requested", to: "submitted", actors: ["author"] },
  { from: "in_review", to: "approved", actors: ["reviewer"] },
  { from: "in_review", to: "rejected", actors: ["reviewer"] },
  { from: "in_review", to: "escalated", actors: ["reviewer"] },
  { from: "escalated", to: "approved", actors: ["senior"] },
  { from: "escalated", to: "rejected", actors: ["senior"] },
  { from: "approved", to: "expired", actors: ["system"] },
  { from: "approved", to: "withdrawn", actors: ["admin", "system"] },
];

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; code: "INVALID_TRANSITION" | "NOT_PERMITTED"; message: string };

export function checkTransition(
  from: ApprovalState,
  to: ApprovalState,
  actor: Persona | "system",
): TransitionCheck {
  const transition = TRANSITIONS.find((item) => item.from === from && item.to === to);
  if (!transition)
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `${from} → ${to} is not one of the ${TRANSITIONS.length} valid transitions.`,
    };
  const classes: readonly ActorClass[] = actor === "system" ? ["system"] : actorClassesFor(actor);
  if (!transition.actors.some((allowed) => classes.includes(allowed)))
    return {
      ok: false,
      code: "NOT_PERMITTED",
      message: `${actor === "system" ? "The system" : PERSONA_LABELS[actor]} cannot move ${from} → ${to}; it needs ${transition.actors.join(" or ")}.`,
    };
  return { ok: true, transition };
}

/** What a persona may do next from a state. */
export function allowedTransitions(from: ApprovalState, persona: Persona) {
  return TRANSITIONS.filter(
    (item) => item.from === from && checkTransition(from, item.to, persona).ok,
  ).map((item) => item.to);
}
