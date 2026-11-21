# ADR-014: People in the campaign squad's loop, and evals for every run

Status: accepted

Date: 2026-11-20

## Context

After the campaign squad (ADR-013) landed, Andrew asked for people in the loop, with the person at the browser playing them, and for evals. A real agency's campaign does not go straight from its lead to the client: regulated copy is checked by compliance, and the client approves or sends it back. And to compare Workers AI, Anthropic and OpenAI, each run needs a score that means the same thing whichever provider produced it.

## Decision

- **Two decisions belong to people.** A compliance reviewer approves a regulated brand's copy (a brand with a required disclosure) before any proposal reaches the client, and the client (played by the brand lead) approves the proposal or sends feedback, up to two rounds. The lead asks for review with `request_compliance_review`; the server refuses `send_proposal` until compliance has approved the current version of every piece, so changed copy needs a new review.
- **The gateway checks the person's role.** The decisions are the actions `team:decide_compliance` and `team:decide_proposal`, permitted only to the compliance and brand-lead personas (and admin). No agent is granted either.
- **A waiting run is saved and rebuilt from its log.** When the run stops for a person it is saved with status `waiting`, the gate it waits on, and the lead's conversation. `POST /api/arch/team/runs/:id/decide` rebuilds the run's state from its event log and the lead carries on from the decision, streamed on the same page. Nothing but the log and the lead's conversation is stored.
- **A person's changes reach the lead as their words.** The lead sends back the pieces they affect. Its own limit of two send-backs per spoke counts from the last decision, so a person's request is never refused by it.
- **Every run is scored when it ends.** Checks come from the run's own events (outcome, saves the rules accepted, grounding, budget use, audience fit, channel consistency, coordination, collaboration, people's rounds), and a judge scores the proposal on five criteria from 1 to 5. The overall score blends checks (70%) and judge (30%). The judge is always the Workers AI judge champion, so every provider is scored by the same model. Cost comes from each model call's input and output tokens; a model without a recorded price is reported as unpriced, not $0.
- **A reference-set runner.** `pnpm eval:team` runs the reference briefs on each available provider against a running workbench, plays the people (`--feedback` makes each ask for changes once), and writes `artifacts/reports/WU-075/team-evals.json`.

## Consequences

- A run now ends with the client's decision, not with the proposal. A run that waits for a person is scored only once it ends.
- The judge adds one model call per run, on Workers AI, whichever provider ran the squad.
- The person plays each role from the same browser; the role travels as the persona header, as the Journeys flow already does for its reviewer. In production, each role would be a separate person signed in with that role.
- OpenAI's `gpt-6-astra` has no recorded price, so its runs are reported as unpriced until one is added.

## Supersedes

none
