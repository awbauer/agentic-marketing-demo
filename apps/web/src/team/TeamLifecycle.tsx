// The pharma lifecycle on the page: the documented path (every agent step and every person's step,
// phase by phase, with where the run is now), the card a person decides on, and the campaign file
// of everything the agents and the system produced. Nothing here moves on its own: tabs change
// only when the reader picks one, and new work lands inside the tab it belongs to.
import {
  type ApprovedJob,
  type AudienceLine,
  type CampaignBrief,
  type Concept,
  currentStep,
  DECILE_LABELS,
  type DeploymentLine,
  type FocusArea,
  type Form2253,
  isChoiceGate,
  type LifecycleState,
  type MlrJob,
  PERSONA_LABELS,
  PHARMA_CHANNELS,
  PHARMA_PHASES,
  type PerformanceReport,
  type PharmaModule,
  type PhaseStep,
  type ResultLine,
  stepDone,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  type TeamEvent,
} from "@northstar/architecture";
import { useState } from "react";
import { ApprovedAssets } from "./TeamWork";

type Artifact = Extract<TeamEvent, { type: "artifact" }>;
type Waiting = Extract<TeamEvent, { type: "await-person" }>;
type Decided = Extract<TeamEvent, { type: "decided" }>;

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const num = (value: number) => value.toLocaleString("en-US");

/** The documented path, with each step marked done, now or to come. */
export function LifecycleSteps({ lifecycle }: { lifecycle: LifecycleState | null }) {
  const now = lifecycle ? currentStep(lifecycle) : null;
  const phaseIndex = lifecycle
    ? PHARMA_PHASES.findIndex((phase) => phase.id === lifecycle.phase)
    : -1;
  return (
    <section className="team-lifecycle" aria-labelledby="team-lifecycle-title">
      <header>
        <h3 id="team-lifecycle-title">The lifecycle, step by step</h3>
        <p className="arch-note">
          <span className="team-step-key agent">Agent</span> steps are done by the team’s agents and
          checked by code; <span className="team-step-key person">Person</span> steps wait for you,
          acting as the role named. A person who asks for changes sends the phase back to its first
          step.
        </p>
      </header>
      <ol className="team-lifecycle-phases">
        {PHARMA_PHASES.map((phase, index) => {
          const reached = lifecycle && (lifecycle.finished || index < phaseIndex);
          const active = lifecycle && !lifecycle.finished && index === phaseIndex;
          const round = lifecycle?.rounds[phase.id] ?? 1;
          return (
            <li
              key={phase.id}
              className={`team-lifecycle-phase${reached ? " reached" : ""}${active ? " active" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              <h4>
                <span className="team-phase-number">{index + 1}</span> {phase.title}
                {round > 1 && <small className="team-round">round {round}</small>}
              </h4>
              <ol className="team-lifecycle-steps">
                {(phase.steps as readonly PhaseStep[]).map((step) => {
                  const done = Boolean(
                    reached || (active && lifecycle && stepDone(lifecycle, step)),
                  );
                  const isNow = active && now === step;
                  const who =
                    step.kind === "agent"
                      ? TEAM_PARTY_LABELS[step.agent]
                      : TEAM_GATES[step.gate].decider;
                  return (
                    <li
                      key={step.kind === "agent" ? step.tool : step.gate}
                      className={`team-step ${step.kind}${done ? " done" : ""}${isNow ? " now" : ""}`}
                    >
                      <span className={`team-step-key ${step.kind}`}>
                        {step.kind === "agent" ? "Agent" : "Person"}
                      </span>
                      <strong>{who}</strong>
                      {step.kind === "agent" && <code>{step.tool}</code>}
                      <span className="team-step-state">
                        {done
                          ? "✓ done"
                          : isNow
                            ? step.kind === "person"
                              ? "your turn"
                              : "working"
                            : ""}
                      </span>
                      <p>{step.does}</p>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Artifacts -----------------------------------------------------------------------------------

function FocusAreas({ areas, chosen }: { areas: FocusArea[]; chosen?: string }) {
  return (
    <ol className="team-options">
      {areas.map((area, index) => (
        <li key={area.title} className={chosen === String(index + 1) ? "chosen" : ""}>
          <strong>{area.title}</strong>
          {chosen === String(index + 1) && <em> · chosen</em>}
          <p>{area.rationale}</p>
          <small>
            Measure: {area.measure} · cites{" "}
            {area.sources.map((source) => (
              <code key={source}>{source}</code>
            ))}
          </small>
        </li>
      ))}
    </ol>
  );
}

function Concepts({ concepts, chosen }: { concepts: Concept[]; chosen?: string }) {
  return (
    <ol className="team-options">
      {concepts.map((concept, index) => (
        <li key={concept.name} className={chosen === String(index + 1) ? "chosen" : ""}>
          <strong>{concept.name}</strong>
          {chosen === String(index + 1) && <em> · chosen</em>}
          <p>{concept.bigIdea}</p>
          <small>
            Carried by{" "}
            {concept.claimTopics.map((topic) => (
              <code key={topic}>{topic}</code>
            ))}
          </small>
          <ApprovedAssets picks={concept.assets} />
        </li>
      ))}
    </ol>
  );
}

/** A module as MLR reads it: copy with reference markers, images, references and fair balance. */
function ModuleView({ module }: { module: PharmaModule }) {
  return (
    <article className={`team-module channel-${module.channel}`}>
      <header>
        <code>{module.id}</code>{" "}
        {module.channel === "email" ? "Approved email" : "HCP display banner"}
      </header>
      <h5>{module.headline}</h5>
      <p>{module.opening}</p>
      <ul className="team-module-claims">
        {module.claims.map((claim) => (
          <li key={claim.topic}>
            {claim.text}
            <sup>{claim.marker}</sup>
          </li>
        ))}
      </ul>
      <p>{module.closing}</p>
      <p className="team-module-cta">{module.cta} →</p>
      {module.assets.length > 0 && <ApprovedAssets picks={module.assets} />}
      <details>
        <summary>References and fair balance</summary>
        <ol className="team-module-refs">
          {module.claims.flatMap((claim) =>
            claim.references.map((reference) => (
              <li key={`${claim.marker}-${reference.source}`} value={claim.marker}>
                {reference.source} ({reference.asOf}; valid to {reference.expiresOn})
              </li>
            )),
          )}
        </ol>
        {module.disclosures.map((item) => (
          <p key={item.id} className="team-module-isi">
            <strong>{item.title}.</strong> {item.text}
          </p>
        ))}
      </details>
    </article>
  );
}

function MlrJobView({ job }: { job: MlrJob }) {
  return (
    <div className="team-work">
      <p>
        <strong>Job {job.jobCode}</strong> · round {job.round} · {job.modules.length} modules
      </p>
      <ul>
        {job.coordinatorNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Module</th>
              <th scope="col">Pre-review check</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {job.checks.map((check) => (
              <tr key={`${check.module}-${check.check}`}>
                <td>
                  <code>{check.module}</code>
                </td>
                <td>{check.check}</td>
                <td className={check.ok ? "ok" : "failed"}>
                  {check.ok ? "✓" : "✗"} {check.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="team-modules">
        {job.modules.map((module) => (
          <ModuleView key={module.id} module={module} />
        ))}
      </div>
    </div>
  );
}

function AudienceView({
  data,
}: {
  data: { lines: AudienceLine[]; totals: Record<string, number>; rule: string; rationale?: string };
}) {
  return (
    <div className="team-work">
      {data.rationale && <p>{data.rationale}</p>}
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Deciles</th>
              <th scope="col">Prescribers</th>
              <th scope="col">Do not contact</th>
              <th scope="col">Email (consented)</th>
              <th scope="col">Rep covered</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.segmentId}>
                <th scope="row">{line.segment}</th>
                <td>{line.deciles.map((band) => DECILE_LABELS[band]).join(", ")}</td>
                <td>{num(line.prescribers)}</td>
                <td>−{num(line.doNotContact)}</td>
                <td>{num(line.emailReachable)}</td>
                <td>{num(line.repCovered)}</td>
              </tr>
            ))}
            <tr className="team-total">
              <th scope="row">Total</th>
              <td />
              <td>{num(data.totals.prescribers ?? 0)}</td>
              <td>−{num(data.totals.doNotContact ?? 0)}</td>
              <td>{num(data.totals.emailReachable ?? 0)}</td>
              <td>{num(data.totals.repCovered ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="arch-note">{data.rule}</p>
    </div>
  );
}

function DeploymentView({ data }: { data: { lines: DeploymentLine[]; totalUsd: number } }) {
  return (
    <div className="team-table-wrap">
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Module</th>
            <th scope="col">Channel</th>
            <th scope="col">Segments</th>
            <th scope="col">Dates</th>
            <th scope="col">Budget</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={`${line.moduleId}-${line.channel}`}>
              <td>
                <code>{line.moduleId}</code>
              </td>
              <td>{PHARMA_CHANNELS[line.channel]?.label ?? line.channel}</td>
              <td>{line.segmentIds.map((id) => id.replace("lt-seg-", "")).join(", ")}</td>
              <td>
                {line.start} → {line.end}
              </td>
              <td>{usd(line.budgetUsd)}</td>
            </tr>
          ))}
          <tr className="team-total">
            <th scope="row" colSpan={4}>
              Total
            </th>
            <td>{usd(data.totalUsd)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FormView({ form }: { form: Form2253 & { coverNote?: string } }) {
  return (
    <div className="team-work">
      <p>
        <strong>{form.form}</strong> · {form.applicant} · {form.product} · submit at first use,{" "}
        {form.submitAtFirstUse}
      </p>
      <ul>
        {form.materials.map((item) => (
          <li key={item.moduleId}>
            <code>{item.documentNumber}</code> {item.description} · first use {item.firstUse}
          </li>
        ))}
      </ul>
      <p className="arch-note">
        {form.note}
        {form.coverNote ? ` Cover note: ${form.coverNote}` : ""}
      </p>
    </div>
  );
}

function ResultsView({ data }: { data: { lines: ResultLine[]; days: number } }) {
  return (
    <div className="team-work">
      <p className="arch-note">
        {data.days} days in market, simulated from the brand’s benchmarks and each segment’s channel
        affinity. This demo has no live channel to read from.
      </p>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Delivered</th>
              <th scope="col">Opens</th>
              <th scope="col">Clicks</th>
              <th scope="col">Rep follow-ups</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <code>{line.id}</code>
                </td>
                <td>{num(line.delivered)}</td>
                <td>{line.channel === "approved-email" ? num(line.opens) : "—"}</td>
                <td>{num(line.clicks)}</td>
                <td>{num(line.repFollowUps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerformanceView({ report }: { report: PerformanceReport }) {
  return (
    <div className="team-work">
      <p>
        Recommends <strong>{report.recommendation}</strong>: {report.rationale}
      </p>
      <ul>
        {report.findings.map((finding) => (
          <li key={finding.text}>
            {finding.text}{" "}
            {finding.sources.map((source) => (
              <code key={source}>{source}</code>
            ))}
          </li>
        ))}
      </ul>
      {report.nextSteps.length > 0 && (
        <p>
          <strong>Next steps:</strong> {report.nextSteps.join(" · ")}
        </p>
      )}
    </div>
  );
}

const ARTIFACT_TITLES: Record<string, string> = {
  propose_focus_areas: "Focus areas",
  propose_concepts: "Concepts",
  draft_modules: "Content modules",
  submit_mlr_job: "MLR job",
  mlr_approval: "MLR approval",
  build_audience: "HCP list",
  schedule_deployment: "Deployment schedule",
  prepare_form_2253: "Form FDA 2253",
  campaign_results: "Results",
  report_performance: "Performance read",
};

export function ArtifactView({
  artifact,
  choices,
}: {
  artifact: Pick<Artifact, "name" | "data">;
  choices?: LifecycleState["choices"];
}) {
  const data = artifact.data as never;
  switch (artifact.name) {
    case "propose_focus_areas":
      return <FocusAreas areas={(data as { areas: FocusArea[] }).areas} chosen={choices?.focus} />;
    case "propose_concepts":
      return (
        <Concepts concepts={(data as { concepts: Concept[] }).concepts} chosen={choices?.concept} />
      );
    case "draft_modules":
      return (
        <div className="team-modules">
          {(data as { modules: PharmaModule[] }).modules.map((module) => (
            <ModuleView key={module.id} module={module} />
          ))}
        </div>
      );
    case "submit_mlr_job":
      return <MlrJobView job={data} />;
    case "mlr_approval": {
      const approved = data as ApprovedJob;
      return (
        <p className="team-approval">
          Approved for distribution as <code>{approved.documentNumber}</code> on{" "}
          {approved.approvedOn}, expiring <strong>{approved.expiresOn}</strong>. Only this version
          of {approved.modules.map((module) => module.id).join(" and ")} may be used.
        </p>
      );
    }
    case "build_audience":
      return <AudienceView data={data} />;
    case "schedule_deployment":
      return <DeploymentView data={data} />;
    case "prepare_form_2253":
      return <FormView form={data} />;
    case "campaign_results":
      return <ResultsView data={data} />;
    case "report_performance":
      return <PerformanceView report={data} />;
    default:
      return <pre className="team-json">{JSON.stringify(artifact.data, null, 2)}</pre>;
  }
}

const by = (artifact: Artifact) =>
  artifact.by === "system" ? "the system" : TEAM_PARTY_LABELS[artifact.by];

/**
 * The campaign file, one tab per phase. The tabs are always the same six and change only when the
 * reader picks one, so work arriving in another phase never moves what they're reading.
 */
export function CampaignFile({
  artifacts,
  lifecycle,
}: {
  artifacts: readonly Artifact[];
  lifecycle: LifecycleState | null;
}) {
  const [tab, setTab] = useState<string>("focus");
  const inTab = artifacts.filter((artifact) => artifact.phase === tab);
  const names = [...new Set(inTab.map((artifact) => artifact.name))];
  return (
    <section className="team-file" aria-labelledby="team-file-title">
      <h3 id="team-file-title">Campaign file</h3>
      <div className="arch-tabs small" role="tablist" aria-label="Phases">
        {PHARMA_PHASES.map((phase) => {
          const count = artifacts.filter((artifact) => artifact.phase === phase.id).length;
          return (
            <button
              key={phase.id}
              type="button"
              role="tab"
              aria-selected={tab === phase.id}
              onClick={() => setTab(phase.id)}
            >
              {phase.title}
              {count ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
      <div className="team-file-body" role="tabpanel">
        {names.length === 0 ? (
          <p className="arch-note">Nothing in this phase yet.</p>
        ) : (
          names.map((name) => {
            const versions = inTab.filter((artifact) => artifact.name === name);
            const latest = versions.at(-1) as Artifact;
            return (
              <article key={name} className="team-file-item">
                <h4>
                  {ARTIFACT_TITLES[name] ?? name}{" "}
                  <small>
                    version {latest.version} · round {latest.round} · by {by(latest)}
                  </small>
                </h4>
                <ArtifactView artifact={latest} choices={lifecycle?.choices} />
                {versions.length > 1 && (
                  <details>
                    <summary>Earlier versions ({versions.length - 1})</summary>
                    {versions.slice(0, -1).map((item) => (
                      <div key={item.version} className="team-file-earlier">
                        <h5>
                          Version {item.version} · round {item.round}
                        </h5>
                        <ArtifactView artifact={item} />
                      </div>
                    ))}
                  </details>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

// The decision --------------------------------------------------------------------------------

/** What each person checks, from the artifacts the step before them produced. */
function Evidence({ waiting, lifecycle }: { waiting: Waiting; lifecycle: LifecycleState }) {
  const latest = (name: keyof LifecycleState["artifacts"]) => {
    const item = lifecycle.artifacts[name];
    return item ? <ArtifactView artifact={{ name, data: item.data }} /> : null;
  };
  switch (waiting.gate) {
    case "concept":
      return latest("propose_concepts");
    case "medical":
    case "legal":
    case "regulatory":
      return latest("submit_mlr_job");
    case "audience":
      return latest("build_audience");
    case "go-live":
      return (
        <>
          {latest("mlr_approval")}
          {latest("schedule_deployment")}
        </>
      );
    case "fda-2253":
      return latest("prepare_form_2253");
    case "next-action":
      return (
        <>
          {latest("report_performance")}
          {latest("campaign_results")}
        </>
      );
    default:
      return null;
  }
}

const PLACEHOLDERS: Partial<Record<string, string>> = {
  focus: "For example: the brand plan puts nurse practitioners first this year.",
  concept: "For example: keep the congress framing, but lead with the safety profile.",
  medical: "For example: the safety claim needs equal prominence with the efficacy claim.",
  legal: "For example: “versus enalapril” is a comparison; confirm it matches the label.",
  regulatory: "For example: the display banner needs the PI link above the fold.",
  audience: "For example: exclude low-decile general cardiologists.",
  "go-live": "For example: hold display until the guideline update.",
  "fda-2253": "For example: attach the current PI version.",
  "next-action": "For example: why optimize rather than continue?",
};

export function LifecycleDecisionCard({
  waiting,
  lifecycle,
  decisions,
  busy,
  onDecide,
}: {
  waiting: Waiting;
  lifecycle: LifecycleState;
  brief: CampaignBrief;
  decisions: readonly Decided[];
  busy: boolean;
  onDecide: (decision: "approve" | "changes", note: string, choice?: string) => void;
}) {
  const spec = TEAM_GATES[waiting.gate];
  const [note, setNote] = useState("");
  const options = waiting.options ?? [];
  const choice = isChoiceGate(waiting.gate);
  const [picked, setPicked] = useState<string>(() => {
    const recommended = options.find((option) => option.detail?.includes("recommends"));
    return recommended?.id ?? options[0]?.id ?? "";
  });
  // Medical hears from the lead; the MLR system routes the job on to Legal and Regulatory.
  const from =
    TEAM_PARTY_LABELS[
      waiting.gate === "legal" || waiting.gate === "regulatory"
        ? "mlr-coordinator"
        : "campaign-lead"
    ];
  const rounds = decisions.filter((decision) => decision.gate === waiting.gate).length;
  return (
    <section
      className={`team-decision-card gate-${waiting.gate}`}
      aria-labelledby="team-decision-title"
    >
      <p className="kicker">
        Your turn · you are the {spec.decider.toLowerCase()} · no agent may take this decision
      </p>
      <h3 id="team-decision-title">
        {waiting.title}
        {rounds > 0 && <small className="team-round">decision {rounds + 1}</small>}
      </h3>
      <blockquote>
        <span>{from}:</span> {waiting.why}
      </blockquote>
      {choice ? (
        <fieldset className="team-choice">
          <legend>Choose one</legend>
          {options.map((option) => (
            <label key={option.id} className={picked === option.id ? "on" : ""}>
              <input
                type="radio"
                name="team-choice"
                value={option.id}
                checked={picked === option.id}
                disabled={busy}
                onChange={() => setPicked(option.id)}
              />
              <strong>{option.label}</strong>
              {option.detail && <small>{option.detail}</small>}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Evidence waiting={waiting} lifecycle={lifecycle} />
      <label className="team-decision-note">
        Notes (needed to ask for changes)
        <textarea
          rows={2}
          value={note}
          disabled={busy}
          placeholder={PLACEHOLDERS[waiting.gate]}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="team-actions">
        <button
          type="button"
          className="arch-primary"
          disabled={busy || (choice && !picked)}
          onClick={() => onDecide("approve", note, choice ? picked : undefined)}
        >
          {choice
            ? "Choose this"
            : waiting.gate === "regulatory"
              ? "Approve for distribution"
              : waiting.gate === "fda-2253"
                ? "Submit and go live"
                : "Approve"}
        </button>
        <button
          type="button"
          className="arch-secondary"
          disabled={busy || note.trim().length < 5}
          onClick={() => onDecide("changes", note)}
        >
          {choice ? "None of these: ask again" : "Ask for changes"}
        </button>
        <small>Sent as {PERSONA_LABELS[waiting.persona]}; the gateway checks the role.</small>
      </div>
    </section>
  );
}
