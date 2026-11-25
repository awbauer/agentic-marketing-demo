# Getting started for agents

Use this checklist when taking over the repository. It is intentionally procedural: establish the real state first, then continue the active work unit without reopening settled decisions.

## 1. Establish authority and scope

Read, in order:

1. [`AGENTS.md`](../AGENTS.md).
2. The implementation status and chosen defaults in Sections 15–17 of [`agentic-marketing-workbench-plan.md`](agentic-marketing-workbench-plan.md).
3. The active or blocked work unit in [`work-units/`](work-units/). [`WU-005`](work-units/WU-005-phase-3-readiness-hxl.md) delivered the first readiness HXL bundle, and WU-006 delivered the in-app quickstart and Salesforce record links. Phase 3 still needs two standard-agent HXL results and compatible-host evidence. WU-003 remains blocked only on representative consent data that agents cannot manufacture inside the allowed write boundary.
4. The contracts and tests in the paths named by that work unit.

Do not substitute chat history, a pull-request description, or an old report for these sources. Treat unchecked acceptance criteria and stated limitations as unfinished work.

## 2. Inspect the current checkout and delivery state

Run read-only checks before editing:

```sh
git status --short --branch
git remote -v
git log --oneline --decorate -8
gh pr status
```

Preserve unrelated changes. Feature work belongs on a dedicated branch and pull request. Andrew Bauer performs the merge; agents prepare the PR, resolve failures, and read back the merged state.

If an active PR exists, verify its live head, base, complete diff, review state, and checks. The work unit and PR must agree; update both whenever progress or a limitation changes.

## 3. Prepare and verify the local environment

The baseline is Node 26 and pnpm 11:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm verify:fast
```

Create `.config/blocked-words.local` with one sensitive or forbidden literal value per line if the checkout does not already have it. The file is intentionally ignored and must never be committed. `pnpm install` configures the tracked pre-push hook for the checkout. Run `pnpm security:blocked-words` immediately before PR creation and every push; a missing or empty list fails closed.

Use `pnpm verify` before committing a coherent work unit. Miniflare-based Worker tests need permission to bind a loopback port; if a sandbox reports `listen EPERM`, rerun the same command with the required execution permission instead of weakening or skipping the test.

Stable commands and their scope are listed in the root [`README.md`](../README.md) and [`agent-delivery-contract.md`](agent-delivery-contract.md).

## 4. Reconstruct external state from authoritative read-back

External state can drift independently of Git. Before changing Salesforce, Google Cloud or Cloudflare:

- Read the current evidence in `artifacts/reports/<work-unit-id>/`, but verify any state needed for the next action live.
- Pass `--target-org northstar-pot` to every Salesforce command. Read the approved proof-org ID from the protected `SF_APPROVED_PROOF_ORG_ID` execution environment; the user's explicit proof classification for this org overrides `Organization.IsSandbox` only for that exact ID.
- Treat every Salesforce artifact that predates this proof as read-only. Never use or modify Fizi, Agent Two, `ABCampaigns`, `abmcpaug31`, `Cloudflare_MCP`, or another existing artifact without explicit permission.
- On Google Cloud, change only the `northstar-workbench-*` resources in the proof project (WU-077), and only through `scripts/gcp/`. The organization's policies (load-balancer-only ingress, required invoker IAM, organization-only members, an explicit SSL policy, regional locations) are external constraints: work within them, never ask to relax them.
- Change only the net-new Northstar resources identified in WU-003. The shared Cloudflare Access policy `AWB` may be attached by its verified ID but must not be renamed, edited, or deleted.
- Use command-line interfaces only unless the user explicitly authorizes computer or browser control. A human completes login, MFA, and OAuth consent prompts.
- Keep tokens and generated credentials out of Git, logs, reports, screenshots, and prompts. Missing ephemeral credentials are a human authorization boundary, not a reason to bypass per-user OAuth.

For the direct Hosted MCP gate, use the checked-in harness:

```sh
pnpm sf:mcp:oauth prepare
# Human completes the printed PKCE authorization URL.
# Pipe the returned callback URL to: pnpm sf:mcp:oauth exchange
pnpm sf:mcp:oauth refresh
SF_MCP_CAMPAIGN_ID=<sample-campaign-id> pnpm sf:mcp:oauth prove
```

The harness stores token material only in a mode-0600 temporary file. Never commit that file or print its contents.

## 5. Select and deliver the next complete vertical change

Choose the first unchecked acceptance criterion that is not waiting on a human boundary. Before editing, identify:

- the source contract;
- the implementation and failure states;
- the narrow tests and full gate;
- the live read-back that will prove external behavior;
- the evidence and documentation that must change with it;
- the exact rollback target.

Make the smallest complete vertical change, not a placeholder. Do not lower a threshold, relax a permission, widen a tool surface, or convert a live gate to a fixture merely to pass.

## 6. Finish the agent loop

Before reporting completion or pausing at a human boundary:

1. Run narrow checks and then `pnpm verify`.
2. Inspect `git diff --check`, the complete diff, and `git status`.
3. Scan for secrets, unsupported claims, stale identifiers, and unintended external changes.
4. Update the plan, active work unit, generated reports, and rollback notes with demonstrated results only.
5. Run `pnpm security:blocked-words`; stop on missing configuration or any match.
6. Commit one coherent change, run the blocked-word gate again, push the feature branch, rerun the gate immediately before opening or updating its PR, and never bypass the pre-push hook.
7. Read back the PR head/body/checks and any deployed Salesforce, Google Cloud or Cloudflare state.
8. State the one precise human action required, if any. Do not hand routine agent work back to the user.

The completion report format in `AGENTS.md` is mandatory. A green local test run alone does not complete a work unit.
