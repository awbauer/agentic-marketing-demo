// The rules behind the campaign team's deliverables. The agents decide what to propose and write
// their own words; these deterministic services check it against the data and the brand book and
// refuse what breaks a rule, whatever the model wrote. Each returns its problems: an empty list
// means the work can be saved.
import type {
  CampaignBrief,
  CampaignStrategy,
  Conflict,
  CopyPackage,
  CreativeConcept,
  Reconciliation,
  MediaPlan,
  MediaProjection,
  ResearchReport,
  TeamOutputs,
} from "./team.ts";
import { MEDIA_CHANNEL_LABELS, type MediaChannel, teamMarket } from "./team-data.ts";
import { costPerClick, projectedClicks, projectedImpressions } from "./team-semantic.ts";
import type { Brand } from "./types.ts";

const lower = (text: string) => text.toLowerCase();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every id the research data holds for a brand: what an insight may cite. */
export function researchSourceIds(brand: Brand) {
  const market = teamMarket(brand);
  return new Set([
    ...market.segments.map((item) => item.id),
    ...market.competitors.map((item) => item.id),
    ...market.signals.map((item) => item.id),
  ]);
}

/** Cite or refuse: every insight rests on data the team can show, and segments exist. */
export function researchProblems(brand: Brand, report: ResearchReport): string[] {
  const market = teamMarket(brand);
  const segments = new Set(market.segments.map((item) => item.id));
  const competitors = new Set(market.competitors.map((item) => item.id));
  const sources = researchSourceIds(brand);
  const problems: string[] = [];
  if (!segments.has(report.primarySegmentId))
    problems.push(`primarySegmentId ${report.primarySegmentId} is not a segment for ${brand}.`);
  for (const id of report.secondarySegmentIds)
    if (!segments.has(id)) problems.push(`secondary segment ${id} is not a segment for ${brand}.`);
  if (report.insights.length === 0) problems.push("Give at least one insight.");
  report.insights.forEach((insight, index) => {
    if (insight.sources.length === 0)
      problems.push(
        `Insight ${index + 1} cites no source. Cite the segment, competitor or signal ids it rests on, or drop it.`,
      );
    for (const source of insight.sources)
      if (!sources.has(source))
        problems.push(`Insight ${index + 1} cites ${source}, which is not in the research data.`);
  });
  for (const watch of report.competitorWatch)
    if (!competitors.has(watch.competitorId))
      problems.push(`${watch.competitorId} is not a tracked competitor.`);
  return problems;
}

/** The palette comes from the brand book, and no key visual shows what the brand book forbids. */
export function creativeProblems(brand: Brand, concept: CreativeConcept): string[] {
  const { guidelines } = teamMarket(brand);
  const palette = new Set(guidelines.palette.map((color) => lower(color.hex)));
  const problems: string[] = [];
  for (const hex of concept.palette)
    if (!palette.has(lower(hex)))
      problems.push(
        `${hex} is not in the ${brand} palette (${guidelines.palette.map((color) => color.hex).join(", ")}).`,
      );
  if (concept.palette.length === 0) problems.push("Choose at least one palette color.");
  if (concept.keyVisuals.length === 0) problems.push("Describe at least one key visual.");
  for (const visual of concept.keyVisuals)
    for (const banned of guidelines.imageryDont)
      if (lower(visual.description).includes(lower(banned)))
        problems.push(
          `The ${visual.format} visual shows "${banned}", which the brand book rules out.`,
        );
  return problems;
}

const normalize = (text: string) => lower(text).replace(/\s+/g, " ").trim();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A banned phrase as a whole word or phrase, so "cure" never matches "secure". */
const says = (text: string, phrase: string) =>
  new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(text);

/** Channel limits, banned phrases and the required disclosure, asset by asset. */
export function copyProblems(brand: Brand, copy: CopyPackage): string[] {
  const market = teamMarket(brand);
  const { bannedPhrases, requiredDisclosure } = market.guidelines;
  const problems: string[] = [];
  if (copy.assets.length === 0) problems.push("Write at least one asset.");
  const texts = [copy.tagline, ...copy.pillars];
  for (const phrase of bannedPhrases)
    if (texts.some((text) => says(text, phrase)))
      problems.push(`The tagline or a pillar uses "${phrase}", which the brand never says.`);
  for (const asset of copy.assets) {
    const spec = market.benchmarks[asset.channel];
    const at = MEDIA_CHANNEL_LABELS[asset.channel] ?? asset.channel;
    if (!spec) {
      problems.push(`${brand} does not buy ${at}.`);
      continue;
    }
    if (asset.headline.length > spec.headlineMax)
      problems.push(
        `${at} headline is ${asset.headline.length} characters; the limit is ${spec.headlineMax}.`,
      );
    if (asset.body.length > spec.bodyMax)
      problems.push(`${at} body is ${asset.body.length} characters; the limit is ${spec.bodyMax}.`);
    for (const phrase of bannedPhrases)
      if ([asset.headline, asset.body, asset.cta].some((text) => says(text, phrase)))
        problems.push(`${at} copy uses "${phrase}", which the brand never says.`);
    if (
      requiredDisclosure &&
      !normalize(asset.disclosure ?? "").includes(normalize(requiredDisclosure))
    )
      problems.push(`${at} is missing the required disclosure: "${requiredDisclosure}"`);
  }
  const channels = copy.assets.map((asset) => asset.channel);
  const repeated = channels.filter((channel, index) => channels.indexOf(channel) !== index);
  if (repeated.length)
    problems.push(`Write one asset per channel; ${[...new Set(repeated)].join(", ")} repeat.`);
  return problems;
}

const round = (value: number) => Math.round(value);

/** Projects a media plan from the benchmarks and checks it against the brief and the brand. */
export function projectMedia(brief: CampaignBrief, plan: MediaPlan) {
  const market = teamMarket(brief.brand);
  const segments = new Map(market.segments.map((item) => [item.id, item]));
  const problems: string[] = [];
  if (plan.lines.length === 0) problems.push("Buy at least one channel.");
  const lines: MediaProjection[] = plan.lines.map((line, index) => {
    const at = `Line ${index + 1} (${MEDIA_CHANNEL_LABELS[line.channel] ?? line.channel})`;
    const spec = market.benchmarks[line.channel];
    const segment = segments.get(line.segmentId);
    if (!spec) problems.push(`${at}: ${brief.brand} does not buy this channel.`);
    else if (line.budgetUsd < spec.minSpendUsd)
      problems.push(
        `${at}: $${line.budgetUsd} is under the $${spec.minSpendUsd} minimum worth buying.`,
      );
    if (!segment) problems.push(`${at}: ${line.segmentId} is not a segment for ${brief.brand}.`);
    if (!DATE.test(line.start) || !DATE.test(line.end) || line.start > line.end)
      problems.push(`${at}: give a start on or before its end (YYYY-MM-DD).`);
    else if (line.start < brief.start || line.end > brief.end)
      problems.push(`${at}: runs outside the brief's window, ${brief.start} to ${brief.end}.`);
    if (!spec || !(line.budgetUsd > 0))
      return { ...line, impressions: 0, clicks: 0, costPerClickUsd: 0 };
    // The semantic layer's governed formulas, so every agent's numbers mean the same thing.
    const affinity = segment?.affinity[line.channel] ?? 1;
    const impressions = projectedImpressions(line.budgetUsd, spec.cpm);
    const clicks = projectedClicks(impressions, spec.ctr, affinity);
    return {
      ...line,
      impressions: round(impressions),
      clicks: round(clicks),
      costPerClickUsd: costPerClick(line.budgetUsd, clicks),
    };
  });
  const totalUsd = plan.lines.reduce((sum, line) => sum + line.budgetUsd, 0);
  if (totalUsd > brief.budgetUsd)
    problems.push(
      `The plan spends $${totalUsd.toLocaleString("en-US")}, over the $${brief.budgetUsd.toLocaleString("en-US")} budget.`,
    );
  return {
    problems,
    lines,
    totalUsd,
    remainingUsd: brief.budgetUsd - totalUsd,
    impressions: lines.reduce((sum, line) => sum + line.impressions, 0),
    clicks: lines.reduce((sum, line) => sum + line.clicks, 0),
    basis: "Semantic layer: projected_impressions, projected_clicks and cost_per_click.",
  };
}

/** Where two spokes' work clashes: the lead resolves each clash before reconciling. */
export function findConflicts(outputs: TeamOutputs): Conflict[] {
  const conflicts: Conflict[] = [];
  const copy = outputs["copy-lead"];
  const media = outputs["channel-planner"];
  const research = outputs["audience-analyst"];
  if (copy && media) {
    const written = new Set<MediaChannel>(copy.assets.map((asset) => asset.channel));
    const bought = new Set<MediaChannel>(media.lines.map((line) => line.channel));
    for (const channel of bought)
      if (!written.has(channel))
        conflicts.push({
          id: `uncopied:${channel}`,
          between: ["channel-planner", "copy-lead"],
          detail: `The media plan buys ${MEDIA_CHANNEL_LABELS[channel]}, but there is no copy for it.`,
        });
    for (const channel of written)
      if (!bought.has(channel))
        conflicts.push({
          id: `unbought:${channel}`,
          between: ["copy-lead", "channel-planner"],
          detail: `There is ${MEDIA_CHANNEL_LABELS[channel]} copy, but the media plan does not buy it.`,
        });
  }
  if (research && media) {
    const audience = new Set([research.primarySegmentId, ...research.secondarySegmentIds]);
    for (const segment of new Set(media.lines.map((line) => line.segmentId)))
      if (!audience.has(segment))
        conflicts.push({
          id: `off-audience:${segment}`,
          between: ["channel-planner", "audience-analyst"],
          detail: `The media plan targets ${segment}, which the research did not recommend.`,
        });
  }
  return conflicts;
}

/**
 * Fits the four pieces into one proposal, once all are in and every clash has either gone away or
 * carries the lead's resolution.
 */
export function reconcileCampaign(
  brief: CampaignBrief,
  outputs: TeamOutputs,
  reconciliation: Reconciliation,
):
  | { ok: true; strategy: CampaignStrategy }
  | { ok: false; problems: string[]; conflicts: Conflict[] } {
  const research = outputs["audience-analyst"];
  const creative = outputs["art-director"];
  const copy = outputs["copy-lead"];
  const media = outputs["channel-planner"];
  const missing = (
    [
      ["audience-analyst", research],
      ["art-director", creative],
      ["copy-lead", copy],
      ["channel-planner", media],
    ] as const
  )
    .filter(([, output]) => !output)
    .map(([agent]) => agent);
  const conflicts = findConflicts(outputs);
  const resolved = new Map(
    reconciliation.resolutions
      .filter((item) => item.resolution.trim().length >= 5)
      .map((item) => [item.conflictId, item.resolution]),
  );
  const unresolved = conflicts.filter((conflict) => !resolved.has(conflict.id));
  const problems = [
    ...missing.map((agent) => `No accepted work from ${agent} yet.`),
    ...unresolved.map(
      (conflict) =>
        `Unresolved conflict ${conflict.id}: ${conflict.detail} Resolve it by sending the work back for revision, or give a resolution for ${conflict.id}.`,
    ),
  ];
  if (!reconciliation.positioning.trim()) problems.push("Give the campaign positioning.");
  if (problems.length || !research || !creative || !copy || !media)
    return { ok: false, problems, conflicts };
  const projected = projectMedia(brief, media);
  if (projected.problems.length) return { ok: false, problems: projected.problems, conflicts };
  const segments = new Map(teamMarket(brief.brand).segments.map((item) => [item.id, item.name]));
  return {
    ok: true,
    strategy: {
      briefId: brief.id,
      brand: brief.brand,
      title: brief.title,
      positioning: reconciliation.positioning,
      audience: {
        primary: segments.get(research.primarySegmentId) ?? research.primarySegmentId,
        secondary: research.secondarySegmentIds.map((id) => segments.get(id) ?? id),
        insights: research.insights,
      },
      creative,
      messaging: copy,
      media: {
        lines: projected.lines,
        totalUsd: projected.totalUsd,
        budgetUsd: brief.budgetUsd,
        impressions: projected.impressions,
        clicks: projected.clicks,
      },
      timeline: [...reconciliation.milestones].sort((a, b) => a.date.localeCompare(b.date)),
      successMetrics: reconciliation.successMetrics,
      resolutions: conflicts.map((conflict) => ({
        conflict: conflict.detail,
        resolution: resolved.get(conflict.id) as string,
      })),
      status: "proposed",
    },
  };
}
