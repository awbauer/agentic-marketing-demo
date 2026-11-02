---
id: WU-067
title: Lumera Therapeutics — a pharmaceutical brand with clinical claims, drugs, hospitals and MLR-approved content
status: active
plan_sections: [10, 11]
owners: [agent]
---

# Why

Andrew Bauer asked for a pharma brand for the demo, with clinical claims, indications, drugs, content, target accounts and hospitals, and the use cases and knowledge graph a pharmaceutical marketer needs. Harborstone Wealth already shows regulated content in finance; this adds the pharmaceutical version, where a claim is only usable if a trial supports it, the label covers it, and a medical-legal-regulatory (MLR) approval is current.

# Objective

A third brand, **Lumera Therapeutics**, in the knowledge graph, three new graph tools, three use cases, and the same brand running through the Architecture view's lifecycle.

## Scope

- In-scope paths: `packages/knowledge-graph/src/pharma.ts`, `dataset.ts`, `tools.ts`; `packages/contracts` tool names; `apps/edge/src/turn-policy.ts` and `working-set.ts`; `apps/web/src/usecases`, `apps/web/src/graph`; `packages/architecture` seed, farm, agents and channels; `packages/evals` cases and rubrics; Learn.
- Explicitly out of scope: real drugs, trials or clinicians; patient or prescriber-level data; a Salesforce Health Cloud or Veeva integration; new Salesforce writes; running the new Cypher against a live Neo4j database.
- Prerequisites: #108 (the Architecture view) is merged.

## Contracts affected

- Schemas: `BRANDS` gains `Lumera Therapeutics`.
- Tools/actions: `build_hcp_target_list`, `check_clinical_claims`, `plan_hospital_engagement` (read-only graph tools, 15 now). No write actions.
- Graph: seven node types (Drug, Indication, ClinicalTrial, ClinicalClaim, Hospital, Specialty, PrescriberGroup) and twelve relationship types (INDICATED_FOR, INVESTIGATED_FOR, STUDIED_IN, SUPPORTS, CLAIMS_ABOUT, CARRIES, TREATS, SPECIALIZES_IN, PRACTICES_AT, ON_FORMULARY, SEES_PATIENTS_WITH, PRESCRIBES). It reuses ContentAsset, Approval, Disclosure, BrandRule, ConsentScope, Campaign, Brief and Channel. The graph grows by 91 nodes and 356 relationships.
- External state: none. The Neo4j seed picks the new nodes up on the next `pnpm kg:seed`.

## What it models

- **Drugs and the label.** Cardivance (heart failure, boxed warning), Glucora (type 2 diabetes), Neurelva (chronic migraine). `INDICATED_FOR` is the label; `INVESTIGATED_FOR` is a condition the drug is only studied in (Cardivance in HFpEF).
- **Clinical claims.** Eight claims, each `CLAIMS_ABOUT` a drug and `FOR` an indication, `SUPPORTS`-ed by a trial or not. One has no trial (a superiority claim), one is off label with a trial that has no results, and one is supported but its content's MLR approval has expired.
- **Content.** Eleven assets (HCP emails, detail aids, portal modules, formulary value dossiers), each with an MLR approval, the safety information it must carry, the channel it is approved for, and pass or fail on four rules (fair balance, label, evidence, safety information).
- **Hospitals and audiences.** Eight fictional hospitals with patient volumes, formulary status per drug and days to the next P&T review. Sixteen prescriber groups (a count and a decile per specialty per hospital) with opted-in counts for email, portal and rep visits, Lumera's share, and the content they engaged with. No individual clinician or patient is modeled.

## Acceptance criteria

- [x] The three tools return the same shape from the fixture backend, with evidence paths, and are read-only.
- [x] An unsupported claim, an off-label claim and an expired approval are each blocked with a reason; content for a boxed-warning drug is blocked without its boxed warning.
- [x] A drug that is not on formulary leads with access content, not detailing.
- [x] The architecture lifecycle refuses to cite a draft or rejected claim, flags superiority language, and blocks a module whose study report has lapsed.
- [x] Learn, the use-case library, the graph explorer and the routing and eval cases cover the new tools.
- [x] The Cypher returns the same rows from live Neo4j: `pnpm kg:parity` matched all 22 tool calls for the three new tools, and the existing tools and memory still match (p50 153 ms, p95 469 ms).
- [ ] `pnpm verify` passes. See Evidence.

## Verification

```text
pnpm verify:fast
pnpm verify
pnpm exec vitest run --config vitest.config.ts packages/knowledge-graph packages/architecture
pnpm kg:parity   # needs NEO4J_QUERY_URL, NEO4J_USERNAME, NEO4J_PASSWORD
```

## External mutations

One, run on Andrew's request: `pnpm kg:seed --confirm` against the Neo4j instance configured in the local `.dev.vars`. It merges nodes by id under the unchanged dataset version, so it only added Lumera and the read-back matched (2,530 nodes and 20,701 relationships). `pnpm kg:parity` then passed. Rollback: re-seed with `--reset` from `main`. Any other instance needs the same `pnpm kg:seed --confirm`.

## Evidence

- Reports: `artifacts/reports/` from `pnpm verify`.
- Read-back results: unit tests on the fixture backend, routing evaluation 100% on the 31 cases, the live seed read-back, and `pnpm kg:parity` against Neo4j.
- Known limitations: the new screens were not checked in a browser. The agents and tools are deterministic over fictional data, so no model behavior is measured. Drug names, trial names and results are invented and are not medical information. Rep visits and the HCP portal exist as channels and consent scopes in the graph only; the Architecture view's channels stay email and push. The routing patterns are keyword-based like the existing ones.

## Completion

- Final status: awaiting Andrew's review.
- Commit: see the pull request.
- Summary: Lumera Therapeutics is a third brand across the graph, the tools, the use-case library, the evals and the Architecture view.
