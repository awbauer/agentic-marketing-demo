---
id: WU-069
title: Journeys get their own view, with the asset composed as the agents build it
status: active
plan_sections: [10, 11]
owners: [agent]
---

# Why

Andrew asked to move the sample flows out of Architecture into their own workspace view, keeping the architecture workspaces where they are. He also asked to see the content blocks the agents draft, which were only visible in the JSON of each step: a preview of the asset as it is built, including blocks rejected for compliance reasons, with the full composition of wrapper and blocks on the right and each block clickable for details.

# Objective

A **Journeys** item in the workspace rail runs the sample flows. Beside the steps, the asset composes itself from the flow's events: the channel wrapper with each block in place, marked by where its words come from, what the service kept out and why, the checks pinned to the block they quote, and the channel versions.

## Scope

- In-scope paths: `apps/web/src/architecture/{JourneysView,AssetPreview,SampleFlows,ArchitectureView,Orientation,guide}.tsx?`, `apps/web/src/architecture/asset.ts`, `apps/web/src/architecture/architecture.css`, `apps/web/src/App.tsx`, Learn; `apps/edge/src/architecture/agent-tools.ts` (a freshly drafted brief now reports its wave, so the preview and the agents see its audience and send date).
- Out of scope: the orchestration and agents' behavior; new endpoints (the preview is derived from events the flow already streams).

## Acceptance criteria

- [x] Journeys is its own rail item; the Architecture tabs no longer include Sample flows, and the intro links to Journeys.
- [x] The preview shows the wrapper (email with sender, audience, send date and subject; push or SMS on a phone) and each block as the authoring agent's call returns it.
- [x] Refused topics and rejected wording appear under "Kept out by the service" with the service's reason.
- [x] Probe findings and readiness blockers attach to the block they quote; channel versions appear as tabs with their character counts.
- [x] Clicking a block shows who wrote it, the tool and policy, its source claim or disclosure, and what the checks found.
- [x] `pnpm verify:fast` passes; worker tests pass.

## Evidence

- Real runs on Workers AI from local dev: Lumera (three framing sentences rejected and the superiority topic refused, all shown kept out with the service's reasons; readiness passed; approved from the decision card and the preview followed to Approved) and Coastline (a push on the phone wrapper with its audience and send date; four rejected sentences, including one that put the price in the agent's own words). The orchestrator skipped atomization in that Coastline run, so channel tabs were checked by unit test only.

## External mutations

none.
