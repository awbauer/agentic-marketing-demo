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

/**
 * Where a lifecycle run that has ended its turn stands, in plain words. It is paused only when it
 * waits on a person (the run's own state says so: `waiting`); otherwise the lead stopped, the run
 * is saved as stopped and cannot continue, and it says so rather than reading as a pause.
 */
export function plainStatus(lifecycle: LifecycleState, waiting: boolean): string {
  if (lifecycle.finished) return "The campaign has been through every phase.";
  const phase = pharmaPhase(lifecycle.phase);
  const where = phase ? `${phase.title} (${phase.familiar})` : lifecycle.phase;
  const step = currentStep(lifecycle);
  const next = !step
    ? null
    : step.kind === "person"
      ? `the ${TEAM_GATES[step.gate].decider.toLowerCase()}: ${TEAM_GATES[step.gate].label.toLowerCase()}`
      : `the ${LIFECYCLE_ROLES[step.agent].plain.toLowerCase()} hands in ${step.delivers.charAt(0).toLowerCase()}${step.delivers.slice(1)}`;
  if (!waiting)
    return `Stopped in ${where}${next ? `, before ${next}` : ""}. This run can't continue; start a new run.`;
  if (!step || step.kind !== "person") return `Paused in ${where}.`;
  return `Paused in ${where}. Waiting on ${next}.`;
}

export function LifecycleStatus({
  lifecycle,
  summary,
  waiting,
  technical,
}: {
  lifecycle: LifecycleState;
  summary: string;
  /** The run waits on a person's decision (it can go on); otherwise it has stopped. */
  waiting: boolean;
  technical: boolean;
}) {
  const stopped = !waiting && !lifecycle.finished;
  return (
    <div className={`team-done-inline${stopped ? " stopped" : " paused"}`} role="status">
      {plainStatus(lifecycle, waiting)}
      {stopped ? (
        // Why it stopped is the point here, so it shows, not behind a disclosure.
        <span className="team-raw-status">Why: {summary}</span>
      ) : technical ? (
        <span className="team-raw-status">The lead's own note: {summary}</span>
      ) : (
        <details className="team-raw-status">
          <summary>The lead's own note</summary>
          {summary}
        </details>
      )}
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
