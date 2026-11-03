/**
 * What a model is bound to do. "score" answers typed questions with probabilities (no tools, no
 * free text); the answer-quality evaluator uses it to judge sampled runs.
 */
export const TASK_CLASSES = [
  "orchestrate",
  "draft",
  "classify",
  "judge",
  "embed",
  "score",
] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

export type ModelEntry = {
  id: string;
  label: string;
  provider: "Workers AI";
  toolCalling: boolean;
  contextTokens: number;
  tasks: readonly TaskClass[];
};

/** The Workers AI models the agents and evaluators run on. */
export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "gpt-oss-120b",
    provider: "Workers AI",
    toolCalling: true,
    contextTokens: 128000,
    tasks: ["orchestrate", "draft", "classify", "judge"],
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    label: "gpt-oss-20b",
    provider: "Workers AI",
    toolCalling: true,
    contextTokens: 128000,
    tasks: ["orchestrate", "draft", "classify"],
  },
  {
    id: "@cf/cloudflare/clef",
    label: "Clef",
    provider: "Workers AI",
    toolCalling: false,
    contextTokens: 65536,
    tasks: ["score"],
  },
  {
    id: "@cf/baai/bge-base-en-v1.5",
    label: "BGE base embeddings",
    provider: "Workers AI",
    toolCalling: false,
    contextTokens: 512,
    tasks: ["embed"],
  },
];

/**
 * The incumbent for each task. ADR-011 moves planning and drafting to gpt-oss-120b: on 20b the
 * orchestrator repeated a failing step instead of changing course, and the authoring agent cut its
 * own words down to a fragment to pass the checks. Classifying agents call deterministic services,
 * so they stay on 20b.
 */
export const CHAMPIONS: Record<TaskClass, string> = {
  orchestrate: "@cf/openai/gpt-oss-120b",
  draft: "@cf/openai/gpt-oss-120b",
  classify: "@cf/openai/gpt-oss-20b",
  judge: "@cf/openai/gpt-oss-120b",
  embed: "@cf/baai/bge-base-en-v1.5",
  score: "@cf/cloudflare/clef",
};

/** Challengers run beside the champion on a share of turns, never in front of a user. */
export const CHALLENGERS: Record<TaskClass, readonly string[]> = {
  // The former champion is the challenger, so it is what the new champion is measured against.
  orchestrate: ["@cf/openai/gpt-oss-20b"],
  draft: ["@cf/openai/gpt-oss-20b"],
  classify: [],
  judge: [],
  embed: [],
  score: [],
};

export const SHADOW_SHARE = 0.1;
/** Shadow runs stop for the day once they cost this much. */
export const SHADOW_DAILY_COST_CAP_USD = 1;

export type Route = {
  taskClass: TaskClass;
  model: string;
  reason: string;
  shadow?: string;
};

const share = (key: string) => {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash % 10_000) / 10_000;
};

/** Binds a task to a model at run time. `turnKey` picks, deterministically, which turns get a shadow. */
export function routeModel(
  taskClass: TaskClass,
  options: {
    turnKey?: string;
    champions?: Partial<Record<TaskClass, string>>;
    shadowSpentUsd?: number;
  } = {},
): Route {
  const model = options.champions?.[taskClass] ?? CHAMPIONS[taskClass];
  const challengers = CHALLENGERS[taskClass];
  const overCap = (options.shadowSpentUsd ?? 0) >= SHADOW_DAILY_COST_CAP_USD;
  const sampled = options.turnKey !== undefined && share(options.turnKey) < SHADOW_SHARE;
  const route: Route = {
    taskClass,
    model,
    reason: options.champions?.[taskClass]
      ? `Set as the ${taskClass} champion for this environment.`
      : `Champion for ${taskClass}.`,
  };
  if (sampled && !overCap && challengers.length) {
    const shadow = challengers[Math.floor(share(`${options.turnKey}:pick`) * challengers.length)];
    if (shadow) route.shadow = shadow;
  }
  return route;
}

export type ModelScore = { passed: number; total: number };

/** A challenger replaces the champion only by beating it on the same evaluations. */
export function canPromote(
  champion: ModelScore | undefined,
  challenger: ModelScore | undefined,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!champion) reasons.push("The champion has no evaluation on record.");
  if (!challenger) reasons.push("The challenger has no evaluation on record.");
  if (champion && challenger) {
    if (challenger.total < champion.total)
      reasons.push(
        `The challenger ran ${challenger.total} turns; the champion ran ${champion.total}. Run the same set.`,
      );
    else if (challenger.passed / challenger.total <= champion.passed / champion.total)
      reasons.push(
        `The challenger passed ${challenger.passed} of ${challenger.total}; the champion passed ${champion.passed} of ${champion.total}. It must beat it.`,
      );
  }
  return { ok: reasons.length === 0, reasons };
}

/** Agents declare a task class, not a model: this is what each live agent is bound to right now. */
export function agentRoutes(
  agents: ReadonlyArray<{ id: string; taskClass: TaskClass | "none"; promptId?: string }>,
) {
  return agents.flatMap((agent) =>
    agent.taskClass === "none"
      ? []
      : [{ agentId: agent.id, promptId: agent.promptId ?? null, ...routeModel(agent.taskClass) }],
  );
}
