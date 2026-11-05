import { formatUsd, PRICING_SOURCE } from "@northstar/evals/pricing";
import { EVAL_CHECKS, type EvalReport, EvalReportSchema } from "@northstar/evals/report";
import { useEffect, useMemo, useState } from "react";
import { tokensLabel, toolCallCount, toolCallsLabel, turnStats } from "./turn-stats";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; report: EvalReport };

type Suite = EvalReport["methodology"]["suites"][number]["id"];

const percent = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (value: number | undefined) => (value === undefined ? "—" : formatUsd(value));

type Summary = EvalReport["summaries"][number];
type Result = EvalReport["results"][number];

/** Quality Index as "72 ±6": the mean and half the 95% interval, or a dash when unscored. */
const indexLabel = (interval: Summary["qualityIndex"]) =>
  interval
    ? `${Math.round(interval.mean)}${interval.n > 1 ? ` ±${Math.round((interval.ciHigh - interval.ciLow) / 2)}` : ""}`
    : "—";
const indexTone = (value: number) => (value >= 75 ? "good" : value >= 55 ? "fair" : "poor");

export function EvaluationView({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [suite, setSuite] = useState<Suite>("demo-scenarios");
  const [failureModel, setFailureModel] = useState<string>("all");

  useEffect(() => {
    fetch("/evals/latest.json", { cache: "no-store" })
      .then(async (response) => {
        // The asset router answers unknown paths with the app shell, so non-JSON means no report.
        const isJson = response.headers.get("content-type")?.includes("application/json");
        if (response.status === 404 || (response.ok && !isJson))
          return setState({ status: "missing" });
        if (!response.ok)
          throw new Error(`The evaluation report returned HTTP ${response.status}.`);
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error("The published evaluation report is not valid JSON.");
        }
        const parsed = EvalReportSchema.safeParse(body);
        if (!parsed.success) throw new Error("The evaluation report does not match its contract.");
        setState({ status: "ready", report: parsed.data });
      })
      .catch((error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "The evaluation report is unavailable.",
        }),
      );
  }, []);

  return (
    <section className="evaluations-view" aria-labelledby="evaluations-title">
      <div className="section-header">
        <div>
          <p className="kicker">Quality</p>
          <h2 id="evaluations-title">Evaluations</h2>
        </div>
        <button type="button" className="text-button evaluations-back" onClick={onClose}>
          Back to workspace
        </button>
      </div>
      <div className="evaluations-body">
        {state.status === "loading" && <p role="status">Loading the latest evaluation run…</p>}
        {state.status === "missing" && (
          <div className="evaluation-empty" role="status">
            <strong>No evaluation run has been published yet.</strong>
            <p>
              Run <code>pnpm eval:live</code> with Workers AI access. It evaluates the production
              orchestrator pipeline across models and writes{" "}
              <code>apps/web/public/evals/latest.json</code>, which this page renders.
            </p>
          </div>
        )}
        {state.status === "error" && (
          <div className="error-banner" role="alert">
            {state.message}
          </div>
        )}
        {state.status === "ready" && (
          <ReportView
            report={state.report}
            suite={suite}
            onSuite={setSuite}
            failureModel={failureModel}
            onFailureModel={setFailureModel}
          />
        )}
      </div>
    </section>
  );
}

function ReportView({
  report,
  suite,
  onSuite,
  failureModel,
  onFailureModel,
}: {
  report: EvalReport;
  suite: Suite;
  onSuite: (suite: Suite) => void;
  failureModel: string;
  onFailureModel: (model: string) => void;
}) {
  const labels = new Map(report.models.map((model) => [model.id, model.label]));
  const label = (id: string) => labels.get(id) ?? id;
  const included = report.models.filter((model) => model.included);
  const summary = (model: string, suiteId: Suite) =>
    report.summaries.find((entry) => entry.model === model && entry.suite === suiteId);
  // Mean tokens (input plus output) and tool calls per turn, from the turns behind the summary.
  const meanCost = (model: string, suiteId: Suite) => {
    const turns = report.results.filter(
      (result) => result.model === model && result.suite === suiteId,
    );
    if (turns.length === 0) return null;
    const mean = (values: number[]) =>
      Math.round((values.reduce((sum, value) => sum + value, 0) / turns.length) * 10) / 10;
    return {
      tokens: Math.round(mean(turns.map((turn) => turn.inputTokens + turn.outputTokens))),
      toolCalls: mean(turns.map((turn) => toolCallCount(turn.toolCalled))),
    };
  };
  const suiteMeta = report.methodology.suites.find((entry) => entry.id === suite);
  const checkLabels = new Map(report.methodology.checks.map((check) => [check.id, check.label]));
  const failures = useMemo(
    () =>
      report.results.filter(
        (result) =>
          !result.passed &&
          result.suite === suite &&
          (failureModel === "all" || result.model === failureModel),
      ),
    [report, suite, failureModel],
  );
  const demoSummaries = included.flatMap((model) => summary(model.id, "demo-scenarios") ?? []);
  const hasQuality = demoSummaries.some((entry) => entry.qualityIndex);
  const hasCost = demoSummaries.some((entry) => entry.costPerTurnUsd !== undefined);
  const demoCases = [
    ...new Map(
      report.results
        .filter((result) => result.suite === "demo-scenarios")
        .map((result) => [result.caseId, result.prompt]),
    ),
  ];

  return (
    <>
      <p className="evaluation-meta">
        Run {new Date(report.generatedAt).toLocaleString()} · commit <code>{report.gitSha}</code> ·
        production model <code>{report.productionModel}</code> ·{" "}
        {report.results.length.toLocaleString()} turns
        {report.cost && (
          <>
            {" "}
            · estimated run cost <strong>{usd(report.cost.totalUsd)}</strong> (models{" "}
            {usd(report.cost.contestantsUsd)}, judges {usd(report.cost.judgesUsd)}, simulated agent{" "}
            {usd(report.cost.simulatorUsd)}) at <a href={PRICING_SOURCE}>Cloudflare list prices</a>{" "}
            as of {report.cost.pricingAsOf}
          </>
        )}
      </p>

      <section className="evaluation-card" aria-labelledby="evaluation-models">
        <h3 id="evaluation-models">Model comparison</h3>
        <p className="evaluation-note">
          A turn passes only when every check passes. Latency and tokens cover model turns only.
          {hasCost &&
            " Estimated USD per turn and pass covers demo scenario model calls at Cloudflare list rates. Judges and the simulated agent are included in the run total above."}
          {hasQuality &&
            " Quality index is a 0–100 judge score on the demo scenarios (± is half the 95% interval); “Customer would act” is the share of judged ratings of 4 or 5 given as the audience persona; criteria met is the share of scenario rubric checks the answers satisfied. Quality columns cover the demo scenarios."}
        </p>
        <div className="evaluation-table-wrap">
          <table className="evaluation-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                {report.methodology.suites.map((entry) => (
                  <th scope="col" key={entry.id}>
                    {entry.label}
                  </th>
                ))}
                {hasCost && (
                  <>
                    <th scope="col">Est. USD per turn</th>
                    <th scope="col">Est. USD per pass</th>
                  </>
                )}
                <th scope="col">Median latency</th>
                <th scope="col">Slow runs (p90)</th>
                <th scope="col">Output tokens</th>
                <th scope="col">Tokens per turn</th>
                <th scope="col">Tool calls per turn</th>
                {hasQuality && (
                  <>
                    <th scope="col">Quality index</th>
                    <th scope="col">Customer would act</th>
                    <th scope="col">Criteria met</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {included.map((model) => {
                const demo = summary(model.id, "demo-scenarios");
                const cost = meanCost(model.id, "demo-scenarios");
                return (
                  <tr key={model.id}>
                    <th scope="row">
                      {model.label}
                      {model.id === report.productionModel && (
                        <span className="evaluation-badge">In production</span>
                      )}
                    </th>
                    {report.methodology.suites.map((entry) => {
                      const cell = summary(model.id, entry.id);
                      return (
                        <td key={entry.id}>
                          {cell ? <PassRate passed={cell.passed} total={cell.total} /> : "—"}
                        </td>
                      );
                    })}
                    {hasCost && (
                      <>
                        <td>{usd(demo?.costPerTurnUsd)}</td>
                        <td>{usd(demo?.costPerPassUsd)}</td>
                      </>
                    )}
                    <td>{demo ? seconds(demo.latencyP50Ms) : "—"}</td>
                    <td>{demo ? seconds(demo.latencyP90Ms) : "—"}</td>
                    <td>{demo ? demo.meanOutputTokens.toLocaleString() : "—"}</td>
                    <td>{cost ? tokensLabel(cost.tokens) : "—"}</td>
                    <td>{cost ? toolCallsLabel(cost.toolCalls) : "—"}</td>
                    {hasQuality && (
                      <>
                        <td>
                          {demo?.qualityIndex ? (
                            <span className={`pass-rate ${indexTone(demo.qualityIndex.mean)}`}>
                              {indexLabel(demo.qualityIndex)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {demo?.actionIntentTop2 === undefined
                            ? "—"
                            : percent(demo.actionIntentTop2)}
                        </td>
                        <td>
                          {demo?.criteriaMetRate === undefined
                            ? "—"
                            : percent(demo.criteriaMetRate)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {report.models.some((model) => !model.included) && (
          <ul className="evaluation-excluded">
            {report.models
              .filter((model) => !model.included)
              .map((model) => (
                <li key={model.id}>
                  {model.label} not evaluated{model.note ? `: ${model.note}` : "."}
                </li>
              ))}
          </ul>
        )}
      </section>

      {hasQuality && hasCost && (
        <CostQualityChart
          points={included.flatMap((model) => {
            const entry = summary(model.id, "demo-scenarios");
            return entry?.qualityIndex && entry.costPerTurnUsd
              ? [
                  {
                    label: model.label,
                    cost: entry.costPerTurnUsd,
                    quality: entry.qualityIndex.mean,
                    production: model.id === report.productionModel,
                  },
                ]
              : [];
          })}
        />
      )}

      {hasQuality && <ScenarioQuality report={report} included={included} />}

      <section className="evaluation-card" aria-labelledby="evaluation-checks">
        <div className="evaluation-card-heading">
          <h3 id="evaluation-checks">Checks by model</h3>
          <fieldset className="evaluation-tabs">
            <legend className="sr-only">Evaluation suite</legend>
            {report.methodology.suites.map((entry) => (
              <button
                type="button"
                key={entry.id}
                aria-pressed={entry.id === suite}
                onClick={() => onSuite(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </fieldset>
        </div>
        {suiteMeta && (
          <p className="evaluation-note">
            {suiteMeta.description} {suiteMeta.trials} trial{suiteMeta.trials === 1 ? "" : "s"} per
            prompt.
          </p>
        )}
        <div className="evaluation-table-wrap">
          <table className="evaluation-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                {EVAL_CHECKS.map((check) => (
                  <th scope="col" key={check}>
                    {checkLabels.get(check) ?? check}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {included.map((model) => {
                const cell = summary(model.id, suite);
                return (
                  <tr key={model.id}>
                    <th scope="row">{model.label}</th>
                    {EVAL_CHECKS.map((check) => (
                      <td key={check}>
                        {cell && cell.checkRates[check] !== undefined ? (
                          <RateBar value={cell.checkRates[check]} />
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evaluation-card" aria-labelledby="evaluation-scenarios">
        <h3 id="evaluation-scenarios">Demo scenarios</h3>
        <div className="evaluation-table-wrap">
          <table className="evaluation-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                {included.map((model) => (
                  <th scope="col" key={model.id}>
                    {model.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demoCases.map(([caseId, prompt]) => (
                <tr key={caseId}>
                  <th scope="row" className="evaluation-prompt">
                    {prompt}
                  </th>
                  {included.map((model) => {
                    const runs = report.results.filter(
                      (result) =>
                        result.suite === "demo-scenarios" &&
                        result.caseId === caseId &&
                        result.model === model.id,
                    );
                    return (
                      <td key={model.id}>
                        {runs.length ? (
                          <PassRate
                            passed={runs.filter((result) => result.passed).length}
                            total={runs.length}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evaluation-card" aria-labelledby="evaluation-failures">
        <div className="evaluation-card-heading">
          <h3 id="evaluation-failures">
            Failed turns · {suiteMeta?.label ?? suite} ({failures.length})
          </h3>
          <label className="evaluation-filter">
            Model{" "}
            <select value={failureModel} onChange={(event) => onFailureModel(event.target.value)}>
              <option value="all">All models</option>
              {included.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {failures.length === 0 ? (
          <p className="evaluation-note">No failed turns for this selection.</p>
        ) : (
          <ol className="evaluation-failures">
            {failures.slice(0, 60).map((result) => (
              <li
                className="evaluation-failure"
                key={`${result.model}-${result.caseId}-${result.trial}`}
              >
                <details>
                  <summary>
                    <strong>{result.prompt}</strong>
                    <span>
                      {label(result.model)} · expected <code>{result.expected}</code> · called{" "}
                      <code>{result.toolCalled ?? "no tool"}</code> · failed {result.failure}
                    </span>
                  </summary>
                  <dl>
                    <div>
                      <dt>Route</dt>
                      <dd>{result.route}</dd>
                    </div>
                    <div>
                      <dt>Step finish reasons</dt>
                      <dd>{result.steps || "—"}</dd>
                    </div>
                    <div>
                      <dt>Latency</dt>
                      <dd>
                        {turnStats(seconds(result.latencyMs), {
                          tokens: result.inputTokens + result.outputTokens,
                          toolCalls: toolCallCount(result.toolCalled),
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt>Answer excerpt</dt>
                      <dd>{result.excerpt || "No text"}</dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      {hasQuality && <LowestQuality report={report} label={label} />}

      <section className="evaluation-card" aria-labelledby="evaluation-method">
        <h3 id="evaluation-method">Methodology</h3>
        <p>{report.methodology.summary}</p>
        <h4>Pipeline under test</h4>
        <ol>
          {report.methodology.pipeline.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <h4>Tool results</h4>
        <p>{report.methodology.toolResults}</p>
        {report.methodology.costModel && (
          <>
            <h4>Cost model</h4>
            <p>{report.methodology.costModel}</p>
          </>
        )}
        <h4>Checks</h4>
        <dl className="evaluation-definitions">
          {report.methodology.checks.map((check) => (
            <div key={check.id}>
              <dt>{check.label}</dt>
              <dd>{check.definition}</dd>
            </div>
          ))}
        </dl>
        {report.methodology.dimensions && (
          <>
            <h4>Quality dimensions (judged 1–5)</h4>
            <dl className="evaluation-definitions">
              {report.methodology.dimensions.map((dimension) => (
                <div key={dimension.id}>
                  <dt>{dimension.label}</dt>
                  <dd>
                    {dimension.question}
                    <ol className="evaluation-anchors">
                      {dimension.anchors.map((anchor) => (
                        <li key={anchor}>{anchor}</li>
                      ))}
                    </ol>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {(report.judges || report.agreement || report.calibration) && (
          <>
            <h4>Judge panel</h4>
            <ul>
              {report.judges && (
                <li>
                  Judges: {report.judges.map((judge) => judge.label).join(" and ")}. No model judges
                  its own family.
                </li>
              )}
              {report.agreement && report.agreement.comparisons > 0 && (
                <li>
                  Agreement: the two judges were within one point on{" "}
                  {percent(report.agreement.withinOne / report.agreement.comparisons)} of{" "}
                  {report.agreement.comparisons} shared ratings (mean gap{" "}
                  {report.agreement.meanAbsDiff.toFixed(2)}); {report.agreement.disagreements} of{" "}
                  {report.agreement.turnsCompared} shared turns had a gap of two or more.
                </li>
              )}
              {report.calibration && (
                <li>
                  Calibration {report.calibration.passed ? "passed" : "failed"} on{" "}
                  {new Date(report.calibration.ranAt).toLocaleDateString()}: judges scored the
                  strong reference answers{" "}
                  {Object.values(report.calibration.strongMinusWeak)
                    .map((gap) => Math.round(gap))
                    .join(" and ")}{" "}
                  index points above the weak ones.
                </li>
              )}
            </ul>
          </>
        )}
        <h4>Limitations</h4>
        <ul>
          {report.methodology.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function PassRate({ passed, total }: { passed: number; total: number }) {
  const rate = passed / total;
  return (
    <span className={`pass-rate ${rate >= 0.9 ? "good" : rate >= 0.7 ? "fair" : "poor"}`}>
      {percent(rate)} <small>{`${passed}/${total}`}</small>
    </span>
  );
}

function RateBar({ value }: { value: number }) {
  return (
    <span className="rate-bar">
      <span className="rate-track" aria-hidden="true">
        <span className="rate-fill" style={{ width: percent(value) }} />
      </span>
      {percent(value)}
    </span>
  );
}

type ChartPoint = { label: string; cost: number; quality: number; production: boolean };

// Log-scaled cost against 0-100 quality: the trade-off that decides which model to run. Each point
// is labeled directly; the model comparison table above is the accessible table view.
function CostQualityChart({ points }: { points: ChartPoint[] }) {
  if (points.length < 2) return null;
  const width = 640;
  const height = 300;
  const margin = { top: 16, right: 24, bottom: 44, left: 48 };
  const costs = points.map((point) => point.cost);
  const lo = Math.log10(Math.min(...costs)) - 0.15;
  const hi = Math.log10(Math.max(...costs)) + 0.15;
  const x = (cost: number) =>
    margin.left + ((Math.log10(cost) - lo) / (hi - lo)) * (width - margin.left - margin.right);
  const y = (quality: number) =>
    margin.top + (1 - quality / 100) * (height - margin.top - margin.bottom);
  const ticks: number[] = [];
  for (let power = Math.floor(lo); power <= Math.ceil(hi); power++)
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** power;
      if (Math.log10(value) >= lo && Math.log10(value) <= hi) ticks.push(value);
    }
  const summary = points
    .map(
      (point) =>
        `${point.label}: quality ${Math.round(point.quality)}, ${usd(point.cost)} per turn`,
    )
    .join("; ");
  return (
    <section className="evaluation-card" aria-labelledby="evaluation-cost-quality">
      <h3 id="evaluation-cost-quality">Cost vs quality</h3>
      <p className="evaluation-note">
        Higher and further left is better. Cost per turn is on a log scale; the ringed model is in
        production.
      </p>
      <svg
        className="cost-quality"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cost per turn against quality index. ${summary}`}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              className="cq-grid"
              x1={margin.left}
              x2={width - margin.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="cq-tick" x={margin.left - 8} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text
            className="cq-tick"
            key={tick}
            x={x(tick)}
            y={height - margin.bottom + 16}
            textAnchor="middle"
          >
            {usd(tick)}
          </text>
        ))}
        <text
          className="cq-axis"
          x={(margin.left + width - margin.right) / 2}
          y={height - 6}
          textAnchor="middle"
        >
          Cost per turn (log scale)
        </text>
        <text
          className="cq-axis"
          transform={`translate(12 ${height / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Quality index
        </text>
        {points.map((point) => {
          const flip = x(point.cost) > width * 0.72;
          return (
            <g key={point.label}>
              <title>{`${point.label}: quality ${Math.round(point.quality)}, ${usd(point.cost)} per turn`}</title>
              {point.production && (
                <circle className="cq-ring" cx={x(point.cost)} cy={y(point.quality)} r={10} />
              )}
              <circle className="cq-dot" cx={x(point.cost)} cy={y(point.quality)} r={6} />
              <text
                className="cq-label"
                x={x(point.cost) + (flip ? -14 : 14)}
                y={y(point.quality) + 4}
                textAnchor={flip ? "end" : "start"}
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

const meanOf = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;

function ScenarioQuality({
  report,
  included,
}: {
  report: EvalReport;
  included: EvalReport["models"];
}) {
  const rubrics = report.methodology.rubric ?? [];
  const dimensionLabels = new Map(
    (report.methodology.dimensions ?? []).map((d) => [d.id, d.label]),
  );
  const demo = report.results.filter((result) => result.suite === "demo-scenarios");
  const cell = (caseId: string, model: string) =>
    demo.filter((result) => result.caseId === caseId && result.model === model);
  const promptOf = (caseId: string) =>
    demo.find((result) => result.caseId === caseId)?.prompt ?? caseId;
  return (
    <section className="evaluation-card" aria-labelledby="evaluation-scenario-quality">
      <h3 id="evaluation-scenario-quality">Scenario quality and rubric</h3>
      <p className="evaluation-note">
        Each scenario says what a good answer is. Scores are the mean Quality Index (0–100); open a
        scenario for its goal, audience, criteria, and per-dimension ratings.
      </p>
      {rubrics.map((rubric) => {
        const scored = included.map((model) => ({
          model,
          index: meanOf(
            cell(rubric.caseId, model.id).flatMap((result) =>
              result.quality && !result.quality.judgeError ? [result.quality.index] : [],
            ),
          ),
        }));
        const judged = Object.keys(rubric.weights).length > 0;
        return (
          <details className="evaluation-scenario" key={rubric.caseId}>
            <summary>
              <strong>{promptOf(rubric.caseId)}</strong>
              <span className="evaluation-chips">
                {judged
                  ? scored.map(({ model, index }) => (
                      <span
                        className={`chip ${index === undefined ? "" : indexTone(index)}`}
                        key={model.id}
                      >
                        {model.label} {index === undefined ? "—" : Math.round(index)}
                      </span>
                    ))
                  : "Scored by criteria only"}
              </span>
            </summary>
            <p>
              <strong>Goal:</strong> {rubric.goal}
            </p>
            {rubric.persona && (
              <p>
                <strong>Audience:</strong> {rubric.persona}
              </p>
            )}
            <div className="evaluation-table-wrap">
              <table className="evaluation-table">
                <thead>
                  <tr>
                    <th scope="col">Criterion</th>
                    {included.map((model) => (
                      <th scope="col" key={model.id}>
                        {model.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rubric.criteria.map((criterion) => (
                    <tr key={criterion.id}>
                      <th scope="row">{criterion.label}</th>
                      {included.map((model) => {
                        const runs = cell(rubric.caseId, model.id).flatMap(
                          (result) =>
                            result.criteria?.find((item) => item.id === criterion.id) ?? [],
                        );
                        return (
                          <td key={model.id}>
                            {runs.length
                              ? percent(runs.filter((run) => run.met).length / runs.length)
                              : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {judged &&
                    Object.entries(rubric.weights).map(([dimension, weight]) => (
                      <tr key={dimension}>
                        <th scope="row">
                          {dimensionLabels.get(dimension as never) ?? dimension}{" "}
                          <small>weight {weight}</small>
                        </th>
                        {included.map((model) => {
                          const scores = cell(rubric.caseId, model.id).flatMap((result) => {
                            const value = result.quality?.dimensionMeans[dimension as never];
                            return typeof value === "number" ? [value] : [];
                          });
                          const value = meanOf(scores);
                          return (
                            <td key={model.id}>
                              {value === undefined ? "—" : `${value.toFixed(1)} / 5`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </section>
  );
}

function LowestQuality({ report, label }: { report: EvalReport; label: (id: string) => string }) {
  const scored = report.results
    .filter((result): result is Result & { quality: NonNullable<Result["quality"]> } =>
      Boolean(result.quality?.judges.length),
    )
    .sort((a, b) => a.quality.index - b.quality.index)
    .slice(0, 8);
  if (scored.length === 0) return null;
  const disagrees = (result: Result) => {
    const [a, b] = result.quality?.judges ?? [];
    return Boolean(
      a &&
        b &&
        Object.entries(a.scores).some(([key, value]) => {
          const other = (b.scores as Record<string, number | undefined>)[key];
          return (
            typeof value === "number" && typeof other === "number" && Math.abs(value - other) >= 2
          );
        }),
    );
  };
  return (
    <section className="evaluation-card" aria-labelledby="evaluation-lowest">
      <h3 id="evaluation-lowest">Lowest-scoring answers</h3>
      <p className="evaluation-note">
        The judges' ratings and evidence for the weakest judged answers, so you can check the score
        against the text.
      </p>
      <ol className="evaluation-failures">
        {scored.map((result) => (
          <li
            className="evaluation-failure"
            key={`${result.model}-${result.caseId}-${result.trial}`}
          >
            <details>
              <summary>
                <strong>{result.prompt}</strong>
                <span>
                  {label(result.model)} · index {Math.round(result.quality.index)}
                  {disagrees(result) && " · judges disagree by 2+ points"}
                </span>
              </summary>
              <dl>
                {result.toolRequests && result.toolRequests.length > 0 && (
                  <div>
                    <dt>What the model asked the tools for</dt>
                    <dd>{result.toolRequests.join(" → ")}</dd>
                  </div>
                )}
                <div>
                  <dt>Answer</dt>
                  <dd className="evaluation-answer">{result.answer ?? result.excerpt}</dd>
                </div>
                {result.quality.judges.map((judge) => (
                  <div key={judge.model}>
                    <dt>{label(judge.model)}</dt>
                    <dd>
                      {Object.entries(judge.scores)
                        .map(([dimension, score]) => `${dimension} ${score}`)
                        .join(" · ")}
                      <br />
                      {judge.rationale}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
