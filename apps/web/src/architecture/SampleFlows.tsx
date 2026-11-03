import { type ChainHop, PERSONA_LABELS } from "@northstar/architecture";
import { useState } from "react";
import { Chain } from "./AgentConsole";
import { ArchApiError, archFetch, type Scope } from "./api";
import { type FlowStep, flowsFor, type Outcome, type SampleFlow } from "./flows";
import { TAB_GUIDES, type Tab } from "./guide";
import { ErrorNote, Json } from "./Shared";

type StepState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "finished"; outcome: Outcome; responses: unknown[] }
  | { status: "failed"; error: ArchApiError };

const newTag = () => `run-${Date.now().toString(36)}`;
const fresh = (flow: SampleFlow): StepState[] => flow.steps.map(() => ({ status: "idle" }));

/** The identity chain of the first gateway call in a step, if it returned one. */
const chainOf = (responses: unknown[]) =>
  responses
    .map((item) => (item as { chain?: ChainHop[] }).chain)
    .find((chain): chain is ChainHop[] => Array.isArray(chain));

function StepView({
  step,
  index,
  state,
  ready,
  onRun,
  onOpen,
  onGo,
}: {
  step: FlowStep;
  index: number;
  state: StepState;
  ready: boolean;
  onRun: () => void;
  onOpen: (urn: string) => void;
  onGo: (tab: Tab) => void;
}) {
  const chain = state.status === "finished" ? chainOf(state.responses) : undefined;
  return (
    <li
      className={`arch-flow-step ${state.status} ${state.status === "finished" ? state.outcome.tone : ""}`}
    >
      <div className="arch-flow-step-head">
        <span className="arch-flow-step-number" aria-hidden="true">
          {state.status === "finished" ? (state.outcome.tone === "stopped" ? "!" : "✓") : index + 1}
        </span>
        <div>
          <h4>{step.title}</h4>
          <p className="arch-flow-role">
            <strong>{PERSONA_LABELS[step.persona]}</strong> · {step.actor}
          </p>
        </div>
        {state.status !== "finished" && (
          <button
            type="button"
            className="arch-primary"
            disabled={!ready || state.status === "running"}
            onClick={onRun}
          >
            {state.status === "running"
              ? "Running…"
              : state.status === "failed"
                ? "Try again"
                : "Run this step"}
          </button>
        )}
      </div>
      <p>{step.what}</p>
      <p className="arch-flow-why">
        <span>Why it matters</span> {step.why}
      </p>
      <p className="arch-flow-where">
        Day to day this happens in{" "}
        <button type="button" className="arch-link" onClick={() => onGo(step.tab)}>
          {TAB_GUIDES[step.tab].label}
        </button>
        .
      </p>
      {state.status === "failed" && <ErrorNote error={state.error} />}
      {state.status === "finished" && (
        <div className={`arch-flow-outcome ${state.outcome.tone}`} aria-live="polite">
          <p>{state.outcome.text}</p>
          {state.outcome.details && state.outcome.details.length > 0 && (
            <ul>
              {state.outcome.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {state.outcome.links && state.outcome.links.length > 0 && (
            <p className="arch-flow-links">
              Open:{" "}
              {state.outcome.links.map((link) => (
                <button
                  key={link.urn}
                  type="button"
                  className="arch-link"
                  onClick={() => onOpen(link.urn)}
                >
                  {link.label}
                </button>
              ))}
            </p>
          )}
          <details className="arch-how">
            <summary>
              {chain
                ? `How this was checked: ${chain.filter((hop) => hop.verified).length} of ${chain.length} identity steps verified`
                : "What was sent and returned"}
            </summary>
            {chain && <Chain chain={chain} />}
            <Json value={state.responses} />
          </details>
        </div>
      )}
    </li>
  );
}

function FlowRunner({
  flow,
  onOpen,
  onGo,
  onChanged,
}: {
  flow: SampleFlow;
  onOpen: (urn: string) => void;
  onGo: (tab: Tab) => void;
  onChanged: () => void;
}) {
  const [tag, setTag] = useState(newTag);
  const [states, setStates] = useState<StepState[]>(() => fresh(flow));
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const finished = (state: StepState | undefined) => state?.status === "finished";
  const ready = (index: number) => !running && (index === 0 || finished(states[index - 1]));
  const nextIndex = states.findIndex((state) => !finished(state));

  async function runStep(index: number, known: Record<string, string>) {
    const step = flow.steps[index];
    if (!step) return null;
    setStates((current) =>
      current.map((item, at) => (at === index ? { status: "running" } : item)),
    );
    // The step runs as its own role, for the flow's brand, whatever the header says.
    const scope: Scope = { persona: step.persona, brand: flow.brand };
    const context = { brand: flow.brand, tag, outputs: known };
    try {
      const responses: unknown[] = [];
      for (const call of step.calls(context))
        responses.push(await archFetch(call.path, scope, call.body ? { body: call.body } : {}));
      const outcome = step.summarize(responses, context);
      setStates((current) =>
        current.map((item, at) =>
          at === index ? { status: "finished", outcome, responses } : item,
        ),
      );
      return { ...known, ...outcome.outputs };
    } catch (failure) {
      const error =
        failure instanceof ArchApiError
          ? failure
          : new ArchApiError(0, "ERROR", (failure as Error).message, {});
      setStates((current) =>
        current.map((item, at) => (at === index ? { status: "failed", error } : item)),
      );
      return null;
    }
  }

  async function run(from: number, all: boolean) {
    setRunning(true);
    let known: Record<string, string> | null = outputs;
    for (let index = from; index < flow.steps.length && known; index += 1) {
      known = await runStep(index, known);
      if (known) setOutputs(known);
      if (!all) break;
    }
    setRunning(false);
    onChanged();
  }

  return (
    <section className="arch-flow-runner" aria-labelledby={`flow-${flow.id}`}>
      <header>
        <div>
          <p className="kicker">{flow.brand}</p>
          <h3 id={`flow-${flow.id}`}>{flow.title}</h3>
          <p className="arch-flow-situation">{flow.situation}</p>
        </div>
        <div className="arch-flow-actions">
          <button
            type="button"
            className="arch-primary"
            disabled={running || nextIndex === -1}
            onClick={() => run(nextIndex, true)}
          >
            {nextIndex === -1
              ? "Flow complete"
              : nextIndex === 0
                ? "Run the whole flow"
                : "Run the rest"}
          </button>
          <button
            type="button"
            className="arch-secondary"
            disabled={running}
            onClick={() => {
              setTag(newTag());
              setOutputs({});
              setStates(fresh(flow));
            }}
          >
            Start over
          </button>
        </div>
      </header>
      <ol className="arch-flow-steps">
        {flow.steps.map((step, index) => (
          <StepView
            key={step.id}
            step={step}
            index={index}
            state={states[index] ?? { status: "idle" }}
            ready={ready(index)}
            onRun={() => run(index, false)}
            onOpen={onOpen}
            onGo={onGo}
          />
        ))}
      </ol>
    </section>
  );
}

/** Sample user flows: real work, step by step, with each step played by the role that does it. */
export function SampleFlows({
  scope,
  onOpen,
  onGo,
  onChanged,
}: {
  scope: Scope;
  onOpen: (urn: string) => void;
  onGo: (tab: Tab) => void;
  onChanged: () => void;
}) {
  const flows = flowsFor(scope.brand);
  const [chosen, setChosen] = useState<string | null>(null);
  const flow = flows.find((item) => item.id === chosen) ?? flows[0];
  if (!flow) return null;
  return (
    <div className="arch-flows">
      {flows.length > 1 && (
        <fieldset className="arch-flow-picker">
          <legend>Pick a flow</legend>
          {flows.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === flow.id}
              onClick={() => setChosen(item.id)}
            >
              <small>{item.brand}</small>
              <strong>{item.title}</strong>
              <span>{item.steps.length} steps</span>
            </button>
          ))}
        </fieldset>
      )}
      <p className="arch-note">
        Each step runs as the role shown — whatever role is in the header — so you can watch the
        work pass from person to person. What a flow creates is yours alone, and clears within a
        day.
      </p>
      <FlowRunner key={flow.id} flow={flow} onOpen={onOpen} onGo={onGo} onChanged={onChanged} />
    </div>
  );
}
