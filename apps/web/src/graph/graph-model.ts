import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

// Mirrors packages/knowledge-graph/src/explorer.ts; the web bundle never imports the dataset.
export type ExplorerNode = {
  id: string;
  label: string;
  name: string;
  properties: Record<string, unknown>;
};
export type ExplorerRelationship = {
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};
export type GraphOverview = {
  source: "neo4j" | "fixture";
  nodes: ExplorerNode[];
  relationships: ExplorerRelationship[];
  labelCounts: Record<string, number>;
  relationshipCounts: Record<string, number>;
  hiddenLabels: string[];
};
export type GraphNeighbors = {
  source: "neo4j" | "fixture";
  node: ExplorerNode;
  nodes: ExplorerNode[];
  relationships: ExplorerRelationship[];
  total: number;
  truncated: boolean;
};

export type SimNode = ExplorerNode & SimulationNodeDatum & { degree: number };
export type SimLink = SimulationLinkDatum<SimNode> & {
  key: string;
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};

export type Domain = { id: string; title: string; blurb: string; labels: string[] };

/** Node types grouped by the part of the demo they come from. */
export const DOMAINS: Domain[] = [
  {
    id: "marketing",
    title: "Brands, campaigns, and content",
    blurb:
      "Northstar and its Coastline Kitchen, Harborstone Wealth and Lumera Therapeutics brands: what they plan, write, and check.",
    labels: ["Brand", "Campaign", "Brief", "ContentAsset", "BrandRule"],
  },
  {
    id: "audience",
    title: "Audience and consent",
    blurb: "Who a campaign reaches and what they agreed to.",
    labels: ["Segment", "Account", "Persona", "ConsentScope", "Channel"],
  },
  {
    id: "restaurant",
    title: "Coastline Kitchen restaurants",
    blurb:
      "Locations and their managers, the menu and what it's made with, and past pushes and emails with their context.",
    labels: [
      "Location",
      "StoreManager",
      "Menu",
      "MenuItem",
      "InventoryItem",
      "Daypart",
      "WeatherCondition",
      "PushSend",
      "EmailSend",
    ],
  },
  {
    id: "wealth",
    title: "Harborstone Wealth",
    blurb:
      "Regulated content with its approvals and disclosures, an embargoed acquisition, and clients with their holdings and signals.",
    labels: [
      "Approval",
      "Disclosure",
      "MarketEvent",
      "ClientSend",
      "Deal",
      "Firm",
      "Client",
      "Advisor",
      "Product",
      "Signal",
    ],
  },
  {
    id: "pharma",
    title: "Lumera Therapeutics",
    blurb:
      "Drugs and their labeled indications, the trials behind each clinical claim, MLR-approved content, and the hospitals and prescriber groups to reach.",
    labels: [
      "Drug",
      "Indication",
      "ClinicalTrial",
      "ClinicalClaim",
      "Hospital",
      "Specialty",
      "PrescriberGroup",
    ],
  },
];

export const LABEL_COLORS: Record<string, string> = {
  Brand: "#0f2a22",
  Campaign: "#173d31",
  Brief: "#2f7358",
  ContentAsset: "#62a585",
  BrandRule: "#c0533f",
  Segment: "#c78436",
  Account: "#8f6428",
  Persona: "#e2b857",
  ConsentScope: "#d9816f",
  Channel: "#7d5f9e",
  Menu: "#1d5b86",
  Location: "#3c8ac0",
  MenuItem: "#7db8da",
  Daypart: "#5b6fb3",
  WeatherCondition: "#3fa3a0",
  PushSend: "#9fb0bd",
  EmailSend: "#b3a3c7",
  InventoryItem: "#b0763f",
  StoreManager: "#4f6f8f",
  Approval: "#2e6f5e",
  Disclosure: "#8c4a6b",
  MarketEvent: "#a33c2f",
  ClientSend: "#a8b6a0",
  Deal: "#3d3a78",
  Firm: "#6a67b0",
  Client: "#9a5a14",
  Advisor: "#46607a",
  Product: "#3b7a8c",
  Signal: "#d4a017",
  Drug: "#b8456f",
  Indication: "#7a4fa0",
  ClinicalTrial: "#2f8f83",
  ClinicalClaim: "#cc6a2d",
  Hospital: "#2c6fa8",
  Specialty: "#6f8f3a",
  PrescriberGroup: "#9c7a1d",
};

export const LABEL_NAMES: Record<string, string> = {
  ContentAsset: "Content asset",
  BrandRule: "Brand rule",
  ConsentScope: "Consent scope",
  MenuItem: "Menu item",
  WeatherCondition: "Weather",
  PushSend: "Push send",
  EmailSend: "Email send",
  InventoryItem: "Inventory item",
  StoreManager: "Store manager",
  MarketEvent: "Market event",
  ClientSend: "Client send",
  ClinicalTrial: "Clinical trial",
  ClinicalClaim: "Clinical claim",
  PrescriberGroup: "Prescriber group",
};

export const labelName = (label: string) => LABEL_NAMES[label] ?? label;
export const labelColor = (label: string) => LABEL_COLORS[label] ?? "#6b7a72";

/** Plain-language reading of each relationship type, "from … to". */
export const RELATIONSHIP_PHRASES: Record<string, string> = {
  FOR: "is for",
  PART_OF: "is part of",
  BELONGS_TO: "belongs to",
  RULE_OF: "is a rule of",
  OPERATES: "operates",
  SERVES: "serves",
  MENU_OF: "is the menu of",
  ON_MENU: "is on",
  AVAILABLE_DURING: "is available during",
  FAVORITE: "has favorite",
  NEAR: "is near",
  USED: "used",
  SENT_TO: "was sent to",
  SENT_UNDER: "was sent under consent",
  ON: "runs on",
  USES: "uses",
  BUILT_FROM: "was built from",
  FAILED: "failed",
  PASSED: "passed",
  TARGETS: "targets",
  WORKS_AT: "works at",
  ENGAGED_WITH: "engaged with",
  INCLUDES: "includes",
  HAS_CONSENT: "has consent for",
  FEATURED: "featured",
  SENT_DURING: "was sent during",
  UNDER: "was sent under",
  MADE_WITH: "is made with",
  LIFTS_DEMAND: "lifts demand for",
  MANAGED_BY: "is managed by",
  APPROVED_UNDER: "is approved under",
  REQUIRES: "requires disclosure",
  APPROVED_FOR: "is approved for",
  RESPONDS_TO: "responds to",
  EXPLAINS: "explains",
  RELEASED_WITH: "is released with",
  ADDRESSED_TO: "is addressed to",
  ANNOUNCED_BY: "is announced by",
  ANNOUNCES: "announces",
  ACQUIRES: "acquires",
  CLIENT_OF: "is a client of",
  COVERED_BY: "is covered by",
  HOLDS: "holds",
  HAS_SIGNAL: "shows the signal",
  SUGGESTS: "suggests",
  OFFERS: "offers",
  ADVISES_FOR: "advises for",
  INDICATED_FOR: "is labeled for",
  INVESTIGATED_FOR: "is only investigational for",
  STUDIED_IN: "was studied in",
  SUPPORTS: "supports",
  CLAIMS_ABOUT: "is a claim about",
  CARRIES: "carries the claim",
  TREATS: "treats",
  SPECIALIZES_IN: "specializes in",
  PRACTICES_AT: "practices at",
  ON_FORMULARY: "has formulary status for",
  SEES_PATIENTS_WITH: "sees patients with",
  PRESCRIBES: "prescribes",
};

export const relationshipPhrase = (type: string) =>
  RELATIONSHIP_PHRASES[type] ?? type.toLowerCase().replaceAll("_", " ");

export const linkKey = (link: { from: string; type: string; to: string }) =>
  `${link.from}|${link.type}|${link.to}`;

export type GraphState = { nodes: SimNode[]; links: SimLink[] };

/**
 * Adds nodes and relationships without duplicates. Existing nodes keep their positions, and new
 * neighbors start next to the node they were expanded from so the layout grows outward.
 */
export function mergeGraph(
  state: GraphState,
  nodes: readonly ExplorerNode[],
  relationships: readonly ExplorerRelationship[],
  anchorId?: string,
): GraphState {
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const anchor = anchorId ? byId.get(anchorId) : undefined;
  const added: SimNode[] = [];
  nodes.forEach((node, index) => {
    if (byId.has(node.id)) return;
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const simNode: SimNode = {
      ...node,
      degree: 0,
      ...(anchor?.x !== undefined && anchor.y !== undefined
        ? { x: anchor.x + Math.cos(angle) * 40, y: anchor.y + Math.sin(angle) * 40 }
        : {}),
    };
    byId.set(node.id, simNode);
    added.push(simNode);
  });
  const keys = new Set(state.links.map((link) => link.key));
  const links = [...state.links];
  for (const relationship of relationships) {
    const key = linkKey(relationship);
    if (keys.has(key) || !byId.has(relationship.from) || !byId.has(relationship.to)) continue;
    keys.add(key);
    links.push({ ...relationship, key, source: relationship.from, target: relationship.to });
  }
  const allNodes = [...state.nodes, ...added];
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
    degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
  }
  for (const node of allNodes) node.degree = degree.get(node.id) ?? 0;
  return { nodes: allNodes, links };
}

export const nodeRadius = (node: Pick<SimNode, "degree" | "label">) =>
  node.label === "PushSend" || node.label === "EmailSend"
    ? 3.5
    : Math.min(18, 5 + Math.sqrt(node.degree) * 1.6);

export type ConnectionGroup = {
  key: string;
  direction: "out" | "in";
  type: string;
  nodes: SimNode[];
};

/** Connections of one node, grouped by relationship type and direction, for the details panel. */
export function connectionsOf(state: GraphState, id: string): ConnectionGroup[] {
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, ConnectionGroup>();
  for (const link of state.links) {
    const direction = link.from === id ? "out" : link.to === id ? "in" : null;
    if (!direction) continue;
    const other = byId.get(direction === "out" ? link.to : link.from);
    if (!other) continue;
    const key = `${direction}:${link.type}`;
    const group = groups.get(key) ?? { key, direction, type: link.type, nodes: [] };
    group.nodes.push(other);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      nodes: group.nodes.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.key.localeCompare(b.key));
}

export function formatValue(value: unknown): string {
  if (typeof value === "number")
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value < 1 && value > 0
        ? `${(value * 100).toFixed(1)}%`
        : value.toFixed(2);
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const propertyName = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());

export type InsightRow = {
  id: string;
  label: string;
  name: string;
  average: number;
  count: number;
};
export type Insight = { groupedBy: string; pushes: number; rows: InsightRow[] };

/**
 * What the loaded push sends around a node say: the average order rate per menu item (or, for a
 * menu item, per weather condition). This is the same reasoning the push scenario asks the graph
 * tools for, computed only from what is on the canvas.
 */
export function pushInsight(state: GraphState, nodeId: string, limit = 5): Insight | null {
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const self = byId.get(nodeId);
  if (!self || self.label === "PushSend") return null;
  const pushes = new Set<string>();
  for (const link of state.links) {
    const other = link.from === nodeId ? link.to : link.to === nodeId ? link.from : null;
    if (other && byId.get(other)?.label === "PushSend") pushes.add(other);
  }
  if (pushes.size < 3) return null;
  const groupType = self.label === "MenuItem" ? "UNDER" : "FEATURED";
  const totals = new Map<string, { sum: number; count: number }>();
  for (const link of state.links) {
    if (link.type !== groupType || !pushes.has(link.from)) continue;
    const rate = byId.get(link.from)?.properties.orderRate;
    if (typeof rate !== "number") continue;
    const entry = totals.get(link.to) ?? { sum: 0, count: 0 };
    entry.sum += rate;
    entry.count += 1;
    totals.set(link.to, entry);
  }
  const rows = [...totals.entries()]
    .flatMap(([id, { sum, count }]) => {
      const node = byId.get(id);
      return node ? [{ id, label: node.label, name: node.name, average: sum / count, count }] : [];
    })
    .sort((a, b) => b.average - a.average || b.count - a.count)
    .slice(0, limit);
  return rows.length
    ? { groupedBy: groupType === "UNDER" ? "weather" : "menu item", pushes: pushes.size, rows }
    : null;
}

/**
 * The nodes that belong with a brand: those at least as close to it as to any other brand,
 * counting hops over loaded relationships in either direction and never walking through another
 * brand. So a sub-brand keeps its own campaigns, locations, menu, and the channels and consent it
 * shares, but not what's reached through its parent brand (the parent's rules, B2B accounts).
 */
export function brandScope(state: GraphState, brandId: string): Set<string> {
  const brands = new Set(state.nodes.filter((node) => node.label === "Brand").map((n) => n.id));
  const neighbors = new Map<string, string[]>();
  const connect = (a: string, b: string) => neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
  for (const link of state.links) {
    connect(link.from, link.to);
    connect(link.to, link.from);
  }
  const distancesFrom = (start: string) => {
    const distance = new Map([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head] as string;
      for (const next of neighbors.get(id) ?? []) {
        if (distance.has(next) || brands.has(next)) continue;
        distance.set(next, (distance.get(id) ?? 0) + 1);
        queue.push(next);
      }
    }
    return distance;
  };
  const own = distancesFrom(brandId);
  const others = [...brands].filter((id) => id !== brandId).map(distancesFrom);
  const scope = new Set<string>();
  for (const [id, distance] of own)
    if (others.every((other) => distance <= (other.get(id) ?? Number.POSITIVE_INFINITY)))
      scope.add(id);
  return scope;
}
