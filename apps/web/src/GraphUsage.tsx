import type { GraphEvidence, PathNode } from "./GraphEvidence";
import { labelColor } from "./graph/graph-model";

/** More than this and the tree stops growing; the rest are counted instead. */
const MAX_NODES = 14;

/** Colors for the node types evidence paths carry, distinct from one another; others use the Graph view's. */
const TYPE_COLORS: Record<string, string> = {
  Drug: "#b23a62",
  Claim: "#2f6fb0",
  Trial: "#2f8a5b",
  Indication: "#7a4bb0",
  ContentAsset: "#c47a1c",
  MlrApproval: "#5a6b78",
  Hospital: "#1f7f86",
  PrescriberGroup: "#8a6a2f",
};
export const typeColor = (label: string) => TYPE_COLORS[label] ?? labelColor(label);
/** "ContentAsset" as "Content asset", "MlrApproval" as "MLR approval". */
export const typeName = (label: string) =>
  label === "MlrApproval"
    ? "MLR approval"
    : label
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^(\w)(.*)$/, (_, a, b) => a + b.toLowerCase());

export type TreeNode = PathNode & {
  /** How it connects to the node above it: the relationship, and which way it points. */
  via?: { type: string; forward: boolean };
  /** Other nodes in the tree that also link to it. */
  alsoFrom: string[];
  children: TreeNode[];
};
export type GraphTree = {
  roots: TreeNode[];
  count: number;
  hidden: number;
  byType: Array<[string, number]>;
};

/**
 * The paths an answer's graph tools walked, as one tree: it starts where the paths start, each node
 * appears once under the first node that reached it, and a node several paths share notes where
 * else it's linked. A tree reads top to bottom in a narrow panel, where a node-link drawing can't
 * fit its labels.
 */
export function graphTree(evidence: readonly GraphEvidence[]): GraphTree {
  const nodes = new Map<string, PathNode>();
  const links: Array<{ from: string; to: string; type: string }> = [];
  const starts: string[] = [];
  for (const item of evidence)
    for (const path of item.paths) {
      for (const node of path.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
      const first = path.nodes[0];
      if (first && !starts.includes(first.id)) starts.push(first.id);
      // Follow the path's own order, so each step hangs under the node before it.
      path.nodes.forEach((node, index) => {
        const previous = path.nodes[index - 1];
        if (!previous) return;
        const rel = path.relationships.find(
          (item) =>
            (item.from === previous.id && item.to === node.id) ||
            (item.from === node.id && item.to === previous.id),
        );
        links.push({ from: previous.id, to: node.id, type: rel?.type ?? "" });
      });
    }
  const placed = new Map<string, TreeNode>();
  let hidden = 0;
  const make = (id: string, via?: TreeNode["via"]): TreeNode => ({
    ...(nodes.get(id) as PathNode),
    ...(via ? { via } : {}),
    alsoFrom: [],
    children: [],
  });
  const roots: TreeNode[] = [];
  const queue: TreeNode[] = [];
  for (const id of starts) {
    if (placed.has(id)) continue;
    const root = make(id);
    placed.set(id, root);
    roots.push(root);
    queue.push(root);
  }
  while (queue.length) {
    const parent = queue.shift() as TreeNode;
    for (const link of links.filter((item) => item.from === parent.id)) {
      const existing = placed.get(link.to);
      if (existing) {
        if (
          existing !== parent &&
          !existing.alsoFrom.includes(parent.name) &&
          !parent.children.includes(existing)
        )
          existing.alsoFrom.push(parent.name);
        continue;
      }
      if (placed.size >= MAX_NODES) {
        hidden += 1;
        placed.set(link.to, make(link.to));
        continue;
      }
      const rel = evidence
        .flatMap((item) => item.paths)
        .flatMap((path) => path.relationships)
        .find(
          (item) =>
            (item.from === parent.id && item.to === link.to) ||
            (item.from === link.to && item.to === parent.id),
        );
      const child = make(link.to, { type: link.type, forward: rel?.from === parent.id });
      placed.set(link.to, child);
      parent.children.push(child);
      queue.push(child);
    }
  }
  const counts = new Map<string, number>();
  for (const node of nodes.values()) counts.set(node.label, (counts.get(node.label) ?? 0) + 1);
  return { roots, count: nodes.size, hidden, byType: [...counts] };
}

/** Links that point back up the tree, read from the child's side: an asset that carries a claim. */
const REVERSED: Record<string, string> = {
  CARRIES: "carried in",
  SUPPORTS: "supported by",
  USES: "used by",
  APPROVES: "approved by",
  TARGETS: "targeted by",
  MENTIONS: "mentioned in",
  HAS_CLAIM: "claimed for",
  RESPONDS_TO: "answered by",
};

/** "SUPPORTED_BY" as "supported by"; a link pointing up the tree reads from the child's side. */
const relation = (via: NonNullable<TreeNode["via"]>) => {
  const words = via.type.toLowerCase().replaceAll("_", " ");
  return via.forward ? words : (REVERSED[via.type] ?? `← ${words}`);
};

function Branch({ node, root }: { node: TreeNode; root?: boolean }) {
  return (
    <li className={`graph-tree-item ${root ? "root" : ""}`}>
      <div
        className="graph-tree-card"
        style={{ "--type": typeColor(node.label) } as React.CSSProperties}
      >
        <span className="graph-tree-meta">
          <span className="graph-tree-type">{typeName(node.label)}</span>
          {node.via && <span className="graph-tree-via">{relation(node.via)}</span>}
        </span>
        <span className="graph-tree-name">{node.name}</span>
        {node.alsoFrom.length > 0 && (
          <span className="graph-tree-also">Also linked from {node.alsoFrom.join(", ")}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <ol className="graph-tree-children">
          {node.children.map((child) => (
            <Branch key={child.id} node={child} />
          ))}
        </ol>
      )}
    </li>
  );
}

const plural = (count: number, label: string) => {
  const name = typeName(label).toLowerCase().replace(/^mlr/, "MLR");
  return `${count} ${count === 1 ? name : name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`}`;
};

/** How the agents used the knowledge graph in an answer: what they reached, and how it connects. */
export function GraphUsage({ evidence }: { evidence: readonly GraphEvidence[] }) {
  if (evidence.length === 0) return null;
  const tree = graphTree(evidence);
  const source = evidence.some((item) => item.source === "neo4j") ? "Neo4j" : "local copy";
  const rootNames = tree.roots.map((root) => root.name).join(", ");
  const reached = tree.byType.filter(([label]) => !tree.roots.some((root) => root.label === label));
  return (
    <section className="workspace-section graph-usage" aria-labelledby="graph-usage-title">
      <h3 id="graph-usage-title">
        Knowledge graph <span className="count">{tree.count}</span>
      </h3>
      <p className="graph-usage-summary">
        <strong>{rootNames}</strong>
        {reached.length > 0 && (
          <> → {reached.map(([label, count]) => plural(count, label)).join(" · ")}</>
        )}
      </p>
      <p className="graph-usage-lede">
        {evidence
          .map(
            (item) =>
              `${item.tool[0]?.toUpperCase() ?? ""}${item.tool.slice(1)} (${item.paths.length} path${item.paths.length === 1 ? "" : "s"})`,
          )
          .join(", ")}{" "}
        · {source}
      </p>
      <ol className="graph-tree" aria-label="How the evidence connects">
        {tree.roots.map((root) => (
          <Branch key={root.id} node={root} root />
        ))}
      </ol>
      {tree.hidden > 0 && (
        <p className="graph-usage-more">
          {tree.hidden} more not shown; the answer's graph evidence lists every path.
        </p>
      )}
    </section>
  );
}
