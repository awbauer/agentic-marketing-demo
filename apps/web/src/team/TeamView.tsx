// The campaign squad page: hand over a brief, then follow a campaign lead and four spokes as
// they work it one agent at a time — each assignment, hand-back, side question, send-back and
// tool call — until the proposal goes to the client.
import {
  BRANDS,
  type Brand,
  type CampaignBrief,
  TEAM_AGENTS,
  TEAM_BRIEFS,
  TEAM_DIRECTOR,
  TEAM_PARTY_LABELS,
  TEAM_SPECIALISTS,
  isTeamProvider,
  TEAM_PROVIDERS,
  type TeamAgentId,
  type TeamProvider,
  type TeamEvent,
  type TeamMessageKind,
} from "@northstar/architecture";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArchApiError, archFetch, archStream, useArch } from "../architecture/api";
import { ErrorNote } from "../architecture/Shared";
import { useScope } from "../scope";
import { TeamHierarchy } from "./TeamHierarchy";
import { DecisionCard, DecisionLog } from "./TeamPeople";
import { TeamPlatform } from "./TeamPlatform";
import { StrategyView, TeamWorkView } from "./TeamWork";
import { foldTeam, isPeerMessage, TEAM_PHASES, type TeamMessage } from "./team-state";
import "../architecture/architecture.css";
import "./team.css";

const LAST_RUN = "northstar.team.lastRun";
const PROVIDER_KEY = "northstar.team.provider";

type ProviderOption = {
  id: TeamProvider;
  label: string;
  available: boolean;
  reason?: string;
  models: Record<TeamAgentId, string>;
  /** The AI Gateway every request goes through. */
  gateway: string | null;
  keys: string;
};

const PROVIDER_SHORT: Record<TeamProvider, { name: string; api: string }> = {
  cloudflare: { name: "Cloudflare", api: "Workers AI" },
  anthropic: { name: "Anthropic", api: "Claude API" },
  openai: { name: "OpenAI", api: "Responses API" },
};

/** The three-way switch: which provider's models run the squad. Everything else stays the same. */
function ProviderSwitch({
  providers,
  value,
  onChange,
  disabled,
}: {
  providers: ProviderOption[] | null;
  value: TeamProvider;
  onChange: (provider: TeamProvider) => void;
  disabled: boolean;
}) {
  const current = providers?.find((item) => item.id === value);
  const models = current ? [...new Set(Object.values(current.models))] : [];
  return (
    <fieldset className="team-provider">
      <legend>Run the agents on</legend>
      <div className="team-switch" role="radiogroup" aria-label="Model provider">
        {TEAM_PROVIDERS.map((id) => {
          const option = providers?.find((item) => item.id === id);
          return (
            <label key={id} className={value === id ? "on" : ""} title={option?.reason ?? ""}>
              <input
                type="radio"
                name="team-provider"
                value={id}
                checked={value === id}
                disabled={disabled}
                onChange={() => onChange(id)}
              />
              <strong>{PROVIDER_SHORT[id].name}</strong>
              <small>
                {PROVIDER_SHORT[id].api}
                {option && !option.available ? " · unavailable" : ""}
              </small>
            </label>
          );
        })}
      </div>
      <p className="arch-note" role="status">
        {!current
          ? "Checking which providers can run here…"
          : current.available
            ? `${current.label}: ${models.map((model) => model.replace("@cf/", "")).join(", ")}, through AI Gateway ${current.gateway ?? ""}${current.id === "cloudflare" ? "" : ", using the key stored on the gateway"}. The tools, gateway, semantic layer and rules are the same on every provider.`
            : current.reason}
      </p>
    </fieldset>
  );
}
const recall = () => {
  try {
    return localStorage.getItem(LAST_RUN);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_RUN, id);
    else localStorage.removeItem(LAST_RUN);
  } catch {
    // Storage may be unavailable; the run still shows until the page reloads.
  }
};

const KIND_LABELS: Record<TeamMessageKind, string> = {
  brief: "Brief",
  plan: "Work plan",
  directive: "Assignment",
  report: "Hand-back",
  question: "Side question",
  answer: "Reply",
  review: "Kept",
  revision: "Sent back",
  proposal: "Reconciled",
  delivery: "Proposal",
  "approval-request": "Review request",
  decision: "Decision",
};

type Status = "idle" | "running" | "replaying" | "done";
type FeedFilter = "all" | "lead" | "peer";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const asError = (failure: unknown) =>
  failure instanceof ArchApiError
    ? failure
    : new ArchApiError(0, "NETWORK", "The workbench could not be reached.", {});

function BriefForm({
  brief,
  onChange,
  disabled,
}: {
  brief: CampaignBrief;
  onChange: (brief: CampaignBrief) => void;
  disabled: boolean;
}) {
  const field = (key: keyof CampaignBrief, value: string | number) =>
    onChange({ ...brief, id: "custom", [key]: value });
  return (
    <details className="team-brief-edit">
      <summary>Edit the brief</summary>
      <div className="arch-fields team-brief-fields">
        <label>
          Brand
          <select
            value={brief.brand}
            disabled={disabled}
            onChange={(event) => field("brand", event.target.value)}
          >
            {BRANDS.map((brand) => (
              <option key={brand}>{brand}</option>
            ))}
          </select>
        </label>
        <label>
          Budget (USD)
          <input
            type="number"
            min={1000}
            max={1000000}
            step={500}
            value={brief.budgetUsd}
            disabled={disabled}
            onChange={(event) => field("budgetUsd", Number(event.target.value))}
          />
        </label>
        <label>
          Starts
          <input
            type="date"
            value={brief.start}
            disabled={disabled}
            onChange={(event) => field("start", event.target.value)}
          />
        </label>
        <label>
          Ends
          <input
            type="date"
            value={brief.end}
            disabled={disabled}
            onChange={(event) => field("end", event.target.value)}
          />
        </label>
        <label className="wide">
          Title
          <input
            value={brief.title}
            disabled={disabled}
            onChange={(event) => field("title", event.target.value)}
          />
        </label>
        <label className="wide">
          Objectives
          <textarea
            rows={2}
            value={brief.objectives}
            disabled={disabled}
            onChange={(event) => field("objectives", event.target.value)}
          />
        </label>
        <label className="wide">
          Target audience
          <textarea
            rows={2}
            value={brief.audience}
            disabled={disabled}
            onChange={(event) => field("audience", event.target.value)}
          />
        </label>
        <label className="wide">
          Brand guidelines and constraints
          <textarea
            rows={2}
            value={brief.guidelines}
            disabled={disabled}
            onChange={(event) => field("guidelines", event.target.value)}
          />
        </label>
      </div>
    </details>
  );
}

function Party({ id }: { id: string }) {
  return (
    <span className={`team-party party-${id}`}>{TEAM_PARTY_LABELS[id as TeamAgentId] ?? id}</span>
  );
}

function MessageFeed({ messages, live }: { messages: TeamMessage[]; live: boolean }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const end = useRef<HTMLLIElement>(null);
  const shown = messages.filter((message) =>
    filter === "all" ? true : filter === "peer" ? isPeerMessage(message) : !isPeerMessage(message),
  );
  const peers = messages.filter(isPeerMessage).length;
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, live]);
  return (
    <section className="team-feed" aria-labelledby="team-feed-title">
      <header>
        <h3 id="team-feed-title">Squad conversation</h3>
        <div className="arch-tabs small" role="tablist" aria-label="Filter messages">
          {(
            [
              ["all", `All (${messages.length})`],
              ["lead", "Through the lead"],
              ["peer", `Spoke to spoke (${peers})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {shown.length === 0 ? (
        <p className="arch-note">
          {messages.length === 0
            ? "The squad's conversation shows up here: the brief, each assignment and hand-back, side questions between spokes, send-backs, and the proposal."
            : "No messages of this kind yet."}
        </p>
      ) : (
        <ol className="team-messages" aria-live="polite">
          {shown.map((message) => (
            <li key={message.id} className={`team-message kind-${message.kind}`}>
              <div className="team-message-head">
                <Party id={message.from} />
                <span aria-hidden="true">→</span>
                <span className="sr-only">to</span>
                <Party id={message.to} />
                <em className="team-kind">{KIND_LABELS[message.kind]}</em>
              </div>
              <p>{message.text}</p>
            </li>
          ))}
          <li ref={end} aria-hidden="true" className="team-feed-end" />
        </ol>
      )}
    </section>
  );
}

function AgentInspector({
  state,
  selected,
  onSelect,
}: {
  state: ReturnType<typeof foldTeam>;
  selected: TeamAgentId;
  onSelect: (id: TeamAgentId) => void;
}) {
  const manifest = TEAM_AGENTS.find((agent) => agent.id === selected);
  const view = state.agents[selected];
  const specialist = selected !== TEAM_DIRECTOR ? selected : null;
  const latest = specialist ? view.versions.at(-1) : undefined;
  return (
    <section className="team-inspector" aria-labelledby="team-inspector-title">
      <h3 id="team-inspector-title" className="sr-only">
        Agent detail
      </h3>
      <div className="arch-tabs small" role="tablist" aria-label="Agents">
        {[TEAM_DIRECTOR, ...TEAM_SPECIALISTS].map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected === id}
            onClick={() => onSelect(id)}
          >
            <i className={`team-dot is-${state.agents[id].state}`} aria-hidden="true" />
            {TEAM_PARTY_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="team-inspector-body" role="tabpanel">
        <header>
          <h4>{manifest?.name}</h4>
          <p>{manifest?.summary}</p>
          <p className="arch-note">
            {manifest?.role === "hub" ? "Hub" : "Spoke"} · runs on{" "}
            <code>{(state.models[selected] ?? "—").replace("@cf/", "")}</code> · state{" "}
            <strong>{view.state}</strong>
            {view.note ? ` (${view.note})` : ""}
            {view.revisions ? ` · revised ${view.revisions}×` : ""}
          </p>
          <p className="team-grants">
            Gateway grants:{" "}
            {manifest?.tools.map((tool) => (
              <code key={tool}>{tool}</code>
            ))}
          </p>
        </header>
        {view.review && (
          <p className={`team-review verdict-${view.review.verdict}`}>
            Lead’s call: <strong>{view.review.verdict === "accept" ? "kept" : "sent back"}</strong>
            {view.review.feedback && view.review.feedback !== "Kept."
              ? ` — ${view.review.feedback}`
              : ""}
          </p>
        )}
        {specialist && state.brief && (
          <>
            <h5>
              Latest work{latest ? ` · version ${latest.version}` : ""}
              {latest ? ` · ${(latest.latencyMs / 1000).toFixed(1)} s` : ""}
            </h5>
            <TeamWorkView agent={specialist} work={latest?.output} brief={state.brief} />
          </>
        )}
        {selected === TEAM_DIRECTOR && state.plan && (
          <>
            <h5>The lead’s work plan</h5>
            <ul>
              {state.plan.deliverables.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <ol className="team-assignments">
              {state.plan.assignments.map((item) => (
                <li key={item.agent}>
                  <strong>{TEAM_PARTY_LABELS[item.agent]}</strong>: {item.task}
                  {item.dependsOn.length > 0 && (
                    <small>
                      {" "}
                      · after {item.dependsOn.map((id) => TEAM_PARTY_LABELS[id]).join(", ")}
                    </small>
                  )}
                </li>
              ))}
            </ol>
            {state.plan.budgetGuidance && <p className="arch-note">{state.plan.budgetGuidance}</p>}
          </>
        )}
        <h5>Tool calls ({view.tools.length})</h5>
        {view.tools.length === 0 ? (
          <p className="arch-note">No calls yet.</p>
        ) : (
          <ol className="team-tools">
            {view.tools.map((step, index) => (
              <li key={`${step.tool}-${index}`} className={step.ok ? "ok" : "failed"}>
                <code>{step.tool}</code>{" "}
                <span className={`team-decision ${step.decision?.decision ?? "none"}`}>
                  {step.decision
                    ? `${step.decision.decision === "allow" ? "✓ allowed" : "✗ denied"} by ${step.decision.policyId}`
                    : "not checked"}
                </span>
                {step.error && <small className="team-tool-error">{step.error}</small>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The Campaign team view. */
export function TeamView({ onClose }: { onClose: () => void }) {
  const { scope } = useScope();
  const briefs = TEAM_BRIEFS.filter(
    (brief) => scope.brand === "all" || brief.brand === scope.brand,
  );
  const [brief, setBrief] = useState<CampaignBrief>(
    () => briefs[0] ?? (TEAM_BRIEFS[0] as CampaignBrief),
  );
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<ArchApiError | null>(null);
  const [selected, setSelected] = useState<TeamAgentId>(TEAM_DIRECTOR);
  const [follow, setFollow] = useState(true);
  const roster = useArch<{ providers: ProviderOption[] }>("/team", {
    persona: scope.persona,
    brand: "all",
  });
  const [provider, setProvider] = useState<TeamProvider>(() => {
    try {
      const saved = localStorage.getItem(PROVIDER_KEY);
      return isTeamProvider(saved) ? saved : "cloudflare";
    } catch {
      return "cloudflare";
    }
  });
  const chooseProvider = (next: TeamProvider) => {
    setProvider(next);
    try {
      localStorage.setItem(PROVIDER_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  };
  const chosen = roster.data?.providers.find((item) => item.id === provider);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // A clock while the squad works, so a long model call reads as work, not a hang.
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef<number | null>(null);
  const lastEventAt = useRef<number | null>(null);
  useEffect(() => {
    if (status !== "running") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);

  // A brief outside the header's brand scope can't run; follow the scope when it changes.
  useEffect(() => {
    if (scope.brand !== "all" && brief.brand !== scope.brand && briefs[0]) setBrief(briefs[0]);
  }, [scope.brand]);

  // The last run survives a reload.
  useEffect(() => {
    const id = recall();
    if (!id) return;
    archFetch<{ events: TeamEvent[] }>(`/team/runs/${encodeURIComponent(id)}`, {
      persona: scope.persona,
      brand: "all",
    })
      .then((saved) => {
        setEvents(saved.events);
        setStatus("done");
      })
      .catch(() => remember(null));
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const visible = shown === null ? events : events.slice(0, shown);
  const state = useMemo(() => foldTeam(visible), [visible]);

  // While a run plays, keep the inspector on whichever agent is working now.
  useEffect(() => {
    if (!follow || status === "done" || status === "idle") return;
    const working = [...TEAM_SPECIALISTS, TEAM_DIRECTOR].find((id) =>
      ["working", "revising"].includes(state.agents[id].state),
    );
    if (working && working !== selected) setSelected(working);
  }, [state, follow, status]);

  /** A person's decision on the waiting run; the squad's next steps stream onto the same page. */
  async function decide(decision: "approve" | "changes", note: string) {
    const waiting = state.waiting;
    if (!waiting || !state.id) return;
    setError(null);
    setStatus("running");
    setFollow(true);
    startedAt.current = Date.now();
    lastEventAt.current = Date.now();
    try {
      await archStream<TeamEvent>(
        `/team/runs/${encodeURIComponent(state.id)}/decide`,
        { persona: waiting.persona, brand: "all" },
        { gate: waiting.gate, decision, note },
        (event) => {
          lastEventAt.current = Date.now();
          setEvents((current) => [...current, event]);
        },
      );
    } catch (failure) {
      setError(asError(failure));
    }
    setStatus("done");
  }

  async function run() {
    if (timer.current) clearInterval(timer.current);
    setShown(null);
    setEvents([]);
    setError(null);
    setStatus("running");
    setFollow(true);
    remember(null);
    startedAt.current = Date.now();
    lastEventAt.current = Date.now();
    const sample = TEAM_BRIEFS.find((item) => item.id === brief.id);
    const body = {
      ...(sample && JSON.stringify(sample) === JSON.stringify(brief)
        ? { briefId: brief.id }
        : { brief }),
      provider,
    };
    try {
      await archStream<TeamEvent>(
        "/team/runs",
        { persona: scope.persona, brand: brief.brand as Brand },
        body,
        (event) => {
          if (event.type === "start") remember(event.id);
          lastEventAt.current = Date.now();
          setEvents((current) => [...current, event]);
        },
      );
    } catch (failure) {
      setError(asError(failure));
    }
    setStatus("done");
  }

  function replay() {
    if (timer.current) clearInterval(timer.current);
    setStatus("replaying");
    setFollow(true);
    setShown(1);
    timer.current = setInterval(() => {
      setShown((current) => {
        const next = (current ?? 0) + 1;
        if (next >= events.length) {
          if (timer.current) clearInterval(timer.current);
          setStatus("done");
          return null;
        }
        return next;
      });
    }, 220);
  }

  function skip() {
    if (timer.current) clearInterval(timer.current);
    setShown(null);
    setStatus("done");
  }

  const busy = status === "running" || status === "replaying";
  const active = [...TEAM_SPECIALISTS, TEAM_DIRECTOR].find((id) =>
    ["working", "revising"].includes(state.agents[id].state),
  );
  const working = active
    ? `${TEAM_PARTY_LABELS[active]}: ${state.agents[active].activity ?? state.agents[active].note ?? "thinking"}`
    : "";
  const current = TEAM_PHASES.find((phase) => !state.phases.has(phase.id));
  return (
    <section className="evaluations-view arch-view team-view" aria-labelledby="team-title">
      <div className="section-header">
        <div>
          <p className="kicker">Campaign squad · hub and spokes</p>
          <h2 id="team-title">Five agents, one campaign proposal</h2>
        </div>
        <div className="arch-header-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Back to workspace
          </button>
        </div>
      </div>
      <div className="arch-body">
        <div className="arch-main">
          <p className="arch-lede">
            Hand the squad a brief and watch it work. The campaign lead in the middle never writes a
            word of the campaign: it splits the brief into pieces, gives each to the spoke that owns
            it, decides whether to keep what comes back, and fits the pieces together. Spokes can
            also message one another directly when one piece depends on another. Each agent is a
            real model limited to its own tools, the agentic gateway checks every call, and code —
            not the model — enforces the brand’s rules on every piece.
          </p>

          <section className="team-brief" aria-labelledby="team-brief-title">
            <h3 id="team-brief-title">Choose a brief</h3>
            <fieldset className="arch-flow-picker">
              <legend>Sample briefs</legend>
              {briefs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={brief.id === item.id}
                  disabled={busy}
                  onClick={() => setBrief(item)}
                >
                  <small>{item.brand}</small>
                  <strong>{item.title}</strong>
                  <span>
                    ${item.budgetUsd.toLocaleString("en-US")} · {item.start} → {item.end}
                  </span>
                </button>
              ))}
            </fieldset>
            <p className="team-brief-summary">
              <strong>Objectives:</strong> {brief.objectives} <strong>Audience:</strong>{" "}
              {brief.audience} <strong>Budget:</strong> ${brief.budgetUsd.toLocaleString("en-US")}{" "}
              <strong>Window:</strong> {brief.start} → {brief.end}
            </p>
            <BriefForm brief={brief} onChange={setBrief} disabled={busy} />
            <ProviderSwitch
              providers={roster.data?.providers ?? null}
              value={provider}
              onChange={chooseProvider}
              disabled={busy}
            />
            <div className="team-actions">
              <button
                type="button"
                className="arch-primary"
                disabled={busy || chosen?.available === false}
                onClick={() => void run()}
              >
                {status === "running" ? "The squad is working…" : "Hand the brief to the squad"}
              </button>
              {events.length > 0 && status !== "running" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={status === "replaying" ? skip : replay}
                >
                  {status === "replaying" ? "Skip to the end" : "Replay agent by agent"}
                </button>
              )}
              {status === "running" && startedAt.current ? (
                <small className="team-clock" role="status">
                  Working · {clock(now - startedAt.current)} · last update{" "}
                  {Math.max(0, Math.round((now - (lastEventAt.current ?? now)) / 1000))} s ago
                  {working ? ` · ${working}` : ""}
                </small>
              ) : (
                <small>
                  Real models on {PROVIDER_SHORT[provider].name}; a run takes a few minutes and
                  differs each time.
                </small>
              )}
            </div>
          </section>

          {error && <ErrorNote error={error} />}

          {state.waiting && state.brief && shown === null && (
            <DecisionCard
              waiting={state.waiting}
              strategy={state.strategy}
              brief={state.brief}
              decisions={state.decisions}
              busy={busy}
              onDecide={(decision, note) => void decide(decision, note)}
            />
          )}

          <ol className="team-steps" aria-label="Progress">
            {TEAM_PHASES.map((phase) => (
              <li
                key={phase.id}
                className={
                  state.phases.has(phase.id)
                    ? "reached"
                    : busy && current?.id === phase.id
                      ? "current"
                      : ""
                }
                aria-current={busy && current?.id === phase.id ? "step" : undefined}
              >
                <span aria-hidden="true" />
                {phase.label}
                {phase.id === "pieces" ? ` (${state.kept}/4)` : ""}
              </li>
            ))}
          </ol>

          <div className="team-grid">
            <div className="team-diagram">
              <TeamHierarchy state={state} />
              <dl className="team-stats compact" aria-live="polite">
                <div>
                  <dt>Messages</dt>
                  <dd>{state.messages.length}</dd>
                </div>
                <div>
                  <dt>Spoke to spoke</dt>
                  <dd>{state.messages.filter(isPeerMessage).length}</dd>
                </div>
                <div>
                  <dt>Tool calls</dt>
                  <dd>{state.toolCalls}</dd>
                </div>
                <div>
                  <dt>Gateway denials</dt>
                  <dd>{state.denied}</dd>
                </div>
                {state.done && (
                  <>
                    <div>
                      <dt>Tokens</dt>
                      <dd>{state.done.tokens.toLocaleString("en-US")}</dd>
                    </div>
                    <div>
                      <dt>Elapsed</dt>
                      <dd>{Math.round(state.done.latencyMs / 1000)} s</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
            <MessageFeed messages={state.messages} live={busy} />
          </div>

          <TeamPlatform state={state} />

          {state.conflicts.length > 0 && (
            <section className="team-conflicts" aria-labelledby="team-conflicts-title">
              <h3 id="team-conflicts-title">Clashes the lead had to resolve</h3>
              <ul>
                {state.conflicts.map((conflict) => (
                  <li key={conflict.id}>
                    <code>{conflict.id}</code> {conflict.detail}{" "}
                    <small>
                      ({TEAM_PARTY_LABELS[conflict.between[0]]} and{" "}
                      {TEAM_PARTY_LABELS[conflict.between[1]]})
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <DecisionLog decisions={state.decisions} />

          <AgentInspector
            state={state}
            selected={selected}
            onSelect={(id) => {
              setFollow(false);
              setSelected(id);
            }}
          />

          {state.error && (
            <p className="team-error" role="alert">
              {state.error}
            </p>
          )}
          {state.done && (
            <p className={`team-done ${state.strategy ? "" : "stopped"}`} role="status">
              {state.done.summary}
            </p>
          )}
          {state.strategy && state.brief && (
            <StrategyView strategy={state.strategy} brief={state.brief} />
          )}
        </div>
      </div>
    </section>
  );
}
