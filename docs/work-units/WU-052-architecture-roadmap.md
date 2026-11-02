---
id: WU-052
title: Architecture roadmap — governed objects, gateway, registry, lifecycle agents, catalogs, trust and channels (issues #92–#106)
status: active
plan_sections: [4, 10, 11, 12]
owners: [agent]
---

# Why

Andrew Bauer shared five architecture slides (layer rings, logical architecture, agent domains 1/2 and 2/2, security and compliance) and asked that the workbench start to bring them to life on Cloudflare. [docs/architecture-roadmap.md](../architecture-roadmap.md) maps the slides to the workbench and to AWS. Tracking issue [#91](https://github.com/awbauer/agentic-marketing-demo/issues/91) split the work into fifteen units (WU-052 to WU-066, issues #92–#106). Andrew asked for all of them in one pull request, so this one work unit records them together.

# Objective

One **Architecture** view in the workbench that demonstrates, with fictional Harborstone Wealth and Coastline Kitchen data, a governed object model, an agentic gateway, an agent registry, the plan-to-learn lifecycle with an approval state machine, prompt and model catalogs, thirteen evaluators with drift watch, a Trust view, and one approval card rendered into four channels.

## Scope

- In-scope paths: `packages/architecture/`, `apps/edge/src/architecture/`, `apps/web/src/architecture/`, `migrations/0006_architecture_roadmap.sql`, `scripts/check-prompts.mjs`, the Learn sections it adds, and the hooks in `apps/edge/src/index.ts`, `apps/edge/src/orchestrator.ts` and `packages/contracts/src/index.ts`.
- Explicitly out of scope: new Salesforce writes, publishing to a real Teams, Outlook or Copilot tenant, a Vectorize index, Cedar engine, KV namespace or AI Gateway dynamic routes (each needs Cloudflare account access), calling models for the new agents, Neo4j graph nodes for the new object kinds.
- Prerequisites: migration `0006` applied to the proof D1 database before deploy.

## Contracts affected

- Schemas: `GovernedObjectSchema`, the registry manifest, gateway request and decision, prompt catalog entry. `OperationControlsSchema` gains an optional `disabledAgents`.
- Tools/actions: no new orchestrator tools and no new write actions. The orchestrator's tool calls are now authorized as `tool:<name>`. New REST under `/api/arch/` and an MCP endpoint at `/mcp/workbench` (read, search and `propose_transition` only).
- Tiles/HXL: the approval card is emitted as React, Adaptive Card 1.5 JSON, Lightning Web Component data and an MCP Apps resource. No Salesforce metadata changed.
- External state: none. New D1 tables `arch_objects`, `arch_state`, `arch_history` (append-only trigger), `arch_gateway_log`, `arch_eval_samples`, `arch_agent_state`, each scoped to the signed-in evaluator and pruned with the 24-hour audit.

## What each issue became

| Issue | Unit | Demonstrated | Deferred or different from the issue |
| --- | --- | --- | --- |
| #92 | WU-052 Governed objects | Schema, urn identity, derived lineage, version chain, object inspector, `INHERITS`, `CITES`, `SUBSTANTIATED_BY`, `MEASURED_BY`, `VARIANT_OF`, `GAP_FOR` | Objects live in code and D1, **not** in Neo4j, so Learn's graph node and relationship counts are unchanged. No `get_object` orchestrator tool; the inspector, REST and MCP read it. |
| #93 | WU-053 Gateway | Default-deny policies compiled from the registry, forbid beats permit, per-invocation signed tokens with an `act` claim, identity chain, decision log, the orchestrator's tools authorized as `tool:<name>`, `/mcp/workbench` | Cedar is **not** run: the evaluator is a typed equivalent and policies render as Cedar text (no `cedar-wasm` spike). Confirmed Salesforce writes keep their own audit and are not in the gateway log. |
| #94 | WU-054 Registry | 22 agents across three domains, lifecycle stages, autonomy, human gate, `DISABLED_AGENTS`, constrain, A2A-style Agent Cards for the three Salesforce partner agents, swimlane view | The registry is a source manifest, not seeded into D1. Agent Cards are served at `/api/arch/a2a/<id>/agent-card`, and are not a live A2A endpoint. Three agents are drawn as planned. |
| #95 | WU-055 Workspaces | Manifest and one renderer; Command Center, Brief Builder, Module Library, Approvals and Performance; Act as persona; brand scope | The renderer lives in `apps/web`, not `packages/ui`. |
| #96 | WU-056 Plan and scenario | Plan, scenario and brief agents; a brief inherits by reference | Deterministic functions, not model calls. Plan approval uses the state machine from WU-059 directly. |
| #97 | WU-057 Module library | Reuse ranking, cite-or-refuse authoring with gap records, atomization, semantic search | Search uses a local hashing embedder behind an `Embedder` interface. **Vectorize is not wired.** |
| #98 | WU-058 Claims | Claims, evidence, expiry, supersession, `needs refresh` propagation, readiness that blocks approval | — |
| #99 | WU-059 State machine | Eleven transitions, persona roles, reasons, optimistic concurrency, append-only history, readiness guard on approve, Approvals workspace, system expiry | State is a D1 row, **not a Durable Object per object**. |
| #100 | WU-060 Attribution and optimization | Attribution paths, re-issue, refresh and retire proposals, accept revises the plan as a new version citing the result | — |
| #101 | WU-061 Prompt catalog | 12 prompts, hard rules, urn-bound variables, `pnpm prompts:check` with a lock file | The orchestrator's own prompt is **not moved** into the catalog. **KV publish and AI Gateway caching are not done.** The CI gate checks structure and version bumps, not an evaluation delta. |
| #102 | WU-062 Models | Catalog, task classes, router, shadow sampling and cost cap, `canPromote`, ADR-009 | Shadow runs are **not executed**. The orchestrator stays on `gpt-oss-20b`. AI Gateway dynamic routes are not configured. |
| #103 | WU-063 Evaluators | Thirteen evaluators, per-agent baselines, drift detection that constrains an agent, evidence for staged autonomy | The judge evaluator is not scored for sampled turns. Baselines are what a healthy deterministic agent scores, not a recorded run. |
| #104 | WU-064 Platform agents | Adversarial farm (four probes) and data readiness | The farm runs inline, not on a queue. Consent coverage is fictional fixture data. |
| #105 | WU-065 Trust | Six-row risk matrix reading live evidence, identity chains for recent calls, retention config | "Decision coverage" counts decisions with a gateway allow. It does not measure calls outside the architecture API. |
| #106 | WU-066 Channels | One composition, four renderings, brand rules applied once, MCP endpoint, preview toggle | The Lightning Web Component is **data only**; no component is added to `salesforce/`. Nothing is sent to Teams, Outlook or Copilot. |

## Acceptance criteria

- [x] Every architecture call goes through `invoke`, which evaluates default-deny policy, logs the decision, and mints and verifies a per-call token.
- [x] An agent cannot approve, supersede or accept: the forbid wins even if the registry wrongly granted it.
- [x] The state machine accepts exactly eleven transitions and refuses every other pair; every move is attributed and appended.
- [x] A module cannot be approved while readiness or the farm blocks it.
- [x] A drifting agent is constrained and loses its non-read grants.
- [x] No Salesforce write type, Section 17 default, or retention period changed.
- [x] Failure states: denied, blocked, stale, not found, permission denied, loading and empty states render in the view.
- [ ] `pnpm verify` passes. See Evidence.
- [ ] Applied to the proof D1 database and deployed. Not done; needs Andrew.

## Verification

```text
pnpm verify:fast
pnpm verify
pnpm prompts:check
pnpm exec vitest run --config vitest.worker.config.ts apps/edge/src/architecture.worker.test.ts
pnpm exec vitest run --config vitest.config.ts packages/architecture
```

## External mutations

none from this change. Before the first deploy, migration `0006` must be applied to the proof D1 database (`wrangler d1 migrations apply`). It only creates tables. Rollback: drop the six `arch_*` tables and the trigger; nothing else reads them except the architecture API and the orchestrator's tool gate, which tolerates their absence (it logs and continues).

## Evidence

- Reports: `artifacts/reports/` from `pnpm verify`.
- Screenshots: checked in the in-app browser against the local dev server (Command Center, Agents swimlane, Trust). No Playwright screenshots were added.
- Deployment identifiers: none.
- Read-back results: local D1 migration `0006` applied with `wrangler d1 migrations apply --local`, and an API call through the running Worker returned an allowed decision and the verified chain.
- Known limitations: see the table above. The agents are deterministic, so none of the evaluators measures model behavior. Seed data is fictional and fixed to a calendar around November 2026.

## Completion

- Final status: awaiting Andrew's review.
- Commit: see the pull request.
- Summary: all fifteen units are implemented to the level in the table; the deferred items each need Cloudflare account access or a decision.
