# WU-072: Lightning surface

Status: in review

## Scope

- A Lightning Web Component app using the Salesforce Lightning Design System: chat, use cases, brand and run-as selectors, connections, and turn history, with tool activity and the technical trace on each answer.
- Login through Cloudflare Access, then every call through an Apex relay to the existing Worker. The turn path, MCP servers, AI Gateway, policy router, confirmation flow, and turn history are unchanged. See ADR-012.
- New Worker routes: `/api/surface/login`, `/api/surface/bootstrap`, and `/agent/surface/{messages,turn,stop,clear}`.
- Out of scope: the workspace panel, image generation, memory management, and the Architecture, Graph, Learn, and Evaluations pages, which stay in the browser app.

## Acceptance criteria

- Login returns the Access token only to an allowed Salesforce origin, and an expired session returns to Login.
- A turn started from Salesforce runs through the same route and gateway as chat, keeps its brand and role, and appears in the same history.
- Tool calls and the trace show while a turn runs, and the trace stays open after it finishes.
- A write waits for a person to confirm it, with the signing material kept out of the component.
- The Apex relay can reach only the operations it names.

## Evidence

- `apps/edge/src/surface.worker.test.ts`: login hand-off, origin refusal, turn over HTTP with scope and history, clear.
- `salesforce/workbench-surface/.../northstarMarkdown/__tests__/`: rendering and escaping.
- `NorthstarWorkbenchControllerTest`: 7 of 7 passed, 100% coverage, run with `sf apex run test` (test run `707g800000uQjei`). The deploy itself reported its tests as skipped.
- Deployed to the Lightning org: deploy `0Afg800000KzC8oCAF`, 13 components, permission set assigned. The signed-out page renders in Lightning at `/lightning/n/Northstar_Workbench` with no console errors.
- An anonymous Apex probe with an invalid token reached Cloudflare Access and came back as signed out.
- `artifacts/evidence/WU-072/lwc-engine-tests.txt`: 11 signed-in scenarios under `@salesforce/sfdx-lwc-jest` with fixture responses, including the sign-in hand-off, a live turn, confirmation, and connecting Salesforce. They ran outside the repository so it takes no new dependency.

## Not yet demonstrated

The Worker routes are deployed: Workers Build `a75967bd-2066-4ce7-ac6c-b83f77cc98cd` shipped merge commit `3857dd4` as version `46ce9cbc-59b2-47ad-aea7-9869d59cf51f`, with `SURFACE_ALLOWED_ORIGINS` read back on that version. These still need a person's sign-in, because the browser pane opens popups only from a person's click:

- Access accepting the hand-off token in `cf-access-token` from Apex.
- `window.opener` surviving the Access sign-in window. If it doesn't, the page asks the person to press Login again, which skips the identity provider.
- A real turn, Salesforce connection, and write from Lightning.

## Post-merge regression

Merging added `.forceignore`, and the `Salesforce metadata` run on `3857dd4` then failed its last step. Its deploy and Apex test steps passed. Salesforce CLI's default `**/.*` ignore applies only when a `.forceignore` exists, so the retrieve into `.salesforce-readback` reported "Nothing retrieved" and the workflow's `find` failed.

Read-only retrieves against the proof org on the merged tree, using the pinned CLI 2.128.5:

| Tree | Output directory | Result |
| --- | --- | --- |
| With `.forceignore` | `.salesforce-readback` | Nothing retrieved |
| With `.forceignore` | `salesforce-readback` | Retrieved |
| Without `.forceignore` | `.salesforce-readback` | Retrieved |

The workflow now uses `salesforce-readback`. That step runs only on pushes to `main`, so its first real run is the merge of this fix.
