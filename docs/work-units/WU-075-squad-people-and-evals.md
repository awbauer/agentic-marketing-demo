---
id: WU-075
title: People take the campaign squad's decisions, and every run is scored
status: in review
plan_sections: [10, 11, 17]
owners: [agent]
---

# Why

Andrew asked to put people in the campaign squad's loop, with the person at the browser playing them, and to add evals. See ADR-014; the squad itself is WU-074 and ADR-013.

# Objective

A regulated brand's copy waits for a compliance reviewer, every proposal waits for the client, and the person at the browser takes both decisions; the squad acts on their words. Every run ends with a scorecard, and a reference-set runner compares providers.

## Scope

- In-scope paths: `packages/architecture/src/{team,team-evals}.ts`; `apps/edge/src/team/{director,run,api,evals,scripted}.ts`; `apps/edge/src/architecture/store.ts` (one list query); `apps/web/src/team/`; `scripts/run-team-evals.mjs`; `apps/edge/tsconfig.json` and `vitest.worker.config.ts` (the eval pricing alias); Learn.
- Out of scope: separate sign-ins per role; calibrating the judge against people's scores.

## Acceptance criteria

- [x] For a regulated brand, the lead asks compliance with `request_compliance_review`, and the server refuses `send_proposal` until a person approves the current version of every piece.
- [x] Every proposal waits for the client, who approves or sends feedback (up to two rounds); the lead sends back the pieces affected, with the person's words, and the changed copy goes back to compliance.
- [x] Only the compliance and brand-lead personas (and admin) may decide; agents can never; a decision on the wrong gate or a decided run is refused.
- [x] A waiting run is saved and rebuilt from its event log, so it survives a reload.
- [x] Every run that ends gets a scorecard (checks from its events, plus a judge on a fixed model), shown on the Evals tab with past runs averaged per provider.
- [x] `pnpm eval:team` runs the reference briefs on each available provider and writes a comparison report.
- [ ] The judge calibrated against people's scores.

## Evidence

- Worker tests (`team.worker.test.ts`, scripted stand-in): the client gate (a marketer is refused 403; the wrong gate 409; approval ends, scores and saves the run; a decided run is refused); the Harborstone loop through compliance changes, compliance approval, client feedback, a second compliance review and client approval, ending with five decisions scored 0.5 on the people check; a stopped run scored with outcome 0; the evals list.
- Unit tests (`team.test.ts`): who may decide; which brands need compliance; each check's score from a run's events; checks that don't apply left out; the judge blended in.
- Live, local dev on Workers AI (gpt-oss-120b through AI Gateway `northstar-marketing-pot`), 2026-11-20, Harborstone brief: the lead asked compliance to review; the compliance reviewer, played in the browser, asked "Don't call the account safe anywhere"; the lead sent the copy back with those words, the copy lead checked with the art director, and every headline came back as "FDIC-insured"; compliance approved, the client approved. Scorecard 88/100: 478,277 tokens, about $0.18, 404 s of model time; 7 of 15 saves accepted on first try; 6 of 6 side questions answered; judge 5/5 on every criterion.

## Not yet demonstrated

- The judge (gpt-oss-120b) scored 5/5 on every criterion of the live run; it is not calibrated, so the rule-based checks are what separate runs today.
- Anthropic and OpenAI runs, until their keys are stored on the AI Gateway (WU-074).
- `pnpm eval:team` to completion against a live workbench: its first run (Workers AI, Coastline, `--feedback`) was stopped before it finished, so no report is committed. The decide and evals endpoints it drives are covered by the worker tests.

## External mutations

none. Workers AI calls were made through the existing AI Gateway during local runs.

## Rollback

Revert the merge commit. Waiting runs are rows in `arch_orchestrations` with status `waiting`; no migration was added.
