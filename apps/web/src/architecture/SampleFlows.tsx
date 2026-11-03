import {
  type FlowEvent,
  type FlowToolStep,
  PERSONA_LABELS,
  type Persona,
  SAMPLE_GOALS,
  type SampleGoal,
} from "@northstar/architecture";
import { type ReactNode, useEffect, useState } from "react";
import { ArchApiError, archFetch, archStream, type Scope } from "./api";
import { ErrorNote, Json } from "./Shared";

type Status = "idle" | "running" | "waiting" | "deciding" | "done";
type Run = { id?: string; status: Status; events: FlowEvent[]; error?: ArchApiError };

const KEY = (flowId: string) => `northstar.flow.${flowId}`;
const remember = (flowId: string, id: string | null) => {
  try {
    if (id) window.sessionStorage.setItem(KEY(flowId), id);
    else window.sessionStorage.removeItem(KEY(flowId));
  } catch {
    // The flow just isn't restored after a reload.
  }
};
const recalled = (flowId: string) => {
  try {
    return window.sessionStorage.getItem(KEY(flowId));
  } catch {
    return null;
  }
};

const persona = (id: string) => PERSONA_LABELS[id as Persona] ?? id;
const asError = (failure: unknown) =>
  failure instanceof ArchApiError
    ? failure
    : new ArchApiError(
        0,
        "ERROR",
        failure instanceof Error ? failure.message : String(failure),
        {},
      );

/** One tool call inside a subagent's work, with the gateway's decision. */
function ToolLine({ step }: { step: FlowToolStep }) {
  return (
    <li className={step.ok ? "ok" : "failed"}>
      <code>{step.tool}</code>{" "}
      <span className="arch-flow-gate">
        {step.decision
          ? `${step.decision.decision === "allow" ? "allowed" : "denied"} by ${step.decision.policyId}`
          : "refused by the service"}
      </span>
      {step.error && <span className="arch-flow-tool-error"> — {step.error}</span>}
    </li>
  );
}

type Delegation = {
  kind: "delegation";
  callId: string;
  start: Extract<FlowEvent, { type: "delegate" }>;
  steps: FlowToolStep[];
  end?: Extract<FlowEvent, { type: "delegated" }>;
};
type Item = Delegation | { kind: "event"; event: FlowEvent };

/** Groups a flow's events: each delegation with the tool calls and result that belong to it. */
function itemsOf(events: readonly FlowEvent[]): Item[] {
  const items: Item[] = [];
  const open = new Map<string, Delegation>();
  for (const event of events) {
    if (event.type === "delegate") {
      const item: Delegation = {
        kind: "delegation",
        callId: event.callId,
        start: event,
        steps: [],
      };
      open.set(event.callId, item);
      items.push(item);
    } else if (event.type === "tool") open.get(event.callId)?.steps.push(event.step);
    else if (event.type === "delegated") {
      const item = open.get(event.callId);
      if (item) item.end = event;
    } else if (event.type !== "start") items.push({ kind: "event", event });
  }
  return items;
}

function DelegationCard({ item, onOpen }: { item: Delegation; onOpen: (urn: string) => void }) {
  const { start, end, steps } = item;
  const state = !end ? "working" : end.ok ? "finished" : "finished stopped";
  return (
    <li className={`arch-flow-step ${state}`}>
      <div className="arch-flow-step-head">
        <span className="arch-flow-step-number" aria-hidden="true">
          {!end ? "…" : end.ok ? "✓" : "!"}
        </span>
        <div>
          <h4>{start.name}</h4>
          <p className="arch-flow-role">
            Acting for <strong>{persona(start.persona)}</strong>
            {end?.model && <> · {end.model.replace("@cf/", "")}</>}
            {end?.latencyMs !== undefined && <> · {(end.latencyMs / 1000).toFixed(1)}s</>}
            {end?.tokens ? <> · {end.tokens.toLocaleString()} tokens</> : null}
          </p>
        </div>
      </div>
      <p className="arch-flow-task">
        <span>Asked to</span> {start.task}
      </p>
      {steps.length > 0 && (
        <ul className="arch-flow-tools" aria-label="Tool calls">
          {steps.map((step, index) => (
            <ToolLine key={`${step.tool}-${index}`} step={step} />
          ))}
        </ul>
      )}
      {!end && (
        <p className="arch-note" role="status">
          Working…
        </p>
      )}
      {end && (
        <div className={`arch-flow-outcome ${end.ok ? "done" : "stopped"}`}>
          <p>{end.ok ? end.summary : end.error}</p>
          {end.created && end.created.length > 0 && (
            <p className="arch-flow-links">
              Created:{" "}
              {end.created.map((object) => (
                <button
                  key={object.urn}
                  type="button"
                  className="arch-link"
                  onClick={() => onOpen(object.urn)}
                >
                  {object.title}
                </button>
              ))}
            </p>
          )}
          <details className="arch-how">
            <summary>What it was given and what came back</summary>
            <Json value={{ refs: start.refs, steps, result: end.result }} label="Details" />
          </details>
        </div>
      )}
    </li>
  );
}

function DecisionCard({
  event,
  goal,
  status,
  onDecide,
  onOpen,
}: {
  event: Extract<FlowEvent, { type: "await-human" }>;
  goal: SampleGoal;
  status: Status;
  onDecide: (to: "approved" | "changes_requested", reason?: string) => void;
  onOpen: (urn: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <li className="arch-flow-step arch-flow-decision">
      <div className="arch-flow-step-head">
        <span className="arch-flow-step-number" aria-hidden="true">
          ?
        </span>
        <div>
          <h4>Your decision, as {persona(goal.decider)}</h4>
          <p className="arch-flow-role">No agent can take this step. The flow waits for you.</p>
        </div>
      </div>
      <p>
        {event.why}{" "}
        <button type="button" className="arch-link" onClick={() => onOpen(event.moduleUrn)}>
          Open “{event.title}”
        </button>
      </p>
      {status === "waiting" && (
        <div className="arch-flow-actions">
          <button type="button" className="arch-primary" onClick={() => onDecide("approved")}>
            Approve
          </button>
          <input
            aria-label="Changes you want"
            placeholder="Changes you want, to request changes"
            value={reason}
            onChange={(change) => setReason(change.target.value)}
          />
          <button
            type="button"
            className="arch-secondary"
            disabled={reason.trim().length < 5}
            onClick={() => onDecide("changes_requested", reason)}
          >
            Request changes
          </button>
        </div>
      )}
      {status === "deciding" && (
        <p className="arch-note" role="status">
          Recording your decision…
        </p>
      )}
    </li>
  );
}

function FlowRunner({
  goal,
  scope,
  onOpen,
  onChanged,
}: {
  goal: SampleGoal;
  scope: Scope;
  onOpen: (urn: string) => void;
  onChanged: () => void;
}) {
  const [run, setRun] = useState<Run>({ status: "idle", events: [] });
  // The orchestrator starts as you, for the flow's brand; each subagent acts for its step's owner.
  const flowScope: Scope = { persona: scope.persona, brand: goal.brand };

  // A flow left waiting, or finished, survives a reload of the page.
  useEffect(() => {
    const id = recalled(goal.id);
    if (!id) return;
    archFetch<{ id: string; status: string; events: FlowEvent[] }>(
      `/orchestrations/${id}`,
      flowScope,
    )
      .then((saved) =>
        setRun({
          id: saved.id,
          status: saved.status === "waiting" ? "waiting" : "done",
          events: saved.events,
        }),
      )
      .catch(() => remember(goal.id, null));
  }, [goal.id]);

  const append = (event: FlowEvent) => {
    if (event.type === "start") remember(goal.id, event.id);
    setRun((current) => ({
      ...current,
      ...(event.type === "start" ? { id: event.id } : {}),
      status:
        event.type === "await-human" ? "waiting" : event.type === "done" ? "done" : current.status,
      events: [...current.events, event],
    }));
  };

  async function stream(path: string, body: unknown) {
    try {
      await archStream<FlowEvent>(path, flowScope, body, append);
    } catch (failure) {
      setRun((current) => ({ ...current, status: "done", error: asError(failure) }));
    }
    setRun((current) => (current.status === "running" ? { ...current, status: "done" } : current));
    onChanged();
  }

  async function decide(to: "approved" | "changes_requested", reason?: string) {
    const waiting = [...run.events].reverse().find((event) => event.type === "await-human");
    if (waiting?.type !== "await-human" || !run.id) return;
    setRun((current) => ({ ...current, status: "deciding" }));
    // The decision is yours, taken as the reviewer through the state machine, not by any agent.
    const reviewer: Scope = { persona: goal.decider, brand: goal.brand };
    const path = `/objects/${encodeURIComponent(waiting.moduleUrn)}/transition`;
    try {
      // Start from where the module really is: a first attempt may have got part way, or someone
      // may have decided in another tab. Take only the steps that are left.
      const { object } = await archFetch<{ object: { approvalState: string } }>(
        `/objects/${encodeURIComponent(waiting.moduleUrn)}`,
        reviewer,
      );
      let state = object.approvalState;
      if (state === "submitted") {
        await archFetch(path, reviewer, { body: { to: "in_review" } });
        state = "in_review";
      }
      if (state === "in_review")
        await archFetch(path, reviewer, { body: { to, ...(reason ? { reason } : {}) } });
      else if (state === "draft")
        throw new ArchApiError(409, "NOT_SUBMITTED", "This module is not waiting for review.", {});
    } catch (failure) {
      setRun((current) => ({ ...current, status: "waiting", error: asError(failure) }));
      return;
    }
    setRun((current) => ({ ...current, status: "running", error: undefined }));
    await stream(`/orchestrations/${run.id}/continue`, {});
  }

  const started = run.events.find((event) => event.type === "start");
  const items = itemsOf(run.events);
  const busy = run.status === "running" || run.status === "deciding";
  const lastHuman = items.reduce(
    (found, item, index) =>
      item.kind === "event" && item.event.type === "await-human" ? index : found,
    -1,
  );
  return (
    <section className="arch-flow-runner" aria-labelledby={`flow-${goal.id}`}>
      <header>
        <div>
          <p className="kicker">{goal.brand}</p>
          <h3 id={`flow-${goal.id}`}>{goal.title}</h3>
          <p className="arch-flow-situation">{goal.situation}</p>
          <details className="arch-how">
            <summary>The goal the orchestrator is given</summary>
            <p className="arch-note">{goal.goal}</p>
          </details>
        </div>
        <div className="arch-flow-actions">
          <button
            type="button"
            className="arch-primary"
            disabled={busy || run.status === "waiting"}
            onClick={() => {
              remember(goal.id, null);
              setRun({ status: "running", events: [] });
              void stream("/orchestrations", { flowId: goal.id });
            }}
          >
            {run.status === "idle" ? "Start the orchestrator" : "Run it again"}
          </button>
        </div>
      </header>
      {started?.type === "start" && (
        <p className="arch-note">
          Orchestrator on {started.model.replace("@cf/", "")}. {started.modelReason} Each subagent
          runs on its own model with only the tools its grants name, and every call passes the
          gateway.
        </p>
      )}
      {run.error && <ErrorNote error={run.error} />}
      <ol className="arch-flow-steps" aria-live="polite">
        {items.map((item, index): ReactNode => {
          if (item.kind === "delegation")
            return <DelegationCard key={item.callId} item={item} onOpen={onOpen} />;
          const { event } = item;
          if (event.type === "note")
            return (
              <li key={`note-${index}`} className="arch-flow-note">
                <span>Orchestrator</span> {event.text}
              </li>
            );
          if (event.type === "await-human")
            return (
              <DecisionCard
                key={`human-${event.moduleUrn}`}
                event={event}
                goal={goal}
                status={index === lastHuman ? run.status : "done"}
                onDecide={decide}
                onOpen={onOpen}
              />
            );
          if (event.type === "decided")
            return (
              <li key={`decided-${index}`} className="arch-flow-note decided">
                <span>{event.persona}</span> {event.state.replace("_", " ")} it, and the
                orchestrator carries on.
              </li>
            );
          if (event.type === "done")
            return (
              <li key={`done-${index}`} className="arch-flow-step finished arch-flow-done">
                <h4>The orchestrator’s wrap-up</h4>
                <p>{event.summary}</p>
              </li>
            );
          if (event.type === "error")
            return (
              <li key={`error-${index}`} className="arch-flow-step finished stopped">
                <p>{event.message}</p>
              </li>
            );
          return null;
        })}
        {busy && (
          <li className="arch-flow-note" role="status">
            <span>Orchestrator</span> working…
          </li>
        )}
      </ol>
    </section>
  );
}

/** Sample flows: a goal per brand that a real orchestrator plans and delegates to real subagents. */
export function SampleFlows({
  scope,
  onOpen,
  onChanged,
}: {
  scope: Scope;
  onOpen: (urn: string) => void;
  onChanged: () => void;
}) {
  const goals = SAMPLE_GOALS.filter((goal) => scope.brand === "all" || goal.brand === scope.brand);
  const [chosen, setChosen] = useState<string | null>(null);
  const goal = goals.find((item) => item.id === chosen) ?? goals[0];
  if (!goal) return null;
  return (
    <div className="arch-flows">
      {goals.length > 1 && (
        <fieldset className="arch-flow-picker">
          <legend>Pick a flow</legend>
          {goals.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === goal.id}
              onClick={() => setChosen(item.id)}
            >
              <small>{item.brand}</small>
              <strong>{item.title}</strong>
            </button>
          ))}
        </fieldset>
      )}
      <p className="arch-note">
        The orchestrator is a model: it reads the goal, decides which subagent to call and with
        what, and reads each result before the next step. Each subagent is a model too, acting for
        the person who owns its step, with only its granted tools. Nothing here is scripted, so runs
        differ; one takes about a minute.
      </p>
      <FlowRunner key={goal.id} goal={goal} scope={scope} onOpen={onOpen} onChanged={onChanged} />
    </div>
  );
}
