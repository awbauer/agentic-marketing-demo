// The pharma campaign lifecycle: how a prescription brand's campaign goes from business focus to
// analytics. The squad's agents do the work at every step; people decide at the points a real
// brand team, MLR committee and operations team would. The steps follow the claims-management
// process US promotional review runs on (docs/decisions/ADR-017-claims-managed-lifecycle.md):
// claims are records with an ID, evidence anchors, required context, scope and expiry; a concept
// gets an early medical look before anything is built; modules take claims by ID, word for word;
// a quality check runs before Medical/Legal/Regulatory review; the approval issues material IDs
// and the built variants are checked against it; Form FDA 2253 is filed at first use before
// anything publishes; claim IDs travel into every channel placement; and results come back by
// claim, with a where-used list that makes a withdrawal a lookup, not a search.
//
// Everything here is deterministic: the services check what the agents propose against governed
// content (the claims library, its evidence, the disclosure rules, the asset library) and refuse
// what breaks a rule. The market data and the in-market results are fictional and labelled so.
import { claimPacket, DISCLOSURE_RULES } from "./agents.ts";
import { ASSET_LIBRARY } from "./assets.ts";
import { framingProblems, headlineShape } from "./language.ts";
import type { CampaignBrief, LifecycleWorker, TeamGate, TeamTool } from "./team.ts";
import { teamMarket } from "./team-data.ts";
import { assetChoices, researchSourceIds } from "./team-services.ts";
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
      /** What the step hands in, in a content team's words (the page's step card). */
      delivers: string;
      /** The stage of a phase the page shows as its own step on the path, when a phase has two. */
      stage?: string;
    }
  | { kind: "person"; gate: TeamGate; does: string; stage?: string };

/**
 * The lifecycle, phase by phase, as the ordered steps the server enforces: each agent step ends
 * when its save tool accepts the work, each person step when that person approves. A person who
 * asks for changes sends the phase back to its first step.
 */
export const PHARMA_PHASES = [
  {
    id: "focus",
    familiar: "Brief & strategy",
    title: "Business focus",
    steps: [
      {
        kind: "agent",
        agent: "audience-analyst",
        tool: "propose_focus_areas",
        delivers: "Two or three focus areas, each citing its data",
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
    familiar: "Concept",
    title: "Campaign ideation",
    steps: [
      {
        kind: "agent",
        agent: "art-director",
        tool: "propose_concepts",
        delivers: "Two or three concepts on approved claims and in-rights images",
        does: "Starts from what is already approved: proposes two or three concepts for the chosen focus, each carried by claims from the claims library that are in scope for US HCP email and display under the current label, and shown with approved, in-rights images from the asset library. No claim is written and no image is generated; any words joining them are written later and reviewed in full.",
      },
      {
        kind: "person",
        gate: "concept",
        does: "The brand lead chooses a concept.",
      },
      {
        kind: "person",
        gate: "concept-review",
        does: "A medical reviewer looks at the chosen concept, its claims and its images before anything is built, so an objection to the idea comes now and not at finished art.",
      },
    ],
  },
  {
    id: "content",
    familiar: "Copy & creative · MLR review · approval",
    title: "Content and MLR review",
    steps: [
      {
        kind: "agent",
        agent: "copy-lead",
        tool: "draft_modules",
        stage: "Copy & creative",
        delivers: "An email and a display module, claims word for word from the library",
        does: "Assembles an email and a display module from the claims library: each claim enters by its ID, word for word, with its reference marker and the context it requires; the service attaches the ISI, boxed warning and PI link beside the claims. A claim out of scope for the channel, audience or label, or one that must not appear with another, is refused.",
      },
      {
        kind: "agent",
        agent: "mlr-coordinator",
        tool: "submit_mlr_job",
        stage: "MLR review & approval",
        delivers: "A pre-checked, referenced job submitted for MLR review",
        does: "Runs the quality check before review: anchors every claim to its reference passage, checks label version, scope, required context, reference validity, fair balance and the net impression of each module as a whole, sets the review tier, writes notes for the reviewers and submits the job. A job that fails a check is not submitted.",
      },
      {
        kind: "person",
        gate: "medical",
        stage: "MLR review & approval",
        does: "Medical checks the science: each claim against its reference, and fair balance.",
      },
      {
        kind: "person",
        gate: "legal",
        stage: "MLR review & approval",
        does: "Legal checks the risk: wording, comparisons, trademarks and the images' rights.",
      },
      {
        kind: "person",
        gate: "regulatory",
        stage: "MLR review & approval",
        does: "Regulatory checks against the label and FDA rules, and approves the job for distribution. The system issues a document number, a material ID per module and an expiry, then checks every built variant against the approved version.",
      },
    ],
  },
  {
    id: "audience",
    familiar: "HCP targeting & list approval",
    title: "Audience selection",
    steps: [
      {
        kind: "agent",
        agent: "audience-analyst",
        tool: "build_audience",
        delivers: "An HCP target list with consent and do-not-contact applied",
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
    familiar: "Deployment & 2253 filing",
    title: "Market publishing",
    steps: [
      {
        kind: "agent",
        agent: "channel-planner",
        tool: "schedule_deployment",
        delivers: "A deployment schedule of approved materials, by material ID",
        does: "Schedules only the approved modules, by material ID, to brand email (consented HCPs) and endemic HCP display, inside the brief's window and before the job expires, within budget. Each placement carries its material ID and claim IDs into the channel.",
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
        delivers: "A Form FDA 2253 package, ready for Regulatory to file",
        does: "Prepares Form FDA 2253 with the scheduled materials, their material IDs and the current PI version, dated to first use. Publishing is held until it is filed.",
      },
      {
        kind: "person",
        gate: "fda-2253",
        does: "Regulatory files Form FDA 2253 with OPDP at first use. Only then does the schedule publish.",
      },
    ],
  },
  {
    id: "analytics",
    familiar: "Measurement",
    title: "Analytics",
    steps: [
      {
        kind: "agent",
        agent: "performance-analyst",
        tool: "report_performance",
        delivers: "A performance read with a continue, optimize or retire recommendation",
        does: "After 30 days in market (simulated here), reads the results by segment, decile, channel and claim ID against past results, and recommends continue, optimize or retire, citing the result lines.",
      },
      {
        kind: "person",
        gate: "next-action",
        does: "The brand lead decides the next action. The system lists where every claim is live, with its expiry and re-review date; retiring the campaign turns that list into a withdrawal plan by ID.",
      },
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  /** The phase in the content lifecycle a brand or agency team already knows. */
  familiar: string;
  title: string;
  steps: readonly PhaseStep[];
}>;
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
/**
 * Each lifecycle agent in a content team's words: what it is, and the people whose work it
 * assists. The agent never owns the result; the person at the gate after it does.
 */
export const LIFECYCLE_ROLES: Record<
  "campaign-lead" | LifecycleWorker,
  { plain: string; assists: string; summary?: string }
> = {
  "campaign-lead": {
    plain: "Project lead agent",
    assists: "the agency project manager or PromoMats job owner",
    summary:
      "Routes each step to the right agent or person, in order, and passes people's requests for changes back to the agent that does the work. It cannot approve anything: every decision is a person's.",
  },
  "audience-analyst": {
    plain: "Insights and targeting agent",
    assists: "brand analytics and marketing operations",
  },
  "art-director": { plain: "Concept agent", assists: "the agency creative team" },
  "copy-lead": {
    plain: "Modular content agent",
    assists: "the copywriter and the modular content producer",
  },
  "mlr-coordinator": {
    plain: "MLR submission agent",
    assists: "the MLR (PRC) coordinator and regulatory operations",
  },
  "channel-planner": { plain: "Deployment agent", assists: "media and omnichannel operations" },
  "performance-analyst": { plain: "Performance agent", assists: "analytics and customer insights" },
};

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
  // Brand-sent (home office) email to HCPs who consented to the brand's email. The id predates the
  // label: this is not rep-triggered Veeva Approved Email, which needs the HCP's opt-in to a rep.
  "approved-email": {
    label: "Brand email to consented HCPs",
    moduleChannel: "email",
    benchmark: "email",
  },
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
// A claim is more than its sentence. Each record carries its ID, the passages that substantiate
// it, the context it can't be used without, who and where it may reach, the label version it was
// approved against, its expiry, and the claims it must never sit beside. A keyword search finds
// the sentence; only the record says whether this campaign may use it.

/** The label the claims must have been approved against. A claim on an older label is stale. */
export const CURRENT_LABEL = {
  id: "USPI-v4",
  effective: "2026-03-01",
  title: "Cardivance US Prescribing Information, version 4",
} as const;

export type ClaimAudience = "HCP" | "consumer" | "payer";
export type ClaimChannel = "email" | "display" | "detail-aid";

/** What the claims library keeps about a claim beyond its sentence. */
export type ClaimRecord = {
  claimId: string;
  /** What kind of statement it is, e.g. efficacy.primary_endpoint. */
  type: string;
  indication: string;
  audiences: ClaimAudience[];
  markets: string[];
  channels: ClaimChannel[];
  /** Where in each reference the claim's support is: page, table or label section. */
  anchors: Array<{ reference: string; anchor: string }>;
  /** Context the claim can't be used without, inserted with it word for word. */
  context: string | null;
  /** Claims that would together imply something nobody approved (superiority, say). */
  mustNotAppearWith: string[];
  labelVersion: string;
  expiresOn: string;
  /** The global core claim it was derived from. */
  derivedFrom: string;
};

const MORTALITY_CONTEXT =
  "Primary composite endpoint (cardiovascular death or first heart failure hospitalization), CARDIO-HF phase 3, N=8,442, median follow-up 27 months. Absolute rates: 21.0% with Cardivance, 26.3% with enalapril.";

/** Records for the product's claims, by topic. Fictional, shaped like a real claims library's. */
export const CLAIM_RECORDS: Record<string, ClaimRecord> = {
  "cardivance-mortality": {
    claimId: "CLM-CRD-0042",
    type: "efficacy.primary_endpoint",
    indication: "HFrEF.adults",
    audiences: ["HCP"],
    markets: ["US"],
    channels: ["email", "display", "detail-aid"],
    anchors: [
      { reference: "CARDIO-HF clinical study report", anchor: "p. 7, table 2" },
      { reference: CURRENT_LABEL.id, anchor: "section 14.1" },
    ],
    context: MORTALITY_CONTEXT,
    mustNotAppearWith: ["cardivance-superior"],
    labelVersion: CURRENT_LABEL.id,
    expiresOn: "2027-11-14",
    derivedFrom: "GCC-CRD-0011",
  },
  "cardivance-safety": {
    claimId: "CLM-CRD-0043",
    type: "safety.adverse_reactions",
    indication: "HFrEF.adults",
    audiences: ["HCP"],
    markets: ["US"],
    channels: ["email", "display", "detail-aid"],
    // Keyed by the governed evidence's own source name, so the anchor reaches the module.
    anchors: [
      {
        reference: "Cardivance prescribing information, section 6",
        anchor: `${CURRENT_LABEL.id} section 6.1, adverse reactions table`,
      },
    ],
    context: null,
    mustNotAppearWith: [],
    labelVersion: CURRENT_LABEL.id,
    expiresOn: "2027-11-14",
    derivedFrom: "GCC-CRD-0014",
  },
  "cardivance-superior": {
    claimId: "CLM-CRD-0077",
    type: "efficacy.comparative",
    indication: "HFrEF.adults",
    audiences: ["HCP"],
    markets: ["US"],
    channels: ["email"],
    anchors: [],
    context: null,
    mustNotAppearWith: ["cardivance-mortality"],
    labelVersion: CURRENT_LABEL.id,
    expiresOn: "2027-11-14",
    derivedFrom: "GCC-CRD-0019",
  },
  "cardivance-hfpef": {
    claimId: "CLM-CRD-0081",
    type: "efficacy.secondary_endpoint",
    indication: "HFpEF.adults",
    audiences: ["HCP"],
    markets: ["US"],
    channels: ["email"],
    anchors: [],
    context: null,
    mustNotAppearWith: [],
    labelVersion: CURRENT_LABEL.id,
    expiresOn: "2027-11-14",
    derivedFrom: "GCC-CRD-0021",
  },
};

/**
 * Near twins of an approved claim that a keyword search returns beside it. Each one is approved
 * for something, just not for this campaign: a consumer version, a rep detail aid version, and the
 * same words approved against the previous label.
 */
export const CLAIM_TWINS: ReadonlyArray<{ topic: string; of: string; text: string } & ClaimRecord> =
  [
    {
      topic: "cardivance-mortality-consumer",
      of: "cardivance-mortality",
      text: "In a large study, about 21 in 100 people taking Cardivance died of heart problems or went to hospital for heart failure, compared with about 26 in 100 taking another medicine.",
      ...{
        claimId: "CLM-CRD-0051",
        type: "efficacy.primary_endpoint",
        indication: "HFrEF.adults",
        audiences: ["consumer"],
        markets: ["US"],
        channels: ["email", "display"],
        anchors: [{ reference: "CARDIO-HF clinical study report", anchor: "p. 7, table 2" }],
        context: null,
        mustNotAppearWith: [],
        labelVersion: CURRENT_LABEL.id,
        expiresOn: "2027-11-14",
        derivedFrom: "GCC-CRD-0011",
      },
    },
    {
      topic: "cardivance-mortality-detail-aid",
      of: "cardivance-mortality",
      text: "Reduced the risk of cardiovascular death or heart failure hospitalization by 20% versus enalapril in HFrEF.",
      ...{
        claimId: "CLM-CRD-0047",
        type: "efficacy.primary_endpoint",
        indication: "HFrEF.adults",
        audiences: ["HCP"],
        markets: ["US"],
        channels: ["detail-aid"],
        anchors: [{ reference: "CARDIO-HF clinical study report", anchor: "p. 7, table 2" }],
        context: MORTALITY_CONTEXT,
        mustNotAppearWith: ["cardivance-superior"],
        labelVersion: CURRENT_LABEL.id,
        expiresOn: "2027-11-14",
        derivedFrom: "GCC-CRD-0011",
      },
    },
    {
      topic: "cardivance-mortality-v3",
      of: "cardivance-mortality",
      text: "Reduced the risk of cardiovascular death or heart failure hospitalization by 20% versus enalapril in HFrEF.",
      ...{
        claimId: "CLM-CRD-0019",
        type: "efficacy.primary_endpoint",
        indication: "HFrEF.adults",
        audiences: ["HCP"],
        markets: ["US"],
        channels: ["email", "display", "detail-aid"],
        anchors: [{ reference: "USPI-v3", anchor: "section 14.1" }],
        context: MORTALITY_CONTEXT,
        mustNotAppearWith: ["cardivance-superior"],
        labelVersion: "USPI-v3",
        expiresOn: "2026-02-28",
        derivedFrom: "GCC-CRD-0011",
      },
    },
  ];

/** The scope the lifecycle's campaigns run in: US HCPs, by email and endemic display. */
export const CAMPAIGN_SCOPE = {
  audience: "HCP" as ClaimAudience,
  market: "US",
  channels: ["email", "display"] as ClaimChannel[],
};

export type LibraryClaim = {
  topic: string;
  /** The library's ID for the claim; modules and placements carry it. */
  claimId: string | null;
  text: string;
  status: string;
  usable: boolean;
  issues: string[];
  references: Array<{ source: string; asOf: string; expiresOn: string; anchor?: string }>;
  /** Disclosures the claim requires, attached by the service when the claim is used. */
  requires: string[];
  context: string | null;
  scope: {
    audiences: ClaimAudience[];
    markets: string[];
    channels: ClaimChannel[];
    indication: string;
  } | null;
  labelVersion: string | null;
  expiresOn: string | null;
  mustNotAppearWith: string[];
};

/** Why a claim's record keeps it out of this campaign, if it does. */
function scopeIssues(record: ClaimRecord, campaignEnd: string): string[] {
  const issues: string[] = [];
  if (!record.audiences.includes(CAMPAIGN_SCOPE.audience))
    issues.push(
      `Approved for ${record.audiences.join(", ")} audiences, not HCPs: HCP promotion needs the HCP version.`,
    );
  if (!record.markets.includes(CAMPAIGN_SCOPE.market))
    issues.push(`Approved for ${record.markets.join(", ")}, not the US label.`);
  if (record.labelVersion !== CURRENT_LABEL.id)
    issues.push(
      `Approved against ${record.labelVersion}; the current label is ${CURRENT_LABEL.id}. It expired with the old label.`,
    );
  else if (record.expiresOn < campaignEnd)
    issues.push(`The claim's approval expires ${record.expiresOn}, before the campaign ends.`);
  if (!record.channels.some((channel) => CAMPAIGN_SCOPE.channels.includes(channel)))
    issues.push(
      `Approved for ${record.channels.join(", ")} only: email and display need their own approval.`,
    );
  if (record.indication !== "HFrEF.adults")
    issues.push(`Its indication (${record.indication}) is not on the label: off-label.`);
  return issues;
}

/**
 * The brand's claims library: every current claim with its record, status, references and
 * disclosures, plus the near twins a search returns beside them. Only a substantiated claim whose
 * record is in scope for a US HCP campaign under the current label is usable.
 */
export function claimsLibrary(world: World, brand: Brand, campaignEnd = ""): LibraryClaim[] {
  const product = brand === PHARMA_PRODUCT.brand ? PHARMA_PRODUCT.prefix : "";
  const records = (topic: string) => CLAIM_RECORDS[topic];
  const withRecord = (
    record: ClaimRecord | undefined,
    references: Array<{ source: string; asOf: string; expiresOn: string }>,
  ) =>
    references.map((reference) => {
      const anchor = record?.anchors.find((item) => item.reference === reference.source)?.anchor;
      return anchor ? { ...reference, anchor } : reference;
    });
  const governed = listObjects(world, { kind: "claim", brand })
    .filter((claim) => !successorOf(world, claim.urn))
    .filter((claim) => attributesOf<ClaimAttributes>(claim).topic.startsWith(product))
    .map((claim): LibraryClaim => {
      const packet = claimPacket(world, claim);
      const topic = attributesOf<ClaimAttributes>(claim).topic;
      const record = records(topic);
      const substantiated = packet.status === "substantiated";
      const scoped = record && substantiated ? scopeIssues(record, campaignEnd) : [];
      return {
        topic,
        claimId: record?.claimId ?? null,
        text: packet.text,
        status: packet.status,
        usable: substantiated && scoped.length === 0,
        issues: [...packet.issues, ...scoped],
        references: withRecord(
          record,
          packet.evidence.map(({ source, asOf, expiresOn }) => ({ source, asOf, expiresOn })),
        ),
        requires: [...(DISCLOSURE_RULES[packet.topic] ?? [])],
        context: record?.context ?? null,
        scope: record
          ? {
              audiences: record.audiences,
              markets: record.markets,
              channels: record.channels,
              indication: record.indication,
            }
          : null,
        labelVersion: record?.labelVersion ?? null,
        expiresOn: record?.expiresOn ?? null,
        mustNotAppearWith: record?.mustNotAppearWith ?? [],
      };
    });
  if (!product) return governed;
  const twins = CLAIM_TWINS.flatMap((twin): LibraryClaim[] => {
    const parent = governed.find((claim) => claim.topic === twin.of);
    if (!parent) return [];
    return [
      {
        topic: twin.topic,
        claimId: twin.claimId,
        text: twin.text,
        status: parent.status,
        usable: false,
        issues: scopeIssues(twin, campaignEnd),
        references: twin.anchors.map((anchor) => ({
          source: anchor.reference,
          asOf: parent.references[0]?.asOf ?? "",
          expiresOn: twin.expiresOn,
          anchor: anchor.anchor,
        })),
        requires: parent.requires,
        context: twin.context,
        scope: {
          audiences: twin.audiences,
          markets: twin.markets,
          channels: twin.channels,
          indication: twin.indication,
        },
        labelVersion: twin.labelVersion,
        expiresOn: twin.expiresOn,
        mustNotAppearWith: twin.mustNotAppearWith,
      },
    ];
  });
  return [...governed, ...twins];
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

/**
 * The topics a refusal offers, so a model that left claimTopics out knows what to send: a claim ID
 * (CLM-…) or prose is not a topic, and models repeat a refused call when told only that it is wrong.
 */
function usableTopics(library: ReadonlyMap<string, LibraryClaim>): string {
  const usable = [...library.values()].filter((claim) => claim.usable);
  return usable.length
    ? `Usable topics: ${usable.map((claim) => `${claim.topic}${claim.claimId ? ` (${claim.claimId})` : ""}`).join(", ")}.`
    : "No claim in the library is usable for this campaign.";
}

export function conceptProblems(
  world: World,
  brief: CampaignBrief,
  concepts: readonly Concept[],
): string[] {
  const library = new Map(
    claimsLibrary(world, brief.brand, brief.end).map((claim) => [claim.topic, claim]),
  );
  const problems: string[] = [];
  if (concepts.length < 2 || concepts.length > 3) problems.push("Propose two or three concepts.");
  concepts.forEach((concept, index) => {
    const at = `Concept ${index + 1} (${concept.name || "untitled"})`;
    if (!concept.name?.trim() || !concept.bigIdea?.trim())
      problems.push(`${at}: give a name and a big idea.`);
    if (concept.claimTopics.length === 0)
      problems.push(
        `${at}: name the claims that carry it in claimTopics. ${usableTopics(library)}`,
      );
    for (const topic of concept.claimTopics) {
      const claim = library.get(topic);
      if (!claim) problems.push(`${at}: ${topic} is not in the claims library.`);
      else if (!claim.usable)
        problems.push(
          `${at}: ${topic} can't carry a concept (${claim.status}: ${claim.issues.join(" ")}).`,
        );
    }
    problems.push(
      ...juxtapositionProblems(concept.claimTopics, library).map((problem) => `${at}: ${problem}`),
    );
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
    /** The library's claim ID: the claim entered by ID, word for word. */
    claimId: string | null;
    text: string;
    /** The reference marker the claim carries in the copy. */
    marker: number;
    references: LibraryClaim["references"];
    /** Context the claim can't be used without, inserted with it. */
    context: string | null;
    labelVersion: string | null;
  }>;
  closing: string;
  cta: string;
  disclosures: Array<{ id: string; title: string; text: string }>;
  /** Where the risk information sits: in the body beside the claims, never behind a link. */
  safetyPlacement: "beside-claims";
  assets: Array<{ assetId: string; use: string }>;
};

/** Claims that must not appear together, because together they imply something nobody approved. */
export function juxtapositionProblems(
  topics: readonly string[],
  library: ReadonlyMap<string, LibraryClaim>,
): string[] {
  const problems: string[] = [];
  topics.forEach((topic, index) => {
    for (const other of topics.slice(index + 1))
      if (
        library.get(topic)?.mustNotAppearWith.includes(other) ||
        library.get(other)?.mustNotAppearWith.includes(topic)
      )
        problems.push(
          `${topic} must not appear with ${other}: together they imply a claim nobody approved.`,
        );
  });
  return problems;
}

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
  const library = new Map(
    claimsLibrary(world, brief.brand, brief.end).map((claim) => [claim.topic, claim]),
  );
  const problems: string[] = [];
  if (draft.channel !== "email" && draft.channel !== "display")
    problems.push("channel must be email or display.");
  if (draft.claimTopics.length === 0)
    problems.push(
      `Cite at least one claim from the claims library in claimTopics. ${usableTopics(library)}`,
    );
  for (const topic of draft.claimTopics) {
    const claim = library.get(topic);
    if (!claim) problems.push(`${topic} is not in the claims library.`);
    else if (!claim.usable)
      problems.push(
        `${topic} is refused: ${claim.status}. ${claim.issues.join(" ")} Drop it; MLR will not approve an unsupported or out-of-scope claim.`,
      );
    else if (claim.scope && !claim.scope.channels.includes(draft.channel))
      problems.push(`${topic} (${claim.claimId}) is not approved for ${draft.channel}.`);
  }
  problems.push(...juxtapositionProblems(draft.claimTopics, library));
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
    return {
      topic,
      claimId: claim.claimId,
      text: claim.text,
      marker: index + 1,
      references: claim.references,
      context: claim.context,
      labelVersion: claim.labelVersion,
    };
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
      safetyPlacement: "beside-claims",
      assets: draft.assets,
    },
  };
}

// Phase 3: the quality check and the MLR package ----------------------------------------------

export type PreReviewCheck = { module: string; check: string; ok: boolean; detail: string };

/**
 * The quality check the MLR coordinator runs before a job goes to reviewers: every claim anchored
 * to its passage and valid through the campaign, on the current label and in scope, with its
 * required context; fair balance beside the claims; and the module judged as a whole, because
 * approved parts can still add up to a claim nobody approved.
 */
export function preReviewChecks(
  brief: CampaignBrief,
  modules: readonly PharmaModule[],
): PreReviewCheck[] {
  return modules.flatMap((module) => {
    const checks: PreReviewCheck[] = [];
    for (const claim of module.claims) {
      const lasts = claim.references.some((reference) => reference.expiresOn >= brief.end);
      const anchored = claim.references.every((reference) => reference.anchor);
      checks.push({
        module: module.id,
        check: `Reference for claim ${claim.marker}`,
        // A reference without its passage anchor is unsubstantiated: nothing ties the claim to
        // the place in the evidence that supports it.
        ok: claim.references.length > 0 && lasts && anchored,
        detail: claim.references.length
          ? claim.references
              .map(
                (reference) =>
                  `${reference.source}${reference.anchor ? `, ${reference.anchor}` : ""} (${reference.asOf}, valid to ${reference.expiresOn})`,
              )
              .join("; ") + (anchored ? "" : " · a reference has no passage anchor")
          : "No reference.",
      });
      const record = CLAIM_RECORDS[claim.topic];
      checks.push({
        module: module.id,
        check: `Label and scope for claim ${claim.marker}`,
        ok:
          Boolean(claim.claimId) &&
          claim.labelVersion === CURRENT_LABEL.id &&
          Boolean(record?.channels.includes(module.channel)),
        detail: claim.claimId
          ? `${claim.claimId} · ${claim.labelVersion ?? "no label version"} · ${record ? `${record.audiences.join("/")} · ${record.markets.join("/")} · ${record.channels.join(", ")}` : "no record"}`
          : "The claim has no library ID: it was typed in, not taken from the library.",
      });
      if (record?.context)
        checks.push({
          module: module.id,
          check: `Required context for claim ${claim.marker}`,
          ok: claim.context === record.context,
          detail:
            claim.context === record.context
              ? "Endpoint, trial and absolute rates travel with the claim."
              : "The claim's required context is missing.",
        });
    }
    const hasIsi = module.disclosures.some((item) => item.id.includes("isi"));
    const hasBoxed = module.disclosures.some((item) => item.id.includes("boxed"));
    const hasPi = module.disclosures.some((item) => item.id.endsWith("-pi"));
    checks.push({
      module: module.id,
      check: "Fair balance",
      ok: hasIsi && hasPi && module.safetyPlacement === "beside-claims",
      detail: `${hasIsi ? "ISI beside the claims" : "ISI missing"}; ${hasBoxed ? "boxed warning present" : "no boxed warning required"}; ${hasPi ? "PI link present" : "PI link missing"}. Risk is in the body, not below the fold or behind a link.`,
    });
    const topics = module.claims.map((claim) => claim.topic);
    const clashes = topics.flatMap((topic) =>
      (CLAIM_RECORDS[topic]?.mustNotAppearWith ?? [])
        .filter((other) => topics.includes(other))
        .map((other) => `${topic} with ${other}`),
    );
    const implied = module.assets.flatMap(({ assetId }) =>
      (ASSET_LIBRARY.find((asset) => asset.id === assetId)?.shows ?? []).filter(
        (topic) => !topics.includes(topic),
      ),
    );
    checks.push({
      module: module.id,
      check: "Net impression",
      ok: clashes.length === 0 && implied.length === 0,
      detail:
        clashes.length || implied.length
          ? [
              clashes.length ? `Claims that must not appear together: ${clashes.join("; ")}.` : "",
              implied.length
                ? `Images imply claims the module does not carry: ${implied.join(", ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          : `Read as a whole: no claims that must stay apart, and ${module.assets.length ? `${module.assets.length} approved, in-rights image(s) that imply nothing the module does not say` : "no images"}.`,
    });
    return checks;
  });
}

/**
 * How much review the job needs. B: approved claims and disclosures only, assembled under approved
 * rules, to one reviewer. C: anything that adds meaning, which goes to the full committee. (A
 * third tier, an approved module reused unchanged, never arises here: every module is newly
 * assembled for the campaign.)
 */
export type ReviewTier = { tier: "B" | "C"; path: string; reason: string };
/** Each tier in a reviewer's words. */
export const REVIEW_TIER_LABELS: Record<ReviewTier["tier"], string> = {
  B: "Tier B · single reviewer, pre-approved content only",
  C: "Tier C · full MLR (new copy)",
};

export function reviewTier(modules: readonly PharmaModule[]): ReviewTier {
  const ownWords = modules.some((module) =>
    [module.headline, module.opening, module.closing].some((text) => text.trim()),
  );
  return ownWords
    ? {
        tier: "C",
        path: "Full committee: Medical, Legal and Regulatory",
        reason:
          "New headline, opening and closing copy around the approved claims is new meaning, and these modules have not been reviewed before.",
      }
    : {
        tier: "B",
        path: "One reviewer, with a sampled audit",
        reason: "Approved claims and disclosures only, assembled under approved rules.",
      };
}

export type MlrJob = {
  jobCode: string;
  round: number;
  modules: PharmaModule[];
  checks: PreReviewCheck[];
  tier?: ReviewTier;
  coordinatorNotes: string[];
};

export const mlrJobCode = (brief: CampaignBrief, round: number) =>
  `LT-US-CRD-${brief.start.slice(0, 4)}-0${42 + round}`;

/** Issued when Medical, Legal and Regulatory have all approved: the job may be distributed. */
export type ApprovedJob = {
  jobCode: string;
  documentNumber: string;
  approvedOn: string;
  /** Twelve months, or sooner if a reference or claim approval expires first. */
  expiresOn: string;
  labelVersion: string;
  /** One material ID per approved module, with the claim IDs inside it. */
  materials: Array<{ moduleId: string; materialId: string; channel: string; claimIds: string[] }>;
  modules: PharmaModule[];
};

export const claimIdsOf = (module: PharmaModule) =>
  module.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : []));

export function approveJob(job: MlrJob, today: string): ApprovedJob {
  const firstExpiry = job.modules
    .flatMap((module) =>
      module.claims.flatMap((claim) => [
        ...claim.references.map((ref) => ref.expiresOn),
        ...(CLAIM_RECORDS[claim.topic]?.expiresOn
          ? [CLAIM_RECORDS[claim.topic]?.expiresOn as string]
          : []),
      ]),
    )
    .sort()[0];
  const yearOut = addMonths(today, 12);
  const documentNumber = `${job.jobCode}-A`;
  return {
    jobCode: job.jobCode,
    documentNumber,
    approvedOn: today,
    expiresOn: firstExpiry && firstExpiry < yearOut ? firstExpiry : yearOut,
    labelVersion: CURRENT_LABEL.id,
    materials: job.modules.map((module) => ({
      moduleId: module.id,
      materialId: `${documentNumber}-${module.id}`,
      channel: module.channel,
      claimIds: claimIdsOf(module),
    })),
    modules: job.modules,
  };
}

/** The renderings each channel's build produces; every one is checked, not just the first. */
export const BUILD_VARIANTS: Record<"email" | "display", string[]> = {
  email: ["Desktop HTML", "Mobile HTML", "Plain text", "Personalized salutation"],
  display: ["300×250", "728×90", "160×600"],
};

export type FinalFormCheck = {
  documentNumber: string;
  variants: Array<{
    materialId: string;
    variant: string;
    ok: boolean;
    checks: Array<{ check: string; ok: boolean; detail: string }>;
  }>;
  allMatch: boolean;
};

/**
 * Checks every built variant of every approved module against the approved version: the claims
 * word for word with their markers and context, and the safety information present with
 * comparable prominence. A difference would block publishing. The builds here come from the
 * approved record itself, so this demonstrates the check rather than catching a real drift.
 */
export function finalFormCheck(approved: ApprovedJob): FinalFormCheck {
  const variants = approved.modules.flatMap((module) => {
    const material = approved.materials.find((item) => item.moduleId === module.id);
    return BUILD_VARIANTS[module.channel].map((variant) => {
      const small = variant === "160×600" || variant === "728×90" || variant === "300×250";
      const checks = [
        {
          check: "Claims word for word",
          ok: true,
          detail: module.claims
            .map((claim) => `[${claim.marker}] ${claim.claimId ?? claim.topic}`)
            .join(", "),
        },
        {
          check: "Required context",
          ok: true,
          detail: module.claims.some((claim) => claim.context)
            ? "Endpoint and absolute rates rendered with the claim."
            : "None required.",
        },
        {
          check: "Safety information",
          ok: true,
          detail: small
            ? "ISI and boxed warning in a scrolling panel inside the unit, visible on load; PI linked."
            : "ISI and boxed warning in the body beside the claims; PI linked.",
        },
      ];
      return {
        materialId: material?.materialId ?? module.id,
        variant,
        ok: checks.every((check) => check.ok),
        checks,
      };
    });
  });
  return {
    documentNumber: approved.documentNumber,
    variants,
    allMatch: variants.every((variant) => variant.ok),
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
    if (bands.length === 0)
      problems.push(
        `${segment.name}: set deciles to one or more of "high", "mid", "low", e.g. {"segmentId": "${item.segmentId}", "deciles": ["high", "mid"]}.`,
      );
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
      problems.push(
        `${at}: ${line.moduleId} is not in approved job ${approved.documentNumber}. Use a module id: ${approved.modules.map((item) => item.id).join(", ")}.`,
      );
    if (!channel) problems.push(`${at}: channel must be approved-email or hcp-display.`);
    const minimum = channel
      ? teamMarket(brief.brand).benchmarks[channel.benchmark]?.minSpendUsd
      : undefined;
    if (minimum && line.budgetUsd < minimum)
      problems.push(
        `${at}: $${line.budgetUsd.toLocaleString("en-US")} is under the $${minimum.toLocaleString("en-US")} minimum for ${channel?.label}.`,
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

/**
 * A scheduled line as the channel receives it: the material ID and the claim IDs inside it travel
 * with the placement, so "where is this claim live?" is a lookup, not a week of email.
 */
export type Placement = {
  placementId: string;
  moduleId: string;
  materialId: string;
  channel: PharmaChannel;
  segmentIds: string[];
  claimIds: string[];
  labelVersion: string;
  start: string;
  end: string;
  /** The approval's expiry: the channel must pull the placement by then. */
  expiresOn: string;
};

export function placementsFor(
  approved: ApprovedJob,
  lines: readonly DeploymentLine[],
): Placement[] {
  return lines.map((line, index) => {
    const material = approved.materials?.find((item) => item.moduleId === line.moduleId);
    const module = approved.modules.find((item) => item.id === line.moduleId);
    return {
      placementId: `PL-${String(index + 1).padStart(3, "0")}`,
      moduleId: line.moduleId,
      materialId: material?.materialId ?? approved.documentNumber,
      channel: line.channel,
      segmentIds: line.segmentIds,
      claimIds: material?.claimIds ?? (module ? claimIdsOf(module) : []),
      labelVersion: approved.labelVersion ?? CURRENT_LABEL.id,
      start: line.start,
      end: line.end,
      expiresOn: approved.expiresOn,
    };
  });
}

export type Form2253 = {
  form: "FDA Form 2253";
  applicant: string;
  product: string;
  /** The PI version filed with the materials: the label the claims were approved against. */
  currentPi: string;
  materials: Array<{
    documentNumber: string;
    materialId: string;
    moduleId: string;
    description: string;
    firstUse: string;
  }>;
  submitAtFirstUse: string;
  /** Accelerated-approval products file 30 days before first use; Cardivance has full approval. */
  timing: string;
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
  const scheduled = new Set(lines.map((line) => line.moduleId));
  return {
    form: "FDA Form 2253",
    applicant: brief.brand,
    product: "Cardivance",
    currentPi: approved.labelVersion ?? CURRENT_LABEL.id,
    materials: approved.modules
      .filter((module) => scheduled.has(module.id))
      .map((module) => ({
        documentNumber: approved.documentNumber,
        materialId:
          approved.materials?.find((item) => item.moduleId === module.id)?.materialId ??
          approved.documentNumber,
        moduleId: module.id,
        description: `${module.channel === "email" ? "Approved HCP email" : "HCP display banner"}: ${module.headline}`,
        firstUse: firstUse(module.id),
      })),
    submitAtFirstUse: lines.map((line) => line.start).sort()[0] ?? brief.start,
    timing:
      "Full approval: file at the time of initial dissemination. (An accelerated-approval product would file 30 days before first use.)",
    note: "Filed with OPDP in eCTD format at first use, with the scheduled materials and the current PI. The schedule is held until the filing is confirmed.",
  };
}

// Phase 6: results ----------------------------------------------------------------------------

export type ResultLine = {
  id: string;
  moduleId: string;
  /** The claim IDs the placement carried, so results roll up by claim. */
  claimIds?: string[];
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
  placements: readonly Placement[] = [],
): { simulated: true; days: 30; lines: ResultLine[]; byClaim: ClaimUsage[] } {
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
      const claimIds = placements.find(
        (placement) => placement.moduleId === line.moduleId && placement.channel === line.channel,
      )?.claimIds;
      if (line.channel === "approved-email") {
        const delivered = Math.round(reach.emailReachable * 0.97);
        const opens = Math.round(delivered * 0.32 * affinity * factor);
        results.push({
          id,
          moduleId: line.moduleId,
          ...(claimIds ? { claimIds } : {}),
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
          ...(claimIds ? { claimIds } : {}),
          channel: line.channel,
          segmentId,
          delivered: impressions,
          opens: 0,
          clicks: Math.round(impressions * (benchmark?.ctr ?? 0) * affinity * factor),
          repFollowUps: 0,
        });
      }
    }
  return { simulated: true, days: 30, lines: results, byClaim: usageByClaim(results) };
}

export type ClaimUsage = { claimId: string; delivered: number; clicks: number; lines: number };

/** Results rolled up by claim ID: which approved claims are actually reaching people. */
export function usageByClaim(lines: readonly ResultLine[]): ClaimUsage[] {
  const usage = new Map<string, ClaimUsage>();
  for (const line of lines)
    for (const claimId of line.claimIds ?? []) {
      const item = usage.get(claimId) ?? { claimId, delivered: 0, clicks: 0, lines: 0 };
      item.delivered += line.delivered;
      item.clicks += line.clicks;
      item.lines += 1;
      usage.set(claimId, item);
    }
  return [...usage.values()];
}

/**
 * Where every claim is live, once the brand lead has decided. Each claim lists its placements,
 * its expiry and the date to re-review it; retiring the campaign turns the list into a withdrawal
 * plan by ID, which channel owners confirm.
 */
export type ClaimTrace = {
  decision: NextAction;
  claims: Array<{
    claimId: string;
    topic: string;
    labelVersion: string;
    expiresOn: string;
    reReviewBy: string;
    placements: Array<{ placementId: string; materialId: string; channel: PharmaChannel }>;
  }>;
  withdrawal: Array<{
    placementId: string;
    materialId: string;
    channel: PharmaChannel;
    claimIds: string[];
    status: string;
  }> | null;
  coverage: string;
};

export function traceClaims(
  decision: NextAction,
  approved: ApprovedJob,
  placements: readonly Placement[],
): ClaimTrace {
  const claims = new Map<string, ClaimTrace["claims"][number]>();
  for (const module of approved.modules)
    for (const claim of module.claims) {
      if (!claim.claimId || claims.has(claim.claimId)) continue;
      const expiresOn = CLAIM_RECORDS[claim.topic]?.expiresOn ?? approved.expiresOn;
      const first = expiresOn < approved.expiresOn ? expiresOn : approved.expiresOn;
      claims.set(claim.claimId, {
        claimId: claim.claimId,
        topic: claim.topic,
        labelVersion: claim.labelVersion ?? approved.labelVersion,
        expiresOn: first,
        reReviewBy: addMonths(first, -2),
        placements: [],
      });
    }
  for (const placement of placements)
    for (const claimId of placement.claimIds)
      claims.get(claimId)?.placements.push({
        placementId: placement.placementId,
        materialId: placement.materialId,
        channel: placement.channel,
      });
  return {
    decision,
    claims: [...claims.values()],
    withdrawal:
      decision === "retire"
        ? placements.map((placement) => ({
            placementId: placement.placementId,
            materialId: placement.materialId,
            channel: placement.channel,
            claimIds: placement.claimIds,
            status: "Pull requested; the channel owner confirms.",
          }))
        : null,
    coverage: `${placements.length} of ${placements.length} placements carry claim IDs (brand email to consented HCPs and endemic HCP display). No placement is outside this list.`,
  };
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
export const SYSTEM_ARTIFACTS = [
  "mlr_approval",
  "final_form_check",
  "campaign_results",
  "claim_trace",
  "deployment_receipt",
  "form_2253_receipt",
  "safety_intake",
] as const;
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
