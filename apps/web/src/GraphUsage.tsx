import type { GraphEvidence, PathNode } from "./GraphEvidence";
import { labelColor } from "./graph/graph-model";

const WIDTH = 360;
const ROW = 74;
const TOP = 26;
/** More nodes than this in one row would crowd their names; the rest are counted instead. */
const PER_ROW = 5;

export type UsageNode = PathNode & { row: number; x: number; y: number };
export type UsageEdge = { from: string; to: string; type: string };
export type GraphLayout = {
  nodes: UsageNode[];
  edges: UsageEdge[];
  hidden: number;
  height: number;
  labels: string[];
};

/**
 * The nodes and relationships an answer's graph tools walked, laid out top to bottom: each row is
 * one hop further from where a path starts, and a node several paths share is drawn once, in the
 * row nearest the start. Deterministic, so the same answer always draws the same picture.
 */
export function graphLayout(evidence: readonly GraphEvidence[]): GraphLayout {
  const rowOf = new Map<string, number>();
  const nodeOf = new Map<string, PathNode>();
  const edges = new Map<string, UsageEdge>();
  for (const item of evidence)
    for (const path of item.paths) {
      path.nodes.forEach((node, index) => {
        nodeOf.set(node.id, node);
        rowOf.set(node.id, Math.min(rowOf.get(node.id) ?? index, index));
      });
      for (const rel of path.relationships)
        edges.set(`${rel.from}|${rel.type}|${rel.to}`, {
          from: rel.from,
          to: rel.to,
          type: rel.type,
        });
    }
  const rows = new Map<number, PathNode[]>();
  for (const [id, row] of rowOf)
    rows.set(row, [...(rows.get(row) ?? []), nodeOf.get(id) as PathNode]);
  const nodes: UsageNode[] = [];
  let hidden = 0;
  for (const [row, members] of [...rows].sort(([a], [b]) => a - b)) {
    const shown = members.slice(0, PER_ROW);
    hidden += members.length - shown.length;
    for (const [index, node] of shown.entries())
      nodes.push({
        ...node,
        row,
        x: (WIDTH * (index + 1)) / (shown.length + 1),
        y: TOP + row * ROW,
      });
  }
  const placed = new Set(nodes.map((node) => node.id));
  const lastRow = Math.max(0, ...nodes.map((node) => node.row));
  return {
    nodes,
    edges: [...edges.values()].filter((edge) => placed.has(edge.from) && placed.has(edge.to)),
    hidden,
    height: TOP + lastRow * ROW + 40,
    labels: [...new Set(nodes.map((node) => node.label))],
  };
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const readable = (type: string) => type.toLowerCase().replaceAll("_", " ");

/** How the agents used the knowledge graph in an answer: the tools, and the nodes they walked. */
export function GraphUsage({ evidence }: { evidence: readonly GraphEvidence[] }) {
  if (evidence.length === 0) return null;
  const layout = graphLayout(evidence);
  const at = new Map(layout.nodes.map((node) => [node.id, node]));
  const source = evidence.some((item) => item.source === "neo4j") ? "Neo4j" : "local copy";
  const paths = evidence.reduce((sum, item) => sum + item.paths.length, 0);
  // Room for a name under each node, from how many share its row.
  const perRow = new Map<number, number>();
  for (const node of layout.nodes) perRow.set(node.row, (perRow.get(node.row) ?? 0) + 1);
  return (
    <section className="workspace-section graph-usage" aria-labelledby="graph-usage-title">
      <h3 id="graph-usage-title">
        Knowledge graph <span className="count">{layout.nodes.length}</span>
      </h3>
      <p className="graph-usage-lede">
        How the agents used the graph in the latest answer that queried it ({source}).
      </p>
      <ul className="graph-usage-tools">
        {evidence.map((item) => (
          <li key={item.tool}>
            <strong>{item.tool}</strong> · {item.paths.length} path
            {item.paths.length === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
      <svg
        className="graph-usage-map"
        viewBox={`0 0 ${WIDTH} ${layout.height}`}
        role="img"
        aria-label={`${layout.nodes.length} nodes and ${layout.edges.length} relationships along ${paths} evidence paths`}
      >
        {layout.edges.map((edge) => {
          const from = at.get(edge.from) as UsageNode;
          const to = at.get(edge.to) as UsageNode;
          const bend = from.row === to.row ? -26 : 0;
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2 + bend;
          return (
            <g key={`${edge.from}-${edge.type}-${edge.to}`} className="graph-usage-edge">
              <title>{`${from.name} ${readable(edge.type)} ${to.name}`}</title>
              <path d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`} />
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const room = Math.floor(WIDTH / ((perRow.get(node.row) ?? 1) + 1) / 6.2);
          return (
            <g
              key={node.id}
              className="graph-usage-node"
              transform={`translate(${node.x} ${node.y})`}
            >
              <title>{`${node.label}: ${node.name}`}</title>
              <circle r={8} fill={labelColor(node.label)} />
              <text y={22} textAnchor="middle">
                {short(node.name, Math.max(8, room))}
              </text>
            </g>
          );
        })}
      </svg>
      {layout.hidden > 0 && (
        <p className="graph-usage-more">
          {layout.hidden} more node{layout.hidden === 1 ? "" : "s"} not drawn; the answer's graph
          evidence lists every path.
        </p>
      )}
      <ul className="graph-usage-legend" aria-label="Node types">
        {layout.labels.map((label) => (
          <li key={label}>
            <i style={{ background: labelColor(label) }} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
