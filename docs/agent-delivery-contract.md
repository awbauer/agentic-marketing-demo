# Agent Delivery Contract

This contract turns the implementation plan into an execution system for autonomous coding agents. It supplements the root `AGENTS.md`; it does not change product scope.

## Work-unit model

Every implementation change starts from a file in `docs/work-units/` copied from `TEMPLATE.md`. A work unit is intentionally smaller than a phase and should produce one independently verifiable vertical result.

Required fields are objective, plan references, in-scope paths, prerequisites, contracts affected, acceptance criteria, verification commands, external mutations, evidence, and final status. Status is one of `ready`, `in_progress`, `blocked`, or `complete`.

An agent may mark a work unit `complete` only when:

- every acceptance item is checked;
- required verification commands pass;
- external writes have read-back evidence;
- UI work has screenshot and accessibility evidence;
- documentation and contracts match the implementation;
- no unresolved placeholder, secret, unsupported claim, or scope expansion remains.

## Repository invariants

- `packages/contracts` owns cross-boundary schemas and the host terms (`host.ts`) every surface names infrastructure by. The web app, server (Worker or Cloud Run), tests, fixtures, Salesforce action wrappers, and HXL mappings consume or validate against the same versioned definitions.
- Agent prompts and tool descriptions are versioned and evaluated like code.
- Salesforce metadata lives under `salesforce/`; no manually configured behavior is considered delivered until its metadata or reproducible setup record is checked in.
- Google Cloud deployment notes live under `infra/gcp/` (the `gcloud` scripts in `scripts/gcp/` are the source of truth); Cloudflare proof configuration and its read-back record live under `infra/cloudflare/pot/`.
- UI components consume typed tile contracts and shared tokens from `packages/ui`.
- Demonstration evidence is immutable and stored under `artifacts/evidence/<work-unit-id>/`; secrets and customer data are forbidden there.
- Architecture changes require a short decision record in `docs/decisions/` that states context, decision, consequences, and superseded assumptions.

## Command contract

Phase 1 creates and keeps these root commands stable:

| Command | Purpose |
| --- | --- |
| `pnpm verify:fast` | Format, lint, typecheck, unit, and contract checks for iteration |
| `pnpm verify` | Complete local gate, including docs, evaluations, and browser tests that do not require live credentials |
| `pnpm eval` | Fixed 20-prompt routing/safety evaluation with threshold enforcement |
| `pnpm test:e2e` | Deterministic mocked end-to-end workflows |
| `pnpm test:e2e:live` | Opt-in Salesforce sandbox and Cloudflare proof smoke/read-back tests |
| `pnpm sf:validate` | Salesforce metadata, Apex, Flow, Agent Script, CLT, and HXL validation |
| `pnpm docs:check` | Links, fenced blocks, generated references, terminology, and decision/work-unit schema checks |
| `pnpm security:blocked-words` | Fail-closed scan of local repository content, the index, and outgoing commits against the ignored local blocked-word list |
| `pnpm pr:check` | Blocked-word gate followed by the complete local verification required before PR creation |

Commands must exit nonzero on failure and emit machine-readable reports under `artifacts/reports/`. Live commands must fail clearly when credentials are absent; they must not silently substitute mocks.

The blocked-word list is the sole exception to report generation because its contents are local confidential inputs. It lives at `.config/blocked-words.local`, is never committed, contains one literal value per line, and must be non-empty. The gate never prints those values. It is mandatory immediately before PR creation and every push; the tracked pre-push hook is defense in depth and must not be bypassed.

## Gate order

1. **Contract gate:** schema compatibility, generated artifacts current, no unrestricted tool contract.
2. **Static gate:** format, lint, typecheck, secret scan, dependency policy, documentation checks.
3. **Behavior gate:** unit, component, Worker runtime, Apex/Flow, Agent Script, and mocked integration tests.
4. **Evaluation gate:** routing, refusal, confirmation, prompt injection, evidence citation, and creative-prompt thresholds.
5. **Experience gate:** Playwright, accessibility, screenshot review, HXL native-fallback parity, loading/error/recovery states.
6. **Live proof gate:** Salesforce Hosted MCP, portal catalog, OAuth, allowed mutation confirmation, authoritative read-back, image generation, R2 lifecycle metadata.
7. **Evidence gate:** work unit complete, reports linked, deployed versions recorded, limitations explicit.

An agent may iterate through gates 1–5 without human involvement. Gate 6 may require a human only for login, MFA, OAuth consent, or account authorization. Gate 7 requires human evaluation only at the final Phase 5 checkpoint defined in the plan.

## Drift controls

- CI compares the tool catalog against a checked-in allowlist and rejects added mutation classes.
- CI checks that model IDs, retention values, image dimensions, cost/generation cap, roles, region, and browser matrix match Section 17.
- Contract tests reject undocumented tile kinds, tool effects, and error codes.
- Evaluation fixtures are append-only during a work unit; lowering a threshold or deleting a failing case requires a decision record.
- Generated Salesforce and HXL schema snapshots are diffed. Unexplained drift fails the gate.
- Documentation assertions and implementation constants share generated references where practical.
- **CI runs every gate:** the `Verify` workflow runs `pnpm verify` and the Playwright suite on every pull request and push to `main`. The `Salesforce metadata` workflow runs the Apex tests after each deployment, fails if they didn't run, and fails if retired metadata reappears in the org (`pnpm sf:retired:check`).
- **Learn drift gate:** `pnpm learn:check` runs in `pnpm verify` and in the Learn workflow on every pull request.
  - It extracts the demo's concepts from code and fails when one lacks a Learn reference entry, or when an entry names something that's gone. The concepts are tools, write actions, graph labels and relationship types, operator controls, and Salesforce components.
  - It fails when a code file isn't mapped to the Learn section that teaches it, or when a mapped or "Where to see it" path no longer exists.
  - It fails when a branch changes code a section explains without changing that section. A `Learn-Reviewed: <section ids> (<reason>)` commit trailer records a deliberate "no update needed" instead.
- A work unit that changes scope or acceptance criteria is invalid unless the user explicitly requested that change.

## Minimal human touchpoints

Humans are expected only for initial account authorization when required and the final Phase 5 proof review. Agents own implementation, visual iteration, testing, documentation, deployment diagnostics, evidence capture, and ordinary reversible fixes between those points.
