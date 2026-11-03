// The adversarial farm and the data readiness agent. Both only report; neither changes an object.

import { type Blocker, claimPacket } from "./agents.ts";
import { ABSOLUTE, PHARMA_OVERREACH, statesFact } from "./language.ts";
import { STAGE_LABELS, STAGES, type Stage } from "./registry.ts";
import type { CHANNEL_BASELINE } from "./seed.ts";
import {
  attributesOf,
  type Brand,
  type ClaimAttributes,
  type GovernedObject,
  type ModuleAttributes,
  type PlanAttributes,
} from "./types.ts";
import { getObject, listObjects, successorOf, type World } from "./world.ts";

export type Finding = {
  probe: "claim-attacker" | "injection-prober" | "brand-checker" | "consent-prober";
  severity: "block" | "warn";
  message: string;
  urn: string;
};

const INJECTION =
  /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|all|earlier)\b|\bsystem prompt\b|\byou are now\b|\bact as\b|\breveal\b.{0,30}\b(prompt|secret|key)\b|\bBEGIN (SYSTEM|INSTRUCTIONS?)\b/i;
const EMBARGO = /\b(acquisition|acquires?|acquiring|merger)\b/i;

/** Fictional consent coverage by segment and channel: the share of the audience that opted in. */
export const CONSENT_COVERAGE: Record<string, Record<keyof typeof CHANNEL_BASELINE, number>> = {
  "sweep-prospects": { email: 0.82, push: 0.31, sms: 0.12 },
  "cash-heavy-clients": { email: 0.9, push: 0.72, sms: 0.4 },
  "app-near-san-francisco": { email: 0.5, push: 0.88, sms: 0.2 },
  "email-loyalty": { email: 0.93, push: 0.35, sms: 0.18 },
  "cardiology-prescribers": { email: 0.78, push: 0.35, sms: 0 },
  "endocrinology-prescribers": { email: 0.74, push: 0.4, sms: 0 },
  "neurology-prescribers": { email: 0.7, push: 0.55, sms: 0 },
};

export function runFarm(world: World, moduleUrn: string): Finding[] {
  const module = getObject(world, moduleUrn);
  if (module?.kind !== "module") throw new Error(`${moduleUrn} is not a module.`);
  const attributes = attributesOf<ModuleAttributes>(module);
  const findings: Finding[] = [];
  const add = (probe: Finding["probe"], severity: Finding["severity"], message: string) =>
    findings.push({ probe, severity, message, urn: module.urn });

  // Claim attacker: statements that state a fact without a claim, or stretch the claim they cite.
  for (const block of attributes.blocks) {
    if (block.disclosureUrn) continue;
    if (!block.claimUrn) {
      if (statesFact(block.text))
        add("claim-attacker", "block", `Uncited factual statement: "${block.text}"`);
      continue;
    }
    const claim = getObject(world, block.claimUrn);
    if (!claim) add("claim-attacker", "block", `Cites ${block.claimUrn}, which does not exist.`);
    else if (attributesOf<ClaimAttributes>(claim).text !== block.text)
      add(
        "claim-attacker",
        "block",
        `Rewords claim ${claim.urn}; the cited text must match exactly.`,
      );
  }

  // Injection prober: instruction-like text in anything the agent would read.
  const brief = attributes.briefUrn ? getObject(world, attributes.briefUrn) : undefined;
  const texts: Array<[string, string]> = [
    ...attributes.blocks.map((block): [string, string] => ["a module block", block.text]),
    ["the module headline", attributes.headline],
    ...(brief
      ? [
          ["the brief", String((brief.attributes as { objective?: string }).objective ?? "")] as [
            string,
            string,
          ],
        ]
      : []),
    ...attributes.blocks.flatMap((block) => {
      const linked = block.claimUrn ? getObject(world, block.claimUrn) : undefined;
      return linked
        ? [["a cited claim", attributesOf<ClaimAttributes>(linked).text] as [string, string]]
        : [];
    }),
  ];
  for (const [where, text] of texts)
    if (INJECTION.test(text))
      add("injection-prober", "block", `Instruction-like text in ${where}: "${text.slice(0, 80)}"`);

  // Brand and disclosure checker.
  // Required disclosures are approved legal text ("not bank guaranteed"), so they are not scanned.
  const all = [
    attributes.headline,
    ...attributes.blocks.filter((block) => !block.disclosureUrn).map((block) => block.text),
  ].join(" ");
  if (module.brand === "Harborstone Wealth") {
    if (ABSOLUTE.test(all))
      add(
        "brand-checker",
        "block",
        "Absolute or guarantee language is not allowed in regulated content.",
      );
    if (EMBARGO.test(all))
      add("brand-checker", "block", "Mentions an embargoed deal before its release step.");
  }
  if (module.brand === "Lumera Therapeutics" && PHARMA_OVERREACH.test(all))
    add(
      "brand-checker",
      "block",
      "Superiority or absolute safety language needs head-to-head evidence and label support.",
    );
  if (/!/.test(all) && module.brand === "Harborstone Wealth")
    add("brand-checker", "warn", "Exclamation marks are off voice for Harborstone.");
  const present = new Set(attributes.blocks.map((block) => block.disclosureUrn));
  for (const required of attributes.requiredDisclosures)
    if (!present.has(required))
      add("brand-checker", "block", `Required disclosure ${required} is missing.`);

  // Consent prober: the channel against the audience the brief reaches.
  const resolved = brief ? (brief.attributes as { planUrn?: string; waveId?: string }) : undefined;
  const plan = resolved?.planUrn ? getObject(world, resolved.planUrn) : undefined;
  const wave = plan
    ? attributesOf<PlanAttributes>(plan).waves.find((item) => item.id === resolved?.waveId)
    : undefined;
  const coverage = wave ? CONSENT_COVERAGE[wave.segment]?.[attributes.channel] : undefined;
  if (coverage !== undefined && coverage < 0.5)
    add(
      "consent-prober",
      coverage < 0.2 ? "block" : "warn",
      `Only ${Math.round(coverage * 100)}% of ${wave?.segment} opted in to ${attributes.channel}.`,
    );
  return findings;
}

export const farmBlockers = (findings: readonly Finding[]): Blocker[] =>
  findings
    .filter((finding) => finding.severity === "block")
    .map((finding) => ({
      code: `farm-${finding.probe}`,
      message: finding.message,
      urn: finding.urn,
    }));

// Data readiness ------------------------------------------------------------------------------

export type ReadinessCheck = { label: string; ok: boolean; detail: string };
export type StageReadiness = {
  stage: Stage;
  label: string;
  score: number;
  checks: ReadinessCheck[];
};

const STALE_DAYS = 14;

export function dataReadiness(world: World, brand: Brand): StageReadiness[] {
  const today = world.now.toISOString().slice(0, 10);
  const objects = listObjects(world, { brand });
  const of = (kind: GovernedObject["kind"]) => objects.filter((object) => object.kind === kind);
  const plans = of("content-plan").filter((plan) => !successorOf(world, plan.urn));
  const modules = of("module");
  const claims = of("claim").filter(
    (claim) => !successorOf(world, claim.urn) && claim.approvalState !== "withdrawn",
  );
  const results = of("result");
  const stale = objects.filter(
    (object) =>
      ["submitted", "in_review"].includes(object.approvalState) &&
      (world.now.getTime() - new Date(object.updatedAt).getTime()) / 86_400_000 > STALE_DAYS,
  );
  const checks: Record<Stage, ReadinessCheck[]> = {
    plan: [
      {
        label: "A current plan exists",
        ok: plans.length > 0,
        detail: `${plans.length} current plan(s).`,
      },
      {
        label: "Past results to learn from",
        ok: results.length > 0,
        detail: `${results.length} result(s).`,
      },
    ],
    audience: [
      {
        label: "Every planned segment has consent coverage",
        ok: plans.every((plan) =>
          attributesOf<PlanAttributes>(plan).waves.every((wave) => CONSENT_COVERAGE[wave.segment]),
        ),
        detail: "Coverage is read from the audience object, not the channel.",
      },
    ],
    brief: [
      {
        label: "Every brief inherits a plan that still exists",
        ok: of("brief").every((brief) =>
          Boolean(getObject(world, (brief.attributes as { planUrn: string }).planUrn)),
        ),
        detail: `${of("brief").length} brief(s).`,
      },
    ],
    create: [
      {
        label: "No open gap records",
        ok: of("gap").every((gap) => gap.approvalState === "approved"),
        detail: `${of("gap").filter((gap) => gap.approvalState !== "approved").length} open gap(s).`,
      },
    ],
    substantiate: [
      {
        label: "Every current claim has unexpired evidence",
        ok: claims.every(
          (claim) =>
            claimPacket(world, claim).status === "substantiated" ||
            claim.approvalState !== "approved",
        ),
        detail: `${claims.filter((claim) => claimPacket(world, claim).status === "expired-evidence").length} claim(s) with expired evidence as of ${today}.`,
      },
    ],
    approve: [
      {
        label: `Nothing waiting over ${STALE_DAYS} days`,
        ok: stale.length === 0,
        detail: `${stale.length} stale item(s).`,
      },
    ],
    deploy: [
      {
        label: "Approved modules have results",
        ok: modules
          .filter((module) => module.approvalState === "approved")
          .every((module) =>
            results.some(
              (result) => (result.attributes as { moduleUrn: string }).moduleUrn === module.urn,
            ),
          ),
        detail: `${results.length} result(s) for ${modules.filter((module) => module.approvalState === "approved").length} approved module(s).`,
      },
    ],
  };
  return STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    score:
      Math.round((checks[stage].filter((check) => check.ok).length / checks[stage].length) * 100) /
      100,
    checks: checks[stage],
  }));
}
