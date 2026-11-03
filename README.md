# Northstar Marketing Workbench

Agent-first proof-of-technology for a marketer using Salesforce CRM, Marketing Cloud Next, Data 360, Agentforce, and Cloudflare. Humans are needed only at credential/consent boundaries and the final evaluator checkpoint; repository gates own ordinary implementation and quality decisions.

## Start

Requirements are Node 26 and pnpm 11.

Agents taking over an existing work unit must begin with the [agent getting-started checklist](docs/getting-started-for-agents.md), then follow `AGENTS.md` and the active work unit. Do not infer live Salesforce or Cloudflare state from this README.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
```

Open `http://127.0.0.1:5173`. Local mode contains fictional sample data and a local-only evaluator. It performs no external mutation.

The architecture agents and sample flows run on real models. `pnpm dev:local` keeps D1 and R2 local and runs them on Workers AI (it needs `wrangler login`); without a model they say none is available rather than fall back to a script.

## Stable commands

- `pnpm verify:fast`: formatting, lint, types, unit contracts, documentation, and invariants.
- `pnpm verify`: generated Worker types, all fast gates, Workers-runtime tests, 20-case evaluation, and production build.
- `pnpm deploy:dry-run`: rebuilds and packages the exact production Worker without changing Cloudflare.
- `pnpm deploy`: rebuilds and deploys the configured Worker; intended for the reviewed `main` branch or an explicit operator deployment.
- `pnpm test:e2e`: Chrome and Edge-equivalent UI/reconnect proof with screenshots.
- `pnpm sf:metadata:check`: validates the local Phase 2 Agent Script, Apex/action, permission, catalog, Postman, and audit-migration contract.
- `SF_TARGET_ORG=<northstar-sandbox-alias> SF_APPROVED_PROOF_ORG_ID=<approved-org-id> pnpm sf:validate`: fails closed unless the explicit target is a Salesforce sandbox or exactly matches the separately approved proof-org ID, then checks API level, representative CRM/marketing records, consent access, and Agent Script metadata availability.
- `pnpm test:e2e:live`: fails closed unless authorized live-proof variables are present.

The **Architecture** view demonstrates the layered model from the architecture slides (governed objects, an agentic gateway, an agent registry, the plan-to-learn lifecycle, catalogs, drift watch, trust and channels). The plan and the AWS mapping are in [docs/architecture-roadmap.md](docs/architecture-roadmap.md); what is demonstrated and what is deferred is in [WU-052](docs/work-units/WU-052-architecture-roadmap.md).

The active execution record is [WU-003](docs/work-units/WU-003-phase-2-salesforce-core.md). Local mode now demonstrates the server-side confirmation envelope, idempotency binding, D1 audit, and fixture read-back for draft-save and review-task writes. It does not claim a Salesforce deployment; only the explicit sandbox, direct MCP, portal, OAuth, and authoritative read-back gates can establish that.
