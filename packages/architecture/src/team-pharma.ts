// The pharma campaign lifecycle: how a prescription brand's campaign goes from business focus to
// analytics. The squad's agents do the work at every step; people decide at the points a real
// brand team, MLR committee and operations team would. The steps follow common US practice:
// focus areas from the brand plan, concepts built on approved claims and assets, modular content
// assembled from a claims library with its references, a Medical/Legal/Regulatory review that
// issues a document number and expiry, consent-filtered HCP targeting by decile, Form FDA 2253 at
// first use, and results read back into the next decision.
//
// Everything here is deterministic: the services check what the agents propose against governed
// content (the claims library, its evidence, the disclosure rules, the asset library) and refuse
// what breaks a rule. The market data and the in-market results are fictional and labelled so.
import { DISCLOSURE_RULES, claimPacket } from "./agents.ts";
import { framingProblems, headlineShape } from "./language.ts";
import type { CampaignBrief, LifecycleWorker, TeamGate, TeamTool } from "./team.ts";
import { assetChoices, researchSourceIds } from "./team-services.ts";
import { teamMarket } from "./team-data.ts";
import {
  attributesOf,
  type Brand,
  type ClaimAttributes,
  type DisclosureAttributes,
  type ResultAttributes,
  urnOf,
} from "./types.ts";
import { getObject, listObjects, successorOf, type World } from "./world.ts";

// The lifecycle ------------------------------------------------------------------------------

export type PhaseStep =
  | {
      kind: "agent";
      agent: LifecycleWorker;
      /** The save tool the step ends with. */
      tool: TeamTool;
      does: string;
    }
  | { kind: "person"; gate: TeamGate; does: string };

/**
 * The lifecycle, phase by phase, as the ordered steps the server enforces: each agent step ends
 * when its save tool accepts the work, each person step when that person approves. A person who
 * asks for changes sends the phase back to its first step.
 */
export const PHARMA_PHASES = [
  {
    id: "focus",
    title: "Business focus",
    steps: [
      {
        kind: "agent",
        agent: "audience-analyst",
        tool: "propose_focus_areas",
        does: "Reads the segments, competitors, market signals and last year's results, and proposes two or three focus areas, each citing its evidence and how success would be measured.",
      },
      {
        kind: "person",
        gate: "focus",
        does: "The brand lead chooses the focus area the campaign will serve, against the brand plan.",
      },
    ],
  },
  {
    id: "ideation",
    title: "Campaign ideation",
    steps: [
      {
        kind: "agent",
        agent: "art-director",
        tool: "propose_concepts",
        does: "Proposes two or three concepts for the chosen focus, each carried by substantiated claims from the claims library and shown with approved, in-rights images from the asset library. Nothing is generated.",
      },
      {
        kind: "person",
        gate: "concept",
        does: "The brand lead chooses a concept.",
      },
    ],
  },
  {
    id: "content",
    title: "Content and MLR review",
    steps: [
      {
        kind: "agent",
        agent: "copy-lead",
        tool: "draft_modules",
        does: "Assembles an email and a display module from the claims library: the exact approved claim text with its reference markers, the concept's images, and the ISI, boxed warning and PI link, which the service attaches. An unsubstantiated claim is refused.",
      },
      {
        kind: "agent",
        agent: "mlr-coordinator",
        tool: "submit_mlr_job",
        does: "Annotates every claim to its reference, runs the pre-review checks (reference valid through the campaign, fair balance, image approvals, wording), writes notes for the reviewers and submits the job. A job that fails a check is not submitted.",
      },
      {
        kind: "person",
        gate: "medical",
        does: "Medical checks the science: each claim against its reference, and fair balance.",
      },
      {
        kind: "person",
        gate: "legal",
        does: "Legal checks the risk: wording, comparisons, trademarks and the images' rights.",
      },
      {
        kind: "person",
        gate: "regulatory",
        does: "Regulatory checks against the label and FDA rules, and approves the job for distribution. The system issues a document number and an expiry.",
      },
    ],
  },
  {
    id: "audience",
    title: "Audience selection",
    steps: [
      {
        kind: "agent",
        agent: "audience-analyst",
        tool: "build_audience",
        does: "Builds the HCP list by segment and decile. Email goes only to HCPs with documented consent; the do-not-contact list is removed from every channel; rep coverage is shown so field and digital line up.",
      },
      {
        kind: "person",
        gate: "audience",
        does: "Marketing operations approves the list: consent, suppression and size.",
      },
    ],
  },
  {
    id: "publish",
    title: "Market publishing",
    steps: [
      {
        kind: "agent",
        agent: "channel-planner",
        tool: "schedule_deployment",
        does: "Schedules only the approved modules, by document number, to approved email and endemic HCP display, inside the brief's window and before the job expires, within budget.",
      },
      {
        kind: "person",
        gate: "go-live",
        does: "The brand lead approves go-live.",
      },
      {
        kind: "agent",
        agent: "mlr-coordinator",
        tool: "prepare_form_2253",
        does: "Prepares Form FDA 2253 with the approved materials and the current PI, dated to first use.",
      },
      {
        kind: "person",
        gate: "fda-2253",
        does: "Regulatory submits Form FDA 2253 to OPDP at first use. The campaign goes live.",
      },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    steps: [
      {
        kind: "agent",
        agent: "performance-analyst",
        tool: "report_performance",
        does: "After 30 days in market (simulated here), reads the results by segment, decile and channel against past results, and recommends continue, optimize or retire, citing the result lines.",
      },
      {
        kind: "person",
        gate: "next-action",
        does: "The brand lead decides the next action.",
      },
    ],
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; steps: readonly PhaseStep[] }>;
export type PharmaPhaseId = (typeof PHARMA_PHASES)[number]["id"];
export const PHARMA_PHASE_IDS = PHARMA_PHASES.map((phase) => phase.id) as PharmaPhaseId[];
export const pharmaPhase = (id: string) => PHARMA_PHASES.find((phase) => phase.id === id);
/** The phase a person's gate belongs to. */
export const phaseOfGate = (gate: TeamGate) =>
  PHARMA_PHASES.find((phase) =>
    (phase.steps as readonly PhaseStep[]).some(
      (step) => step.kind === "person" && step.gate === gate,
    ),
  );
/** Gates the MLR system routes to on its own, one after another, once the job is submitted. */
export const MLR_GATES = ["medical", "legal", "regulatory"] as const satisfies readonly TeamGate[];
/** Gates where the person picks one of the agents' options. */
export const CHOICE_GATES = [
  "focus",
  "concept",
  "next-action",
] as const satisfies readonly TeamGate[];
export const isChoiceGate = (gate: TeamGate) => (CHOICE_GATES as readonly string[]).includes(gate);
/** The product the Lumera lifecycle brief is for: its claims library is this product's claims. */
export const PHARMA_PRODUCT = {
  brand: "Lumera Therapeutics",
  name: "Cardivance",
  prefix: "cardivance-",
} as const;

/** Brands the full lifecycle applies to: those whose content needs MLR. */
export const runsPharmaLifecycle = (brand: Brand) => brand === "Lumera Therapeutics";

// The HCP universe ----------------------------------------------------------------------------

export const DECILE_BANDS = ["high", "mid", "low"] as const;
export type DecileBand = (typeof DECILE_BANDS)[number];
export const DECILE_LABELS: Record<DecileBand, string> = {
  high: "Deciles 8–10",
  mid: "Deciles 4–7",
  low: "Deciles 1–3",
};

export type HcpSegment = {
  segmentId: string;
  /** Prescribers per decile band, from the brand's targeting data (fictional). */
  deciles: Record<DecileBand, number>;
  /** Share with documented consent to receive brand email. */
  emailConsent: number;
  /** Share called on by a sales representative. */
  repCovered: number;
  /** HCPs on the do-not-contact list, removed from every channel. */
  doNotContact: number;
};

/** Lumera's US heart failure prescriber universe (fictional), by the semantic layer's segments. */
export const HCP_UNIVERSE: readonly HcpSegment[] = [
  {
    segmentId: "lt-seg-hf-specialists",
    deciles: { high: 1300, mid: 1900, low: 1000 },
    emailConsent: 0.71,
    repCovered: 0.92,
    doNotContact: 60,
  },
  {
    segmentId: "lt-seg-general-cardiology",
    deciles: { high: 4400, mid: 9900, low: 7700 },
    emailConsent: 0.58,
    repCovered: 0.55,
    doNotContact: 410,
  },
  {
    segmentId: "lt-seg-hf-nurses",
    deciles: { high: 1500, mid: 4300, low: 4000 },
    emailConsent: 0.64,
    repCovered: 0.3,
    doNotContact: 150,
  },
];

/** The channels a pharma campaign deploys an approved module to. */
export const PHARMA_CHANNELS = {
  "approved-email": { label: "Approved email", moduleChannel: "email", benchmark: "email" },
  "hcp-display": { label: "Endemic HCP display", moduleChannel: "display", benchmark: "display" },
} as const;
export type PharmaChannel = keyof typeof PHARMA_CHANNELS;

// Shared helpers --------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addMonths = (date: string, months: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString().slice(0, 10);
};

/** Ids a focus area may cite: the market data plus the brand's past results. */
export function focusSourceIds(world: World, brand: Brand) {
  return new Set([
    ...researchSourceIds(brand),
    ...listObjects(world, { kind: "result", brand }).map(
      (result) => result.urn.split(":").at(-1) as string,
    ),
  ]);
}

/** The brand's past results, as the performance and audience agents read them. */
export function pastResults(world: World, brand: Brand) {
  return listObjects(world, { kind: "result", brand }).map((result) => {
    const attributes = attributesOf<ResultAttributes>(result);
    return {
      id: result.urn.split(":").at(-1) as string,
      module: getObject(world, attributes.moduleUrn)?.title ?? attributes.moduleUrn,
      channel: attributes.channel,
      period: attributes.period,
      sends: attributes.sends,
      openRate: Number((attributes.opens / Math.max(1, attributes.sends)).toFixed(3)),
      clickRate: Number((attributes.clicks / Math.max(1, attributes.sends)).toFixed(3)),
    };
  });
}

// The claims library --------------------------------------------------------------------------

export type LibraryClaim = {
  topic: string;
  text: string;
  status: string;
  usable: boolean;
  issues: string[];
  references: Array<{ source: string; asOf: string; expiresOn: string }>;
  /** Disclosures the claim requires, attached by the service when the claim is used. */
  requires: string[];
};

/** The brand's claims library: every current claim with its status, references and disclosures. */
export function claimsLibrary(world: World, brand: Brand): LibraryClaim[] {
  const product = brand === PHARMA_PRODUCT.brand ? PHARMA_PRODUCT.prefix : "";
  return listObjects(world, { kind: "claim", brand })
    .filter((claim) => !successorOf(world, claim.urn))
    .filter((claim) => attributesOf<ClaimAttributes>(claim).topic.startsWith(product))
    .map((claim) => {
      const packet = claimPacket(world, claim);
      return {
        topic: attributesOf<ClaimAttributes>(claim).topic,
        text: packet.text,
        status: packet.status,
        usable: packet.status === "substantiated",
        issues: packet.issues,
        references: packet.evidence.map(({ source, asOf, expiresOn }) => ({
          source,
          asOf,
          expiresOn,
        })),
        requires: [...(DISCLOSURE_RULES[packet.topic] ?? [])],
      };
    });
}

// Phase 1: focus areas --------------------------------------------------------------------------

export type FocusArea = { title: string; rationale: string; sources: string[]; measure: string };

export function focusProblems(world: World, brand: Brand, areas: readonly FocusArea[]): string[] {
  const known = focusSourceIds(world, brand);
  const problems: string[] = [];
  if (areas.length < 2 || areas.length > 3) problems.push("Propose two or three focus areas.");
  areas.forEach((area, index) => {
    const at = `Focus area ${index + 1}`;
    if (!area.title?.trim() || !area.rationale?.trim())
      problems.push(`${at}: give a title and a rationale.`);
    if (!area.measure?.trim()) problems.push(`${at}: say how success would be measured.`);
    if (area.sources.length === 0)
      problems.push(`${at} cites no evidence. Cite segment, signal, competitor or result ids.`);
    for (const source of area.sources)
      if (!known.has(source))
        problems.push(`${at} cites ${source}, which is not in the brand's data.`);
  });
  return problems;
}

// Phase 2: concepts ---------------------------------------------------------------------------

export type Concept = {
  name: string;
  bigIdea: string;
  claimTopics: string[];
  assets: Array<{ assetId: string; use: string }>;
};

export function conceptProblems(
  world: World,
  brief: CampaignBrief,
  concepts: readonly Concept[],
): string[] {
  const library = new Map(claimsLibrary(world, brief.brand).map((claim) => [claim.topic, claim]));
  const problems: string[] = [];
  if (concepts.length < 2 || concepts.length > 3) problems.push("Propose two or three concepts.");
  concepts.forEach((concept, index) => {
    const at = `Concept ${index + 1} (${concept.name || "untitled"})`;
    if (!concept.name?.trim() || !concept.bigIdea?.trim())
      problems.push(`${at}: give a name and a big idea.`);
    if (concept.claimTopics.length === 0) problems.push(`${at}: name the claims that carry it.`);
    for (const topic of concept.claimTopics) {
      const claim = library.get(topic);
      if (!claim) problems.push(`${at}: ${topic} is not in the claims library.`);
      else if (!claim.usable)
        problems.push(
          `${at}: ${topic} can't carry a concept (${claim.status}: ${claim.issues.join(" ")}).`,
        );
    }
    const choices = new Map(
      assetChoices(brief.brand, brief.end, concept.claimTopics).map((choice) => [
        choice.asset.id,
        choice,
      ]),
    );
    if (concept.assets.length === 0) problems.push(`${at}: choose at least one approved asset.`);
    for (const { assetId } of concept.assets) {
      const choice = choices.get(assetId);
      if (!choice) problems.push(`${at}: ${assetId} is not in the asset library.`);
      else if (!choice.usable) problems.push(`${at}: ${assetId} can't be used: ${choice.reason}`);
    }
  });
  return problems;
}

// Phase 3: modules ----------------------------------------------------------------------------

export type ModuleDraft = {
  channel: "email" | "display";
  headline: string;
  opening: string;
  claimTopics: string[];
  closing: string;
  cta: string;
  assets: Array<{ assetId: string; use: string }>;
};

export type PharmaModule = {
  id: string;
  channel: "email" | "display";
  headline: string;
  opening: string;
  claims: Array<{
    topic: string;
    text: string;
    /** The reference marker the claim carries in the copy. */
    marker: number;
    references: LibraryClaim["references"];
  }>;
  closing: string;
  cta: string;
  disclosures: Array<{ id: string; title: string; text: string }>;
  assets: Array<{ assetId: string; use: string }>;
};

/**
 * Builds a module the only way MLR will accept it: each claim's exact approved text with its
 * references, the disclosures those claims require (attached here, never left to the writer), and
 * approved images that show only what the module cites. A claim without substantiation is refused.
 */
export function draftModule(
  world: World,
  brief: CampaignBrief,
  id: string,
  draft: ModuleDraft,
): { ok: true; module: PharmaModule } | { ok: false; problems: string[] } {
  const library = new Map(claimsLibrary(world, brief.brand).map((claim) => [claim.topic, claim]));
  const problems: string[] = [];
  if (draft.channel !== "email" && draft.channel !== "display")
    problems.push("channel must be email or display.");
  if (draft.claimTopics.length === 0)
    problems.push("Cite at least one claim from the claims library.");
  for (const topic of draft.claimTopics) {
    const claim = library.get(topic);
    if (!claim) problems.push(`${topic} is not in the claims library.`);
    else if (!claim.usable)
      problems.push(
        `${topic} is refused: ${claim.status}. ${claim.issues.join(" ")} Drop it; MLR will not approve an unsupported claim.`,
      );
  }
  for (const [label, text] of [
    ["headline", draft.headline],
    ["opening", draft.opening],
    ["closing", draft.closing],
  ] as const)
    if (text?.trim())
      problems.push(...framingProblems(text, brief.brand).map((problem) => `${label}: ${problem}`));
  // Claim ids are the library's handles, not copy: an HCP should never read one.
  for (const [label, text] of [
    ["headline", draft.headline],
    ["opening", draft.opening],
    ["closing", draft.closing],
  ] as const)
    for (const topic of library.keys())
      if (text?.replace(/\u2011/g, "-").includes(topic))
        problems.push(
          `${label}: names the claim id ${topic}; write for the reader, the service inserts the claim.`,
        );
  if (draft.headline?.trim()) problems.push(...headlineShape(draft.headline));
  else problems.push("Give a headline.");
  if (!draft.cta?.trim()) problems.push("Give a call to action.");
  const choices = new Map(
    assetChoices(brief.brand, brief.end, draft.claimTopics).map((choice) => [
      choice.asset.id,
      choice,
    ]),
  );
  for (const { assetId } of draft.assets) {
    const choice = choices.get(assetId);
    if (!choice) problems.push(`${assetId} is not in the asset library.`);
    else if (!choice.usable) problems.push(`${assetId} can't be used: ${choice.reason}`);
    else if (!choice.asset.channels.includes("email") && draft.channel === "email")
      problems.push(`${assetId} is not approved for email.`);
  }
  if (problems.length) return { ok: false, problems };
  const claims = draft.claimTopics.map((topic, index) => {
    const claim = library.get(topic) as LibraryClaim;
    return { topic, text: claim.text, marker: index + 1, references: claim.references };
  });
  const required = [
    ...new Set(claims.flatMap((claim) => library.get(claim.topic)?.requires ?? [])),
  ];
  const disclosures = required.flatMap((disclosureId) => {
    const item = getObject(world, urnOf("disclosure", disclosureId));
    return item
      ? [
          {
            id: disclosureId,
            title: item.title,
            text: attributesOf<DisclosureAttributes>(item).text,
          },
        ]
      : [];
  });
  return {
    ok: true,
    module: {
      id,
      channel: draft.channel,
      headline: draft.headline.trim(),
      opening: draft.opening.trim(),
      claims,
      closing: draft.closing.trim(),
      cta: draft.cta.trim(),
      disclosures,
      assets: draft.assets,
    },
  };
}

// Phase 3: the MLR package --------------------------------------------------------------------

export type PreReviewCheck = { module: string; check: string; ok: boolean; detail: string };

/** The automatic pre-review checks the MLR coordinator runs before a job goes to reviewers. */
export function preReviewChecks(
  brief: CampaignBrief,
  modules: readonly PharmaModule[],
): PreReviewCheck[] {
  return modules.flatMap((module) => {
    const checks: PreReviewCheck[] = [];
    for (const claim of module.claims) {
      const lasts = claim.references.some((reference) => reference.expiresOn >= brief.end);
      checks.push({
        module: module.id,
        check: `Reference for claim ${claim.marker}`,
        ok: claim.references.length > 0 && lasts,
        detail: claim.references.length
          ? claim.references
              .map(
                (reference) =>
                  `${reference.source} (${reference.asOf}, valid to ${reference.expiresOn})`,
              )
              .join("; ")
          : "No reference.",
      });
    }
    const hasIsi = module.disclosures.some((item) => item.id.includes("isi"));
    const hasBoxed = module.disclosures.some((item) => item.id.includes("boxed"));
    const hasPi = module.disclosures.some((item) => item.id.endsWith("-pi"));
    checks.push({
      module: module.id,
      check: "Fair balance",
      ok: hasIsi && hasPi,
      detail: `${hasIsi ? "ISI present" : "ISI missing"}; ${hasBoxed ? "boxed warning present" : "no boxed warning required"}; ${hasPi ? "PI link present" : "PI link missing"}.`,
    });
    checks.push({
      module: module.id,
      check: "Images",
      ok: true,
      detail: module.assets.length
        ? `${module.assets.length} approved, in-rights image(s).`
        : "No images.",
    });
    return checks;
  });
}

export type MlrJob = {
  jobCode: string;
  round: number;
  modules: PharmaModule[];
  checks: PreReviewCheck[];
  coordinatorNotes: string[];
};

export const mlrJobCode = (brief: CampaignBrief, round: number) =>
  `LT-US-CRD-${brief.start.slice(0, 4)}-0${42 + round}`;

/** Issued when Medical, Legal and Regulatory have all approved: the job may be distributed. */
export type ApprovedJob = {
  jobCode: string;
  documentNumber: string;
  approvedOn: string;
  /** Twelve months, or sooner if a reference expires first. */
  expiresOn: string;
  modules: PharmaModule[];
};

export function approveJob(job: MlrJob, today: string): ApprovedJob {
  const referenceExpiry = job.modules
    .flatMap((module) =>
      module.claims.flatMap((claim) => claim.references.map((ref) => ref.expiresOn)),
    )
    .sort()[0];
  const yearOut = addMonths(today, 12);
  return {
    jobCode: job.jobCode,
    documentNumber: `${job.jobCode}-A`,
    approvedOn: today,
    expiresOn: referenceExpiry && referenceExpiry < yearOut ? referenceExpiry : yearOut,
    modules: job.modules,
  };
}

// Phase 4: audience ---------------------------------------------------------------------------

export type AudienceRequest = {
  include: Array<{ segmentId: string; deciles: DecileBand[] }>;
  rationale: string;
};

export type AudienceLine = {
  segmentId: string;
  segment: string;
  deciles: DecileBand[];
  prescribers: number;
  doNotContact: number;
  emailReachable: number;
  repCovered: number;
};

export function buildAudience(brief: CampaignBrief, request: AudienceRequest) {
  const market = teamMarket(brief.brand);
  const problems: string[] = [];
  if (request.include.length === 0) problems.push("Include at least one segment.");
  const lines: AudienceLine[] = request.include.flatMap((item) => {
    const universe = HCP_UNIVERSE.find((segment) => segment.segmentId === item.segmentId);
    const segment = market.segments.find((entry) => entry.id === item.segmentId);
    if (!universe || !segment) {
      problems.push(`${item.segmentId} is not a segment in the HCP universe.`);
      return [];
    }
    const bands = item.deciles.filter((band) => (DECILE_BANDS as readonly string[]).includes(band));
    if (bands.length === 0) problems.push(`${segment.name}: choose decile bands (high, mid, low).`);
    const prescribers = bands.reduce((sum, band) => sum + universe.deciles[band], 0);
    const total = DECILE_BANDS.reduce((sum, band) => sum + universe.deciles[band], 0);
    // Do-not-contact is spread across deciles in proportion; nobody on it is reachable.
    const blocked = Math.round((universe.doNotContact * prescribers) / Math.max(1, total));
    const contactable = prescribers - blocked;
    return [
      {
        segmentId: item.segmentId,
        segment: segment.name,
        deciles: bands,
        prescribers,
        doNotContact: blocked,
        emailReachable: Math.round(contactable * universe.emailConsent),
        repCovered: Math.round(contactable * universe.repCovered),
      },
    ];
  });
  return {
    problems,
    lines,
    totals: {
      prescribers: lines.reduce((sum, line) => sum + line.prescribers, 0),
      doNotContact: lines.reduce((sum, line) => sum + line.doNotContact, 0),
      emailReachable: lines.reduce((sum, line) => sum + line.emailReachable, 0),
      repCovered: lines.reduce((sum, line) => sum + line.repCovered, 0),
    },
    rule: "Email goes only to HCPs with documented consent; the do-not-contact list is removed from every channel.",
  };
}

// Phase 5: deployment and Form FDA 2253 -------------------------------------------------------

export type DeploymentLine = {
  moduleId: string;
  channel: PharmaChannel;
  segmentIds: string[];
  start: string;
  end: string;
  budgetUsd: number;
};

export function deploymentProblems(
  brief: CampaignBrief,
  approved: ApprovedJob | null,
  audience: AudienceLine[] | null,
  lines: readonly DeploymentLine[],
): string[] {
  const problems: string[] = [];
  if (!approved) return ["Nothing is approved for distribution: MLR must approve the job first."];
  if (!audience) return ["No approved audience: marketing operations must approve it first."];
  const modules = new Map(approved.modules.map((module) => [module.id, module]));
  const segments = new Set(audience.map((line) => line.segmentId));
  if (lines.length === 0) problems.push("Schedule at least one deployment.");
  const spend = lines.reduce((sum, line) => sum + (line.budgetUsd || 0), 0);
  if (spend > brief.budgetUsd)
    problems.push(
      `The schedule spends $${spend.toLocaleString("en-US")}, over the $${brief.budgetUsd.toLocaleString("en-US")} budget.`,
    );
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`;
    const module = modules.get(line.moduleId);
    const channel = PHARMA_CHANNELS[line.channel];
    if (!module)
      problems.push(`${at}: ${line.moduleId} is not in approved job ${approved.documentNumber}.`);
    if (!channel) problems.push(`${at}: channel must be approved-email or hcp-display.`);
    const minimum = channel
      ? teamMarket(brief.brand).benchmarks[channel.benchmark]?.minSpendUsd
      : undefined;
    if (minimum && line.budgetUsd < minimum)
      problems.push(
        `${at}: $${line.budgetUsd.toLocaleString("en-US")} is under ${channel?.label}'s $${minimum.toLocaleString("en-US")} minimum.`,
      );
    if (module && channel && module.channel !== channel.moduleChannel)
      problems.push(
        `${at}: ${module.id} was approved for ${module.channel}, not ${channel.label}. Only the approved version may run.`,
      );
    for (const segmentId of line.segmentIds)
      if (!segments.has(segmentId))
        problems.push(`${at}: ${segmentId} is not in the approved audience.`);
    if (!DATE.test(line.start) || !DATE.test(line.end) || line.start > line.end)
      problems.push(`${at}: give a start on or before its end (YYYY-MM-DD).`);
    else {
      if (line.start < brief.start || line.end > brief.end)
        problems.push(`${at}: runs outside the brief's window, ${brief.start} to ${brief.end}.`);
      if (line.end > approved.expiresOn)
        problems.push(`${at}: runs past the job's expiry on ${approved.expiresOn}.`);
    }
  });
  return problems;
}

export type Form2253 = {
  form: "FDA Form 2253";
  applicant: string;
  product: string;
  materials: Array<{
    documentNumber: string;
    moduleId: string;
    description: string;
    firstUse: string;
  }>;
  submitAtFirstUse: string;
  note: string;
};

export function prepareForm2253(
  brief: CampaignBrief,
  approved: ApprovedJob,
  lines: readonly DeploymentLine[],
): Form2253 {
  const firstUse = (moduleId: string) =>
    lines
      .filter((line) => line.moduleId === moduleId)
      .map((line) => line.start)
      .sort()[0] ?? brief.start;
  return {
    form: "FDA Form 2253",
    applicant: brief.brand,
    product: "Cardivance",
    materials: approved.modules.map((module) => ({
      documentNumber: approved.documentNumber,
      moduleId: module.id,
      description: `${module.channel === "email" ? "Approved HCP email" : "HCP display banner"}: ${module.headline}`,
      firstUse: firstUse(module.id),
    })),
    submitAtFirstUse: lines.map((line) => line.start).sort()[0] ?? brief.start,
    note: "Submitted to OPDP at the time of initial dissemination, with the approved materials and the current PI.",
  };
}

// Phase 6: results ----------------------------------------------------------------------------

export type ResultLine = {
  id: string;
  moduleId: string;
  channel: PharmaChannel;
  segmentId: string;
  delivered: number;
  opens: number;
  clicks: number;
  repFollowUps: number;
};

/** A stable pseudo-random factor per key, so a simulation is the same every time it is read. */
function jitter(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 0.85 + ((hash >>> 0) % 300) / 1000;
}

/**
 * Thirty days in market, simulated from the brand's benchmarks and each segment's channel
 * affinity. Clearly labelled: this demo has no live channel to read results from.
 */
export function simulateResults(
  brief: CampaignBrief,
  audience: AudienceLine[],
  lines: readonly DeploymentLine[],
): { simulated: true; days: 30; lines: ResultLine[] } {
  const market = teamMarket(brief.brand);
  const results: ResultLine[] = [];
  for (const line of lines)
    for (const segmentId of line.segmentIds) {
      const reach = audience.find((item) => item.segmentId === segmentId);
      const segment = market.segments.find((item) => item.id === segmentId);
      if (!reach || !segment) continue;
      const channel = PHARMA_CHANNELS[line.channel];
      const affinity = segment.affinity[channel.benchmark] ?? 1;
      const factor = jitter(`${line.moduleId}:${segmentId}:${line.channel}`);
      const id =
        `r-${line.moduleId}-${segmentId.replace("lt-seg-", "")}-${line.channel}`.toLowerCase();
      if (line.channel === "approved-email") {
        const delivered = Math.round(reach.emailReachable * 0.97);
        const opens = Math.round(delivered * 0.32 * affinity * factor);
        results.push({
          id,
          moduleId: line.moduleId,
          channel: line.channel,
          segmentId,
          delivered,
          opens,
          clicks: Math.round(opens * 0.11 * factor),
          repFollowUps: Math.round(reach.repCovered * 0.08 * factor),
        });
      } else {
        const benchmark = market.benchmarks.display;
        const impressions = benchmark
          ? Math.round((line.budgetUsd / line.segmentIds.length / benchmark.cpm) * 1000)
          : 0;
        results.push({
          id,
          moduleId: line.moduleId,
          channel: line.channel,
          segmentId,
          delivered: impressions,
          opens: 0,
          clicks: Math.round(impressions * (benchmark?.ctr ?? 0) * affinity * factor),
          repFollowUps: 0,
        });
      }
    }
  return { simulated: true, days: 30, lines: results };
}

export const NEXT_ACTIONS = ["continue", "optimize", "retire"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export type PerformanceReport = {
  findings: Array<{ text: string; sources: string[] }>;
  recommendation: NextAction;
  rationale: string;
  nextSteps: string[];
};

export function performanceProblems(
  report: PerformanceReport,
  resultIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  if (report.findings.length === 0) problems.push("Give at least one finding.");
  report.findings.forEach((finding, index) => {
    if (finding.sources.length === 0) problems.push(`Finding ${index + 1} cites no result line.`);
    for (const source of finding.sources)
      if (!resultIds.has(source))
        problems.push(`Finding ${index + 1} cites ${source}, which is not a result line.`);
  });
  if (!(NEXT_ACTIONS as readonly string[]).includes(report.recommendation))
    problems.push(`recommendation must be one of ${NEXT_ACTIONS.join(", ")}.`);
  if (!report.rationale?.trim()) problems.push("Give the rationale for the recommendation.");
  return problems;
}

// The lifecycle's state ------------------------------------------------------------------------
// Pure, so the server and the tests share one definition of where a run is. The edge rebuilds it
// from a run's event log: every artifact and every person's decision, in order.

/** Artifacts the system issues, not an agent: the MLR approval and the in-market results. */
export const SYSTEM_ARTIFACTS = ["mlr_approval", "campaign_results"] as const;
export type SystemArtifact = (typeof SYSTEM_ARTIFACTS)[number];
export type ArtifactName = TeamTool | SystemArtifact;

export type LifecycleArtifact = { version: number; round: number; by: string; data: unknown };

export type LifecycleState = {
  phase: PharmaPhaseId;
  /** Each phase's round: a person asking for changes starts the phase again in a new round. */
  rounds: Record<PharmaPhaseId, number>;
  artifacts: Partial<Record<ArtifactName, LifecycleArtifact>>;
  /** People who approved in the current phase and round. */
  passed: TeamGate[];
  /** The option each choice gate settled on. */
  choices: Partial<Record<TeamGate, string>>;
  /** What the last person to ask for changes in each phase said. */
  notes: Partial<Record<PharmaPhaseId, string>>;
  finished: boolean;
};

export function newLifecycle(): LifecycleState {
  return {
    phase: "focus",
    rounds: Object.fromEntries(PHARMA_PHASE_IDS.map((id) => [id, 1])) as Record<
      PharmaPhaseId,
      number
    >,
    artifacts: {},
    passed: [],
    choices: {},
    notes: {},
    finished: false,
  };
}

const phaseSteps = (phase: PharmaPhaseId) =>
  (pharmaPhase(phase)?.steps ?? []) as readonly PhaseStep[];

/** Whether a step is done in its phase's current round. */
export function stepDone(state: LifecycleState, step: PhaseStep) {
  if (step.kind === "person") return state.passed.includes(step.gate);
  return state.artifacts[step.tool]?.round === state.rounds[state.phase];
}

/** The step the lifecycle waits on: the first in the current phase that is not done. */
export function currentStep(state: LifecycleState): PhaseStep | null {
  if (state.finished) return null;
  return phaseSteps(state.phase).find((step) => !stepDone(state, step)) ?? null;
}

/** Records an artifact, as the next version of its name, in the current phase's round. */
export function recordArtifact(
  state: LifecycleState,
  name: ArtifactName,
  by: string,
  data: unknown,
): LifecycleArtifact {
  const artifact = {
    version: (state.artifacts[name]?.version ?? 0) + 1,
    round: state.rounds[state.phase],
    by,
    data,
  };
  state.artifacts[name] = artifact;
  return artifact;
}

/**
 * A person's decision on the step the lifecycle waits on. Approving passes the step, and the last
 * step of a phase moves the run to the next phase (or finishes it); asking for changes starts the
 * phase again. Returns what changed, so the caller can announce it.
 */
export function applyDecision(
  state: LifecycleState,
  gate: TeamGate,
  decision: "approve" | "changes",
  options: { note?: string; choice?: string } = {},
): { finishedPhase: PharmaPhaseId | null; nextPhase: PharmaPhaseId | null } {
  const step = currentStep(state);
  if (step?.kind !== "person" || step.gate !== gate)
    throw new Error(`The lifecycle is not waiting for ${gate}.`);
  if (decision === "changes") {
    state.rounds[state.phase] += 1;
    state.passed = [];
    if (options.note) state.notes[state.phase] = options.note;
    return { finishedPhase: null, nextPhase: null };
  }
  state.passed.push(gate);
  if (options.choice !== undefined) state.choices[gate] = options.choice;
  if (currentStep(state)) return { finishedPhase: null, nextPhase: null };
  const finishedPhase = state.phase;
  const index = PHARMA_PHASE_IDS.indexOf(finishedPhase);
  const nextPhase = PHARMA_PHASE_IDS[index + 1] ?? null;
  state.passed = [];
  if (nextPhase) state.phase = nextPhase;
  else state.finished = true;
  return { finishedPhase, nextPhase };
}

/** The options a choice gate offers, from the artifact the agents saved before it. */
export function choiceOptions(
  state: LifecycleState,
  gate: TeamGate,
): Array<{ id: string; label: string; detail?: string }> {
  if (gate === "focus") {
    const areas =
      (state.artifacts.propose_focus_areas?.data as { areas?: FocusArea[] })?.areas ?? [];
    return areas.map((area, index) => ({
      id: String(index + 1),
      label: area.title,
      detail: `${area.rationale} Measure: ${area.measure}`,
    }));
  }
  if (gate === "concept") {
    const concepts =
      (state.artifacts.propose_concepts?.data as { concepts?: Concept[] })?.concepts ?? [];
    return concepts.map((concept, index) => ({
      id: String(index + 1),
      label: concept.name,
      detail: concept.bigIdea,
    }));
  }
  if (gate === "next-action") {
    const report = state.artifacts.report_performance?.data as PerformanceReport | undefined;
    return NEXT_ACTIONS.map((action) => ({
      id: action,
      label: action[0]?.toUpperCase() + action.slice(1),
      ...(report?.recommendation === action
        ? { detail: "The performance analyst recommends this." }
        : {}),
    }));
  }
  return [];
}

/** The focus area and concept people chose, for the steps that build on them. */
export function chosen(state: LifecycleState) {
  const pick = <T>(list: T[] | undefined, id: string | undefined) =>
    id ? list?.[Number(id) - 1] : undefined;
  return {
    focus: pick(
      (state.artifacts.propose_focus_areas?.data as { areas?: FocusArea[] })?.areas,
      state.choices.focus,
    ),
    concept: pick(
      (state.artifacts.propose_concepts?.data as { concepts?: Concept[] })?.concepts,
      state.choices.concept,
    ),
  };
}
