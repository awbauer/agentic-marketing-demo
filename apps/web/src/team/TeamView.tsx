import { AI_PLATFORM_TERMS, AI_PLATFORMS, hostTerms } from "@northstar/contracts";
// The campaign squad page: hand over a brief, then follow a campaign lead and four spokes as
// they work it one agent at a time — each assignment, hand-back, side question, send-back and
// tool call — until the proposal goes to the client.
import {
  BRANDS,
  type Brand,
  type CampaignBrief,
  runsPharmaLifecycle,
  TEAM_AGENTS,
  TEAM_BRIEFS,
  TEAM_DIRECTOR,
  TEAM_PARTY_LABELS,
  TEAM_GATES,
  isTeamProvider,
  type PHARMA_PHASES,
  phaseOfGate,
  isLifecycleWorker,
  isTeamSpecialist,
  teamAgentsFor,
  type TeamMode,
  TEAM_PROVIDERS,
  type TeamAgentId,
  type TeamProvider,
  type TeamEvent,
  teamOpenModels,
} from "@northstar/architecture";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArchApiError, archFetch, archStream, useArch } from "../architecture/api";
import { ErrorNote } from "../architecture/Shared";
import { useAiPlatform } from "../ai-platform";
import { useScope } from "../scope";
import { RichText } from "./RichText";
import { type LibraryRun, RunLibrary } from "./RunLibrary";
import { TeamHierarchy } from "./TeamHierarchy";
import { DecisionCard, DecisionLog } from "./TeamPeople";
import { ArtifactView, LifecycleDecisionCard, PhaseStepper, PhaseWorkspace } from "./TeamLifecycle";
import { EvalsPanel, InfrastructurePanel, SemanticLayerPanel } from "./TeamPlatform";
import { StrategyView, TeamWorkView } from "./TeamWork";
import { REPLAY_SPEEDS, type ReplaySpeed, replayDelays } from "./replay";
import { AgentModal } from "./AgentModal";
import { GuardrailPanel } from "./Guardrails";
import { recordSessionRun } from "./session-metrics";
import { foldTeam, isPeerMessage, KIND_LABELS, TEAM_PHASES, type TeamMessage } from "./team-state";
import "../architecture/architecture.css";
import "./team.css";

/** What this host calls its infrastructure (ADR-018). */
const HOST = hostTerms();

const LAST_RUN = "northstar.team.lastRun";
const PROVIDER_KEY = "northstar.team.provider";
const MODE_KEY = "northstar.team.mode";

type PhaseId = (typeof PHARMA_PHASES)[number]["id"];

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

/** The switch's names. The open-model tier is named for the AI platform chosen in the top bar. */
const providerShort = (
  id: TeamProvider,
  aiPlatform: string | null,
): { name: string; api: string } => {
  if (id === "cloudflare") {
    const terms = AI_PLATFORM_TERMS[teamOpenModels(aiPlatform, HOST.id)];
    return { name: terms.cloud, api: terms.label };
  }
  return id === "anthropic"
    ? { name: "Anthropic", api: "Claude API" }
    : { name: "OpenAI", api: "Responses API" };
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
  const { platform } = useAiPlatform();
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
              <strong>{providerShort(id, platform).name}</strong>
              <small>
                {providerShort(id, platform).api}
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
            ? `${current.label}: ${models.map((model) => model.replace("@cf/", "")).join(", ")}${current.gateway ? `, through AI Gateway ${current.gateway}${current.id === "cloudflare" ? "" : ", using the key stored on the gateway"}` : ""}. The tools, gateway, semantic layer and rules are the same on every provider.`
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

/**
 * The conversation, in its own scrolling box. New messages scroll the box only when the reader is
 * already at its bottom; otherwise a pill counts what arrived below. The page itself never moves.
 */
function MessageFeed({
  messages,
  title = "Squad conversation",
}: {
  messages: TeamMessage[];
  title?: string;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(0);
  const [unseen, setUnseen] = useState(0);
  const shown = messages.filter((message) =>
    filter === "all" ? true : filter === "peer" ? isPeerMessage(message) : !isPeerMessage(message),
  );
  const peers = messages.filter(isPeerMessage).length;
  useLayoutEffect(() => {
    const box = list.current;
    const added = shown.length - seen.current;
    seen.current = shown.length;
    if (!box || added <= 0) return;
    if (atBottom.current) box.scrollTop = box.scrollHeight;
    else setUnseen((count) => count + added);
  }, [shown.length]);
  // A new filter starts from its own bottom.
  useLayoutEffect(() => {
    seen.current = shown.length;
    atBottom.current = true;
    setUnseen(0);
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [filter]);
  const onScroll = () => {
    const box = list.current;
    if (!box) return;
    atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    if (atBottom.current) setUnseen(0);
  };
  const jump = () => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  };
  return (
    <section className="team-feed" aria-labelledby="team-feed-title">
      <header>
        <h3 id="team-feed-title">{title}</h3>
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
        <div className="team-messages-wrap">
          <ol className="team-messages" aria-live="polite" ref={list} onScroll={onScroll}>
            {shown.map((message) => (
              <li key={message.id} className={`team-message kind-${message.kind}`}>
                <div className="team-message-head">
                  <Party id={message.from} />
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">to</span>
                  <Party id={message.to} />
                  <em className="team-kind">{KIND_LABELS[message.kind]}</em>
                </div>
                <RichText text={message.text} />
              </li>
            ))}
          </ol>
          {unseen > 0 && (
            <button type="button" className="team-new-pill" onClick={jump}>
              ↓ {unseen} new message{unseen === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AgentInspector({
  state,
  selected,
  follow,
  onFollow,
  onSelect,
  onOpen,
}: {
  state: ReturnType<typeof foldTeam>;
  selected: TeamAgentId;
  follow: boolean;
  onFollow: (follow: boolean) => void;
  onSelect: (id: TeamAgentId) => void;
  onOpen: (id: TeamAgentId) => void;
}) {
  const manifest = TEAM_AGENTS.find((agent) => agent.id === selected);
  const view = state.agents[selected];
  const lifecycle = state.mode === "lifecycle";
  const specialist = !lifecycle && isTeamSpecialist(selected) ? selected : null;
  const latest = specialist ? view.versions.at(-1) : undefined;
  const made = lifecycle ? state.artifacts.filter((artifact) => artifact.by === selected) : [];
  return (
    <section className="team-inspector" aria-labelledby="team-inspector-title">
      <h3 id="team-inspector-title" className="sr-only">
        Agent detail
      </h3>
      <div className="arch-tabs small" role="tablist" aria-label="Agents">
        {teamAgentsFor(state.mode).map(({ id }) => (
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
        <label className="team-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => onFollow(event.target.checked)}
          />
          Follow the working agent
        </label>
      </div>
      <div className="team-inspector-body" role="tabpanel">
        <header>
          <h4>
            {manifest?.name}{" "}
            <button type="button" className="text-button" onClick={() => onOpen(selected)}>
              Full details: prompt, usage, calls
            </button>
          </h4>
          <p>{manifest?.summary}</p>
          <p className="arch-note">
            {manifest?.role === "hub" ? "Hub" : "Spoke"} ·{" "}
            {manifest?.tier === "coordinator" ? "coordinator" : "worker"} model{" "}
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
        {lifecycle && isLifecycleWorker(selected) && (
          <>
            <h5>Saved work ({made.length})</h5>
            {made.length === 0 ? (
              <p className="arch-note">Nothing saved yet.</p>
            ) : (
              made.slice(-2).map((artifact) => (
                <div key={`${artifact.name}-${artifact.version}`}>
                  <h6>
                    <code>{artifact.name}</code> · version {artifact.version} · round{" "}
                    {artifact.round}
                  </h6>
                  <ArtifactView artifact={artifact} choices={state.lifecycle?.choices} />
                </div>
              ))
            )}
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
  const [mode, setModeState] = useState<TeamMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "lifecycle" ? "lifecycle" : "squad";
    } catch {
      return "squad";
    }
  });
  const modeBriefs =
    mode === "lifecycle" ? briefs.filter((item) => runsPharmaLifecycle(item.brand)) : briefs;
  const [brief, setBrief] = useState<CampaignBrief>(
    () => modeBriefs[0] ?? briefs[0] ?? (TEAM_BRIEFS[0] as CampaignBrief),
  );
  const chooseMode = (next: TeamMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
    // A run of the other mode no longer answers what the page shows; start clean.
    if (state.id && state.mode !== next) {
      stopPlayback();
      setEvents([]);
      setFromLibrary(false);
      stamps.current = null;
      setShown(null);
      setStatus("idle");
      remember(null);
    }
    const pharma = TEAM_BRIEFS.find((item) => runsPharmaLifecycle(item.brand));
    if (next === "lifecycle" && !runsPharmaLifecycle(brief.brand) && pharma) setBrief(pharma);
  };
  const [events, setEvents] = useState<TeamEvent[]>([]);
  /**
   * Whether the page shows a run loaded from the shared library. Such a run is a recording: it
   * stays read-only after playback ends, since it may be another person's, and taking its
   * decision would resume it and call models from what is presented as a replay.
   */
  const [fromLibrary, setFromLibrary] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<ArchApiError | null>(null);
  const [selected, setSelected] = useState<TeamAgentId>(TEAM_DIRECTOR);
  /** The agent whose details are open in the modal, if any. */
  const [detail, setDetail] = useState<TeamAgentId | null>(null);
  // Off unless the reader asks: tabs never switch under them.
  const [follow, setFollow] = useState(false);
  // The phase the reader picked in the stepper; null follows the run's active phase.
  const [phasePick, setPhasePick] = useState<PhaseId | null>(null);
  const decisionSlot = useRef<HTMLDivElement>(null);
  /** Only the reader moves the page: the pill brings the decision into view when clicked. */
  const openDecision = () =>
    decisionSlot.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  // Reloaded when the top bar's AI platform changes: the open-model tier's label and models follow it.
  const { platform: aiPlatform } = useAiPlatform();
  const roster = useArch<{ providers: ProviderOption[] }>(
    "/team",
    { persona: scope.persona, brand: "all" },
    aiPlatform ? AI_PLATFORMS.indexOf(aiPlatform) + 1 : 0,
  );
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When each event on the page arrived (epoch ms), so a replay keeps the run's pacing. */
  const stamps = useRef<number[] | null>(null);
  /** The run a replay is playing, fixed when it starts. */
  const playback = useRef<{ events: TeamEvent[]; stamps: number[] | null } | null>(null);
  const [speed, setSpeed] = useState<ReplaySpeed>("2x");
  const speedNow = useRef<ReplaySpeed>(speed);
  speedNow.current = speed;
  const [paused, setPaused] = useState(false);
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
        setFromLibrary(false);
        stamps.current = null;
        const start = saved.events.find((event) => event.type === "start");
        // The page takes the run's mode and brief, so "Start a new run" runs what it shows.
        if (start?.type === "start") {
          setModeState(start.mode ?? "squad");
          setBrief(start.brief);
        }
        setStatus("done");
      })
      .catch(() => remember(null));
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const visible = shown === null ? events : events.slice(0, shown);
  const state = useMemo(() => foldTeam(visible), [visible]);

  // This session's metrics, kept in this browser: a live run counts when its request ends (it
  // finished, stopped, or waits on a person), a replay when it plays or is skipped to the end.
  // A run reopened after a reload is not new activity, so it is not counted again.
  const lastStatus = useRef<Status>(status);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = status;
    if (status !== "done" || shown !== null) return;
    if (before !== "running" && before !== "replaying") return;
    if (!state.id || !state.brief) return;
    recordSessionRun({
      runId: state.id,
      title: state.brief.title,
      brand: state.brief.brand,
      mode: state.mode,
      provider: state.infra?.provider ?? "cloudflare",
      ...(state.infra?.aiPlatform ? { aiPlatform: state.infra.aiPlatform } : {}),
      source: before === "replaying" ? "replay" : "live",
      scripted: Boolean(state.infra?.scripted),
      status: state.waiting
        ? "waiting"
        : state.done && (state.lifecycle ? state.lifecycle.finished : true)
          ? "done"
          : "stopped",
      scorecard: state.scorecard,
    });
  }, [status, shown, state]);

  // While a run plays, keep the inspector on whichever agent is working now.
  useEffect(() => {
    if (!follow || status === "done" || status === "idle") return;
    const working = teamAgentsFor(state.mode)
      .map((agent) => agent.id)
      .reverse()
      .find((id) => ["working", "revising"].includes(state.agents[id].state));
    if (working && working !== selected) setSelected(working);
  }, [state, follow, status]);

  /** A person's decision on the waiting run; the squad's next steps stream onto the same page. */
  async function decide(decision: "approve" | "changes", note: string, choice?: string) {
    const waiting = state.waiting;
    if (!waiting || !state.id || fromLibrary) return;
    setError(null);
    setStatus("running");
    startedAt.current = Date.now();
    lastEventAt.current = Date.now();
    try {
      await archStream<TeamEvent>(
        `/team/runs/${encodeURIComponent(state.id)}/decide`,
        { persona: waiting.persona, brand: "all" },
        { gate: waiting.gate, decision, note, ...(choice ? { choice } : {}) },
        (event) => {
          lastEventAt.current = Date.now();
          stamps.current?.push(Date.now());
          setEvents((current) => [...current, event]);
        },
      );
    } catch (failure) {
      setError(asError(failure));
    }
    setStatus("done");
  }

  async function run() {
    stopPlayback();
    setShown(null);
    setEvents([]);
    setFromLibrary(false);
    stamps.current = [];
    setError(null);
    setStatus("running");
    remember(null);
    startedAt.current = Date.now();
    lastEventAt.current = Date.now();
    const sample = TEAM_BRIEFS.find((item) => item.id === brief.id);
    const body = {
      ...(sample && JSON.stringify(sample) === JSON.stringify(brief)
        ? { briefId: brief.id }
        : { brief }),
      provider,
      mode,
    };
    try {
      await archStream<TeamEvent>(
        "/team/runs",
        { persona: scope.persona, brand: brief.brand as Brand },
        body,
        (event) => {
          if (event.type === "start") remember(event.id);
          lastEventAt.current = Date.now();
          stamps.current?.push(Date.now());
          setEvents((current) => [...current, event]);
        },
      );
    } catch (failure) {
      setError(asError(failure));
    }
    setStatus("done");
  }

  function stopPlayback() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  /** Shows event `index` after the gap the run had before it, then schedules the next one. */
  function playFrom(index: number) {
    stopPlayback();
    const source = playback.current;
    if (!source || index >= source.events.length || speedNow.current === "instant") {
      skip();
      return;
    }
    const delay = replayDelays(source.events.length, source.stamps, speedNow.current)[index] ?? 0;
    timer.current = setTimeout(() => {
      setShown(index + 1);
      playFrom(index + 1);
    }, delay);
  }

  /** Plays a run back event by event, at the pace it ran (long waits shortened). */
  function replay(source = { events, stamps: stamps.current }) {
    stopPlayback();
    if (source.events.length === 0) return;
    playback.current = {
      events: source.events,
      stamps: source.stamps && source.stamps.length === source.events.length ? source.stamps : null,
    };
    setPaused(false);
    setStatus("replaying");
    setShown(1);
    playFrom(1);
  }

  /** A run from the shared library: loaded onto the page and replayed. */
  function replayFromLibrary(saved: LibraryRun) {
    stopPlayback();
    setError(null);
    setPhasePick(null);
    // A library run may be someone else's; a reload should not try to reopen it as this person's.
    remember(null);
    const start = saved.events.find((event) => event.type === "start");
    // The page takes the run's mode and brief, so "Start a new run" runs what it shows.
    if (start?.type === "start") {
      setModeState(start.mode ?? "squad");
      setBrief(start.brief);
    }
    setEvents(saved.events);
    setFromLibrary(true);
    stamps.current = saved.stamps;
    replay({ events: saved.events, stamps: saved.stamps });
  }

  function pause() {
    stopPlayback();
    setPaused(true);
  }

  function resume() {
    setPaused(false);
    playFrom(shown ?? 0);
  }

  function changeSpeed(next: ReplaySpeed) {
    setSpeed(next);
    speedNow.current = next;
    if (status === "replaying" && !paused) playFrom(shown ?? 0);
  }

  function skip() {
    stopPlayback();
    playback.current = null;
    setPaused(false);
    setShown(null);
    setStatus("done");
  }

  const busy = status === "running" || status === "replaying";
  /** Decisions can be taken only on a live run, never during a replay or on a library run. */
  const live = shown === null && !fromLibrary;
  const active = teamAgentsFor(state.mode)
    .map((agent) => agent.id)
    .reverse()
    .find((id) => ["working", "revising"].includes(state.agents[id].state));
  // What the page shows: the run's own mode once there is one, the chosen mode before.
  const view = state.id ? state.mode : mode;
  const working = active
    ? `${TEAM_PARTY_LABELS[active]}: ${state.agents[active].activity ?? state.agents[active].note ?? "thinking"}`
    : "";
  const current = TEAM_PHASES.find((phase) => !state.phases.has(phase.id));
  // Which phase the workspace shows: the reader's pick, or the active phase when they haven't
  // picked one (and again after they decide, since their decision is what moves the run).
  const activePhase = (state.lifecycle?.phase ?? "focus") as PhaseId;
  const phase = phasePick ?? activePhase;
  const turnPhase = state.waiting
    ? (phaseOfGate(state.waiting.gate)?.id as PhaseId | undefined)
    : undefined;
  const openTurn = () => {
    if (turnPhase) setPhasePick(turnPhase);
    requestAnimationFrame(() =>
      decisionSlot.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };
  const lifecycleDecision =
    state.waiting && state.brief && live && state.lifecycle ? (
      <div ref={decisionSlot} className="team-decision-slot">
        <LifecycleDecisionCard
          key={`${state.waiting.gate}-${state.decisions.length}`}
          waiting={state.waiting}
          lifecycle={state.lifecycle}
          brief={state.brief}
          decisions={state.decisions}
          busy={busy}
          onDecide={(decision, note, choice) => {
            setPhasePick(null);
            void decide(decision, note, choice);
          }}
        />
      </div>
    ) : null;
  const providerName = providerShort(provider, aiPlatform).name;
  const chooser = (
    <>
      <fieldset className="arch-flow-picker">
        <legend>Sample briefs</legend>
        {modeBriefs.map((item) => (
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
        <strong>Objectives:</strong> {brief.objectives} <strong>Audience:</strong> {brief.audience}{" "}
        <strong>Budget:</strong> ${brief.budgetUsd.toLocaleString("en-US")} <strong>Window:</strong>{" "}
        {brief.start} → {brief.end}
      </p>
      <BriefForm brief={brief} onChange={setBrief} disabled={busy} />
      <ProviderSwitch
        providers={roster.data?.providers ?? null}
        value={provider}
        onChange={chooseProvider}
        disabled={busy}
      />
    </>
  );
  const lede =
    mode === "lifecycle"
      ? "A prescription brand’s campaign, end to end. The campaign lead takes the brief through business focus, ideation, content and Medical/Legal/Regulatory review, audience selection, publishing and analytics. Agents do every piece of work and code checks it against the claims library, the asset library, consent and the label; you take each decision a real brand team, MLR committee and operations team would, acting as the role it needs."
      : "Hand the squad a brief and watch it work. The campaign lead in the middle never writes a word of the campaign: it splits the brief into pieces, gives each to the spoke that owns it, decides whether to keep what comes back, and fits the pieces together. Spokes can also message one another directly when one piece depends on another. Each agent is a real model limited to its own tools, the agentic gateway checks every call, and code — not the model — enforces the brand’s rules on every piece.";
  const diagram = (
    <div className="team-diagram">
      <TeamHierarchy state={state} mode={view} onSelect={setDetail} />
      <p className="team-diagram-hint arch-note">
        Click an agent for its prompt, model, usage and calls.
      </p>
      <GuardrailPanel hits={state.guardrails} />
      <dl className="team-stats compact" aria-live="polite">
        <div>
          <dt>Messages</dt>
          <dd>{state.messages.length}</dd>
        </div>
        <div>
          <dt>{view === "lifecycle" ? "Decisions" : "Spoke to spoke"}</dt>
          <dd>
            {view === "lifecycle"
              ? state.decisions.length
              : state.messages.filter(isPeerMessage).length}
          </dd>
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
  );
  return (
    <section className="evaluations-view arch-view team-view" aria-labelledby="team-title">
      <div className="section-header">
        <div>
          <p className="kicker">
            {view === "lifecycle"
              ? "Pharma campaign lifecycle · agents and people"
              : "Campaign squad · hub and spokes"}
          </p>
          <h2 id="team-title">
            {view === "lifecycle"
              ? "Seven agents, six phases, MLR at the centre"
              : "Five agents, one campaign proposal"}
          </h2>
        </div>
        <div className="arch-header-actions">
          <fieldset className="team-mode">
            <legend className="sr-only">What the team runs</legend>
            <div className="team-switch" role="radiogroup" aria-label="Run mode">
              {(
                [
                  ["squad", "Campaign squad"],
                  ["lifecycle", "Pharma lifecycle"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className={mode === id ? "on" : ""}>
                  <input
                    type="radio"
                    name="team-mode"
                    value={id}
                    checked={mode === id}
                    disabled={busy}
                    onChange={() => chooseMode(id)}
                  />
                  <strong>{label}</strong>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" className="text-button" onClick={onClose}>
            Back to workspace
          </button>
        </div>
      </div>
      <div className="arch-body">
        <div className="arch-main">
          <section className="team-brief" aria-labelledby="team-brief-title">
            {state.id ? (
              <details className="team-setup">
                <summary>
                  <span id="team-brief-title" className="team-setup-title">
                    {state.brief?.title ?? brief.title}
                  </span>
                  <span className="team-setup-meta">
                    {state.brief?.brand ?? brief.brand} · $
                    {(state.brief?.budgetUsd ?? brief.budgetUsd).toLocaleString("en-US")} ·{" "}
                    {state.brief?.start ?? brief.start} → {state.brief?.end ?? brief.end} · on{" "}
                    {
                      // A run names where it ran; before one starts, the current choice.
                      state.infra
                        ? providerShort(state.infra.provider, state.infra.aiPlatform ?? null).name
                        : providerName
                    }
                  </span>
                  <span className="team-setup-open">Change brief or provider</span>
                </summary>
                <p className="arch-lede">{lede}</p>
                {chooser}
              </details>
            ) : (
              <>
                <p className="arch-lede">{lede}</p>
                <h3 id="team-brief-title">Choose a brief</h3>
                {chooser}
              </>
            )}
            <div className="team-actions">
              <button
                type="button"
                className="arch-primary"
                disabled={
                  busy ||
                  chosen?.available === false ||
                  (mode === "lifecycle" && !runsPharmaLifecycle(brief.brand))
                }
                onClick={() => {
                  setPhasePick(null);
                  void run();
                }}
              >
                {status === "running"
                  ? "The team is working…"
                  : state.id
                    ? "Start a new run"
                    : mode === "lifecycle"
                      ? "Start the campaign lifecycle"
                      : "Hand the brief to the squad"}
              </button>
              {status === "replaying" ? (
                <div className="team-replay-controls">
                  <button type="button" className="text-button" onClick={paused ? resume : pause}>
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <label>
                    Speed{" "}
                    <select
                      value={speed}
                      onChange={(event) => changeSpeed(event.target.value as ReplaySpeed)}
                    >
                      {REPLAY_SPEEDS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="text-button" onClick={skip}>
                    Skip to the end
                  </button>
                  <small role="status">
                    Replaying · event {shown ?? events.length} of {events.length}
                    {paused ? " · paused" : ""}
                  </small>
                </div>
              ) : (
                events.length > 0 &&
                status !== "running" && (
                  <button type="button" className="text-button" onClick={() => replay()}>
                    Replay agent by agent
                  </button>
                )
              )}
              <RunLibrary
                scope={scope}
                disabled={status === "running"}
                currentId={state.id}
                onPick={replayFromLibrary}
              />
              {fromLibrary && status === "done" && (
                <small className="arch-note" role="status">
                  A recorded run from the library: read-only
                  {state.waiting
                    ? `, stopped where it waited for the ${TEAM_GATES[state.waiting.gate].decider.toLowerCase()}`
                    : ""}
                  . Start a new run to take decisions.
                </small>
              )}
              {status === "running" && startedAt.current ? (
                <small className="team-clock" role="status">
                  Working · {clock(now - startedAt.current)} · last update{" "}
                  {Math.max(0, Math.round((now - (lastEventAt.current ?? now)) / 1000))} s ago
                  {working ? ` · ${working}` : ""}
                </small>
              ) : state.done ? (
                <small
                  className={`team-done-inline ${state.strategy || state.lifecycle?.finished ? "" : "stopped"}`}
                  role="status"
                >
                  {state.done.summary}
                </small>
              ) : (
                <small>
                  Real models on {providerName}; a run takes a few minutes and differs each time.
                </small>
              )}
            </div>
          </section>

          {error && <ErrorNote error={error} />}
          {state.error && (
            <p className="team-error" role="alert">
              {state.error}
            </p>
          )}

          {view === "lifecycle" ? (
            <>
              <PhaseStepper
                lifecycle={state.lifecycle}
                selected={phase}
                waiting={live ? state.waiting : null}
                following={phase === activePhase}
                onSelect={(id) => setPhasePick(id)}
              />
              <div className="team-life">
                <PhaseWorkspace
                  phase={phase}
                  lifecycle={state.lifecycle}
                  artifacts={state.artifacts}
                  waiting={live ? state.waiting : null}
                  decision={lifecycleDecision}
                  onOpenTurn={(id) => setPhasePick(id)}
                />
                <aside className="team-rail" aria-label="Live activity">
                  {diagram}
                  <MessageFeed messages={state.messages} title="Team conversation" />
                </aside>
              </div>
            </>
          ) : (
            <>
              <ol className="team-steps" aria-label="Progress">
                {TEAM_PHASES.map((item) => (
                  <li
                    key={item.id}
                    className={
                      state.phases.has(item.id)
                        ? "reached"
                        : busy && current?.id === item.id
                          ? "current"
                          : ""
                    }
                    aria-current={busy && current?.id === item.id ? "step" : undefined}
                  >
                    <span aria-hidden="true" />
                    {item.label}
                    {item.id === "pieces" ? ` (${state.kept}/4)` : ""}
                  </li>
                ))}
              </ol>
              <div className="team-grid">
                {diagram}
                <MessageFeed messages={state.messages} />
              </div>
            </>
          )}

          <UnderTheHood
            state={state}
            selected={selected}
            follow={follow}
            onFollow={setFollow}
            onSelect={(id) => {
              setFollow(false);
              setSelected(id);
            }}
            onOpen={setDetail}
          />

          {/* The squad's decision is added below what's above, so nothing the reader is looking
              at moves; the lifecycle's sits in its phase's workspace. */}
          {view !== "lifecycle" && (
            <div ref={decisionSlot}>
              {state.waiting && state.brief && live && !state.lifecycle && (
                <DecisionCard
                  waiting={state.waiting}
                  strategy={state.strategy}
                  brief={state.brief}
                  decisions={state.decisions}
                  busy={busy}
                  onDecide={(decision, note) => void decide(decision, note)}
                />
              )}
            </div>
          )}

          {state.waiting && live && !busy && (
            <button
              type="button"
              className="team-turn-pill"
              onClick={view === "lifecycle" ? openTurn : openDecision}
            >
              Your turn: {TEAM_GATES[state.waiting.gate].label} →
            </button>
          )}
          {state.strategy && state.brief && (
            <StrategyView strategy={state.strategy} brief={state.brief} />
          )}
        </div>
      </div>
      {detail && <AgentModal state={state} agent={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

type HoodTab = "agents" | "infra" | "semantic" | "evals" | "decisions";

/**
 * Everything under the agents, in one panel: each agent's grants and calls, the infrastructure,
 * the semantic layer, the scorecard, and the decisions people took. The tab changes only when the
 * reader picks one.
 */
function UnderTheHood({
  state,
  selected,
  follow,
  onFollow,
  onSelect,
  onOpen,
}: {
  state: ReturnType<typeof foldTeam>;
  selected: TeamAgentId;
  follow: boolean;
  onFollow: (follow: boolean) => void;
  onSelect: (id: TeamAgentId) => void;
  onOpen: (id: TeamAgentId) => void;
}) {
  const [tab, setTab] = useState<HoodTab>("agents");
  const tabs: Array<[HoodTab, string]> = [
    ["agents", "Agents"],
    ["infra", "Agent infrastructure"],
    ["semantic", "Semantic layer"],
    ["evals", `Evals${state.scorecard ? ` · ${state.scorecard.overall}` : ""}`],
    [
      "decisions",
      `Decisions${state.decisions.length ? ` (${state.decisions.length})` : ""}${state.conflicts.length ? ` · ${state.conflicts.length} clashes` : ""}`,
    ],
  ];
  return (
    <section className="team-hood" aria-labelledby="team-hood-title">
      <header>
        <h3 id="team-hood-title">Under the hood</h3>
        <div className="arch-tabs small" role="tablist" aria-label="Under the hood">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel">
        {tab === "agents" ? (
          <AgentInspector
            state={state}
            selected={selected}
            follow={follow}
            onFollow={onFollow}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ) : tab === "infra" ? (
          <InfrastructurePanel state={state} />
        ) : tab === "semantic" ? (
          <SemanticLayerPanel state={state} />
        ) : tab === "evals" ? (
          <EvalsPanel state={state} />
        ) : (
          <>
            {state.decisions.length === 0 ? (
              <p className="arch-note">No person has decided anything on this run yet.</p>
            ) : (
              <DecisionLog decisions={state.decisions} />
            )}
            {state.conflicts.length > 0 && (
              <div className="team-conflicts">
                <h4>Clashes the lead had to resolve</h4>
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
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
