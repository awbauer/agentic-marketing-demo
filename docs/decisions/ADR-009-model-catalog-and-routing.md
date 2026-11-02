# ADR-009: Model catalog and routing, with the orchestrator pinned

Status: accepted for the architecture roadmap (#91, WU-062). Andrew's merge of the pull request is the approval.

## Context

Section 17, default 5, and ADR-005 fix the orchestrator model at `@cf/openai/gpt-oss-20b`. The architecture slides call for models that are routed, not wired: an agent names a task, a router binds a model at run time, and a new model enters as a challenger on the same evaluations as the incumbent.

## Decision

- A **model catalog** lists the Workers AI models the evaluations already compare, plus the embedder, with capabilities and each model's evaluation score from `apps/web/public/evals/latest.json`.
- Each agent declares a **task class** (`orchestrate`, `draft`, `classify`, `judge`, `embed`). A **router** binds the class to its **champion** at run time.
- `gpt-oss-20b` **stays the champion for `orchestrate`**. This ADR does not change what the chat orchestrator runs. It changes how a future change would happen: only by a pull request that edits the catalog after a challenger beats the champion on the same evaluations (`canPromote`).
- **Challengers** are chosen per task class. A deterministic share of turns (10%) is marked for **shadow** evaluation, capped at USD 1 a day. A shadow run is never shown to a user.
- Agents in the architecture workspaces are deterministic functions today, so the router governs what they are *bound* to and what the trace and Trust view report. It does not call a model for them.

## Consequences

- Section 17 default 5 is unchanged for the orchestrator. Routing applies only to new task classes and to shadow challengers, which spend within the existing proof cap.
- Shadow execution (calling a challenger and scoring it) is not built: the routing decision, sampling, cost cap and promotion gate are. Building it needs live model calls and is a follow-up.
- Swapping the champion remains a reviewed pull request, so "any swap forces re-evaluation" holds by process and by the `canPromote` check.

## Alternatives considered

- Replace the fixed orchestrator model with a router that picks per turn. Rejected: it would reopen Section 17 and ADR-005 without evidence that a challenger beats the incumbent.
- Route inside AI Gateway only. Deferred: dynamic routes are a deployment setting that needs Cloudflare account access, and the catalog and promotion gate are needed either way.
