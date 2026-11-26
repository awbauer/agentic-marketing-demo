// The squad as a live hub-and-spoke map: the campaign lead sits in the middle, the four spokes sit
// around it, the brief arrives from the left and the proposal leaves on the right. Spokes that talk
// to each other get a curve between them. Each node shows its agent's state, and the line a
// message is travelling along right now is lit. Every agent node opens that agent's details.
import {
  isLifecycleWorker,
  type LifecycleWorker,
  TEAM_DIRECTOR,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  type TeamAgentId,
  type TeamMode,
} from "@northstar/architecture";
import type { KeyboardEvent } from "react";
import type { TeamMessage, TeamState } from "./team-state";

type Point = { x: number; y: number };

const HUB: Point = { x: 360, y: 230 };
const RING = 150;
/** Spokes sit at the corners of the ring, so the brief and proposal lines run clear of them. */
const SQUAD_SPOKES: Partial<Record<LifecycleWorker, Point>> = {
  "audience-analyst": { x: HUB.x - RING, y: HUB.y - 120 },
  "art-director": { x: HUB.x + RING, y: HUB.y - 120 },
  "copy-lead": { x: HUB.x + RING, y: HUB.y + 120 },
  "channel-planner": { x: HUB.x - RING, y: HUB.y + 120 },
};
/** The lifecycle's six spokes: three above the hub and three below, in the order they work. */
const LIFECYCLE_SPOKES: Partial<Record<LifecycleWorker, Point>> = {
  "audience-analyst": { x: HUB.x - 175, y: HUB.y - 125 },
  "art-director": { x: HUB.x, y: HUB.y - 168 },
  "copy-lead": { x: HUB.x + 175, y: HUB.y - 125 },
  "mlr-coordinator": { x: HUB.x + 175, y: HUB.y + 125 },
  "channel-planner": { x: HUB.x, y: HUB.y + 168 },
  "performance-analyst": { x: HUB.x - 175, y: HUB.y + 125 },
};
/** The people a lifecycle run waits on. */
const PEOPLE = new Set(["brand-lead", "medical", "legal", "regulatory", "marketing-ops", "market"]);
const BRIEF: Point = { x: 62, y: HUB.y };
const PROPOSAL: Point = { x: 658, y: HUB.y };
/** The compliance reviewer, a person, sits outside the ring between the hub and the client. */
const COMPLIANCE: Point = { x: 650, y: 52 };
const HUB_R = 58;
const SPOKE_W = 150;
const SPOKE_H = 50;

const ICON: Record<LifecycleWorker, string> = {
  "audience-analyst": "◎",
  "art-director": "◐",
  "copy-lead": "❝",
  "channel-planner": "▦",
  "mlr-coordinator": "§",
  "performance-analyst": "↗",
};

type EdgeId = "brief" | "proposal" | "compliance" | `spoke:${LifecycleWorker}` | `chord:${string}`;

const isSpoke = (party: string): party is LifecycleWorker => isLifecycleWorker(party);
const chordId = (a: LifecycleWorker, b: LifecycleWorker) =>
  `chord:${[a, b].sort().join("|")}` as const;

/** The lines a message travels along. */
function edgesOf(message: TeamMessage, spokes: readonly LifecycleWorker[]): EdgeId[] {
  if (message.from === "compliance" || message.to === "compliance") return ["compliance"];
  if (message.from === "client") return message.kind === "decision" ? ["proposal"] : ["brief"];
  if (message.to === "client") return ["proposal"];
  if (message.kind === "brief") return ["brief"];
  if (PEOPLE.has(message.from) || PEOPLE.has(message.to)) {
    const spoke = isSpoke(message.from) ? message.from : isSpoke(message.to) ? message.to : null;
    return spoke ? [`spoke:${spoke}`, "proposal"] : ["proposal"];
  }
  if (message.to === "team") return spokes.map((id) => `spoke:${id}` as const);
  if (isSpoke(message.from) && isSpoke(message.to)) return [chordId(message.from, message.to)];
  const spoke = isSpoke(message.from) ? message.from : isSpoke(message.to) ? message.to : null;
  return spoke ? [`spoke:${spoke}`] : [];
}

const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A point `distance` along the line from one point toward another. */
function toward(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}

/** Props that make an SVG node act as a button: click, Enter or Space opens the agent. */
function opens(id: TeamAgentId, label: string, onSelect?: (id: TeamAgentId) => void) {
  if (!onSelect) return {};
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `${label}: open agent details`,
    onClick: () => onSelect(id),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(id);
      }
    },
  } as const;
}

export function TeamHierarchy({
  state,
  mode = "squad",
  onSelect,
}: {
  state: TeamState;
  mode?: TeamMode;
  /** Opens an agent's details; the nodes are buttons when it is given. */
  onSelect?: (id: TeamAgentId) => void;
}) {
  const SPOKE = (mode === "lifecycle" ? LIFECYCLE_SPOKES : SQUAD_SPOKES) as Record<
    LifecycleWorker,
    Point
  >;
  const spokes = Object.keys(SPOKE) as LifecycleWorker[];
  const lifecycle = mode === "lifecycle";
  const used = new Set(state.messages.flatMap((message) => edgesOf(message, spokes)));
  const live = new Set(state.latest ? edgesOf(state.latest, spokes) : []);
  const edgeClass = (id: EdgeId, extra = "") =>
    `team-edge${extra}${used.has(id) ? " used" : ""}${live.has(id) ? " live" : ""}`;
  const note = (id: TeamAgentId) => {
    const view = state.agents[id];
    if ((view.state === "working" || view.state === "revising") && view.activity)
      return view.activity;
    if (view.note) return view.note;
    if (view.state === "done")
      return id === TEAM_DIRECTOR
        ? lifecycle
          ? "Done"
          : "Proposal sent"
        : lifecycle
          ? "Work accepted"
          : "Kept";
    if (view.state === "waiting") return lifecycle ? "Handed back to the lead" : "With the lead";
    if (view.state === "blocked") return lifecycle ? "Paused" : "Stuck";
    return view.state === "idle" ? (lifecycle ? "Not started" : "Idle") : "";
  };
  const chords = spokes
    .flatMap((a, i) => spokes.slice(i + 1).map((b) => [a, b] as const))
    .filter(([a, b]) => used.has(chordId(a, b)));
  const lead = state.agents[TEAM_DIRECTOR];
  const waitingOn = state.waiting?.gate ?? null;
  const reviewed = state.decisions.filter((decision) => decision.gate === "compliance");
  const lastReview = reviewed.at(-1);
  const summary = [TEAM_DIRECTOR, ...spokes]
    .map((id) => `${TEAM_PARTY_LABELS[id]}: ${state.agents[id].state}`)
    .join("; ");
  return (
    <svg
      className="team-hierarchy"
      viewBox="0 0 720 460"
      role="img"
      aria-label={`Hub-and-spoke map of the ${lifecycle ? "lifecycle team" : "squad"}. ${summary}.`}
    >
      <circle cx={HUB.x} cy={HUB.y} r={RING + 46} className="team-ring" />
      <line
        x1={BRIEF.x + 46}
        y1={BRIEF.y}
        x2={HUB.x - HUB_R - 4}
        y2={HUB.y}
        className={edgeClass("brief")}
      />
      <line
        x1={HUB.x + HUB_R + 4}
        y1={HUB.y}
        x2={PROPOSAL.x - 46}
        y2={PROPOSAL.y}
        className={edgeClass("proposal")}
      />
      {spokes.map((id) => {
        const start = toward(HUB, SPOKE[id], HUB_R + 3);
        const end = toward(SPOKE[id], HUB, 30);
        return (
          <line
            key={id}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            className={edgeClass(`spoke:${id}`)}
          />
        );
      })}
      {chords.map(([a, b]) => {
        const from = SPOKE[a];
        const to = SPOKE[b];
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        // Bow the curve outward, away from the hub; a diagonal pair passes over the top instead.
        const centred = Math.hypot(mid.x - HUB.x, mid.y - HUB.y) < 1;
        const through = centred
          ? { x: HUB.x, y: HUB.y - 175 }
          : toward(HUB, mid, Math.hypot(mid.x - HUB.x, mid.y - HUB.y) + 60);
        return (
          <path
            key={`${a}|${b}`}
            d={`M ${from.x} ${from.y} Q ${through.x} ${through.y} ${to.x} ${to.y}`}
            className={edgeClass(chordId(a, b), " team-edge-peer")}
            fill="none"
          />
        );
      })}

      <g className={`team-node team-node-endpoint is-${state.brief ? "done" : "idle"}`}>
        <rect x={BRIEF.x - 46} y={BRIEF.y - 26} width={92} height={52} rx={26} />
        <text x={BRIEF.x} y={BRIEF.y - 3} textAnchor="middle" className="team-node-title">
          Brief
        </text>
        <text x={BRIEF.x} y={BRIEF.y + 14} textAnchor="middle" className="team-node-note">
          {state.brief ? short(state.brief.brand, 14) : lifecycle ? "from brand" : "from client"}
        </text>
      </g>
      {(used.has("compliance") || waitingOn === "compliance") && (
        <path
          d={`M ${HUB.x + HUB_R * 0.7} ${HUB.y - HUB_R * 0.7} Q ${HUB.x + 160} ${COMPLIANCE.y + 10} ${COMPLIANCE.x - 50} ${COMPLIANCE.y}`}
          className={edgeClass("compliance")}
          fill="none"
        />
      )}
      {(used.has("compliance") || waitingOn === "compliance") && (
        <g
          className={`team-node team-node-person is-${waitingOn === "compliance" ? "waiting-person" : lastReview?.decision === "approve" ? "done" : "idle"}`}
        >
          <rect x={COMPLIANCE.x - 50} y={COMPLIANCE.y - 24} width={100} height={48} rx={24} />
          <text
            x={COMPLIANCE.x}
            y={COMPLIANCE.y - 3}
            textAnchor="middle"
            className="team-node-title"
          >
            Compliance
          </text>
          <text
            x={COMPLIANCE.x}
            y={COMPLIANCE.y + 13}
            textAnchor="middle"
            className="team-node-note"
          >
            {waitingOn === "compliance"
              ? "your turn"
              : lastReview
                ? lastReview.decision === "approve"
                  ? "approved"
                  : "changes asked"
                : "a person"}
          </text>
        </g>
      )}
      <g
        className={`team-node team-node-endpoint ${(lifecycle ? waitingOn : waitingOn === "client") ? "team-node-person is-waiting-person" : `is-${state.strategy || state.lifecycle?.finished ? "done" : "idle"}`}`}
      >
        <rect x={PROPOSAL.x - 46} y={PROPOSAL.y - 26} width={92} height={52} rx={26} />
        <text x={PROPOSAL.x} y={PROPOSAL.y - 3} textAnchor="middle" className="team-node-title">
          {lifecycle ? "People" : "Proposal"}
        </text>
        <text x={PROPOSAL.x} y={PROPOSAL.y + 14} textAnchor="middle" className="team-node-note">
          {lifecycle
            ? waitingOn
              ? short(TEAM_GATES[waitingOn].decider, 14)
              : state.lifecycle?.finished
                ? "all decided"
                : `${state.decisions.length} decisions`
            : waitingOn === "client"
              ? "your turn"
              : state.phases.has("approved")
                ? "approved"
                : state.strategy && state.phases.has("proposal")
                  ? "sent"
                  : "to client"}
        </text>
      </g>

      <g
        className={`team-node team-node-director is-${lead.state}${onSelect ? " team-node-clickable" : ""}`}
        {...opens(TEAM_DIRECTOR, `Campaign lead, ${lead.state}`, onSelect)}
      >
        <title>Campaign lead: click for details</title>
        <circle cx={HUB.x} cy={HUB.y} r={HUB_R} />
        <text x={HUB.x} y={HUB.y - 4} textAnchor="middle" className="team-node-title">
          Campaign lead
        </text>
        <text x={HUB.x} y={HUB.y + 14} textAnchor="middle" className="team-node-note">
          {short(note(TEAM_DIRECTOR), 18)}
        </text>
        {(lead.state === "working" || lead.state === "revising") && (
          <circle cx={HUB.x + 40} cy={HUB.y - 40} r={5} className="team-node-pulse" />
        )}
      </g>

      {spokes.map((id) => {
        const at = SPOKE[id];
        const view = state.agents[id];
        return (
          <g
            key={id}
            className={`team-node team-node-specialist is-${view.state}${onSelect ? " team-node-clickable" : ""}`}
            {...opens(id, `${TEAM_PARTY_LABELS[id]}, ${view.state}`, onSelect)}
          >
            <title>{`${TEAM_PARTY_LABELS[id]}: click for details`}</title>
            <rect
              x={at.x - SPOKE_W / 2}
              y={at.y - SPOKE_H / 2}
              width={SPOKE_W}
              height={SPOKE_H}
              rx={8}
            />
            <text x={at.x - SPOKE_W / 2 + 12} y={at.y - 4} className="team-node-title">
              <tspan className="team-node-step">{ICON[id]}</tspan> {TEAM_PARTY_LABELS[id]}
            </text>
            <text x={at.x - SPOKE_W / 2 + 12} y={at.y + 14} className="team-node-note">
              {short(note(id))}
              {view.revisions ? ` · back ${view.revisions}×` : ""}
            </text>
            {(view.state === "working" || view.state === "revising") && (
              <circle
                cx={at.x + SPOKE_W / 2 - 12}
                cy={at.y - SPOKE_H / 2 + 12}
                r={5}
                className="team-node-pulse"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
