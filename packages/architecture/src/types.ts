import { z } from "zod";
import type { AssetPick } from "./assets.ts";

export const BRANDS = ["Harborstone Wealth", "Coastline Kitchen", "Lumera Therapeutics"] as const;
export type Brand = (typeof BRANDS)[number];

export const OBJECT_KINDS = [
  "content-plan",
  "brief",
  "module",
  "claim",
  "evidence",
  "result",
  "disclosure",
  "gap",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** The approval states the governance state machine moves an object through. */
export const APPROVAL_STATES = [
  "draft",
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "escalated",
  "expired",
  "withdrawn",
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const CLASSIFICATIONS = ["public", "internal", "regulated"] as const;
export const CHANNELS = ["email", "push", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

const URN = /^urn:northstar:[a-z-]+:[a-z0-9-]+$/;

/**
 * The one shape every plan, brief, module, claim, piece of evidence, result and gap shares. The
 * `urn` is its identifier for life; governance travels with it as attributes, and a new version
 * names the one it `supersedes` instead of copying it.
 */
export const GovernedObjectSchema = z.object({
  urn: z.string().regex(URN),
  kind: z.enum(OBJECT_KINDS),
  title: z.string().min(1).max(200),
  version: z.number().int().min(1),
  supersedes: z.string().regex(URN).nullable(),
  brand: z.enum(BRANDS),
  market: z.string().min(2).max(8),
  owner: z.string().min(1),
  approvalState: z.enum(APPROVAL_STATES),
  classification: z.enum(CLASSIFICATIONS),
  /** "user:<subject>" or "agent:<id>". */
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attributes: z.record(z.string(), z.unknown()),
});
export type GovernedObject = z.infer<typeof GovernedObjectSchema>;

/** Relationships between objects. They are derived from attributes, never stored separately. */
export const EDGE_TYPES = [
  "INHERITS",
  "CITES",
  "SUBSTANTIATED_BY",
  "MEASURED_BY",
  "VARIANT_OF",
  "REQUIRES_DISCLOSURE",
  "GAP_FOR",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export type Edge = { type: EdgeType; from: string; to: string };

export const urnOf = (kind: ObjectKind, id: string) => `urn:northstar:${kind}:${id}`;

// Typed views of `attributes` for each kind.
export type Wave = {
  id: string;
  theme: string;
  segment: string;
  audienceSize: number;
  channel: Channel;
  sendOn: string;
  moduleCount: number;
  rationale: string;
};
export type PlanAttributes = { objective: string; waves: Wave[]; basis: string[] };
export type BriefAttributes = { planUrn: string; waveId: string; objective: string };
export type ModuleBlock = { text: string; claimUrn?: string; disclosureUrn?: string };
export type ModuleAttributes = {
  headline: string;
  channel: Channel;
  blocks: ModuleBlock[];
  topics: string[];
  requiredDisclosures: string[];
  variantOf?: string;
  briefUrn?: string;
  /** Images the service suggested from the brand's asset library. */
  assets?: AssetPick[];
};
export type ClaimAttributes = { text: string; topic: string };
export type EvidenceAttributes = {
  claimUrn: string;
  source: string;
  asOf: string;
  expiresOn: string;
};
export type ResultAttributes = {
  moduleUrn: string;
  channel: Channel;
  period: string;
  sends: number;
  opens: number;
  clicks: number;
};
export type DisclosureAttributes = { text: string; short: string };
export type GapAttributes = { briefUrn: string; topic: string; reason: string };

export const attributesOf = <T>(object: GovernedObject) => object.attributes as unknown as T;
