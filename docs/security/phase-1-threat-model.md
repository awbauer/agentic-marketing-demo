# Phase 1 threat and data-classification record

## Boundary

Phase 1 uses fictional Northstar sample data and proves the application shell, identity boundary, durable conversation, and typed tiles. It performs no Salesforce call and exposes no mutation tool. Cloudflare Access is the proof identity perimeter; the Worker remains the authorization boundary.

## Data classes

| Data | Class | Storage | Model policy |
| --- | --- | --- | --- |
| Evaluator subject and email | Internal identity | Durable session metadata, 14 days | Excluded from prompts |
| Fictional campaign summaries | Sample/non-production | Durable Object conversation, 14 days | Allowed |
| Tile source references | Sample/non-production | Durable Object state | Allowed |
| Customer/contact/audience details | Prohibited | Never stored | Blocked |
| Credentials and Access JWTs | Secret | Never logged or persisted | Blocked |

## Threat controls

- The browser cannot select a Durable Object name. The Worker hashes the authenticated subject, tenant, and fixed workspace ID.
- Proof mode fails closed when the Access assertion, issuer, audience, or role is invalid. The local principal exists only when both `AUTH_MODE=development` and `ENVIRONMENT=local`.
- The Phase 1 tool surface is empty. Publish, send, activate, delete, suppress, buyer-group mutation, and arbitrary CRUD are absent.
- Structured errors contain a correlation ID but never echo tokens, claims, prompts, or stack traces.
- Static assets are separated from `/api/*` and `/agent*`; all agent and session paths pass Worker authorization first.
- Durable chat persistence and resumable streams are provided by `AIChatAgent`; explicit Stop cancels the server turn while ordinary client disconnects remain resumable.
- Logs and traces are enabled. The proof retains no copied customer dataset and has no image objects yet.

## Residual Phase 1 limits

The live Access policy, account resource isolation, telemetry read-back, and teardown cannot be proven locally. They are pre-deployment checks, never planning tasks. The Phase 2 Salesforce smoke gate validates the assumed sandbox capabilities and sample records before Salesforce integration begins.

## Google Cloud host (ADR-018)

The same boundaries hold when the workbench runs on Google Cloud; what enforces each one changes.

- **Who gets in.** A global HTTPS load balancer with Identity-Aware Proxy admits only principals granted access, and organization policy limits those to the organization's own domain. The server verifies IAP's signed assertion on every request (issuer, audience, ES256 keys) and admits only emails listed in the Firestore `members` collection, so a request that bypassed the proxy, or a valid identity that isn't a member, is refused.
- **What can reach the service.** Cloud Run ingress admits only the load balancer and Google-internal callers, and the invoker check stays on: IAP calls the service as its service agent, and Cloud Scheduler with an OIDC token for its own account, which the service verifies again before running maintenance.
- **Secrets.** Secret Manager values are mounted as environment variables; nothing is in the image. Per-user Salesforce tokens are sealed with AES-GCM (`TOKEN_ENCRYPTION_KEY`) inside each chat's snapshot, and the server refuses to store them without the key outside local development.
- **Isolation and retention.** Each chat's storage is its own Cloud Storage object, keyed by the same hashed agent key, written only if no other instance wrote it since. Firestore rows carry an `expireAt` for TTL deletion behind the hourly 24-hour prune.
- **Models.** Vertex AI calls authenticate as the service account; no vendor key exists. OpenAI stays off on Google Cloud until approved.
