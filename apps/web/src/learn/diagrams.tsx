import { pageHost } from "@northstar/contracts";
import type { ReactNode } from "react";
import { labelColor } from "../graph/graph-model";
import { type Card, DIAGRAM_SPECS, type DiagramBlock, type Step } from "./diagram-specs";
import { diagramSpecsFor } from "./host";
import { useAiPlatform } from "../ai-platform";
import type { DiagramId } from "./lessons";

/**
 * Learn-page diagrams, drawn from the specs in diagram-specs.ts. Most are built from a few
 * accessible primitives (flows, lanes, cards) whose markup is ordered lists, so a screen reader
 * hears the same sequence the picture shows.
 */

function Figure({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="diagram" aria-label={label}>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function StepBox({ step }: { step: Step }) {
  return (
    <span className={`diagram-box tone-${step.tone}`}>
      {step.glyph && (
        <span className="diagram-glyph" aria-hidden="true">
          {step.glyph}
        </span>
      )}
      <span className="diagram-box-text">
        <strong>{step.title}</strong>
        {step.caption && <small>{step.caption}</small>}
      </span>
    </span>
  );
}

function Flow({ steps, numbered = false }: { steps: Step[]; numbered?: boolean }) {
  return (
    <ol className={`diagram-flow ${numbered ? "is-numbered" : ""}`}>
      {steps.map((step, index) => (
        <li key={step.title} className="diagram-step">
          {numbered && (
            <span className="diagram-number" aria-hidden="true">
              {index + 1}
            </span>
          )}
          <StepBox step={step} />
        </li>
      ))}
    </ol>
  );
}

function Lanes({ lanes }: { lanes: Array<{ label: string; steps: Step[] }> }) {
  return (
    <ul className="diagram-lanes">
      {lanes.map((lane) => (
        <li key={lane.label} className="diagram-lane">
          <span className="diagram-lane-label">{lane.label}</span>
          <Flow steps={lane.steps} />
        </li>
      ))}
    </ul>
  );
}

function Cards({ cards }: { cards: Card[] }) {
  return (
    <ul className="diagram-cards">
      {cards.map((card) => (
        <li key={card.title} className={`diagram-card tone-${card.tone}`}>
          <p className="diagram-card-title">
            {card.glyph && (
              <span className="diagram-glyph" aria-hidden="true">
                {card.glyph}
              </span>
            )}
            <strong>{card.title}</strong>
          </p>
          {card.caption && <p className="diagram-card-caption">{card.caption}</p>}
          {card.points && (
            <ul>
              {card.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

type Block<K extends DiagramBlock["kind"]> = Extract<DiagramBlock, { kind: K }>;

function ContextWindow({ segments, steps }: Block<"context-window">) {
  return (
    <div className="context-window">
      <p className="context-window-label">
        <span>Context window</span>
        <span>everything the model can see</span>
      </p>
      <ol className="context-bar">
        {segments.map((segment) => (
          <li
            key={segment.name}
            className={`context-segment tone-${segment.tone}`}
            style={{ flexGrow: segment.share }}
          >
            <strong>{segment.name}</strong>
            <small>{segment.detail}</small>
          </li>
        ))}
      </ol>
      <Flow steps={steps} />
    </div>
  );
}

function MemoryLayers({ layers }: Block<"memory-layers">) {
  return (
    <ol className="memory-layers">
      {layers.map((layer) => (
        <li key={layer.name} className={`memory-layer tone-${layer.tone}`}>
          <div>
            <strong>{layer.name}</strong>
            <small>{layer.where}</small>
          </div>
          <span className="memory-reader">{layer.reader}</span>
          <span className="memory-life">
            <span className="memory-bar" style={{ width: `${layer.width}%` }} aria-hidden="true" />
            <span>{layer.life}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function GraphPath({ description, nodes, edges }: Block<"graph-path">) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <svg
      className="graph-path-svg"
      viewBox="0 0 620 240"
      role="img"
      aria-labelledby="gp-title gp-desc"
    >
      <title id="gp-title">Evidence path</title>
      <desc id="gp-desc">{description}</desc>
      <defs>
        <marker
          id="gp-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="gp-arrowhead" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        const pad = 26;
        const x1 = from.x + (dx / length) * pad;
        const y1 = from.y + (dy / length) * pad;
        const x2 = to.x - (dx / length) * pad;
        const y2 = to.y - (dy / length) * pad;
        return (
          <g key={`${edge.from}-${edge.to}`} className={edge.path ? "gp-edge is-path" : "gp-edge"}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#gp-arrow)" />
            <text
              x={x1 + (x2 - x1) * (edge.path ? 0.5 : 0.62)}
              y={y1 + (y2 - y1) * (edge.path ? 0.5 : 0.62) - 7}
              textAnchor="middle"
            >
              {edge.type}
            </text>
          </g>
        );
      })}
      {nodes.map((node) => (
        <g key={node.id} className="gp-node">
          <circle cx={node.x} cy={node.y} r="20" fill={labelColor(node.label)} />
          <text x={node.x} y={node.y + 36} textAnchor="middle" className="gp-name">
            {node.name}
          </text>
          <text x={node.x} y={node.y + 50} textAnchor="middle" className="gp-label">
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function GraphTools({ tools, stores, parity }: Block<"graph-tools">) {
  const [first, second] = stores;
  return (
    <div className="graph-tools">
      <ul className="graph-tools-list">
        {tools.map(({ name, question }) => (
          <li key={name}>
            <code>{name}</code>
            <small>{question}</small>
          </li>
        ))}
      </ul>
      <div className="graph-tools-stores">
        {first && <StepBox step={first} />}
        <span className="graph-tools-parity">{parity}</span>
        {second && <StepBox step={second} />}
      </div>
    </div>
  );
}

function Architecture({ tiers }: Block<"architecture">) {
  return (
    <ol className="architecture">
      {tiers.map((tier) => (
        <li key={tier.label} className="arch-tier">
          <span className="arch-tier-label">{tier.label}</span>
          {tier.steps.map((step) => (
            <StepBox key={step.title} step={step} />
          ))}
        </li>
      ))}
    </ol>
  );
}

function Chips({ label, items }: Block<"chips">) {
  return (
    <ul className="diagram-chips" aria-label={label}>
      {items.map((item) => (
        <li key={item}>✓ {item}</li>
      ))}
    </ul>
  );
}

function DiagramBlockView({ block }: { block: DiagramBlock }) {
  switch (block.kind) {
    case "flow":
      return <Flow steps={block.steps} numbered={block.numbered} />;
    case "lanes":
      return <Lanes lanes={block.lanes} />;
    case "cards":
      return <Cards cards={block.cards} />;
    case "chips":
      return <Chips {...block} />;
    case "context-window":
      return <ContextWindow {...block} />;
    case "memory-layers":
      return <MemoryLayers {...block} />;
    case "graph-path":
      return <GraphPath {...block} />;
    case "graph-tools":
      return <GraphTools {...block} />;
    case "architecture":
      return <Architecture {...block} />;
  }
}

/** The diagrams with the names of the host this page came from (ADR-018). */
export function Diagram({ id }: { id: DiagramId }) {
  // Drawn for this page's host and the AI platform chosen in the top bar.
  const { platform } = useAiPlatform();
  const spec = diagramSpecsFor(pageHost(), platform)[id];
  return (
    <Figure label={spec.label} caption={spec.caption}>
      {spec.blocks.map((block, index) => (
        <DiagramBlockView key={index} block={block} />
      ))}
    </Figure>
  );
}

export const DIAGRAM_IDS = Object.keys(DIAGRAM_SPECS) as DiagramId[];
