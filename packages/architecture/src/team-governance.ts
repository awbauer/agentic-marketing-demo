// The controls the playbook asks of a regulated agent, for the pharma lifecycle: a gap log for
// cite-or-refuse, a decision record per gate stamped with the policy and prompt versions, measures
// of the people who review, a seeded flaw that tests them, idempotent writes read back from the
// system that took them, and safety screening of what comes back from the market. Pure, so the
// edge and the page share one definition.
import { framingProblems } from "./language.ts";
import type { CampaignBrief, TeamEvent, TeamGate } from "./team.ts";
import {
  type ApprovedJob,
  type Form2253,
  type LibraryClaim,
  type MlrJob,
  PHARMA_PHASES,
  PHARMA_PRODUCT,
  type PharmaModule,
  type PhaseStep,
  type Placement,
  type ResultLine,
} from "./team-pharma.ts";

/** A short, stable hash (FNV-1a, 32 bits) as eight hex digits: enough to tell versions apart. */
export function shortHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Cite or refuse: the gap log ------------------------------------------------------------------

export type ClaimGapKind =
  | "no-claim"
  | "off-label"
  | "unsupported"
  | "out-of-scope"
  | "own-wording";

export const CLAIM_GAP_LABELS: Record<ClaimGapKind, string> = {
  "no-claim": "No approved claim",
  "off-label": "Off-label",
  unsupported: "Not substantiated",
  "out-of-scope": "Out of scope",
  "own-wording": "A fact in the writer's own words",
};

/**
 * A point the squad wanted to make that approved content can't support. It isn't written; it is
 * recorded, and the log is the content team's backlog for new claims through MLR. A point off the
 * label goes to medical information instead: promotion can't answer it.
 */
export type ClaimGap = {
  id: string;
  product: string;
  phase: string;
  raisedBy: string;
  tool: string;
  /** The claim topic or the sentence the squad tried to use. */
  point: string;
  kind: ClaimGapKind;
  reason: string;
  route: "medical-information" | "claims-backlog";
  at: string;
};

export const CLAIM_GAP_ROUTES: Record<ClaimGap["route"], string> = {
  "medical-information": "Route to medical information",
  "claims-backlog": "Claims backlog: a new claim through MLR",
};

/** The gaps in one attempted save: claim topics approved content can't carry, and facts in own words. */
export function claimGaps(input: {
  library: readonly LibraryClaim[];
  brand: string;
  topics: readonly string[];
  channel?: "email" | "display";
  texts?: ReadonlyArray<{ label: string; text: string }>;
}): Array<Pick<ClaimGap, "point" | "kind" | "reason" | "route">> {
  const library = new Map(input.library.map((claim) => [claim.topic, claim]));
  const gaps: Array<Pick<ClaimGap, "point" | "kind" | "reason" | "route">> = [];
  for (const topic of input.topics) {
    const claim = library.get(topic);
    if (!claim) {
      gaps.push({
        point: topic,
        kind: "no-claim",
        reason: "The claims library has no claim for this point.",
        route: "claims-backlog",
      });
      continue;
    }
    if (!claim.usable) {
      const offLabel = claim.issues.find((issue) => /off-label/i.test(issue));
      gaps.push({
        point: claim.claimId ? `${claim.claimId} (${topic})` : topic,
        kind: offLabel
          ? "off-label"
          : claim.status !== "substantiated"
            ? "unsupported"
            : "out-of-scope",
        reason: offLabel ?? (claim.issues.join(" ") || claim.status),
        route: offLabel ? "medical-information" : "claims-backlog",
      });
      continue;
    }
    if (input.channel && claim.scope && !claim.scope.channels.includes(input.channel))
      gaps.push({
        point: claim.claimId ? `${claim.claimId} (${topic})` : topic,
        kind: "out-of-scope",
        reason: `Approved for ${claim.scope.channels.join(", ")}, not ${input.channel}.`,
        route: "claims-backlog",
      });
  }
  for (const { text } of input.texts ?? []) {
    if (!text?.trim()) continue;
    const problem = framingProblems(text, input.brand).find((item) =>
      /states a fact|comparison|superiority|implies an endorsement/.test(item),
    );
    if (problem)
      gaps.push({
        point: text.trim(),
        kind: "own-wording",
        reason: problem.replace(/^"[^"]*" /, "It "),
        route: "claims-backlog",
      });
  }
  return gaps;
}

/** The run's gap log, one entry per point and kind. */
export const gapLog = (events: readonly TeamEvent[]) =>
  events.flatMap((event) => (event.type === "claim-gap" ? [event.gap] : []));

// The decision record --------------------------------------------------------------------------

export type DecisionRecord = {
  /** The work the person decided on: each artifact's name and the version they saw. */
  reviewed: Array<{ name: string; version: number }>;
  /** The team policy set that authorized the decision (and every tool call before it). */
  policyVersion: string;
  /** Each agent's prompt version, for the agents whose work is under review. */
  promptVersions: Record<string, string>;
  /** When the run started waiting for this person. */
  askedAt: string | null;
  /** How long the person took, from being asked to deciding. */
  decidedInMs: number | null;
};

/** The work a gate decides on: what the agent steps before it, in its phase, saved. */
export function reviewedBy(gate: TeamGate): Array<{ tool: string; agent: string }> {
  for (const phase of PHARMA_PHASES) {
    const steps = phase.steps as readonly PhaseStep[];
    const at = steps.findIndex((step) => step.kind === "person" && step.gate === gate);
    if (at < 0) continue;
    return steps
      .slice(0, at)
      .flatMap((step) => (step.kind === "agent" ? [{ tool: step.tool, agent: step.agent }] : []));
  }
  return [];
}

/**
 * The latest prompt version each agent did its work with, from a run's events. A worker's short
 * report to the lead, after its work is saved, uses another prompt; it isn't what produced the
 * work, so it is left out.
 */
export function promptVersionsOf(events: readonly TeamEvent[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const event of events)
    if (
      event.type === "prompt" &&
      event.version &&
      event.purpose !== "report" &&
      event.purpose !== "answer"
    )
      versions[event.agent] = event.version;
  return versions;
}

// Measuring the reviewers ----------------------------------------------------------------------

/** Faster than this, an approval is too quick to have read the work. */
export const FAST_APPROVAL_MS = 5_000;

export type ReviewerMetrics = {
  persona: string;
  decisions: number;
  changes: number;
  /** Changes requested over decisions: near zero is a warning, not a win. */
  overrideRate: number;
  medianMs: number | null;
  fastApprovals: number;
};

/** Each reviewer's decisions, how often they asked for changes, and how long they took. */
export function reviewerMetrics(events: readonly TeamEvent[]): ReviewerMetrics[] {
  const by = new Map<string, Array<Extract<TeamEvent, { type: "decided" }>>>();
  for (const event of events)
    if (event.type === "decided") by.set(event.persona, [...(by.get(event.persona) ?? []), event]);
  return [...by.entries()].map(([persona, decisions]) => {
    const times = decisions
      .flatMap((item) => (item.record?.decidedInMs == null ? [] : [item.record.decidedInMs]))
      .sort((a, b) => a - b);
    const changes = decisions.filter((item) => item.decision === "changes").length;
    return {
      persona,
      decisions: decisions.length,
      changes,
      overrideRate: decisions.length ? changes / decisions.length : 0,
      medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)] ?? null) : null,
      fastApprovals: decisions.filter(
        (item) =>
          item.decision === "approve" &&
          item.record?.decidedInMs != null &&
          item.record.decidedInMs < FAST_APPROVAL_MS,
      ).length,
    };
  });
}

// A seeded flaw --------------------------------------------------------------------------------

export const SEEDED_MODULE_ID = "EM9";

export type SeededFlaw = {
  moduleId: string;
  jobCode: string;
  flaw: string;
  /** What a reviewer should have seen. */
  lookFor: string;
};

/**
 * A copy of the job's email module with its fair balance stripped: the mortality claim with no
 * safety information beside it. The MLR system slips it into the review queue after the automated
 * checks, the way a seeded error tests reviewers, and withdraws it before anything is approved.
 */
export function seedFlaw(job: MlrJob): { job: MlrJob; seeded: SeededFlaw } | null {
  const base = job.modules.find((module) => module.channel === "email") ?? job.modules[0];
  if (!base) return null;
  const flawed: PharmaModule = {
    ...base,
    id: SEEDED_MODULE_ID,
    headline: base.headline,
    disclosures: [],
  };
  return {
    job: { ...job, modules: [...job.modules, flawed] },
    seeded: {
      moduleId: SEEDED_MODULE_ID,
      jobCode: job.jobCode,
      flaw: `Module ${SEEDED_MODULE_ID} carries the claims with no Important Safety Information, boxed warning or PI beside them: no fair balance.`,
      lookFor: "Every module's claims need their safety information beside them.",
    },
  };
}

/** Takes a seeded module out of a job before anything is approved for use. */
export const withoutSeeded = (job: MlrJob): MlrJob => ({
  ...job,
  modules: job.modules.filter((module) => module.id !== SEEDED_MODULE_ID),
});

export type SeededOutcome = { seeded: SeededFlaw; caught: boolean; by: string | null } | null;

/** Whether a reviewer asked for changes on the job that carried the seeded flaw. */
export function seededOutcome(events: readonly TeamEvent[]): SeededOutcome {
  const at = events.findIndex((event) => event.type === "seeded-flaw");
  const event = events[at];
  if (event?.type !== "seeded-flaw") return null;
  let review = 0;
  for (const later of events.slice(at + 1)) {
    if (later.type !== "decided" || !["medical", "legal", "regulatory"].includes(later.gate))
      continue;
    review += 1;
    if (later.decision === "changes") return { seeded: event.seeded, caught: true, by: later.gate };
    if (later.gate === "regulatory") return { seeded: event.seeded, caught: false, by: null };
    if (review >= 3) break;
  }
  return null;
}

// Writes: idempotency key, one write, read back -------------------------------------------------

export type WriteReceipt = {
  system: string;
  /** Derived from the exact change set, so a retry is the same write, not a second one. */
  idempotencyKey: string;
  reference: string;
  at: string;
  /** What the change set asked for. */
  sent: string[];
  /** What the system says it holds, read back after the write. */
  readBack: string[];
  matches: boolean;
  /** Times the write was attempted; the key makes every attempt after the first a no-op. */
  attempts: number;
  status: string;
};

const keyOf = (parts: readonly string[]) => shortHash(parts.join("|"));

/** Files Form 2253 once, keyed by its contents, and reads the acknowledgment back. */
export function file2253(form: Form2253, at: string, previous?: WriteReceipt | null): WriteReceipt {
  const sent = form.materials.map((item) => `${item.materialId} · first use ${item.firstUse}`);
  const key = keyOf([form.currentPi, ...sent]);
  if (previous && previous.idempotencyKey === key)
    return { ...previous, attempts: previous.attempts + 1 };
  return {
    system: "FDA ESG (OPDP), simulated",
    idempotencyKey: key,
    reference: `ESG-${key.slice(0, 6).toUpperCase()}`,
    at,
    sent,
    // The gateway's acknowledgment lists what it received; read back, it must match what was sent.
    readBack: [...sent],
    matches: true,
    attempts: 1,
    status: `Acknowledged, with PI ${form.currentPi}`,
  };
}

/** Books each placement once, keyed by its contents, and reads the channel's schedule back. */
export function bookPlacements(
  placements: readonly Placement[],
  approved: ApprovedJob,
  at: string,
  previous?: WriteReceipt | null,
): WriteReceipt {
  // The whole placement: what runs, where, to whom and when. A change to any of it is a new write.
  const line = (item: Placement) =>
    `${item.placementId} ${item.materialId} ${item.channel} to ${[...item.segmentIds].sort().join(",")} ${item.start}→${item.end}`;
  const sent = placements.map(line);
  const key = keyOf([approved.documentNumber, ...sent]);
  if (previous && previous.idempotencyKey === key)
    return { ...previous, attempts: previous.attempts + 1 };
  const approvedMaterials = new Set(approved.materials.map((item) => item.materialId));
  // The channel holds only placements of approved materials; anything else it refuses.
  const readBack = placements.filter((item) => approvedMaterials.has(item.materialId)).map(line);
  return {
    system: "Channel schedules (Veeva CRM email, programmatic display), simulated",
    idempotencyKey: key,
    reference: `BK-${key.slice(0, 6).toUpperCase()}`,
    at,
    sent,
    readBack,
    matches: readBack.length === sent.length && readBack.every((line, i) => line === sent[i]),
    attempts: 1,
    status: "Booked, held until Form 2253 is filed",
  };
}

// What comes back from the market: adverse events and off-label questions -----------------------

export type HcpReply = { id: string; resultLine: string; segmentId: string; text: string };

export type SafetyFlag = {
  replyId: string;
  kind: "possible-adverse-event" | "off-label-question";
  matched: string;
  route: string;
  /** When it must reach the team that owns it. */
  due: string;
};

export type SafetyIntake = {
  simulated: true;
  replies: HcpReply[];
  flags: SafetyFlag[];
  screened: number;
};

const AE_SIGNAL =
  /\b(hospitali[sz]ed|side effects?|adverse|dizz(?:y|iness)|faint(?:ed|ing)?|swelling|rash|kidney|hypotension|low blood pressure|stopped taking|reaction)\b/i;
const OFF_LABEL_SIGNAL = /\b(hfpef|preserved ejection|pediatric|children|off[- ]label)\b/i;

/** A few replies HCPs sent to the emails, simulated: the kinds a field team really gets. */
export function hcpReplies(lines: readonly ResultLine[]): HcpReply[] {
  const emails = lines.filter((line) => line.channel === "approved-email" && line.clicks > 0);
  const texts = [
    "Thanks, please send the full CARDIO-HF data to my office.",
    "One of my patients was hospitalized with low blood pressure two weeks after starting Cardivance.",
    "Do you have any data in HFpEF? I have several patients with preserved ejection fraction.",
    "Please remove me from this list.",
  ];
  return emails.length
    ? texts.map((text, index) => {
        const line = emails[index % emails.length] as ResultLine;
        return { id: `rep-${index + 1}`, resultLine: line.id, segmentId: line.segmentId, text };
      })
    : [];
}

/**
 * Every reply screened: a possible adverse event goes to pharmacovigilance within one business
 * day (the reporting clock starts when anyone in the company hears of it), and a question off the
 * label goes to medical information. Neither is answered by promotion.
 */
export function screenReplies(replies: readonly HcpReply[], receivedOn: string): SafetyIntake {
  const nextDay = new Date(`${receivedOn}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const due = nextDay.toISOString().slice(0, 10);
  const flags = replies.flatMap((reply): SafetyFlag[] => {
    const ae = AE_SIGNAL.exec(reply.text);
    if (ae)
      return [
        {
          replyId: reply.id,
          kind: "possible-adverse-event",
          matched: ae[0],
          route: "Pharmacovigilance intake (the safety database), with the reply as received",
          due: `${due} (1 business day)`,
        },
      ];
    const offLabel = OFF_LABEL_SIGNAL.exec(reply.text);
    return offLabel
      ? [
          {
            replyId: reply.id,
            kind: "off-label-question",
            matched: offLabel[0],
            route: "Medical information, which answers unsolicited off-label questions",
            due: `${due} (acknowledge)`,
          },
        ]
      : [];
  });
  return { simulated: true, replies: [...replies], flags, screened: replies.length };
}

// Honesty: does each worker's report match what it did? ------------------------------------------

const CLAIMS_SAVED = /\b(saved|submitted|scheduled|built|prepared|filed|drafted|recorded)\b/i;

/**
 * A worker's report says it saved its work only if the trace shows a save it made after it was
 * assigned. Graded against the trace, not the words.
 */
export function misreports(events: readonly TeamEvent[]) {
  const found: Array<{ agent: string; text: string }> = [];
  let since = 0;
  events.forEach((event, index) => {
    if (event.type === "message" && event.kind === "directive") since = index;
    if (event.type !== "message" || event.kind !== "report" || event.from === "mlr-coordinator")
      return;
    if (event.to !== "campaign-lead" || !CLAIMS_SAVED.test(event.text)) return;
    const saved = events
      .slice(since, index)
      .some((item) => item.type === "artifact" && item.by === event.from);
    if (!saved && !/\b(not|couldn'?t|could not|unable|failed)\b/i.test(event.text))
      found.push({ agent: event.from, text: event.text });
  });
  return found;
}

export const productOf = (brief: CampaignBrief) =>
  brief.brand === PHARMA_PRODUCT.brand ? PHARMA_PRODUCT.name : brief.brand;

// Autonomy earned by evidence ------------------------------------------------------------------

export type AgentEvidence = {
  /** Every save cleared the rules first time, and no person sent its work back. */
  clean: boolean;
  /** It hit something that demotes: a gateway denial, a hard limit, or a report the trace contradicts. */
  violation: boolean;
  detail: string;
};

/** What one run says about each lifecycle worker that did work in it. */
export function agentEvidence(events: readonly TeamEvent[]): Record<string, AgentEvidence> {
  const workers = new Set(
    PHARMA_PHASES.flatMap((phase) =>
      (phase.steps as readonly PhaseStep[]).flatMap((step) =>
        step.kind === "agent" ? [step.agent as string] : [],
      ),
    ),
  );
  const misreported = new Set(misreports(events).map((item) => item.agent));
  const evidence: Record<string, AgentEvidence> = {};
  for (const agent of workers) {
    const tools = events.flatMap((event) =>
      event.type === "tool" && event.agent === agent ? [event.step] : [],
    );
    if (!tools.length) continue;
    const denied = tools.filter((step) => step.error?.startsWith("The gateway denied")).length;
    const limited = events.some((event) => event.type === "limit" && event.agent === agent);
    const refused = tools.filter(
      (step) => !step.ok && !step.error?.startsWith("The gateway"),
    ).length;
    const sentBack = events.filter(
      (event) =>
        event.type === "decided" &&
        event.decision === "changes" &&
        reviewedBy(event.gate).some((step) => step.agent === agent),
    ).length;
    const violation = denied > 0 || limited || misreported.has(agent);
    evidence[agent] = {
      clean: !violation && refused === 0 && sentBack === 0,
      violation,
      detail: violation
        ? [
            denied ? `${denied} gateway denial${denied === 1 ? "" : "s"}` : "",
            limited ? "hit a hard limit" : "",
            misreported.has(agent) ? "a report the trace contradicts" : "",
          ]
            .filter(Boolean)
            .join(", ")
        : `${refused} refused save${refused === 1 ? "" : "s"}, sent back ${sentBack} time${sentBack === 1 ? "" : "s"}`,
    };
  }
  return evidence;
}

export type AutonomyStage = "supervise" | "assist";

export const AUTONOMY_STAGES: Record<AutonomyStage, { label: string; may: string }> = {
  supervise: { label: "Supervise", may: "Proposes every write; a person approves each one." },
  assist: {
    label: "Assist",
    may: "Would act alone below a value threshold, with approval above it.",
  },
};

/** Clean runs in a row an agent needs before a person may promote it. */
export const PROMOTE_AFTER = 3;
/** Extra clean runs needed to come back after a demotion, so an agent near the line doesn't flip. */
export const PROMOTE_MARGIN = 1;

export type AutonomyView = {
  stage: AutonomyStage;
  streak: number;
  needed: number;
  canPromote: boolean;
  demoted: boolean;
  lastViolation: string | null;
};

/**
 * Where an agent stands, from its runs (oldest first) and the promotions a person recorded.
 * Promotion is a person's decision once the evidence supports it; demotion is automatic: a
 * violation in any run after the promotion drops the agent back to Supervise.
 */
export function autonomyOf(
  history: ReadonlyArray<{ at: string; evidence: AgentEvidence }>,
  promotedAt: string | null,
): AutonomyView {
  let streak = 0;
  let violations = 0;
  let lastViolation: string | null = null;
  for (const item of history) {
    if (item.evidence.violation) {
      violations += 1;
      lastViolation = item.at;
      streak = 0;
    } else streak = item.evidence.clean ? streak + 1 : 0;
  }
  const demoted = Boolean(promotedAt && lastViolation && lastViolation > promotedAt);
  const stage: AutonomyStage = promotedAt && !demoted ? "assist" : "supervise";
  const needed = PROMOTE_AFTER + (violations > 0 ? PROMOTE_MARGIN : 0);
  return {
    stage,
    streak,
    needed,
    canPromote: stage === "supervise" && streak >= needed,
    demoted,
    lastViolation,
  };
}
