# Google Cloud target

The workbench's second deployment target (ADR-018, WU-077). The `gcloud` scripts in `scripts/gcp/` are the only infrastructure source of truth; there is no Terraform.

| Cloudflare | Google Cloud |
| --- | --- |
| Worker + static assets | Cloud Run service `northstar-workbench` (Node 26 container) |
| Durable Object `MarketingOrchestrator` | The same class in a Node agent host on Cloud Run; each chat's SQLite saved to `gs://<bucket>/sessions/` |
| D1 `APP_DB` | Firestore (default) database, native mode |
| R2 `CAMPAIGN_ASSETS` | Cloud Storage bucket `<project>-campaign-assets` |
| Workers AI + AI Gateway | Vertex AI: gpt-oss-120b (managed), Gemini 3.1 Flash Image, Claude on Vertex; Cloud Logging for each model call |
| Access | Identity-Aware Proxy on Cloud Run, members allowlist in Firestore |
| Access MCP portal | Direct Salesforce Hosted MCP with per-user OAuth (PKCE) |
| Cron `17 * * * *` | Cloud Scheduler → `/internal/scheduled` with OIDC |
| Workers Builds | Cloud Build via `scripts/gcp/deploy.sh` |

Defaults: project from `GCP_PROJECT` (required, `burner-andbauer-7311` for the proof), region `us-central1`.

## First-time setup

1. Install the Google Cloud CLI, then `gcloud auth login` and `gcloud auth application-default login`. A login prompt is the human authorization boundary.
2. `GCP_PROJECT=burner-andbauer-7311 scripts/gcp/bootstrap.sh`. It is idempotent and creates billable resources.
3. gpt-oss-120b and Gemini's image model need nothing more. For the squad's Anthropic provider, enable Claude Opus 5.5 and Sonnet 5.5 in Vertex AI Model Garden (accepting Anthropic's terms).
4. Add a version to each secret the script created, for example `printf %s "$VALUE" | gcloud secrets versions add NEO4J_PASSWORD --data-file=-`. Never commit values.
5. IAP uses a Google-managed OAuth client, which signs in accounts of the project's own organization. `deploy.sh` grants each `IAP_MEMBERS` address access and adds it to the Firestore `members` collection.
6. For Salesforce, set the `SALESFORCE_MCP_URL`, `SALESFORCE_CLIENT_ID` (and secret, if the External Client App has one) and `TOKEN_ENCRYPTION_KEY` secrets, and add `https://<cloud-run-host>/agent/salesforce/callback` to the External Client App's callback URLs.

## Deploying

```sh
GCP_PROJECT=burner-andbauer-7311 IAP_MEMBERS=you@example.com pnpm deploy:gcp
```

The script builds the image with Cloud Build, deploys the Cloud Run service behind a global HTTPS load balancer with IAP (the organization's policies forbid public Cloud Run ingress and `allUsers`; `GCP_INGRESS=direct` puts IAP on Cloud Run itself where they don't), issues a managed certificate for `<address>.nip.io` or `GCP_DOMAIN`, mounts each secret that has a value, sets Firestore TTL policies, grants IAP access to each member and adds them to the Firestore `members` collection as evaluators, and creates the hourly Cloud Scheduler job. It prints the service URL. Re-run it to deploy a new revision.

The service runs one instance with session affinity: each chat lives in that instance's memory and is saved to `gs://<bucket>/sessions/` after every change, so a restart reloads it. Set `MIN_INSTANCES=1` before a demo to keep the chat warm.
