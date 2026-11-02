import {
  type AgentManifest,
  PERSONA_LABELS,
  type Persona,
  STAGE_LABELS,
  STAGES,
} from "@northstar/architecture";
import { Fragment, useState } from "react";
import { AgentForm, FORMS } from "./AgentConsole";
import { type Scope, useArch } from "./api";
import { ErrorNote, Json, Loading, Panel } from "./Shared";

type RegistryAgent = AgentManifest & {
  disabled: boolean;
  effectiveGrants: string[];
  constraint: { reason: string; at: string } | null;
  samples: number;
};
type Registry = {
  domains: string[];
  stages: Array<{ stage: string; label: string; owner: Persona }>;
  agents: RegistryAgent[];
  policies: Array<{ id: string; effect: string; note: string; cedar: string }>;
};

const ROWS = [
  { domain: "commercial", label: "Commercial agents", hint: "we build · the lifecycle" },
  { domain: "platform", label: "Marketing platform agents", hint: "platform · consumed as-is" },
  { domain: "partner", label: "Partner agents", hint: "theirs · federated over A2A" },
] as const;

function AgentChip({
  agent,
  selected,
  onSelect,
}: {
  agent: RegistryAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = agent.disabled
    ? "disabled"
    : agent.status === "planned"
      ? "planned"
      : agent.lifecycle;
  return (
    <button
      type="button"
      className={`arch-agent ${state} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <strong>{agent.name}</strong>
      <small>{agent.status === "planned" ? "planned, not built" : agent.summary}</small>
      <span>
        {agent.status === "live" && <em>{state}</em>}
        {agent.status === "live" && <em>{agent.autonomy}</em>}
      </span>
    </button>
  );
}

export function AgentsPanel({
  scope,
  refreshKey,
  onChanged,
  onOpen,
}: {
  scope: Scope;
  refreshKey: number;
  onChanged: () => void;
  onOpen: (urn: string) => void;
}) {
  const { data, error, loading, reload } = useArch<Registry>("/registry", scope, refreshKey);
  const [selectedId, setSelectedId] = useState("module-authoring");
  const [policyOpen, setPolicyOpen] = useState(false);
  if (loading && !data) return <Loading label="registry" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const selected = data.agents.find((agent) => agent.id === selectedId);
  const forms = Object.values(FORMS).filter((form) => form.agent === selectedId);
  return (
    <div className="arch-agents">
      <p className="arch-lede">
        One register for every agent: versioned, scoped to a named object, and granted its tools by
        policy. Humans own the decision at every stage.
      </p>
      <div className="arch-swimlane">
        <table aria-label="Agent architecture by lifecycle stage">
          <thead>
            <tr>
              <td />
              {STAGES.map((stage) => (
                <th key={stage} scope="col">
                  {STAGE_LABELS[stage]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="people">
              <th scope="row">
                People<small>the judgment · named owners</small>
              </th>
              {data.stages.map((stage) => (
                <td key={stage.stage} className="arch-person">
                  {PERSONA_LABELS[stage.owner]}
                </td>
              ))}
            </tr>
            {ROWS.map((row, index) => (
              <Fragment key={row.domain}>
                <tr>
                  <th scope="row">
                    {row.label}
                    <small>{row.hint}</small>
                  </th>
                  {STAGES.map((stage) => (
                    <td key={stage}>
                      {data.agents
                        .filter((agent) => agent.domain === row.domain && agent.stage === stage)
                        .map((agent) => (
                          <AgentChip
                            key={agent.id}
                            agent={agent}
                            selected={agent.id === selectedId}
                            onSelect={() => setSelectedId(agent.id)}
                          />
                        ))}
                    </td>
                  ))}
                </tr>
                {index === 0 && (
                  <tr>
                    <td colSpan={8} className="arch-gateway-bar">
                      Agentic gateway · every cross-domain call · tool invocation · agent-to-agent ·
                      default-deny policy · workload identity · traced end to end
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <Panel title={selected.name} kicker={`${selected.domain} agent · v${selected.version}`}>
          <p>{selected.summary}</p>
          <dl className="arch-attrs">
            <div>
              <dt>Lifecycle</dt>
              <dd>{selected.disabled ? "disabled by operator" : selected.lifecycle}</dd>
            </div>
            <div>
              <dt>Autonomy</dt>
              <dd>{selected.autonomy}</dd>
            </div>
            <div>
              <dt>Scoped to</dt>
              <dd>{selected.scope}</dd>
            </div>
            <div>
              <dt>Human gate</dt>
              <dd>
                {PERSONA_LABELS[selected.humanGate.persona]} at{" "}
                {STAGE_LABELS[selected.humanGate.stage]}
              </dd>
            </div>
            <div>
              <dt>Task class</dt>
              <dd>{selected.taskClass}</dd>
            </div>
            <div>
              <dt>Prompt</dt>
              <dd>{selected.promptId ?? "none (not prompt-driven)"}</dd>
            </div>
            <div>
              <dt>Granted</dt>
              <dd>
                {selected.effectiveGrants.length ? selected.effectiveGrants.join(", ") : "no tools"}
              </dd>
            </div>
            <div>
              <dt>Samples</dt>
              <dd>{selected.samples}</dd>
            </div>
          </dl>
          {selected.constraint && (
            <p className="arch-refusal">Constrained: {selected.constraint.reason}</p>
          )}
          {selected.a2a && (
            <p className="arch-note">
              Partner contract: {selected.a2a.contract} Identity {selected.a2a.identity}.{" "}
              <a href={`/api/arch/a2a/${selected.id}/agent-card`} target="_blank" rel="noreferrer">
                Agent Card
              </a>
            </p>
          )}
          {selected.status === "planned" && (
            <p className="arch-note">
              Drawn on the architecture, not built. Its prompt, grants and evaluations arrive with
              its work unit.
            </p>
          )}
          {forms.map((form) => (
            <AgentForm
              key={form.action}
              form={form}
              scope={scope}
              onDone={() => {
                onChanged();
                reload();
              }}
              onOpen={onOpen}
            />
          ))}
          {selected.status === "live" && forms.length === 0 && (
            <p className="arch-note">This agent has no actions to run from here.</p>
          )}
        </Panel>
      )}

      <Panel title="Policies" kicker="Default-deny, compiled from the registry">
        <button
          type="button"
          className="text-button"
          onClick={() => setPolicyOpen((open) => !open)}
          aria-expanded={policyOpen}
        >
          {policyOpen ? "Hide" : "Show"} {data.policies.length} policies as Cedar
        </button>
        {policyOpen && (
          <pre className="arch-pre">{data.policies.map((policy) => policy.cedar).join("\n\n")}</pre>
        )}
        <Json
          value={data.policies.map(({ id, effect, note }) => ({ id, effect, note }))}
          label="Policy summary"
        />
      </Panel>
    </div>
  );
}
