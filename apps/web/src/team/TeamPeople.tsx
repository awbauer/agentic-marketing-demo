// The people in the loop. When the squad stops for a decision no agent may take, the person at the
// browser takes it, acting as the role it needs: the compliance reviewer for a regulated brand's
// copy, and the client for the proposal. The server checks the role; agents can never decide.
import {
  CLIENT_ROUNDS,
  type CampaignBrief,
  type CampaignStrategy,
  MEDIA_CHANNEL_LABELS,
  PERSONA_LABELS,
  TEAM_GATES,
  type TeamEvent,
} from "@northstar/architecture";
import { useEffect, useRef, useState } from "react";

type Waiting = Extract<TeamEvent, { type: "await-person" }>;
type Decided = Extract<TeamEvent, { type: "decided" }>;

/** What the reviewer checks: every placement's copy and its disclosure. */
function CopyUnderReview({ strategy }: { strategy: CampaignStrategy }) {
  return (
    <div className="team-table-wrap">
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Placement</th>
            <th scope="col">Headline</th>
            <th scope="col">Body and disclosure</th>
          </tr>
        </thead>
        <tbody>
          {strategy.messaging.assets.map((asset) => (
            <tr key={asset.channel}>
              <th scope="row">{MEDIA_CHANNEL_LABELS[asset.channel] ?? asset.channel}</th>
              <td>{asset.headline}</td>
              <td>
                {asset.body}
                <small className="team-disclosure">
                  {asset.disclosure ? asset.disclosure : "No disclosure"}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DecisionCard({
  waiting,
  strategy,
  brief,
  decisions,
  busy,
  onDecide,
}: {
  waiting: Waiting;
  strategy: CampaignStrategy | null;
  brief: CampaignBrief;
  decisions: readonly Decided[];
  busy: boolean;
  onDecide: (decision: "approve" | "changes", note: string) => void;
}) {
  const spec = TEAM_GATES[waiting.gate];
  const [note, setNote] = useState("");
  const card = useRef<HTMLElement>(null);
  const roundsUsed = decisions.filter(
    (decision) => decision.gate === "client" && decision.decision === "changes",
  ).length;
  const canAskChanges = waiting.gate !== "client" || roundsUsed < CLIENT_ROUNDS;
  // A decision is waiting: bring it into view once, so it isn't missed below the fold.
  useEffect(() => {
    card.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [waiting]);
  return (
    <section
      ref={card}
      className={`team-decision-card gate-${waiting.gate}`}
      aria-labelledby="team-decision-title"
    >
      <p className="kicker">
        Your turn · you are the {spec.decider.toLowerCase()} · no agent may take this decision
      </p>
      <h3 id="team-decision-title">{waiting.title}</h3>
      <blockquote>
        <span>Campaign lead:</span> {waiting.why}
      </blockquote>
      {waiting.gate === "compliance" && strategy && <CopyUnderReview strategy={strategy} />}
      {waiting.gate === "client" && strategy && (
        <p className="arch-note">
          {strategy.positioning} Media ${strategy.media.totalUsd.toLocaleString("en-US")} of $
          {brief.budgetUsd.toLocaleString("en-US")}, about{" "}
          {strategy.media.clicks.toLocaleString("en-US")} projected clicks. The full proposal is
          below.
        </p>
      )}
      <label className="team-decision-note">
        {canAskChanges ? "Notes (needed to ask for changes)" : "Notes"}
        <textarea
          rows={2}
          value={note}
          disabled={busy}
          placeholder={
            waiting.gate === "compliance"
              ? "For example: state that rates are variable in every headline."
              : "For example: lead with safety before the rate, and drop podcast."
          }
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="team-actions">
        <button
          type="button"
          className="arch-primary"
          disabled={busy}
          onClick={() => onDecide("approve", note)}
        >
          {waiting.gate === "compliance" ? "Approve the copy" : "Approve the proposal"}
        </button>
        <button
          type="button"
          className="arch-secondary"
          disabled={busy || !canAskChanges || note.trim().length < 5}
          onClick={() => onDecide("changes", note)}
        >
          Ask for changes
        </button>
        <small>
          Sent as {PERSONA_LABELS[waiting.persona]}; the gateway checks the role.
          {waiting.gate === "client" &&
            ` ${CLIENT_ROUNDS - roundsUsed} round${CLIENT_ROUNDS - roundsUsed === 1 ? "" : "s"} of changes left.`}
        </small>
      </div>
    </section>
  );
}

/** Every decision people took on this run, in order. */
export function DecisionLog({ decisions }: { decisions: readonly Decided[] }) {
  if (decisions.length === 0) return null;
  return (
    <ol className="team-decision-log" aria-label="Decisions by people">
      {decisions.map((decision, index) => (
        <li key={`${decision.gate}-${index}`} className={`decision-${decision.decision}`}>
          <strong>{TEAM_GATES[decision.gate].decider}</strong>{" "}
          {decision.decision === "approve" ? "approved" : "asked for changes"}
          {decision.note ? `: “${decision.note}”` : "."}
        </li>
      ))}
    </ol>
  );
}
