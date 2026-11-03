/**
 * Mocked pharmaceutical systems of record. Each function returns what the system's API would, for
 * Lumera Therapeutics' fictional drugs, claims, assets and hospitals, built from the same
 * identifiers as the knowledge graph so a drug, an MLR approval or a hospital means the same thing
 * in every system. Nothing here calls a real service. All data is invented, and no individual
 * clinician or patient appears: audiences are counts of prescribers.
 */
import {
  CLAIMS,
  DRUGS,
  type DrugKey,
  HOSPITALS,
  INDICATIONS,
  LABELED,
  PHARMA_ASSETS,
  PRESCRIBER_GROUPS,
  TRIALS,
} from "../../../../packages/knowledge-graph/src/index.ts";

export const MOCK_NOTE =
  "Mocked system of record for the demo: invented data keyed to the same drugs, claims, MLR approvals and hospitals as the knowledge graph.";

const drugKey = (id: string) => id.replace("drug-", "") as DrugKey;
const day = (iso: string) => iso.slice(0, 10);
const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
const hash = (text: string) => {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
};

// Aprimo: digital asset management and MLR workflow --------------------------------------------

const APRIMO_ID = (assetId: string) => `APR-${String((hash(assetId) % 900000) + 100000)}`;

export function aprimoSearch(
  drug: string,
  options: { channel?: string; status?: string; today: string },
) {
  const key = drugKey(drug);
  return PHARMA_ASSETS.filter((asset) => asset.drug === key)
    .filter((asset) => !options.channel || asset.channel === options.channel)
    .filter((asset) => !options.status || asset.approval.status === options.status)
    .map((asset) => {
      const expiresOn = asset.approval.expiresOn;
      const expired = Boolean(expiresOn && expiresOn < options.today);
      return {
        aprimoAssetId: APRIMO_ID(asset.id),
        graphAssetId: asset.id,
        title: asset.name,
        kind: asset.kind,
        channel: asset.channel,
        mlrApprovalId: asset.approval.id,
        status: expired ? "Expired" : asset.approval.status,
        approvedOn: asset.approval.approvedOn ?? null,
        expiresOn: expiresOn ?? null,
        usableNow: asset.approval.status === "Approved" && !expired && !asset.failed,
        claimIds: asset.claims,
        safetyInformation: asset.disclosures,
        renditions:
          asset.channel === "email"
            ? ["HTML email", "PDF"]
            : asset.channel === "rep"
              ? ["iPad detail aid", "PDF leave-behind"]
              : ["Web module", "PDF"],
        usageRights: { regions: ["US"], expiresOn: expiresOn ?? null },
      };
    });
}

const STAGES = ["Medical", "Legal", "Regulatory"] as const;
export function aprimoReview(mlrId: string) {
  const asset = PHARMA_ASSETS.find((candidate) => candidate.approval.id === mlrId);
  if (!asset) return null;
  const { approval } = asset;
  const submitted = approval.approvedOn
    ? addDays(approval.approvedOn, -(9 + (hash(mlrId) % 6)))
    : "2026-10-14";
  const pendingStage =
    asset.failed === "Claims consistent with the approved label"
      ? 2
      : asset.failed === "Claims supported by substantial evidence"
        ? 0
        : asset.approval.status === "Pending"
          ? 1
          : STAGES.length;
  const stages = STAGES.map((name, index) => {
    const done = index < pendingStage || approval.status !== "Pending";
    return {
      stage: name,
      status: done ? "Approved" : index === pendingStage ? "Changes requested" : "Not started",
      reviewerRole: `${name} reviewer`,
      completedOn: done ? addDays(submitted, 3 + index * 3) : null,
      comment:
        !done && index === pendingStage
          ? asset.failed === "Claims supported by substantial evidence"
            ? "No head-to-head trial supports the superiority claim. Remove it or provide the study."
            : asset.failed === "Claims consistent with the approved label"
              ? "HFpEF is not on the approved label; this promotional use is off label."
              : "Awaiting the updated value dossier tables."
          : null,
    };
  });
  return {
    mlrApprovalId: approval.id,
    aprimoAssetId: APRIMO_ID(asset.id),
    asset: asset.name,
    status: approval.status,
    submittedOn: submitted,
    stages,
    cycleDays: approval.approvedOn ? daysBetween(submitted, approval.approvedOn) : null,
    expiresOn: approval.expiresOn ?? null,
  };
}

// Reltio: master data management -------------------------------------------------------------

export function reltioOrganization(hospitalName: string) {
  const hospital = HOSPITALS.find((candidate) => candidate.name === hospitalName);
  if (!hospital) return null;
  const seed = hash(hospital.id);
  const idn =
    hospital.hospitalType.includes("network") || hospital.hospitalType.includes("Multispecialty");
  const groups = PRESCRIBER_GROUPS.filter((group) => group.hospital === hospital.id);
  return {
    reltioEntityId: `entities/hco-${String((seed % 90000000) + 10000000)}`,
    name: hospital.name,
    type: hospital.hospitalType,
    region: hospital.region,
    beds: hospital.beds,
    hierarchy: {
      parent: idn ? `${hospital.name} (health system parent)` : null,
      affiliatedSites: [
        `${hospital.name} Outpatient Pavilion`,
        `${hospital.name} Cardiac Clinic`,
      ].slice(0, 1 + (seed % 2)),
    },
    identifiers: [
      {
        type: "HCO ID",
        value: `HCO-${String((seed % 9000000) + 1000000)}`,
        source: "Reference data",
      },
      {
        type: "340B status",
        value: seed % 3 === 0 ? "Covered entity" : "Not enrolled",
        source: "HRSA (mock)",
      },
    ],
    sourceRecords: [
      { source: "Salesforce Life Sciences Cloud", records: 1 },
      { source: "IQVIA reference data (mock)", records: 1 },
      { source: "Formulary tracker", records: 1 + (seed % 2) },
    ],
    matchConfidence: Math.round((0.93 + (seed % 70) / 1000) * 1000) / 1000,
    survivorship:
      "Name and address from reference data; formulary status from the formulary tracker.",
    possibleDuplicates:
      seed % 4 === 0
        ? [
            {
              name: `${hospital.name.split(" ")[0]} Hospital`,
              confidence: 0.91,
              status: "Awaiting data steward review",
            },
          ]
        : [],
    prescriberGroups: groups.map((group) => ({
      specialty: group.specialty,
      prescribers: group.prescribers,
      dataQualityScore:
        Math.round((0.9 + (hash(`${hospital.id}${group.specialty}`) % 90) / 1000) * 1000) / 1000,
    })),
  };
}

// Veeva Vault PromoMats: approved claims library and the label ---------------------------------

export function vaultClaims(drug: string, today: string) {
  const key = drugKey(drug);
  return CLAIMS.filter((claim) => claim.drug === key).map((claim) => {
    const trial = claim.trial ? TRIALS[claim.trial] : undefined;
    const labeled = LABELED.some(([d, i]) => d === claim.drug && i === claim.indication);
    const supported = trial?.status === "Completed";
    const carriers = PHARMA_ASSETS.filter((asset) => asset.claims.includes(claim.id));
    const status =
      !supported && claim.type !== "dosing"
        ? "Not approved"
        : !labeled
          ? "Not approved"
          : "Approved";
    return {
      vaultClaimId: `CLM-${String((hash(claim.id) % 90000) + 10000)}`,
      graphClaimId: claim.id,
      text: claim.text,
      type: claim.type,
      indication: INDICATIONS[claim.indication],
      status,
      reason:
        status === "Approved"
          ? null
          : !labeled
            ? "Indication is not on the approved label."
            : claim.trial
              ? `Supporting trial ${trial?.name} has no results yet.`
              : "No substantiating reference is linked.",
      references: trial
        ? [
            {
              citation: `${trial.name} clinical study report (${trial.phase}, n=${trial.enrollment})`,
              type: "Clinical study report",
              result: trial.result,
            },
          ]
        : [],
      linkedDocuments: carriers.map((asset) => ({
        document: asset.name,
        mlrApprovalId: asset.approval.id,
        approvalStatus:
          asset.approval.expiresOn && asset.approval.expiresOn < today
            ? "Expired"
            : asset.approval.status,
      })),
    };
  });
}

export function vaultLabel(drug: string) {
  const key = drugKey(drug);
  const info = DRUGS[key];
  const since = LABELED.find(([d]) => d === key)?.[2] ?? 2021;
  return {
    drug: info.name,
    genericName: info.generic,
    drugClass: info.drugClass,
    currentVersion: `PI-${key.toUpperCase().slice(0, 3)}-${since + 3}.2`,
    effectiveDate: `${since + 4}-03-01`,
    boxedWarning: info.boxedWarning
      ? "WARNING: FETAL TOXICITY. When pregnancy is detected, discontinue as soon as possible."
      : null,
    indications: LABELED.filter(([d]) => d === key).map(
      ([, indication]) => INDICATIONS[indication],
    ),
    supersededVersions: [`PI-${key.toUpperCase().slice(0, 3)}-${since + 3}.1`],
    safetyDocuments: PHARMA_ASSETS.filter((asset) => asset.drug === key)
      .flatMap((asset) => asset.disclosures)
      .filter((value, index, all) => all.indexOf(value) === index),
  };
}

// Screendragon: marketing work management -------------------------------------------------------

type JobStage = "Brief" | "Creative" | "MLR review" | "Production" | "Distribution" | "Complete";
const JOB_SEED: ReadonlyArray<readonly [string, string, string, JobStage, string, string, number]> =
  [
    [
      "SD-1041",
      "Cardivance HFrEF outcomes email, Q4 wave 1",
      "asset-cardivance-outcomes-email",
      "Production",
      "2026-11-09",
      "Brand manager, Cardivance",
      18500,
    ],
    [
      "SD-1042",
      "Cardivance rep detail aid refresh",
      "asset-cardivance-detail-aid",
      "Complete",
      "2026-10-20",
      "Brand manager, Cardivance",
      42000,
    ],
    [
      "SD-1043",
      "Cardivance superiority email",
      "asset-cardivance-superiority-email",
      "MLR review",
      "2026-11-12",
      "Brand manager, Cardivance",
      9000,
    ],
    [
      "SD-1044",
      "Cardivance HFpEF detail aid",
      "asset-cardivance-hfpef-aid",
      "MLR review",
      "2026-11-30",
      "Medical affairs lead",
      27000,
    ],
    [
      "SD-1051",
      "Glucora weight and HbA1c email, refresh",
      "asset-glucora-weight-email",
      "Creative",
      "2026-11-17",
      "Brand manager, Glucora",
      12000,
    ],
    [
      "SD-1061",
      "Neurelva launch data module",
      "asset-neurelva-portal-module",
      "Distribution",
      "2026-11-04",
      "Launch lead, Neurelva",
      31000,
    ],
    [
      "SD-1062",
      "Neurelva formulary value dossier",
      "asset-neurelva-value-dossier",
      "MLR review",
      "2026-11-18",
      "Market access lead",
      22000,
    ],
  ];
const jobOf = (
  [id, title, assetId, stage, due, owner, budget]: (typeof JOB_SEED)[number],
  today: string,
) => {
  const asset = PHARMA_ASSETS.find((candidate) => candidate.id === assetId);
  const daysUntilDue = daysBetween(today, due);
  return {
    jobId: id,
    title,
    drug: asset ? DRUGS[asset.drug].name : null,
    stage,
    owner,
    dueOn: due,
    daysUntilDue,
    budgetUsd: budget,
    linkedAsset: asset
      ? {
          graphAssetId: asset.id,
          aprimoAssetId: APRIMO_ID(asset.id),
          mlrApprovalId: asset.approval.id,
          mlrStatus: asset.approval.status,
        }
      : null,
    atRisk:
      stage !== "Complete" &&
      stage !== "Distribution" &&
      daysUntilDue <= 10 &&
      (stage === "Brief" || stage === "Creative" || stage === "MLR review"),
  };
};
export const SCREENDRAGON_JOB_IDS = JOB_SEED.map((job) => job[0]) as [string, ...string[]];
export function screendragonJobs(options: { drug?: string; stage?: string; today: string }) {
  return JOB_SEED.map((job) => jobOf(job, options.today))
    .filter((job) => !options.drug || job.drug === DRUGS[drugKey(options.drug)].name)
    .filter((job) => !options.stage || job.stage === options.stage);
}
export function screendragonJob(jobId: string, today: string) {
  const seed = JOB_SEED.find((job) => job[0] === jobId);
  if (!seed) return null;
  const job = jobOf(seed, today);
  const order: JobStage[] = [
    "Brief",
    "Creative",
    "MLR review",
    "Production",
    "Distribution",
    "Complete",
  ];
  const at = order.indexOf(job.stage);
  return {
    ...job,
    workflow: order.map((stage, index) => ({
      stage,
      status: index < at ? "Done" : index === at ? "In progress" : "Not started",
    })),
    blockers:
      job.linkedAsset && job.linkedAsset.mlrStatus !== "Approved"
        ? [
            `MLR approval ${job.linkedAsset.mlrApprovalId} is ${job.linkedAsset.mlrStatus.toLowerCase()}; production cannot start until it is approved`,
          ]
        : [],
  };
}

// IQVIA: prescription and market data ----------------------------------------------------------

export function iqviaTrends(drug: string, hospitalName?: string) {
  const key = drugKey(drug);
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const indications = LABELED.filter(([d]) => d === key).map(([, indication]) => indication);
  const scope = HOSPITALS.filter(
    (hospital) => !hospitalName || hospital.name === hospitalName,
  ).filter((hospital) => indications.some((indication) => hospital.patients[indication]));
  if (hospitalName && scope.length === 0) return null;
  const rows = scope.map((hospital) => {
    const groups = PRESCRIBER_GROUPS.filter(
      (group) => group.hospital === hospital.id && group.share[key] !== undefined,
    );
    const share = groups.length
      ? groups.reduce((sum, group) => sum + (group.share[key] ?? 0), 0) / groups.length
      : 0;
    const patients = indications.reduce(
      (sum, indication) => sum + (hospital.patients[indication] ?? 0),
      0,
    );
    const base = Math.max(1, Math.round((patients * share) / 12));
    const slope = 1 + ((hash(`${hospital.id}${key}`) % 9) - 3) / 100;
    return {
      hospital: hospital.name,
      marketSharePct: Math.round(share * 1000) / 10,
      monthlyTrx: months.map((month, index) => ({ month, trx: Math.round(base * slope ** index) })),
      newToBrandRxLast3Months: Math.round(base * 0.18 * 3),
    };
  });
  return {
    drug: DRUGS[key].name,
    class: DRUGS[key].drugClass,
    months,
    rows,
    classTotalTrxLastMonth: rows.reduce((sum, row) => sum + (row.monthlyTrx.at(-1)?.trx ?? 0), 0),
  };
}

// Salesforce Life Sciences Cloud: call plans and field activity ---------------------------------

export function lifeSciencesCallPlan(hospitalName: string) {
  const hospital = HOSPITALS.find((candidate) => candidate.name === hospitalName);
  if (!hospital) return null;
  const groups = PRESCRIBER_GROUPS.filter((group) => group.hospital === hospital.id);
  const repAids = PHARMA_ASSETS.filter(
    (asset) => asset.channel === "rep" && asset.approval.status === "Approved",
  );
  return {
    hospital: hospital.name,
    territory: `${hospital.region} ${hospital.hospitalType.split(" ")[0]} accounts`,
    quarter: "2026-Q4",
    groups: groups.map((group) => {
      const planned = Math.max(2, Math.round(group.prescribers * 0.35));
      const completed = Math.min(
        planned,
        Math.round(group.consent.rep * 0.4) + group.engaged.length,
      );
      return {
        specialty: group.specialty,
        prescribers: group.prescribers,
        callsPlanned: planned,
        callsCompleted: completed,
        callsOpenToRepContact: group.consent.rep,
        lastCallDaysAgo: group.engaged.length
          ? Math.min(...group.engaged.map((entry) => entry[2])) + 2
          : null,
        approvedDetailAids: repAids
          .filter(
            (asset) => group.share[asset.drug] !== undefined || group.specialty === "cardiology",
          )
          .map((asset) => ({ asset: asset.name, mlrApprovalId: asset.approval.id })),
        nextBestAction:
          group.consent.rep / group.prescribers < 0.45
            ? "Low rep-visit consent: use approved email and portal content first"
            : "Schedule a detail call with the approved detail aid",
      };
    }),
    sampleCompliance: "No sample distribution is planned for these accounts (mock).",
  };
}

// Drupal: the HCP website ---------------------------------------------------------------------

const PAGE_SEED: ReadonlyArray<
  readonly [number, string, string, string, readonly string[], string, string]
> = [
  [
    1204,
    "Cardivance clinical data: CARDIO-HF",
    "/hcp/cardivance/clinical-data",
    "published",
    ["claim-cardivance-mortality", "claim-cardivance-safety"],
    "MLR-2026-0412",
    "2026-06-20",
  ],
  [
    1209,
    "Cardivance and heart failure with preserved ejection fraction",
    "/hcp/cardivance/hfpef",
    "draft",
    ["claim-cardivance-hfpef"],
    "MLR-2026-0590",
    "",
  ],
  [
    1301,
    "Glucora: weight and HbA1c",
    "/hcp/glucora/weight",
    "published",
    ["claim-glucora-weight", "claim-glucora-a1c"],
    "MLR-2025-0988",
    "2025-10-08",
  ],
  [
    1302,
    "Glucora clinical data: GLUCO-CONTROL",
    "/hcp/glucora/clinical-data",
    "published",
    ["claim-glucora-a1c"],
    "MLR-2026-0301",
    "2026-04-15",
  ],
  [
    1403,
    "Neurelva clinical data module",
    "/hcp/neurelva/clinical-data",
    "published",
    ["claim-neurelva-days", "claim-neurelva-dosing"],
    "MLR-2026-0489",
    "2026-07-22",
  ],
];
export function drupalContent(drug: string, today: string) {
  const key = drugKey(drug);
  const claimDrug = (claimId: string) => CLAIMS.find((claim) => claim.id === claimId)?.drug;
  return PAGE_SEED.filter(([, , , , claims]) =>
    claims.every((claim) => claimDrug(claim) === key),
  ).map(([nid, title, path, state, claims, mlrId, publishedOn]) => {
    const approval = PHARMA_ASSETS.find((asset) => asset.approval.id === mlrId)?.approval;
    const expired = Boolean(approval?.expiresOn && approval.expiresOn < today);
    const issues: string[] = [];
    if (state === "published" && expired)
      issues.push(
        `Published with MLR approval ${mlrId}, which expired on ${approval?.expiresOn}. Take it down or get it re-approved.`,
      );
    if (state === "published" && approval?.status === "Pending")
      issues.push(`Published while MLR approval ${mlrId} is pending.`);
    for (const claimId of claims) {
      const claim = CLAIMS.find((candidate) => candidate.id === claimId);
      const supported = claim?.trial
        ? TRIALS[claim.trial].status === "Completed"
        : claim?.type === "dosing";
      if (state === "published" && !supported)
        issues.push(`Carries a claim no completed trial supports: "${claim?.text}"`);
    }
    return {
      drupalNodeId: nid,
      title,
      path,
      state,
      publishedOn: publishedOn || null,
      claimIds: claims,
      mlrApprovalId: mlrId,
      mlrStatus: expired ? "Expired" : (approval?.status ?? "Unknown"),
      compliant: issues.length === 0,
      issues,
    };
  });
}

export const today = (now: Date) => day(now.toISOString());
