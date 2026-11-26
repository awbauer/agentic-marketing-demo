# Cloudflare proof environment

This directory records the Phase 1 deployment gate. `wrangler.jsonc` is the executable configuration; there is intentionally no second infrastructure source of truth.

## Pre-deployment gate

1. Run `pnpm verify` from a clean checkout.
2. Confirm `wrangler whoami` names the isolated proof account. A login or MFA prompt is the human authorization boundary.
3. Configure one Access application for the Worker URL, email one-time PIN, and an explicit evaluator allowlist. A pre-existing reusable policy may be attached when its rule is verified; treat that shared policy as external infrastructure and do not rename, edit, or delete it from this repository. Record application identifiers outside Git when they are account-specific.
4. The committed deployment configuration is fail-closed with `ENVIRONMENT=proof` and `AUTH_MODE=access`. Set the Access team domain and audience as account-specific variables before the authenticated live test. The Worker must reject an unsigned `/api/session` request; never deploy the local E2E configuration.
5. Run `pnpm deploy:dry-run`, then deploy with `pnpm run deploy` (not `pnpm deploy`, which is pnpm's own command). It applies any pending D1 migrations, then deploys the Worker. The checked-in configuration binds the existing D1 database and R2 bucket by immutable ID/name; never remove those fields or allow CI to auto-provision replacements. Record the resulting Worker version ID.
6. Read back `/api/health`, `/api/ready`, an authorized session, an unauthorized session, and the three binding dashboards. Confirm logs/traces contain correlation IDs without PII.
7. Run `PROOF_BASE_URL=https://<worker-host> pnpm test:e2e:live` to prove the
   unsigned edge boundary. After a human completes the email one-time-PIN flow,
   rerun with that browser-issued token in the ephemeral `CF_ACCESS_JWT`
   environment variable to prove authenticated readiness. Never create a service
   token for this proof, and never write the JWT to a file or report.

## Phase 2 Salesforce MCP portal gate

The Phase 2 portal is a browser-user integration, not a service-token integration. Keep the existing `AWB` Worker Access policy unchanged and configure a separate MCP portal application for the same evaluator allowlist.

1. Prove the custom Salesforce Hosted MCP server directly with `salesforce/postman/Northstar-Marketing-Workbench.postman_collection.json`. Use OAuth authorization code with PKCE and the External Client App scopes `mcp_api refresh_token`. Record only sanitized responses.
2. In Zero Trust > Access controls > MCP Portals, add the Salesforce Hosted MCP URL as a Streamable HTTP server with manual OAuth credentials. Register the exact callback URI shown by Cloudflare in the Salesforce External Client App. The current shared callback option is `https://oauth-callbacks.cloudflareaccess.com/cdn-cgi/access/outbound-oauth-callback`.
3. Create one portal, add only the Salesforce server, keep **Require user auth** enabled (`on_behalf=true`), and keep Code Mode and Gateway routing/DLP off for this proof. Apply the evaluator allow policy to both portal and server Access applications.
4. Curate the portal tool list to exactly `packages/contracts/src/tool-catalog.json`. Do not expose portal-native server toggles to the orchestrator's model context; the Worker filters again and never exposes write tools to autonomous execution.
5. Set the Worker's `SALESFORCE_MCP_URL` secret to the portal `/mcp` endpoint and apply every pending D1 migration before the Worker (`pnpm run db:migrate`; every deploy also does it first). The confirmation audit schema must accept every action in `PROOF_DEFAULTS.allowedWrites`; `pnpm contracts:check` enforces that invariant. The endpoint is treated as deployment configuration to prevent an unreviewed URL from entering source.
6. As the evaluator, connect from the workbench, complete portal OAuth and per-user Salesforce OAuth, then read back connection state, namespaced tools, readiness output, a confirmed draft save, and a confirmed review task. Both writes must show the same idempotency key in D1 audit and Salesforce authoritative read-back.

After any `McpServerDefinition` change, the deployed XML is only the first read-back. Refresh the active custom server in Salesforce, use **Sync capabilities** for `northstar-marketing-salesforce`, preserve the portal's fail-closed allowlist, explicitly enable each new approved tool, and run `pnpm test:production:chat` with an ephemeral evaluator Access JWT. That command now fails unless all tools in `PHASE_2_CURATED_TOOLS` are visible and the real read-only `check_write_access` action returns a valid Salesforce permission report.

Service tokens are intentionally excluded: Cloudflare documents that per-user upstream OAuth requires `on_behalf=true`, while service-token sessions require it to be false and use the admin credential. That would violate the proof's identity model.

## Workers Builds configuration

Connect the existing `northstar-marketing-workbench-pot` Worker to this repository under **Settings > Builds**. Use:

- Production branch: `main`
- Root directory: `/`
- Build command: `pnpm run build`
- Deploy command: `pnpm run deploy:worker`. It applies pending D1 migrations to `APP_DB` (`wrangler d1 migrations apply --remote`), then runs `wrangler deploy`. A failed migration stops the deploy, so the Worker never runs code that expects a table the database lacks.
- API token: the build token must include **Account › D1 › Edit** for the migration step. The token Workers Builds creates by default has no D1 permission; add it under My Profile › API Tokens before switching the deploy command.
- Build cache: enabled
- Build variable `NODE_VERSION`: `26`
- Build variable `PNPM_VERSION`: `11.22.0`

Keep preview builds disabled until separate preview D1, R2, Access, and Salesforce OAuth resources are configured. A branch preview must never share the production proof database, bucket, secrets, or upstream writes.

The runtime secrets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `CONFIRMATION_SIGNING_KEY` and `GOOGLE_WORKLOAD_IDENTITY` (Vertex AI federation, ADR-021; put on the Worker on 2026-11-25) already belong to the Worker and must remain runtime secrets. Do not copy their values into repository settings, build variables, source control, or build logs. The non-secret runtime values and all resource bindings are owned by `wrangler.jsonc`; do not duplicate them in the dashboard.

## Operator kill switches

Two optional runtime switches pause risky behavior without a code change. They are Worker secrets rather than `wrangler.jsonc` variables because Workers Builds redeploys `vars` from source on every merge, which would reset them. When unset, everything is enabled.

- `WRITES_ENABLED`: set it to `false` to pause every confirmed Salesforce write: the Marketing Cloud agent's brief and campaign saves, review tasks, and image attachments. Preflight and execute return `503 WRITES_DISABLED`, and the UI shows a paused notice and disables the write buttons.
- `DISABLED_TOOLS`: a comma-separated list of curated tool names, for example `attach_campaign_image,summarize_campaign`. Disabled read tools are removed from the model's tool set, and a routed request explains that an operator turned the tool off. Disabled write tools are blocked like paused writes. Unknown names are ignored.
- `MEMORY_ENABLED`: set it to `false` to stop long-term memory (ADR-007). Nothing new is remembered, the recall tools are withheld (a recall question says an operator turned them off), and the Memory tab says memory is off. Stored memory stays until it expires or is forgotten.

```bash
printf 'false' | pnpm exec wrangler secret put WRITES_ENABLED --config wrangler.jsonc
pnpm exec wrangler secret delete WRITES_ENABLED --config wrangler.jsonc
```

`GET /agent/operations` reports the active controls. `GET /agent/audit/export` downloads the caller's confirmed-write audit rows, memory remembers and forgets, and turn summaries from the 24-hour retention window. Older turns and audit rows are pruned on every write and hourly by the cron.

## Marketing Cloud agent writes (ADR-008)

Briefs and campaigns are created by the `Northstar_Campaign_Creation` agent (a Marketing Cloud Next Campaign Creation agent) through its Hosted MCP tools `save_marketing_brief` and `create_marketing_campaign`; `get_marketing_records` reads them back.

- **Deploy order:** merge the pull request, which deploys the MCP definition and Apex through CI, and Workers Builds applies D1 migrations, then deploys the Worker (`pnpm run deploy:worker`). Refresh the Cloudflare MCP portal so it lists the new tools.
- **Agent changes:** edit `salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Campaign_Creation`, validate with `sf agent validate authoring-bundle`, and publish with `sf agent publish authoring-bundle`; it must stay on the `MktCloud__CampaignCreationAgent` template.
- **Retired metadata:** after the new MCP definition is live, delete `NorthstarSaveCampaign`, `NorthstarSaveBrief`, `NorthstarSaveMessage`, `NorthstarSaveCampaignBrief`, `NorthstarRecordWrites`, `NorthstarRecordActionsTest`, `Northstar_Brief__c`, `Northstar_Message__c`, and `Campaign.Northstar_Brand__c` from the proof org.

## Neo4j knowledge graph

The knowledge graph (ADR-006) reads from Neo4j AuraDB through the Query API.

- **Secrets:** set `NEO4J_QUERY_URL` (`https://<instance>.databases.neo4j.io/db/<database>/query/v2`), `NEO4J_USERNAME`, and `NEO4J_PASSWORD` as Worker secrets with `wrangler secret put`. Without them, the tools use the in-memory demo copy and the rail says so.
- **Seed or rebuild:** export the same three variables locally, then run `pnpm kg:seed --confirm --reset`. `--reset` removes every earlier demo dataset version (`northstar-kg*`) first, so a model change (new labels or ids) leaves nothing stale. Long-term memory (`northstar-memory-v1`) is kept. It is idempotent and ends with a count read-back. Run `pnpm kg:parity` afterwards to confirm every graph tool matches the fixture.
- **Check parity:** `pnpm kg:parity` confirms Neo4j matches the in-memory copy for every tool and for long-term memory. For memory it writes to a throwaway `parity-*` workspace and forgets it afterwards. It reports tool latency (p50/p95) and fails if the median reaches 500 ms.
- **Long-term memory (ADR-007):** the Worker writes memory nodes only through fixed statements in `packages/knowledge-graph/src/memory.ts`. To remove all memory, run `MATCH (n {dataset: 'northstar-memory-v1'}) DETACH DELETE n` in the Aura console.
- **Keep-alive and sweep:** the Worker's hourly cron (`17 * * * *` UTC) runs one read query so Aura Free doesn't pause, and deletes memory past its 14-day expiry. A paused instance returns a "may be paused" tool error; resume it in the Aura console.
- **Teardown:** delete the Aura instance in the console, and remove the three secrets with `wrangler secret delete`.

## Vertex AI from the Worker (ADR-021)

The top bar's AI platform menu offers Vertex AI once the Worker holds a federation credential. No Google key is involved: the Worker signs its own short-lived token, and Google's workload identity pool `northstar-workers` (provider `cloudflare-worker`, project `burner-andbauer-7311`) exchanges it for an access token of `northstar-vertex-worker`, which holds `roles/aiplatform.user` only. To hide a platform from the menu, and stop requests from choosing it, remove it from `AI_PLATFORMS_ENABLED` in `wrangler.jsonc` (`workers-ai,vertex`) and deploy.

Put the credential on the Worker straight from Secret Manager, without writing it to disk or a terminal:

```sh
gcloud secrets versions access latest --secret northstar-vertex-worker-identity --project burner-andbauer-7311 \
  | npx wrangler secret put GOOGLE_WORKLOAD_IDENTITY --config wrangler.jsonc
```

`wrangler secret put` publishes a new version of the deployed Worker. Deploy a build containing ADR-021 for the menu to use it.

To revoke access, run `gcloud iam workload-identity-pools providers delete cloudflare-worker --workload-identity-pool northstar-workers --location global --project burner-andbauer-7311` (or disable the pool), then `npx wrangler secret delete GOOGLE_WORKLOAD_IDENTITY`. To rotate the key, generate a new pair, add its public key to the provider (`--jwk-json-path`), store a new credential version, put it on the Worker, then remove the old public key.

## Rollback and teardown

Delete only the IDs recorded by this work unit: the proof Worker, Access application/policy, D1 database, R2 bucket, and Durable Object namespace/migration associated with the proof Worker. Export no data. Read back the resource lists after deletion and attach the results to the work unit. Never use a broad account cleanup command.
