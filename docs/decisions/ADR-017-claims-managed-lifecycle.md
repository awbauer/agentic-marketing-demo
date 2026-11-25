# ADR-017: The pharma lifecycle follows the claims-management process

Status: accepted

Date: 2026-11-25

## Context

Andrew asked for the Campaign squad's pharma example to track how promotional claims management really works, and supplied a technical explainer (US focus, target state 2027). The explainer describes twelve stations from label to withdrawal, and treats a claim as a record with seven parts (statement, population, comparator and time, reference anchor, required context, safety information, scope and expiry). Measured against it, ADR-015's lifecycle had the right phases but missed several things the process depends on:

- Claims were sentences with references, not records: no claim ID, no passage anchors, no required context, no audience, market or channel scope, no label version, no expiry, and no rule about which claims must not appear together. The library could not show the "wrong twin" problem (a near-identical claim approved for consumers, a detail aid or an old label).
- Concepts went from the brand lead straight to production, with no early reviewer look (the explainer's fix for late concept rejection).
- The pre-review check judged parts, not the module as a whole (net impression), and did not set a review tier.
- Approval issued one document number and nothing checked the built variants against it (station 8).
- Placements carried the module, not the material and claim IDs, so nothing could answer "where is this claim live?" (the claim ID dropped at the channel handoff).
- Form 2253 listed every approved module rather than what was scheduled, and named no PI version.
- Results did not roll up by claim, and nothing turned the brand lead's last decision into a where-used list or a withdrawal plan (station 12).

## Decision

- **Claims are records.** `CLAIM_RECORDS` in `team-pharma.ts` gives each Cardivance claim an ID, type, indication, audiences, markets, channels, passage anchors, required context, the claims it must not appear with, the label version it was approved against (`CURRENT_LABEL`, USPI-v4) and an expiry. `claimsLibrary` returns these with the claim and marks a claim usable only when it is substantiated and in scope for a US HCP email or display campaign on the current label through the campaign's end.
- **The library returns near twins.** `CLAIM_TWINS` adds a consumer version, a rep detail aid version and an old-label version of the outcomes claim. Each is approved for something and refused for this campaign, with the reason.
- **Early concept review.** A new person step, `concept-review` (Medical reviewer, gateway action `team:review_concept`), follows the brand lead's concept choice. Asking for changes there sends ideation back to the art director before anything is built.
- **Claims enter by ID, word for word, with their context.** `draftModule` inserts each claim's ID, text, marker, anchors, required context and label version, refuses a claim not approved for the module's channel, refuses claims that must not appear together, and places the safety information beside the claims.
- **The quality check judges the whole and sets a tier.** `preReviewChecks` adds label and scope, required context, fair balance placement and net impression (claim juxtaposition and images that imply claims the module does not carry). `reviewTier` sets tier A, B or C; new copy around approved claims is tier C, full committee.
- **Material IDs and a final-form check.** `approveJob` issues a material ID per module with its claim IDs and the label version, and expires at twelve months or the first reference or claim expiry. `finalFormCheck` (system artifact `final_form_check`) checks every built variant (four email renderings, three display sizes) against the approved version. The builds come from the approved record, so this demonstrates the check rather than catching real drift.
- **Claim IDs travel into channels.** The schedule's service stamps each placement with a placement ID, material ID, claim IDs, label version and expiry (`placementsFor`).
- **Filing before publishing.** Form 2253 lists only scheduled materials by material ID with the current PI version, and says the schedule is held until Regulatory files it.
- **Results by claim, and where-used at the end.** Simulated results carry claim IDs and roll up by claim. When the brand lead decides the next action, the system issues `claim_trace`: every claim's live placements, expiry and re-review date (two months before expiry), and, for retire, a withdrawal plan by ID that channel owners confirm.

## Consequences

- A lifecycle run now waits on people ten or more times.
- The claim records and twins are fictional fixtures in `team-pharma.ts`, kept apart from the governed seed so the knowledge graph and other flows are unchanged.
- The final-form check cannot fail in this demo, because no separate build exists; it shows what the check covers.
- Localization (station 11) and label-change impact across other brands are out of scope; the claim trace is the per-campaign piece of change impact.

## Supersedes

Extends ADR-015. Its "nine human steps" becomes ten; everything else in it stands.
