---
id: WU-077
title: The workbench runs entirely on Google Cloud, from the same code as Cloudflare
status: in review
plan_sections: [3, 16, 17]
owners: [agent]
---

# Why

Andrew asked for a `gcp` branch that runs the project 100% on Google Cloud, keeping the Cloudflare target working (dual-target). The decisions are in ADR-018.

# Objective

`scripts/gcp/deploy.sh` deploys the workbench to project `burner-andbauer-7311` (`us-central1`), and an IAP-signed-in evaluator can chat with the orchestrator, see a confirmed Salesforce write audited in Firestore, run the squad on Vertex AI, and browse the graph, with no Cloudflare service in the request path. `pnpm deploy` to Cloudflare still works from the same commit.

## Scope

- In-scope paths: `apps/edge/src/platform/`, the feature files that call D1/R2/AI/Access today, `apps/gcp/`, `scripts/gcp/`, `infra/gcp/`, Learn, docs.
- Out of scope: the Lightning surface on GCP (ADR-018); moving Neo4j Aura or Salesforce; Terraform; removing Cloudflare from `main`.

## What was built

- **Platform seam** (`apps/edge/src/platform/`): `DataPlatform` (audit, image drafts, architecture store, squad library) with the D1 implementation moved out of the feature code; `ModelPlatform` (chat models, images, judge, vendor routing) with the Workers AI implementation. `app.ts` holds every route; `index.ts` is the Cloudflare host. `pnpm contracts:check` refuses direct D1 or Workers AI use outside the seam.
- **Google Cloud adapters** (`apps/gcp/src/platform/`): Firestore repositories, Cloud Storage (images and chat snapshots, generation-checked), Vertex AI (gpt-oss-120b, Gemini image, judge, Claude routing), IAP sign-in with a Firestore members list (`apps/edge/src/auth.ts`), static files, the Cloud Scheduler token check.
- **Node chat host** (`apps/gcp/src/agent/`): a Node `AIChatAgent` speaking the SDK's WebSocket protocol, aliased in for `@cloudflare/ai-chat`, so the orchestrator and React client are unchanged; per-chat `node:sqlite` storage snapshotted to Cloud Storage; MCP client with OAuth/PKCE and AES-GCM-sealed tokens.
- **Server and delivery**: `apps/gcp/src/server.ts`, `vite.gcp.config.ts` (one bundled `server.mjs`), `Dockerfile`, `cloudbuild.gcp.yaml`, `scripts/gcp/bootstrap.sh` and `deploy.sh`.
- **Host-aware app**: `packages/contracts/src/host.ts` names each host's services; the GCP server tags the page with its host and the UI, server messages and Learn course (a Google Cloud edition, `docs/learn-google-cloud.md`) use Google Cloud's names there and Cloudflare's on the Worker. README, the architecture roadmap, the evaluator guide, the agent docs, the threat model and the Salesforce README describe the Google Cloud infrastructure. `pnpm dev:gcp` runs the GCP server locally.
- **Route map and Learn**: turns on Google Cloud carry `host: "google-cloud"` in their trace, and the route map shows Identity-Aware Proxy and Vertex AI without an AI Gateway hop; a new *Two hosts* lesson.

## Acceptance criteria

- [x] ADR-018 records the target, region, seam, and the Salesforce and Lightning consequences.
- [x] `scripts/gcp/bootstrap.sh` provisions APIs, Firestore, the bucket, Artifact Registry, service accounts and empty secrets, idempotently, and refuses to run without an explicit project.
- [x] No feature file reaches D1 or Workers AI except through `apps/edge/src/platform/`; `pnpm contracts:check` enforces it.
- [x] The D1 repositories pass the existing worker tests; the Firestore ones pass the same behaviours against the emulator.
- [x] The Node host serves the SPA and the API; `/api/session` is refused without a valid IAP assertion from a listed member.
- [x] A chat on the Node host survives a reload and a new host (snapshot round trip) with its messages and state.
- [x] `pnpm verify`'s gates pass except `lint`, which fails identically on the base commit (six library SVGs without titles); `pnpm build` still builds the Cloudflare Worker.
- [ ] A confirmed write runs once per idempotency key, audited in Firestore, then read back from Salesforce on Google Cloud. Needs the Salesforce secrets and callback URL.
- [ ] `pnpm eval` / `pnpm eval:team` on Vertex gpt-oss-120b, compared with the Workers AI baseline.
- [ ] An evaluator signs in through IAP on the deployed load balancer and runs a model turn.

## Verification

- `pnpm test:gcp`: 8 files, 49 tests (adapters against fakes; Firestore repositories and the end-to-end server against the emulator; the chat host driven by the SDK's own client code; the unchanged orchestrator on the host).
- `pnpm test:worker`: 26 files, 203 tests. `pnpm test:unit`: 33 files, 293 tests (two new route-map tests).
- `pnpm format:check`, `typecheck` (now including `apps/gcp`), `sf:metadata:check`, `hxl:check`, `eval`, `contracts:check`, `docs:check`, `prompts:check`, `learn:check`, `build`, `build:gcp`: pass.

## Evidence

- Vertex AI in `burner-andbauer-7311`, 2026-11-25: `openai/gpt-oss-120b-maas` answered in `us-central1`; `gpt-oss-20b-maas` and every Imagen id returned 404 and are not listed; `gemini-3.1-flash-image` in `global` returned a 1024×1024 PNG; Claude models are listed but return 404 until enabled.
- The bundled server run locally against the Firestore emulator served `/api/health`, `/api/ready`, `/api/session`, `/agent/operations`, `/agent/turns`, the squad library and the SPA. In the built React app, a chat message went over the WebSocket, the policy router answered, the route map showed Identity-Aware Proxy and Vertex AI, and the chat was still there after a reload.
- Deployed: image `us-central1-docker.pkg.dev/burner-andbauer-7311/northstar/workbench:f0621bd-dirty` (Cloud Build), Cloud Run revision `northstar-workbench-00009-f8b` started and listening; the `run.app` URL answers 404 from the internet (ingress admits only the load balancer and Google-internal callers); load balancer `https://136.110.207.171.nip.io` with IAP; once its managed certificate was active, an unauthenticated request was redirected (302) to Google sign-in.

## Not yet demonstrated

- A signed-in session on the deployed URL (IAP's redirect works; the sign-in itself needs a person).
- The hourly Cloud Scheduler run against the deployed service.
- Model turns, images and the squad on Vertex in the deployed service, and `pnpm eval` on Vertex.
- Salesforce on Google Cloud: needs `SALESFORCE_MCP_URL`, `SALESFORCE_CLIENT_ID`, `CONFIRMATION_SIGNING_KEY` (shared with Salesforce) and the callback URL in the External Client App.
- Neo4j on Google Cloud: the `NEO4J_*` secrets are empty, so the deployed service uses the fixture graph.
- The squad's Anthropic provider (Claude needs enabling in Model Garden); OpenAI stays off pending approval.
- Chat recovery after a crash mid-turn, and streams that survive a restart (ADR-018 lists what the Node host leaves out).

## Human steps

- Enable Claude Opus 5.5 and Sonnet 5.5 in Vertex AI Model Garden if the Anthropic squad provider is wanted.
- Add values for the Salesforce and Neo4j secrets; add `https://<host>/agent/salesforce/callback` to the Salesforce External Client App.
- Optionally point a real domain at `136.110.207.171` and redeploy with `GCP_DOMAIN`.

## External mutations

- 2026-11-25, `scripts/gcp/bootstrap.sh` against `burner-andbauer-7311`, run by the agent at Andrew's request: enabled the APIs listed in the script; created Firestore `(default)` (native, `us-central1`), bucket `gs://burner-andbauer-7311-campaign-assets`, Artifact Registry `northstar`, service accounts `northstar-workbench-run`, `-scheduler` and `-build` with their role bindings, and 11 empty secrets. Read back with `gcloud ... list`. Also enabled the Org Policy and Cloud Resource Manager APIs.
- ADC quota project set to `burner-andbauer-7311` on Andrew's machine.
- Secret versions for `ARCH_TOKEN_SECRET` and `TOKEN_ENCRYPTION_KEY`, generated randomly and never printed.
- `scripts/gcp/deploy.sh`: Cloud Build image; Cloud Run service `northstar-workbench` (ingress internal-and-cloud-load-balancing, one instance); global address `northstar-workbench-ip` (136.110.207.171), serverless NEG, backend service with IAP, URL map, managed certificate for `136.110.207.171.nip.io`, SSL policy `northstar-workbench-tls`, HTTPS proxy and forwarding rule; IAP access and a Firestore member row for Andrew's Google account; the IAP service agent with the invoker role; Firestore TTL policies; Cloud Scheduler job `northstar-workbench-maintenance`. The load balancer's forwarding rule is billed hourly.

## Rollback

Revert the merge into `gcp`; Cloudflare is untouched (the seam keeps its behaviour, as the worker tests show). To remove the Google Cloud deployment, delete the forwarding rule, proxy, certificate, URL map, backend service, NEG and address (`northstar-workbench-*`), the Cloud Run service and the scheduler job, or delete the burner project.
