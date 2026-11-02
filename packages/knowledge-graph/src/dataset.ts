/**
 * Deterministic, fictional knowledge-graph dataset for the Northstar demo. Every name, figure,
 * and relationship is invented; personas are buying roles, not people, and engagement is
 * aggregated. The same generator feeds the Aura seed script and the local fixture backend.
 *
 * Northstar is the parent brand; Coastline Kitchen is a restaurant brand under it. Coastline's
 * locations, menu, and app audiences come from the restaurant system (coastline.ts), and its
 * push campaigns run on the mobile app channel with the same consent, content, and segment
 * structure as every other campaign.
 */
import {
  COASTLINE,
  COASTLINE_INVENTORY,
  COASTLINE_LOCATIONS,
  COASTLINE_MENU,
  COASTLINE_RECIPES,
  COASTLINE_STORE_MANAGERS,
  DAYPART_HOURS,
  DAYPARTS,
  inventoryItemId,
  locationNodeId,
  menuItemId,
  NORTHSTAR_BRAND,
  slug,
  storeManagerId,
} from "./coastline.ts";
import {
  ADVISORS,
  approvalNodeId,
  CLIENT_TYPES,
  CLIENTS,
  clientId,
  DEAL,
  DEAL_ASSETS,
  DISCLOSURES,
  type DisclosureKey,
  disclosureId,
  GROWTH_ASSETS,
  GROWTH_CAMPAIGN,
  HARBORSTONE,
  HARBORSTONE_RULES,
  HARBORSTONE_SEGMENTS,
  type LibraryAsset,
  MARKET_ASSETS,
  MARKET_EVENTS,
  MARKET_MOMENTS_CAMPAIGN,
  type MarketEvent,
  marketEventId,
  PAST_RESPONSES,
  PRODUCTS,
  type ProductKey,
  productId,
  SIGNALS,
  type SignalKey,
  signalId,
} from "./harborstone.ts";
import { addPharma } from "./pharma.ts";

export const DATASET_VERSION = "northstar-kg-v2";

export type GraphNode = { id: string; label: string; name: string; [key: string]: unknown };
export type GraphRelationship = {
  type: string;
  from: string;
  to: string;
  properties?: Record<string, number | string>;
};
export type Dataset = { nodes: GraphNode[]; relationships: GraphRelationship[] };

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ACCOUNTS = [
  "Acme Outfitters",
  "Summit Trail Co.",
  "Redwood Rangers Club",
  "Harbor Point Sports",
  "Blue Ridge Adventures",
  "Pacific Crest Supply",
  "Granite Peak Gear",
  "Riverbend Outdoor",
  "Northwind Expeditions",
  "Cedar Hollow Camps",
  "Silverline Cycling",
  "Lakeside Paddle Co.",
] as const;

/** Each account's headquarters country (ISO 3166-1 alpha-2), for planning outreach around holidays. */
export const ACCOUNT_COUNTRIES: Record<(typeof ACCOUNTS)[number], { code: string; name: string }> =
  {
    "Acme Outfitters": { code: "US", name: "United States" },
    "Summit Trail Co.": { code: "CA", name: "Canada" },
    "Redwood Rangers Club": { code: "US", name: "United States" },
    "Harbor Point Sports": { code: "GB", name: "United Kingdom" },
    "Blue Ridge Adventures": { code: "US", name: "United States" },
    "Pacific Crest Supply": { code: "CA", name: "Canada" },
    "Granite Peak Gear": { code: "DE", name: "Germany" },
    "Riverbend Outdoor": { code: "US", name: "United States" },
    "Northwind Expeditions": { code: "NO", name: "Norway" },
    "Cedar Hollow Camps": { code: "US", name: "United States" },
    "Silverline Cycling": { code: "NL", name: "Netherlands" },
    "Lakeside Paddle Co.": { code: "AU", name: "Australia" },
  };

const ROLES = [
  { role: "Economic buyer", weight: 5 },
  { role: "Champion", weight: 6 },
  { role: "Marketing lead", weight: 4 },
  { role: "Operations manager", weight: 3 },
  { role: "Procurement", weight: 2 },
  { role: "Technical evaluator", weight: 3 },
] as const;

export const CAMPAIGNS = [
  {
    id: "camp-fall",
    name: "Fall Loyalty Reactivation",
    salesforceId: "701jV000004GglIQAS",
    status: "Active",
    channels: ["email"],
  },
  {
    id: "camp-winter",
    name: "Winter Gear Launch",
    status: "Active",
    channels: ["email", "mobile-app"],
  },
  { id: "camp-spring", name: "Spring Trail Series", status: "Planned", channels: ["email"] },
  { id: "camp-holiday", name: "Holiday Gift Guide", status: "Planned", channels: ["email", "sms"] },
  {
    id: "camp-summer",
    name: "Summer Hydration Push",
    status: "Completed",
    channels: ["mobile-app"],
  },
] as const;

const CONTENT_KINDS = ["Hero email", "Landing page", "Webinar invite"] as const;

const BRAND_RULES = [
  "Accessible alt text",
  "Warm, plain tone",
  "No unapproved claims",
  "Consent language present",
  "At most one emoji",
  "Legal footer",
] as const;

export const CHANNELS = ["email", "sms", "mobile-app"] as const;
const CHANNEL_NAMES: Record<(typeof CHANNELS)[number], string> = {
  email: "Email",
  sms: "SMS",
  "mobile-app": "Mobile app",
};
const CONSENT_IDS: Record<(typeof CHANNELS)[number], string> = {
  email: "consent-email-marketing",
  sms: "consent-sms-marketing",
  "mobile-app": "consent-push-marketing",
};
export const consentScopeFor = (channel: (typeof CHANNELS)[number]) => CONSENT_IDS[channel];

export const LOCATIONS = COASTLINE_LOCATIONS.map((location) => ({
  id: location.id,
  name: `${COASTLINE.name} ${location.city}`,
}));

/** Campaign-relevant weather buckets; "heat" means feels-like of 85°F or more. */
export const CONDITIONS = ["clear", "cloudy", "fog", "rain", "heat"] as const;

const ANGLES = {
  heat: "Beat the heat",
  rain: "Rainy-day comfort",
  fog: "Foggy-day warm-up",
  clear: "Perfect weather treat",
  cloudy: "Everyday favorite",
  late: "Late-night craving",
  morning: "Morning fuel",
} as const;
type AngleKey = keyof typeof ANGLES;

/** Coastline's push campaigns on the mobile app channel, and the message angles each owns. */
export const COASTLINE_CAMPAIGNS = [
  {
    id: "camp-coastline-weather",
    name: "Coastline Weather Moments",
    status: "Active",
    angles: ["heat", "rain", "fog", "clear", "cloudy"] as AngleKey[],
  },
  {
    id: "camp-coastline-mornings",
    name: "Coastline Morning Fuel",
    status: "Active",
    angles: ["morning"] as AngleKey[],
  },
  {
    id: "camp-coastline-late-night",
    name: "Coastline Late-Night Cravings",
    status: "Active",
    angles: ["late"] as AngleKey[],
  },
] as const;

/** Coastline's email campaign: its own content per angle, sent under email marketing consent. */
export const COASTLINE_EMAIL_CAMPAIGN = {
  id: "camp-coastline-lunch-letter",
  name: "Coastline Lunch Letter",
  status: "Active",
} as const;

/** How much a dish's orders rise or fall with the daypart and weather it's sent in. */
function demandLift(
  item: (typeof COASTLINE_MENU)[number],
  daypart: (typeof DAYPARTS)[number],
  condition: (typeof CONDITIONS)[number],
) {
  let lift = item.dayparts.includes(daypart) ? 0.02 : -0.01;
  if (condition === "heat")
    lift += item.serves === "cold" ? 0.03 : item.serves === "hot" ? -0.015 : 0;
  if (condition === "rain" || condition === "fog")
    lift += item.serves === "hot" ? 0.025 : item.serves === "cold" ? -0.015 : 0;
  return lift;
}

const angleFor = (
  daypart: (typeof DAYPARTS)[number],
  condition: (typeof CONDITIONS)[number],
): AngleKey =>
  daypart === "late-night"
    ? "late"
    : daypart === "early-morning" || daypart === "breakfast"
      ? "morning"
      : condition;

export const ALL_CAMPAIGNS = [
  ...CAMPAIGNS.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
  })),
  ...COASTLINE_CAMPAIGNS.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
  })),
  { ...COASTLINE_EMAIL_CAMPAIGN },
  { ...MARKET_MOMENTS_CAMPAIGN },
  { id: DEAL.campaign.id, name: DEAL.campaign.name, status: DEAL.campaign.status },
  { ...GROWTH_CAMPAIGN },
];

export const coastlineSegmentId = (location: string) => `segment-coastline-${location}`;

export function buildDataset(seed = 20260926): Dataset {
  const rand = random(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)] as T;
  const nodes: GraphNode[] = [];
  const relationships: GraphRelationship[] = [];
  const node = (label: string, id: string, name: string, extra: Record<string, unknown> = {}) => {
    nodes.push({ id, label, name, ...extra });
    return id;
  };
  const rel = (
    type: string,
    from: string,
    to: string,
    properties?: GraphRelationship["properties"],
  ) => relationships.push({ type, from, to, ...(properties ? { properties } : {}) });

  // Brands: Coastline Kitchen is a brand under Northstar.
  node("Brand", NORTHSTAR_BRAND.id, NORTHSTAR_BRAND.name, { kind: "parent brand" });
  node("Brand", COASTLINE.id, COASTLINE.name, {
    kind: "restaurant brand",
    concept: COASTLINE.concept,
    hours: COASTLINE.hours,
    voice: COASTLINE.brandVoice,
    restaurantId: COASTLINE.restaurantId,
  });
  rel("PART_OF", COASTLINE.id, NORTHSTAR_BRAND.id);

  // Channels and the marketing consent each requires.
  for (const channel of CHANNELS) {
    node("Channel", `channel-${channel}`, CHANNEL_NAMES[channel], {
      channelId: channel,
      ...(channel === "mobile-app" ? { delivers: "push notifications" } : {}),
    });
    const scope = node(
      "ConsentScope",
      CONSENT_IDS[channel],
      channel === "mobile-app" ? "push marketing" : `${channel} marketing`,
      { channel, purpose: "marketing" },
    );
    rel("FOR", scope, `channel-${channel}`);
  }
  node("ConsentScope", "consent-email-transactional", "email transactional", {
    channel: "email",
    purpose: "transactional",
  });
  rel("FOR", "consent-email-transactional", "channel-email");

  const ruleIds = BRAND_RULES.map((rule) => {
    const id = node("BrandRule", `rule-${slug(rule)}`, rule);
    rel("RULE_OF", id, NORTHSTAR_BRAND.id);
    return id;
  });
  const coastlineRuleIds = COASTLINE.promotionRules.map((rule) => {
    const id = node("BrandRule", `rule-${slug(rule)}`, rule);
    rel("RULE_OF", id, COASTLINE.id);
    return id;
  });

  const assetsByCampaign = new Map<string, string[]>();
  for (const campaign of CAMPAIGNS) {
    node("Campaign", campaign.id, campaign.name, {
      status: campaign.status,
      ...("salesforceId" in campaign ? { salesforceId: campaign.salesforceId } : {}),
    });
    rel("BELONGS_TO", campaign.id, NORTHSTAR_BRAND.id);
    for (const channel of campaign.channels) rel("ON", campaign.id, `channel-${channel}`);
    const brief = node("Brief", `brief-${campaign.id}`, `${campaign.name} brief`);
    rel("FOR", brief, campaign.id);
    const assets = CONTENT_KINDS.map((kind) => {
      const asset = node(
        "ContentAsset",
        `asset-${campaign.id}-${slug(kind)}`,
        `${campaign.name} · ${kind}`,
        { kind },
      );
      rel("USES", campaign.id, asset);
      rel("BUILT_FROM", asset, brief);
      for (const [index, ruleId] of ruleIds.entries()) {
        if ((index + CONTENT_KINDS.indexOf(kind)) % 2 === 1) continue;
        // The fall hero email fails alt text, matching the readiness blocker in the demo.
        const failed =
          (campaign.id === "camp-fall" &&
            kind === "Hero email" &&
            ruleId === "rule-accessible-alt-text") ||
          rand() < 0.08;
        rel(failed ? "FAILED" : "PASSED", asset, ruleId);
      }
      return asset;
    });
    assetsByCampaign.set(campaign.id, assets);
    node("Segment", `segment-${campaign.id}`, `${campaign.name} audience`);
    rel("TARGETS", campaign.id, `segment-${campaign.id}`);
  }

  for (const [accountIndex, account] of ACCOUNTS.entries()) {
    const accountId = node(
      "Account",
      `acct-${String(accountIndex + 1).padStart(2, "0")}`,
      account,
      {
        country: ACCOUNT_COUNTRIES[account].code,
        countryName: ACCOUNT_COUNTRIES[account].name,
      },
    );
    const roles = ROLES.filter(() => rand() < 0.75);
    for (const { role, weight } of roles.length >= 3 ? roles : ROLES.slice(0, 3)) {
      const persona = node("Persona", `${accountId}-${slug(role)}`, `${account} · ${role}`, {
        role,
        roleWeight: weight,
      });
      rel("WORKS_AT", persona, accountId);
      for (const campaign of CAMPAIGNS) {
        if (rand() < 0.45) rel("INCLUDES", `segment-${campaign.id}`, persona);
        for (const asset of assetsByCampaign.get(campaign.id) ?? [])
          if (rand() < 0.22)
            rel("ENGAGED_WITH", persona, asset, {
              count: 1 + Math.floor(rand() * 6),
              lastDaysAgo: 1 + Math.floor(rand() * 60),
            });
      }
      if (rand() < 0.7) rel("HAS_CONSENT", persona, "consent-email-marketing");
      if (rand() < 0.4) rel("HAS_CONSENT", persona, "consent-sms-marketing");
      if (rand() < 0.5) rel("HAS_CONSENT", persona, "consent-push-marketing");
      rel("HAS_CONSENT", persona, "consent-email-transactional");
    }
  }

  // Coastline Kitchen's own entities: locations, its menu, menu items, and dayparts.
  for (const daypart of DAYPARTS)
    node("Daypart", `daypart-${daypart}`, daypart, { hours: DAYPART_HOURS[daypart] });
  for (const condition of CONDITIONS) node("WeatherCondition", `weather-${condition}`, condition);
  node("Menu", COASTLINE.menu.id, COASTLINE.menu.name);
  rel("MENU_OF", COASTLINE.menu.id, COASTLINE.id);
  const menuIds = COASTLINE_MENU.map((item) => {
    const id = node("MenuItem", menuItemId(item.name), item.name, {
      serves: item.serves,
      price: item.price,
      tags: [...item.tags],
    });
    rel("ON_MENU", id, COASTLINE.menu.id);
    for (const daypart of item.dayparts) rel("AVAILABLE_DURING", id, `daypart-${daypart}`);
    return id;
  });
  // What each dish is made with, per serving, from the stock each restaurant keeps.
  for (const item of COASTLINE_INVENTORY)
    node("InventoryItem", inventoryItemId(item.id), item.name, { unit: item.unit });
  for (const item of COASTLINE_MENU)
    for (const [inventory, perServing] of COASTLINE_RECIPES[item.name] ?? [])
      rel("MADE_WITH", menuItemId(item.name), inventoryItemId(inventory), { perServing });
  for (const [rank, favorite] of COASTLINE.favorites.entries())
    rel("FAVORITE", COASTLINE.id, menuItemId(favorite.item), {
      note: favorite.note,
      rank: rank + 1,
    });

  // Each location has an app audience segment with aggregate marketing consent per channel
  // (no individuals): push, email, and SMS opt-ins are counted separately.
  for (const location of COASTLINE_LOCATIONS) {
    const locationId = node(
      "Location",
      locationNodeId(location.id),
      `${COASTLINE.name} ${location.city}`,
      {
        city: location.city,
        weatherLocation: location.id,
        neighborhood: location.neighborhood,
        address: location.address,
        hours: COASTLINE.hours,
      },
    );
    rel("OPERATES", COASTLINE.id, locationId);
    const manager = COASTLINE_STORE_MANAGERS[location.id];
    node("StoreManager", storeManagerId(location.id), manager.name, { role: "Store manager" });
    rel("MANAGED_BY", locationId, storeManagerId(location.id));
    rel("SERVES", locationId, COASTLINE.menu.id);
    const segment = node(
      "Segment",
      coastlineSegmentId(location.id),
      `Coastline app · ${location.city}`,
      {
        size: location.appUsers,
        audienceType: "app users",
      },
    );
    rel("NEAR", segment, locationId);
    for (const [channel, optedIn] of [
      ["mobile-app", location.pushOptIns],
      ["email", location.emailOptIns],
      ["sms", location.smsOptIns],
    ] as const)
      rel("HAS_CONSENT", segment, CONSENT_IDS[channel], {
        optedIn,
        coverageRate: Math.round((optedIn / location.appUsers) * 1000) / 1000,
      });
  }

  // Coastline's push campaigns: brief, push content per angle, location segments, mobile app.
  const assetByAngle = new Map<AngleKey, { campaign: string; asset: string }>();
  for (const campaign of COASTLINE_CAMPAIGNS) {
    node("Campaign", campaign.id, campaign.name, { status: campaign.status });
    rel("BELONGS_TO", campaign.id, COASTLINE.id);
    rel("ON", campaign.id, "channel-mobile-app");
    const brief = node("Brief", `brief-${campaign.id}`, `${campaign.name} brief`);
    rel("FOR", brief, campaign.id);
    for (const location of COASTLINE_LOCATIONS)
      rel("TARGETS", campaign.id, coastlineSegmentId(location.id));
    for (const angle of campaign.angles) {
      const asset = node(
        "ContentAsset",
        `asset-${campaign.id}-${slug(ANGLES[angle])}`,
        `${ANGLES[angle]} · push`,
        { kind: "Push notification", angle: ANGLES[angle] },
      );
      rel("USES", campaign.id, asset);
      rel("BUILT_FROM", asset, brief);
      for (const ruleId of [...coastlineRuleIds, "rule-at-most-one-emoji"])
        rel(rand() < 0.1 ? "FAILED" : "PASSED", asset, ruleId);
      assetByAngle.set(angle, { campaign: campaign.id, asset });
    }
  }

  // Fictional push history: order rates rise when the item suits the weather and daypart.
  const rates = new Map<string, number[]>();
  for (let index = 0; index < 1500; index += 1) {
    const location = pick(COASTLINE_LOCATIONS).id;
    const daypart = pick(DAYPARTS);
    const condition = pick(CONDITIONS);
    const itemIndex = Math.floor(rand() * COASTLINE_MENU.length);
    const item = COASTLINE_MENU[itemIndex] as (typeof COASTLINE_MENU)[number];
    const lift = demandLift(item, daypart, condition);
    const orderRate = Math.max(0.005, 0.03 + lift + (rand() - 0.5) * 0.02);
    const openRate = Math.max(0.02, 0.07 + lift * 0.8 + (rand() - 0.5) * 0.03);
    const angleKey = angleFor(daypart, condition);
    const angle = ANGLES[angleKey];
    const push = node(
      "PushSend",
      `push-${String(index + 1).padStart(4, "0")}`,
      `${angle}: ${item.name}`,
      {
        angle,
        orderRate: Math.round(orderRate * 10000) / 10000,
        openRate: Math.round(openRate * 10000) / 10000,
      },
    );
    const content = assetByAngle.get(angleKey) as { campaign: string; asset: string };
    rel("PART_OF", push, content.campaign);
    rel("USED", push, content.asset);
    rel("SENT_TO", push, coastlineSegmentId(location));
    rel("ON", push, "channel-mobile-app");
    rel("SENT_UNDER", push, CONSENT_IDS["mobile-app"]);
    rel("FEATURED", push, menuIds[itemIndex] as string);
    rel("FOR", push, locationNodeId(location));
    rel("SENT_DURING", push, `daypart-${daypart}`);
    rel("UNDER", push, `weather-${condition}`);
    for (const key of [item.name, `${item.name}|${condition}`])
      rates.set(key, [...(rates.get(key) ?? []), orderRate]);
  }

  // Weather that lifts a dish's demand, learned from that history: the dish's average order rate
  // under the condition against its average overall, kept when it's at least 15% higher.
  const mean = (values: number[] = []) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  for (const condition of CONDITIONS)
    for (const item of COASTLINE_MENU) {
      const under = rates.get(`${item.name}|${condition}`) ?? [];
      const lift = mean(under) / mean(rates.get(item.name));
      if (under.length >= 10 && lift >= 1.15)
        rel("LIFTS_DEMAND", `weather-${condition}`, menuItemId(item.name), {
          lift: Math.round(lift * 100) / 100,
          sends: under.length,
        });
    }

  // Fictional email history: Coastline's email campaign, email content per angle, and sends
  // under email marketing consent. Its own seed leaves the push history and lifts above as they were.
  const emailRand = random(seed + 1);
  const emailPick = <T>(items: readonly T[]) => items[Math.floor(emailRand() * items.length)] as T;
  const email = COASTLINE_EMAIL_CAMPAIGN;
  node("Campaign", email.id, email.name, { status: email.status });
  rel("BELONGS_TO", email.id, COASTLINE.id);
  rel("ON", email.id, "channel-email");
  const emailBrief = node("Brief", `brief-${email.id}`, `${email.name} brief`);
  rel("FOR", emailBrief, email.id);
  for (const location of COASTLINE_LOCATIONS)
    rel("TARGETS", email.id, coastlineSegmentId(location.id));
  const emailAssets = new Map<AngleKey, string>();
  for (const angleKey of Object.keys(ANGLES) as AngleKey[]) {
    const asset = node(
      "ContentAsset",
      `asset-${email.id}-${slug(ANGLES[angleKey])}`,
      `${ANGLES[angleKey]} · email`,
      { kind: "Email", angle: ANGLES[angleKey] },
    );
    rel("USES", email.id, asset);
    rel("BUILT_FROM", asset, emailBrief);
    for (const ruleId of coastlineRuleIds)
      rel(emailRand() < 0.1 ? "FAILED" : "PASSED", asset, ruleId);
    emailAssets.set(angleKey, asset);
  }
  for (let index = 0; index < 600; index += 1) {
    const location = emailPick(COASTLINE_LOCATIONS).id;
    const daypart = emailPick(DAYPARTS);
    const condition = emailPick(CONDITIONS);
    const itemIndex = Math.floor(emailRand() * COASTLINE_MENU.length);
    const item = COASTLINE_MENU[itemIndex] as (typeof COASTLINE_MENU)[number];
    const lift = demandLift(item, daypart, condition);
    // Email opens far more often than push, and converts less often per send.
    const orderRate = Math.max(0.003, 0.018 + lift * 0.7 + (emailRand() - 0.5) * 0.012);
    const openRate = Math.max(0.08, 0.26 + lift * 1.2 + (emailRand() - 0.5) * 0.06);
    const clickRate = Math.max(0.01, 0.045 + lift * 0.8 + (emailRand() - 0.5) * 0.02);
    const angleKey = angleFor(daypart, condition);
    const send = node(
      "EmailSend",
      `email-${String(index + 1).padStart(4, "0")}`,
      `${ANGLES[angleKey]}: ${item.name}`,
      {
        angle: ANGLES[angleKey],
        orderRate: Math.round(orderRate * 10000) / 10000,
        openRate: Math.round(openRate * 10000) / 10000,
        clickRate: Math.round(clickRate * 10000) / 10000,
      },
    );
    rel("PART_OF", send, email.id);
    rel("USED", send, emailAssets.get(angleKey) as string);
    rel("SENT_TO", send, coastlineSegmentId(location));
    rel("ON", send, "channel-email");
    rel("SENT_UNDER", send, CONSENT_IDS.email);
    rel("FEATURED", send, menuIds[itemIndex] as string);
    rel("FOR", send, locationNodeId(location));
    rel("SENT_DURING", send, `daypart-${daypart}`);
    rel("UNDER", send, `weather-${condition}`);
  }
  addHarborstone(node, rel, random(seed + 2));
  addPharma(node, rel, NORTHSTAR_BRAND.id);
  return { nodes, relationships };
}

/**
 * Harborstone Wealth, a wealth-management brand under Northstar: pre-approved regulated content
 * with its approvals and disclosures, an embargoed acquisition package, and institutional
 * clients with their holdings, signals, and contacts. Its own seed leaves everything above as it was.
 */
function addHarborstone(
  node: (label: string, id: string, name: string, extra?: Record<string, unknown>) => string,
  rel: (
    type: string,
    from: string,
    to: string,
    properties?: GraphRelationship["properties"],
  ) => void,
  rand: () => number,
) {
  node("Brand", HARBORSTONE.id, HARBORSTONE.name, {
    kind: "wealth management brand",
    voice: HARBORSTONE.voice,
  });
  rel("PART_OF", HARBORSTONE.id, NORTHSTAR_BRAND.id);
  const ruleIds = HARBORSTONE_RULES.map((rule) => {
    const id = node("BrandRule", `rule-${slug(rule)}`, rule);
    rel("RULE_OF", id, HARBORSTONE.id);
    return id;
  });
  for (const [key, disclosure] of Object.entries(DISCLOSURES))
    node("Disclosure", disclosureId(key as DisclosureKey), disclosure.name, {
      text: disclosure.text,
    });
  for (const [key, name] of Object.entries(MARKET_EVENTS))
    node("MarketEvent", marketEventId(key as MarketEvent), name);
  for (const [key, name] of Object.entries(PRODUCTS)) {
    node("Product", productId(key as ProductKey), name);
    rel("OFFERS", HARBORSTONE.id, productId(key as ProductKey));
  }
  for (const [key, signal] of Object.entries(SIGNALS)) {
    node("Signal", signalId(key as SignalKey), signal.name);
    for (const [product, capture, why] of signal.suggests)
      rel("SUGGESTS", signalId(key as SignalKey), productId(product), { capture, why });
  }

  // Audiences, with aggregate consent per scope.
  for (const segment of HARBORSTONE_SEGMENTS) {
    node("Segment", segment.id, segment.name, {
      size: segment.size,
      audienceType: segment.audienceType,
    });
    for (const [scope, optedIn] of segment.consent)
      rel("HAS_CONSENT", segment.id, scope, {
        optedIn,
        coverageRate: Math.round((optedIn / segment.size) * 1000) / 1000,
      });
  }

  // Each asset: its approval record, required disclosures, approved channel, and rule results.
  const addAsset = (asset: LibraryAsset, campaign: string, brief: string) => {
    node("ContentAsset", asset.id, asset.name, {
      kind: asset.kind,
      ...(asset.channel ? { channel: asset.channel } : {}),
    });
    rel("USES", campaign, asset.id);
    rel("BUILT_FROM", asset.id, brief);
    const approval = approvalNodeId(asset.approval.id);
    node("Approval", approval, asset.approval.id, {
      status: asset.approval.status,
      reviewer: "Registered principal",
      ...(asset.approval.approvedOn ? { approvedOn: asset.approval.approvedOn } : {}),
      ...(asset.approval.expiresOn ? { expiresOn: asset.approval.expiresOn } : {}),
      ...(asset.approval.embargoed ? { embargoed: true } : {}),
    });
    rel("APPROVED_UNDER", asset.id, approval);
    for (const disclosure of asset.disclosures) rel("REQUIRES", asset.id, disclosureId(disclosure));
    if (asset.channel) rel("APPROVED_FOR", asset.id, `channel-${asset.channel}`);
    for (const [index, ruleId] of ruleIds.entries())
      rel(asset.failed === HARBORSTONE_RULES[index] ? "FAILED" : "PASSED", asset.id, ruleId);
    if (asset.event) rel("RESPONDS_TO", asset.id, marketEventId(asset.event));
    for (const product of asset.explains ?? []) rel("EXPLAINS", asset.id, productId(product));
  };
  const addCampaign = (
    campaign: { id: string; name: string; status: string },
    channels: string[],
    segments: string[],
  ) => {
    node("Campaign", campaign.id, campaign.name, { status: campaign.status });
    rel("BELONGS_TO", campaign.id, HARBORSTONE.id);
    for (const channel of channels) rel("ON", campaign.id, `channel-${channel}`);
    for (const segment of segments) rel("TARGETS", campaign.id, segment);
    const brief = node("Brief", `brief-${campaign.id}`, `${campaign.name} brief`);
    rel("FOR", brief, campaign.id);
    return brief;
  };

  const momentsBrief = addCampaign(
    MARKET_MOMENTS_CAMPAIGN,
    ["email", "sms"],
    ["segment-harborstone-clients", "segment-harborstone-subscribers"],
  );
  for (const asset of MARKET_ASSETS) addAsset(asset, MARKET_MOMENTS_CAMPAIGN.id, momentsBrief);
  for (const response of PAST_RESPONSES) {
    const asset = MARKET_ASSETS.find((candidate) => candidate.id === response.asset);
    const id = node(
      "ClientSend",
      response.id,
      `${asset?.name ?? response.asset} (${response.hoursAfterNews}h after the news)`,
      {
        hoursAfterNews: response.hoursAfterNews,
        openRate: response.openRate,
        clickRate: response.clickRate,
      },
    );
    rel("PART_OF", id, MARKET_MOMENTS_CAMPAIGN.id);
    rel("USED", id, response.asset);
    rel("RESPONDS_TO", id, marketEventId(response.event));
    rel("SENT_TO", id, "segment-harborstone-clients");
    rel("ON", id, "channel-email");
    rel("SENT_UNDER", id, "consent-email-marketing");
  }

  // The acquisition: the deal, the firm, and its announcement package in release order.
  node("Firm", DEAL.firm.id, DEAL.firm.name, { clients: DEAL.firm.clients });
  node("Deal", DEAL.id, DEAL.name, { status: DEAL.status });
  rel("ANNOUNCED_BY", DEAL.id, HARBORSTONE.id);
  rel("ACQUIRES", DEAL.id, DEAL.firm.id);
  rel("CLIENT_OF", "segment-bayview-clients", DEAL.firm.id);
  const dealBrief = addCampaign(
    DEAL.campaign,
    ["email", "sms"],
    ["segment-bayview-clients", "segment-harborstone-clients", "segment-harborstone-advisors"],
  );
  rel("ANNOUNCES", DEAL.campaign.id, DEAL.id);
  for (const asset of DEAL_ASSETS) {
    addAsset(asset, DEAL.campaign.id, dealBrief);
    rel("RELEASED_WITH", asset.id, DEAL.id, {
      step: asset.step,
      timing: asset.timing,
      purpose: asset.purpose,
    });
    if (asset.audience) rel("ADDRESSED_TO", asset.id, asset.audience, { purpose: asset.purpose });
  }

  // Relationship growth: product explainers, advisors, and clients with holdings and signals.
  const growthBrief = addCampaign(GROWTH_CAMPAIGN, ["email"], ["segment-harborstone-clients"]);
  for (const asset of GROWTH_ASSETS) addAsset(asset, GROWTH_CAMPAIGN.id, growthBrief);
  for (const advisor of Object.values(ADVISORS)) {
    node("Advisor", advisor.id, advisor.name, { title: advisor.title });
    rel("ADVISES_FOR", advisor.id, HARBORSTONE.id);
  }
  const engageable = [...GROWTH_ASSETS, ...MARKET_ASSETS]
    .filter((asset) => asset.approval.status === "Approved")
    .map((asset) => asset.id);
  for (const client of CLIENTS) {
    const type = CLIENT_TYPES[client.type];
    const id = node("Client", clientId(client.name), client.name, {
      clientType: type.name,
      aum: Object.values(client.holds).reduce((sum, amount) => sum + amount, 0),
      heldAwayEstimate: client.heldAway,
    });
    rel("CLIENT_OF", id, HARBORSTONE.id);
    rel("COVERED_BY", id, ADVISORS[type.advisor].id);
    for (const [product, aum] of Object.entries(client.holds))
      rel("HOLDS", id, productId(product as ProductKey), { aum });
    for (const [signal, detectedDaysAgo, detail] of client.signals)
      rel("HAS_SIGNAL", id, signalId(signal), { detectedDaysAgo, detail });
    for (const [role, weight] of type.roles) {
      const persona = node("Persona", `${id}-${slug(role)}`, `${client.name} · ${role}`, {
        role,
        roleWeight: weight,
      });
      rel("WORKS_AT", persona, id);
      if (rand() < 0.8) rel("HAS_CONSENT", persona, "consent-email-marketing");
      if (rand() < 0.35) rel("HAS_CONSENT", persona, "consent-sms-marketing");
      rel("HAS_CONSENT", persona, "consent-email-transactional");
      for (const asset of engageable)
        if (rand() < 0.18)
          rel("ENGAGED_WITH", persona, asset, {
            count: 1 + Math.floor(rand() * 4),
            lastDaysAgo: 1 + Math.floor(rand() * 45),
          });
    }
  }
}
