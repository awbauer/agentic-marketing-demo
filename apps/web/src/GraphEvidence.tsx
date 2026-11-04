import type { UIMessage } from "ai";

export type PathNode = { id: string; label: string; name: string };
export type PathRelationship = { type: string; from: string; to: string };
export type EvidencePath = { nodes: PathNode[]; relationships: PathRelationship[] };
export type GraphEvidence = { tool: string; source: "neo4j" | "fixture"; paths: EvidencePath[] };

const MAX_PATHS = 8;

function isPath(value: unknown): value is EvidencePath {
  const path = value as EvidencePath;
  return Array.isArray(path?.nodes) && Array.isArray(path?.relationships);
}

/** Knowledge-graph evidence paths returned by graph tools in this assistant message. */
export function graphEvidence(message: UIMessage): GraphEvidence[] {
  return message.parts.flatMap((part) => {
    if (!("toolName" in part) && !part.type.startsWith("tool-")) return [];
    const name = "toolName" in part ? String(part.toolName) : part.type.slice(5);
    if (!name.startsWith("graph_") || !("output" in part)) return [];
    const output = part.output as { structuredContent?: { paths?: unknown[]; source?: string } };
    const content = output?.structuredContent;
    const paths = (content?.paths ?? []).filter(isPath);
    if (!paths.length) return [];
    return [
      {
        tool: name.slice("graph_".length).replaceAll("_", " "),
        source: content?.source === "neo4j" ? "neo4j" : "fixture",
        paths,
      },
    ];
  });
}

function link(path: EvidencePath, a: PathNode, b: PathNode) {
  const forward = path.relationships.find((rel) => rel.from === a.id && rel.to === b.id);
  if (forward) return { type: forward.type, arrow: "→" };
  const backward = path.relationships.find((rel) => rel.from === b.id && rel.to === a.id);
  return backward ? { type: backward.type, arrow: "←" } : { type: "", arrow: "·" };
}

function describe(path: EvidencePath) {
  return path.nodes
    .map((node, index) => {
      const next = path.nodes[index + 1];
      if (!next) return `${node.label} ${node.name}`;
      const { type, arrow } = link(path, node, next);
      return `${node.label} ${node.name} ${arrow === "←" ? "is linked from" : "links to"} (${type})`;
    })
    .join(" ");
}

export function GraphEvidencePanel({ message }: { message: UIMessage }) {
  const evidence = graphEvidence(message);
  if (!evidence.length) return null;
  const source = evidence.some((item) => item.source === "neo4j") ? "Neo4j" : "demo copy";
  return (
    <section className="graph-evidence" aria-label="Knowledge graph evidence">
      <h4>
        Graph evidence <span>· {source}</span>
      </h4>
      {evidence.map((item) => (
        <div key={item.tool} className="graph-evidence-tool">
          <p className="graph-evidence-label">{item.tool}</p>
          <ol className="graph-paths">
            {item.paths.slice(0, MAX_PATHS).map((path, pathIndex) => (
              <li
                key={`${item.tool}-${pathIndex}`}
                className="graph-path"
                aria-label={describe(path)}
              >
                {path.nodes.map((node, index) => {
                  const next = path.nodes[index + 1];
                  const relation = next ? link(path, node, next) : null;
                  return (
                    <span key={`${node.id}-${index}`} className="graph-step" aria-hidden="true">
                      <span className={`graph-node node-${node.label.toLowerCase()}`}>
                        <small>{node.label}</small>
                        {node.name}
                      </span>
                      {relation && (
                        <span className="graph-edge">
                          {relation.arrow === "←" ? "←" : ""}
                          <em>{relation.type}</em>
                          {relation.arrow === "→" ? "→" : ""}
                        </span>
                      )}
                    </span>
                  );
                })}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
