---
id: WU-074
title: A campaign squad of agents runs a brief to a proposal, on three providers through one AI Gateway
status: in review
plan_sections: [10, 11, 17]
owners: [agent]
---

# Why

Andrew asked for a page that shows a lead agent coordinating specialist agents and agent-to-agent communication, working agent by agent, with every agent actually built. He then asked to show where a semantic layer and a proper agent infrastructure support the agents, to run the same agents on Cloudflare, Anthropic or OpenAI with a switch, and to send every vendor request through his Cloudflare AI Gateway, where he stores the vendor keys. See ADR-013.

# Objective

On **Campaign squad**, a person picks a brief and a provider, and a campaign lead and four spokes (audience analyst, art director, copy lead, channel planner) turn it into a proposal, with every message, tool call, gateway decision, semantic-layer query and model call shown as it happens.

## Scope

- In-scope paths: `packages/architecture/src/team*.ts`; `apps/edge/src/team/`; `apps/edge/src/team.worker.test.ts`; `apps/web/src/team/`; `apps/edge/src/architecture/{api,context,orchestration}.ts`; `apps/web/src/App.tsx`; Learn; `scripts/check-learn.mjs`; `package.json` (three pinned dependencies).
- Out of scope: the chat orchestrator and the architecture agents (unchanged); Salesforce writes; storing vendor keys (Andrew stores them on the gateway).

## Acceptance criteria

- [x] Five agents run on models with their own prompts and only their granted tools; every tool call passes the gateway as `team:<tool>`, and a retired lead or a constrained spoke is stopped by it.
- [x] The lead plans, delegates in dependency order, keeps or sends back work, reconciles clashes and sends a proposal; spokes ask each other questions and answer from their own saved work.
- [x] Services refuse findings without real citations, off-palette colors and forbidden imagery, copy over its limits or missing a disclosure, and plans under minimum spend, over budget or outside the window.
- [x] Agents read through a semantic layer whose formulas are the only projection math; the page shows which definitions each agent used.
- [x] The page shows each agent's live activity and a running clock, a hub-and-spoke map, the message feed, the infrastructure layers with counts from the run, and the proposal.
- [x] A switch runs the same squad on Workers AI, Anthropic (official SDK) or OpenAI (Responses API); Anthropic and OpenAI requests go only through the AI Gateway with no vendor key on them.
- [ ] A full run on Anthropic and on OpenAI, once their keys are stored on the gateway.

## Evidence

- Worker tests (`team.worker.test.ts`, `team/*.worker.test.ts`), on the scripted stand-in: the full squad from brief to proposal on each provider, the message pattern, one send-back, a clash resolved, gateway decisions on every call, a retired lead (403) and a constrained spoke (denied save), brand scope, bad briefs and providers. The Anthropic adapter against a fake Messages API (forced tool → `auto` plus a system message, thinking blocks replayed unchanged, effort, fallbacks, caching). The gateway route: the binding URL, key headers removed, `cf-aig-no-wholesale`, metadata, the token fallback, and other hosts refused.
- Unit tests (`team.test.ts`): policies, brief checks, every rule service, clash finding, reconciliation, and the semantic layer's queries, terms and formulas.
- Local dev on Workers AI (gpt-oss-120b through AI Gateway `northstar-marketing-pot`), 2026-11-20: Coastline brief from brief to proposal in about 4.5 minutes; 168 events, 46 model calls, 234,097 tokens, 39 tool calls all allowed, 4 saves kept and 2 refused by the rules, 22 messages of which 6 spoke to spoke, run saved to D1.
- Local dev on Anthropic: the request went through the AI binding to the gateway, which logged it and answered 2044 (provider credentials required) because no Anthropic key is stored yet; the page shows that reason.

## External mutations

none. No Cloudflare, Salesforce, Anthropic or OpenAI configuration changed. Workers AI calls were made through the existing AI Gateway during local runs.

## Rollback

Revert the merge commit. The squad saves runs in the existing `arch_orchestrations` table under `flow_id` `team:<brief>`; no migration was added.
