// Routes under /api/arch/team: the roster and sample briefs, a run that streams the team's work
// as newline-delimited JSON, and a saved run for a screen that reloads.
import {
  type BRANDS,
  briefProblems,
  buildTeamPolicies,
  type CampaignBrief,
  isTeamGate,
  isTeamProvider,
  PHARMA_PHASES,
  runsPharmaLifecycle,
  TEAM_AGENTS,
  TEAM_BRIEFS,
  TEAM_GATES,
  TEAM_MODES,
  TEAM_PROVIDERS,
  type TeamEvent,
  teamBriefById,
  toCedar,
} from "@northstar/architecture";
import { ArchError, type Ctx, overridesFor } from "../architecture/context";
import { streamFlow } from "../architecture/orchestration";
import { dataPlatform } from "../platform/data";
import { continueTeamRun, startTeamRun } from "./director";
import { startLifecycleRun } from "./lifecycle";
import { providerStatus, teamModels } from "./run";

const RUN = /^\/api\/arch\/team\/runs\/([^/]+)$/;
const DECIDE = /^\/api\/arch\/team\/runs\/([^/]+)\/decide$/;
const LIBRARY_RUN = /^\/api\/arch\/team\/library\/([^/]+)$/;

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** A sample brief by id, or a brief a person wrote or edited, checked before the team sees it. */
export function briefFrom(input: Record<string, unknown>): CampaignBrief {
  if (typeof input.briefId === "string" && !input.brief) {
    const sample = teamBriefById(input.briefId);
    if (!sample) throw new ArchError(404, "NOT_FOUND", `No sample brief ${input.briefId}.`);
    return sample;
  }
  const given = (input.brief ?? {}) as Partial<CampaignBrief>;
  const problems = briefProblems(given);
  if (problems.length) throw new ArchError(400, "BAD_BRIEF", problems.join(" "));
  return {
    id: typeof given.id === "string" && /^[a-z0-9-]{1,48}$/.test(given.id) ? given.id : "custom",
    brand: given.brand as (typeof BRANDS)[number],
    title: String(given.title).trim(),
    objectives: String(given.objectives).trim(),
    audience: String(given.audience).trim(),
    budgetUsd: Math.round(Number(given.budgetUsd)),
    start: String(given.start),
    end: String(given.end),
    guidelines: String(given.guidelines ?? "").trim(),
  };
}

export async function handleTeam(
  ctx: Ctx,
  request: Request,
  path: string,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<Response | null> {
  if (path === "/api/arch/team" && request.method === "GET") {
    const models = teamModels(ctx);
    return json({
      agents: TEAM_AGENTS.map((agent) => ({ ...agent, model: models[agent.id] })),
      providers: providerStatus(ctx),
      briefs: TEAM_BRIEFS,
      lifecycle: { phases: PHARMA_PHASES, gates: TEAM_GATES },
      // The team's Cedar policies in force, as their files have them (file and @id on each).
      policies: buildTeamPolicies(await overridesFor(ctx)).map((policy) => ({
        ...policy,
        cedar: toCedar(policy),
      })),
    });
  }
  if (path === "/api/arch/team/runs" && request.method === "POST") {
    const input = await readBody();
    const provider = input.provider ?? "cloudflare";
    if (!isTeamProvider(provider))
      throw new ArchError(
        400,
        "BAD_REQUEST",
        `provider must be one of ${TEAM_PROVIDERS.join(", ")}.`,
      );
    const mode = input.mode ?? "squad";
    if (!(TEAM_MODES as readonly unknown[]).includes(mode))
      throw new ArchError(400, "BAD_REQUEST", `mode must be one of ${TEAM_MODES.join(", ")}.`);
    const brief = briefFrom(input);
    if (mode === "lifecycle") {
      if (!runsPharmaLifecycle(brief.brand))
        throw new ArchError(
          400,
          "BAD_REQUEST",
          "The pharma lifecycle runs for a prescription brand (Lumera Therapeutics).",
        );
      return streamFlow<TeamEvent>(
        await startLifecycleRun(ctx, brief, provider, { seededFlaw: input.seededFlaw === true }),
      );
    }
    return streamFlow<TeamEvent>(await startTeamRun(ctx, brief, provider));
  }
  const decide = DECIDE.exec(path);
  if (decide?.[1] && request.method === "POST") {
    const input = await readBody();
    if (!isTeamGate(input.gate))
      throw new ArchError(
        400,
        "BAD_REQUEST",
        `gate must be one of ${Object.keys(TEAM_GATES).join(", ")}.`,
      );
    if (input.decision !== "approve" && input.decision !== "changes")
      throw new ArchError(400, "BAD_REQUEST", "decision must be approve or changes.");
    return streamFlow<TeamEvent>(
      await continueTeamRun(ctx, decodeURIComponent(decide[1]), {
        gate: input.gate,
        decision: input.decision,
        note: typeof input.note === "string" ? input.note.slice(0, 1000) : "",
        ...(typeof input.choice === "string" ? { choice: input.choice.slice(0, 40) } : {}),
      }),
    );
  }
  if (path === "/api/arch/team/evals" && request.method === "GET") {
    const rows = await ctx.store.orchestrationsWithPrefix("team:");
    return json({
      runs: rows.flatMap((row) => {
        const events = row.events as TeamEvent[];
        const start = events.find((event) => event.type === "start");
        const evaluation = [...events].reverse().find((event) => event.type === "evaluation");
        if (start?.type !== "start") return [];
        return [
          {
            id: row.id,
            briefId: start.brief.id,
            title: start.brief.title,
            brand: row.brand,
            provider: start.infra?.provider ?? "cloudflare",
            status: row.status,
            at: row.updatedAt,
            scorecard: evaluation?.type === "evaluation" ? evaluation.scorecard : null,
          },
        ];
      }),
    });
  }
  // The shared library of recent runs: anyone may list and replay them.
  if (path === "/api/arch/team/library" && request.method === "GET")
    return json({ runs: await dataPlatform(ctx.env).teamLibrary.list() });
  const libraryRun = LIBRARY_RUN.exec(path);
  if (libraryRun?.[1] && request.method === "GET") {
    const found = await dataPlatform(ctx.env).teamLibrary.get(decodeURIComponent(libraryRun[1]));
    if (!found) throw new ArchError(404, "NOT_FOUND", `No run ${libraryRun[1]} in the library.`);
    return json(found);
  }
  const saved = RUN.exec(path);
  if (saved?.[1] && request.method === "GET") {
    const row = await ctx.store.orchestration(decodeURIComponent(saved[1]));
    if (!row || !row.flowId.startsWith("team:"))
      throw new ArchError(404, "NOT_FOUND", `No team run ${saved[1]}.`);
    return json({
      id: row.id,
      briefId: row.flowId.slice(5),
      status: row.status,
      waitingOn: row.waitingOn,
      events: row.events,
    });
  }
  return null;
}
