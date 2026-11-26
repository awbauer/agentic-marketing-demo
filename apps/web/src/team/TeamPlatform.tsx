// What the squad stands on, drawn from the run's own records: the semantic layer every agent reads
// through, and the infrastructure layers each message, model call and tool call passes.
import {
  JUDGE_CRITERIA,
  type JudgeCriterion,
  SEMANTIC_ENTITIES,
  SEMANTIC_METRIC_IDS,
  SEMANTIC_METRICS,
  SEMANTIC_SOURCES,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  type TeamAgentId,
  type TeamScorecard,
  teamOpenModels,
  teamRunProviderLabel,
} from "@northstar/architecture";
import { hostTerms } from "@northstar/contracts";
import { resetSessionMetrics, type SessionRun, useSessionMetrics } from "./session-metrics";
import { type InfraLayer, isPeerMessage, type TeamState } from "./team-state";

/** What this host calls its infrastructure (ADR-018). */
const HOST = hostTerms();

const short = (id: TeamAgentId) => TEAM_PARTY_LABELS[id];

export function SemanticLayerPanel({ state }: { state: TeamState }) {
  // Which agents used which metric, and which entities, in this run.
  const byMetric = new Map<string, Set<TeamAgentId>>();
  const byEntity = new Map<string, Set<TeamAgentId>>();
  for (const use of state.semantic) {
    for (const metric of use.metrics) {
      if (!byMetric.has(metric)) byMetric.set(metric, new Set());
      byMetric.get(metric)?.add(use.agent);
    }
    if (use.entity) {
      if (!byEntity.has(use.entity)) byEntity.set(use.entity, new Set());
      byEntity.get(use.entity)?.add(use.agent);
    }
  }
  const terms = state.semantic.flatMap((use) =>
    (use.terms ?? []).map((term) => ({ term, agent: use.agent })),
  );
  return (
    <div className="team-semantic">
      <p className="arch-note">
        No agent reads a raw table. Each data tool is a named query on the semantic layer, which
        defines every entity and metric once: its formula, grain, unit, source and owner. The rule
        services and the proposal use the same formulas, so a “projected click” means the same thing
        to the channel planner, the lead and the client. Highlighted rows were used in this run.
      </p>
      <ol className="team-lineage" aria-label="Where the numbers come from">
        <li>
          <strong>Source systems</strong>
          <span>{Object.values(SEMANTIC_SOURCES).join(" · ")}</span>
        </li>
        <li>
          <strong>Semantic layer</strong>
          <span>
            {Object.keys(SEMANTIC_ENTITIES).length} entities · {SEMANTIC_METRIC_IDS.length} metrics
            · a glossary for define_term
          </span>
        </li>
        <li>
          <strong>Agent tools</strong>
          <span>get_ tools, query_semantic_layer, define_term</span>
        </li>
        <li>
          <strong>Rules and proposal</strong>
          <span>Projections, limits and budget checks reuse the same formulas</span>
        </li>
      </ol>
      <h4>Entities</h4>
      <ul className="team-entities">
        {Object.entries(SEMANTIC_ENTITIES).map(([id, entity]) => {
          const users = [...(byEntity.get(id) ?? [])];
          return (
            <li key={id} className={users.length ? "used" : ""}>
              <strong>{entity.label}</strong> <code>{entity.key}</code>
              <span>{entity.definition}</span>
              <small>
                {SEMANTIC_SOURCES[entity.source]}
                {users.length ? ` · read by ${users.map(short).join(", ")}` : ""}
              </small>
            </li>
          );
        })}
      </ul>
      <h4>Metrics</h4>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Formula</th>
              <th scope="col">Grain</th>
              <th scope="col">Owner</th>
              <th scope="col">Used by in this run</th>
            </tr>
          </thead>
          <tbody>
            {SEMANTIC_METRIC_IDS.map((id) => {
              const metric = SEMANTIC_METRICS[id];
              const users = [...(byMetric.get(id) ?? [])];
              return (
                <tr key={id} className={users.length ? "used" : ""}>
                  <th scope="row">
                    {metric.label}
                    <small>
                      <code>{id}</code> · {metric.unit}
                    </small>
                  </th>
                  <td>{metric.formula}</td>
                  <td>{metric.grain}</td>
                  <td>{metric.owner}</td>
                  <td>{users.length ? users.map(short).join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {terms.length > 0 && (
        <>
          <h4>Terms the agents looked up</h4>
          <ul>
            {terms.map((item, index) => (
              <li key={`${item.term}-${index}`}>
                <strong>{short(item.agent)}</strong> asked what “{item.term}” means
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type Layer = {
  id: InfraLayer | "operations";
  name: string;
  what: string;
  stats: Array<[string, string | number]>;
};

export function InfrastructurePanel({ state }: { state: TeamState }) {
  const calls = state.modelCalls;
  const tokens = calls.reduce((sum, call) => sum + call.tokens, 0);
  const byModel = new Map<string, { calls: number; ms: number }>();
  for (const call of calls) {
    const entry = byModel.get(call.model) ?? { calls: 0, ms: 0 };
    byModel.set(call.model, { calls: entry.calls + 1, ms: entry.ms + call.latencyMs });
  }
  const tools = Object.values(state.agents).flatMap((agent) => agent.tools);
  const allowed = tools.filter((step) => step.decision?.decision === "allow").length;
  const lead = state.agents["campaign-lead"].tools;
  const versions = Object.values(state.agents).reduce(
    (sum, agent) => sum + agent.versions.length,
    0,
  );
  const sentBack = Object.values(state.agents).reduce((sum, agent) => sum + agent.revisions, 0);
  const nudged = tools.filter((step) => step.error?.includes("nudging")).length;
  const infra = state.infra;
  const layers: Layer[] = [
    {
      id: "experience",
      name: "Experience",
      what: "This page. The run streams to it as newline-delimited JSON, one event per message, call or decision, so you see each agent as it works.",
      stats: [["Events received", state.events]],
    },
    {
      id: "coordination",
      name: "Coordination",
      what: "The campaign lead's loop: one forced next_step tool, dependency checks before each hand-out, a limit of two send-backs per spoke, and nudges when a model answers in prose.",
      stats: [
        ["Lead steps", lead.length],
        ["Send-backs", sentBack],
        ["Nudges", nudged],
      ],
    },
    {
      id: "models",
      name: "Models",
      what: infra?.scripted
        ? "A scripted stand-in (tests only) in place of real models."
        : `${
            infra?.provider === "anthropic"
              ? "Claude on the Anthropic API, through the official SDK and the AI Gateway, which supplies the key stored on it: adaptive thinking replayed turn to turn, effort set per agent, server-side refusal fallback and prompt caching"
              : infra?.provider === "openai"
                ? "OpenAI's Responses API through the AI Gateway, which supplies the key stored on it, with reasoning effort set per agent"
                : teamOpenModels(infra?.aiPlatform, HOST.id) === "vertex"
                  ? "Vertex AI on Google Cloud (gpt-oss-120b); a router binds each agent's task class to a champion model, which Vertex serves"
                  : "Cloudflare Workers AI; a router binds each agent's task class to a champion model"
          }${infra?.aiGateway ? `, through AI Gateway (${infra.aiGateway}) for caching, rate limits and logs` : ""}. Every call is metered. The switch above changes only this layer.`,
      stats: [
        ["Model calls", calls.length],
        ["Tokens", tokens.toLocaleString("en-US")],
        ...[...byModel.entries()].map(
          ([model, entry]) =>
            [
              model.replace("@cf/", ""),
              `${entry.calls} calls · ${(entry.ms / entry.calls / 1000).toFixed(1)} s avg`,
            ] as [string, string],
        ),
      ],
    },
    {
      id: "gateway",
      name: "Agentic gateway",
      what: "Every tool call is checked against default-deny policies compiled from the roster, gets a short-lived signed identity token naming the agent and the person it acts for, and is written to the audit log.",
      stats: [
        ["Policies in force", infra?.policies ?? "—"],
        ["Allowed calls (tokens minted)", allowed],
        ["Denied", state.denied],
      ],
    },
    {
      id: "semantic",
      name: "Tools and semantic layer",
      what: "Each agent sees only its granted tools. Data tools are queries on the semantic layer, so definitions are shared, not re-derived.",
      stats: [
        ["Tool calls", state.toolCalls],
        ["Semantic queries", state.semantic.length],
        ["Metrics touched", new Set(state.semantic.flatMap((use) => use.metrics)).size],
      ],
    },
    {
      id: "rules",
      name: "Rule services",
      what: "Deterministic code checks every save: cite-or-refuse for findings, the brand palette and imagery, character limits, banned phrases, disclosures, minimum spends, the budget and the window.",
      stats: [
        ["Saves accepted", state.rules.accepted],
        ["Saves refused", state.rules.refused],
      ],
    },
    {
      id: "bus",
      name: "Agent-to-agent bus",
      what: "Assignments, hand-backs, send-backs and side questions between spokes travel as logged messages. A spoke may ask two questions per piece.",
      stats: [
        ["Messages", state.messages.length],
        ["Spoke to spoke", state.messages.filter(isPeerMessage).length],
      ],
    },
    {
      id: "state",
      name: "State and memory",
      what: `A shared folder holds each spoke's versions for the others to read; the whole run is saved to ${HOST.database} so a reload or replay finds it.`,
      stats: [
        ["Versions saved", versions],
        ["Run persisted", state.saved === null ? "—" : state.saved ? "yes" : "failed"],
      ],
    },
    {
      id: "people",
      name: "People in the loop",
      what: "Some decisions belong to people: a compliance reviewer clears a regulated brand's copy, and the client approves the proposal. The run waits, saved, until the person at the browser decides; the gateway checks the role, and no agent can ever take the decision.",
      stats: [
        ["Decisions by people", state.decisions.length],
        ["Waiting now", state.waiting ? TEAM_GATES[state.waiting.gate].decider : "no one"],
      ],
    },
    {
      id: "operations",
      name: "Operations",
      what: "Operators can disable an agent or move it through its lifecycle (constrain keeps reads only, retire withholds everything) without a deploy; the gateway applies it on the next call.",
      stats: [["Agents with live grants", `${infra?.policies ?? "—"} of 5`]],
    },
  ];
  return (
    <div className="team-infra">
      <p className="arch-note">
        The five agents are the visible part. Under them is the platform that makes them safe to
        run: each layer below lights when the latest event passes through it, and its counts come
        from this run.
      </p>
      <ol className="team-stack">
        {layers.map((layer) => (
          <li key={layer.id} className={state.layer === layer.id ? "live" : ""}>
            <div>
              <h4>{layer.name}</h4>
              <p>{layer.what}</p>
            </div>
            <dl>
              {layer.stats.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}

const GROUP_LABELS: Record<string, string> = {
  outcome: "Outcome",
  quality: "Quality of the plan",
  process: "How the agents worked",
  people: "People",
  cost: "Cost",
};

/** One run's scorecard: the overall score, every check with its evidence, and the judge's view. */
function Scorecard({
  scorecard,
  aiPlatform,
}: {
  scorecard: TeamScorecard;
  aiPlatform: string | undefined;
}) {
  return (
    <div className="team-scorecard">
      <div className="team-score-head">
        <p className="team-score-big">
          <span className="sr-only">Overall score: </span>
          {scorecard.overall}
          <small>/100</small>
        </p>
        <p className="arch-note">
          {teamRunProviderLabel(scorecard.provider, aiPlatform, HOST.id)} ·{" "}
          {scorecard.tokens.toLocaleString("en-US")} tokens
          {scorecard.costUsd === null
            ? " · cost not priced"
            : ` · about $${scorecard.costUsd.toFixed(2)}`}{" "}
          · {Math.round(scorecard.modelMs / 1000)} s of model time. The checks count 70% and the
          judge 30%.
        </p>
      </div>
      <ul className="team-checks">
        {scorecard.checks.map((check) => (
          <li key={check.id}>
            <div>
              <strong>{check.label}</strong> <small>{GROUP_LABELS[check.group]}</small>
              <p>{check.detail}</p>
            </div>
            {check.score === null ? (
              <span className="team-check-na">n/a</span>
            ) : (
              <meter
                min={0}
                max={1}
                low={0.5}
                high={0.8}
                optimum={1}
                value={check.score}
                aria-label={`${check.label}: ${Math.round(check.score * 100)}%`}
              />
            )}
          </li>
        ))}
      </ul>
      {scorecard.judge ? (
        <>
          <h4>
            Quality judge <small>({scorecard.judge.model.replace("@cf/", "")}, 1 to 5)</small>
          </h4>
          <ul className="team-checks">
            {scorecard.judge.scores.map((item) => (
              <li key={item.criterion}>
                <div>
                  <strong>{item.criterion.replaceAll("_", " ")}</strong>{" "}
                  <small>{JUDGE_CRITERIA[item.criterion as JudgeCriterion]}</small>
                  <p>{item.reason}</p>
                </div>
                <span className="team-judge-score">{item.score}/5</span>
              </li>
            ))}
          </ul>
          <p className="arch-note">{scorecard.judge.summary}</p>
        </>
      ) : (
        <p className="arch-note">No proposal to judge on this run.</p>
      )}
    </div>
  );
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const STATUS_LABELS: Record<SessionRun["status"], string> = {
  done: "Finished",
  waiting: "Waiting on a person",
  stopped: "Stopped",
};

/**
 * This session's runs side by side, and the average per provider, so the providers can be
 * compared. Local to this browser: live runs and replays this reader finished, until Reset.
 */
function RunsCompared() {
  const metrics = useSessionMetrics();
  const scored = metrics.runs.filter((run) => run.scorecard);
  const replays = metrics.runs.filter((run) => run.source === "replay").length;
  const started = new Date(metrics.startedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const header = (
    <div className="team-session-bar">
      <p className="arch-note" role="status">
        This session, in this browser only, since {started}: {metrics.runs.length} run
        {metrics.runs.length === 1 ? "" : "s"} ({metrics.runs.length - replays} live, {replays}{" "}
        replayed), {scored.length} scored. Replays and scripted runs count.
      </p>
      <button
        type="button"
        className="text-button"
        onClick={resetSessionMetrics}
        disabled={metrics.runs.length === 0}
      >
        Reset session metrics
      </button>
    </div>
  );
  if (metrics.runs.length === 0)
    return (
      <>
        {header}
        <p className="arch-note">
          No runs in this session yet. A run counts once it ends or stops for a person, and a replay
          counts once it plays to the end or is skipped to the end.
        </p>
      </>
    );
  // Grouped by what ran: the open-model tier on Workers AI and on Vertex AI are separate rows.
  const label = (run: SessionRun) => teamRunProviderLabel(run.provider, run.aiPlatform, HOST.id);
  const providers = [...new Set(scored.map(label))];
  return (
    <>
      {header}
      {providers.length > 0 && (
        <div className="team-table-wrap">
          <table className="team-table">
            <caption>Average per provider, this session</caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Scored runs</th>
                <th scope="col">Score</th>
                <th scope="col">Judge</th>
                <th scope="col">Cost per run</th>
                <th scope="col">Model time</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const cards = scored
                  .filter((run) => label(run) === provider)
                  .map((run) => run.scorecard as TeamScorecard);
                const judge = average(
                  cards.flatMap((card) =>
                    card.judge?.scores.length
                      ? [
                          card.judge.scores.reduce((sum, item) => sum + item.score, 0) /
                            card.judge.scores.length,
                        ]
                      : [],
                  ),
                );
                const cost = average(
                  cards.flatMap((card) => (card.costUsd === null ? [] : [card.costUsd])),
                );
                return (
                  <tr key={provider}>
                    <th scope="row">{provider}</th>
                    <td>{cards.length}</td>
                    <td>{Math.round(average(cards.map((card) => card.overall)) ?? 0)}</td>
                    <td>{judge === null ? "—" : `${judge.toFixed(1)}/5`}</td>
                    <td>{cost === null ? "—" : `$${cost.toFixed(2)}`}</td>
                    <td>
                      {Math.round((average(cards.map((card) => card.modelMs)) ?? 0) / 1000)} s
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="team-table-wrap">
        <table className="team-table">
          <caption>Runs this session</caption>
          <thead>
            <tr>
              <th scope="col">Brief</th>
              <th scope="col">Source</th>
              <th scope="col">Provider</th>
              <th scope="col">Status</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {metrics.runs.slice(0, 20).map((run) => (
              <tr key={run.key}>
                <th scope="row">{run.title}</th>
                <td>
                  {run.source === "replay" ? "Replay" : "Live"}
                  {run.scripted ? " · scripted" : ""}
                </td>
                <td>{label(run)}</td>
                <td>{STATUS_LABELS[run.status]}</td>
                <td>{run.scorecard ? run.scorecard.overall : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function EvalsPanel({ state }: { state: TeamState }) {
  return (
    <div className="team-evals">
      <p className="arch-note">
        Every run is scored when it ends. Checks come from the run&rsquo;s own record: did it reach
        an approved proposal, how often the rules refused work, whether the plan fits the budget and
        the audience, how the agents coordinated, and how many rounds people needed. A judge model
        then scores the proposal against a rubric. The judge is the same for every provider, so the
        providers can be compared fairly.
      </p>
      {state.scorecard ? (
        <Scorecard scorecard={state.scorecard} aiPlatform={state.infra?.aiPlatform} />
      ) : (
        <p className="arch-note">
          {state.waiting
            ? "This run is waiting for a person; it is scored once it ends."
            : "This run has no scorecard yet."}
        </p>
      )}
      <h4>Runs compared</h4>
      <RunsCompared />
    </div>
  );
}
