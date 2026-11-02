import { SEED_OBJECTS } from "./seed.ts";
import {
  type ApprovalState,
  attributesOf,
  type Brand,
  type ClaimAttributes,
  type Edge,
  type EvidenceAttributes,
  type GovernedObject,
  type ModuleAttributes,
  type ObjectKind,
  type ResultAttributes,
} from "./types.ts";

export type World = {
  now: Date;
  objects: ReadonlyMap<string, GovernedObject>;
  edges: readonly Edge[];
};

export type WorldInput = {
  /** Objects created at run time (new versions, drafts, variants, gaps). */
  runtime?: readonly GovernedObject[];
  /** Approval states recorded by the governance state machine. */
  states?: Readonly<Record<string, { state: ApprovalState; at: string }>>;
  now?: Date;
};

/** Relationships are derived from attributes, so nothing is copied and nothing drifts. */
export function deriveEdges(objects: Iterable<GovernedObject>): Edge[] {
  const edges: Edge[] = [];
  for (const object of objects) {
    if (object.kind === "brief") {
      const planUrn = (object.attributes as { planUrn?: string }).planUrn;
      if (planUrn) edges.push({ type: "INHERITS", from: object.urn, to: planUrn });
    }
    if (object.kind === "module") {
      const attributes = attributesOf<ModuleAttributes>(object);
      for (const block of attributes.blocks)
        if (block.claimUrn) edges.push({ type: "CITES", from: object.urn, to: block.claimUrn });
      for (const disclosure of attributes.requiredDisclosures)
        edges.push({ type: "REQUIRES_DISCLOSURE", from: object.urn, to: disclosure });
      if (attributes.variantOf)
        edges.push({ type: "VARIANT_OF", from: object.urn, to: attributes.variantOf });
    }
    if (object.kind === "evidence")
      edges.push({
        type: "SUBSTANTIATED_BY",
        from: attributesOf<EvidenceAttributes>(object).claimUrn,
        to: object.urn,
      });
    if (object.kind === "result")
      edges.push({
        type: "MEASURED_BY",
        from: attributesOf<ResultAttributes>(object).moduleUrn,
        to: object.urn,
      });
    if (object.kind === "gap")
      edges.push({
        type: "GAP_FOR",
        from: object.urn,
        to: (object.attributes as { briefUrn: string }).briefUrn,
      });
  }
  return edges;
}

export function buildWorld(input: WorldInput = {}): World {
  const states = input.states ?? {};
  const objects = new Map<string, GovernedObject>();
  for (const object of [...SEED_OBJECTS, ...(input.runtime ?? [])]) {
    const recorded = states[object.urn];
    objects.set(
      object.urn,
      recorded ? { ...object, approvalState: recorded.state, updatedAt: recorded.at } : object,
    );
  }
  return { now: input.now ?? new Date(), objects, edges: deriveEdges(objects.values()) };
}

export const getObject = (world: World, urn: string) => world.objects.get(urn);

export function listObjects(
  world: World,
  filter: { kind?: ObjectKind; brand?: Brand; state?: ApprovalState } = {},
) {
  return [...world.objects.values()].filter(
    (object) =>
      (!filter.kind || object.kind === filter.kind) &&
      (!filter.brand || object.brand === filter.brand) &&
      (!filter.state || object.approvalState === filter.state),
  );
}

export const outgoing = (world: World, urn: string, type?: Edge["type"]) =>
  world.edges.filter((edge) => edge.from === urn && (!type || edge.type === type));
export const incoming = (world: World, urn: string, type?: Edge["type"]) =>
  world.edges.filter((edge) => edge.to === urn && (!type || edge.type === type));

/** The newest version that supersedes (directly or not) the given object, if any. */
export function successorOf(world: World, urn: string): GovernedObject | undefined {
  let current = urn;
  let found: GovernedObject | undefined;
  for (let hops = 0; hops < 50; hops += 1) {
    const next = [...world.objects.values()].find((object) => object.supersedes === current);
    if (!next) break;
    found = next;
    current = next.urn;
  }
  return found;
}

/** Oldest to newest: every version of the object, following `supersedes`. */
export function versionChain(world: World, urn: string): GovernedObject[] {
  const start = getObject(world, urn);
  if (!start) return [];
  const chain: GovernedObject[] = [start];
  let cursor = start;
  for (let hops = 0; hops < 50 && cursor.supersedes; hops += 1) {
    const previous = getObject(world, cursor.supersedes);
    if (!previous) break;
    chain.unshift(previous);
    cursor = previous;
  }
  for (let next = successorOf(world, urn); next; next = successorOf(world, next.urn))
    if (!chain.some((item) => item.urn === next?.urn)) chain.push(next);
    else break;
  return chain;
}

export type Lineage = {
  urn: string;
  outgoing: Array<
    Edge & { target?: Pick<GovernedObject, "urn" | "kind" | "title" | "approvalState"> }
  >;
  incoming: Array<
    Edge & { source?: Pick<GovernedObject, "urn" | "kind" | "title" | "approvalState"> }
  >;
};

const brief = (object: GovernedObject | undefined) =>
  object
    ? {
        urn: object.urn,
        kind: object.kind,
        title: object.title,
        approvalState: object.approvalState,
      }
    : undefined;

export function lineage(world: World, urn: string): Lineage {
  return {
    urn,
    outgoing: outgoing(world, urn).map((edge) => ({
      ...edge,
      target: brief(getObject(world, edge.to)),
    })),
    incoming: incoming(world, urn).map((edge) => ({
      ...edge,
      source: brief(getObject(world, edge.from)),
    })),
  };
}

/** Claims a module cites, with each claim's newer version when it has been superseded. */
export function citedClaims(world: World, moduleUrn: string) {
  return outgoing(world, moduleUrn, "CITES").flatMap((edge) => {
    const claim = getObject(world, edge.to);
    return claim ? [{ claim, successor: successorOf(world, claim.urn) }] : [];
  });
}

/** Why a module must be refreshed: a cited claim was superseded or withdrawn. */
export function refreshReasons(world: World, moduleUrn: string): string[] {
  return citedClaims(world, moduleUrn).flatMap(({ claim, successor }) => {
    const text = attributesOf<ClaimAttributes>(claim).text;
    if (successor) return [`Cites a superseded claim (${claim.urn} → ${successor.urn}): "${text}"`];
    if (claim.approvalState === "withdrawn") return [`Cites a withdrawn claim: "${text}"`];
    return [];
  });
}
