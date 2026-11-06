# Salesforce Phase 2 source

This directory is an API 67.0 Salesforce DX package for the Northstar proof environment. It is not authorized for deployment to business production orgs.

The target org must be passed explicitly through `SF_TARGET_ORG`; no default org is accepted by the validation or deployment scripts. Before any mutation, `pnpm sf:validate` verifies that the target is either reported as a sandbox or matches the exact user-approved proof-org ID supplied through `SF_APPROVED_PROOF_ORG_ID`, and that the required proof capabilities and sample records are visible to the evaluator. The second path exists only because the dedicated `northstar-pot` demo org is production-classified by Salesforce; it does not authorize another non-sandbox org or weaken the exact-target check.

Agentforce authoring bundles live under `force-app/main/default/aiAuthoringBundles`. Deterministic actions and their tests live under `classes` and `flows`. `specs/hosted-mcp-server.json` is the reviewed source catalog for the custom Hosted MCP server; Salesforce currently requires custom server composition and publication through Setup/API Catalog, so the proof captures the exact catalog and read-back instead of inventing unsupported metadata.

## Lightning surface

`workbench-surface/` is a separate package: a Lightning Web Component surface onto the Worker, for an org that hosts the UI and none of the agents. It holds no Northstar data; its Salesforce tools still reach the proof org through the MCP portal. See [the deployment pipeline](../docs/salesforce-deployment-pipeline.md#the-lightning-surface) and ADR-012.

## Gate order

1. `pnpm sf:metadata:check` and offline `sf project convert source --root-dir salesforce/force-app`.
2. `SF_TARGET_ORG=<explicit-alias> SF_APPROVED_PROOF_ORG_ID=<exact-approved-id-if-needed> pnpm sf:validate`.
3. Deploy Apex, fields, and permission set with Apex tests; read back the source and test results.
4. Validate, publish, and activate `Campaign_Readiness_Governance` through Agentforce DX.
5. Instantiate the Campaign Creation, Content Builder, and Account Discovery agents in the new Agent Script Builder, retrieve their `AiAuthoringBundle` sources, validate/publish/activate them, and replace the target-org-specific default agent user in every bundle.
6. Configure the focused custom Hosted MCP server and prove it directly with the checked-in Postman collection.
7. Register the server in the Cloudflare portal with per-user OAuth, compare `tools/list` to the checked-in catalog, then enable the Worker connection.

Steps 3–7 are blocked by design if the target is neither the supplied Northstar sandbox nor the exact user-approved Northstar proof org. A business production org or an unrelated sandbox is not an acceptable substitute.
