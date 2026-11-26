// One agent, opened from the team map: who it is, the model and settings it runs on, the exact
// system prompts it sent, what it used (calls, tokens, time, cost), every call it sent to or
// received from another party, its tool calls with the gateway's decision, the work it saved, and
// the guardrails around it: its allowances and how much it has used, the rule checks on its saves,
// its gateway grants, and every time a guardrail stopped it.
// Everything comes from the run's event log, so a live run, a reloaded run and a replay show the
// same thing.
import {
  isLifecycleWorker,
  isTeamSpecialist,
  LIFECYCLE_ROLES,
  PHARMA_PHASES,
  type PhaseStep,
  TEAM_AGENTS,
  TEAM_DIRECTOR,
  TEAM_PARTY_LABELS,
  type TeamAgentId,
  type TeamEvent,
  type TeamParty,
  teamRunProviderLabel,
} from "@northstar/architecture";
import { hostTerms } from "@northstar/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentAllowances } from "./allowances";
import { Term, useTechnical } from "./detail";
import { GuardrailPanel, PROTECTS } from "./Guardrails";
import { ArtifactView } from "./TeamLifecycle";
import { TeamWorkView } from "./TeamWork";
import { KIND_LABELS, type TeamMessage, type TeamState } from "./team-state";

/** What this host calls its infrastructure (ADR-018). */
const HOST = hostTerms();

type Prompt = Extract<TeamEvent, { type: "prompt" }>;
type Tab = "overview" | "prompt" | "usage" | "calls" | "work" | "guardrails";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "prompt", label: "Prompt & config" },
  { id: "usage", label: "Usage" },
  { id: "calls", label: "Calls" },
  { id: "work", label: "Tools & work" },
  { id: "guardrails", label: "Guardrails" },
];

const PURPOSE_LABELS: Record<Prompt["purpose"], string> = {
  lead: "Coordinating",
  work: "Doing its work",
  answer: "Answering a teammate",
  report: "Reporting back",
};

const num = (value: number) => Math.round(value).toLocaleString("en-US");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const party = (id: TeamParty) => TEAM_PARTY_LABELS[id] ?? id;

/** Who the agent exchanged messages with, most first. */
function counterparts(messages: TeamMessage[], id: TeamAgentId) {
  const counts = new Map<TeamParty, { sent: number; received: number }>();
  for (const message of messages) {
    if (message.from === id) {
      const item = counts.get(message.to) ?? { sent: 0, received: 0 };
      item.sent += 1;
      counts.set(message.to, item);
    } else if (message.to === id || (message.to === "team" && message.from !== id)) {
      const item = counts.get(message.from) ?? { sent: 0, received: 0 };
      item.received += 1;
      counts.set(message.from, item);
    }
  }
  return [...counts.entries()].sort(
    (a, b) => b[1].sent + b[1].received - (a[1].sent + a[1].received),
  );
}

function Overview({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const manifest = TEAM_AGENTS.find((agent) => agent.id === id);
  const view = state.agents[id];
  const lifecycle = state.mode === "lifecycle";
  const steps = PHARMA_PHASES.flatMap((phase) =>
    (phase.steps as readonly PhaseStep[]).flatMap((step) =>
      step.kind === "agent" && step.agent === id ? [{ phase: phase.title, step }] : [],
    ),
  );
  const provider = state.infra?.provider;
  const effort = state.prompts.find((prompt) => prompt.agent === id)?.settings.effort;
  const role = lifecycle ? LIFECYCLE_ROLES[id as keyof typeof LIFECYCLE_ROLES] : undefined;
  const technical = useTechnical();
  const profile = (
    <dl className="team-modal-facts">
      <dt>Role</dt>
      <dd>
        {manifest?.role === "hub"
          ? "Hub: coordinates the others"
          : lifecycle
            ? "Spoke: works one step; a named person owns the result"
            : "Spoke: does one piece"}{" "}
        · {manifest?.tier} tier · task class <code>{manifest?.taskClass}</code>
      </dd>
      <dt>Model</dt>
      <dd>
        <code>{state.models[id] ?? "—"}</code>
        {provider ? ` on ${teamRunProviderLabel(provider, state.infra?.aiPlatform, HOST.id)}` : ""}
        {state.infra?.aiGateway ? ` through AI Gateway ${state.infra.aiGateway}` : ""}
        {state.infra?.scripted ? " (scripted test model)" : ""}
        {effort ? ` · effort ${effort}` : ""}
      </dd>
      {!lifecycle && manifest?.deliverable && (
        <>
          <dt>Deliverable</dt>
          <dd>
            <code>{manifest.deliverable}</code>
          </dd>
        </>
      )}
    </dl>
  );
  return (
    <div className="team-modal-section">
      {role && (
        <p className="team-modal-role">
          <strong>{role.plain}</strong> · assists {role.assists}. It prepares the work; the person
          who signs off after it owns the result.
        </p>
      )}
      <p>{role?.summary ?? manifest?.summary}</p>
      <dl className="team-modal-facts">
        <dt>Status</dt>
        <dd>
          <strong>{view.state}</strong>
          {view.note ? `: ${view.note}` : ""}
          {view.revisions ? ` · sent back ${view.revisions}×` : ""}
        </dd>
        {manifest?.use && (
          <>
            <dt>Owns</dt>
            <dd>{manifest.use}</dd>
          </>
        )}
      </dl>
      {lifecycle && steps.length > 0 && (
        <>
          <h5>Its lifecycle steps</h5>
          <ol className="team-modal-steps">
            {steps.map(({ phase, step }) => (
              <li key={`${phase}-${step.kind === "agent" ? step.tool : ""}`}>
                <strong>{phase}</strong>
                {step.kind === "agent" ? ` · hands in: ${step.delivers}` : ""}
                {technical && step.kind === "agent" ? (
                  <>
                    {" "}
                    · <code>{step.tool}</code>
                  </>
                ) : null}
                <p>{step.does}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      {view.review && (
        <p className={`team-review verdict-${view.review.verdict}`}>
          Lead’s call: <strong>{view.review.verdict === "accept" ? "kept" : "sent back"}</strong>
          {view.review.feedback && view.review.feedback !== "Kept."
            ? ` — ${view.review.feedback}`
            : ""}
        </p>
      )}
      {technical ? (
        <>
          <h5>Technical profile</h5>
          {profile}
        </>
      ) : (
        <details className="team-modal-profile">
          <summary>Technical profile: role, model and settings</summary>
          {profile}
        </details>
      )}
    </div>
  );
}

function Guardrails({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const manifest = TEAM_AGENTS.find((agent) => agent.id === id);
  const allowances = agentAllowances(state, id);
  const hits = state.guardrails.filter((hit) => hit.agent === id);
  const checked = (manifest?.tools ?? []).filter((tool) => PROTECTS[tool]);
  return (
    <div className="team-modal-section">
      <div className="team-modal-bounds">
        <h5>What keeps this agent in bounds</h5>
        <ul>
          <li>
            It can use only the {manifest?.tools.length ?? 0} actions it was granted; anything else
            is blocked and logged.
          </li>
          {checked.length > 0 && (
            <li>
              Everything it hands in is pre-checked in code before a person sees it; a refused draft
              changes nothing and comes back with every problem named.
            </li>
          )}
          <li>
            It has a work budget. If it gets stuck it stops and hands back to the project lead, who
            can reassign the work or ask a person.
          </li>
        </ul>
        <p className="arch-note">
          The model never sees or sets these; the platform enforces them around every call.
        </p>
      </div>
      <h5>Exact limits and how much it has used</h5>
      <div className="team-table-wrap">
        <table className="team-table team-allowances">
          <thead>
            <tr>
              <th scope="col">Allowance</th>
              <th scope="col">Limit</th>
              <th scope="col">Used</th>
              <th scope="col">At the limit</th>
            </tr>
          </thead>
          <tbody>
            {allowances.map((item) => {
              const share = item.used === null ? 0 : item.used / item.allowed;
              return (
                <tr
                  key={item.label}
                  className={share >= 1 ? "at-limit" : share >= 0.75 ? "near-limit" : undefined}
                >
                  <th scope="row">{item.label}</th>
                  <td>{num(item.allowed)}</td>
                  <td>
                    {item.used === null ? "—" : num(item.used)}
                    {item.usedNote ? <small> {item.usedNote}</small> : null}
                  </td>
                  <td>{item.atLimit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {checked.length > 0 && (
        <>
          <h5>Pre-checks before anything reaches a reviewer</h5>
          <ul className="team-modal-list">
            {checked.map((tool) => (
              <li key={tool}>
                <code>{tool}</code>: {PROTECTS[tool]}
              </li>
            ))}
          </ul>
          <p className="arch-note">
            Code checks each hand-in, whatever the model wrote. These are not MLR review; they run
            before it. A refused draft changes nothing, and the agent gets every problem back to
            fix.
          </p>
        </>
      )}
      <h5>
        Actions it may take (<Term term="gateway">gateway</Term> grants)
      </h5>
      <p className="team-grants">
        {manifest?.tools.map((tool) => (
          <code key={tool}>{tool}</code>
        ))}
      </p>
      <p className="arch-note">
        A default-deny Cedar policy permits exactly these tools as <code>team:&lt;tool&gt;</code>{" "}
        for this agent; every other call is denied and logged. Each tool's input schema rejects a
        malformed call before it runs.
      </p>
      {hits.length > 0 ? (
        <GuardrailPanel hits={hits} />
      ) : (
        <p className="arch-note">No guardrail has stopped this agent in this run.</p>
      )}
    </div>
  );
}

function PromptConfig({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const prompts = state.prompts.filter((prompt) => prompt.agent === id);
  if (prompts.length === 0)
    return (
      <p className="arch-note">
        No model call from this agent yet in this run. Its system prompt, tools and settings show
        here after its first call.
      </p>
    );
  return (
    <div className="team-modal-section">
      <p className="arch-note">
        The system prompts exactly as this agent sent them, one per distinct prompt. The run’s brief
        and the agents’ work go in the user turn, as data.
      </p>
      {prompts.map((prompt, index) => (
        <details key={`${prompt.purpose}-${index}`} className="team-prompt" open={index === 0}>
          <summary>
            <strong>{PURPOSE_LABELS[prompt.purpose]}</strong> · <code>{prompt.model}</code>
            {prompt.toolChoice ? ` · tool choice ${prompt.toolChoice}` : ""}
          </summary>
          <dl className="team-modal-facts">
            <dt>Provider</dt>
            <dd>{teamRunProviderLabel(prompt.provider, state.infra?.aiPlatform, HOST.id)}</dd>
            <dt>Settings</dt>
            <dd>
              {Object.entries(prompt.settings).length
                ? Object.entries(prompt.settings)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(" · ")
                : "provider defaults"}
            </dd>
            <dt>Tools offered</dt>
            <dd className="team-grants">
              {prompt.tools.length
                ? prompt.tools.map((tool) => <code key={tool}>{tool}</code>)
                : "none (plain text)"}
            </dd>
            {prompt.price && (
              <>
                <dt>Price</dt>
                <dd>
                  ${prompt.price.input} in · ${prompt.price.cachedInput} cached · $
                  {prompt.price.output} out, per million tokens
                </dd>
              </>
            )}
          </dl>
          <pre className="team-prompt-text">{prompt.system}</pre>
        </details>
      ))}
    </div>
  );
}

function Usage({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const calls = state.modelCalls.filter((call) => call.agent === id);
  const runTokens = state.modelCalls.reduce((sum, call) => sum + call.tokens, 0);
  const tokens = calls.reduce((sum, call) => sum + call.tokens, 0);
  const input = calls.reduce((sum, call) => sum + (call.inputTokens ?? call.tokens), 0);
  const cached = calls.reduce((sum, call) => sum + (call.cachedInputTokens ?? 0), 0);
  const output = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  const time = calls.reduce((sum, call) => sum + call.latencyMs, 0);
  const priceOf = (model: string) =>
    state.prompts.find((prompt) => prompt.model === model && prompt.price)?.price ?? null;
  let cost: number | null = 0;
  for (const call of calls) {
    const price = priceOf(call.model);
    if (!price) {
      cost = null;
      break;
    }
    const callInput = call.inputTokens ?? call.tokens;
    const callCached = Math.min(call.cachedInputTokens ?? 0, callInput);
    cost +=
      ((callInput - callCached) * price.input +
        callCached * price.cachedInput +
        (call.outputTokens ?? 0) * price.output) /
      1_000_000;
  }
  const purposes = [...new Set(calls.map((call) => call.purpose))];
  const tools = state.agents[id].tools;
  const denied = tools.filter((step) => step.decision?.decision === "deny").length;
  const refused = tools.filter((step) => !step.ok && step.decision?.decision !== "deny").length;
  const semantic = state.semantic.filter((item) => item.agent === id);
  return (
    <div className="team-modal-section">
      <div className="team-modal-stats">
        <div>
          <strong>{calls.length}</strong>
          <span>
            model calls
            {calls.some((call) => !call.ok)
              ? ` (${calls.filter((call) => !call.ok).length} failed)`
              : ""}
          </span>
        </div>
        <div>
          <strong>{num(tokens)}</strong>
          <span>
            tokens{runTokens ? ` · ${Math.round((tokens / runTokens) * 100)}% of the run` : ""}
          </span>
        </div>
        <div>
          <strong>{seconds(time)}</strong>
          <span>model time{calls.length ? ` · ${seconds(time / calls.length)} a call` : ""}</span>
        </div>
        <div>
          <strong>{cost === null ? "—" : `$${cost.toFixed(cost < 0.1 ? 4 : 2)}`}</strong>
          <span>{cost === null ? "model not priced" : "estimated cost"}</span>
        </div>
      </div>
      <p className="arch-note">
        Input {num(input)} ({num(cached)} from the prompt cache) · output {num(output)}.
      </p>
      {purposes.length > 0 && (
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th scope="col">Purpose</th>
                <th scope="col">Calls</th>
                <th scope="col">Tokens</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {purposes.map((purpose) => {
                const some = calls.filter((call) => call.purpose === purpose);
                return (
                  <tr key={purpose}>
                    <th scope="row">{PURPOSE_LABELS[purpose as Prompt["purpose"]] ?? purpose}</th>
                    <td>{some.length}</td>
                    <td>{num(some.reduce((sum, call) => sum + call.tokens, 0))}</td>
                    <td>{seconds(some.reduce((sum, call) => sum + call.latencyMs, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h5>Tool calls</h5>
      <p>
        {tools.length} calls · {tools.length - denied - refused} succeeded · {refused} refused by a
        rule service · {denied} denied by the gateway
      </p>
      {semantic.length > 0 && (
        <>
          <h5>Semantic layer reads ({semantic.length})</h5>
          <ul className="team-modal-list">
            {semantic.map((item, index) => (
              <li key={`${item.tool}-${index}`}>
                <code>{item.tool}</code>
                {item.entity ? ` · ${item.entity}` : ""}
                {item.metrics.length ? ` · ${item.metrics.join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Calls({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const mine = state.messages.filter(
    (message) =>
      message.from === id || message.to === id || (message.to === "team" && message.from !== id),
  );
  const shown = mine.filter((message) =>
    filter === "all" ? true : filter === "sent" ? message.from === id : message.from !== id,
  );
  const sent = mine.filter((message) => message.from === id).length;
  return (
    <div className="team-modal-section">
      <div className="team-modal-peers">
        {counterparts(state.messages, id).map(([other, count]) => (
          <span key={other} className="team-modal-peer">
            {party(other)}{" "}
            <small>
              ↑{count.sent} ↓{count.received}
            </small>
          </span>
        ))}
      </div>
      <div className="arch-tabs small" role="tablist" aria-label="Which calls">
        {(
          [
            ["all", `All (${mine.length})`],
            ["sent", `Sent (${sent})`],
            ["received", `Received (${mine.length - sent})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="arch-note">No calls yet.</p>
      ) : (
        <ol className="team-modal-calls">
          {shown.map((message) => {
            const out = message.from === id;
            return (
              <li key={message.id} className={out ? "sent" : "received"}>
                <span className="team-modal-direction">
                  {out ? `→ ${party(message.to)}` : `← ${party(message.from)}`}
                </span>
                <em className="team-kind">{KIND_LABELS[message.kind]}</em>
                <p>{message.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Whether a tool call was sent anything: `{}` (a read tool's whole input) counts as nothing. */
const hasArguments = (input: unknown) =>
  input != null && !(typeof input === "object" && Object.keys(input).length === 0);

function Work({ state, id }: { state: TeamState; id: TeamAgentId }) {
  const view = state.agents[id];
  const lifecycle = state.mode === "lifecycle";
  const made = lifecycle ? state.artifacts.filter((artifact) => artifact.by === id) : [];
  const specialist = !lifecycle && isTeamSpecialist(id) ? id : null;
  const latest = specialist ? view.versions.at(-1) : undefined;
  return (
    <div className="team-modal-section">
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
              {hasArguments(step.input) ? (
                <details>
                  <summary>Input</summary>
                  <pre className="team-json">{JSON.stringify(step.input, null, 2)}</pre>
                </details>
              ) : (
                // Read tools such as get_competitors take none: the run's brand decides what they return.
                <small className="arch-note"> No arguments.</small>
              )}
              {step.output !== undefined && (
                <details>
                  <summary>Output</summary>
                  <pre className="team-json">{JSON.stringify(step.output, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {id === TEAM_DIRECTOR && state.plan && (
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
                    · after {item.dependsOn.map((dep) => TEAM_PARTY_LABELS[dep]).join(", ")}
                  </small>
                )}
              </li>
            ))}
          </ol>
          {state.plan.budgetGuidance && <p className="arch-note">{state.plan.budgetGuidance}</p>}
        </>
      )}
      {specialist && state.brief && (
        <>
          <h5>
            Latest work{latest ? ` · version ${latest.version} of ${view.versions.length}` : ""}
          </h5>
          <TeamWorkView agent={specialist} work={latest?.output} brief={state.brief} />
        </>
      )}
      {lifecycle && isLifecycleWorker(id) && (
        <>
          <h5>Saved work ({made.length})</h5>
          {made.length === 0 ? (
            <p className="arch-note">Nothing saved yet.</p>
          ) : (
            made.map((artifact) => (
              <details key={`${artifact.name}-${artifact.version}`} open={artifact === made.at(-1)}>
                <summary>
                  <code>{artifact.name}</code> · version {artifact.version} · round {artifact.round}
                </summary>
                <ArtifactView artifact={artifact} choices={state.lifecycle?.choices} />
              </details>
            ))
          )}
        </>
      )}
    </div>
  );
}

/** The agent's detail, as a modal dialog over the page. */
export function AgentModal({
  state,
  agent,
  onClose,
}: {
  state: TeamState;
  agent: TeamAgentId;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const manifest = TEAM_AGENTS.find((item) => item.id === agent);
  // Opened as a modal once mounted. No close on cleanup: closing fires the close event, which
  // would unmount the modal again under StrictMode's double effects; removal closes it anyway.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  useEffect(() => {
    setTab("overview");
  }, [agent]);
  const counts = useMemo(
    () => ({
      prompts: state.prompts.filter((prompt) => prompt.agent === agent).length,
      calls: state.messages.filter(
        (message) =>
          message.from === agent ||
          message.to === agent ||
          (message.to === "team" && message.from !== agent),
      ).length,
      tools: state.agents[agent].tools.length,
      model: state.modelCalls.filter((call) => call.agent === agent).length,
      hits: state.guardrails
        .filter((hit) => hit.agent === agent)
        .reduce((sum, hit) => sum + hit.count, 0),
    }),
    [state, agent],
  );
  const view = state.agents[agent];
  const technical = useTechnical();
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a mouse shortcut; Escape and the Close button close it from the keyboard.
    <dialog
      ref={dialog}
      className="team-modal"
      aria-labelledby="team-modal-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="team-modal-inner">
        <header className="team-modal-header">
          <div>
            <h3 id="team-modal-title">
              <i className={`team-dot is-${view.state}`} aria-hidden="true" /> {manifest?.name}
            </h3>
            <p className="arch-note">
              {state.mode === "lifecycle"
                ? (LIFECYCLE_ROLES[agent as keyof typeof LIFECYCLE_ROLES]?.plain ?? "Agent")
                : manifest?.role === "hub"
                  ? "Hub"
                  : "Spoke"}{" "}
              · {counts.model} AI requests · {counts.tools} actions · {counts.calls} messages
              {technical ? (
                <>
                  {" "}
                  · <code>{state.models[agent] ?? "—"}</code>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => dialog.current?.close()}
            aria-label="Close agent details"
          >
            Close
          </button>
        </header>
        <div className="arch-tabs" role="tablist" aria-label="Agent details">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`team-modal-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="team-modal-panel"
              onClick={() => setTab(id)}
            >
              {label}
              {id === "prompt" && counts.prompts ? ` (${counts.prompts})` : ""}
              {id === "calls" && counts.calls ? ` (${counts.calls})` : ""}
              {id === "guardrails" && counts.hits ? ` (${counts.hits})` : ""}
            </button>
          ))}
        </div>
        <div
          id="team-modal-panel"
          role="tabpanel"
          aria-labelledby={`team-modal-tab-${tab}`}
          className="team-modal-body"
        >
          {tab === "overview" && <Overview state={state} id={agent} />}
          {tab === "prompt" && <PromptConfig state={state} id={agent} />}
          {tab === "usage" && <Usage state={state} id={agent} />}
          {tab === "calls" && <Calls state={state} id={agent} />}
          {tab === "work" && <Work state={state} id={agent} />}
          {tab === "guardrails" && <Guardrails state={state} id={agent} />}
        </div>
      </div>
    </dialog>
  );
}
