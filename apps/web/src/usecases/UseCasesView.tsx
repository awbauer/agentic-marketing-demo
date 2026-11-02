import { useMemo, useState } from "react";
import {
  type Industry,
  type SystemKind,
  TEAMS,
  type Team,
  USE_CASES,
  type UseCase,
} from "./catalog";
import "./usecases.css";

const KIND_GLYPHS: Record<SystemKind, string> = {
  "Salesforce agent": "◆",
  "Salesforce action": "▸",
  "Knowledge graph": "⋈",
  "MCP server": "◇",
  "External API": "↗",
  "Workers AI": "✦",
  Workbench: "▣",
};

type Filter = Team | Industry | "All";
const FILTERS: Filter[] = ["All", ...TEAMS, "Financial services", "Life sciences"];
const matches = (useCase: UseCase, filter: Filter) =>
  filter === "All" || useCase.team === filter || useCase.industry === filter;

/**
 * The use-case library: every scenario the demo supports, with the utterances that drive it, the
 * systems involved, how data flows between them, and what the knowledge graph contributes. Drafted
 * scenarios that aren't built appear greyed out as "Coming soon".
 */
export function UseCasesView({
  onClose,
  onTryPrompt,
}: {
  onClose: () => void;
  onTryPrompt: (prompt: string) => void;
}) {
  const [team, setTeam] = useState<Filter>("All");
  const [selectedId, setSelectedId] = useState(USE_CASES[0]?.id ?? "");
  const shown = useMemo(() => USE_CASES.filter((useCase) => matches(useCase, team)), [team]);
  const available = shown.filter((useCase) => useCase.status === "available");
  const comingSoon = shown.filter((useCase) => useCase.status === "coming-soon");
  const selected = available.find((useCase) => useCase.id === selectedId) ?? available[0] ?? null;

  return (
    <section className="evaluations-view usecases-view" aria-labelledby="usecases-title">
      <div className="section-header">
        <div>
          <p className="kicker">Library</p>
          <h2 id="usecases-title">Use cases</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Back to workspace
        </button>
      </div>
      <div className="usecases-body">
        <p className="usecases-intro">
          Each use case is a scenario the demo can run end to end: what it's for, the prompts that
          drive it, the systems involved, and how data flows between them. Everything uses fictional
          Northstar data; writes always wait for your confirmation, and nothing is published or
          sent.
        </p>
        <fieldset className="usecases-teams">
          <legend className="sr-only">Team</legend>
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={team === option}
              onClick={() => setTeam(option)}
            >
              {option}
              <span className="usecases-count">
                {
                  USE_CASES.filter(
                    (useCase) => useCase.status === "available" && matches(useCase, option),
                  ).length
                }
              </span>
            </button>
          ))}
        </fieldset>
        <div className="usecases-layout">
          <div>
            <ul className="usecases-grid" aria-label="Available use cases">
              {available.map((useCase) => (
                <li key={useCase.id}>
                  <button
                    type="button"
                    className="usecase-card"
                    aria-pressed={selected?.id === useCase.id}
                    onClick={() => setSelectedId(useCase.id)}
                  >
                    <UseCaseCardBody useCase={useCase} />
                  </button>
                </li>
              ))}
            </ul>
            {comingSoon.length > 0 && (
              <>
                <h3 className="usecases-subhead">Coming soon</h3>
                <ul className="usecases-grid is-coming-soon" aria-label="Coming soon use cases">
                  {comingSoon.map((useCase) => (
                    <li key={useCase.id}>
                      <div className="usecase-card is-disabled" aria-disabled="true">
                        <UseCaseCardBody useCase={useCase} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {selected && <UseCaseDetail useCase={selected} onTryPrompt={onTryPrompt} />}
        </div>
      </div>
    </section>
  );
}

function UseCaseCardBody({ useCase }: { useCase: UseCase }) {
  const kinds = [...new Set(useCase.systems.map((system) => system.kind))];
  return (
    <>
      <span className="usecase-card-top">
        <span className={`usecase-team team-${useCase.team.toLowerCase()}`}>{useCase.team}</span>
        {useCase.status === "coming-soon" ? (
          <span className="usecase-badge is-soon">Coming soon</span>
        ) : (
          <>
            {useCase.industry && (
              <span className="usecase-badge is-industry">{useCase.industry}</span>
            )}
            {useCase.newService && <span className="usecase-badge is-new">New service</span>}
            {useCase.graphRole && <span className="usecase-badge">Graph</span>}
          </>
        )}
      </span>
      <strong className="usecase-card-title">{useCase.title}</strong>
      <span className="usecase-card-summary">{useCase.summary}</span>
      <span className="usecase-kinds">
        <span className="sr-only">Systems: </span>
        {kinds.map((kind) => (
          <span key={kind} title={kind}>
            <span aria-hidden="true">{KIND_GLYPHS[kind]}</span> {kind}
          </span>
        ))}
      </span>
    </>
  );
}

function UseCaseDetail({
  useCase,
  onTryPrompt,
}: {
  useCase: UseCase;
  onTryPrompt: (prompt: string) => void;
}) {
  return (
    <article className="usecase-detail" aria-labelledby="usecase-detail-title">
      <p className="kicker">
        {useCase.team}
        {useCase.industry ? ` · ${useCase.industry}` : ""}
      </p>
      <h3 id="usecase-detail-title">{useCase.title}</h3>
      <p className="usecase-scenario">{useCase.scenario}</p>

      {useCase.newService && (
        <p className="usecase-new-service">
          <strong>New external service:</strong>{" "}
          <a href={useCase.newService.url} target="_blank" rel="noopener noreferrer">
            {useCase.newService.name} <span aria-hidden="true">↗</span>
          </a>{" "}
          · {useCase.newService.note}
        </p>
      )}

      <h4>Try it</h4>
      <ol className="usecase-prompts">
        {useCase.prompts.map((prompt) => (
          <li key={prompt.text}>
            <button type="button" onClick={() => onTryPrompt(prompt.text)}>
              <span className="usecase-prompt-text">{prompt.text}</span>
              <span className="usecase-prompt-demo">{prompt.demonstrates}</span>
              <span className="usecase-prompt-go" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ol>

      <h4>Data flow</h4>
      <ol className="usecase-flow" aria-label="Data flow">
        {useCase.flow.map((step, index) => (
          <li key={`${step.from}-${step.to}-${step.carries}`}>
            <span className="usecase-flow-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="usecase-flow-nodes">
              <span className="usecase-flow-node">{step.from}</span>
              <span className="usecase-flow-arrow" aria-hidden="true">
                →
              </span>
              <span className="sr-only">to</span>
              <span className="usecase-flow-node">{step.to}</span>
            </span>
            <span className="usecase-flow-carries">{step.carries}</span>
          </li>
        ))}
      </ol>

      {useCase.graphRole && (
        <div className="usecase-graph-role">
          <strong>
            <span aria-hidden="true">⋈</span> What the graph contributes
          </strong>
          <p>{useCase.graphRole}</p>
        </div>
      )}

      <h4>Systems involved</h4>
      <ul className="usecase-systems">
        {useCase.systems.map((system) => (
          <li key={system.name}>
            <span className="usecase-system-kind">
              <span aria-hidden="true">{KIND_GLYPHS[system.kind]}</span> {system.kind}
            </span>
            <strong>{system.name}</strong>
            <span>{system.role}</span>
          </li>
        ))}
      </ul>

      <dl className="usecase-facts">
        <div>
          <dt>Writes</dt>
          <dd>{useCase.writes}</dd>
        </div>
        {useCase.watch.length > 0 && (
          <div>
            <dt>Watch for</dt>
            <dd>
              <ul>
                {useCase.watch.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}
