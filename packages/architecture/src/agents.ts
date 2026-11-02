// The lifecycle agents. Each is a pure function over the world: it reads governed objects, and
// returns what it would create. The edge persists those objects; nothing here writes anywhere.
import { CALENDAR, CHANNEL_BASELINE } from "./seed.ts";
import {
  attributesOf,
  type Brand,
  type BriefAttributes,
  type Channel,
  type ClaimAttributes,
  type DisclosureAttributes,
  type EvidenceAttributes,
  type GapAttributes,
  type GovernedObject,
  type ModuleAttributes,
  type PlanAttributes,
  type ResultAttributes,
  urnOf,
  type Wave,
} from "./types.ts";
import {
  getObject,
  incoming,
  listObjects,
  outgoing,
  refreshReasons,
  successorOf,
  type World,
} from "./world.ts";

const iso = (world: World) => world.now.toISOString();
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
const brandSlug = (brand: Brand) => (brand === "Harborstone Wealth" ? "hs" : "ck");
const day = (world: World) => world.now.toISOString().slice(0, 10);

function created(
  world: World,
  actor: string,
  base: Pick<GovernedObject, "kind" | "title" | "brand" | "attributes"> & {
    id: string;
  } & Partial<GovernedObject>,
): GovernedObject {
  const { id, ...rest } = base;
  return {
    urn: urnOf(base.kind, id),
    version: 1,
    supersedes: null,
    market: "US",
    owner: base.brand === "Harborstone Wealth" ? "compliance" : "marketer",
    approvalState: "draft",
    classification: base.brand === "Harborstone Wealth" ? "regulated" : "internal",
    createdBy: actor,
    createdAt: iso(world),
    updatedAt: iso(world),
    ...rest,
  };
}

// Performance ---------------------------------------------------------------------------------

export type Performance = {
  result: GovernedObject;
  module: GovernedObject;
  clickRate: number;
  /** Click rate over the channel baseline: 1 is typical. */
  index: number;
};

export function performance(world: World, brand?: Brand): Performance[] {
  return listObjects(world, { kind: "result", ...(brand ? { brand } : {}) }).flatMap((result) => {
    const attributes = attributesOf<ResultAttributes>(result);
    const module = getObject(world, attributes.moduleUrn);
    if (!module || attributes.sends === 0) return [];
    const clickRate = attributes.clicks / attributes.sends;
    return [
      { result, module, clickRate, index: clickRate / CHANNEL_BASELINE[attributes.channel].click },
    ];
  });
}

const round = (value: number, places = 2) => Number(value.toFixed(places));

// Plan and scenario ---------------------------------------------------------------------------

export function planContent(world: World, brand: Brand, actor = "agent:content-plan") {
  const today = day(world);
  const events = CALENDAR[brand].filter((event) => event.date >= today);
  const past = performance(world, brand).sort((a, b) => b.index - a.index);
  const best = past[0];
  const channel: Channel = best ? attributesOf<ResultAttributes>(best.result).channel : "email";
  const existing = listObjects(world, { kind: "content-plan", brand }).flatMap(
    (plan) => attributesOf<PlanAttributes>(plan).waves,
  );
  const reference = existing
    .filter((wave) => wave.channel === channel)
    .sort((a, b) => b.audienceSize - a.audienceSize)[0];
  const basis = past.slice(0, 2).map((item) => item.result.urn);
  const waves: Wave[] = (events.length ? events : [{ date: today, label: "Evergreen send" }]).map(
    (event, index) => ({
      id: `w${index + 1}`,
      theme: event.label,
      segment: reference?.segment ?? "all-subscribers",
      audienceSize: reference?.audienceSize ?? 1000,
      channel,
      sendOn: event.date,
      moduleCount: 1,
      rationale: best
        ? `${event.label}. ${best.module.title} ran at ${round(best.index)}× the ${channel} baseline.`
        : `${event.label}. No past results for this brand yet.`,
    }),
  );
  const plan = created(world, actor, {
    id: `${brandSlug(brand)}-plan-${today}`,
    kind: "content-plan",
    title: `${brand} plan from ${today}`,
    brand,
    owner: "brand-planner",
    attributes: {
      objective: `Reach ${brand} audiences on the dates that matter, using what performed.`,
      waves,
      basis,
    } satisfies PlanAttributes,
  });
  return { plan, basis };
}

export type ScenarioChange =
  | { type: "move-send"; waveId: string; days: number }
  | { type: "drop-channel"; channel: Channel }
  | { type: "change-audience"; waveId: string; segment: string; audienceSize: number };

const shiftDate = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

function waveClicks(world: World, brand: Brand, wave: Wave, sendOn = wave.sendOn) {
  const index =
    performance(world, brand)
      .filter((item) => attributesOf<ResultAttributes>(item.result).channel === wave.channel)
      .sort((a, b) => b.index - a.index)[0]?.index ?? 1;
  const onEvent = CALENDAR[brand].some((event) => event.date === sendOn);
  const eventLift = onEvent ? 1.15 : 1;
  return wave.audienceSize * CHANNEL_BASELINE[wave.channel].click * Math.min(index, 2) * eventLift;
}

export function runScenario(world: World, planUrn: string, change: ScenarioChange) {
  const plan = getObject(world, planUrn);
  if (plan?.kind !== "content-plan") throw new Error(`${planUrn} is not a content plan.`);
  const attributes = attributesOf<PlanAttributes>(plan);
  const before = attributes.waves.map((wave) => ({
    wave,
    clicks: waveClicks(world, plan.brand, wave),
  }));
  const notes: string[] = [];
  const after = before.flatMap(({ wave }) => {
    if (change.type === "drop-channel" && wave.channel === change.channel) {
      notes.push(`Wave ${wave.id} (${wave.channel}) is dropped.`);
      return [];
    }
    if (change.type === "move-send" && wave.id === change.waveId) {
      const sendOn = shiftDate(wave.sendOn, change.days);
      const moved = { ...wave, sendOn };
      const wasOnEvent = CALENDAR[plan.brand].some((event) => event.date === wave.sendOn);
      const nowOnEvent = CALENDAR[plan.brand].some((event) => event.date === sendOn);
      if (wasOnEvent && !nowOnEvent)
        notes.push(`Wave ${wave.id} no longer lands on its market date.`);
      if (!wasOnEvent && nowOnEvent) notes.push(`Wave ${wave.id} now lands on a market date.`);
      return [{ wave: moved, clicks: waveClicks(world, plan.brand, moved, sendOn) }];
    }
    if (change.type === "change-audience" && wave.id === change.waveId) {
      const next = { ...wave, segment: change.segment, audienceSize: change.audienceSize };
      notes.push(`Wave ${wave.id} reaches ${change.audienceSize} people in ${change.segment}.`);
      return [{ wave: next, clicks: waveClicks(world, plan.brand, next) }];
    }
    return [{ wave, clicks: waveClicks(world, plan.brand, wave) }];
  });
  const total = (rows: Array<{ clicks: number }>) => rows.reduce((sum, row) => sum + row.clicks, 0);
  return {
    planUrn,
    change,
    expectedClicksBefore: Math.round(total(before)),
    expectedClicksAfter: Math.round(total(after)),
    delta: Math.round(total(after) - total(before)),
    notes,
    basis:
      "Audience size × channel baseline click rate × the brand's best past index, +15% on a market date.",
  };
}

// Brief ---------------------------------------------------------------------------------------

export function draftBriefFromPlan(
  world: World,
  planUrn: string,
  waveId: string,
  actor = "agent:brief",
) {
  const plan = getObject(world, planUrn);
  if (plan?.kind !== "content-plan") throw new Error(`${planUrn} is not a content plan.`);
  const wave = attributesOf<PlanAttributes>(plan).waves.find((item) => item.id === waveId);
  if (!wave) throw new Error(`${planUrn} has no wave ${waveId}.`);
  const brief = created(world, actor, {
    id: `${slug(planUrn.split(":").at(-1) ?? "plan")}-${waveId}`,
    kind: "brief",
    title: `Brief: ${wave.theme}, wave ${waveId}`,
    brand: plan.brand,
    owner: "marketer",
    // Audience, channel and timing are not copied: the brief only names the plan and wave.
    attributes: {
      planUrn,
      waveId,
      objective: `Deliver "${wave.theme}" to ${wave.segment}.`,
    } satisfies BriefAttributes,
  });
  return { brief };
}

/** The brief as a reader sees it: audience, channel and timing read from the plan right now. */
export function resolveBrief(world: World, briefUrn: string) {
  const brief = getObject(world, briefUrn);
  if (brief?.kind !== "brief") return undefined;
  const attributes = attributesOf<BriefAttributes>(brief);
  const plan = getObject(world, attributes.planUrn);
  const wave = plan
    ? attributesOf<PlanAttributes>(plan).waves.find((item) => item.id === attributes.waveId)
    : undefined;
  const successor = plan ? successorOf(world, plan.urn) : undefined;
  return {
    brief,
    objective: attributes.objective,
    inheritedFrom: plan
      ? {
          urn: plan.urn,
          version: plan.version,
          approvalState: plan.approvalState,
          supersededBy: successor?.urn,
        }
      : undefined,
    wave,
  };
}

// Reuse ---------------------------------------------------------------------------------------

export interface Embedder {
  embed(text: string): number[];
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "is",
  "are",
  "your",
  "our",
  "with",
]);
const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9%$.]+/)
    .filter((token) => token.length > 1 && !STOP.has(token));

/** A local hashing embedder: deterministic, no model call. Vectorize would implement the same interface. */
export const hashingEmbedder = (dimensions = 128): Embedder => ({
  embed(text) {
    const vector = new Array<number>(dimensions).fill(0);
    const words = tokens(text);
    const features = [...words, ...words.slice(1).map((word, index) => `${words[index]} ${word}`)];
    for (const feature of features) {
      let hash = 2166136261;
      for (const char of feature) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      vector[hash % dimensions] = (vector[hash % dimensions] ?? 0) + 1;
    }
    return vector;
  },
});

export function cosine(a: readonly number[], b: readonly number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const moduleText = (module: GovernedObject) => {
  const attributes = attributesOf<ModuleAttributes>(module);
  return `${attributes.headline} ${attributes.blocks.map((block) => block.text).join(" ")} ${attributes.topics.join(" ")}`;
};

export type ReuseCandidate = {
  module: GovernedObject;
  score: number;
  similarity: number;
  performanceIndex: number | null;
  eligible: boolean;
  reasons: string[];
};

export function rankModules(
  world: World,
  request: {
    brand: Brand;
    query?: string;
    briefUrn?: string;
    channel?: Channel;
    embedder?: Embedder;
  },
): ReuseCandidate[] {
  const embedder = request.embedder ?? hashingEmbedder();
  const resolved = request.briefUrn ? resolveBrief(world, request.briefUrn) : undefined;
  const channel = request.channel ?? resolved?.wave?.channel;
  const query = request.query ?? `${resolved?.wave?.theme ?? ""} ${resolved?.objective ?? ""}`;
  const queryVector = embedder.embed(query);
  const perf = performance(world, request.brand);
  return listObjects(world, { kind: "module", brand: request.brand })
    .filter((module) => !attributesOf<ModuleAttributes>(module).variantOf)
    .map((module) => {
      const attributes = attributesOf<ModuleAttributes>(module);
      const similarity = cosine(queryVector, embedder.embed(moduleText(module)));
      const own = perf.filter((item) => item.module.urn === module.urn);
      const performanceIndex = own.length
        ? own.reduce((sum, item) => sum + item.index, 0) / own.length
        : null;
      const reasons: string[] = [];
      if (module.approvalState !== "approved")
        reasons.push(`Not approved (${module.approvalState}).`);
      reasons.push(...refreshReasons(world, module.urn));
      const channelMatch = !channel || attributes.channel === channel ? 1 : 0;
      const score =
        0.6 * similarity + 0.25 * Math.min((performanceIndex ?? 1) / 2, 1) + 0.15 * channelMatch;
      return {
        module,
        score: round(score, 3),
        similarity: round(similarity, 3),
        performanceIndex: performanceIndex === null ? null : round(performanceIndex),
        eligible: reasons.length === 0,
        reasons,
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

/** Search across every governed object by meaning, scoped to the brands the caller may see. */
export function searchObjects(
  world: World,
  query: string,
  scope: { brands: readonly Brand[] | "all" },
  embedder: Embedder = hashingEmbedder(),
  limit = 8,
) {
  const queryVector = embedder.embed(query);
  return [...world.objects.values()]
    .filter((object) => scope.brands === "all" || scope.brands.includes(object.brand))
    .map((object) => {
      const text =
        object.kind === "module"
          ? moduleText(object)
          : `${object.title} ${(object.attributes as { text?: string; objective?: string }).text ?? ""} ${(object.attributes as { objective?: string }).objective ?? ""}`;
      return { object, score: round(cosine(queryVector, embedder.embed(text)), 3) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Claims and evidence -------------------------------------------------------------------------

/** Disclosures a topic requires, so a module cannot cite a rate without its rate disclosure. */
export const DISCLOSURE_RULES: Record<string, readonly string[]> = {
  "sweep-apy": ["hs-disc-rate-asof"],
  "fdic-coverage": ["hs-disc-not-fdic"],
  "fee-waiver": ["hs-disc-not-fdic"],
};

export type ClaimStatus =
  | "substantiated"
  | "superseded"
  | "withdrawn"
  | "unapproved"
  | "missing-evidence"
  | "expired-evidence"
  | "conflicting";

export type ClaimPacket = {
  claimUrn: string;
  text: string;
  topic: string;
  status: ClaimStatus;
  evidence: Array<{
    urn: string;
    source: string;
    asOf: string;
    expiresOn: string;
    expired: boolean;
  }>;
  issues: string[];
};

export function claimPacket(world: World, claim: GovernedObject): ClaimPacket {
  const attributes = attributesOf<ClaimAttributes>(claim);
  const evidence = incoming(world, claim.urn, "SUBSTANTIATED_BY").flatMap((edge) => {
    const item = getObject(world, edge.from === claim.urn ? edge.to : edge.from);
    return item ? [item] : [];
  });
  // SUBSTANTIATED_BY runs claim → evidence, so read the outgoing edges.
  const linked = outgoing(world, claim.urn, "SUBSTANTIATED_BY").flatMap((edge) => {
    const item = getObject(world, edge.to);
    return item ? [item] : [];
  });
  const rows = (linked.length ? linked : evidence).map((item) => {
    const detail = attributesOf<EvidenceAttributes>(item);
    return {
      urn: item.urn,
      source: detail.source,
      asOf: detail.asOf,
      expiresOn: detail.expiresOn,
      expired: detail.expiresOn < day(world),
    };
  });
  const issues: string[] = [];
  let status: ClaimStatus = "substantiated";
  const successor = successorOf(world, claim.urn);
  const conflict = listObjects(world, { kind: "claim", brand: claim.brand }).find(
    (other) =>
      other.urn !== claim.urn &&
      attributesOf<ClaimAttributes>(other).topic === attributes.topic &&
      other.approvalState === "approved" &&
      !successorOf(world, other.urn) &&
      attributesOf<ClaimAttributes>(other).text !== attributes.text,
  );
  if (successor) {
    status = "superseded";
    issues.push(`Superseded by ${successor.urn}.`);
  } else if (claim.approvalState === "withdrawn") {
    status = "withdrawn";
    issues.push("The claim was withdrawn.");
  } else if (claim.approvalState !== "approved") {
    status = "unapproved";
    issues.push(`The claim is ${claim.approvalState}, not approved.`);
  } else if (rows.length === 0) {
    status = "missing-evidence";
    issues.push("No evidence is attached to this claim.");
  } else if (rows.every((row) => row.expired)) {
    status = "expired-evidence";
    issues.push(
      `All evidence expired (latest ${rows
        .map((row) => row.expiresOn)
        .sort()
        .at(-1)}).`,
    );
  } else if (conflict) {
    status = "conflicting";
    issues.push(`Conflicts with approved claim ${conflict.urn} on topic ${attributes.topic}.`);
  }
  return {
    claimUrn: claim.urn,
    text: attributes.text,
    topic: attributes.topic,
    status,
    evidence: rows,
    issues,
  };
}

export function evidencePacket(world: World, moduleUrn: string) {
  const module = getObject(world, moduleUrn);
  if (module?.kind !== "module") throw new Error(`${moduleUrn} is not a module.`);
  const claims = outgoing(world, moduleUrn, "CITES").flatMap((edge) => {
    const claim = getObject(world, edge.to);
    return claim ? [claimPacket(world, claim)] : [];
  });
  return {
    moduleUrn,
    claims,
    complete: claims.length > 0 && claims.every((item) => item.status === "substantiated"),
  };
}

// Cite or refuse ------------------------------------------------------------------------------

export function authorModule(
  world: World,
  request: { briefUrn: string; topics: readonly string[]; channel?: Channel; headline?: string },
  actor = "agent:module-authoring",
) {
  const resolved = resolveBrief(world, request.briefUrn);
  if (!resolved) throw new Error(`${request.briefUrn} is not a brief.`);
  const { brief } = resolved;
  const channel = request.channel ?? resolved.wave?.channel ?? "email";
  const cited: ClaimPacket[] = [];
  const gaps: GovernedObject[] = [];
  const refused: Array<{ topic: string; reason: string }> = [];
  for (const topic of request.topics) {
    const candidates = listObjects(world, { kind: "claim", brand: brief.brand }).filter(
      (claim) =>
        attributesOf<ClaimAttributes>(claim).topic === topic && !successorOf(world, claim.urn),
    );
    const packets = candidates.map((claim) => claimPacket(world, claim));
    const good = packets.find((packet) => packet.status === "substantiated");
    if (good) {
      cited.push(good);
      continue;
    }
    const reason = packets.length
      ? `No substantiated claim for "${topic}": ${packets.flatMap((packet) => packet.issues).join(" ")}`
      : `No approved claim exists for "${topic}".`;
    refused.push({ topic, reason });
    gaps.push(
      created(world, actor, {
        id: `gap-${slug(brief.urn.split(":").at(-1) ?? "brief")}-${slug(topic)}`,
        kind: "gap",
        title: `Gap: ${topic}`,
        brand: brief.brand,
        owner: "content-lab",
        attributes: { briefUrn: brief.urn, topic, reason } satisfies GapAttributes,
      }),
    );
  }
  if (cited.length === 0) return { module: undefined, gaps, refused, cited };
  const required = [...new Set(cited.flatMap((packet) => DISCLOSURE_RULES[packet.topic] ?? []))];
  const disclosures = required
    .map((id) => getObject(world, urnOf("disclosure", id)))
    .filter((item): item is GovernedObject => Boolean(item));
  const headline = request.headline ?? resolved.wave?.theme ?? "Untitled";
  const module = created(world, actor, {
    id: `${slug(brief.urn.split(":").at(-1) ?? "brief")}-${channel}-${slug(cited.map((item) => item.topic).join("-"))}`,
    kind: "module",
    title: headline,
    brand: brief.brand,
    owner: "content-lab",
    attributes: {
      headline,
      channel,
      topics: cited.map((item) => item.topic),
      requiredDisclosures: disclosures.map((item) => item.urn),
      briefUrn: brief.urn,
      // Every sentence is a cited claim or a required disclosure; the agent writes nothing else.
      blocks: [
        ...cited.map((item) => ({ text: item.text, claimUrn: item.claimUrn })),
        ...disclosures.map((item) => ({
          text: attributesOf<DisclosureAttributes>(item).text,
          disclosureUrn: item.urn,
        })),
      ],
    } satisfies ModuleAttributes,
  });
  return { module, gaps, refused, cited };
}

// Atomization ---------------------------------------------------------------------------------

export const CHANNEL_LIMITS: Record<Channel, number> = { email: 4000, push: 178, sms: 160 };

export function atomizeModule(
  world: World,
  moduleUrn: string,
  channels: readonly Channel[],
  actor = "agent:atomization",
) {
  const master = getObject(world, moduleUrn);
  if (master?.kind !== "module") throw new Error(`${moduleUrn} is not a module.`);
  const source = attributesOf<ModuleAttributes>(master);
  return channels
    .filter((channel) => channel !== source.channel)
    .map((channel) => {
      const limit = CHANNEL_LIMITS[channel];
      const tight = limit < 1000;
      const blocks = source.blocks.flatMap((block) => {
        if (block.disclosureUrn && tight) {
          const disclosure = getObject(world, block.disclosureUrn);
          return [
            {
              ...block,
              text: disclosure ? attributesOf<DisclosureAttributes>(disclosure).short : block.text,
            },
          ];
        }
        // The headline sentence is the only text the agent may drop; claims are never trimmed.
        return block.claimUrn || block.disclosureUrn || !tight ? [block] : [];
      });
      const text = blocks.map((block) => block.text).join(" ");
      const blockers: string[] = [];
      if (text.length > limit)
        blockers.push(
          `${channel} allows ${limit} characters and the cited claims and disclosures need ${text.length}. A claim is never shortened.`,
        );
      const variant = created(world, actor, {
        id: `${master.urn.split(":").at(-1)}-${channel}`,
        kind: "module",
        title: `${source.headline} (${channel})`,
        brand: master.brand,
        owner: "content-lab",
        attributes: {
          ...source,
          channel,
          blocks,
          variantOf: master.urn,
        } satisfies ModuleAttributes,
      });
      return { variant, length: text.length, limit, fits: blockers.length === 0, blockers };
    });
}

// Readiness -----------------------------------------------------------------------------------

export type Blocker = { code: string; message: string; urn?: string };

export function checkReadiness(
  world: World,
  moduleUrn: string,
  options: { farmBlockers?: readonly Blocker[] } = {},
) {
  const module = getObject(world, moduleUrn);
  if (module?.kind !== "module") throw new Error(`${moduleUrn} is not a module.`);
  const attributes = attributesOf<ModuleAttributes>(module);
  const packet = evidencePacket(world, moduleUrn);
  const blockers: Blocker[] = [];
  if (packet.claims.length === 0 && attributes.topics.length > 0)
    blockers.push({ code: "no-claims", message: "The module states facts but cites no claim." });
  for (const item of packet.claims)
    if (item.status !== "substantiated")
      blockers.push({
        code: `claim-${item.status}`,
        message: `"${item.text}" is ${item.status.replace("-", " ")}. ${item.issues.join(" ")}`,
        urn: item.claimUrn,
      });
  const present = new Set(attributes.blocks.map((block) => block.disclosureUrn));
  for (const urn of attributes.requiredDisclosures)
    if (!present.has(urn))
      blockers.push({
        code: "missing-disclosure",
        message: `Required disclosure ${urn} is missing.`,
        urn,
      });
  blockers.push(...(options.farmBlockers ?? []));
  return { moduleUrn, ready: blockers.length === 0, blockers, packet };
}

// Supersession --------------------------------------------------------------------------------

export function supersedeClaim(
  world: World,
  claimUrn: string,
  next: { text: string; evidence: { source: string; asOf: string; expiresOn: string } },
  actor: string,
) {
  const old = getObject(world, claimUrn);
  if (old?.kind !== "claim") throw new Error(`${claimUrn} is not a claim.`);
  if (successorOf(world, claimUrn)) throw new Error(`${claimUrn} was already superseded.`);
  const topic = attributesOf<ClaimAttributes>(old).topic;
  const id = `${old.urn
    .split(":")
    .at(-1)
    ?.replace(/-v\d+$/, "")}-v${old.version + 1}`;
  const claim = created(world, actor, {
    id,
    kind: "claim",
    title: next.text.slice(0, 80),
    brand: old.brand,
    owner: "compliance",
    version: old.version + 1,
    supersedes: old.urn,
    attributes: { text: next.text, topic } satisfies ClaimAttributes,
  });
  const evidence = created(world, actor, {
    id: `${id}-evidence`,
    kind: "evidence",
    title: next.evidence.source,
    brand: old.brand,
    owner: "compliance",
    approvalState: "approved",
    attributes: { claimUrn: claim.urn, ...next.evidence } satisfies EvidenceAttributes,
  });
  // Every module that cites the old claim, and every variant of one, now needs a refresh.
  const flagged = incoming(world, old.urn, "CITES").map((edge) => edge.from);
  return { claim, evidence, withdraw: old.urn, flagged };
}

// Attribution and optimization ----------------------------------------------------------------

export function attributeResult(world: World, resultUrn: string) {
  const result = getObject(world, resultUrn);
  if (result?.kind !== "result") throw new Error(`${resultUrn} is not a result.`);
  const attributes = attributesOf<ResultAttributes>(result);
  const module = getObject(world, attributes.moduleUrn);
  if (!module) throw new Error(`${attributes.moduleUrn} is not in the graph.`);
  const claims = outgoing(world, module.urn, "CITES").flatMap((edge) => {
    const claim = getObject(world, edge.to);
    return claim ? [claim] : [];
  });
  const headline = attributesOf<ModuleAttributes>(module).headline.toLowerCase();
  const carrier =
    claims.find((claim) =>
      headline.includes(attributesOf<ClaimAttributes>(claim).topic.split("-")[0] ?? ""),
    ) ?? claims[0];
  const index = attributes.sends
    ? attributes.clicks / attributes.sends / CHANNEL_BASELINE[attributes.channel].click
    : 0;
  const evidence = carrier
    ? outgoing(world, carrier.urn, "SUBSTANTIATED_BY").map((edge) => edge.to)
    : [];
  return {
    result,
    module,
    carriedBy: carrier,
    index: round(index),
    path: [result.urn, module.urn, ...(carrier ? [carrier.urn] : []), ...evidence],
    narrative: `${module.title} ran at ${round(index)}× the ${attributes.channel} baseline${carrier ? `, carried by "${attributesOf<ClaimAttributes>(carrier).text}"` : ""}.`,
  };
}

export type OptimizationAction = "re-issue" | "refresh" | "retire";
export type OptimizationProposal = {
  id: string;
  moduleUrn: string;
  brand: Brand;
  action: OptimizationAction;
  reason: string;
  basis: string[];
  index: number | null;
};

/** A proposal is spent once a plan revision records it against the same evidence. */
const spentKey = (proposalId: string, basis: readonly string[]) =>
  `${proposalId}|${[...basis].sort().join(",")}`;

export function proposeOptimizations(world: World, brand?: Brand): OptimizationProposal[] {
  const spent = new Set(
    listObjects(world, { kind: "content-plan" }).flatMap((plan) =>
      (
        (plan.attributes as { revisions?: Array<{ proposalId: string; basis: string[] }> })
          .revisions ?? []
      ).map((revision) => spentKey(revision.proposalId, revision.basis)),
    ),
  );
  const perf = performance(world, brand);
  return listObjects(world, { kind: "module", ...(brand ? { brand } : {}) })
    .filter((module) => module.approvalState === "approved")
    .flatMap((module): OptimizationProposal[] => {
      const reasons = refreshReasons(world, module.urn);
      const own = perf.filter((item) => item.module.urn === module.urn);
      const sends = own.reduce(
        (sum, item) => sum + attributesOf<ResultAttributes>(item.result).sends,
        0,
      );
      const clicks = own.reduce(
        (sum, item) => sum + attributesOf<ResultAttributes>(item.result).clicks,
        0,
      );
      const channel = attributesOf<ModuleAttributes>(module).channel;
      const index = sends ? clicks / sends / CHANNEL_BASELINE[channel].click : null;
      const basis = own.map((item) => item.result.urn);
      const base = {
        id: `opt-${module.urn.split(":").at(-1)}`,
        moduleUrn: module.urn,
        brand: module.brand,
        basis,
        index: index === null ? null : round(index),
      };
      if (reasons.length) return [{ ...base, action: "refresh", reason: reasons.join(" ") }];
      if (index === null) return [];
      if (index < 0.3)
        return [
          { ...base, action: "retire", reason: `Ran at ${round(index)}× the ${channel} baseline.` },
        ];
      if (index < 0.6)
        return [
          {
            ...base,
            action: "refresh",
            reason: `Ran at ${round(index)}× the ${channel} baseline; try a new angle.`,
          },
        ];
      if (index >= 1.25)
        return [
          {
            ...base,
            action: "re-issue",
            reason: `Ran at ${round(index)}× the ${channel} baseline.`,
          },
        ];
      return [];
    })
    .filter((proposal) => !spent.has(spentKey(proposal.id, proposal.basis)));
}

/** Accepting a proposal revises the brand's current plan: a new version that cites the result. */
export function acceptOptimization(world: World, proposal: OptimizationProposal, actor: string) {
  const current = listObjects(world, { kind: "content-plan", brand: proposal.brand })
    .filter((plan) => !successorOf(world, plan.urn))
    .sort((a, b) => b.version - a.version)[0];
  if (!current) throw new Error(`No content plan exists for ${proposal.brand}.`);
  const attributes = attributesOf<PlanAttributes>(current);
  const today = day(world);
  const module = getObject(world, proposal.moduleUrn);
  const target =
    [...attributes.waves]
      .sort((a, b) => a.sendOn.localeCompare(b.sendOn))
      .find((wave) => wave.sendOn >= today) ?? attributes.waves.at(-1);
  if (!target) throw new Error("The plan has no wave to revise.");
  const note = `${proposal.action === "re-issue" ? "Re-issue" : proposal.action === "refresh" ? "Refresh" : "Retire"} "${module?.title ?? proposal.moduleUrn}": ${proposal.reason}`;
  const waves = attributes.waves.map((wave) =>
    wave.id !== target.id
      ? wave
      : {
          ...wave,
          moduleCount: Math.max(
            0,
            wave.moduleCount +
              (proposal.action === "re-issue" ? 1 : proposal.action === "retire" ? -1 : 0),
          ),
          rationale: `${wave.rationale} ${note}`,
        },
  );
  const plan = created(world, actor, {
    id: `${current.urn
      .split(":")
      .at(-1)
      ?.replace(/-v\d+$/, "")}-v${current.version + 1}`,
    kind: "content-plan",
    title: current.title,
    brand: current.brand,
    owner: "brand-planner",
    version: current.version + 1,
    supersedes: current.urn,
    attributes: {
      ...attributes,
      waves,
      basis: [...new Set([...attributes.basis, ...proposal.basis])],
      revisions: [
        {
          proposalId: proposal.id,
          action: proposal.action,
          moduleUrn: proposal.moduleUrn,
          basis: proposal.basis,
          waveId: target.id,
        },
      ],
    } as unknown as PlanAttributes,
  });
  return { plan, waveId: target.id };
}

/** The guard on approval: a module cannot be approved while readiness blocks it. */
export function approvalBlockers(
  world: World,
  urn: string,
  farmBlockers: readonly Blocker[] = [],
): Blocker[] {
  const object = getObject(world, urn);
  if (!object) return [{ code: "unknown-object", message: `${urn} does not exist.` }];
  if (object.kind === "module") return checkReadiness(world, urn, { farmBlockers }).blockers;
  if (object.kind === "claim") {
    const packet = claimPacket(world, object);
    return packet.status === "substantiated" || packet.status === "unapproved"
      ? packet.evidence.length && packet.evidence.some((row) => !row.expired)
        ? []
        : [
            {
              code: "claim-evidence",
              message: "A claim needs unexpired evidence before approval.",
              urn,
            },
          ]
      : packet.issues.map((message) => ({ code: `claim-${packet.status}`, message, urn }));
  }
  return [];
}
