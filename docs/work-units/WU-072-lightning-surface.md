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

The Worker routes are deployed: Workers Build `a75967bd-2066-4ce7-ac6c-b83f77cc98cd` shipped merge commit `3857dd4` as version `46ce9cbc-59b2-47ad-aea7-9869d59cf51f`, with `SURFACE_ALLOWED_ORIGINS` read back on that version.

A person signed in and used the page from their own browser on 2026-11-06. Production Worker logs from 17:01 to 18:05 UTC show:

- 91 requests carrying `cf-access-token`, which only the Apex relay sends, all successful: `bootstrap` 2, `POST turn` 202 × 4, turn polls 46, `messages` 10, `clear` 2, `turns` 7, `operations` 4, `salesforce/status` 14, `salesforce/connect` 2. This shows Access accepting the token from Apex, so the `CF_Authorization` fallback isn't needed.
- `/api/surface/login` served once with `200`. A token could reach Apex only through that hand-off, so `window.opener` survived the Access sign-in.
- All 91 logged `cf-access-token` values are `REDACTED`.
- Two OAuth callbacks in the same 17:45 to 18:06 window as the two connects from Lightning.
- Two gateway `allow` decisions at 17:59, in the same window as the turns: `ext_get_fed_announcements` and `graph_match_news_to_approved_content`.

Still not demonstrated:

- A Salesforce MCP tool call from Lightning. The gateway log has none in that window, and a `302` callback doesn't prove the connection works.
- A confirmed write from Lightning. No `confirmations/execute` request reached the Worker in that window.
- The rendered tool trace, selectors, and history tab. The logs show the data being fetched, not how it looked.

## Post-merge regression

Merging added `.forceignore`, and the `Salesforce metadata` run on `3857dd4` then failed its last step. Its deploy and Apex test steps passed. Salesforce CLI's default `**/.*` ignore applies only when a `.forceignore` exists, so the retrieve into `.salesforce-readback` reported "Nothing retrieved" and the workflow's `find` failed.

Read-only retrieves against the proof org on the merged tree, using the pinned CLI 2.128.5:

| Tree | Output directory | Result |
| --- | --- | --- |
| With `.forceignore` | `.salesforce-readback` | Nothing retrieved |
| With `.forceignore` | `salesforce-readback` | Retrieved |
| Without `.forceignore` | `.salesforce-readback` | Retrieved |

The workflow now uses `salesforce-readback`. That step runs only on pushes to `main`, so its first real run is the merge of this fix.
