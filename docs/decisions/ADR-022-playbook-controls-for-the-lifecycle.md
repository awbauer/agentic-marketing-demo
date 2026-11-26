# ADR-022: Production controls for the pharma lifecycle

Status: accepted

Date: 2026-11-26

## Context

A review of the pharma lifecycle against the *Agentic Systems in Production* playbook (issue #165) found that it already showed cite-or-refuse, policy in code, hard caps, human gates, claim freshness and scored runs. Three practices the playbook ranks highest for regulated work were missing: a gap log, a decision record carrying versions, and measurement of the reviewers. Smaller gaps were idempotent, read-back writes; a pharma rubric and reliability measures for the evals; screening for adverse events; and autonomy earned by evidence.

## Decision

Add these controls to the lifecycle, with their rules in one pure module (`packages/architecture/src/team-governance.ts`) that the edge and the page share:

- **Gap log.** A refused concept or module save logs each point approved content can't support as a `claim-gap` event: no claim, not substantiated, out of scope, off-label, or a fact in the writer's own words. Off-label points route to medical information, the rest to the claims backlog. Nothing is written in their place.
- **Versions and decision records.** Each gateway decision carries the team policy set's version (a hash of `buildTeamPolicies` with the current overrides). Each prompt event carries a version (a hash of its system prompt, tools and settings). Each lifecycle `decided` event carries a `record`: the versions of the artifacts the gate reviewed, the policy version, the reviewed agents' prompt versions, and the time from `await-person` to the decision.
- **Reviewers.** Reviewer metrics (decisions, changes requested, median time, approvals under five seconds) come from those records. A run may set `seededFlaw: true`; the MLR system then adds one module without its safety information to the first job after the automated checks, emits `seeded-flaw`, and withdraws the module before the MLR approval is issued. The scorecard records whether a reviewer caught it.
- **Writes.** Go-live books placements and the 2253 decision files the form, each under an idempotency key derived from the change set. Each emits a receipt artifact holding what was sent, what was read back and whether they match. The channels and the FDA gateway are simulated.
- **Safety.** After results, simulated HCP replies are screened: possible adverse events go to pharmacovigilance within one business day, and off-label questions go to medical information.
- **Evals.** Lifecycle runs are judged on a pharma rubric (fair balance, net impression, claim discipline, fit to the brief). A check grades each worker's report against the trace. The Evals tab adds pass^k across repeated live runs, the reader's agree/disagree labels on the judge, and autonomy stages (Supervise, Assist) per agent: promotion is a person's choice after three clean runs, and demotion is automatic, with a one-run margin to come back. All of these stay in the browser session's metrics. The stage is a record only; every write still waits for a person.

## Consequences

- New event types (`claim-gap`, `seeded-flaw`) and optional fields on existing ones (`start.practice`, `infra.policyVersion`, `prompt.version`, `await-person.at`, `decided.record`, `decision.policyVersion`). Older saved runs fold as before, without them.
- New system artifacts: `deployment_receipt`, `form_2253_receipt` (shown under Publishing) and `safety_intake`.
- Unit tests cover the governance rules; the lifecycle worker test covers versions, the gap log, decision records, receipts, safety screening, the honesty check, the pharma judge and a missed seeded flaw.
- The Learn lesson on the pharma lifecycle explains the controls.

## Supersedes

None. Extends ADR-015 and ADR-017.
