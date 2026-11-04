import {
  CAMPAIGN_CONTEXT_TOOLS,
  EXTERNAL_SERVICE_TOOLS,
  LIFE_SCIENCES_TOOLS,
  type FocusItem,
  FocusKindSchema,
  type InsightTile,
  type TileItem,
  type InventoryRisk,
  KNOWLEDGE_GRAPH_TOOLS,
  MEMORY_TOOLS,
  ORCHESTRATOR_TOOLS,
  READINESS_PRESENTATION,
  type RecordRef,
  recordKey,
  systemLabel,
  WORKSPACE_CATALOG,
  type WorkingRecord,
  type WorkingSet,
} from "../../../packages/contracts/src/index.ts";
import type { MemoryView } from "../../../packages/knowledge-graph/src/index.ts";
import { focusPrompt } from "./focus.ts";

/**
 * Builds the chat's working set from tool results. Everything here is deterministic: cards and
 * records come from what tools returned, never from model-written text, so nothing in the
 * workspace is invented.
 */

export const MAX_CARDS = 12;
export const MAX_RECORDS = 20;

type Payload = { data: Record<string, unknown> | null; text: string };
export type ToolResultEvent = { toolName: string; input: unknown; output: unknown; at: Date };

/** The orchestrator tool a prefixed key refers to, such as `graph_explain_buyer_group`. */
export function baseToolName(key: string): string | null {
  const names = [...ORCHESTRATOR_TOOLS].sort((a, b) => b.length - a.length);
  return names.find((name) => key === name || key.endsWith(`_${name}`)) ?? null;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads an MCP tool result: structured content when present, otherwise its text parts. */
export function toolPayload(output: unknown): Payload {
  if (!output || typeof output !== "object") return { data: null, text: String(output ?? "") };
  const result = output as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
    semanticStatus?: string;
  };
  const text = (result.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? (result.structuredContent as Record<string, unknown>)
      : null;
  return { data: structured ?? parseJson(text), text };
}

export const isFailure = (output: unknown) =>
  Boolean(
    output &&
      typeof output === "object" &&
      ("semanticStatus" in output ||
        (output as { isError?: boolean }).isError === true ||
        "error" in (toolPayload(output).data ?? {})),
  );

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const titleCase = (name: string) =>
  name
    .replaceAll("_", " ")
    .replace(
      /([a-z])([A-Z])/g,
      (_, lower: string, upper: string) => `${lower} ${upper.toLowerCase()}`,
    )
    .replace(/^./, (first) => first.toUpperCase());

/** Bulleted or numbered lines from agent text, for card details. */
function bulletLines(text: string, max = 4) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line))
    .map((line) =>
      clip(
        line
          .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
          .replace(/\*\*|__|`/g, "")
          .trim(),
        120,
      ),
    )
    .filter(Boolean)
    .slice(0, max);
}

/** The first prose sentence or two of agent text, without Markdown decoration. */
function leadText(text: string) {
  const prose = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:[-*•|#]|\d+[.)])/.test(line))
    .join(" ")
    .replace(/\*\*|__|`/g, "");
  return clip(prose || text.replace(/\s+/g, " ").trim(), 220);
}

// Salesforce ids for the object types the workbench works with.
const SALESFORCE_ID = /\b((?:701|001|00T|003|00Q)[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?)\b/g;
const SALESFORCE_OBJECT_BY_PREFIX: Record<string, string> = {
  "701": "Campaign",
  "001": "Account",
  "00T": "Task",
  "003": "Contact",
  "00Q": "Lead",
};

/** Salesforce records named in a tool's input or output: by id, or a catalog record by name. */
export function salesforceRecordsIn(text: string): Array<RecordRef & { title: string }> {
  const found = new Map<string, RecordRef & { title: string }>();
  for (const match of text.matchAll(SALESFORCE_ID)) {
    const id = match[1] ?? "";
    const catalog = WORKSPACE_CATALOG.find(
      (entry) => entry.system === "salesforce" && id.startsWith(entry.recordId.slice(0, 15)),
    );
    const objectType = SALESFORCE_OBJECT_BY_PREFIX[id.slice(0, 3)] ?? "Record";
    const ref = catalog ?? {
      system: "salesforce",
      objectType,
      recordId: id,
      title: `${objectType} ${id}`,
    };
    found.set(recordKey(ref), ref);
  }
  const lower = text.toLowerCase();
  for (const entry of WORKSPACE_CATALOG)
    if (entry.system === "salesforce" && lower.includes(entry.title.toLowerCase()))
      found.set(recordKey(entry), entry);
  return [...found.values()];
}

function record(
  ref: RecordRef & { title: string },
  via: string,
  at: Date,
  relation: WorkingRecord["relation"] = "read",
): WorkingRecord {
  return {
    ...ref,
    key: recordKey(ref),
    systemLabel: systemLabel(ref.system),
    relation,
    via,
    addedAt: at.toISOString(),
  };
}

type Ingested = { cards: InsightTile[]; records: WorkingRecord[] };

function weatherCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  const weather = (data.weather ?? data) as Record<string, unknown>;
  const city = str(weather.city) ?? "California";
  const temperature = num(weather.temperatureF);
  const condition = str(weather.condition) ?? "unknown";
  return {
    cards: [
      {
        id: `weather:${city.toLowerCase().replace(/\W+/g, "-")}`,
        kind: "weather",
        eyebrow: "Weather",
        title: `${condition[0]?.toUpperCase()}${condition.slice(1)} in ${city}`,
        summary: `Feels like ${num(weather.feelsLikeF) ?? "?"}°F with ${num(weather.windMph) ?? "?"} mph wind; observed ${str(weather.observedAtLocal)?.replace("T", " ") ?? "just now"} local time.`,
        metric: temperature === undefined ? undefined : `${temperature}°F`,
        trend: weather.isDay === false ? "night" : "day",
        state: "ready",
        source: {
          system: "open-meteo",
          label: "Open-Meteo · live",
          freshness: "just now",
          status: "ready",
        },
        details: [`Precipitation ${num(weather.precipitationIn) ?? 0} in`],
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

/** Public holidays (Nager.Date) or weather alerts (National Weather Service) as a context card. */
function forecastCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  const city = str(data.city) ?? "California";
  const days = list(data.days).map((day) => day as Record<string, unknown>);
  return {
    cards: [
      {
        id: `forecast:${city.toLowerCase().replace(/\W+/g, "-")}`,
        kind: "weather",
        eyebrow: "Forecast",
        title: city,
        summary: days
          .map(
            (day) =>
              `${str(day.date)?.slice(5)}: ${str(day.demandCondition)}, high ${num(day.highF)}°F`,
          )
          .join(" · "),
        metric: String(days.length),
        trend: "days",
        state: "ready",
        source: {
          system: "open-meteo",
          label: "Open-Meteo · forecast",
          freshness: "just now",
          status: "ready",
        },
        details: list(data.demandConditions).map(
          (condition) => `Demand planning: ${String(condition)}`,
        ),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

function inventoryCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  const city = str(data.city) ?? "Location";
  const items = list(data.items).map((item) => item as Record<string, unknown>);
  const thin = items
    .filter((item) => (num(item.daysOfCover) ?? 99) < 1.5)
    .map((item) => `${str(item.name)}: ${num(item.daysOfCover)} days of cover`);
  return {
    cards: [
      {
        id: `inventory:${str(data.location) ?? city}`,
        kind: "context",
        eyebrow: "Store inventory",
        title: `Coastline Kitchen ${city}`,
        summary: `${items.length} items counted ${str(data.countedAt) ?? "today"}; ${thin.length} under a day and a half of typical use.`,
        metric: String(items.length),
        trend: "items",
        state: "ready",
        source: {
          system: "store-inventory",
          label: "Store inventory · randomized mock",
          freshness: "just now",
          status: "ready",
        },
        details: thin.slice(0, 6),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

/** A card for a mocked life-sciences system of record: what it is, and the headline from its answer. */
const LIFE_SCIENCES_LABELS: Record<string, string> = {
  aprimo_search_approved_assets: "Aprimo: approved assets",
  aprimo_get_mlr_review: "Aprimo: MLR review",
  reltio_resolve_organization: "Reltio: golden record",
  vault_list_approved_claims: "Veeva Vault: claims library",
  vault_get_prescribing_information: "Veeva Vault: label",
  screendragon_list_jobs: "Screendragon: jobs",
  screendragon_get_job: "Screendragon: job",
  iqvia_get_prescribing_trends: "IQVIA: prescribing trends",
  lsc_get_call_plan: "Life Sciences Cloud: call plan",
  drupal_list_hcp_site_content: "Drupal: HCP site",
};

/** An asset's standing: usable, waiting on review, or blocked, with the reason in words. */
function assetItem(asset: Record<string, unknown>): TileItem {
  const status = str(asset.status);
  const expiresOn = str(asset.expiresOn);
  const base = {
    title: str(asset.title) ?? "Asset",
    ...(str(asset.mlrApprovalId) ? { id: str(asset.mlrApprovalId) as string } : {}),
  };
  if (asset.usableNow)
    return {
      ...base,
      status: "ok",
      label: "Usable",
      ...(expiresOn ? { date: { label: "Approved until", value: expiresOn } } : {}),
    };
  if (status === "Pending") return { ...base, status: "warn", label: "Pending MLR review" };
  if (status === "Expired")
    return {
      ...base,
      status: "blocked",
      label: "Approval expired",
      ...(expiresOn ? { date: { label: "Expired", value: expiresOn } } : {}),
    };
  return { ...base, status: "blocked", label: "Failed a compliance check" };
}

/** One row per item the system returned: each asset, claim, job or page, and its standing. */
const LIFE_SCIENCES_ITEMS: Record<string, (data: Record<string, unknown>) => TileItem[]> = {
  aprimo_search_approved_assets: (data) =>
    (list(data.assets) as Array<Record<string, unknown>>)
      .map(assetItem)
      .sort((a, b) => ITEM_ORDER[a.status] - ITEM_ORDER[b.status]),
  vault_list_approved_claims: (data) =>
    (list(data.claims) as Array<Record<string, unknown>>).map((claim) => ({
      status: str(claim.status) === "Approved" ? "ok" : "blocked",
      label: str(claim.status) ?? "Unknown",
      title: clip(str(claim.text) ?? "Claim", 110),
      ...(str(claim.vaultClaimId) ? { id: str(claim.vaultClaimId) as string } : {}),
      ...(str(claim.reason) ? { note: str(claim.reason) as string } : {}),
    })),
  screendragon_list_jobs: (data) =>
    (list(data.jobs) as Array<Record<string, unknown>>).map((job) => ({
      status: job.atRisk ? "warn" : "info",
      label: job.atRisk
        ? `${str(job.stage) ?? "In progress"} · at risk`
        : (str(job.stage) ?? "In progress"),
      title: str(job.title) ?? "Job",
      ...(str(job.jobId) ? { id: str(job.jobId) as string } : {}),
      ...(str(job.dueOn) ? { date: { label: "Due", value: str(job.dueOn) as string } } : {}),
    })),
  drupal_list_hcp_site_content: (data) =>
    (list(data.pages) as Array<Record<string, unknown>>).map((page) => ({
      status: page.compliant ? "ok" : "blocked",
      label: page.compliant ? "Compliant" : "Not compliant",
      title: str(page.title) ?? "Page",
      ...(str(page.mlrApprovalId) ? { id: str(page.mlrApprovalId) as string } : {}),
    })),
};
/** Usable first, then waiting, then blocked. */
const ITEM_ORDER: Record<TileItem["status"], number> = { ok: 0, info: 1, warn: 2, blocked: 3 };

function lifeSciencesCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  const system = str(data.system) ?? "Life sciences system";
  const headline: Record<string, () => string> = {
    aprimo_search_approved_assets: () =>
      `${list(data.assets).length} assets, ${num(data.usableNow) ?? 0} usable now.`,
    aprimo_get_mlr_review: () =>
      `${str((data.review as Record<string, unknown> | undefined)?.mlrApprovalId) ?? "MLR review"}: ${str((data.review as Record<string, unknown> | undefined)?.status) ?? "unknown"}.`,
    reltio_resolve_organization: () =>
      `${str((data.organization as Record<string, unknown> | undefined)?.name) ?? "Organization"} resolved to one golden record.`,
    vault_list_approved_claims: () =>
      `${num(data.approved) ?? 0} claims approved, ${num(data.notApproved) ?? 0} not approved.`,
    vault_get_prescribing_information: () =>
      `Prescribing information ${str((data.label as Record<string, unknown> | undefined)?.currentVersion) ?? ""}.`,
    screendragon_list_jobs: () =>
      `${list(data.jobs).length} jobs, ${num(data.atRisk) ?? 0} at risk.`,
    screendragon_get_job: () =>
      `${str((data.job as Record<string, unknown> | undefined)?.title) ?? "Job"}.`,
    iqvia_get_prescribing_trends: () =>
      `${list((data.trends as Record<string, unknown> | undefined)?.rows).length} hospitals, six months of prescriptions.`,
    lsc_get_call_plan: () =>
      `${list((data.plan as Record<string, unknown> | undefined)?.groups).length} prescriber groups on the call plan.`,
    drupal_list_hcp_site_content: () =>
      `${list(data.pages).length} pages, ${num(data.nonCompliant) ?? 0} not compliant.`,
  };
  const key = JSON.stringify([
    tool,
    str(data.drug),
    str((data.review as Record<string, unknown> | undefined)?.mlrApprovalId),
    str((data.organization as Record<string, unknown> | undefined)?.name),
    str((data.plan as Record<string, unknown> | undefined)?.hospital),
    str((data.job as Record<string, unknown> | undefined)?.jobId),
  ]);
  return {
    cards: [
      {
        id: `ls:${key}`,
        kind: "context",
        eyebrow: system,
        title: LIFE_SCIENCES_LABELS[tool] ?? tool,
        summary: headline[tool]?.() ?? `${system} responded.`,
        state: "ready",
        source: {
          system: "life-sciences",
          label: system,
          freshness: "just now",
          status: "ready",
        },
        details: [],
        items: (LIFE_SCIENCES_ITEMS[tool]?.(data) ?? []).slice(0, 8),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

function externalCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  if (tool === "get_fed_announcements") {
    const decision = (data.latestDecision ?? null) as Record<string, unknown> | null;
    const releases = list(data.recentReleases).map((item) => item as Record<string, unknown>);
    const verb = { raise: "raised", lower: "lowered", maintain: "held" }[
      str(decision?.action) ?? ""
    ];
    return {
      cards: [
        {
          id: "fed:latest",
          kind: "context",
          eyebrow: "Federal Reserve",
          title: decision
            ? `Fed ${verb ?? "announced"} rates${str(decision.targetRange) ? ` to ${decision.targetRange}` : ""}`
            : "No rate decision in the latest releases",
          summary: decision
            ? `${str(decision.publishedAt)?.slice(0, 10) ?? "?"} FOMC statement, ${num(decision.hoursAgo) ?? "?"} hours ago. Event: ${str(decision.event) ?? "?"}.`
            : `${releases.length} recent monetary policy release${releases.length === 1 ? "" : "s"}.`,
          metric: decision ? (str(decision.change) ?? "no change") : undefined,
          trend: decision ? "rate move" : undefined,
          state: "ready",
          source: {
            system: "federal-reserve",
            label: "Federal Reserve · live",
            freshness: "just now",
            status: "ready",
          },
          details: releases
            .slice(0, 4)
            .map((release) => `${str(release.publishedAt)?.slice(0, 10)} · ${str(release.title)}`),
          updatedAt: at.toISOString(),
          toolName: tool,
        },
      ],
      records: [],
    };
  }
  if (tool === "get_public_holidays") {
    const country = str(data.country) ?? "?";
    const holidays = list(data.holidays).map((item) => item as Record<string, unknown>);
    return {
      cards: [
        {
          id: `holidays:${country.toLowerCase()}`,
          kind: "context",
          eyebrow: "Public holidays",
          title: `${holidays.length} holiday${holidays.length === 1 ? "" : "s"} in ${country}, next ${num(data.days) ?? 60} days`,
          summary: holidays.length
            ? `Next: ${str(holidays[0]?.name)} on ${str(holidays[0]?.date)}.`
            : "No public holidays in this window.",
          metric: String(holidays.length),
          trend: "holidays",
          state: "ready",
          source: {
            system: "nager-date",
            label: "Nager.Date · live",
            freshness: "just now",
            status: "ready",
          },
          details: holidays
            .slice(0, 4)
            .map(
              (holiday) =>
                `${str(holiday.date)} · ${str(holiday.name)}${holiday.scope === "regional" ? " (regional)" : ""}`,
            ),
          updatedAt: at.toISOString(),
          toolName: tool,
        },
      ],
      records: [],
    };
  }
  const city = str(data.city) ?? "California";
  const alerts = list(data.alerts).map((item) => item as Record<string, unknown>);
  return {
    cards: [
      {
        id: `alerts:${city.toLowerCase().replace(/\W+/g, "-")}`,
        kind: "weather",
        eyebrow: "Weather alerts",
        title: alerts.length
          ? `${str(alerts[0]?.event)} near ${city}`
          : `No active weather alerts near ${city}`,
        summary: alerts.length
          ? (str(alerts[0]?.headline) ??
            `${alerts.length} active alert${alerts.length === 1 ? "" : "s"}.`)
          : `${list(data.elsewhereInCalifornia).length} other active alert${list(data.elsewhereInCalifornia).length === 1 ? "" : "s"} in California.`,
        metric: String(alerts.length),
        trend: "active alerts",
        state: "ready",
        source: {
          system: "nws",
          label: "National Weather Service · live",
          freshness: "just now",
          status: "ready",
        },
        details: [
          ...alerts.slice(0, 3).map((alert) => `${str(alert.event)} · ${str(alert.severity)}`),
          ...list(data.elsewhereInCalifornia)
            .slice(0, alerts.length ? 1 : 3)
            .map((item) => `Elsewhere: ${String(item)}`),
        ].slice(0, 4),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

function restaurantCard(data: Record<string, unknown>, tool: string, at: Date): Ingested {
  const name = str(data.name) ?? "Restaurant";
  const id = str(data.id) ?? name.toLowerCase().replace(/\W+/g, "-");
  const location = (data.location ?? {}) as Record<string, unknown>;
  const favorites = list(data.favorites)
    .map((item) => (typeof item === "string" ? item : str((item as Record<string, unknown>)?.item)))
    .filter((item): item is string => Boolean(item));
  const menu = list(data.menu);
  return {
    cards: [
      {
        id: `restaurant:${id}`,
        kind: "restaurant",
        eyebrow: "Restaurant",
        title: name,
        summary: clip(str(data.concept) ?? "", 200),
        metric: menu.length ? String(menu.length) : undefined,
        trend: menu.length ? "menu items" : undefined,
        state: "ready",
        source: {
          system: "restaurant-data",
          label: "Restaurant data · mocked",
          freshness: "just now",
          status: "ready",
        },
        details: [
          str(data.hours),
          [str(location.neighborhood), str(location.city)].filter(Boolean).join(", "),
          favorites.length ? `Favorites: ${favorites.slice(0, 3).join(", ")}` : undefined,
        ].filter((detail): detail is string => Boolean(detail)),
        recordRef: { system: "restaurant-data", objectType: "Restaurant", recordId: id },
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [
      record(
        { system: "restaurant-data", objectType: "Restaurant", recordId: id, title: name },
        tool,
        at,
      ),
    ],
  };
}

const GRAPH_TITLES: Record<string, string> = {
  get_graph_overview: "Graph overview",
  explain_buyer_group: "Buyer group evidence",
  find_audience_overlap: "Audience overlap",
  check_consent_coverage: "Consent coverage",
  find_similar_past_pushes: "Similar past sends",
  trace_content_lineage: "Content lineage",
  plan_account_outreach: "Outreach plan",
  assess_location_impact: "Location impact",
  map_weather_demand: "Weather demand map",
  match_news_to_approved_content: "Approved content",
  prepare_deal_release: "Announcement release",
  build_aum_account_plan: "Account plan",
  build_hcp_target_list: "Target list",
  check_clinical_claims: "Claims check",
  plan_hospital_engagement: "Hospital plan",
  recall_decisions: "Remembered",
  recall_recent_work: "Recent work",
  explain_memory: "Memory provenance",
};

function graphSummary(tool: string, data: Record<string, unknown>, count: number) {
  const pct = (value: unknown) =>
    typeof value === "number" ? `${Math.round(value * 1000) / 10}%` : "?";
  switch (tool) {
    case "recall_decisions":
    case "recall_recent_work":
      return count
        ? `${count} remembered item${count === 1 ? "" : "s"} from earlier chats, dated and sourced; re-check Salesforce before reusing.`
        : "Nothing remembered for this in the workspace.";
    case "explain_memory":
      return data.found === false
        ? "No memory with that id in this workspace."
        : "Where a remembered item came from: its record, draft versions, and subjects.";
    case "find_similar_past_pushes": {
      const audience = (data.audience ?? {}) as Record<string, unknown>;
      const reach =
        num(audience.optedIn) !== undefined
          ? `; ${num(audience.optedIn)?.toLocaleString("en-US")} opted in to ${str(audience.channel) ?? "push"}`
          : "";
      return `${num(data.totalSends) ?? 0} past ${str(data.history) === "email" ? "emails" : "pushes"} in ${[data.location, data.daypart, data.condition].filter(Boolean).join(", ")}${str(data.bestAngle) ? `; best angle: ${data.bestAngle}` : ""}${reach}.`;
    }
    case "check_consent_coverage":
      return `${num(data.covered) ?? 0} of ${num(data.audience) ?? 0} audience members covered for ${str(data.channel) ?? "the channel"} (${pct(data.coverageRate)}).`;
    case "explain_buyer_group":
      return `${count} recommended buyer-group members, each with an evidence path.`;
    case "find_audience_overlap":
      return `${count} other campaigns share members with this audience.`;
    case "trace_content_lineage":
      return `${count} content assets built from ${str(data.brief) ?? "the brief"}.`;
    case "plan_account_outreach":
      return `${list(data.contacts).length} contacts at ${str(data.account) ?? "the account"} (${str(data.countryName) ?? str(data.country) ?? "?"}), with the channels each has consented to.`;
    case "map_weather_demand":
      return `${list(data.menuItems).length} dishes lifted by ${list(data.conditions).join(", ") || "the forecast"} at ${str(data.city) ?? "the location"}, made with ${list(data.inventoryItems).length} inventory items.`;
    case "match_news_to_approved_content":
      return `${list(data.readyToSend).length} approved asset${list(data.readyToSend).length === 1 ? "" : "s"} ready for "${str(data.eventName) ?? "the event"}"; ${list(data.blocked).length} blocked (expired, pending, or failed compliance).`;
    case "prepare_deal_release":
      return `${num(data.readyCount) ?? 0} of ${list(data.steps).length} announcement assets approved and ready to release in order; ${num(data.blockedCount) ?? 0} blocked.`;
    case "build_aum_account_plan":
      return `${list(data.plays).length} plays worth about $${num(data.totalOpportunityMillions) ?? 0}M on $${num(data.aumWithHarborstoneMillions) ?? 0}M with Harborstone (wallet share ${pct(data.walletShare)}).`;
    case "build_hcp_target_list": {
      const needAccess = list(data.targets).filter((target) =>
        str((target as Record<string, unknown>).play)?.startsWith("Secure"),
      ).length;
      return `${list(data.targets).length} hospitals and prescriber groups ranked for ${str(data.drug) ?? "the drug"}; ${needAccess} need formulary access before detailing.`;
    }
    case "check_clinical_claims":
      return `${num(data.usableCount) ?? 0} of ${list(data.claims).length} claims usable; ${num(data.blockedCount) ?? 0} blocked (unsupported or off label).`;
    case "plan_hospital_engagement":
      return `${list(data.access).filter((entry) => (entry as Record<string, unknown>).needsAccess === true).length} drugs need formulary access at ${str(data.hospital) ?? "the hospital"}; ${list(data.nextSteps).length} next steps.`;
    case "assess_location_impact": {
      const reach = list(data.reachableByChannel)
        .map((entry) => entry as Record<string, unknown>)
        .map((entry) => `${num(entry.optedIn) ?? 0} by ${str(entry.channel) ?? "?"}`)
        .join(", ");
      return `${num(data.affectedAppUsers) ?? 0} app users near ${str(data.city) ?? "the location"}; reachable ${reach || "by no channel"}; ${list(data.campaignsToReview).length} active campaigns target them.`;
    }
    default:
      return str(data.answer) ?? str(data.summary) ?? `${count} results`;
  }
}

/** A clinical claim as a row: its verdict, why it's blocked, its evidence, and the content carrying it. */
function claimItem(entry: Record<string, unknown>): TileItem {
  const verdict = str(entry.verdict) ?? "";
  const [status, label]: [TileItem["status"], string] =
    verdict === "Usable"
      ? ["ok", "Usable"]
      : verdict.startsWith("Blocked")
        ? ["blocked", "Blocked"]
        : verdict.includes("no approved content")
          ? ["warn", "No approved content"]
          : ["warn", "Content needs MLR"];
  const evidence = (list(entry.supportedBy) as Array<Record<string, unknown>>).map((trial) => ({
    label: "Evidence",
    text: [
      str(trial.trial),
      num(trial.enrollment) ? `${num(trial.enrollment)?.toLocaleString("en-US")} patients` : "",
      str(trial.result),
    ]
      .filter(Boolean)
      .join(" · "),
    status: "ok" as const,
  }));
  const content = (list(entry.content) as Array<Record<string, unknown>>).map((asset) => {
    const approval = (asset.approval ?? {}) as Record<string, unknown>;
    return {
      label: asset.usable ? "Asset" : "Asset · not usable",
      text: str(asset.asset) ?? "Content",
      ...(str(approval.id) ? { id: str(approval.id) as string } : {}),
      status: (asset.usable ? "ok" : "blocked") as TileItem["status"],
    };
  });
  const issues = list(entry.issues).filter((issue): issue is string => typeof issue === "string");
  return {
    status,
    label,
    title: str(entry.claim) ?? "Claim",
    ...(issues.length ? { note: issues.join(". ") } : {}),
    facts: [
      ...(evidence.length
        ? evidence
        : [
            {
              label: "Evidence",
              text: "No completed trial supports it",
              status: "blocked" as const,
            },
          ]),
      ...content,
    ],
  };
}
/** Usable claims first, then those waiting on content, then blocked. */
const CLAIM_ORDER: Record<TileItem["status"], number> = { ok: 0, info: 1, warn: 2, blocked: 3 };

function graphCard(
  data: Record<string, unknown>,
  tool: string,
  input: unknown,
  at: Date,
): Ingested {
  const paths = list(data.paths).length;
  const subject =
    str(data.client) ??
    str(data.acquiredFirm) ??
    str(data.eventName) ??
    str(data.account) ??
    str(data.campaign) ??
    str(data.subject) ??
    str((input as Record<string, unknown>)?.account);
  const memory = (MEMORY_TOOLS as readonly string[]).includes(tool);
  const row = (item: unknown) => (item ?? {}) as Record<string, unknown>;
  const items = [
    ...list(data.readyToSend).map(
      (item) => `${str(row(item).asset)} · ${str(row(row(item).approval).id)}`,
    ),
    ...list(data.plays).map(
      (item) => `${str(row(item).product)} · ~$${num(row(item).estimatedOpportunityMillions)}M`,
    ),
    ...list(data.steps).map(
      (item) =>
        `${num(row(item).step)}. ${str(row(item).asset)}${row(item).ready ? "" : " (blocked)"}`,
    ),
    ...list(data.items),
    ...(data.item ? [data.item] : []),
    ...list(data.candidates),
    ...list(data.overlaps),
    ...list(data.pushes),
    ...list(data.assets),
    ...list(data.uncoveredExamples),
    ...list(data.topItems),
    ...list(data.contacts),
    ...list(data.campaignsToReview),
  ]
    .map((item) => {
      if (typeof item === "string") return item;
      const row = (item ?? {}) as Record<string, unknown>;
      const rate = num(row.avgOrderRate);
      if (str(row.item) && rate !== undefined)
        return `${row.item} · ${(rate * 100).toFixed(1)}% order rate`;
      return (
        str(row.persona) ??
        str(row.campaign) ??
        str(row.name) ??
        str(row.title) ??
        str(row.menuItem) ??
        str(row.asset)
      );
    })
    .filter((item): item is string => Boolean(item));
  const title = GRAPH_TITLES[tool] ?? titleCase(tool);
  const claimItems =
    tool === "check_clinical_claims"
      ? (list(data.claims) as Array<Record<string, unknown>>)
          .map(claimItem)
          .sort((a, b) => CLAIM_ORDER[a.status] - CLAIM_ORDER[b.status])
      : [];
  const inputKey = JSON.stringify(input ?? {})
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return {
    cards: [
      {
        id: `graph:${tool}:${clip(inputKey, 60)}`,
        kind: "graph",
        eyebrow: memory ? "Memory" : "Knowledge graph",
        title:
          (subject ?? (claimItems.length ? str(data.drug) : undefined))
            ? `${title}: ${subject ?? str(data.drug)}`
            : title,
        summary: clip(graphSummary(tool, data, items.length), 200),
        metric: paths ? String(paths) : undefined,
        trend: paths ? "evidence paths" : undefined,
        state: "ready",
        source: {
          system: "knowledge-graph",
          label: data.source === "neo4j" ? "Neo4j · live" : "Knowledge graph · local copy",
          freshness: "just now",
          status: "ready",
        },
        details: claimItems.length ? [] : [...new Set(items)].slice(0, 4),
        ...(claimItems.length ? { items: claimItems.slice(0, 8) } : {}),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: [],
  };
}

const SALESFORCE_CARDS: Record<string, { kind: InsightTile["kind"]; eyebrow: string }> = {
  summarize_campaign: { kind: "campaign-summary", eyebrow: "Campaign summary" },
  check_campaign_readiness: { kind: "readiness", eyebrow: "Readiness" },
  draft_campaign_content: { kind: "content-draft", eyebrow: "Content draft" },
  draft_campaign_brief: { kind: "campaign-brief", eyebrow: "Brief draft" },
  generate_campaign_insights: { kind: "performance", eyebrow: "Campaign insights" },
  recommend_buyer_group_members: { kind: "account-signals", eyebrow: "Buyer group" },
  summarize_account_engagement: { kind: "account-signals", eyebrow: "Account engagement" },
  get_account_marketing_signals: { kind: "account-signals", eyebrow: "Account signals" },
};

const READABLE_KEYS = ["summary", "message", "text", "response", "answer", "result", "output"];

/** "copilotActionInput/CreateOrRefineSectionWithContent_x" → "create or refine section with content". */
const humanizeAction = (type: string) =>
  (type.split("/").pop() ?? type)
    .replace(/_[\w-]*$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

/**
 * Readable text for a Salesforce agent result, never raw JSON: the agent's own summary or
 * message when it has one, a plain description of an agent asking for confirmation, or a count
 * of what came back.
 */
export function readableAgentText(data: Record<string, unknown> | null, text: string): string {
  if (!data)
    return /^\s*[[{]/.test(text) ? "The Salesforce agent returned a structured result." : text;
  const messages = list(data.messages) as Array<Record<string, unknown>>;
  const spoken = messages
    .map((message) => str(message.message) ?? str(message.text))
    .filter((value): value is string => Boolean(value));
  if (spoken.length) return spoken.join(" ");
  const confirm = messages.find((message) => /confirm/i.test(str(message.type) ?? ""));
  if (confirm) {
    const actions = (list(confirm.confirm) as Array<Record<string, unknown>>).map((item) => {
      const inputs = (item.inputs ?? item.input ?? {}) as Record<string, unknown>;
      const what = str(inputs.contentTypeFqn) ?? str(item.contentTypeFqn);
      return `${humanizeAction(str(item.type) ?? "an action")}${what ? ` (${what})` : ""}`;
    });
    return `The Salesforce agent is asking to confirm before it continues: ${actions.join("; ") || "an action"}. It did not return a draft.`;
  }
  const search = (value: unknown, depth: number): string | undefined => {
    if (!value || typeof value !== "object" || depth > 3) return undefined;
    for (const key of READABLE_KEYS) {
      const found = (value as Record<string, unknown>)[key];
      if (typeof found === "string" && found.trim() && !/^\s*[[{]/.test(found)) return found;
    }
    for (const child of Object.values(value)) {
      const found = search(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return search(data, 0) ?? `The Salesforce agent returned ${Object.keys(data).length} fields.`;
}

function salesforceCard(payload: Payload, tool: string, input: unknown, at: Date): Ingested {
  const mapping = SALESFORCE_CARDS[tool] ?? { kind: "context" as const, eyebrow: titleCase(tool) };
  const inputText = JSON.stringify(input ?? {});
  const refs = salesforceRecordsIn(`${inputText}\n${payload.text}`);
  const campaign = refs.find((ref) => ref.objectType === "Campaign");
  const readable = readableAgentText(payload.data, payload.text);
  const structuredDetails = payload.data
    ? Object.entries(payload.data)
        .filter(
          ([key, value]) =>
            !["source", "campaignId", ...READABLE_KEYS].includes(key) &&
            (typeof value === "number" ||
              (typeof value === "string" && value.length <= 120 && !/^\s*[[{]/.test(value))),
        )
        .map(([key, value]) => `${titleCase(key)}: ${value}`)
    : [];
  const details = [...bulletLines(readable), ...structuredDetails].slice(0, 4);
  return {
    cards: [
      {
        id: `salesforce:${tool}:${campaign?.recordId ?? "workspace"}`,
        kind: mapping.kind,
        eyebrow: mapping.eyebrow,
        title: campaign?.title ?? mapping.eyebrow,
        summary: leadText(readable) || clip(readable, 200),
        state: "ready",
        source: {
          system: "salesforce",
          label: /fixture/.test(str(payload.data?.source) ?? "")
            ? "Salesforce · local fixture"
            : "Salesforce agent",
          freshness: "just now",
          status: "ready",
        },
        details,
        ...(campaign
          ? {
              recordRef: {
                system: campaign.system,
                objectType: campaign.objectType,
                recordId: campaign.recordId,
              },
            }
          : {}),
        ...(tool === "check_campaign_readiness" ? { presentation: READINESS_PRESENTATION } : {}),
        updatedAt: at.toISOString(),
        toolName: tool,
      },
    ],
    records: refs.map((ref) => record(ref, tool, at)),
  };
}

/** What one tool result adds to the working set; unknown or failed results add nothing. */
export function ingestionFor(event: ToolResultEvent): Ingested {
  const tool = baseToolName(event.toolName);
  if (!tool || isFailure(event.output)) return { cards: [], records: [] };
  const payload = toolPayload(event.output);
  if ((CAMPAIGN_CONTEXT_TOOLS as readonly string[]).includes(tool)) {
    if (!payload.data) return { cards: [], records: [] };
    if (tool === "get_current_weather") return weatherCard(payload.data, tool, event.at);
    if (tool === "get_weather_forecast") return forecastCard(payload.data, tool, event.at);
    if (tool === "get_location_inventory") return inventoryCard(payload.data, tool, event.at);
    return restaurantCard(payload.data, tool, event.at);
  }
  if ((LIFE_SCIENCES_TOOLS as readonly string[]).includes(tool))
    return payload.data
      ? lifeSciencesCard(payload.data, tool, event.at)
      : { cards: [], records: [] };
  if ((EXTERNAL_SERVICE_TOOLS as readonly string[]).includes(tool))
    return payload.data ? externalCard(payload.data, tool, event.at) : { cards: [], records: [] };
  if ([...KNOWLEDGE_GRAPH_TOOLS, ...MEMORY_TOOLS].includes(tool as never))
    return payload.data
      ? graphCard(payload.data, tool, event.input, event.at)
      : { cards: [], records: [] };
  if (!payload.text.trim() && !payload.data) return { cards: [], records: [] };
  return salesforceCard(payload, tool, event.input, event.at);
}

/** Adds cards (newest first, replacing a card with the same id) and records (deduplicated). */
export function mergeIntoWorkingSet(set: WorkingSet, added: Ingested, at: Date): WorkingSet {
  if (!added.cards.length && !added.records.length) return set;
  const cardIds = new Set(added.cards.map((card) => card.id));
  const cards = [...added.cards, ...set.cards.filter((card) => !cardIds.has(card.id))].slice(
    0,
    MAX_CARDS,
  );
  const records = [...set.records];
  for (const next of added.records) {
    const index = records.findIndex((existing) => existing.key === next.key);
    if (index === -1) records.unshift(next);
    // A write this chat made (created or updated) outranks a later read of the same record, and
    // anything this chat opened outranks a record reopened from memory.
    else if (next.relation === "created" || next.relation === "updated")
      records[index] = { ...next, addedAt: records[index]?.addedAt ?? next.addedAt };
    else if (next.relation === "read" && records[index]?.relation === "remembered")
      records[index] = { ...next, addedAt: records[index]?.addedAt ?? next.addedAt };
  }
  return {
    startedAt: set.startedAt ?? at.toISOString(),
    focus: set.focus ?? null,
    cards,
    records: records.slice(0, MAX_RECORDS),
  };
}

export const ingestToolResult = (set: WorkingSet, event: ToolResultEvent) =>
  mergeIntoWorkingSet(set, ingestionFor(event), event.at);

/** A context card for a weather-driven inventory check: which items won't cover the forecast. */
export function inventoryRiskCard(risk: InventoryRisk, at: Date): InsightTile {
  const low = risk.lowItems.length;
  return {
    id: `inventory-risk:${risk.locationId}`,
    kind: "context",
    eyebrow: "Inventory risk",
    title: `Coastline Kitchen ${risk.city}`,
    summary: low
      ? `${low} of ${risk.checkedItems} weather-driven items won't cover the ${risk.window.days}-day forecast (${risk.conditions.join(", ")}). Store manager: ${risk.manager.name}.`
      : `All ${risk.checkedItems} weather-driven items cover the ${risk.window.days}-day forecast (${risk.conditions.join(", ")}).`,
    metric: String(low),
    trend: low === 1 ? "item low" : "items low",
    state: "ready",
    source: {
      system: "store-inventory",
      label: "Forecast · graph · store inventory (mock)",
      freshness: "just now",
      status: "ready",
    },
    details: risk.lowItems.map(
      (item) =>
        `${item.name}: ${item.onHand} ${item.unit} on hand + ${item.onOrder} on order, ${item.projectedNeed} needed (${item.menuItems.join(", ")})`,
    ),
    updatedAt: at.toISOString(),
    toolName: "map_weather_demand",
  };
}

/** Adds a record the chat created or updated through a confirmed write. */
export function addCreatedRecord(
  set: WorkingSet,
  ref: RecordRef & { title: string },
  via: string,
  at: Date,
  relation: "created" | "updated" = "created",
): WorkingSet {
  return mergeIntoWorkingSet(set, { cards: [], records: [record(ref, via, at, relation)] }, at);
}

/**
 * The Salesforce campaign the chat has open, most recent first: the target for writes. A
 * campaign reopened from memory isn't a target until the chat reads it again.
 */
export const openCampaign = (set: WorkingSet) =>
  set.records.find(
    (entry) =>
      entry.system === "salesforce" &&
      entry.objectType === "Campaign" &&
      entry.relation !== "remembered",
  );

const RELATION_PROMPTS: Record<WorkingRecord["relation"], string> = {
  read: "opened in this chat",
  created: "created in this chat",
  updated: "updated in this chat",
  remembered: "reopened from memory, not re-read; read it again before acting on it",
};

/**
 * Reopens remembered work in this chat: a remembered draft becomes the focus again, and the
 * records a memory links to join the working set as remembered, not as read. Memory is dated
 * and may be stale, so nothing is marked saved and no remembered campaign becomes a write target.
 * `draft` is the remembered draft itself: the item, or for a decision, the draft it came from.
 */
export function reopenFromMemory(
  set: WorkingSet,
  item: MemoryView,
  draft: MemoryView | undefined,
  at: Date,
): WorkingSet {
  const records = [item, ...(draft && draft !== item ? [draft] : [])].flatMap((memory) =>
    memory.records.map((ref) => record(ref, "memory", at, "remembered")),
  );
  let next = mergeIntoWorkingSet(set, { cards: [], records }, at);
  const kind = FocusKindSchema.safeParse(draft?.kind);
  const fields = (draft?.fields ?? []).filter((field) => field.label.trim() && field.value.trim());
  if (draft && kind.success && fields.length) {
    const focus: FocusItem = {
      id: draft.focusId ?? draft.id,
      kind: kind.data,
      current: draft.version ?? 1,
      versions: [
        {
          version: draft.version ?? 1,
          title: draft.title.slice(0, 160),
          summary: draft.summary.slice(0, 600),
          fields: fields.slice(0, 16),
          changeNote:
            `Reopened from memory (${draft.source.toLowerCase()}, ${draft.at.slice(0, 10)})`.slice(
              0,
              240,
            ),
          basedOn: [],
          createdAt: at.toISOString(),
        },
      ],
    };
    next = { ...next, startedAt: next.startedAt ?? at.toISOString(), focus };
  }
  return next;
}

/** Prompt lines describing what's open in this chat and, separately, the catalog. */
export function workingSetPrompt(set: WorkingSet) {
  const open = set.records.map(
    (entry) =>
      `${entry.title} (${entry.systemLabel} ${entry.objectType} ${entry.recordId}, ${RELATION_PROMPTS[entry.relation]})`,
  );
  const context = set.cards.map((card) => `${card.eyebrow}: ${card.title} [${card.source.label}]`);
  const openKeys = new Set(set.records.map((entry) => entry.key));
  const catalog = WORKSPACE_CATALOG.filter((entry) => !openKeys.has(recordKey(entry))).map(
    (entry) =>
      `${entry.title} (${systemLabel(entry.system)} ${entry.objectType} ${entry.recordId})`,
  );
  return [
    focusPrompt(set.focus),
    open.length
      ? `Records open in this chat: ${open.join("; ")}.`
      : "No records are open in this chat yet.",
    context.length ? `Context gathered in this chat: ${context.join("; ")}.` : "",
    catalog.length
      ? `Catalog of records available in connected systems (not open in this chat; act on one only when the user asks for it by name or id): ${catalog.join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
