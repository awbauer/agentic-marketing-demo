// The people in the loop. When the squad stops for a decision no agent may take, the person at the
// browser takes it, acting as the role it needs: the compliance reviewer for a regulated brand's
// copy, and the client for the proposal. The server checks the role; agents can never decide.
import {
  type CampaignBrief,
  type CampaignStrategy,
  CLIENT_ROUNDS,
  FAST_APPROVAL_MS,
  MEDIA_CHANNEL_LABELS,
  PERSONA_LABELS,
  reviewerMetrics,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  type TeamAgentId,
  type TeamEvent,
} from "@northstar/architecture";
import { useRef, useState } from "react";
import { RichText } from "./RichText";
import type { TeamState } from "./team-state";

type Waiting = Extract<TeamEvent, { type: "await-person" }>;
type Decided = TeamState["decisions"][number];

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
        <span>Campaign lead</span>
        <RichText text={waiting.why} />
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

const when = (at?: string) =>
  at
    ? new Date(at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

/** What a person did, in a sign-off's words. */
const verb = (decision: Decided) =>
  decision.decision === "changes"
    ? "asked for changes"
    : decision.choiceLabel
      ? `chose “${decision.choiceLabel}”`
      : decision.gate === "regulatory"
        ? "approved for distribution"
        : decision.gate === "fda-2253"
          ? "filed Form FDA 2253"
          : "approved";

/**
 * Every decision people took on this run, in order: who, what they signed off (the version of the
 * work in front of them), when, and their words. The run's audit trail.
 */
export function DecisionLog({
  decisions,
  titles = {},
}: {
  decisions: readonly Decided[];
  /** Plain names for the work a decision signed off, by artifact name. */
  titles?: Record<string, string>;
}) {
  if (decisions.length === 0) return null;
  return (
    <ol className="team-decision-log" aria-label="Sign-off record">
      {decisions.map((decision, index) => (
        <li key={`${decision.gate}-${index}`} className={`decision-${decision.decision}`}>
          <strong>{TEAM_GATES[decision.gate].decider}</strong> {verb(decision)}
          {decision.signedOff ? (
            <span className="team-signoff-subject">
              {" "}
              · {titles[decision.signedOff.name] ?? decision.signedOff.name} v
              {decision.signedOff.version}
            </span>
          ) : null}
          {when(decision.at) ? <small> · {when(decision.at)}</small> : null}
          {decision.note ? <q>{decision.note}</q> : null}
          {decision.record ? <DecisionRecordView record={decision.record} titles={titles} /> : null}
        </li>
      ))}
    </ol>
  );
}

const seconds = (ms: number | null) =>
  ms === null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;

/**
 * What the decision rests on, for whoever has to answer for it later: the exact versions of the
 * work the person saw, the policy set and the prompts behind it, and how long they took.
 */
function DecisionRecordView({
  record,
  titles,
}: {
  record: NonNullable<Decided["record"]>;
  titles: Record<string, string>;
}) {
  return (
    <details className="team-decision-record">
      <summary>Decision record</summary>
      <dl>
        <dt>Decided on</dt>
        <dd>
          {record.reviewed.length
            ? record.reviewed
                .map((item) => `${titles[item.name] ?? item.name} v${item.version}`)
                .join(", ")
            : "The work in front of them"}
        </dd>
        <dt>Policy set</dt>
        <dd>
          <code>{record.policyVersion}</code>
        </dd>
        <dt>Prompts</dt>
        <dd>
          {Object.entries(record.promptVersions).length
            ? Object.entries(record.promptVersions).map(([agent, version]) => (
                <span key={agent}>
                  {TEAM_PARTY_LABELS[agent as TeamAgentId] ?? agent} <code>{version}</code>{" "}
                </span>
              ))
            : "—"}
        </dd>
        <dt>Time to decide</dt>
        <dd>{seconds(record.decidedInMs)}</dd>
      </dl>
    </details>
  );
}

/**
 * Each reviewer's decisions on this run: how often they asked for changes and how long they took.
 * An override rate near zero with near-instant approvals is a warning sign, not efficiency.
 */
export function ReviewerMetricsTable({ decisions }: { decisions: readonly Decided[] }) {
  const rows = reviewerMetrics(decisions);
  if (!rows.length) return null;
  return (
    <div className="team-table-wrap">
      <table className="team-table">
        <caption>Reviewers on this run</caption>
        <thead>
          <tr>
            <th scope="col">Acting as</th>
            <th scope="col">Decisions</th>
            <th scope="col">Asked for changes</th>
            <th scope="col">Median time to decide</th>
            <th scope="col">Approved in under {FAST_APPROVAL_MS / 1000} s</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.persona}>
              <th scope="row">
                {PERSONA_LABELS[row.persona as keyof typeof PERSONA_LABELS] ?? row.persona}
              </th>
              <td>{row.decisions}</td>
              <td>
                {row.changes} ({Math.round(row.overrideRate * 100)}%)
              </td>
              <td>{seconds(row.medianMs)}</td>
              <td className={row.fastApprovals ? "team-warn" : undefined}>{row.fastApprovals}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="arch-note">
        Oversight is measured, not assumed: an approval faster than anyone could read the work, or
        an override rate near zero over many decisions, is a warning sign. A run can also seed a
        flawed item into the MLR queue to measure whether reviewers catch it.
      </p>
    </div>
  );
}

/** The sign-off record beside the lifecycle: open while it is short, always one click away. */
export function SignOffRecord({
  decisions,
  titles,
}: {
  decisions: readonly Decided[];
  titles: Record<string, string>;
}) {
  return (
    <details className="team-signoffs" open={decisions.length > 0 && decisions.length <= 6}>
      <summary>
        <strong>Sign-off record</strong>{" "}
        <span>
          {decisions.length} {decisions.length === 1 ? "decision" : "decisions"} by people
        </span>
      </summary>
      {decisions.length === 0 ? (
        <p className="arch-note">No one has signed anything off on this run yet.</p>
      ) : (
        <DecisionLog decisions={decisions} titles={titles} />
      )}
    </details>
  );
}
