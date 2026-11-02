import {
  type Brand,
  type BriefAttributes,
  type ClaimAttributes,
  type DisclosureAttributes,
  type EvidenceAttributes,
  type GovernedObject,
  type ModuleAttributes,
  type ObjectKind,
  type PlanAttributes,
  type ResultAttributes,
  urnOf,
} from "./types.ts";

const HS: Brand = "Harborstone Wealth";
const CK: Brand = "Coastline Kitchen";
const LT: Brand = "Lumera Therapeutics";
/** Brands whose content is regulated, so classification and ownership default to compliance. */
const regulated = (brand: Brand) => brand === HS || brand === LT;
const CREATED = "2026-10-01T09:00:00.000Z";

type Seed = Partial<GovernedObject> &
  Pick<GovernedObject, "kind" | "title" | "brand" | "attributes"> & { id: string };

function object(seed: Seed): GovernedObject {
  const { id, ...rest } = seed;
  return {
    urn: urnOf(seed.kind as ObjectKind, id),
    version: 1,
    supersedes: null,
    market: "US",
    owner: regulated(seed.brand) ? "compliance" : "marketer",
    approvalState: "approved",
    classification: regulated(seed.brand) ? "regulated" : "internal",
    createdBy: "user:seed",
    createdAt: CREATED,
    updatedAt: CREATED,
    ...rest,
  };
}

const disclosure = (id: string, text: string, short: string, brand: Brand = HS) =>
  object({
    id,
    kind: "disclosure",
    title: short,
    brand,
    attributes: { text, short } satisfies DisclosureAttributes,
  });

const claim = (
  id: string,
  brand: Brand,
  topic: string,
  text: string,
  extra: Partial<GovernedObject> = {},
) =>
  object({
    id,
    kind: "claim",
    title: text.slice(0, 80),
    brand,
    attributes: { text, topic } satisfies ClaimAttributes,
    ...extra,
  });

const evidence = (
  id: string,
  brand: Brand,
  claimId: string,
  source: string,
  asOf: string,
  expiresOn: string,
) =>
  object({
    id,
    kind: "evidence",
    title: source,
    brand,
    attributes: {
      claimUrn: urnOf("claim", claimId),
      source,
      asOf,
      expiresOn,
    } satisfies EvidenceAttributes,
  });

const mod = (
  id: string,
  brand: Brand,
  attributes: ModuleAttributes,
  extra: Partial<GovernedObject> = {},
) => object({ id, kind: "module", title: attributes.headline, brand, attributes, ...extra });

const result = (
  id: string,
  brand: Brand,
  moduleId: string,
  channel: ResultAttributes["channel"],
  sends: number,
  opens: number,
  clicks: number,
) =>
  object({
    id,
    kind: "result",
    title: `${channel} results, October`,
    brand,
    owner: "brand-lead",
    attributes: {
      moduleUrn: urnOf("module", moduleId),
      channel,
      period: "2026-10",
      sends,
      opens,
      clicks,
    } satisfies ResultAttributes,
  });

const claimBlock = (claimId: string, text: string) => ({ text, claimUrn: urnOf("claim", claimId) });
const discBlock = (id: string, text: string) => ({ text, disclosureUrn: urnOf("disclosure", id) });

const NOT_FDIC = "Investments are not FDIC insured, are not bank guaranteed, and may lose value.";
const RATE_ASOF = "Rates are variable and as of the date shown; they may change without notice.";
const SWEEP_V1 = "The Harborstone Sweep Account pays 4.60% APY (as of September 1).";
const SWEEP_V2 = "The Harborstone Sweep Account pays 4.35% APY (as of October 1).";
const FDIC =
  "Sweep balances are held at program banks and are eligible for FDIC insurance up to $250,000 per depositor per bank.";
const FEE_WAIVER =
  "Advisory fees are waived for the first 90 days for new clients with at least $500,000.";
const FOMC = "The Federal Open Market Committee next announces its rate decision on November 5.";
const CHOWDER = "The clam chowder bread bowl is $9.50 at every California location.";
const SOUP = "Soup of the day is served from 11am to close.";

const ISI_CARDIVANCE =
  "Cardivance can cause low blood pressure, high potassium, cough and dizziness. Do not use with ACE inhibitors or with a history of angioedema.";
const BOXED_CARDIVANCE =
  "WARNING: FETAL TOXICITY. When pregnancy is detected, discontinue Cardivance as soon as possible.";
const ISI_GLUCORA =
  "Glucora can cause genital yeast infections, urinary tract infections and dehydration. Rare cases of ketoacidosis have been reported.";
const PI = "Please see full Prescribing Information, including the Boxed Warning where applicable.";
const CARDIVANCE_MORTALITY =
  "Reduced the risk of cardiovascular death or heart failure hospitalization by 20% versus enalapril in HFrEF.";
const CARDIVANCE_SAFETY =
  "The most common adverse reactions were hypotension, hyperkalemia, cough and dizziness.";
const CARDIVANCE_SUPERIOR = "Superior to every ARB for patients with heart failure.";
const CARDIVANCE_HFPEF = "Improves outcomes in heart failure with preserved ejection fraction.";
const GLUCORA_A1C = "Lowered HbA1c by 0.9 percentage points versus placebo at 26 weeks.";
const NEURELVA_DAYS = "Reduced monthly migraine days by 3.1 versus 1.4 on placebo over 12 weeks.";

/** Fictional sample objects for Harborstone Wealth, Coastline Kitchen and Lumera Therapeutics. */
export const SEED_OBJECTS: readonly GovernedObject[] = [
  // Harborstone: regulated content with claims, evidence and disclosures.
  disclosure("hs-disc-not-fdic", NOT_FDIC, "Not FDIC insured. May lose value."),
  disclosure("hs-disc-rate-asof", RATE_ASOF, "Variable rate; as of date shown."),
  claim("hs-sweep-apy-v1", HS, "sweep-apy", SWEEP_V1, { approvalState: "withdrawn" }),
  claim("hs-sweep-apy-v2", HS, "sweep-apy", SWEEP_V2, {
    version: 2,
    supersedes: urnOf("claim", "hs-sweep-apy-v1"),
  }),
  claim("hs-fdic-sweep", HS, "fdic-coverage", FDIC),
  claim("hs-fee-waiver", HS, "fee-waiver", FEE_WAIVER),
  claim("hs-fomc-date", HS, "fomc-date", FOMC),
  evidence(
    "hs-ev-rate-sheet-sep",
    HS,
    "hs-sweep-apy-v1",
    "Treasury rate sheet, September 1",
    "2026-09-01",
    "2026-09-30",
  ),
  evidence(
    "hs-ev-rate-sheet-oct",
    HS,
    "hs-sweep-apy-v2",
    "Treasury rate sheet, October 1",
    "2026-10-01",
    "2027-01-31",
  ),
  evidence(
    "hs-ev-program-banks",
    HS,
    "hs-fdic-sweep",
    "Program bank agreement",
    "2026-07-01",
    "2027-06-30",
  ),
  evidence(
    "hs-ev-fee-schedule",
    HS,
    "hs-fee-waiver",
    "Advisory fee schedule, Q3",
    "2026-07-01",
    "2026-09-30",
  ),
  evidence(
    "hs-ev-fomc-calendar",
    HS,
    "hs-fomc-date",
    "Federal Reserve meeting calendar",
    "2026-01-05",
    "2027-12-31",
  ),
  object({
    id: "hs-q4-rates",
    kind: "content-plan",
    title: "Harborstone Q4 rates and cash plan",
    brand: HS,
    owner: "brand-planner",
    attributes: {
      objective: "Move idle cash into the Sweep Account ahead of the November rate decision.",
      basis: [urnOf("result", "hs-result-sweep-v2"), urnOf("result", "hs-result-fomc-push")],
      waves: [
        {
          id: "w1",
          theme: "Sweep Account rate",
          segment: "sweep-prospects",
          audienceSize: 1800,
          channel: "email",
          sendOn: "2026-11-03",
          moduleCount: 2,
          rationale: "The October rate email out-clicked the email baseline.",
        },
        {
          id: "w2",
          theme: "Rate decision day",
          segment: "cash-heavy-clients",
          audienceSize: 2400,
          channel: "push",
          sendOn: "2026-11-05",
          moduleCount: 1,
          rationale: "The Federal Open Market Committee decides on November 5.",
        },
        {
          id: "w3",
          theme: "New client fee waiver",
          segment: "sweep-prospects",
          audienceSize: 1800,
          channel: "email",
          sendOn: "2026-11-17",
          moduleCount: 1,
          rationale: "Fee waiver converts best two weeks after the rate email.",
        },
      ],
    } satisfies PlanAttributes,
  }),
  object({
    id: "hs-brief-w1",
    kind: "brief",
    title: "Brief: Sweep Account rate, wave 1",
    brand: HS,
    owner: "marketer",
    approvalState: "submitted",
    attributes: {
      planUrn: urnOf("content-plan", "hs-q4-rates"),
      waveId: "w1",
      objective: "Explain the current Sweep Account rate and what backs it.",
    } satisfies BriefAttributes,
  }),
  mod(
    "hs-mod-sweep-rate-email",
    HS,
    {
      headline: "Put idle cash to work",
      channel: "email",
      topics: ["sweep-apy"],
      requiredDisclosures: [urnOf("disclosure", "hs-disc-rate-asof")],
      briefUrn: urnOf("brief", "hs-brief-w1"),
      blocks: [
        { text: "Put idle cash to work." },
        claimBlock("hs-sweep-apy-v1", SWEEP_V1),
        discBlock("hs-disc-rate-asof", RATE_ASOF),
      ],
    },
    { owner: "content-lab" },
  ),
  mod(
    "hs-mod-sweep-rate-v2-email",
    HS,
    {
      headline: "Your cash, working at today's rate",
      channel: "email",
      topics: ["sweep-apy"],
      requiredDisclosures: [urnOf("disclosure", "hs-disc-rate-asof")],
      briefUrn: urnOf("brief", "hs-brief-w1"),
      blocks: [
        { text: "Your cash, working at today's rate." },
        claimBlock("hs-sweep-apy-v2", SWEEP_V2),
        discBlock("hs-disc-rate-asof", RATE_ASOF),
      ],
    },
    { owner: "content-lab" },
  ),
  mod(
    "hs-mod-fdic-explainer-email",
    HS,
    {
      headline: "How sweep balances are protected",
      channel: "email",
      topics: ["fdic-coverage"],
      requiredDisclosures: [urnOf("disclosure", "hs-disc-not-fdic")],
      blocks: [claimBlock("hs-fdic-sweep", FDIC), discBlock("hs-disc-not-fdic", NOT_FDIC)],
    },
    { approvalState: "in_review", owner: "content-lab" },
  ),
  mod(
    "hs-mod-fee-waiver-email",
    HS,
    {
      headline: "Start with 90 days of no advisory fees",
      channel: "email",
      topics: ["fee-waiver"],
      requiredDisclosures: [urnOf("disclosure", "hs-disc-not-fdic")],
      blocks: [claimBlock("hs-fee-waiver", FEE_WAIVER)],
    },
    { approvalState: "draft", owner: "content-lab" },
  ),
  mod(
    "hs-mod-fomc-push",
    HS,
    {
      headline: "Rate decision day",
      channel: "push",
      topics: ["fomc-date"],
      requiredDisclosures: [],
      blocks: [claimBlock("hs-fomc-date", FOMC)],
    },
    { owner: "content-lab" },
  ),
  result("hs-result-sweep-v2", HS, "hs-mod-sweep-rate-v2-email", "email", 1800, 810, 126),
  result("hs-result-fomc-push", HS, "hs-mod-fomc-push", "push", 2400, 960, 72),

  // Coastline Kitchen: weather- and menu-driven sends with a performance loop.
  claim("ck-chowder-price", CK, "chowder-price", CHOWDER),
  claim("ck-soup-hours", CK, "soup-hours", SOUP),
  evidence(
    "ck-ev-menu-board",
    CK,
    "ck-chowder-price",
    "Menu board export, October",
    "2026-10-01",
    "2027-03-31",
  ),
  evidence(
    "ck-ev-soup-hours",
    CK,
    "ck-soup-hours",
    "Store operations hours sheet",
    "2026-09-15",
    "2027-03-31",
  ),
  object({
    id: "ck-q4-weather",
    kind: "content-plan",
    title: "Coastline Q4 cold-weather plan",
    brand: CK,
    owner: "brand-planner",
    attributes: {
      objective: "Lift soup and bread-bowl orders on the coldest days of the fall.",
      basis: [urnOf("result", "ck-result-chowder-push"), urnOf("result", "ck-result-soup-email")],
      waves: [
        {
          id: "w1",
          theme: "Chowder on a cold day",
          segment: "app-near-san-francisco",
          audienceSize: 5200,
          channel: "push",
          sendOn: "2026-11-09",
          moduleCount: 1,
          rationale: "The October chowder push earned 1.7 times the push baseline.",
        },
        {
          id: "w2",
          theme: "Soup of the day",
          segment: "email-loyalty",
          audienceSize: 4000,
          channel: "email",
          sendOn: "2026-11-12",
          moduleCount: 1,
          rationale: "Soup email lagged the baseline and needs a new angle.",
        },
      ],
    } satisfies PlanAttributes,
  }),
  mod(
    "ck-mod-chowder-push",
    CK,
    {
      headline: "Bowl up",
      channel: "push",
      topics: ["chowder-price"],
      requiredDisclosures: [],
      blocks: [claimBlock("ck-chowder-price", CHOWDER)],
    },
    { owner: "content-lab" },
  ),
  mod(
    "ck-mod-soup-email",
    CK,
    {
      headline: "Soup weather is here",
      channel: "email",
      topics: ["soup-hours"],
      requiredDisclosures: [],
      blocks: [{ text: "Soup weather is here." }, claimBlock("ck-soup-hours", SOUP)],
    },
    { owner: "content-lab" },
  ),
  result("ck-result-chowder-push", CK, "ck-mod-chowder-push", "push", 5200, 2340, 312),
  result("ck-result-soup-email", CK, "ck-mod-soup-email", "email", 4000, 1280, 90),

  // Lumera Therapeutics: pharmaceutical content. Claims need trial evidence, a label, and MLR.
  disclosure(
    "lt-disc-isi-cardivance",
    ISI_CARDIVANCE,
    "Cardivance important safety information.",
    LT,
  ),
  disclosure("lt-disc-boxed-cardivance", BOXED_CARDIVANCE, "Boxed warning: fetal toxicity.", LT),
  disclosure("lt-disc-isi-glucora", ISI_GLUCORA, "Glucora important safety information.", LT),
  disclosure("lt-disc-pi", PI, "See full Prescribing Information.", LT),
  claim("lt-cardivance-mortality", LT, "cardivance-mortality", CARDIVANCE_MORTALITY),
  claim("lt-cardivance-safety", LT, "cardivance-safety", CARDIVANCE_SAFETY),
  claim("lt-cardivance-superior", LT, "cardivance-superior", CARDIVANCE_SUPERIOR, {
    approvalState: "rejected",
  }),
  claim("lt-cardivance-hfpef", LT, "cardivance-hfpef", CARDIVANCE_HFPEF, {
    approvalState: "draft",
  }),
  claim("lt-glucora-a1c", LT, "glucora-a1c", GLUCORA_A1C),
  claim("lt-neurelva-days", LT, "neurelva-days", NEURELVA_DAYS),
  evidence(
    "lt-ev-cardio-hf",
    LT,
    "lt-cardivance-mortality",
    "CARDIO-HF clinical study report",
    "2025-11-01",
    "2028-12-31",
  ),
  evidence(
    "lt-ev-cardio-hf-safety",
    LT,
    "lt-cardivance-safety",
    "Cardivance prescribing information, section 6",
    "2026-03-01",
    "2028-03-01",
  ),
  evidence(
    "lt-ev-gluco-control",
    LT,
    "lt-glucora-a1c",
    "GLUCO-CONTROL clinical study report",
    "2025-06-15",
    "2026-10-15",
  ),
  evidence(
    "lt-ev-migra-prevent",
    LT,
    "lt-neurelva-days",
    "MIGRA-PREVENT clinical study report",
    "2026-02-10",
    "2028-02-10",
  ),
  object({
    id: "lt-q4-hcp",
    kind: "content-plan",
    title: "Lumera Q4 HCP engagement plan",
    brand: LT,
    owner: "brand-planner",
    attributes: {
      objective: "Reach opted-in prescribers with supported, on-label claims where access allows.",
      basis: [
        urnOf("result", "lt-result-cardivance-email"),
        urnOf("result", "lt-result-glucora-email"),
      ],
      waves: [
        {
          id: "w1",
          theme: "Cardivance outcomes at the heart failure meeting",
          segment: "cardiology-prescribers",
          audienceSize: 410,
          channel: "email",
          sendOn: "2026-11-10",
          moduleCount: 1,
          rationale: "The outcomes email ran at 1.5 times the HCP email baseline.",
        },
        {
          id: "w2",
          theme: "Glucora HbA1c data",
          segment: "endocrinology-prescribers",
          audienceSize: 280,
          channel: "email",
          sendOn: "2026-11-17",
          moduleCount: 1,
          rationale:
            "The last Glucora email under-performed, and the study report behind its claim has lapsed.",
        },
        {
          id: "w3",
          theme: "Neurelva launch data in the HCP app",
          segment: "neurology-prescribers",
          audienceSize: 190,
          channel: "push",
          sendOn: "2026-11-24",
          moduleCount: 1,
          rationale: "Neurology prescribers opted in to the app more than to email.",
        },
      ],
    } satisfies PlanAttributes,
  }),
  object({
    id: "lt-brief-w1",
    kind: "brief",
    title: "Brief: Cardivance outcomes, wave 1",
    brand: LT,
    owner: "marketer",
    approvalState: "submitted",
    attributes: {
      planUrn: urnOf("content-plan", "lt-q4-hcp"),
      waveId: "w1",
      objective: "Present the CARDIO-HF result to cardiology prescribers, with safety alongside.",
    } satisfies BriefAttributes,
  }),
  mod(
    "lt-mod-cardivance-outcomes-email",
    LT,
    {
      headline: "CARDIO-HF: outcomes in HFrEF",
      channel: "email",
      topics: ["cardivance-mortality", "cardivance-safety"],
      requiredDisclosures: [
        urnOf("disclosure", "lt-disc-isi-cardivance"),
        urnOf("disclosure", "lt-disc-boxed-cardivance"),
        urnOf("disclosure", "lt-disc-pi"),
      ],
      briefUrn: urnOf("brief", "lt-brief-w1"),
      blocks: [
        claimBlock("lt-cardivance-mortality", CARDIVANCE_MORTALITY),
        claimBlock("lt-cardivance-safety", CARDIVANCE_SAFETY),
        discBlock("lt-disc-isi-cardivance", ISI_CARDIVANCE),
        discBlock("lt-disc-boxed-cardivance", BOXED_CARDIVANCE),
        discBlock("lt-disc-pi", PI),
      ],
    },
    { owner: "content-lab" },
  ),
  mod(
    "lt-mod-cardivance-superior-email",
    LT,
    {
      headline: "Cardivance versus every ARB",
      channel: "email",
      topics: ["cardivance-superior"],
      requiredDisclosures: [urnOf("disclosure", "lt-disc-isi-cardivance")],
      blocks: [claimBlock("lt-cardivance-superior", CARDIVANCE_SUPERIOR)],
    },
    { approvalState: "draft", owner: "content-lab" },
  ),
  mod(
    "lt-mod-glucora-a1c-email",
    LT,
    {
      headline: "Glucora and HbA1c control",
      channel: "email",
      topics: ["glucora-a1c"],
      requiredDisclosures: [
        urnOf("disclosure", "lt-disc-isi-glucora"),
        urnOf("disclosure", "lt-disc-pi"),
      ],
      blocks: [
        claimBlock("lt-glucora-a1c", GLUCORA_A1C),
        discBlock("lt-disc-isi-glucora", ISI_GLUCORA),
        discBlock("lt-disc-pi", PI),
      ],
    },
    { owner: "content-lab" },
  ),
  mod(
    "lt-mod-neurelva-days-push",
    LT,
    {
      headline: "Neurelva: fewer migraine days",
      channel: "push",
      topics: ["neurelva-days"],
      requiredDisclosures: [urnOf("disclosure", "lt-disc-pi")],
      blocks: [claimBlock("lt-neurelva-days", NEURELVA_DAYS), discBlock("lt-disc-pi", PI)],
    },
    { owner: "content-lab" },
  ),
  result(
    "lt-result-cardivance-email",
    LT,
    "lt-mod-cardivance-outcomes-email",
    "email",
    3200,
    1500,
    288,
  ),
  result("lt-result-glucora-email", LT, "lt-mod-glucora-a1c-email", "email", 1800, 640, 63),
  result("lt-result-neurelva-push", LT, "lt-mod-neurelva-days-push", "push", 900, 340, 36),
];

/** Fictional send and market calendar the plan agent reads. */
export const CALENDAR: Record<Brand, ReadonlyArray<{ date: string; label: string }>> = {
  "Harborstone Wealth": [
    { date: "2026-11-05", label: "Federal Open Market Committee rate decision" },
    { date: "2026-12-16", label: "Federal Open Market Committee rate decision" },
  ],
  "Coastline Kitchen": [
    { date: "2026-11-09", label: "Cold front forecast for the Bay Area" },
    { date: "2026-11-26", label: "Thanksgiving" },
  ],
  "Lumera Therapeutics": [
    { date: "2026-11-10", label: "Annual heart failure congress" },
    { date: "2026-11-18", label: "Cascade University P&T review" },
  ],
};

/** Typical response rates by channel, from past sends, used as baselines. */
export const CHANNEL_BASELINE = {
  email: { open: 0.42, click: 0.06 },
  push: { open: 0.4, click: 0.035 },
  sms: { open: 0.9, click: 0.05 },
} as const;
