import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND_NODE_IDS, brandForNode, useScope } from "../scope";
import { type CanvasCommand, GraphCanvas } from "./GraphCanvas";
import {
  brandScope,
  type ConnectionGroup,
  connectionsOf,
  DOMAINS,
  formatValue,
  type GraphNeighbors,
  type GraphOverview,
  type GraphState,
  type Insight,
  labelColor,
  labelName,
  mergeGraph,
  propertyName,
  pushInsight,
  relationshipPhrase,
  type SimNode,
} from "./graph-model";
import "./graph.css";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; overview: GraphOverview };

type Tour = {
  id: string;
  title: string;
  question: string;
  explain: string;
  /** Picks the node to open; tours that need push sends expand it too. */
  target: (graph: GraphState) => string | undefined;
  expand?: boolean;
};

export const TOURS: Tour[] = [
  {
    id: "campaign",
    title: "How a campaign fits together",
    question: "What is Fall Loyalty Reactivation built from?",
    explain:
      "A campaign has a brief, content assets, and an audience segment. Each asset links to the brand rules it passed or failed, which is how the graph explains readiness.",
    target: () => "camp-fall",
  },
  {
    id: "audience",
    title: "Who a campaign reaches",
    question: "Why is this buyer group in the audience?",
    explain:
      "A segment includes accounts and personas. Personas carry consent scopes and engagement, so the orchestrator can show the path that justifies each member.",
    target: () => "segment-camp-fall",
  },
  {
    id: "coastline",
    title: "Coastline Kitchen under Northstar",
    question: "How does Coastline's weather campaign reach app users?",
    explain:
      "Coastline Kitchen is a brand under Northstar. Its weather campaign runs on the mobile app channel, targets an app segment near each location with aggregate push consent, and uses push content checked against Coastline's own brand rules.",
    target: () => "camp-coastline-weather",
  },
  {
    id: "rain",
    title: "What worked in the rain",
    question: "Which past pushes performed best when it rained?",
    explain:
      "Each push send links to its campaign, the push content it used, the app segment and push consent it went out under, and the location, daypart, weather, and menu item. The push scenario reads these paths before drafting a new notification.",
    target: () => "weather-rain",
    expand: true,
  },
  {
    id: "wealth-news",
    title: "Approved content for market news",
    question: "What can Harborstone send when the Fed raises rates?",
    explain:
      "Harborstone Wealth is a brand under Northstar. Content about a market event is approved ahead of time: each asset links to its approval record (approved, expired, or pending) and the disclosures it must carry, so the graph can say what's ready to send and why the rest is blocked.",
    target: () => "event-rate-increase",
    expand: true,
  },
  {
    id: "wealth-client",
    title: "An account plan from the graph",
    question: "How could Harborstone grow Cedar Valley Community Foundation?",
    explain:
      "A client's signals suggest products it doesn't hold yet, peers of the same type show what's typical, and each product links to approved content. Its contacts carry consent by channel, so the plan names who to reach, how, and with what.",
    target: () => "client-cedar-valley-community-foundation",
    expand: true,
  },
  {
    id: "pharma-claims",
    title: "Which clinical claims can Cardivance use?",
    question: "Which Cardivance claims are supported, on label, and approved?",
    explain:
      "Lumera Therapeutics is a brand under Northstar. A clinical claim is about a drug and an indication. A completed trial must SUPPORT it, the drug must be INDICATED_FOR that indication (not only INVESTIGATED_FOR), and the content that CARRIES it needs a current MLR approval and its required safety information.",
    target: () => "drug-cardivance",
    expand: true,
  },
  {
    id: "pharma-targets",
    title: "Where to engage first",
    question: "Which hospitals and prescriber groups should Lumera reach for Cardivance?",
    explain:
      "A prescriber group practices at a hospital, which sees patients with an indication and has a formulary status for each drug. The group's share, decile and opted-in channels decide where to start, and a drug that is not on formulary needs access content before any detailing.",
    target: () => "hospital-st-brigid",
    expand: true,
  },
  {
    id: "brand",
    title: "A failed brand check",
    question: "Which content failed a brand rule?",
    explain:
      "Brand rules sit between content and launch. A FAILED relationship is evidence the readiness check cites, instead of the model guessing.",
    target: (graph) => graph.links.find((link) => link.type === "FAILED")?.to,
  },
];

const PREVIEW_CONNECTIONS = 10;

const dotStyle = (label: string) => ({ "--dot": labelColor(label) }) as React.CSSProperties;

export function GraphView({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [graph, setGraph] = useState<GraphState>({ nodes: [], links: [] });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // The brand chosen in the header decides the graph's brand filter, and the filter updates it.
  const { scope: header, setBrand: setScopeBrand } = useScope();
  const brand = header.brand === "all" ? null : BRAND_NODE_IDS[header.brand];
  const setBrand = useCallback(
    (nodeId: string | null) => setScopeBrand(brandForNode(nodeId)),
    [setScopeBrand],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<SimNode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, { shown: number; total: number }>>({});
  const [expanding, setExpanding] = useState<string | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tourId, setTourId] = useState<string | null>(null);
  const [command, setCommand] = useState<CanvasCommand | null>(null);
  const commandCount = useRef(0);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const send = useCallback((kind: CanvasCommand["kind"], id?: string) => {
    commandCount.current += 1;
    setCommand({ kind, id, n: commandCount.current });
  }, []);

  const fetchOverview = useCallback(() => {
    setLoad({ status: "loading" });
    fetch("/api/graph/overview", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as GraphOverview & {
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
        setGraph(mergeGraph({ nodes: [], links: [] }, body.nodes, body.relationships));
        setLoad({ status: "ready", overview: body });
      })
      .catch((error: unknown) =>
        setLoad({
          status: "error",
          message: error instanceof Error ? error.message : "The knowledge graph is unavailable.",
        }),
      );
  }, []);

  useEffect(fetchOverview, []);

  const select = useCallback(
    (id: string | null, focus = true) => {
      setSelectedId(id);
      setExpandError(null);
      if (id && focus) send("focus", id);
    },
    [send],
  );

  const expand = useCallback(
    async (id: string) => {
      setExpanding(id);
      setExpandError(null);
      try {
        const response = await fetch(`/api/graph/nodes/${encodeURIComponent(id)}/neighbors`, {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as GraphNeighbors & {
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
        setGraph((current) => mergeGraph(current, body.nodes, body.relationships, id));
        setExpanded((current) => ({
          ...current,
          [id]: { shown: body.nodes.length, total: body.total },
        }));
        // Expanding into a hidden type (push sends) makes that type visible.
        setHidden((current) => {
          const labels = new Set(body.nodes.map((node) => node.label));
          if (![...current].some((label) => labels.has(label))) return current;
          return new Set([...current].filter((label) => !labels.has(label)));
        });
        send("focus", id);
      } catch (error) {
        setExpandError(error instanceof Error ? error.message : "Could not load connections.");
      } finally {
        setExpanding(null);
      }
    },
    [send],
  );

  const startTour = (tour: Tour) => {
    const id = tour.target(graphRef.current);
    if (!id) return;
    if (scope && !scope.has(id)) setBrand(null);
    setTourId(tour.id);
    select(id);
    if (tour.expand && !expanded[id]) void expand(id);
  };

  const toggleLabel = (label: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const counts = useMemo(() => {
    const loaded: Record<string, number> = {};
    for (const node of graph.nodes) loaded[node.label] = (loaded[node.label] ?? 0) + 1;
    return loaded;
  }, [graph.nodes]);

  const brands = useMemo(
    () =>
      graph.nodes
        .filter((node) => node.label === "Brand")
        .map((node) => ({
          ...node,
          parent: graph.nodes.find((other) =>
            graph.links.some(
              (link) => link.type === "PART_OF" && link.from === node.id && link.to === other.id,
            ),
          ),
        }))
        .sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent))),
    [graph],
  );
  const scope = useMemo(() => (brand ? brandScope(graph, brand) : null), [graph, brand]);
  const activeBrand = brands.find((candidate) => candidate.id === brand) ?? null;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return graph.nodes
      .filter(
        (node) =>
          (!scope || scope.has(node.id)) &&
          (node.name.toLowerCase().includes(term) ||
            labelName(node.label).toLowerCase().includes(term)),
      )
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8);
  }, [graph.nodes, query, scope]);

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const tour = TOURS.find((candidate) => candidate.id === tourId) ?? null;
  const overview = load.status === "ready" ? load.overview : null;
  const totalNodes = overview
    ? Object.values(overview.labelCounts).reduce((sum, count) => sum + count, 0)
    : 0;
  const totalLinks = overview
    ? Object.values(overview.relationshipCounts).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <section className="evaluations-view graph-view" aria-labelledby="graph-title">
      <div className="section-header graph-header">
        <div>
          <p className="kicker">Knowledge graph</p>
          <h2 id="graph-title">Graph explorer</h2>
          <p className="graph-lede">
            {header.brand === "all"
              ? "The fictional Northstar, Coastline Kitchen, Harborstone Wealth, and Lumera Therapeutics graph"
              : `The fictional Northstar graph, showing ${header.brand},`}{" "}
            that the orchestrator's graph tools read. Pick a tour, search, or click any node to see
            how it connects.
          </p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      <div className="graph-body">
        {load.status === "loading" && (
          <p className="graph-status" role="status">
            Loading the graph…
          </p>
        )}
        {load.status === "error" && (
          <div className="error-banner" role="alert">
            The knowledge graph could not be loaded: {load.message}{" "}
            <button type="button" className="text-button" onClick={fetchOverview}>
              Retry
            </button>
          </div>
        )}

        {overview && (
          <>
            <dl className="graph-stats">
              <div>
                <dt>Source</dt>
                <dd>
                  <span className={`graph-source source-${overview.source}`}>
                    {overview.source === "neo4j" ? "Live · Neo4j Aura" : "Local copy"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Nodes on canvas</dt>
                <dd>
                  <strong>{graph.nodes.length.toLocaleString()}</strong> of{" "}
                  {totalNodes.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>
                  <strong>{graph.links.length.toLocaleString()}</strong> of{" "}
                  {totalLinks.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Node types</dt>
                <dd>
                  <strong>{Object.keys(overview.labelCounts).length}</strong> across{" "}
                  {DOMAINS.length} domains
                </dd>
              </div>
            </dl>

            <div className="graph-layout">
              <aside className="graph-panel graph-side" aria-label="Explore the graph">
                <div className="graph-search">
                  <label htmlFor="graph-search">Find a node</label>
                  <input
                    id="graph-search"
                    type="search"
                    placeholder="Campaign, menu item, persona…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    autoComplete="off"
                  />
                  {matches.length > 0 && (
                    <ul className="graph-matches" aria-label="Matching nodes">
                      {matches.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            className="graph-row-button"
                            onClick={() => {
                              setQuery("");
                              setTourId(null);
                              if (hidden.has(node.label)) toggleLabel(node.label);
                              select(node.id);
                            }}
                          >
                            <span
                              className="graph-dot"
                              style={dotStyle(node.label)}
                              aria-hidden="true"
                            />
                            {node.name}
                            <small className="graph-row-meta">{labelName(node.label)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {query.trim().length >= 2 && matches.length === 0 && (
                    <p className="graph-hint">No loaded node matches “{query.trim()}”.</p>
                  )}
                </div>

                {brands.length > 1 && (
                  <section className="graph-brands" aria-labelledby="graph-brands-title">
                    <h3 id="graph-brands-title">Brand</h3>
                    <fieldset className="graph-brand-options">
                      <legend className="sr-only">Filter by brand</legend>
                      {[{ id: null, name: "All brands" }, ...brands].map((option) => (
                        <button
                          type="button"
                          key={option.id ?? "all"}
                          className="graph-brand"
                          aria-pressed={brand === option.id}
                          onClick={() => setBrand(option.id)}
                        >
                          {option.name}
                        </button>
                      ))}
                    </fieldset>
                    {activeBrand && scope && (
                      <p className="graph-hint">
                        {scope.size.toLocaleString()} loaded nodes connect to {activeBrand.name}{" "}
                        more closely than to any other brand
                        {activeBrand.parent
                          ? `; anything reached through ${activeBrand.parent.name}, its parent brand, is hidden.`
                          : "."}
                      </p>
                    )}
                  </section>
                )}

                <section className="graph-tours" aria-labelledby="graph-tours-title">
                  <h3 id="graph-tours-title">Guided tours</h3>
                  <ol>
                    {TOURS.map((candidate, index) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          className="graph-tour-button"
                          aria-pressed={tourId === candidate.id}
                          onClick={() => startTour(candidate)}
                        >
                          <span className="graph-tour-step">{index + 1}</span>
                          <span>
                            <strong className="graph-tour-title">{candidate.title}</strong>
                            <small className="graph-tour-sub">{candidate.question}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="graph-legend" aria-labelledby="graph-legend-title">
                  <h3 id="graph-legend-title">Node types</h3>
                  <p className="graph-hint">Turn a type off to declutter the canvas.</p>
                  {DOMAINS.map((domain) => (
                    <fieldset key={domain.id}>
                      <legend>
                        {domain.title}
                        <small>{domain.blurb}</small>
                      </legend>
                      {domain.labels.map((label) => {
                        const total = overview.labelCounts[label] ?? 0;
                        const loaded = counts[label] ?? 0;
                        const on = !hidden.has(label);
                        return (
                          <button
                            type="button"
                            key={label}
                            className="graph-type"
                            aria-pressed={on}
                            disabled={loaded === 0}
                            onClick={() => toggleLabel(label)}
                            title={
                              loaded === 0
                                ? "Expand a location, daypart, weather, or menu item node to load these."
                                : undefined
                            }
                          >
                            <span
                              className="graph-dot"
                              style={dotStyle(label)}
                              aria-hidden="true"
                            />
                            <span className="graph-type-name">{labelName(label)}</span>
                            <span className="graph-type-count">
                              {loaded === total ? total : `${loaded} / ${total}`}
                            </span>
                          </button>
                        );
                      })}
                    </fieldset>
                  ))}
                  {overview.hiddenLabels.length > 0 && (
                    <p className="graph-hint">
                      Push sends ({(overview.labelCounts.PushSend ?? 0).toLocaleString()}) load on
                      demand: expand a location, daypart, weather, or menu item.
                    </p>
                  )}
                </section>
              </aside>

              <div className="graph-stage">
                <div className="graph-toolbar" role="toolbar" aria-label="Canvas controls">
                  <button
                    type="button"
                    className="graph-tool"
                    onClick={() => send("zoom-in")}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="graph-tool"
                    onClick={() => send("zoom-out")}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button type="button" className="graph-tool" onClick={() => send("fit")}>
                    Fit
                  </button>
                </div>
                <GraphCanvas
                  graph={graph}
                  hiddenLabels={hidden}
                  scope={scope}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setTourId(null);
                    select(id, false);
                  }}
                  onHover={setHovered}
                  command={command}
                />
                <p className="graph-caption" aria-live="polite">
                  {hovered ? (
                    <>
                      <span
                        className="graph-dot"
                        style={dotStyle(hovered.label)}
                        aria-hidden="true"
                      />
                      <strong className="graph-caption-name">{hovered.name}</strong> ·{" "}
                      {labelName(hovered.label)} · {hovered.degree} connection
                      {hovered.degree === 1 ? "" : "s"} loaded
                    </>
                  ) : (
                    "Drag to pan · scroll to zoom · drag a node to pin it · click a node for details"
                  )}
                </p>
              </div>

              <aside className="graph-panel graph-details" aria-label="Node details">
                {tour && (
                  <div className="graph-tour-card">
                    <p className="kicker">Tour</p>
                    <h3>{tour.title}</h3>
                    <p className="graph-tour-question">“{tour.question}”</p>
                    <p>{tour.explain}</p>
                  </div>
                )}
                {selected ? (
                  <NodeDetails
                    node={selected}
                    graph={graph}
                    expansion={expanded[selected.id]}
                    expanding={expanding === selected.id}
                    error={expandError}
                    onExpand={() => void expand(selected.id)}
                    onSelect={(id) => {
                      const node = graph.nodes.find((candidate) => candidate.id === id);
                      if (node && hidden.has(node.label)) toggleLabel(node.label);
                      if (scope && !scope.has(id)) setBrand(null);
                      select(id);
                    }}
                  />
                ) : (
                  !tour && <GraphPrimer brand={header.brand} />
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const PRIMER_COLORS: Record<string, string> = {
  all: "Coastline Kitchen's restaurants and Lumera's drugs, trials, claims and hospitals",
  "Coastline Kitchen": "Coastline Kitchen's restaurants and menu",
  "Harborstone Wealth": "Harborstone's market events, assets and approvals",
  "Lumera Therapeutics":
    "Lumera's drugs, indications, trials, claims, hospitals and prescriber groups",
};

function GraphPrimer({ brand }: { brand: string }) {
  return (
    <div className="graph-primer">
      <p className="kicker">How to read it</p>
      <h3>Nodes are things, relationships are facts</h3>
      <ol>
        <li>
          <strong>Colors are node types</strong>, grouped into brands and campaigns, audience and
          consent, and {PRIMER_COLORS[brand]}.
        </li>
        <li>
          <strong>Size is connectedness</strong>: bigger nodes take part in more relationships.
        </li>
        <li>
          <strong>Click a node</strong> to light up its neighborhood and read each relationship as a
          sentence, such as “Brief is for Campaign”.
        </li>
        <li>
          <strong>Expand</strong> to fetch more of a node's neighbors from Neo4j, including the
          1,500 historical push sends.
        </li>
      </ol>
      <p className="graph-hint">
        This is the same data the orchestrator's <code>graph_</code> tools query. Every name and
        number is fictional.
      </p>
    </div>
  );
}

function NodeDetails({
  node,
  graph,
  expansion,
  expanding,
  error,
  onExpand,
  onSelect,
}: {
  node: SimNode;
  graph: GraphState;
  expansion?: { shown: number; total: number };
  expanding: boolean;
  error: string | null;
  onExpand: () => void;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(() => connectionsOf(graph, node.id), [graph, node.id]);
  const insight = useMemo(() => pushInsight(graph, node.id), [graph, node.id]);
  const properties = Object.entries(node.properties);
  return (
    <div className="graph-node-details">
      <p className="graph-node-type">
        <span className="graph-dot" style={dotStyle(node.label)} aria-hidden="true" />
        {labelName(node.label)}
      </p>
      <h3>{node.name}</h3>
      <code className="graph-node-id">{node.id}</code>

      {properties.length > 0 && (
        <dl className="graph-properties">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{propertyName(key)}</dt>
              <dd>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="graph-expand">
        <button
          type="button"
          className="graph-expand-button"
          onClick={onExpand}
          disabled={expanding || Boolean(expansion)}
        >
          {expanding ? "Loading neighbors…" : expansion ? "Neighbors loaded" : "Expand neighbors"}
        </button>
        {expansion && (
          <p className="graph-hint">
            Loaded {expansion.shown} of {expansion.total} connections
            {expansion.shown < expansion.total ? " (the 60 best performing first)" : ""}.
          </p>
        )}
        {error && (
          <p className="history-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {insight && <InsightChart insight={insight} subject={node.name} onSelect={onSelect} />}

      <h4>
        Connections <small>{node.degree} loaded</small>
      </h4>
      {groups.length === 0 ? (
        <p className="graph-hint">No loaded connections. Expand to fetch them.</p>
      ) : (
        <ul className="graph-connections">
          {groups.map((group) => (
            <li key={group.key}>
              <ConnectionList group={group} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightChart({
  insight,
  subject,
  onSelect,
}: {
  insight: Insight;
  subject: string;
  onSelect: (id: string) => void;
}) {
  const best = insight.rows[0]?.average ?? 1;
  return (
    <figure className="graph-insight">
      <figcaption>
        <strong>What the graph says</strong>
        <span>
          Average order rate by {insight.groupedBy} across the {insight.pushes} loaded pushes for{" "}
          {subject}
        </span>
      </figcaption>
      <ol>
        {insight.rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="graph-insight-row" onClick={() => onSelect(row.id)}>
              <span className="graph-insight-name">{row.name}</span>
              <span className="graph-insight-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(6, (row.average / best) * 100)}%`,
                    ...dotStyle(row.label),
                  }}
                />
              </span>
              <span className="graph-insight-value">
                {(row.average * 100).toFixed(1)}%
                <small className="graph-insight-count"> · {row.count}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function ConnectionList({
  group,
  onSelect,
}: {
  group: ConnectionGroup;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? group.nodes : group.nodes.slice(0, PREVIEW_CONNECTIONS);
  const phrase = relationshipPhrase(group.type);
  return (
    <>
      <p className="graph-connection-title">
        <span className="graph-direction" aria-hidden="true">
          {group.direction === "out" ? "→" : "←"}
        </span>
        <span>
          {group.direction === "out" ? `This ${phrase}` : `${phrase} this`}
          <span className="sr-only">
            {group.direction === "out" ? " (outgoing)" : " (incoming)"}
          </span>
        </span>
        <em>{group.nodes.length}</em>
      </p>
      <ul>
        {shown.map((other) => (
          <li key={other.id}>
            <button type="button" className="graph-row-button" onClick={() => onSelect(other.id)}>
              <span className="graph-dot" style={dotStyle(other.label)} aria-hidden="true" />
              <span>{other.name}</span>
              <small className="graph-row-meta">{labelName(other.label)}</small>
            </button>
          </li>
        ))}
      </ul>
      {group.nodes.length > PREVIEW_CONNECTIONS && (
        <button type="button" className="text-button graph-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${group.nodes.length}`}
        </button>
      )}
    </>
  );
}
