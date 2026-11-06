# Salesforce deployment pipeline

The `Salesforce metadata` GitHub Actions workflow validates the governed Salesforce core on pull requests and deploys it after those changes merge to `main`. The automated core contains Apex classes, objects and fields, the evaluator permission set, and the Hosted MCP definition. The proof org skips `RunSpecifiedTests` during deployments (the log says "Running Tests - Skipped"), so after each deployment to `main` the workflow runs `NorthstarCampaignActionsTest` and `NorthstarMarketingAgentTest` explicitly and fails unless they ran and all passed. It then retrieves the governed Hosted MCP definition as deployment read-back. Pull requests validate the metadata but can't run the new Apex tests against undeployed code in this org; run them from a branch with `sf apex run test` after deploying the classes, as WU-040 did.

Configure the GitHub `proof` environment with these Actions secrets:

- `SF_SFDX_AUTH_URL`: an SFDX authorization URL for a dedicated integration user in the approved proof org. Generate it from an authorized local CLI session and rotate or revoke it through Salesforce connected-app OAuth usage when necessary.
- `SF_APPROVED_PROOF_ORG_ID`: the exact organization ID that the authenticated connection must report. Keeping the expected target in the protected environment prevents repository changes from silently authorizing another org.
- `BLOCKED_WORDS_LOCAL`: the newline-delimited local blocked-word list. Keep it only in the environment secret; never add its values to source control or workflow logs.

The workflow refuses to continue unless Salesforce reports the exact proof-org ID stored in the protected environment. Pull requests run a check-only deployment. Pushes to `main` and manual runs perform the deployment. The concurrency group serializes proof-org deployments rather than canceling an in-progress Salesforce operation.

HXL `UiWidgetBundle` and `LightningTypeBundle` metadata is intentionally excluded from this source-format job. The pinned Salesforce CLI cannot infer `UiWidgetBundle`; those components retain the explicit Metadata API package workflow documented in WU-005. Agent publication and activation also remain explicit Agentforce DX operations rather than implicit side effects of the core metadata job.

The SFDX URL is passed to `sf org login sfdx-url --sfdx-url-stdin`, so credential material is not written to a repository file. GitHub environment protection can require approval before either validation or deployment receives the secrets.

## The Lightning surface

`salesforce/workbench-surface` is a separate package directory holding the Lightning Web Components, the Apex relay, and their app, tab, Remote Site, and permission set. The `Salesforce metadata` workflow doesn't deploy it. Deploy it explicitly to the org that hosts the surface, then run its tests, because a production-classified org may report the deploy's test run as skipped:

```sh
sf project deploy start --source-dir salesforce/workbench-surface -o <alias> --test-level RunSpecifiedTests --tests NorthstarWorkbenchControllerTest --wait 15
sf apex run test -o <alias> --class-names NorthstarWorkbenchControllerTest --code-coverage --wait 10
sf org assign permset -n Northstar_Workbench_User -o <alias>
```

Add the org's Lightning origin to `SURFACE_ALLOWED_ORIGINS` in `wrangler.jsonc` and deploy the Worker, or Login is refused. See ADR-012.

## Retiring metadata

The core job only adds and updates metadata; removing a component from source doesn't delete it from the org. To retire a component:

1. Remove it from source and from `NorthstarMarketingWorkbench` (the Hosted MCP definition), and merge so the new definition is live. The org won't delete an Apex class that a deployed MCP tool still references.
2. Add it to `salesforce/manifest/retired/destructiveChangesPost.xml`.
3. Delete it from the proof org with a Metadata API deploy of that folder. The pinned CLI can't resolve source-format manifests in this project because of the HXL widget, so copy `package.xml`, `destructiveChangesPost.xml`, and the permission set (as `permissionsets/<name>.permissionset`) into a temporary folder, then run `sf project deploy start --metadata-dir <folder> --target-org northstar-pot`.
4. Read it back with `SF_TARGET_ORG=northstar-pot pnpm sf:retired:check`.

The workflow runs `pnpm sf:retired:check` on every pull request and push, so a retired component that reappears in the org fails CI. WU-040 retired the custom brief and message saves, `NorthstarRecordWrites`, `Northstar_Brief__c`, `Northstar_Message__c`, and the two Campaign fields they used (ADR-008).
