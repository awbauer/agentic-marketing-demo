// Images for a module, from each brand's digital asset library. The libraries are mocked: Lumera
// and Harborstone keep approved creative in Aprimo, Coastline in Marketing Cloud Content Builder.
// The service suggests images the way it inserts claims: only what is approved, in rights on the
// send date, and showing nothing the module doesn't cite. Everything it passes over is listed with
// the reason, so a person sees what was considered.
import type { Brand, Channel } from "./types.ts";

export type AssetSource = "Aprimo" | "Content Builder";
export type AssetKind = "hero" | "product" | "lifestyle" | "logo";

export type LibraryAsset = {
  id: string;
  brand: Brand;
  source: AssetSource;
  /** The asset's ID in its library. */
  sourceId: string;
  title: string;
  kind: AssetKind;
  /** What the image shows, as its alt text. */
  alt: string;
  /** Words the image suits, matched against the wave's theme and the module's claim topics. */
  tags: readonly string[];
  channels: readonly Channel[];
  /** Approval in the library: an MLR or compliance ID where the brand needs one. */
  approval: { status: "Approved" | "Pending" | "Expired"; id?: string };
  /** Usage rights end on this date, if they end. */
  rightsUntil?: string;
  /** Claim topics the image itself shows (a chart, a figure). It may only go with those claims. */
  shows?: readonly string[];
  /** Two colors for the preview's placeholder, from the brand's palette. */
  palette: readonly [string, string];
};

const LUMERA: [string, string] = ["#5b2a86", "#c9b6e4"];
const HARBORSTONE: [string, string] = ["#123a5a", "#b8cfe0"];
const COASTLINE: [string, string] = ["#b4532a", "#f3d3b0"];

export const ASSET_LIBRARY: readonly LibraryAsset[] = [
  {
    id: "lt-img-congress-hero",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-482113",
    title: "Heart failure meeting banner",
    kind: "hero",
    alt: "A cardiology meeting hall with the Lumera booth in the foreground",
    tags: ["heart", "failure", "meeting", "congress", "cardiology", "outcomes"],
    channels: ["email"],
    approval: { status: "Approved", id: "MLR-2026-0611" },
    rightsUntil: "2027-06-30",
    palette: LUMERA,
  },
  {
    id: "lt-img-cardivance-pack",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-482190",
    title: "Cardivance pack shot",
    kind: "product",
    alt: "Cardivance tablets and carton on a white background",
    tags: ["cardivance", "heart", "failure", "mortality"],
    channels: ["email"],
    approval: { status: "Approved", id: "MLR-2026-0577" },
    rightsUntil: "2027-03-31",
    palette: LUMERA,
  },
  {
    id: "lt-img-superiority-chart",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-482244",
    title: "Cardivance versus ARBs chart",
    kind: "product",
    alt: "A bar chart comparing Cardivance with ARBs",
    tags: ["cardivance", "heart", "failure", "outcomes"],
    channels: ["email"],
    approval: { status: "Pending", id: "MLR-2026-0702" },
    shows: ["cardivance-superior"],
    palette: LUMERA,
  },
  {
    id: "lt-img-patient-walk",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-471950",
    title: "Patient walking with a clinician",
    kind: "lifestyle",
    alt: "An older patient walking outdoors with a clinician",
    tags: ["heart", "failure", "patients", "cardiology"],
    channels: ["email"],
    approval: { status: "Approved", id: "MLR-2025-0914" },
    rightsUntil: "2026-10-31",
    palette: LUMERA,
  },
  {
    id: "lt-img-glucora-hero",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-483005",
    title: "Glucora data banner",
    kind: "hero",
    alt: "A clinician reviewing a patient's glucose readings on a tablet",
    tags: ["glucora", "hba1c", "diabetes", "data"],
    channels: ["email"],
    approval: { status: "Approved", id: "MLR-2026-0640" },
    rightsUntil: "2027-01-31",
    palette: LUMERA,
  },
  {
    id: "lt-img-logo",
    brand: "Lumera Therapeutics",
    source: "Aprimo",
    sourceId: "APR-400001",
    title: "Lumera logo",
    kind: "logo",
    alt: "Lumera Therapeutics",
    tags: [],
    channels: ["email", "push"],
    approval: { status: "Approved", id: "MLR-2024-0001" },
    palette: LUMERA,
  },
  {
    id: "hs-img-rate-hero",
    brand: "Harborstone Wealth",
    source: "Aprimo",
    sourceId: "APR-215507",
    title: "Sweep account banner",
    kind: "hero",
    alt: "A calm harbor at dawn with the Harborstone wordmark",
    tags: ["sweep", "account", "rate", "cash"],
    channels: ["email"],
    approval: { status: "Approved", id: "COMP-2026-118" },
    rightsUntil: "2027-09-30",
    palette: HARBORSTONE,
  },
  {
    id: "hs-img-rate-card",
    brand: "Harborstone Wealth",
    source: "Aprimo",
    sourceId: "APR-215560",
    title: "Sweep rate card",
    kind: "product",
    alt: "A card showing the Sweep Account's annual percentage yield",
    tags: ["sweep", "account", "rate", "apy"],
    channels: ["email"],
    approval: { status: "Approved", id: "COMP-2026-121" },
    rightsUntil: "2027-09-30",
    shows: ["sweep-apy"],
    palette: HARBORSTONE,
  },
  {
    id: "hs-img-advisor",
    brand: "Harborstone Wealth",
    source: "Aprimo",
    sourceId: "APR-209933",
    title: "Advisor meeting",
    kind: "lifestyle",
    alt: "An advisor talking with a client across a desk",
    tags: ["advisor", "rate", "decision", "client", "fee"],
    channels: ["email"],
    approval: { status: "Expired", id: "COMP-2025-077" },
    rightsUntil: "2026-09-30",
    palette: HARBORSTONE,
  },
  {
    id: "hs-img-logo",
    brand: "Harborstone Wealth",
    source: "Aprimo",
    sourceId: "APR-200001",
    title: "Harborstone logo",
    kind: "logo",
    alt: "Harborstone Wealth",
    tags: [],
    channels: ["email", "push"],
    approval: { status: "Approved", id: "COMP-2024-001" },
    palette: HARBORSTONE,
  },
  {
    id: "ck-img-chowder-hero",
    brand: "Coastline Kitchen",
    source: "Content Builder",
    sourceId: "CB-88214",
    title: "Clam chowder on a cold day",
    kind: "hero",
    alt: "A bowl of clam chowder by a rain-streaked window",
    tags: ["chowder", "cold", "day", "soup", "weather"],
    channels: ["email", "push"],
    approval: { status: "Approved" },
    rightsUntil: "2027-02-28",
    palette: COASTLINE,
  },
  {
    id: "ck-img-soup-counter",
    brand: "Coastline Kitchen",
    source: "Content Builder",
    sourceId: "CB-88230",
    title: "Soup counter",
    kind: "lifestyle",
    alt: "The Coastline soup counter with three kettles",
    tags: ["soup", "day", "hours", "counter"],
    channels: ["email"],
    approval: { status: "Approved" },
    rightsUntil: "2026-11-07",
    palette: COASTLINE,
  },
  {
    id: "ck-img-price-tile",
    brand: "Coastline Kitchen",
    source: "Content Builder",
    sourceId: "CB-88241",
    title: "Chowder price tile",
    kind: "product",
    alt: "A tile with the chowder bowl and its price",
    tags: ["chowder", "price"],
    channels: ["email", "push"],
    approval: { status: "Approved" },
    rightsUntil: "2027-02-28",
    shows: ["chowder-price"],
    palette: COASTLINE,
  },
  {
    id: "ck-img-logo",
    brand: "Coastline Kitchen",
    source: "Content Builder",
    sourceId: "CB-80001",
    title: "Coastline logo",
    kind: "logo",
    alt: "Coastline Kitchen",
    tags: [],
    channels: ["email", "push"],
    approval: { status: "Approved" },
    palette: COASTLINE,
  },
];

export type AssetPick = {
  assetId: string;
  source: AssetSource;
  sourceId: string;
  title: string;
  kind: AssetKind;
  alt: string;
  /** Where it goes in the email: the banner, beside the claims, or the header. */
  placement: "header" | "banner" | "inline";
  approvalId?: string;
  rightsUntil?: string;
  why: string;
};
export type AssetPass = {
  assetId: string;
  source: AssetSource;
  sourceId: string;
  title: string;
  reason: string;
};

const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * Suggests the images for a module: the brand's logo, the best-matching banner, and an inline
 * image beside the claims. An image is passed over if it isn't approved, if its rights end before
 * the send date, or if it shows a claim the module doesn't cite.
 */
export function suggestAssets(request: {
  brand: Brand;
  channel: Channel;
  theme: string;
  topics: readonly string[];
  /** The send date, or today when the wave has none. */
  sendOn: string;
}): { picked: AssetPick[]; passed: AssetPass[] } {
  const wanted = new Set([
    ...wordsOf(request.theme),
    ...request.topics.flatMap((topic) => [...wordsOf(topic.replaceAll("-", " "))]),
  ]);
  const passed: AssetPass[] = [];
  const usable: Array<{ asset: LibraryAsset; score: number; matched: string[] }> = [];
  for (const asset of ASSET_LIBRARY) {
    if (asset.brand !== request.brand || !asset.channels.includes(request.channel)) continue;
    const matched = asset.tags.filter((tag) => wanted.has(tag));
    if (asset.kind !== "logo" && matched.length === 0) continue;
    const pass = (reason: string) =>
      passed.push({
        assetId: asset.id,
        source: asset.source,
        sourceId: asset.sourceId,
        title: asset.title,
        reason,
      });
    const uncited = (asset.shows ?? []).filter((topic) => !request.topics.includes(topic));
    if (asset.approval.status !== "Approved")
      pass(
        `${asset.approval.status} in ${asset.source}${asset.approval.id ? ` (${asset.approval.id})` : ""}: only approved images go out.`,
      );
    else if (asset.rightsUntil && asset.rightsUntil < request.sendOn)
      pass(`Usage rights end ${asset.rightsUntil}, before the send on ${request.sendOn}.`);
    else if (uncited.length)
      pass(
        `It shows ${uncited.join(", ")}, which this module doesn't cite; an image may only show a claim the module carries.`,
      );
    else usable.push({ asset, score: matched.length, matched });
  }
  const best = (kinds: readonly AssetKind[], taken: Set<string>) =>
    usable
      .filter((item) => kinds.includes(item.asset.kind) && !taken.has(item.asset.id))
      .sort((a, b) => b.score - a.score)[0];
  const pick = (
    item: (typeof usable)[number] | undefined,
    placement: AssetPick["placement"],
    why: string,
  ): AssetPick[] =>
    item
      ? [
          {
            assetId: item.asset.id,
            source: item.asset.source,
            sourceId: item.asset.sourceId,
            title: item.asset.title,
            kind: item.asset.kind,
            alt: item.asset.alt,
            placement,
            ...(item.asset.approval.id ? { approvalId: item.asset.approval.id } : {}),
            ...(item.asset.rightsUntil ? { rightsUntil: item.asset.rightsUntil } : {}),
            why,
          },
        ]
      : [];
  const taken = new Set<string>();
  const logo = best(["logo"], taken);
  const banner = best(["hero", "lifestyle"], taken);
  if (banner) taken.add(banner.asset.id);
  // Short channels carry one image at most.
  const inline = request.channel === "email" ? best(["product", "lifestyle"], taken) : undefined;
  const why = (item: (typeof usable)[number] | undefined) =>
    item ? `Matches ${item.matched.join(", ")}.` : "";
  return {
    picked: [
      ...(request.channel === "email" ? pick(logo, "header", "The brand's approved logo.") : []),
      ...pick(banner, "banner", why(banner)),
      ...pick(inline, "inline", why(inline)),
    ],
    passed,
  };
}

/**
 * The images a channel version keeps: those its library allows on that channel, and on a push the
 * banner only. A text message carries none.
 */
export function assetsForChannel(picks: readonly AssetPick[], channel: Channel): AssetPick[] {
  if (channel === "sms") return [];
  return picks.filter((pick) => {
    const asset = ASSET_LIBRARY.find((item) => item.id === pick.assetId);
    if (!asset?.channels.includes(channel)) return false;
    return channel !== "push" || pick.placement === "banner";
  });
}
