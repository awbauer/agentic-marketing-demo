# WU-073: Live route map

Status: in review

## Scope

- A route panel above the message box in the browser workbench and the Lightning surface. It shows the components a turn passes through, lit as it runs, and keeps the finished route until the next message.
- `routeMap` in `apps/web/src/turn-route.ts` reads the turn's existing trace. The Worker sends its result to Lightning on `GET /agent/surface/turn`, `GET /agent/surface/messages`, and `POST /agent/surface/turn`, so the component only draws it. See ADR-012.
- A turn sent from Lightning records `metadata.surface` on its user message. Chat history is shared, so the Apex relay hop follows the turn, not the page looking at it.
- Out of scope: a confirmed write, which runs after the turn and reports on its confirmation card.

## Acceptance criteria

- The node working now pulses and is named in words, and no node pulses once a turn ends.
- A turn the policy router answers leaves AI Gateway and Workers AI unlit.
- A tool failure marks its system. A gateway denial, or a tool outside the catalog, marks the agentic gateway and leaves the system unlit.
- A stopped, timed-out, or failed turn marks where it was waiting.
- The component shows nothing when the Worker sends no route, so it can deploy first.

## Evidence

- `apps/web/src/turn-route.test.ts`, `RouteMapPanel.test.tsx`: states from trace events, including each failure above.
- `apps/edge/src/surface.worker.test.ts`: a blocked turn over HTTP returns a route with the relay lit, the router lit, and the model unlit.
- `artifacts/evidence/WU-073/lwc-engine-tests.txt`: 12 signed-in scenarios under `@salesforce/sfdx-lwc-jest`, including a route followed through a turn with fixture responses and no route before one arrives.
- `tests/e2e/workbench.spec.ts`: the route after an offline turn.
- Local browser on 2026-11-06, sampled every 100 ms: the map went from the previous route to `router` active at 319 ms and to the finished route at 409 ms, on an offline turn that makes no model call.

## Not yet demonstrated

- A model or tool node lit by a real turn. The offline stack has no model, so those states are shown by tests replaying trace events, and their appearance was checked by setting them by hand in the browser.
- The panel in Lightning against the deployed Worker. It needs this change on `main`, because previews can't serve Lightning.
