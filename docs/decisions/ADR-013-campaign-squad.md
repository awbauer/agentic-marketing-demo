# ADR-013: A campaign squad of agents, on three model providers through one AI Gateway

Status: accepted

Date: 2026-11-20

## Context

Andrew asked for a page that shows a lead agent coordinating specialist agents, with the agents talking to each other, every agent really built and running, the semantic layer and the agent infrastructure that support them made visible, and a switch that runs the same agents on Cloudflare Workers AI, Anthropic or OpenAI with every request going through his Cloudflare AI Gateway, where he stores the vendor keys.

The existing architecture agents are scoped to governed objects (claims, modules, plans) and wired into the registry, drift sweep and evaluators. A campaign squad works on a brief and sample market data, not governed objects, so adding it to that registry would put it under evaluators and drift checks that don't fit.

## Decision

- **A separate roster, the same gateway.** The squad's roster (`packages/architecture/src/team.ts`) compiles its own default-deny policies, one permit per agent for its own tools. `invoke` takes them as extra policies, so each tool call is checked as `team:<tool>` beside the registry's policies, with the same forbids, brand scope, per-call token, audit log, `DISABLED_AGENTS` and lifecycle.
- **Hub and spokes.** A campaign lead with one forced tool (`next_step`) plans, delegates, reviews, reconciles and proposes. Four spokes each save through one tool that a deterministic service checks. Spokes ask each other questions directly; when a piece builds on saved work, the spoke's second step must be that question.
- **A semantic layer.** Agents read through governed entities and metrics (`team-semantic.ts`), and the projection formulas live only there.
- **Three providers, one loop.** Workers AI runs as before. Claude runs through the official Anthropic SDK behind an AI SDK model adapter (`anthropic.ts`): forced tool choice becomes `auto` plus a system message naming the tool, Claude's turns (thinking blocks included) are replayed unchanged, effort is set per agent, and server-side refusal fallback and prompt caching are on. OpenAI runs through `@ai-sdk/openai` on the Responses API.
- **Every vendor request through the AI Gateway, keys stored on it.** The vendor SDKs get a fetch (`gateway.ts`) that sends each request through the Worker's AI binding to the gateway's provider-native endpoint, with the vendor key headers removed so the gateway supplies its stored key (BYOK), and `cf-aig-no-wholesale: true` so a missing key is an error, never a Cloudflare-billed fallback. If the binding cannot send such requests, the gateway's public URL is used with `CF_AIG_TOKEN`. Any other host is refused.

## Consequences

- Section 17 fixes the orchestrator model. This adds two model providers and two external systems (the Anthropic and OpenAI APIs, reached only through the AI Gateway) for this page only, at Andrew's request; the chat orchestrator and the architecture agents are unchanged.
- Nothing runs on Anthropic or OpenAI until their keys are stored on the gateway (alias `default`); until then the gateway answers 2044 and the page says what to do.
- Claude Opus 5.5 costs more per run than Workers AI; a Workers AI run used about 234,000 tokens.
- The binding route copies the request shape of Cloudflare's `createAI` (agents 0.33). The installed `agents` package predates it; upgrading `agents` would let the squad use `createAI` directly.
- Runs differ and take a few minutes. The squad writes nothing to Salesforce.

## Supersedes

none
