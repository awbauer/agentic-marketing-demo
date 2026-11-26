# Agent Execution Contract

This repository is designed to be built, tested, documented, and visually refined by coding agents. Work autonomously inside the proof boundaries. Do not ask a human to make routine implementation, naming, library, layout, or sequencing choices.

## Source-of-truth order

1. The current user instruction.
2. This file and any more-specific `AGENTS.md` in the edited subtree.
3. `docs/getting-started-for-agents.md` for the repository pickup sequence.
4. `docs/agentic-marketing-workbench-plan.md`, especially Sections 3, 10, 16, and 17.
5. The active work unit in `docs/work-units/`.
6. Tests, contracts, and checked-in configuration.

Do not reopen a decision recorded in Section 17 unless current evidence proves it cannot work. Record necessary implementation decisions in `docs/decisions/` without asking for approval when they stay inside the chosen proof boundaries.

## Required work loop

1. Read the relevant plan sections, contracts, tests, and current work unit before editing.
2. Inspect the real repository and external sandbox state needed for the task. Never assume a deployment succeeded.
3. Make the smallest complete vertical change. Update code, tests, fixtures, docs, and generated schemas together.
   - **Keep Learn current.** The Learn page teaches every concept in the demo, and `pnpm learn:check` (part of `pnpm verify` and CI) enforces it:
     - A new tool, write action, graph node or relationship type, operator control, or Salesforce component needs an entry in `apps/web/src/learn/reference.ts`, and the section it names must teach it.
     - A new code file must be mapped in `apps/web/src/learn/sources.ts`.
     - A change to code a section explains must update that section, in `content.ts`, `lessons.ts`, or its reference entries. When nothing a reader learns has changed, add a commit trailer instead, such as `Learn-Reviewed: routing (renamed a helper)`. Never use the trailer to skip teaching a new behavior.
   - **Keep the README current.** Every pull request checks `README.md` against what it changes and updates it in the same change: features, the AI platform and host table, architecture patterns, run and deploy commands, configuration a person sets (such as `wrangler.jsonc` variables), and the repository map. Say in the pull request description what changed in the README, or why nothing did.
4. Run the narrow checks while iterating, then `pnpm verify` before declaring the work unit complete. Phase 1 must create that command before feature work begins. Until then, only planning/governance changes are allowed and they use the explicit documentation checks in their work unit.
5. Capture commands, results, deployed identifiers, screenshots, and read-back evidence in the work unit. Evidence must point to an artifact or include a concise reproducible result.
6. Re-read the diff for scope drift, secrets, unsupported claims, placeholder logic, and missing failure states.
7. Run `pnpm security:blocked-words` immediately before creating a pull request and again immediately before every push. This is a hard, fail-closed gate: never bypass the tracked pre-push hook with `--no-verify`, and do not proceed if the local blocked-word configuration is missing, empty, unignored, tracked, or reports a match.
8. Commit one coherent work unit. Do not mix unrelated cleanup into it.
9. Deliver feature work through a pull request and read back the merged state from the remote.

Passing tests is necessary but not sufficient. A task is complete only when its acceptance criteria and evidence requirements are satisfied.

## Branch and pull-request workflow

- Every feature, behavior change, bug fix, dependency change, deployment-configuration change, or schema change must be developed on a dedicated branch and merged through a pull request. Never commit or push this work directly to `main`.
- Start from the current `origin/main` when safe. Preserve unrelated local work; use an isolated worktree when the existing checkout is dirty or when the change is substantial.
- A request to commit and push feature work means: commit the coherent work unit on its branch, push that branch, and open or update its pull request. It does not authorize a direct push to `main` unless the user explicitly says to bypass the pull-request workflow.
- The pull request must identify the work unit, summarize changed behavior, list verification and evidence, disclose external mutations and rollback steps, and distinguish demonstrated behavior from remaining limitations.
- Andrew Bauer's merge of a pull request is the required human approval. Agents must not merge pull requests themselves.
- After opening or updating a pull request, report its URL and watch for Andrew to merge it. If the current execution cannot remain active, stop cleanly with the branch and evidence preserved. Once the pull request is observed in the `MERGED` state, resume work automatically, perform the post-merge read-back, and continue with the next in-scope work without asking for redundant confirmation.
- Before merge, verify the live PR base and head, inspect the complete diff, confirm required checks are green, resolve conflicts and actionable review findings, and test the merge result when repository state has changed materially.
- When the requested outcome includes delivery to `main`, agents own preparing a merge-ready pull request and resolving failed checks or actionable review findings. Andrew owns the merge action.
- After merge, read back the pull request state, merged commit, `origin/main`, CI result, and any deployed state affected by the merge. Delete the feature branch only when doing so is safe and recoverable.
- Purely administrative repository operations that do not change tracked behavior may occur without a pull request, but documentation, governance, and agent-instruction changes should still use one when they materially change how future work is delivered.

## Agent-owned decisions

Agents own implementation details that do not change the proof's scope, data policy, allowed writes, external systems, chosen models, retention periods, or acceptance criteria. This includes component structure, naming, ordinary dependency selection, responsive layout, test design, error copy, documentation organization, and retry strategy within existing limits.

Prefer existing platform capabilities and repository patterns over new abstractions. Add a dependency only when it removes more complexity than it creates and is covered by tests.

## Human escalation boundary

Ask a human only when one of these conditions is true:

- A login, MFA prompt, credential, consent grant, or account-level authorization requires a person.
- The next action is irreversible, affects production, publishes/sends/activates content, spends beyond the fixed proof cap, or changes an external system outside the three allowed sandbox writes.
- A required choice would change Section 17, the proof acceptance criteria, data handling, legal/IP posture, or the set of external systems.
- Required Salesforce, Google Cloud or Cloudflare capability is actually absent and no in-scope fallback exists.
- Three evidence-backed attempts have reached the same external blocker and safe alternatives are exhausted.
- Final Phase 5 evaluation requires the named Salesforce owner or marketing evaluator.

Do not escalate for routine ambiguity. Choose the simplest reversible implementation, document the choice, and continue.

## Guardrails

- Use only the supplied Salesforce sandbox and sample data. Never introduce production data or credentials.
- Never expose publish, send, activate, delete, suppress, arbitrary CRUD, or buyer-group mutation tools.
- Only the three Section 17 sandbox write types may execute, and each requires server-side confirmation, idempotency, and authoritative read-back.
- Keep customer PII out of model inputs, prompts, logs, fixtures, screenshots, and generated images.
- Treat Salesforce as authoritative for campaign and attached-asset state.
- Keep the orchestrator and image model IDs, retention periods, generation cap, browser matrix, and proof region fixed to Section 17.
- Never weaken a test, schema, evaluation threshold, permission, or policy merely to make a gate pass.
- Never commit secrets, access tokens, org identifiers that are not explicitly safe, generated credentials, or local environment files.
- Keep `.config/blocked-words.local` local and non-empty. Store one literal blocked value per line; never quote, copy, log, commit, or include those values in reports. The repository gate may identify matching files and match counts, but must never print the configured values or value-derived identifiers.
- Do not hand-edit generated artifacts. Change their source and regenerate them with the checked-in command.

## Design and documentation quality

- Derive UI from typed contracts and shared design tokens; do not create one-off card schemas or isolated visual systems.
- Every stateful component needs loading, empty, error, stale, permission-denied, and recovery behavior where applicable.
- Meet WCAG 2.2 AA and test current desktop Chrome and Edge.
- Use screenshot and accessibility evidence for material UI changes. Agents perform the iterative visual review; humans see only the Phase 5 evaluation unless escalation criteria apply.
- Update nearby documentation in the same change. Documentation must describe demonstrated behavior, not an intended future state.
- Keep links, commands, names, schemas, and diagrams synchronized with the implementation.

## Required completion report

Report only:

- Outcome and changed surfaces.
- Verification commands and results.
- Deployment/read-back evidence when external state changed.
- Remaining limitations or a qualifying human escalation.

Do not call work complete when a required gate is skipped, failing, or unverified.
