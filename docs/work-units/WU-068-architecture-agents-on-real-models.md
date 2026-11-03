---
id: WU-068
title: The architecture agents run on real models, and an orchestrator runs the sample flows
status: active
plan_sections: [10, 11, 17]
owners: [agent]
---

# Why

Andrew asked whether the architecture section was mocked. It was, in the way that mattered: the agents were deterministic functions and the sample flows called them in a fixed order. He asked for the orchestrator to run and call subagents, with only the backend services' data mocked.

# Objective

Every live architecture agent runs on a Workers AI model with its catalog prompt and its granted tools; an orchestrator model plans each sample flow's goal, delegates to the subagents, pauses for a person's decision, and resumes. The rules stay in deterministic services. See ADR-010.

## Scope

- In-scope paths: `apps/edge/src/architecture/{agent-runtime,agent-tools,orchestration,scripted-model,objects,ops,api,context,store}.ts`; `packages/architecture/src/{agents,language,flows,farm,models}.ts`; `apps/web/src/architecture/{SampleFlows,AgentConsole,api,guide}.tsx?`; `migrations/0007_architecture_orchestrations.sql`; `wrangler.local.jsonc`, `vite.config.ts`, `vitest.worker.config.ts`; Learn.
- Out of scope: the chat orchestrator (unchanged); new Salesforce writes; changing ADR-009's champions.

## Acceptance criteria

- [x] Each live architecture agent runs on a model with its catalog prompt and only its granted tools, and every tool call passes the gateway.
- [x] The services enforce cite-or-refuse whatever the model writes, including the agent's own words.
- [x] The orchestrator delegates, pauses for a person on a submitted module, refuses to resume until the module's state shows a decision, and finishes.
- [x] All three sample flows run end to end on Workers AI from local dev (`pnpm dev:local`), including a person's approval from the screen.
- [x] Worker tests run the orchestration and the agents hermetically on the scripted stand-in.
- [x] `pnpm verify:fast` passes.

## Evidence

- Real runs, local dev against Workers AI (gpt-oss-20b; the farm on gpt-oss-120b as the judge champion): Lumera 66 s, Harborstone 58 s, Coastline 39 s, each from goal to the orchestrator's wrap-up with one approval. The superiority claim and wire fees were refused and filed as gaps; the expired fee-waiver email was blocked at readiness.
- Known limitations: runs differ; the 20b orchestrator sometimes picks a less suitable subagent or retries; streamed tool arguments occasionally lose characters and are retried. `pnpm verify` (with the full evaluation) was not run for this change.

## External mutations

none. Migration 0007 must be applied to the deployed D1 database (`wrangler d1 migrations apply`) before the sample flows work there.
