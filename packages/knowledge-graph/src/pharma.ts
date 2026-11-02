/**
 * Lumera Therapeutics: a fictional pharmaceutical brand under Northstar, for the life-sciences use
 * cases. Everything here is invented, including the drugs, trials and results. Promotional content
 * is only usable when its clinical claims are supported by a trial, consistent with the approved
 * label, and carried under a current medical-legal-regulatory (MLR) approval with the safety
 * information it must ship with. Audiences are groups of prescribers at hospitals, never people.
 */

export const LUMERA = {
  id: "brand-lumera",
  name: "Lumera Therapeutics",
  voice:
    "Precise, balanced and clinical: state what the data show for the labeled population, never imply more, and keep safety next to benefit.",
} as const;

/** Checks every promotional asset passes before MLR approves it. */
export const LUMERA_RULES = [
  "Fair balance (benefit and risk together)",
  "Claims consistent with the approved label",
  "Claims supported by substantial evidence",
  "Required safety information present",
] as const;
export const LUMERA_RULE = {
  fairBalance: LUMERA_RULES[0],
  label: LUMERA_RULES[1],
  evidence: LUMERA_RULES[2],
  safety: LUMERA_RULES[3],
} as const;

export const PHARMA_DISCLOSURES = {
  "isi-cardivance": {
    name: "Cardivance important safety information",
    text: "Cardivance can cause low blood pressure, high potassium, cough and dizziness. Do not use with ACE inhibitors or if you have a history of angioedema.",
  },
  "boxed-cardivance": {
    name: "Cardivance boxed warning",
    text: "WARNING: FETAL TOXICITY. When pregnancy is detected, discontinue Cardivance as soon as possible. Drugs that act on the renin-angiotensin system can cause injury and death to the developing fetus.",
  },
  "isi-glucora": {
    name: "Glucora important safety information",
    text: "Glucora can cause genital yeast infections, urinary tract infections and dehydration. Rare cases of ketoacidosis have been reported.",
  },
  "isi-neurelva": {
    name: "Neurelva important safety information",
    text: "Neurelva can cause injection-site reactions and constipation. Serious hypersensitivity reactions have been reported.",
  },
  "prescribing-information": {
    name: "Full prescribing information",
    text: "Please see full Prescribing Information, including the Boxed Warning where applicable.",
  },
  "adverse-events": {
    name: "Adverse event reporting",
    text: "Report suspected adverse reactions to Lumera Therapeutics at 1-800-555-0142 or to FDA at 1-800-FDA-1088.",
  },
} as const;
export type PharmaDisclosureKey = keyof typeof PHARMA_DISCLOSURES;
export const pharmaDisclosureId = (key: PharmaDisclosureKey) => `disclosure-${key}`;

export const DRUGS = {
  cardivance: {
    name: "Cardivance",
    generic: "sacurtan",
    drugClass: "Angiotensin receptor-neprilysin inhibitor",
    boxedWarning: true,
  },
  glucora: {
    name: "Glucora",
    generic: "glifloxin",
    drugClass: "SGLT2 inhibitor",
    boxedWarning: false,
  },
  neurelva: {
    name: "Neurelva",
    generic: "neurelumab",
    drugClass: "CGRP receptor antagonist",
    boxedWarning: false,
  },
} as const;
export type DrugKey = keyof typeof DRUGS;
export const DRUG_KEYS = Object.keys(DRUGS) as [DrugKey, ...DrugKey[]];
export const drugId = (key: DrugKey) => `drug-${key}`;
export const DRUG_IDS = DRUG_KEYS.map(drugId) as [string, ...string[]];

export const INDICATIONS = {
  hfref: "Heart failure with reduced ejection fraction",
  hfpef: "Heart failure with preserved ejection fraction",
  t2dm: "Type 2 diabetes",
  "chronic-migraine": "Chronic migraine (prevention)",
} as const;
export type IndicationKey = keyof typeof INDICATIONS;
export const indicationId = (key: IndicationKey) => `indication-${key}`;

/** The approved label: which indication each drug is labeled for, and which it is only studied in. */
export const LABELED: ReadonlyArray<readonly [DrugKey, IndicationKey, number]> = [
  ["cardivance", "hfref", 2021],
  ["glucora", "t2dm", 2019],
  ["neurelva", "chronic-migraine", 2023],
];
export const INVESTIGATIONAL: ReadonlyArray<readonly [DrugKey, IndicationKey, string]> = [
  ["cardivance", "hfpef", "Phase 3, results pending"],
];

export const SPECIALTIES = {
  cardiology: { name: "Cardiology", treats: ["hfref", "hfpef"] },
  endocrinology: { name: "Endocrinology", treats: ["t2dm"] },
  neurology: { name: "Neurology", treats: ["chronic-migraine"] },
  "primary-care": { name: "Primary care", treats: ["t2dm", "hfref"] },
} as const satisfies Record<string, { name: string; treats: readonly IndicationKey[] }>;
export type SpecialtyKey = keyof typeof SPECIALTIES;
export const specialtyId = (key: SpecialtyKey) => `specialty-${key}`;

export type TrialStatus = "Completed" | "Ongoing";
export const TRIALS = {
  "cardio-hf": {
    name: "CARDIO-HF",
    drug: "cardivance",
    indication: "hfref",
    phase: "Phase 3",
    enrollment: 8442,
    status: "Completed" as TrialStatus,
    endpoint: "Cardiovascular death or heart failure hospitalization",
    result: "20% relative risk reduction versus enalapril (HR 0.80, 95% CI 0.73 to 0.87)",
  },
  "cardio-preserve": {
    name: "CARDIO-PRESERVE",
    drug: "cardivance",
    indication: "hfpef",
    phase: "Phase 3",
    enrollment: 4822,
    status: "Ongoing" as TrialStatus,
    endpoint: "Total heart failure events and cardiovascular death",
    result: "Results pending",
  },
  "gluco-control": {
    name: "GLUCO-CONTROL",
    drug: "glucora",
    indication: "t2dm",
    phase: "Phase 3",
    enrollment: 3120,
    status: "Completed" as TrialStatus,
    endpoint: "Change in HbA1c at 26 weeks",
    result: "HbA1c reduced by 0.9 percentage points versus placebo; weight reduced by up to 3.4 kg",
  },
  "migra-prevent": {
    name: "MIGRA-PREVENT",
    drug: "neurelva",
    indication: "chronic-migraine",
    phase: "Phase 3",
    enrollment: 1856,
    status: "Completed" as TrialStatus,
    endpoint: "Change in monthly migraine days over 12 weeks",
    result: "3.1 fewer monthly migraine days versus 1.4 fewer on placebo",
  },
} as const;
export type TrialKey = keyof typeof TRIALS;
export const trialId = (key: TrialKey) => `trial-${key}`;

export type ClaimType = "efficacy" | "safety" | "comparative" | "dosing";
export type Claim = {
  id: string;
  text: string;
  drug: DrugKey;
  indication: IndicationKey;
  type: ClaimType;
  /** The trial that supports it, if any. A claim with none is unsupported. */
  trial?: TrialKey;
};
export const CLAIMS: readonly Claim[] = [
  {
    id: "claim-cardivance-mortality",
    text: "Reduced the risk of cardiovascular death or heart failure hospitalization by 20% versus enalapril in HFrEF.",
    drug: "cardivance",
    indication: "hfref",
    type: "efficacy",
    trial: "cardio-hf",
  },
  {
    id: "claim-cardivance-safety",
    text: "The most common adverse reactions were hypotension, hyperkalemia, cough and dizziness.",
    drug: "cardivance",
    indication: "hfref",
    type: "safety",
    trial: "cardio-hf",
  },
  {
    id: "claim-cardivance-superior",
    text: "Superior to every ARB for patients with heart failure.",
    drug: "cardivance",
    indication: "hfref",
    type: "comparative",
  },
  {
    id: "claim-cardivance-hfpef",
    text: "Improves outcomes in heart failure with preserved ejection fraction.",
    drug: "cardivance",
    indication: "hfpef",
    type: "efficacy",
    trial: "cardio-preserve",
  },
  {
    id: "claim-glucora-a1c",
    text: "Lowered HbA1c by 0.9 percentage points versus placebo at 26 weeks.",
    drug: "glucora",
    indication: "t2dm",
    type: "efficacy",
    trial: "gluco-control",
  },
  {
    id: "claim-glucora-weight",
    text: "Patients lost up to 3.4 kg while lowering HbA1c.",
    drug: "glucora",
    indication: "t2dm",
    type: "efficacy",
    trial: "gluco-control",
  },
  {
    id: "claim-neurelva-days",
    text: "Reduced monthly migraine days by 3.1 versus 1.4 on placebo over 12 weeks.",
    drug: "neurelva",
    indication: "chronic-migraine",
    type: "efficacy",
    trial: "migra-prevent",
  },
  {
    id: "claim-neurelva-dosing",
    text: "One self-injection a month.",
    drug: "neurelva",
    indication: "chronic-migraine",
    type: "dosing",
  },
];

export type PharmaApproval = {
  id: string;
  status: "Approved" | "Expired" | "Pending";
  approvedOn?: string;
  expiresOn?: string;
};
export type PharmaAsset = {
  id: string;
  name: string;
  kind: string;
  channel: "email" | "portal" | "rep";
  drug: DrugKey;
  campaign: string;
  claims: readonly string[];
  disclosures: readonly PharmaDisclosureKey[];
  approval: PharmaApproval;
  failed?: (typeof LUMERA_RULES)[number];
  /** Content that supports a formulary or Pharmacy and Therapeutics (P&T) review. */
  access?: boolean;
};
const CARDIVANCE_SAFETY: PharmaDisclosureKey[] = [
  "isi-cardivance",
  "boxed-cardivance",
  "prescribing-information",
  "adverse-events",
];
export const PHARMA_ASSETS: readonly PharmaAsset[] = [
  {
    id: "asset-cardivance-outcomes-email",
    name: "Cardivance HFrEF outcomes email",
    kind: "HCP email",
    channel: "email",
    drug: "cardivance",
    campaign: "campaign-cardivance-refresh",
    claims: ["claim-cardivance-mortality", "claim-cardivance-safety"],
    disclosures: CARDIVANCE_SAFETY,
    approval: {
      id: "MLR-2026-0412",
      status: "Approved",
      approvedOn: "2026-06-12",
      expiresOn: "2027-06-12",
    },
  },
  {
    id: "asset-cardivance-detail-aid",
    name: "Cardivance rep detail aid",
    kind: "Detail aid",
    channel: "rep",
    drug: "cardivance",
    campaign: "campaign-cardivance-refresh",
    claims: ["claim-cardivance-mortality", "claim-cardivance-safety"],
    disclosures: CARDIVANCE_SAFETY,
    approval: {
      id: "MLR-2026-0413",
      status: "Approved",
      approvedOn: "2026-06-12",
      expiresOn: "2027-06-12",
    },
  },
  {
    id: "asset-cardivance-superiority-email",
    name: "Cardivance “superior to ARBs” email",
    kind: "HCP email",
    channel: "email",
    drug: "cardivance",
    campaign: "campaign-cardivance-refresh",
    claims: ["claim-cardivance-superior"],
    disclosures: ["isi-cardivance", "prescribing-information"],
    approval: { id: "MLR-2026-0577", status: "Pending" },
    failed: LUMERA_RULE.evidence,
  },
  {
    id: "asset-cardivance-hfpef-aid",
    name: "Cardivance HFpEF detail aid",
    kind: "Detail aid",
    channel: "rep",
    drug: "cardivance",
    campaign: "campaign-cardivance-refresh",
    claims: ["claim-cardivance-hfpef"],
    disclosures: ["isi-cardivance", "prescribing-information"],
    approval: { id: "MLR-2026-0590", status: "Pending" },
    failed: LUMERA_RULE.label,
  },
  {
    id: "asset-cardivance-value-dossier",
    name: "Cardivance formulary value dossier",
    kind: "Dossier",
    channel: "portal",
    drug: "cardivance",
    campaign: "campaign-cardivance-refresh",
    claims: ["claim-cardivance-mortality"],
    disclosures: ["boxed-cardivance", "prescribing-information"],
    approval: {
      id: "MLR-2026-0420",
      status: "Approved",
      approvedOn: "2026-06-20",
      expiresOn: "2027-06-20",
    },
    access: true,
  },
  {
    id: "asset-glucora-a1c-email",
    name: "Glucora HbA1c efficacy email",
    kind: "HCP email",
    channel: "email",
    drug: "glucora",
    campaign: "campaign-glucora-q4",
    claims: ["claim-glucora-a1c"],
    disclosures: ["isi-glucora", "prescribing-information", "adverse-events"],
    approval: {
      id: "MLR-2026-0301",
      status: "Approved",
      approvedOn: "2026-04-02",
      expiresOn: "2027-04-02",
    },
  },
  {
    id: "asset-glucora-weight-email",
    name: "Glucora weight and HbA1c email",
    kind: "HCP email",
    channel: "email",
    drug: "glucora",
    campaign: "campaign-glucora-q4",
    claims: ["claim-glucora-weight", "claim-glucora-a1c"],
    disclosures: ["isi-glucora", "prescribing-information"],
    approval: {
      id: "MLR-2025-0988",
      status: "Expired",
      approvedOn: "2025-09-30",
      expiresOn: "2026-09-30",
    },
  },
  {
    id: "asset-glucora-value-dossier",
    name: "Glucora formulary value dossier",
    kind: "Dossier",
    channel: "portal",
    drug: "glucora",
    campaign: "campaign-glucora-q4",
    claims: ["claim-glucora-a1c"],
    disclosures: ["prescribing-information"],
    approval: {
      id: "MLR-2026-0305",
      status: "Approved",
      approvedOn: "2026-04-10",
      expiresOn: "2027-04-10",
    },
    access: true,
  },
  {
    id: "asset-neurelva-days-email",
    name: "Neurelva migraine-days email",
    kind: "HCP email",
    channel: "email",
    drug: "neurelva",
    campaign: "campaign-neurelva-launch",
    claims: ["claim-neurelva-days", "claim-neurelva-dosing"],
    disclosures: ["isi-neurelva", "prescribing-information", "adverse-events"],
    approval: {
      id: "MLR-2026-0488",
      status: "Approved",
      approvedOn: "2026-07-15",
      expiresOn: "2027-07-15",
    },
  },
  {
    id: "asset-neurelva-portal-module",
    name: "Neurelva clinical data module",
    kind: "Portal module",
    channel: "portal",
    drug: "neurelva",
    campaign: "campaign-neurelva-launch",
    claims: ["claim-neurelva-days"],
    disclosures: ["isi-neurelva", "prescribing-information"],
    approval: {
      id: "MLR-2026-0489",
      status: "Approved",
      approvedOn: "2026-07-15",
      expiresOn: "2027-07-15",
    },
  },
  {
    id: "asset-neurelva-value-dossier",
    name: "Neurelva formulary value dossier",
    kind: "Dossier",
    channel: "portal",
    drug: "neurelva",
    campaign: "campaign-neurelva-launch",
    claims: ["claim-neurelva-days"],
    disclosures: ["prescribing-information"],
    approval: { id: "MLR-2026-0495", status: "Pending" },
    access: true,
  },
];

export const PHARMA_CAMPAIGNS = [
  { id: "campaign-cardivance-refresh", name: "Cardivance HFrEF refresh", status: "Active" },
  { id: "campaign-glucora-q4", name: "Glucora Q4 efficacy push", status: "Active" },
  { id: "campaign-neurelva-launch", name: "Neurelva launch", status: "Planning" },
] as const;

/** HCP promotional consent scopes, one per channel. */
export const HCP_CONSENT = [
  { id: "consent-hcp-email-promotional", channel: "email", purpose: "promotional" },
  { id: "consent-hcp-portal-promotional", channel: "portal", purpose: "promotional" },
  { id: "consent-hcp-rep-promotional", channel: "rep", purpose: "promotional" },
] as const;

export const PHARMA_CHANNELS = [
  { id: "channel-portal", name: "HCP portal" },
  { id: "channel-rep", name: "Rep visit" },
] as const;

export type FormularyStatus =
  | "Preferred"
  | "Covered"
  | "Prior authorization"
  | "Under P&T review"
  | "Not on formulary";
export const FORMULARY_ACCESS: Record<FormularyStatus, number> = {
  Preferred: 1,
  Covered: 0.8,
  "Prior authorization": 0.5,
  "Under P&T review": 0.4,
  "Not on formulary": 0.1,
};

type HospitalSeed = {
  id: string;
  name: string;
  hospitalType: string;
  region: string;
  beds: number;
  patients: Partial<Record<IndicationKey, number>>;
  formulary: Partial<Record<DrugKey, readonly [FormularyStatus, number?]>>;
};
export const HOSPITALS: readonly HospitalSeed[] = [
  {
    id: "hospital-st-brigid",
    name: "St. Brigid Medical Center",
    hospitalType: "Academic medical center",
    region: "Northeast",
    beds: 780,
    patients: { hfref: 2400, hfpef: 1800, t2dm: 6100, "chronic-migraine": 900 },
    formulary: {
      cardivance: ["Under P&T review", 21],
      glucora: ["Preferred"],
      neurelva: ["Covered"],
    },
  },
  {
    id: "hospital-lakeshore",
    name: "Lakeshore Health System",
    hospitalType: "Integrated delivery network",
    region: "Midwest",
    beds: 1320,
    patients: { hfref: 3900, hfpef: 2700, t2dm: 9800, "chronic-migraine": 1500 },
    formulary: {
      cardivance: ["Preferred"],
      glucora: ["Prior authorization"],
      neurelva: ["Not on formulary"],
    },
  },
  {
    id: "hospital-mesa-verde",
    name: "Mesa Verde Regional Hospital",
    hospitalType: "Regional hospital",
    region: "Southwest",
    beds: 410,
    patients: { hfref: 1100, hfpef: 800, t2dm: 3300, "chronic-migraine": 540 },
    formulary: {
      cardivance: ["Not on formulary"],
      glucora: ["Covered"],
      neurelva: ["Under P&T review", 45],
    },
  },
  {
    id: "hospital-cascade",
    name: "Cascade University Hospital",
    hospitalType: "Academic medical center",
    region: "Northwest",
    beds: 920,
    patients: { hfref: 2800, hfpef: 2000, t2dm: 7200, "chronic-migraine": 1300 },
    formulary: { cardivance: ["Covered"], glucora: ["Preferred"], neurelva: ["Preferred"] },
  },
  {
    id: "hospital-pinecrest",
    name: "Pinecrest Community Hospital",
    hospitalType: "Community hospital",
    region: "Southeast",
    beds: 260,
    patients: { hfref: 640, hfpef: 420, t2dm: 2100, "chronic-migraine": 310 },
    formulary: {
      cardivance: ["Prior authorization"],
      glucora: ["Covered"],
      neurelva: ["Not on formulary"],
    },
  },
  {
    id: "hospital-gulf-coast-heart",
    name: "Gulf Coast Heart Institute",
    hospitalType: "Specialty cardiac hospital",
    region: "South",
    beds: 340,
    patients: { hfref: 4600, hfpef: 3100 },
    formulary: { cardivance: ["Preferred"] },
  },
  {
    id: "hospital-heartland",
    name: "Heartland Medical Group",
    hospitalType: "Multispecialty group",
    region: "Midwest",
    beds: 520,
    patients: { hfref: 1500, hfpef: 1000, t2dm: 5200, "chronic-migraine": 760 },
    formulary: { cardivance: ["Covered"], glucora: ["Not on formulary"], neurelva: ["Covered"] },
  },
  {
    id: "hospital-harbor-view",
    name: "Harbor View Medical Center",
    hospitalType: "Regional hospital",
    region: "West",
    beds: 480,
    patients: { hfref: 1300, hfpef: 900, t2dm: 4100, "chronic-migraine": 650 },
    formulary: {
      cardivance: ["Under P&T review", 14],
      glucora: ["Preferred"],
      neurelva: ["Prior authorization"],
    },
  },
];
export const HOSPITAL_NAMES = HOSPITALS.map((hospital) => hospital.name) as [string, ...string[]];

export type GroupSeed = {
  hospital: string;
  specialty: SpecialtyKey;
  prescribers: number;
  decile: number;
  /** Lumera's share of the class, per drug. */
  share: Partial<Record<DrugKey, number>>;
  /** Prescribers opted in to promotional contact, per channel. */
  consent: Record<"email" | "portal" | "rep", number>;
  /** Assets the group has engaged with: [asset id, count, last days ago]. */
  engaged: ReadonlyArray<readonly [string, number, number]>;
};
const groupId = (hospital: string, specialty: SpecialtyKey) =>
  `group-${hospital.replace("hospital-", "")}-${specialty}`;
export const PRESCRIBER_GROUPS: readonly GroupSeed[] = [
  {
    hospital: "hospital-st-brigid",
    specialty: "cardiology",
    prescribers: 46,
    decile: 9,
    share: { cardivance: 0.06 },
    consent: { email: 38, portal: 29, rep: 31 },
    engaged: [
      ["asset-cardivance-outcomes-email", 61, 4],
      ["asset-cardivance-detail-aid", 12, 18],
    ],
  },
  {
    hospital: "hospital-st-brigid",
    specialty: "endocrinology",
    prescribers: 28,
    decile: 8,
    share: { glucora: 0.21 },
    consent: { email: 22, portal: 14, rep: 19 },
    engaged: [["asset-glucora-a1c-email", 34, 9]],
  },
  {
    hospital: "hospital-lakeshore",
    specialty: "cardiology",
    prescribers: 72,
    decile: 10,
    share: { cardivance: 0.31 },
    consent: { email: 61, portal: 44, rep: 48 },
    engaged: [["asset-cardivance-outcomes-email", 88, 2]],
  },
  {
    hospital: "hospital-lakeshore",
    specialty: "neurology",
    prescribers: 33,
    decile: 7,
    share: { neurelva: 0.04 },
    consent: { email: 24, portal: 12, rep: 20 },
    engaged: [["asset-neurelva-days-email", 19, 11]],
  },
  {
    hospital: "hospital-lakeshore",
    specialty: "primary-care",
    prescribers: 210,
    decile: 5,
    share: { glucora: 0.09, cardivance: 0.05 },
    consent: { email: 140, portal: 66, rep: 52 },
    engaged: [["asset-glucora-a1c-email", 41, 7]],
  },
  {
    hospital: "hospital-mesa-verde",
    specialty: "cardiology",
    prescribers: 15,
    decile: 6,
    share: { cardivance: 0.02 },
    consent: { email: 11, portal: 5, rep: 9 },
    engaged: [],
  },
  {
    hospital: "hospital-mesa-verde",
    specialty: "neurology",
    prescribers: 9,
    decile: 5,
    share: { neurelva: 0.01 },
    consent: { email: 6, portal: 2, rep: 4 },
    engaged: [["asset-neurelva-days-email", 5, 30]],
  },
  {
    hospital: "hospital-cascade",
    specialty: "cardiology",
    prescribers: 52,
    decile: 9,
    share: { cardivance: 0.18 },
    consent: { email: 44, portal: 36, rep: 40 },
    engaged: [
      ["asset-cardivance-outcomes-email", 47, 6],
      ["asset-cardivance-value-dossier", 8, 25],
    ],
  },
  {
    hospital: "hospital-cascade",
    specialty: "endocrinology",
    prescribers: 31,
    decile: 8,
    share: { glucora: 0.27 },
    consent: { email: 25, portal: 21, rep: 22 },
    engaged: [["asset-glucora-a1c-email", 52, 3]],
  },
  {
    hospital: "hospital-cascade",
    specialty: "neurology",
    prescribers: 29,
    decile: 8,
    share: { neurelva: 0.22 },
    consent: { email: 23, portal: 19, rep: 20 },
    engaged: [["asset-neurelva-portal-module", 27, 8]],
  },
  {
    hospital: "hospital-pinecrest",
    specialty: "primary-care",
    prescribers: 64,
    decile: 4,
    share: { glucora: 0.07, cardivance: 0.02 },
    consent: { email: 35, portal: 9, rep: 18 },
    engaged: [],
  },
  {
    hospital: "hospital-gulf-coast-heart",
    specialty: "cardiology",
    prescribers: 88,
    decile: 10,
    share: { cardivance: 0.36 },
    consent: { email: 71, portal: 58, rep: 66 },
    engaged: [
      ["asset-cardivance-outcomes-email", 102, 1],
      ["asset-cardivance-detail-aid", 40, 5],
    ],
  },
  {
    hospital: "hospital-heartland",
    specialty: "cardiology",
    prescribers: 38,
    decile: 7,
    share: { cardivance: 0.11 },
    consent: { email: 30, portal: 16, rep: 24 },
    engaged: [["asset-cardivance-outcomes-email", 22, 12]],
  },
  {
    hospital: "hospital-heartland",
    specialty: "endocrinology",
    prescribers: 24,
    decile: 7,
    share: { glucora: 0.03 },
    consent: { email: 17, portal: 8, rep: 13 },
    engaged: [],
  },
  {
    hospital: "hospital-harbor-view",
    specialty: "cardiology",
    prescribers: 34,
    decile: 8,
    share: { cardivance: 0.04 },
    consent: { email: 27, portal: 20, rep: 22 },
    engaged: [["asset-cardivance-outcomes-email", 15, 16]],
  },
  {
    hospital: "hospital-harbor-view",
    specialty: "endocrinology",
    prescribers: 26,
    decile: 7,
    share: { glucora: 0.19 },
    consent: { email: 20, portal: 11, rep: 15 },
    engaged: [["asset-glucora-a1c-email", 18, 14]],
  },
];

type Node = (label: string, id: string, name: string, extra?: Record<string, unknown>) => string;
type Rel = (
  type: string,
  from: string,
  to: string,
  properties?: Record<string, number | string>,
) => void;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Adds Lumera to the graph. It reads and writes nothing outside its own nodes except channels and Northstar. */
export function addPharma(node: Node, rel: Rel, northstarId: string) {
  node("Brand", LUMERA.id, LUMERA.name, { kind: "pharmaceutical brand", voice: LUMERA.voice });
  rel("PART_OF", LUMERA.id, northstarId);
  const ruleIds = LUMERA_RULES.map((rule) => {
    const id = node("BrandRule", `rule-${slug(rule)}`, rule);
    rel("RULE_OF", id, LUMERA.id);
    return id;
  });
  for (const [key, disclosure] of Object.entries(PHARMA_DISCLOSURES))
    node("Disclosure", pharmaDisclosureId(key as PharmaDisclosureKey), disclosure.name, {
      text: disclosure.text,
    });
  for (const channel of PHARMA_CHANNELS) node("Channel", channel.id, channel.name);
  for (const scope of HCP_CONSENT)
    node("ConsentScope", scope.id, `HCP ${scope.channel} promotional`, {
      channel: scope.channel,
      purpose: scope.purpose,
    });

  for (const [key, drug] of Object.entries(DRUGS)) {
    node("Drug", drugId(key as DrugKey), drug.name, {
      generic: drug.generic,
      drugClass: drug.drugClass,
      boxedWarning: drug.boxedWarning,
    });
    rel("OFFERS", LUMERA.id, drugId(key as DrugKey));
  }
  for (const [key, name] of Object.entries(INDICATIONS))
    node("Indication", indicationId(key as IndicationKey), name);
  for (const [drug, indication, since] of LABELED)
    rel("INDICATED_FOR", drugId(drug), indicationId(indication), { since });
  for (const [drug, indication, status] of INVESTIGATIONAL)
    rel("INVESTIGATED_FOR", drugId(drug), indicationId(indication), { status });
  for (const [key, specialty] of Object.entries(SPECIALTIES)) {
    node("Specialty", specialtyId(key as SpecialtyKey), specialty.name);
    for (const indication of specialty.treats)
      rel("TREATS", specialtyId(key as SpecialtyKey), indicationId(indication));
  }

  for (const [key, trial] of Object.entries(TRIALS)) {
    node("ClinicalTrial", trialId(key as TrialKey), trial.name, {
      phase: trial.phase,
      enrollment: trial.enrollment,
      status: trial.status,
      endpoint: trial.endpoint,
      result: trial.result,
    });
    rel("STUDIED_IN", drugId(trial.drug), trialId(key as TrialKey));
  }
  for (const claim of CLAIMS) {
    node("ClinicalClaim", claim.id, claim.text, {
      claimType: claim.type,
    });
    rel("CLAIMS_ABOUT", claim.id, drugId(claim.drug));
    rel("FOR", claim.id, indicationId(claim.indication));
    if (claim.trial) rel("SUPPORTS", trialId(claim.trial), claim.id);
  }

  for (const campaign of PHARMA_CAMPAIGNS) {
    node("Campaign", campaign.id, campaign.name, { status: campaign.status });
    rel("BELONGS_TO", campaign.id, LUMERA.id);
    const brief = node("Brief", `brief-${campaign.id}`, `${campaign.name} brief`);
    rel("FOR", brief, campaign.id);
  }
  for (const asset of PHARMA_ASSETS) {
    node("ContentAsset", asset.id, asset.name, {
      kind: asset.kind,
      channel: asset.channel,
      ...(asset.access ? { access: true } : {}),
    });
    rel("USES", asset.campaign, asset.id);
    rel("BUILT_FROM", asset.id, `brief-${asset.campaign}`);
    const approval = `approval-${asset.approval.id.toLowerCase()}`;
    node("Approval", approval, asset.approval.id, {
      status: asset.approval.status,
      reviewer: "Medical, legal and regulatory review",
      ...(asset.approval.approvedOn ? { approvedOn: asset.approval.approvedOn } : {}),
      ...(asset.approval.expiresOn ? { expiresOn: asset.approval.expiresOn } : {}),
    });
    rel("APPROVED_UNDER", asset.id, approval);
    for (const disclosure of asset.disclosures)
      rel("REQUIRES", asset.id, pharmaDisclosureId(disclosure));
    rel("APPROVED_FOR", asset.id, `channel-${asset.channel}`);
    for (const claim of asset.claims) rel("CARRIES", asset.id, claim);
    for (const [index, ruleId] of ruleIds.entries())
      rel(asset.failed === LUMERA_RULES[index] ? "FAILED" : "PASSED", asset.id, ruleId);
    rel("EXPLAINS", asset.id, drugId(asset.drug));
  }

  for (const hospital of HOSPITALS) {
    node("Hospital", hospital.id, hospital.name, {
      hospitalType: hospital.hospitalType,
      region: hospital.region,
      beds: hospital.beds,
    });
    for (const [indication, annualPatients] of Object.entries(hospital.patients))
      rel("SEES_PATIENTS_WITH", hospital.id, indicationId(indication as IndicationKey), {
        annualPatients,
      });
    for (const [drug, entry] of Object.entries(hospital.formulary)) {
      const [status, ptReviewInDays] = entry as readonly [FormularyStatus, number?];
      rel("ON_FORMULARY", hospital.id, drugId(drug as DrugKey), {
        status,
        ...(ptReviewInDays === undefined ? {} : { ptReviewInDays }),
      });
    }
  }
  for (const group of PRESCRIBER_GROUPS) {
    const id = groupId(group.hospital, group.specialty);
    const hospital = HOSPITALS.find((item) => item.id === group.hospital);
    node(
      "PrescriberGroup",
      id,
      `${SPECIALTIES[group.specialty].name} prescribers at ${hospital?.name}`,
      {
        prescribers: group.prescribers,
        decile: group.decile,
      },
    );
    rel("PRACTICES_AT", id, group.hospital);
    rel("SPECIALIZES_IN", id, specialtyId(group.specialty));
    for (const [drug, trxShare] of Object.entries(group.share))
      rel("PRESCRIBES", id, drugId(drug as DrugKey), { trxShare });
    for (const scope of HCP_CONSENT)
      rel("HAS_CONSENT", id, scope.id, {
        optedIn: group.consent[scope.channel],
        coverageRate: Math.round((group.consent[scope.channel] / group.prescribers) * 1000) / 1000,
      });
    for (const [asset, count, lastDaysAgo] of group.engaged)
      rel("ENGAGED_WITH", id, asset, { count, lastDaysAgo });
  }
}
