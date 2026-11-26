// The campaign squad page: hand over a brief, then follow a campaign lead and four spokes as
// they work it one agent at a time — each assignment, hand-back, side question, send-back and
// tool call — until the proposal goes to the client.
import {
  agentEvidence,
  BRANDS,
  type Brand,
  type CampaignBrief,
  isTeamProvider,
  type PHARMA_PHASES,
  phaseOfGate,
  runsPharmaLifecycle,
  seededOutcome,
  TEAM_BRIEFS,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  TEAM_PROVIDERS,
  type TeamAgentId,
  type TeamEvent,
  type TeamMode,
  type TeamProvider,
  teamAgentsFor,
  teamOpenModels,
} from "@northstar/architecture";
import { AI_PLATFORM_TERMS, AI_PLATFORMS, hostTerms } from "@northstar/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAiPlatform } from "../ai-platform";
import { ArchApiError, archFetch, archStream, useArch } from "../architecture/api";
import { ErrorNote } from "../architecture/Shared";
import { useScope } from "../scope";
import { AgentModal } from "./AgentModal";
import { ClaimsProvider, claimIndex } from "./Claims";
import { TechnicalProvider, Term, useTechnicalSetting } from "./detail";
import { GuardrailPanel } from "./Guardrails";
import { LifecycleStats, LifecycleStatus } from "./LifecycleSummary";
import { RichText } from "./RichText";
import { type LibraryRun, RunLibrary } from "./RunLibrary";
import { REPLAY_SPEEDS, type ReplaySpeed, replayDelays } from "./replay";
import { SourcesProvider, sourceIndex } from "./Sources";
import { recordSessionRun, resetSessionMetrics } from "./session-metrics";
import { TeamHierarchy } from "./TeamHierarchy";
import {
  ARTIFACT_TITLES,
  LifecycleDecisionCard,
  PhaseStepper,
  PhaseWorkspace,
} from "./TeamLifecycle";
import { DecisionCard, DecisionLog, ReviewerMetricsTable, SignOffRecord } from "./TeamPeople";
import { EvalsPanel, InfrastructurePanel, SemanticLayerPanel } from "./TeamPlatform";
import { StrategyView } from "./TeamWork";
import { ToolLibrary } from "./ToolLibrary";
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
              ["lead", "Via the lead"],
              ["peer", `Agent to agent (${peers})`],
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

/**
 * The agents at a glance: what each is doing, its model, its calls and the guardrails it ran into.
 * Everything else about an agent (prompts, usage, messages, every call, its work) is in its
 * details, one click away, so this list doesn't repeat it.
 */
function AgentRoster({
  state,
  onOpen,
}: {
  state: ReturnType<typeof foldTeam>;
  onOpen: (id: TeamAgentId) => void;
}) {
  return (
    <div className="team-table-wrap">
      <table className="team-table team-roster">
        <caption className="sr-only">The agents on this run</caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Now</th>
            <th scope="col">Model</th>
            <th scope="col">Tool calls</th>
            <th scope="col">Guardrails</th>
          </tr>
        </thead>
        <tbody>
          {teamAgentsFor(state.mode).map((agent) => {
            const view = state.agents[agent.id];
            const hits = state.guardrails
              .filter((hit) => hit.agent === agent.id)
              .reduce((sum, hit) => sum + hit.count, 0);
            return (
              <tr key={agent.id}>
                <th scope="row">
                  <button type="button" className="text-button" onClick={() => onOpen(agent.id)}>
                    {agent.name}
                  </button>
                  <small>
                    {" "}
                    {agent.role === "hub" ? "hub" : "spoke"} · {agent.tier}
                  </small>
                </th>
                <td>
                  <i className={`team-dot is-${view.state}`} aria-hidden="true" /> {view.state}
                  {view.note ? <small> · {view.note}</small> : null}
                </td>
                <td>
                  <code>{(state.models[agent.id] ?? "—").replace("@cf/", "")}</code>
                </td>
                <td>{view.tools.length}</td>
                <td>{hits ? `${hits} caught` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="arch-note">
        Click an agent (here or on the team map) for its prompts, usage, messages, every tool call
        and its work.
      </p>
    </div>
  );
}

/** The Campaign team view. */
export function TeamView({ onClose }: { onClose: () => void }) {
  const { scope } = useScope();
  const [technical, setTechnical] = useTechnicalSetting();
  // Whether the decision card is on screen: the "Your turn" pill then has nothing to point to,
  // and on a phone it would sit over the card's own buttons.
  const [cardInView, setCardInView] = useState(false);
  const briefs = TEAM_BRIEFS.filter(
    (brief) => scope.brand === "all" || brief.brand === scope.brand,
  );
  // A seeded flaw tests the MLR reviewers: one flawed module slipped into their queue.
  const [seedFlaw, setSeedFlaw] = useState(false);
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
  /** The agent whose details are open in the modal, if any. */
  const [detail, setDetail] = useState<TeamAgentId | null>(null);
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
  // Every claim on the page opens the library's details, as the run's agents read them.
  const claims = useMemo(() => claimIndex(state), [state]);
  // So does every other source ID the agents cite: segments, signals, competitors, images, …
  const sources = useMemo(() => sourceIndex(state), [state]);

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
      tools: [
        ...new Set(
          Object.values(state.agents).flatMap((view) => view.tools.map((step) => step.tool)),
        ),
      ],
      status: state.waiting
        ? "waiting"
        : state.done && (state.lifecycle ? state.lifecycle.finished : true)
          ? "done"
          : "stopped",
      scorecard: state.scorecard,
      ...(state.mode === "lifecycle" ? { agents: agentEvidence(visible) } : {}),
    });
  }, [status, shown, state, visible]);

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

  /**
   * Starts this browser's squad session over: clears the run on the page, the remembered run and
   * this session's metrics (and with them the tool library's session highlights). Runs saved to the
   * shared library stay there.
   */
  function resetSession() {
    stopPlayback();
    setEvents([]);
    setFromLibrary(false);
    stamps.current = null;
    setShown(null);
    setError(null);
    setStatus("idle");
    setDetail(null);
    setPhasePick(null);
    remember(null);
    resetSessionMetrics();
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
      ...(mode === "lifecycle" && seedFlaw ? { seededFlaw: true } : {}),
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
          seeding={state.practice.seededFlaw}
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
  useEffect(() => {
    const card = state.waiting ? document.querySelector(".team-decision-card") : null;
    if (!card || typeof IntersectionObserver === "undefined") {
      setCardInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setCardInView(Boolean(entry?.isIntersecting)),
      {
        threshold: 0.05,
      },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [state.waiting, phase]);
  const lede =
    mode === "lifecycle" ? (
      <>
        A prescription brand’s HCP campaign, from brief to results, in the stages your team already
        runs.
        <ul className="team-lede-points">
          <li>
            <strong>AI agents do the preparation:</strong> focus areas, concepts, modular content,
            the MLR submission, the HCP list, the deployment schedule, the 2253 package and the
            performance read.
          </li>
          <li>
            <strong>Code pre-checks every piece</strong> against the claims library, the asset
            library, consent and the label before a person sees it. A pre-check never replaces
            Medical, Legal or Regulatory review.
          </li>
          <li>
            <strong>People make every decision:</strong> you act as the brand lead, Medical, Legal,
            Regulatory and Marketing Ops, each at the point they would sign off today.
          </li>
        </ul>
      </>
    ) : (
      "Hand the squad a brief and watch it work. The campaign lead in the middle never writes a word of the campaign: it splits the brief into pieces, gives each to the spoke that owns it, decides whether to keep what comes back, and fits the pieces together. Spokes can also message one another directly when one piece depends on another. Each agent is a real model limited to its own tools, the agentic gateway checks every call, and code — not the model — enforces the brand’s rules on every piece."
    );
  const diagram = (
    <div className="team-diagram">
      <TeamHierarchy state={state} mode={view} onSelect={setDetail} />
      {/* On a phone the map's labels are too small to tap: the same agents as buttons. */}
      <fieldset className="team-agent-chips">
        <legend className="sr-only">Open an agent's details</legend>
        {teamAgentsFor(view).map((agent) => (
          <button key={agent.id} type="button" onClick={() => setDetail(agent.id)}>
            <i className={`team-dot is-${state.agents[agent.id].state}`} aria-hidden="true" />{" "}
            {agent.name}
          </button>
        ))}
      </fieldset>
      <p className="team-diagram-hint arch-note">
        {view === "lifecycle"
          ? "The project lead agent in the middle routes each step to an agent or a person. Click an agent to see what it does, its guardrails and exactly how it ran."
          : "Click an agent for its prompt, model, usage and calls."}
      </p>
      {view === "lifecycle" ? (
        <LifecycleStats state={state} technical={technical} />
      ) : (
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
            <dt>
              <Term term="tool call">Tool calls</Term>
            </dt>
            <dd>{state.toolCalls}</dd>
          </div>
          <div>
            <dt>
              <Term term="gateway">Gateway denials</Term>
            </dt>
            <dd>{state.denied}</dd>
          </div>
          {state.done && (
            <>
              <div>
                <dt>
                  <Term term="tokens">Tokens</Term>
                </dt>
                <dd>{state.done.tokens.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{Math.round(state.done.latencyMs / 1000)} s</dd>
              </div>
            </>
          )}
        </dl>
      )}
    </div>
  );
  return (
    <TechnicalProvider value={technical}>
      <ClaimsProvider value={claims}>
        <SourcesProvider value={sources}>
          <section className="evaluations-view arch-view team-view" aria-labelledby="team-title">
            <div className="section-header">
              <div>
                <p className="kicker">
                  {view === "lifecycle"
                    ? "Pharma campaign lifecycle · AI agents prepare, people sign off"
                    : "Campaign squad · hub and spokes"}
                </p>
                <h2 id="team-title">
                  {view === "lifecycle"
                    ? "From brief to results, with MLR at the centre"
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
                <label
                  className="team-technical"
                  title="Show tool names, model ids, token counts and the lead's raw instructions inline. Off, they stay one click away."
                >
                  <input
                    type="checkbox"
                    checked={technical}
                    onChange={(event) => setTechnical(event.target.checked)}
                  />
                  Technical detail
                </label>
                <button
                  type="button"
                  className="team-reset"
                  onClick={resetSession}
                  disabled={busy}
                  title="Clear the run on this page and this session's metrics; the shared run library is kept"
                >
                  Reset session
                </button>
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
                              ? providerShort(state.infra.provider, state.infra.aiPlatform ?? null)
                                  .name
                              : providerName
                          }
                        </span>
                        <span className="team-setup-open">Change brief or provider</span>
                      </summary>
                      <div className="arch-lede">{lede}</div>
                      {chooser}
                    </details>
                  ) : (
                    <>
                      <div className="arch-lede">{lede}</div>
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
                    {mode === "lifecycle" && (
                      <label
                        className="team-seed-toggle"
                        title="The MLR system slips one deliberately flawed module into the review queue and scores whether a reviewer catches it. It is withdrawn before approval either way."
                      >
                        <input
                          type="checkbox"
                          checked={seedFlaw}
                          disabled={busy}
                          onChange={(event) => setSeedFlaw(event.target.checked)}
                        />
                        Seed a flawed module for the MLR reviewers
                      </label>
                    )}
                    {status === "replaying" ? (
                      <div className="team-replay-controls">
                        <button
                          type="button"
                          className="text-button"
                          onClick={paused ? resume : pause}
                        >
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
                    ) : state.done && state.lifecycle ? (
                      <LifecycleStatus
                        lifecycle={state.lifecycle}
                        summary={state.done.summary}
                        waiting={Boolean(state.waiting)}
                        technical={technical}
                      />
                    ) : state.done ? (
                      <small
                        className={`team-done-inline ${state.strategy ? "" : "stopped"}`}
                        role="status"
                      >
                        {state.done.summary}
                      </small>
                    ) : (
                      <small>
                        Real models on {providerName}; a run takes a few minutes and differs each
                        time.
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
                        guardrails={state.guardrails}
                        gaps={state.gaps}
                        seeded={seededOutcome(visible)}
                      />
                      <aside className="team-rail" aria-label="Live activity">
                        {diagram}
                        <SignOffRecord decisions={state.decisions} titles={ARTIFACT_TITLES} />
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
                  key={view}
                  state={state}
                  onOpen={setDetail}
                  lifecycle={view === "lifecycle"}
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

                {state.waiting && live && !busy && !cardInView && (
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
        </SourcesProvider>
      </ClaimsProvider>
    </TechnicalProvider>
  );
}

type HoodTab = "agents" | "guardrails" | "tools" | "infra" | "semantic" | "evals" | "decisions";

/**
 * Everything under the agents, in one panel: each agent's grants and calls, the infrastructure,
 * the semantic layer, the scorecard, and the decisions people took. The tab changes only when the
 * reader picks one.
 */
/** Each tab in a content team's words, under its name. */
const HOOD_EXPLAINERS: Record<HoodTab, string> = {
  decisions: "Who signed off what, which version, when, and in their words.",
  guardrails: "What the pre-checks, access control and limits stopped, and why.",
  agents: "Each agent's state, model and actions. Click one for everything it did.",
  evals: "How well this run followed the process, scored from what happened.",
  semantic: "The data dictionary: the governed definitions agents must use and cite.",
  tools: "Every action an agent can be granted, and which were used.",
  infra: "Where the models and the agents run, and what each event passes through.",
};

function UnderTheHood({
  state,
  onOpen,
  lifecycle,
}: {
  state: ReturnType<typeof foldTeam>;
  onOpen: (id: TeamAgentId) => void;
  lifecycle: boolean;
}) {
  const [tab, setTab] = useState<HoodTab>(lifecycle ? "decisions" : "agents");
  const all: Array<[HoodTab, string]> = [
    ["agents", "Agents"],
    [
      "guardrails",
      `${lifecycle ? "Checks & guardrails" : "Guardrails"}${state.guardrails.length ? ` · ${state.guardrails.reduce((sum, hit) => sum + hit.count, 0)} caught` : ""}`,
    ],
    ["tools", "Tool library"],
    ["infra", "Agent infrastructure"],
    ["semantic", "Semantic layer"],
    [
      "evals",
      `${lifecycle ? "Quality score" : "Evals"}${state.scorecard ? ` · ${state.scorecard.overall}` : ""}`,
    ],
    [
      "decisions",
      `${lifecycle ? "Sign-off record" : "Decisions"}${state.decisions.length ? ` (${state.decisions.length})` : ""}${state.conflicts.length ? ` · ${state.conflicts.length} clashes` : ""}`,
    ],
  ];
  // For the lifecycle, the audit trail and the checks come first: they are what a brand or MLR
  // reader looks for.
  const order: HoodTab[] = lifecycle
    ? ["decisions", "guardrails", "agents", "evals", "semantic", "tools", "infra"]
    : ["agents", "guardrails", "tools", "infra", "semantic", "evals", "decisions"];
  const tabs = order.map((id) => all.find(([key]) => key === id) as [HoodTab, string]);
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
        <p className="team-hood-explainer arch-note">{HOOD_EXPLAINERS[tab]}</p>
        {tab === "agents" ? (
          <AgentRoster state={state} onOpen={onOpen} />
        ) : tab === "guardrails" ? (
          state.guardrails.length ? (
            <GuardrailPanel hits={state.guardrails} />
          ) : (
            <p className="arch-note">
              No guardrail has stopped an agent on this run yet. When a rule check refuses a save,
              the policy gateway denies a call or a tool rejects its input, it shows here with what
              the rule protects.
            </p>
          )
        ) : tab === "tools" ? (
          <ToolLibrary state={state} />
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
              <>
                <DecisionLog decisions={state.decisions} titles={ARTIFACT_TITLES} />
                <ReviewerMetricsTable decisions={state.decisions} />
              </>
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
