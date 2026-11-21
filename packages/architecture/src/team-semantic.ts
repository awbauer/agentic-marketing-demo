// The semantic layer under the campaign squad. Agents never read the raw market tables: they ask
// this layer for governed entities and metrics, each with one definition, one formula, a grain, a
// unit, an owner and the source system it comes from. Because every agent (and the rule services)
// computes "projected clicks" or "cost per click" the same way, the channel planner's numbers, the
// lead's reconciliation and the client's proposal cannot disagree about what a number means.
import {
  MEDIA_CHANNEL_LABELS,
  MEDIA_CHANNELS,
  type MediaChannel,
  teamMarket,
} from "./team-data.ts";
import type { Brand } from "./types.ts";

export const SEMANTIC_SOURCES = {
  segmentation: "Audience segmentation model",
  competitive: "Competitive tracker",
  listening: "Search, survey and foot-traffic panels",
  "brand-book": "Brand book",
  benchmarks: "Media benchmark set",
  brief: "The client's brief",
} as const;
export type SemanticSource = keyof typeof SEMANTIC_SOURCES;

export const SEMANTIC_ENTITIES = {
  segment: {
    label: "Audience segment",
    definition: "A group of reachable people the brand can target, sized and scored by channel.",
    key: "segment id",
    source: "segmentation",
  },
  competitor: {
    label: "Competitor",
    definition: "A tracked rival brand in the same category, with its positioning and recent move.",
    key: "competitor id",
    source: "competitive",
  },
  signal: {
    label: "Market signal",
    definition: "A dated observation from a panel that suggests demand is moving.",
    key: "signal id",
    source: "listening",
  },
  channel: {
    label: "Media channel",
    definition: "A place the brand can buy, with its prices, response rates and copy limits.",
    key: "channel",
    source: "benchmarks",
  },
  guideline: {
    label: "Brand guideline",
    definition: "The brand book's rules: voice, palette, imagery, banned phrases and disclosures.",
    key: "brand",
    source: "brand-book",
  },
} as const satisfies Record<
  string,
  { label: string; definition: string; key: string; source: SemanticSource }
>;
export type SemanticEntityId = keyof typeof SEMANTIC_ENTITIES;

export type SemanticMetric = {
  label: string;
  definition: string;
  formula: string;
  unit: "people" | "index" | "share" | "usd" | "rate" | "characters" | "impressions" | "clicks";
  grain: string;
  entity: SemanticEntityId;
  source: SemanticSource;
  owner: string;
};

export const SEMANTIC_METRICS = {
  segment_size: {
    label: "Segment size",
    definition: "Reachable people in the segment, rounded.",
    formula: "count(distinct reachable people in segment)",
    unit: "people",
    grain: "segment",
    entity: "segment",
    source: "segmentation",
    owner: "Audience insights",
  },
  channel_affinity: {
    label: "Channel affinity",
    definition:
      "How well a channel reaches a segment compared with a typical audience; 1 is typical.",
    formula: "segment response rate on channel ÷ all-audience response rate on channel",
    unit: "index",
    grain: "segment × channel",
    entity: "segment",
    source: "segmentation",
    owner: "Audience insights",
  },
  share_of_voice: {
    label: "Share of voice",
    definition: "A competitor's share of all category advertising, 0 to 1.",
    formula: "competitor ad spend ÷ category ad spend",
    unit: "share",
    grain: "competitor",
    entity: "competitor",
    source: "competitive",
    owner: "Competitive intelligence",
  },
  cpm: {
    label: "CPM",
    definition: "Cost to buy a thousand impressions on the channel.",
    formula: "media cost ÷ impressions × 1,000",
    unit: "usd",
    grain: "channel",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  ctr: {
    label: "Click-through rate",
    definition: "Share of impressions that become a click.",
    formula: "clicks ÷ impressions",
    unit: "rate",
    grain: "channel",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  min_spend: {
    label: "Minimum spend",
    definition: "The smallest buy worth making on the channel.",
    formula: "set by the media team per channel",
    unit: "usd",
    grain: "channel",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  headline_limit: {
    label: "Headline limit",
    definition: "Longest headline the channel's format allows.",
    formula: "format specification",
    unit: "characters",
    grain: "channel",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  body_limit: {
    label: "Body limit",
    definition: "Longest body copy the channel's format allows.",
    formula: "format specification",
    unit: "characters",
    grain: "channel",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  projected_impressions: {
    label: "Projected impressions",
    definition: "Impressions a budget is expected to buy on a channel.",
    formula: "budget ÷ CPM × 1,000",
    unit: "impressions",
    grain: "plan line",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  projected_clicks: {
    label: "Projected clicks",
    definition: "Clicks a plan line is expected to earn from its target segment.",
    formula: "projected impressions × CTR × channel affinity",
    unit: "clicks",
    grain: "plan line",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  cost_per_click: {
    label: "Cost per click",
    definition: "What each projected click costs.",
    formula: "budget ÷ projected clicks",
    unit: "usd",
    grain: "plan line",
    entity: "channel",
    source: "benchmarks",
    owner: "Media",
  },
  budget_remaining: {
    label: "Budget remaining",
    definition: "The brief's budget that a plan leaves unspent.",
    formula: "brief budget − sum(plan line budgets)",
    unit: "usd",
    grain: "plan",
    entity: "channel",
    source: "brief",
    owner: "Client",
  },
} as const satisfies Record<string, SemanticMetric>;
export type SemanticMetricId = keyof typeof SEMANTIC_METRICS;
export const SEMANTIC_METRIC_IDS = Object.keys(SEMANTIC_METRICS) as SemanticMetricId[];

// The governed formulas. projectMedia() and every agent tool use these, never their own math.
export const projectedImpressions = (budgetUsd: number, cpm: number) =>
  cpm > 0 ? (budgetUsd / cpm) * 1000 : 0;
export const projectedClicks = (impressions: number, ctr: number, affinity = 1) =>
  impressions * ctr * affinity;
export const costPerClick = (budgetUsd: number, clicks: number) =>
  clicks > 0 ? Number((budgetUsd / clicks).toFixed(2)) : 0;

/** Business words people and agents use, mapped to what the layer defines. */
const GENERAL_TERMS: Record<string, { kind: "metric"; id: SemanticMetricId }> = {
  reach: { kind: "metric", id: "segment_size" },
  audience: { kind: "metric", id: "segment_size" },
  affinity: { kind: "metric", id: "channel_affinity" },
  sov: { kind: "metric", id: "share_of_voice" },
  "share of voice": { kind: "metric", id: "share_of_voice" },
  cpm: { kind: "metric", id: "cpm" },
  ctr: { kind: "metric", id: "ctr" },
  "click rate": { kind: "metric", id: "ctr" },
  impressions: { kind: "metric", id: "projected_impressions" },
  clicks: { kind: "metric", id: "projected_clicks" },
  cpc: { kind: "metric", id: "cost_per_click" },
  "cost per click": { kind: "metric", id: "cost_per_click" },
  "minimum spend": { kind: "metric", id: "min_spend" },
  "character limit": { kind: "metric", id: "body_limit" },
  "headline length": { kind: "metric", id: "headline_limit" },
  reserve: { kind: "metric", id: "budget_remaining" },
  "budget left": { kind: "metric", id: "budget_remaining" },
};

export type SemanticQuery = {
  entity: SemanticEntityId;
  /** Ids to keep (segment ids, competitor ids, signal ids or channels); all when empty. */
  ids?: string[];
};

export type SemanticResult = {
  entity: SemanticEntityId;
  rows: Array<Record<string, unknown>>;
  metrics: SemanticMetricId[];
  definitions: Record<string, string>;
  source: string;
};

const pick = <T extends { id?: string; channel?: string }>(rows: T[], ids?: string[]) =>
  ids?.length ? rows.filter((row) => ids.includes(String(row.id ?? row.channel))) : rows;

const define = (metrics: SemanticMetricId[]) =>
  Object.fromEntries(
    metrics.map((id) => [
      id,
      `${SEMANTIC_METRICS[id].definition} (${SEMANTIC_METRICS[id].formula})`,
    ]),
  );

/** Answers a query for one governed entity, with the metrics and definitions it used. */
export function semanticQuery(brand: Brand, query: SemanticQuery): SemanticResult {
  const market = teamMarket(brand);
  const result = (
    rows: Array<Record<string, unknown>>,
    metrics: SemanticMetricId[],
  ): SemanticResult => ({
    entity: query.entity,
    rows,
    metrics,
    definitions: define(metrics),
    source: SEMANTIC_SOURCES[SEMANTIC_ENTITIES[query.entity].source],
  });
  switch (query.entity) {
    case "segment":
      return result(
        pick([...market.segments], query.ids).map((segment) => ({
          id: segment.id,
          name: segment.name,
          description: segment.description,
          segment_size: segment.size,
          channel_affinity: segment.affinity,
        })),
        ["segment_size", "channel_affinity"],
      );
    case "competitor":
      return result(
        pick([...market.competitors], query.ids).map((competitor) => ({
          id: competitor.id,
          name: competitor.name,
          positioning: competitor.positioning,
          share_of_voice: competitor.shareOfVoice,
          recent_move: competitor.recentMove,
        })),
        ["share_of_voice"],
      );
    case "signal":
      return result(
        pick([...market.signals], query.ids).map((signal) => ({ ...signal })),
        [],
      );
    case "channel":
      return result(
        pick(
          Object.entries(market.benchmarks).map(([channel, spec]) => ({
            channel,
            label: MEDIA_CHANNEL_LABELS[channel as MediaChannel],
            cpm: spec?.cpm,
            ctr: spec?.ctr,
            min_spend: spec?.minSpendUsd,
            headline_limit: spec?.headlineMax,
            body_limit: spec?.bodyMax,
          })),
          query.ids,
        ),
        ["cpm", "ctr", "min_spend", "headline_limit", "body_limit"],
      );
    case "guideline":
      return result([{ brand, ...market.guidelines }], []);
  }
}

export type TermMatch =
  | {
      kind: "metric";
      id: SemanticMetricId;
      label: string;
      definition: string;
      formula: string;
      unit: string;
      grain: string;
    }
  | { kind: "entity"; entity: SemanticEntityId; id: string; label: string; definition: string };

/** Resolves a business term to the governed metric or entity it means for this brand. */
export function defineTerm(brand: Brand, term: string): TermMatch[] {
  const phrase = term.trim().toLowerCase();
  if (!phrase) return [];
  const market = teamMarket(brand);
  const matches: TermMatch[] = [];
  const metric = (id: SemanticMetricId): TermMatch => ({
    kind: "metric",
    id,
    label: SEMANTIC_METRICS[id].label,
    definition: SEMANTIC_METRICS[id].definition,
    formula: SEMANTIC_METRICS[id].formula,
    unit: SEMANTIC_METRICS[id].unit,
    grain: SEMANTIC_METRICS[id].grain,
  });
  for (const id of SEMANTIC_METRIC_IDS)
    if (id === phrase.replaceAll(" ", "_") || SEMANTIC_METRICS[id].label.toLowerCase() === phrase)
      matches.push(metric(id));
  for (const [word, target] of Object.entries(GENERAL_TERMS))
    if (
      phrase.includes(word) &&
      !matches.some((match) => match.kind === "metric" && match.id === target.id)
    )
      matches.push(metric(target.id));
  const words = phrase.split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  for (const segment of market.segments) {
    const text = `${segment.name} ${segment.description}`.toLowerCase();
    if (segment.id === phrase || words.some((word) => text.includes(word)))
      matches.push({
        kind: "entity",
        entity: "segment",
        id: segment.id,
        label: segment.name,
        definition: segment.description,
      });
  }
  for (const channel of MEDIA_CHANNELS)
    if (phrase.includes(channel) || phrase.includes(MEDIA_CHANNEL_LABELS[channel].toLowerCase()))
      matches.push({
        kind: "entity",
        entity: "channel",
        id: channel,
        label: MEDIA_CHANNEL_LABELS[channel],
        definition: market.benchmarks[channel]
          ? `${MEDIA_CHANNEL_LABELS[channel]}: CPM $${market.benchmarks[channel]?.cpm}, CTR ${((market.benchmarks[channel]?.ctr ?? 0) * 100).toFixed(2)}%.`
          : `${brand} does not buy ${MEDIA_CHANNEL_LABELS[channel]}.`,
      });
  return matches.slice(0, 8);
}
