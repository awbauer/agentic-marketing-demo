# Phase 2 evaluator guide

Use this guide to test the deployed Salesforce core with the fictional Northstar sample data. Do not enter production data or customer PII.

## Connect and recover

1. Open the demo URL and sign in. On Google Cloud that is Identity-Aware Proxy with your Google account (it must be listed as a workspace member; see `infra/gcp/README.md`); on Cloudflare it is the Cloudflare Access email one-time-PIN prompt.
2. In **Salesforce agents**, select **Connect**. Complete the Salesforce authorization prompts as the evaluator user (on Cloudflare, the Access MCP portal's prompt comes first).
3. Return to the workbench. The connector must show **ready** and report the curated tool count. If authorization is still open, use **Resume authorization** or **Check status**.
4. Select **Disconnect**, confirm the connector returns to **disconnected**, then connect again. An expired grant must show **expired** with **Reconnect**; a permission failure must explain that evaluator permissions need correction.

## Read and draft test

1. Open **Quickstart** and choose a supported sample prompt, or ask: `Review the Northstar sample campaign and list its readiness blockers.`
2. Confirm the answer cites Salesforce-backed evidence and that no write confirmation appears.
3. Open a campaign from an insight card and verify Salesforce opens the sample record in a new tab.
4. Ask for a draft campaign brief. Confirm the result is marked as a draft and that no publish, send, activate, delete, suppress, buyer-group mutation, or arbitrary CRUD action is offered.

## Confirmed review-request test

1. Select **Create review request** on the readiness tile.
2. Review the campaign ID, summary, and five-minute expiry. Select **Cancel** once and verify that no task is created.
3. Start the request again and select **Confirm create** once.
4. Verify the success state shows the Task subject, priority, and due date, then use **Open task in Salesforce** to inspect the record.
5. Verify the Salesforce Task contains the campaign name, status, type, schedule, draft brief, explicit readiness findings, and the three-step human review checklist. An incomplete campaign must produce a high-priority Task that names the missing brief or dates; internal confirmation hashes must not appear in the Task description.
6. Verify the activity feed reports **Review request created** with a Salesforce read-back record ID.
7. Record the same idempotency key and source record ID from the confirmation audit (Firestore on Google Cloud, D1 on Cloudflare) and Salesforce Task read-back. Retrying execution must not create a second Task.

## Current demo boundary

The in-app quickstart separates workflows available now from coming-soon work. Publishing, sending, activation, deletion, suppression, and arbitrary Salesforce edits are intentionally unavailable and must not be presented as planned demo actions.

## Expected blockers

- A Google, Cloudflare or Salesforce login, MFA, or consent prompt requires the evaluator.
- The supplied proof org currently has no representative consent records. The smoke gate must continue to fail that assumption; do not manufacture consent data.
- If the connector cannot recover after authorization, capture the visible state and correlation ID without recording tokens, email addresses, or blocked local values.
