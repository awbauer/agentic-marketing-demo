// The pharma lifecycle on the page: a stepper with the whole documented path and where the run is,
// a workspace for one phase at a time (its steps, the decision when it's the reader's turn there,
// and what it produced), and the views of each output. Nothing moves on its own: the workspace
// changes phase only when the reader picks one or has just decided something.
import {
  type ApprovedJob,
  type AudienceLine,
  type CampaignBrief,
  CLAIM_GAP_LABELS,
  CLAIM_GAP_ROUTES,
  type ClaimGap,
  type ClaimTrace,
  type ClaimUsage,
  type Concept,
  currentStep,
  DECILE_LABELS,
  type DeploymentLine,
  type FinalFormCheck,
  type FocusArea,
  type Form2253,
  isChoiceGate,
  LIFECYCLE_ROLES,
  type LifecycleState,
  type MlrJob,
  PERSONA_LABELS,
  type PerformanceReport,
  PHARMA_CHANNELS,
  PHARMA_PHASES,
  type PharmaModule,
  type PhaseStep,
  type Placement,
  phaseOfGate,
  REVIEW_TIER_LABELS,
  type ResultLine,
  type SafetyIntake,
  type SeededOutcome,
  stepDone,
  TEAM_GATES,
  TEAM_PARTY_LABELS,
  type TeamEvent,
  type WriteReceipt,
} from "@northstar/architecture";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Claim } from "./Claims";
import { useTechnical } from "./detail";
import { RichText, SourceChips } from "./RichText";
import { ApprovedAssets } from "./TeamWork";
import type { GuardrailHit } from "./team-state";

type Artifact = Extract<TeamEvent, { type: "artifact" }>;
type Waiting = Extract<TeamEvent, { type: "await-person" }>;
type Decided = Extract<TeamEvent, { type: "decided" }>;

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const num = (value: number) => value.toLocaleString("en-US");

// Artifacts -----------------------------------------------------------------------------------

/** One focus area, laid out to scan: why, how success is measured, and the data it cites. */
function FocusAreaBody({ area }: { area: FocusArea }) {
  return (
    <div className="team-option-body">
      <h6>Why</h6>
      <RichText text={area.rationale} />
      {area.measure && (
        <>
          <h6>How we'd measure it</h6>
          <RichText text={area.measure} />
        </>
      )}
      <SourceChips ids={area.sources} />
    </div>
  );
}

function FocusAreas({ areas, chosen }: { areas: FocusArea[]; chosen?: string }) {
  return (
    <ol className="team-options">
      {areas.map((area, index) => (
        <li key={area.title} className={chosen === String(index + 1) ? "chosen" : ""}>
          <strong>{area.title}</strong>
          {chosen === String(index + 1) && <em> · chosen</em>}
          <FocusAreaBody area={area} />
        </li>
      ))}
    </ol>
  );
}

/** One concept: the idea, the claims that carry it and the approved images it uses. */
function ConceptBody({ concept }: { concept: Concept }) {
  return (
    <div className="team-option-body">
      <RichText text={concept.bigIdea} />
      <p className="team-rich-sources">
        <span>Claims</span>
        {concept.claimTopics.map((topic) => (
          <Claim key={topic} id={topic} />
        ))}
      </p>
      <ApprovedAssets picks={concept.assets} />
    </div>
  );
}

function Concepts({ concepts, chosen }: { concepts: Concept[]; chosen?: string }) {
  return (
    <ol className="team-options">
      {concepts.map((concept, index) => (
        <li key={concept.name} className={chosen === String(index + 1) ? "chosen" : ""}>
          <strong>{concept.name}</strong>
          {chosen === String(index + 1) && <em> · chosen</em>}
          <ConceptBody concept={concept} />
        </li>
      ))}
    </ol>
  );
}

type Source = "claim" | "written" | "required" | "unmatched";

/** Where each part of a module came from, in a reviewer's words. */
const SOURCES: Record<Source, { label: string; title: string }> = {
  claim: {
    label: "Approved claim · verbatim",
    title: "Entered from the claims library by its ID, word for word. Already MLR-approved.",
  },
  written: {
    label: "AI-written · full MLR",
    title:
      "Written for this campaign by the agent. New words are new meaning: Medical, Legal and Regulatory review them in full.",
  },
  required: {
    label: "Required text · system-attached",
    title:
      "Attached by the system, not the agent: the claim's required context, or the ISI, boxed warning and PI link.",
  },
  unmatched: {
    label: "Not from the library",
    title:
      "This line has no claim ID, so it is not approved content. A pre-check refuses it before review.",
  },
};

function SourceTag({ source }: { source: Source }) {
  return (
    <span className={`team-provenance ${source}`} title={SOURCES[source].title}>
      {SOURCES[source].label}
    </span>
  );
}

/** How much of a module is approved content, AI-written, or attached by the system. */
export function provenanceOf(module: PharmaModule) {
  const written = [module.headline, module.opening, module.closing, module.cta].filter((text) =>
    text.trim(),
  ).length;
  const verbatim = module.claims.filter((claim) => claim.claimId).length;
  const required =
    module.claims.filter((claim) => claim.context).length + module.disclosures.length;
  return { verbatim, written, required, unmatched: module.claims.length - verbatim };
}

/**
 * A module as MLR reads it: copy with reference markers, images, references and fair balance. Each
 * part says where it came from: an approved claim entered word for word, words the agent wrote
 * (which MLR reviews in full), or required text the system attached.
 */
function ModuleView({ module }: { module: PharmaModule }) {
  const count = provenanceOf(module);
  return (
    <article className={`team-module channel-${module.channel}`}>
      <header>
        <code>{module.id}</code>{" "}
        {module.channel === "email" ? "Brand email to consented HCPs" : "HCP display banner"}
      </header>
      <p className="team-provenance-summary">
        {count.verbatim} approved {count.verbatim === 1 ? "claim" : "claims"} word for word ·{" "}
        {count.written} AI-written {count.written === 1 ? "line" : "lines"} for full MLR ·{" "}
        {count.required} required {count.required === 1 ? "text" : "texts"} attached by the system
        {count.unmatched ? ` · ${count.unmatched} not from the library` : ""}
      </p>
      <h5>
        {module.headline} <SourceTag source="written" />
      </h5>
      <p>
        {module.opening} <SourceTag source="written" />
      </p>
      <ul className="team-module-claims">
        {module.claims.map((claim) => (
          <li key={claim.topic}>
            {claim.text}
            <sup>{claim.marker}</sup> <SourceTag source={claim.claimId ? "claim" : "unmatched"} />
            {claim.claimId && (
              <span className="team-claim-id">
                <Claim id={claim.claimId} />
              </span>
            )}
            {claim.context && (
              <small className="team-module-context">
                {claim.context} <SourceTag source="required" />
              </small>
            )}
          </li>
        ))}
      </ul>
      <p>
        {module.closing} <SourceTag source="written" />
      </p>
      <p className="team-module-cta">
        {module.cta} → <SourceTag source="written" />
      </p>
      {module.assets.length > 0 && <ApprovedAssets picks={module.assets} />}
      <details>
        <summary>
          References and fair balance <SourceTag source="required" />
        </summary>
        <ol className="team-module-refs">
          {module.claims.flatMap((claim) =>
            claim.references.map((reference) => (
              <li key={`${claim.marker}-${reference.source}`} value={claim.marker}>
                {reference.source}
                {reference.anchor ? `, ${reference.anchor}` : ""} ({reference.asOf}; valid to{" "}
                {reference.expiresOn})
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

/**
 * The MLR job as a review system lays it out: the job's header (code, version, review path, who
 * owns the content, who submitted it, who reviews, the label it was checked against), then the
 * coordinator's notes, the quality checks and the modules.
 */
function MlrJobView({ job }: { job: MlrJob }) {
  const labels = [
    ...new Set(
      job.modules.flatMap((module) =>
        module.claims.flatMap((claim) => (claim.labelVersion ? [claim.labelVersion] : [])),
      ),
    ),
  ];
  const full = job.tier?.tier !== "B";
  return (
    <div className="team-work">
      <dl className="team-job-header">
        <div>
          <dt>Job code</dt>
          <dd>
            <code>{job.jobCode}</code>
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>
            Round {job.round} · {job.modules.length} modules
          </dd>
        </div>
        <div>
          <dt>Review path</dt>
          <dd>{job.tier ? REVIEW_TIER_LABELS[job.tier.tier] : "Not set"}</dd>
        </div>
        <div>
          <dt>Content owner</dt>
          <dd>Brand lead</dd>
        </div>
        <div>
          <dt>Submitted by</dt>
          <dd>MLR submission agent, for the MLR coordinator</dd>
        </div>
        <div>
          <dt>Reviewers</dt>
          <dd>
            {full ? "Medical, Legal, Regulatory (final approval)" : "One reviewer, sampled audit"}
          </dd>
        </div>
        {labels.length > 0 && (
          <div>
            <dt>Checked against</dt>
            <dd>{labels.join(", ")}</dd>
          </div>
        )}
      </dl>
      {job.tier && (
        <p className="team-tier">
          <strong>{REVIEW_TIER_LABELS[job.tier.tier]}</strong>: {job.tier.path}.{" "}
          <span className="arch-note">{job.tier.reason}</span>
        </p>
      )}
      <ul>
        {job.coordinatorNotes.map((note) => (
          <li key={note}>
            <RichText text={note} />
          </li>
        ))}
      </ul>
      {/* Closed while every check passes, so a long table doesn't push the modules and the
      reviewer's buttons screens away; a failed check opens it. */}
      <details className="team-checks" open={job.checks.some((check) => !check.ok)}>
        <summary>
          Quality checks before review: {job.checks.filter((check) => check.ok).length} of{" "}
          {job.checks.length} passed
        </summary>
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Quality check</th>
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
      </details>
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

function DeploymentView({
  data,
}: {
  data: { lines: DeploymentLine[]; placements?: Placement[]; totalUsd: number };
}) {
  const placementOf = (line: DeploymentLine) =>
    data.placements?.find(
      (item) => item.moduleId === line.moduleId && item.channel === line.channel,
    );
  return (
    <div className="team-table-wrap">
      <table className="team-table">
        <thead>
          <tr>
            <th scope="col">Placement</th>
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
                {placementOf(line) ? (
                  <>
                    <code>{placementOf(line)?.placementId}</code>
                    <small className="team-claim-ids">
                      {placementOf(line)?.claimIds.map((id) => (
                        <Claim key={id} id={id} />
                      ))}
                    </small>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <code>{placementOf(line)?.materialId ?? line.moduleId}</code>
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
            <th scope="row" colSpan={5}>
              Total
            </th>
            <td>{usd(data.totalUsd)}</td>
          </tr>
        </tbody>
      </table>
      {data.placements && (
        <p className="arch-note">
          Each placement carries its material ID and claim IDs into the channel, so a label change
          or an expired claim can be traced to every live placement.
        </p>
      )}
    </div>
  );
}

function FinalFormView({ check }: { check: FinalFormCheck }) {
  return (
    <div className="team-work">
      <p>
        {check.variants.length} built variants checked against <code>{check.documentNumber}</code>:{" "}
        <strong>
          {check.allMatch
            ? "every one matches the approved version"
            : "a variant differs; publishing is blocked"}
        </strong>
        .
      </p>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Variant</th>
              <th scope="col">Checks</th>
            </tr>
          </thead>
          <tbody>
            {check.variants.map((variant) => (
              <tr key={`${variant.materialId}-${variant.variant}`}>
                <td>
                  <code>{variant.materialId}</code>
                </td>
                <td>{variant.variant}</td>
                <td className={variant.ok ? "ok" : "failed"}>
                  {variant.checks.map((item) => (
                    <span key={item.check} className="team-check-line">
                      {item.ok ? "✓" : "✗"} {item.check}: {item.detail}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A write the system made outside the squad: keyed so a retry can't repeat it, then read back from
 * the system that took it and compared with what was sent. Success is what the read-back shows.
 */
function ReceiptView({ receipt }: { receipt: WriteReceipt }) {
  return (
    <div className="team-work">
      <p>
        <strong>{receipt.status}.</strong> {receipt.system}: reference{" "}
        <code>{receipt.reference}</code>, idempotency key <code>{receipt.idempotencyKey}</code>
        {receipt.attempts > 1
          ? `, attempted ${receipt.attempts} times and written once`
          : ", written once"}
        .
      </p>
      <p className={receipt.matches ? "ok" : "failed"}>
        {receipt.matches
          ? `Read back: the system holds all ${receipt.readBack.length} items, exactly as sent.`
          : `Read back: the system holds ${receipt.readBack.length} of ${receipt.sent.length} items sent. They don't match; nothing is reported as done.`}
      </p>
      <ul className="team-receipt-lines">
        {receipt.sent.map((line) => (
          <li key={line}>
            {receipt.readBack.includes(line) ? "✓" : "✗"} <code>{line}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** HCP replies screened for possible adverse events and off-label questions, each routed out. */
function SafetyIntakeView({ intake }: { intake: SafetyIntake }) {
  return (
    <div className="team-work">
      <p>
        {intake.screened} replies to the emails screened (simulated).{" "}
        {intake.flags.length
          ? `${intake.flags.length} routed out of marketing; promotion answers none of them.`
          : "None needed routing."}
      </p>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Reply</th>
              <th scope="col">Flag</th>
              <th scope="col">Goes to, by</th>
            </tr>
          </thead>
          <tbody>
            {intake.replies.map((reply) => {
              const flag = intake.flags.find((item) => item.replyId === reply.id);
              return (
                <tr key={reply.id}>
                  <td>
                    <q>{reply.text}</q>
                  </td>
                  <td className={flag?.kind === "possible-adverse-event" ? "failed" : undefined}>
                    {flag
                      ? `${flag.kind === "possible-adverse-event" ? "Possible adverse event" : "Off-label question"} (“${flag.matched}”)`
                      : "—"}
                  </td>
                  <td>{flag ? `${flag.route}; ${flag.due}` : "The field team, as usual"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Cite or refuse: the points the squad couldn't support with approved content. None was written;
 * each is the content team's backlog for a new claim through MLR, or a question for medical
 * information.
 */
export function GapLog({ gaps, all }: { gaps: readonly ClaimGap[]; all?: boolean }) {
  if (!gaps.length) return null;
  return (
    <details className="team-output team-gap-log" open={all}>
      <summary>
        <strong>{all ? "Claim gap log" : "Claim gaps"}</strong>
        <span>
          {gaps.length} point{gaps.length === 1 ? "" : "s"} approved content couldn&rsquo;t support,
          recorded, not written
        </span>
      </summary>
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">Why not</th>
              <th scope="col">Goes to</th>
              <th scope="col">Raised by</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap) => (
              <tr key={gap.id}>
                <td>
                  <q>{gap.point}</q>
                </td>
                <td>
                  <strong>{CLAIM_GAP_LABELS[gap.kind]}.</strong> {gap.reason}
                </td>
                <td>{CLAIM_GAP_ROUTES[gap.route]}</td>
                <td>
                  {TEAM_PARTY_LABELS[gap.raisedBy as keyof typeof TEAM_PARTY_LABELS] ??
                    gap.raisedBy}{" "}
                  <small>({gap.product})</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="arch-note">
        The agents assemble facts only from the approved claims library. What they can&rsquo;t cite
        isn&rsquo;t written: it lands here with the date and product, and this log is the content
        team&rsquo;s backlog for new claims through MLR. What customers ask that approved content
        can&rsquo;t answer was rarely measured before.
      </p>
    </details>
  );
}

/** Once the MLR reviewers have decided, whether they caught the flaw seeded into their queue. */
export function SeededReveal({ outcome }: { outcome: SeededOutcome }) {
  if (!outcome) return null;
  return (
    <div className={`team-seeded ${outcome.caught ? "ok" : "failed"}`} role="status">
      <strong>
        Seeded flaw {outcome.caught ? "caught" : "missed"}: module {outcome.seeded.moduleId}.
      </strong>{" "}
      {outcome.seeded.flaw}{" "}
      {outcome.caught
        ? `${outcome.by ? TEAM_GATES[outcome.by as keyof typeof TEAM_GATES]?.decider : "A reviewer"} asked for changes.`
        : "Every reviewer approved the job carrying it."}{" "}
      The MLR system slipped it in after the automated checks to measure the review, and it never
      reaches approval either way.
    </div>
  );
}

function ClaimTraceView({ trace }: { trace: ClaimTrace }) {
  return (
    <div className="team-work">
      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Claim</th>
              <th scope="col">Live in</th>
              <th scope="col">Label</th>
              <th scope="col">Expires</th>
              <th scope="col">Re-review by</th>
            </tr>
          </thead>
          <tbody>
            {trace.claims.map((claim) => (
              <tr key={claim.claimId}>
                <th scope="row">
                  <Claim id={claim.claimId} /> <small>{claim.topic}</small>
                </th>
                <td>
                  {claim.placements.length
                    ? claim.placements
                        .map(
                          (item) =>
                            `${item.placementId} (${PHARMA_CHANNELS[item.channel]?.label ?? item.channel})`,
                        )
                        .join(", ")
                    : "Nowhere"}
                </td>
                <td>{claim.labelVersion}</td>
                <td>{claim.expiresOn}</td>
                <td>{claim.reReviewBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trace.withdrawal && (
        <>
          <h6>Withdrawal plan</h6>
          <ul>
            {trace.withdrawal.map((item) => (
              <li key={item.placementId}>
                <code>{item.placementId}</code> <code>{item.materialId}</code>{" "}
                {PHARMA_CHANNELS[item.channel]?.label ?? item.channel} ·{" "}
                {item.claimIds.map((id) => (
                  <Claim key={id} id={id} />
                ))}{" "}
                · {item.status}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="arch-note">{trace.coverage}</p>
    </div>
  );
}

function FormView({ form }: { form: Form2253 & { coverNote?: string } }) {
  return (
    <div className="team-work">
      <p>
        <strong>{form.form}</strong> · {form.applicant} · {form.product} · submit at first use,{" "}
        {form.submitAtFirstUse}
        {form.currentPi ? ` · current PI ${form.currentPi}` : ""}
      </p>
      <ul>
        {form.materials.map((item) => (
          <li key={item.moduleId}>
            <code>{item.materialId ?? item.documentNumber}</code> {item.description} · first use{" "}
            {item.firstUse}
          </li>
        ))}
      </ul>
      {form.timing && <p className="arch-note">{form.timing}</p>}
      <p className="arch-note">
        {form.note}
        {form.coverNote ? ` Cover note: ${form.coverNote}` : ""}
      </p>
    </div>
  );
}

function ResultsView({
  data,
}: {
  data: { lines: ResultLine[]; days: number; byClaim?: ClaimUsage[] };
}) {
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
      {data.byClaim && data.byClaim.length > 0 && (
        <>
          <h6>By claim</h6>
          <ul className="team-claim-usage">
            {data.byClaim.map((usage) => (
              <li key={usage.claimId}>
                <Claim id={usage.claimId} /> · {num(usage.delivered)} reached (email deliveries and
                display impressions) · {num(usage.clicks)} clicks · {usage.lines} result lines
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PerformanceView({ report }: { report: PerformanceReport }) {
  return (
    <div className="team-work">
      <p>
        Recommends <strong>{report.recommendation}</strong>
      </p>
      <RichText text={report.rationale} />
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

export const ARTIFACT_TITLES: Record<string, string> = {
  propose_focus_areas: "Focus areas",
  propose_concepts: "Concepts",
  draft_modules: "Content modules",
  submit_mlr_job: "MLR job",
  mlr_approval: "MLR approval",
  final_form_check: "Final form check",
  claim_trace: "Where every claim is live",
  build_audience: "HCP list",
  schedule_deployment: "Deployment schedule",
  prepare_form_2253: "Form FDA 2253",
  campaign_results: "Results",
  report_performance: "Performance read",
  deployment_receipt: "Booking, read back",
  form_2253_receipt: "Form 2253 filing, read back",
  safety_intake: "Safety screening of HCP replies",
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
          {approved.approvedOn}
          {approved.labelVersion ? ` against ${approved.labelVersion}` : ""}, expiring{" "}
          <strong>{approved.expiresOn}</strong>. Only this version may be used:{" "}
          {(
            approved.materials ??
            approved.modules.map((module) => ({
              materialId: module.id,
              moduleId: module.id,
              claimIds: [] as string[],
            }))
          )
            .map(
              (item) =>
                `${item.materialId}${item.claimIds.length ? ` (${item.claimIds.join(", ")})` : ""}`,
            )
            .join("; ")}
          .
        </p>
      );
    }
    case "final_form_check":
      return <FinalFormView check={data} />;
    case "claim_trace":
      return <ClaimTraceView trace={data} />;
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
    case "deployment_receipt":
    case "form_2253_receipt":
      return <ReceiptView receipt={data} />;
    case "safety_intake":
      return <SafetyIntakeView intake={data} />;
    default:
      return <pre className="team-json">{JSON.stringify(artifact.data, null, 2)}</pre>;
  }
}

const by = (artifact: Artifact) =>
  artifact.by === "system" ? "the system" : TEAM_PARTY_LABELS[artifact.by];

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
    case "concept-review": {
      const concepts = (lifecycle.artifacts.propose_concepts?.data as { concepts?: Concept[] })
        ?.concepts;
      const picked = concepts?.[Number(lifecycle.choices.concept ?? 0) - 1];
      return picked ? (
        <div className="team-work">
          <p>
            <strong>{picked.name}</strong>, chosen by the brand lead. Nothing has been built yet.
          </p>
          <ConceptBody concept={picked} />
        </div>
      ) : (
        latest("propose_concepts")
      );
    }
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
          {latest("final_form_check")}
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
  "concept-review":
    "For example: the patient image implies an activity benefit the trial didn't measure.",
  medical: "For example: the safety claim needs equal prominence with the efficacy claim.",
  legal: "For example: “versus enalapril” is a comparison; confirm it matches the label.",
  regulatory: "For example: the display banner needs the PI link above the fold.",
  audience: "For example: exclude low-decile general cardiologists.",
  "go-live": "For example: hold display until the guideline update.",
  "fda-2253": "For example: attach the current PI version.",
  "next-action": "For example: why optimize rather than continue?",
};

/** An option's detail, from the agents' structured work where there is some. */
function OptionBody({
  gate,
  id,
  detail,
  lifecycle,
}: {
  gate: string;
  id: string;
  detail?: string;
  lifecycle: LifecycleState;
}) {
  const index = Number(id) - 1;
  if (gate === "focus") {
    const area = (lifecycle.artifacts.propose_focus_areas?.data as { areas?: FocusArea[] })
      ?.areas?.[index];
    if (area) return <FocusAreaBody area={area} />;
  }
  if (gate === "concept") {
    const concept = (lifecycle.artifacts.propose_concepts?.data as { concepts?: Concept[] })
      ?.concepts?.[index];
    if (concept) return <ConceptBody concept={concept} />;
  }
  return detail ? <RichText text={detail} className="team-option-body" /> : null;
}

export function LifecycleDecisionCard({
  waiting,
  lifecycle,
  decisions,
  busy,
  onDecide,
  seeding = false,
}: {
  waiting: Waiting;
  lifecycle: LifecycleState;
  brief: CampaignBrief;
  /** The run seeds a flawed item into the MLR queue; reviewers are told it happens. */
  seeding?: boolean;
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
        <span>{from}</span>
        <RichText text={waiting.why} />
      </blockquote>
      {["medical", "legal", "regulatory"].includes(waiting.gate) && (
        <p className="arch-note team-oversight-note">
          Reviews are measured: time to decide and how often changes are asked for.
          {seeding
            ? " This run seeds a deliberately flawed item into the MLR queue; read every module as you would a real job."
            : ""}
        </p>
      )}
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
              <OptionBody
                gate={waiting.gate}
                id={option.id}
                detail={option.detail}
                lifecycle={lifecycle}
              />
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
                ? "File 2253 with OPDP (publishing then releases)"
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

// The consolidated layout -------------------------------------------------------------------------
// One phase at a time: a stepper across the top shows the whole path and where the run is; the
// workspace below shows the chosen phase's documented steps, the decision when it's the reader's
// turn there, and what the phase produced. Each output is a summary line that opens to its detail.

type PhaseId = (typeof PHARMA_PHASES)[number]["id"];

/** Where each phase stands: done, active (with its round), or still to come. */
function phaseStatus(lifecycle: LifecycleState | null, index: number) {
  if (!lifecycle) return "todo" as const;
  const active = PHARMA_PHASES.findIndex((phase) => phase.id === lifecycle.phase);
  if (lifecycle.finished || index < active) return "done" as const;
  return index === active ? ("active" as const) : ("todo" as const);
}

function stepState(
  lifecycle: LifecycleState | null,
  index: number,
  step: PhaseStep,
): "done" | "now" | "todo" {
  const status = phaseStatus(lifecycle, index);
  if (status === "done") return "done";
  if (status !== "active" || !lifecycle) return "todo";
  if (stepDone(lifecycle, step)) return "done";
  return currentStep(lifecycle) === step ? "now" : "todo";
}

type Stage = { title: string; familiar: string; steps: readonly PhaseStep[]; letter: string };

/**
 * A phase as the path shows it: one stage, or, where its steps name stages (content: copy and
 * creative, then MLR review and approval), one per stage, in order. The server still runs it as
 * one phase; the split is how a content team reads it.
 */
export function stagesOf(phase: (typeof PHARMA_PHASES)[number]): Stage[] {
  const steps = phase.steps as readonly PhaseStep[];
  if (!steps.some((step) => step.stage))
    return [{ title: phase.title, familiar: phase.familiar, steps, letter: "" }];
  const stages: Stage[] = [];
  for (const step of steps) {
    const title = step.stage ?? phase.title;
    const last = stages.at(-1);
    if (last?.title === title) last.steps = [...last.steps, step];
    else stages.push({ title, familiar: phase.title, steps: [step], letter: "" });
  }
  return stages.map((stage, index) => ({ ...stage, letter: String.fromCharCode(97 + index) }));
}

function stageStatus(lifecycle: LifecycleState | null, index: number, stage: Stage) {
  const states = stage.steps.map((step) => stepState(lifecycle, index, step));
  if (states.every((state) => state === "done")) return "done" as const;
  if (states.some((state) => state === "now")) return "active" as const;
  return "todo" as const;
}

/** The whole path in one row; a phase opens in the workspace when the reader picks it. */
export function PhaseStepper({
  lifecycle,
  selected,
  waiting,
  following,
  onSelect,
}: {
  lifecycle: LifecycleState | null;
  selected: PhaseId;
  waiting: Waiting | null;
  following: boolean;
  onSelect: (phase: PhaseId) => void;
}) {
  const turn = waiting ? phaseOfGate(waiting.gate)?.id : undefined;
  const list = useRef<HTMLOListElement>(null);
  // On a narrow screen the path scrolls sideways: keep the stage that needs the reader (or the
  // active one) in view. Only the row scrolls, never the page.
  useEffect(() => {
    const row = list.current;
    const item = row?.querySelector<HTMLElement>("li.is-turn, li.is-active");
    if (!row || !item || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, item.offsetLeft - row.offsetLeft - 12), behavior: "smooth" });
  }, [lifecycle?.phase, waiting?.gate, lifecycle?.passed.length]);
  return (
    <nav className="team-stepper" aria-label="Lifecycle phases">
      <ol ref={list}>
        {PHARMA_PHASES.flatMap((phase, index) => {
          const round = lifecycle?.rounds[phase.id] ?? 1;
          const stages = stagesOf(phase);
          return stages.map((stage) => {
            const status =
              stages.length > 1
                ? stageStatus(lifecycle, index, stage)
                : phaseStatus(lifecycle, index);
            const isTurn =
              turn === phase.id &&
              stage.steps.some((step) => step.kind === "person" && step.gate === waiting?.gate);
            return (
              <li
                key={`${phase.id}-${stage.letter}`}
                className={`is-${status}${isTurn ? " is-turn" : ""}`}
              >
                <button
                  type="button"
                  aria-pressed={selected === phase.id}
                  aria-current={status === "active" ? "step" : undefined}
                  onClick={() => onSelect(phase.id)}
                >
                  <span className="team-stepper-head">
                    <span className="team-phase-number" aria-hidden="true">
                      {status === "done" ? "✓" : `${index + 1}${stage.letter}`}
                    </span>
                    <span className="team-stepper-title">{stage.title}</span>
                  </span>
                  <span className="team-stepper-familiar">{stage.familiar}</span>
                  <span className="team-stepper-dots" aria-hidden="true">
                    {stage.steps.map((step) => (
                      <i
                        key={step.kind === "agent" ? step.tool : step.gate}
                        className={`${step.kind} is-${stepState(lifecycle, index, step)}`}
                      />
                    ))}
                  </span>
                  <span className="team-stepper-note">
                    {isTurn
                      ? "Your turn"
                      : status === "done"
                        ? "Done"
                        : status === "active"
                          ? round > 1
                            ? `Round ${round}`
                            : "In progress"
                          : `${stage.steps.length} steps`}
                  </span>
                </button>
              </li>
            );
          });
        })}
      </ol>
      <p className="team-stepper-legend">
        <span>
          <i className="agent" /> AI agent prepares
        </span>
        <span>
          <i className="person" /> a person signs off (you play them)
        </span>
        {!following && lifecycle && !lifecycle.finished && (
          <button
            type="button"
            className="text-button"
            onClick={() => onSelect(lifecycle.phase as PhaseId)}
          >
            Go to the active phase
          </button>
        )}
      </p>
    </nav>
  );
}

/** One line that says what an output holds, so a closed item still tells the story. */
function gist(artifact: Artifact): string {
  const data = artifact.data as Record<string, unknown>;
  switch (artifact.name) {
    case "propose_focus_areas":
      return `${(data.areas as unknown[]).length} focus areas, each citing its data`;
    case "propose_concepts":
      return `${(data.concepts as unknown[]).length} concepts on approved claims and images`;
    case "draft_modules": {
      const modules = data.modules as PharmaModule[];
      return `${modules.map((module) => module.id).join(" and ")}: ${modules.reduce((sum, module) => sum + module.claims.length, 0)} referenced claims, fair balance attached`;
    }
    case "submit_mlr_job": {
      const job = data as unknown as MlrJob;
      return `Job ${job.jobCode}, round ${job.round}${job.tier ? `, tier ${job.tier.tier}` : ""}: ${job.checks.filter((check) => check.ok).length} of ${job.checks.length} quality checks passed`;
    }
    case "mlr_approval": {
      const approved = data as unknown as ApprovedJob;
      return `${approved.documentNumber}${approved.labelVersion ? ` on ${approved.labelVersion}` : ""}, ${approved.materials?.length ?? approved.modules.length} material IDs, expires ${approved.expiresOn}`;
    }
    case "final_form_check": {
      const check = data as unknown as FinalFormCheck;
      return `${check.variants.length} built variants ${check.allMatch ? "match the approved version" : "checked; one differs"}`;
    }
    case "claim_trace": {
      const trace = data as unknown as ClaimTrace;
      return trace.withdrawal
        ? `Withdrawal plan: ${trace.withdrawal.length} placements to pull by ID`
        : `${trace.claims.length} claims traced to their placements, with re-review dates`;
    }
    case "build_audience": {
      const totals = data.totals as Record<string, number>;
      return `${num(totals.prescribers ?? 0)} prescribers, ${num(totals.emailReachable ?? 0)} email-consented, ${num(totals.doNotContact ?? 0)} do-not-contact removed`;
    }
    case "schedule_deployment":
      return `${(data.lines as unknown[]).length} placements${data.placements ? " carrying claim IDs" : ""}, ${usd(Number(data.totalUsd ?? 0))}`;
    case "prepare_form_2253":
      return `Submit at first use, ${String(data.submitAtFirstUse)}`;
    case "campaign_results":
      return `${(data.lines as unknown[]).length} result lines over ${String(data.days)} days (simulated)${Array.isArray(data.byClaim) && data.byClaim.length ? `, by ${data.byClaim.length} claim IDs` : ""}`;
    case "report_performance":
      return `Recommends ${String(data.recommendation)}`;
    case "deployment_receipt":
    case "form_2253_receipt": {
      const receipt = data as unknown as WriteReceipt;
      return `${receipt.reference}, written once; read back ${receipt.matches ? "matches" : "does not match"}`;
    }
    case "safety_intake": {
      const intake = data as unknown as SafetyIntake;
      const ae = intake.flags.filter((flag) => flag.kind === "possible-adverse-event").length;
      return `${intake.screened} replies screened: ${ae} possible adverse event${ae === 1 ? "" : "s"} to pharmacovigilance, ${intake.flags.length - ae} to medical information`;
    }
    default:
      return "";
  }
}

function StepCard({
  step,
  state,
  waitingHere,
  next,
}: {
  step: PhaseStep;
  state: "done" | "now" | "todo";
  /** The run is waiting on this person now (not just stopped before them). */
  waitingHere: boolean;
  /** The step after this one, so an agent's card can say who takes its work. */
  next?: PhaseStep;
}) {
  const [open, setOpen] = useState(false);
  const technical = useTechnical();
  const who = step.kind === "agent" ? TEAM_PARTY_LABELS[step.agent] : TEAM_GATES[step.gate].decider;
  const role = step.kind === "agent" ? LIFECYCLE_ROLES[step.agent] : null;
  return (
    <li className={`team-step-card ${step.kind} is-${state}`}>
      <header>
        <span className={`team-step-key ${step.kind}`}>
          {step.kind === "agent" ? "AI agent" : "Person · you play"}
        </span>
        <strong>{who}</strong>
        <span className="team-step-state">
          {state === "done"
            ? "✓"
            : state === "now"
              ? step.kind === "person"
                ? waitingHere
                  ? "your turn"
                  : "next"
                : "working"
              : ""}
        </span>
      </header>
      {step.kind === "agent" ? (
        <p className="team-step-handoff">
          <strong>Hands in:</strong> {step.delivers}
          {next?.kind === "person" ? ` → ${TEAM_GATES[next.gate].decider} decides.` : "."}
        </p>
      ) : (
        <p className="team-step-handoff">
          <strong>Signs off:</strong> {TEAM_GATES[step.gate].label}.
        </p>
      )}
      {role && <small className="team-step-assists">Assists {role.assists}</small>}
      {technical && step.kind === "agent" && <code>{step.tool}</code>}
      {open && (
        <>
          <p>{step.does}</p>
          {step.kind === "agent" && !technical && (
            <small className="arch-note">
              Hands in with the tool <code>{step.tool}</code>; code pre-checks it before anyone sees
              it.
            </small>
          )}
        </>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Less" : "How it works"}
      </button>
    </li>
  );
}

/**
 * The pre-check refusals and blocked actions an output's drafts ran into, on the output itself:
 * what was refused and why, before any person saw it.
 */
function Refusals({ hits }: { hits: readonly GuardrailHit[] }) {
  if (hits.length === 0) return null;
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  const fixed = hits.every((hit) => hit.fixed);
  return (
    <details className={`team-refusals${fixed ? " fixed" : ""}`}>
      <summary>
        <strong>
          {total} {total === 1 ? "draft was" : "drafts were"} refused by an automated pre-check
        </strong>{" "}
        {fixed ? "· fixed before this version" : "· not fixed yet"}
      </summary>
      <p className="arch-note">
        These checks run in code before any person reviews the work. They are not MLR review, and
        nothing refused reached the campaign file.
      </p>
      <ul>
        {hits.map((hit, index) => (
          <li key={`${hit.kind}-${index}`}>
            {hit.count > 1 ? <strong>×{hit.count} </strong> : null}
            {hit.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One stage's steps, in order, with its name when the phase has two. */
function StageTrack({
  stage,
  split,
  index,
  lifecycle,
  waiting,
  allSteps,
}: {
  stage: Stage;
  split: boolean;
  index: number;
  lifecycle: LifecycleState | null;
  waiting: Waiting | null;
  allSteps: readonly PhaseStep[];
}) {
  return (
    <div className="team-stage">
      {split && (
        <h4 className="team-stage-title">
          {index + 1}
          {stage.letter} · {stage.title}
        </h4>
      )}
      <ol className="team-step-track" aria-label={`${stage.title}: steps`}>
        {stage.steps.map((step) => (
          <StepCard
            key={step.kind === "agent" ? step.tool : step.gate}
            step={step}
            next={allSteps[allSteps.indexOf(step) + 1]}
            state={stepState(lifecycle, index, step)}
            waitingHere={step.kind === "person" && waiting?.gate === step.gate}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * The chosen phase: its documented steps, the decision when it waits on the reader here, and its
 * outputs. Outputs are closed to a summary line while a decision is open (the card shows what to
 * check), and open otherwise; whatever the reader opens stays open.
 */
export function PhaseWorkspace({
  phase,
  lifecycle,
  artifacts,
  waiting,
  decision,
  onOpenTurn,
  guardrails = [],
  gaps = [],
  seeded = null,
}: {
  phase: PhaseId;
  lifecycle: LifecycleState | null;
  artifacts: readonly Artifact[];
  waiting: Waiting | null;
  decision: ReactNode;
  onOpenTurn: (phase: PhaseId) => void;
  /** What the guardrails caught, so each output shows the pre-checks its drafts failed. */
  guardrails?: readonly GuardrailHit[];
  /** The run's claim gap log. */
  gaps?: readonly ClaimGap[];
  /** Whether the MLR reviewers caught a seeded flaw, once they have decided. */
  seeded?: SeededOutcome;
}) {
  const index = PHARMA_PHASES.findIndex((item) => item.id === phase);
  const spec = PHARMA_PHASES[index];
  if (!spec) return null;
  const status = phaseStatus(lifecycle, index);
  const round = lifecycle?.rounds[phase] ?? 1;
  const turn = waiting ? phaseOfGate(waiting.gate)?.id : undefined;
  const here = artifacts.filter((artifact) => artifact.phase === phase);
  const names = [...new Set(here.map((artifact) => artifact.name))];
  return (
    <section className="team-workspace" aria-labelledby="team-workspace-title">
      <header>
        <p className="kicker">
          Phase {index + 1} of {PHARMA_PHASES.length} ·{" "}
          {status === "done" ? "done" : status === "active" ? "in progress" : "to come"}
          {round > 1 ? ` · round ${round}` : ""}
        </p>
        <h3 id="team-workspace-title">
          {spec.title} <span className="team-workspace-familiar">{spec.familiar}</span>
        </h3>
        <p className="arch-note">
          In most brand teams this stage is run by agency and brand people. Here AI agents prepare
          the work and the same people still decide.
          {spec.id === "content"
            ? " Medical, Legal and Regulatory are shown one after another for clarity; in practice they often review in parallel, with Regulatory giving the final approval."
            : ""}
        </p>
      </header>
      {turn && turn !== phase && (
        <button
          type="button"
          className="team-turn-banner"
          onClick={() => onOpenTurn(turn as PhaseId)}
        >
          It's your turn in {PHARMA_PHASES.find((item) => item.id === turn)?.title}:{" "}
          {waiting?.title} →
        </button>
      )}
      {stagesOf(spec).map((stage) => (
        <StageTrack
          key={stage.letter || "all"}
          stage={stage}
          split={stagesOf(spec).length > 1}
          index={index}
          lifecycle={lifecycle}
          waiting={waiting}
          allSteps={spec.steps as readonly PhaseStep[]}
        />
      ))}
      {turn === phase && decision}
      {phase === "content" && <SeededReveal outcome={seeded} />}
      <div className="team-outputs">
        <h4>What this phase produced</h4>
        {phase === "analytics" ? (
          <GapLog gaps={gaps} all />
        ) : (
          <GapLog gaps={gaps.filter((gap) => gap.phase === phase)} />
        )}
        {names.length === 0 ? (
          <p className="arch-note">
            {status === "todo" ? "Nothing yet: this phase hasn't started." : "Nothing saved yet."}
          </p>
        ) : (
          names.map((name) => {
            const versions = here.filter((artifact) => artifact.name === name);
            const latest = versions.at(-1) as Artifact;
            return (
              <details
                key={`${name}-${latest.version}`}
                className="team-output"
                open={turn !== phase}
              >
                <summary>
                  <strong>{ARTIFACT_TITLES[name] ?? name}</strong>
                  <span>{gist(latest)}</span>
                  <small>
                    v{latest.version} · by {by(latest)}
                  </small>
                </summary>
                <Refusals hits={guardrails.filter((hit) => hit.tool === name)} />
                <ArtifactView artifact={latest} choices={lifecycle?.choices} />
                {versions.length > 1 && (
                  <details className="team-output-history">
                    <summary>Earlier versions ({versions.length - 1})</summary>
                    {versions.slice(0, -1).map((item) => (
                      <div key={item.version} className="team-file-earlier">
                        <h5>
                          Version {item.version} · round {item.round}: {gist(item)}
                        </h5>
                        <ArtifactView artifact={item} />
                      </div>
                    ))}
                  </details>
                )}
              </details>
            );
          })
        )}
      </div>
    </section>
  );
}
