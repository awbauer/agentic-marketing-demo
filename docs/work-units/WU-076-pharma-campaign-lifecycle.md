---
id: WU-076
title: The agent team takes a pharma campaign from business focus to analytics, with MLR
status: in review
plan_sections: [10, 11, 17]
owners: [agent]
---

# Why

Andrew asked for assets from approved content instead of generated images, a page that doesn't move under the reader, coordinators on Opus and Astra with smaller worker models, and a researched pharma campaign lifecycle run by the agent team with realistic human steps and a proper MLR process. See ADR-015; the squad is WU-074 and its people and evals WU-075.

# Objective

The campaign team takes the Lumera brief through six phases — business focus, ideation, content and MLR, audience, publishing, analytics — with agents doing every piece of work under rule services, and the person at the browser taking each human decision in the role it needs.

## Scope

- In-scope paths: `packages/architecture/src/{team,team-pharma,team-evals,index}.ts`; `apps/edge/src/team/{lifecycle,lifecycle-workers,director,run,api,scripted}.ts`; `apps/web/src/team/`; Learn.
- Out of scope: live channel delivery and results; a real Form 2253 submission; separate sign-ins per role.

## Acceptance criteria

- [x] Images come from the asset library with their approval and rights; none is generated.
- [x] New messages never scroll a box the reader has scrolled up; a pill counts what arrived. Tabs change only when the reader picks one.
- [x] Coordinators run on the top tier (Opus 5.5, gpt-6-astra, GLM-5.3), workers on the lower one (Sonnet 5.5, gpt-5.4-mini, DeepSeek V4.1 Flash).
- [x] Prompt caching on vendor requests, and cached tokens priced at the cached rate.
- [x] A lifecycle run goes focus → ideation → content and MLR → audience → publishing → analytics, each step in order, enforced by the server.
- [x] MLR: claims annotated to references, pre-review checks, Medical → Legal → Regulatory routing, a document number and expiry; changes restart the phase with a new job code.
- [x] Unsubstantiated claims, unusable images, contacts without consent and unapproved or expired modules are refused with the reason.
- [x] Each human step is a gateway-checked persona; choice steps take one of the agents' options.
- [x] The page documents every step, agent or person, and shows where the run is.

## Evidence

- Unit tests (`team-pharma.test.ts`): the claims library, focus and concept rules, module assembly with references and disclosures, refusals, approval expiry, consent and do-not-contact, deployment rules, simulated results, and the state machine.
- Worker test (`team-lifecycle.worker.test.ts`, scripted stand-in): a full run through all nine human steps; a superiority claim refused and dropped; Medical's changes restarting the phase with a new job code and the person's words passed to the copy lead; Medical → Legal → Regulatory routed without a model call; a wrong persona refused (403) and an invalid choice refused (400); the scorecard.

- Live, local dev on Workers AI (gpt-oss-120b lead, gpt-oss-20b workers, before the switch to GLM-5.3 and DeepSeek V4.1 Flash), 2026-11-20, Lumera brief, every person played in the browser: the analyst's three focus areas cited real segment, signal and result ids; the brand lead chose one, then a concept carried by the mortality claim and three Aprimo images with MLR approval ids. The copy lead's drafts were refused for restating the efficacy result in its own words; Medical sent the job back twice ("guideline-ready" language; then a paraphrased result and notes that did not match the job), giving jobs LT-US-CRD-2027-043, -044 and -045, the last with the safety claim added. Medical approved, the system routed the job to Legal and Regulatory with no model call, and Regulatory's approval issued LT-US-CRD-2027-045-A, expiring 2027-11-21. Marketing operations approved 14,000 prescribers, 210 removed as do-not-contact and 9,115 email-eligible. The brand lead sent the schedule back twice (email over-priced, then a single send under the $1,000 minimum, which the new minimum-spend rule then refused); go-live was approved with three monthly email sends and display, and Form FDA 2253 was prepared for first use on 2027-01-12.
- Rules added from what the live run showed: own words implying a guideline endorsement or restating a result ("guideline-ready", "proven", "significant reduction"), a claim id in copy, and a deployment line under the channel's minimum spend are refused.

- `pnpm eval:team --providers cloudflare --modes squad,lifecycle --feedback`, 2026-11-21, GLM-5.3 coordinators and DeepSeek V4.1 Flash workers through AI Gateway `northstar-marketing-pot`, every person asking for changes once: all four runs finished, about $1.23 in all. Squad: Coastline 90, Harborstone 92, Lumera 95 (judge 4.9 of 5; $0.19 to $0.29 a run). Lifecycle: all 6 phases, 98; 21 of 23 saves cleared the rules first time, no gateway denials, and all 9 requests for changes (3 from MLR, 6 from the brand team, including a Form FDA 2253 rework that sent publishing back through go-live) were approved on the next version; 1,243,341 tokens, about $0.54, 608 s of model time. Report: `artifacts/reports/WU-076/team-evals-cloudflare.json`, re-scored from the saved runs after the people checks changed (the lifecycle first scored 58 because each scripted request counted against it).

## Not yet demonstrated


- Anthropic and OpenAI lifecycle runs, until their keys are stored on the AI Gateway (WU-074).

## External mutations

none. Workers AI calls go through the existing AI Gateway during local runs.

## Rollback

Revert the merge commit. Lifecycle runs are rows in `arch_orchestrations`; no migration was added.
