// The lifecycle's run status and numbers, in a content team's words first. Where the run stands is
// a plain line ("Paused in Concept. Next: …"), not the lead's instruction to itself, and the
// numbers lead with decisions, handed-in work and problems caught; the machinery's counts (tool
// calls, blocked actions, tokens) sit one click away unless the reader asked for technical detail.
import {
  currentStep,
  LIFECYCLE_ROLES,
  type LifecycleState,
  pharmaPhase,
  TEAM_GATES,
} from "@northstar/architecture";
import { Term } from "./detail";
import type { TeamState } from "./team-state";

/** Where a stopped or finished lifecycle run stands, in plain words. */
export function plainStatus(lifecycle: LifecycleState): string {
  if (lifecycle.finished) return "The campaign has been through every phase.";
  const phase = pharmaPhase(lifecycle.phase);
  const where = phase ? `${phase.title} (${phase.familiar})` : lifecycle.phase;
  const step = currentStep(lifecycle);
  if (!step) return `Paused in ${where}.`;
  if (step.kind === "person")
    return `Paused in ${where}. Waiting on the ${TEAM_GATES[step.gate].decider.toLowerCase()}: ${TEAM_GATES[step.gate].label.toLowerCase()}.`;
  const role = LIFECYCLE_ROLES[step.agent];
  return `Paused in ${where}. Next: the ${role.plain.toLowerCase()} hands in ${step.delivers.charAt(0).toLowerCase()}${step.delivers.slice(1)}.`;
}

/** A run that ended on a hard limit or an error reads as a stop; a pause for the next step doesn't. */
const isStop = (summary: string) => /hard limit|failed|error/i.test(summary);

export function LifecycleStatus({
  lifecycle,
  summary,
  technical,
}: {
  lifecycle: LifecycleState;
  summary: string;
  technical: boolean;
}) {
  return (
    <div className={`team-done-inline${isStop(summary) ? " stopped" : " paused"}`} role="status">
      {isStop(summary) ? summary : plainStatus(lifecycle)}
      {!isStop(summary) &&
        (technical ? (
          <span className="team-raw-status">The lead's own note: {summary}</span>
        ) : (
          <details className="team-raw-status">
            <summary>The lead's own note</summary>
            {summary}
          </details>
        ))}
    </div>
  );
}

export function LifecycleStats({ state, technical }: { state: TeamState; technical: boolean }) {
  const caught = state.guardrails.reduce((sum, hit) => sum + hit.count, 0);
  const handedIn = state.artifacts.filter((artifact) => artifact.by !== "system").length;
  const seconds = state.done ? Math.round(state.done.latencyMs / 1000) : null;
  const machinery = (
    <dl className="team-stats compact">
      <div>
        <dt>Messages</dt>
        <dd>{state.messages.length}</dd>
      </div>
      <div>
        <dt>
          <Term term="tool call">Tool calls</Term>
        </dt>
        <dd>{state.toolCalls}</dd>
      </div>
      <div>
        <dt>
          <Term term="blocked action">Blocked actions</Term>
        </dt>
        <dd>{state.denied}</dd>
      </div>
      {state.done && (
        <div>
          <dt>
            <Term term="tokens">AI usage (tokens)</Term>
          </dt>
          <dd>{state.done.tokens.toLocaleString("en-US")}</dd>
        </div>
      )}
    </dl>
  );
  return (
    <>
      <dl className="team-stats compact" aria-live="polite">
        <div>
          <dt>Sign-offs by people</dt>
          <dd>{state.decisions.length}</dd>
        </div>
        <div>
          <dt>Work handed in by agents</dt>
          <dd>{handedIn}</dd>
        </div>
        <div>
          <dt>
            <Term term="pre-check">Problems caught before review</Term>
          </dt>
          <dd>{caught}</dd>
        </div>
        {seconds !== null && (
          <div>
            <dt>Elapsed</dt>
            <dd>{seconds} s</dd>
          </div>
        )}
      </dl>
      {technical ? (
        machinery
      ) : (
        <details className="team-run-metrics">
          <summary>Run metrics</summary>
          {machinery}
        </details>
      )}
    </>
  );
}
