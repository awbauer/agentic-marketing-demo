import type { RouteMap } from "./turn-route";

/**
 * The components the latest turn has passed through, lit as it runs. It sits above the composer so
 * it stays in view while the answer streams, and keeps the finished route until the next message.
 */
export function RouteMapPanel({ route }: { route: RouteMap }) {
  return (
    <section className={`route-map${route.live ? " live" : ""}`} aria-label="Query route">
      <p className="route-map-summary" aria-live="polite">
        <strong>Route</strong> {route.summary}
      </p>
      {route.lanes.map((lane) => (
        <ol className="route-lane" aria-label={lane.label} key={lane.id}>
          {lane.nodes.map((node) => (
            <li
              className={`route-node ${node.state}${node.branch ? " branch" : ""}`}
              data-node={node.id}
              key={node.id}
              title={node.detail || undefined}
            >
              <span className="route-node-mark" aria-hidden="true" />
              <span className="route-node-text">
                <span className="route-node-label">{node.label}</span>
                {node.detail && <span className="route-node-detail">{node.detail}</span>}
              </span>
              <span className="sr-only">: {node.stateLabel}</span>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}
