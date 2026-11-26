# ADR-018: Run the workbench on Google Cloud as a second deployment target

Status: accepted

Date: 2026-11-25

## Context

Andrew asked for a branch (`gcp`) that runs the whole workbench on Google Cloud, with no Cloudflare service in the request path. He chose:

- **Dual-target**: the same application code keeps running on Cloudflare (`main` stays deployable) and also runs on GCP. Platform services sit behind ports with one adapter per target.
- **Vertex AI, keeping gpt-oss**: the orchestrator and architecture agents stay on gpt-oss (ADR-004, ADR-005, ADR-011), now served by Vertex AI as a managed model (MaaS), so evaluation results stay comparable.
- **Identity-Aware Proxy** in place of Cloudflare Access.
- **Firestore** in place of D1 and of the orchestrator Durable Object's SQLite storage.
- **gcloud scripts**, not Terraform, for provisioning and deploys.
- **Neo4j Aura and Salesforce stay external** HTTPS endpoints.
- Project `burner-andbauer-7311`. No region was given.

Today's Cloudflare surface, from `wrangler.jsonc` and `apps/edge/src` (the other bindings in `worker-configuration.d.ts` are generated type docs, not used):

| Cloudflare | Used for | Call sites |
| --- | --- | --- |
| Worker `fetch` + static assets | SPA, `/api/*`, `/mcp/*`, `/agent*` | `index.ts` |
| Durable Object `MarketingOrchestrator` (Agents SDK `AIChatAgent`) | one chat per user and workspace: messages, focus, working set, WebSocket, MCP client | `orchestrator.ts` (3,862 lines) |
| D1 `APP_DB` | confirmation audit, image drafts, architecture store, orchestrations, squad run library, turn history | ~45 in 5 files, 8 SQL migrations |
| R2 `CAMPAIGN_ASSETS` | generated campaign images | 2 files |
| Workers AI `AI` via AI Gateway | gpt-oss chat, Flux images, squad models (GLM-5.3, DeepSeek V4.1 Flash) | 6 files |
| AI Gateway (`AI_GATEWAY_ID`, `CF_AIG_TOKEN`) | logging, cost, Anthropic/OpenAI keys for the squad | 9 files |
| Access (`Cf-Access-Jwt-Assertion`) | sign-in, principal | `auth.ts` |
| Access MCP portal | per-user Salesforce OAuth in front of Hosted MCP | `SALESFORCE_MCP_URL` |
| Cron `17 * * * *` | retention prune, drift sweep, graph maintenance | `index.ts` `scheduled` |
| Workers Builds | deploy on push to `main`, preview per PR | CI |

## Decision

### Region

`us-central1`, for Cloud Run with direct IAP, Cloud Scheduler, the bucket, the Firestore database and gpt-oss-120b. Gemini's image model and Claude are served from Vertex's `global` location, which the adapter uses for those two only. Change the region with `GCP_REGION` (and `VERTEX_LOCATION`, `VERTEX_IMAGE_LOCATION`, `VERTEX_ANTHROPIC_LOCATION`).

**What Vertex offers, checked against the project on 2026-11-25.** The managed API serves `openai/gpt-oss-120b-maas` (answered in `us-central1`), but not gpt-oss-20b. Imagen is no longer listed; `gemini-3.1-flash-image` (GA, `global`) returns the 1024×1024 PNG the orchestrator validates. Claude models (Opus 5.5, Sonnet 5.5, …) are listed but return 404 until their terms are accepted in Model Garden, which needs a person.

### Platform seam

Add `apps/edge/src/platform/` with narrow ports, and make every Cloudflare call go through them. A host that sets `env.DATA` / `env.MODELS` gets its own implementations; otherwise the Cloudflare ones are used, so the Worker needs no change of configuration.

- `DataPlatform` (`platform/data.ts`): the confirmation audit, image drafts, the architecture store (orchestrations included) and the squad run library. Raw SQL leaves the feature code. Adapters: D1 (the existing SQL and schema, moved) and Firestore (`apps/gcp/src/platform/firestore.ts`: one collection per table; the idempotency key's uniqueness kept by a key document created in the same transaction; retention by the hourly prune plus a Firestore TTL on `expireAt`). Queries use equality filters or a single-field range only, so no composite index has to be deployed; ordering and limits are applied in code over data the 24-hour retention keeps small. Bodies over 700 KB (squad event logs) are split into a subcollection, since a document holds at most 1 MiB. Turn history, attempts and memory audit stay in the chat's own storage, as on Cloudflare.
- `ObjectStore`: the R2 shape the code already calls (`get`/`put`), over a Cloud Storage bucket.
- `Models`: returns AI SDK `LanguageModel`s and an image generator by role. Cloudflare: `workers-ai-provider` through AI Gateway. GCP: `@ai-sdk/openai` against the Vertex OpenAI-compatible endpoint with an ADC bearer token. Every chat model, gpt-oss-20b included, runs on `openai/gpt-oss-120b-maas`, the one gpt-oss Vertex offers (`VERTEX_MODEL_MAP` can point a catalog id at another Vertex model); the trace and squad report the catalog id actually served. Campaign images come from `gemini-3.1-flash-image`; the answer-quality judge is gpt-oss-120b answering Clef's rubric as JSON; Claude on Vertex serves the Anthropic squad provider. Every model call emits one structured log line (model, tokens, cost, latency, correlation id) so the route map and evals keep their numbers without AI Gateway.
- `Identity`: `resolvePrincipal(request)`. Cloudflare: Access JWT. GCP: `X-Goog-IAP-JWT-Assertion`, issuer `https://cloud.google.com/iap`, keys from `https://www.gstatic.com/iap/verify/public_key-jwk`, audience the IAP resource (`/projects/<number>/global/backendServices/<id>` behind the load balancer, `/projects/<number>/locations/<region>/services/<service>` with IAP on Cloud Run directly). IAP carries no custom claims, so role and tenant come from a Firestore `members/{email}` allowlist, defaulting to deny.
- `Scheduler`: the existing maintenance body, called by the Worker cron or by Cloud Scheduler posting to `/internal/scheduled` with a Google OIDC token the service verifies.

Feature code depends on ports only. `pnpm contracts:check` gains an invariant that nothing outside `platform/cloudflare/` imports a Cloudflare binding type.

### GCP host

Add `apps/gcp/`: a Node 26 server packaged with a Dockerfile and run on Cloud Run.

- It serves the built SPA, mounts the same `/api/*` and `/mcp/*` handlers (they already take a `Request` and return a `Response`), and exposes `/internal/scheduled`.
- The orchestrator class is unchanged. The GCP bundle aliases `@cloudflare/ai-chat` to `apps/gcp/src/agent/ai-chat.ts`, a Node implementation of the chat agent's members the orchestrator uses, speaking the same WebSocket protocol as the installed SDK (checked by tests that drive it with the SDK's own client code), so the React client is shared too.
- **Chat storage (changed from the first draft of this ADR).** Each chat keeps all its storage in one in-memory `node:sqlite` database, exactly as a Durable Object keeps its SQLite: messages, state, turn history, attempts, memory audit and Salesforce tokens. The host saves it to Cloud Storage (`sessions/<agent key>.sqlite`) after each change, with a generation precondition, so a save fails rather than overwrite a chat another instance saved. Storing chats as Firestore documents, as first planned, would have meant rewriting the orchestrator's 14 `this.sql` call sites and the SDK's message store for no gain; Firestore holds the shared tables, where queries across chats happen. Cloud Run runs one instance (`--max-instances 1`) with session affinity, so each chat has a single writer; the precondition makes a second writer fail loudly instead of losing data.
- Salesforce: the Access MCP portal is Cloudflare, so on GCP the session connects straight to Salesforce Hosted MCP with `@modelcontextprotocol/client`, OAuth authorization code with PKCE against the same External Client App (a second callback URL on the Cloud Run host), and per-user refresh tokens encrypted with a Secret Manager key in Firestore. The curated tool allowlist and confirm-before-write gateway are unchanged.
- Secrets (Neo4j, signing keys, Salesforce client, vendor keys) come from Secret Manager as Cloud Run secret env vars.

### Ingress under the organization's policies

The project sits in an organization folder whose policies, read on 2026-11-25, shape the front door:

- `run.allowedIngress` allows only `internal-and-cloud-load-balancing`, so the service cannot take traffic on its `run.app` URL from the internet.
- `iam.allowedPolicyMemberDomains` admits only the organization's own principals, so the service cannot grant `allUsers` the invoker role.
- `gcp.resourceLocations` forbids the `us` multi-region, so Cloud Build stages source in a regional bucket.
- The default compute service account has no roles, so builds run as a dedicated `northstar-workbench-build` account.

So `deploy.sh` defaults to a **global external HTTPS load balancer** (serverless NEG → backend service with IAP → URL map → managed certificate → forwarding rule on a reserved address) in front of a service with load-balancer-only ingress. `run.managed.requireInvokerIam` keeps Cloud Run's invoker check on, so IAP calls the service as its service agent, which holds the invoker role; the app checks IAP's signed assertion as well, so a request that bypassed IAP would still be refused. Without a domain of its own the certificate is issued for `<address>.nip.io`; `GCP_DOMAIN` names a real one. Cloud Scheduler calls the service's internal URL directly, which internal ingress admits, with an OIDC token the app verifies. `GCP_INGRESS=direct` keeps the simpler IAP-on-Cloud-Run setup for projects without these policies.

### Delivery

`scripts/gcp/bootstrap.sh` provisions the project once; `scripts/gcp/deploy.sh` builds the image with Cloud Build (`Dockerfile`: the React build plus `pnpm build:gcp`, one bundled `server.mjs` with Google's client libraries installed beside it) and deploys it with `gcloud run deploy --iap`, mounts every secret that has a value, sets the Firestore TTL policies, adds the IAP members, and creates the Cloud Scheduler job. GitHub Actions keeps running `pnpm verify`, which now includes `pnpm test:gcp` (adapters and the chat host; the Firestore suites run against the emulator).

## Consequences

- **The app names its host.** `packages/contracts/src/host.ts` holds one table of what each host calls its sign-in, models, gateway, database, object store and scheduler. The Google Cloud server tags `index.html` with `<meta name="northstar-host" content="google-cloud">`; the Worker serves it untouched, so one build works on both and Cloudflare stays the default. The browser (route map, image workflow, squad providers, use cases), the server (identity chain, squad errors) and the Learn course all name infrastructure from it. The course is written once, with what differs by host or by AI platform marked inline (`{{cloudflare: … || google-cloud: …}}`, `{{workers-ai: … || vertex: …}}`), resolved by `apps/web/src/learn/variants.ts` for the page's host and the AI platform chosen in the top bar (ADR-021); `docs/learn-google-cloud.md` is the Google Cloud edition. (Until 2026-11-26 it was rewritten sentence by sentence in `apps/web/src/learn/host.ts`.) A test fails if a Cloudflare name survives in the Google Cloud course outside the lessons that compare hosts or report the Workers AI evaluation.

- The Node chat host implements what the orchestrator uses, not the whole Agents SDK. It leaves out chat recovery after a crash mid-turn, streams that survive a restart (the resume buffer is in memory), automatic continuation after client tool results, schedules, sub-agents and `@callable` RPC, and MCP's SSE transport. A crash loses up to about two seconds of a chat's writes, the snapshot interval.

- Phase plan and acceptance criteria are in WU-077. `main` stays green throughout: the seam lands first with Cloudflare adapters only.
- The Lightning surface (ADR-012) passes an Access token to Lightning origins. IAP has no equivalent, so the surface is Cloudflare-only until a separate decision.
- Workers AI squad models (GLM-5.3, DeepSeek V4.1 Flash) map to the nearest Vertex MaaS models; the mapping is confirmed and re-scored with `pnpm eval:team` in Phase 5. The OpenAI squad provider calls OpenAI directly with a key in Secret Manager, which is a new external path; it stays off on GCP until Andrew approves it.
- Learn teaches the ports and the GCP target; the route map shows "Vertex AI" and "IAP" when running on GCP.
- Cost: Cloud Run (min instances 0 by default; 1 during demos for warm sockets), Firestore, Vertex per-token pricing. No always-on database instance.

## Supersedes

none. ADR-002 (Cloudflare foundation) remains the decision for `main`; this adds a second target.
