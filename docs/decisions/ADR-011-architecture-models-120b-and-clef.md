# ADR-011: Architecture agents plan and draft on gpt-oss-120b; Clef judges answer quality

Status: accepted

Date: 2026-11-03

## Context

ADR-010 put the architecture agents on the models ADR-009's router binds, with `gpt-oss-20b` as champion for `orchestrate`, `draft` and `classify`. A production Lumera journey on 2026-11-03 showed two weaknesses that are the model's, not the services':

- The orchestrator rephrased the same failing step instead of changing course.
- The module authoring agent, when its calls to action were rejected, cut them down until a fragment ("See") passed.

The services and the drift scoring were fixed separately (#115). The remaining question was the model. Cloudflare's catalog (reviewed 2026-11-03) offers stronger agentic models; `gpt-oss-120b` is the cheapest step up in the same family ($0.35 / $0.75 per million tokens against $0.20 / $0.30), so tool calling behaves the same, and it already runs here as the judge. On the committed live evaluations it also beats 20b: 90 of 110 turns passed against 84 of 110, so 20b as challenger cannot be promoted back by `canPromote`. The catalog also adds Clef, a decision model that answers typed questions with probabilities and bills input tokens only.

Separately, the answer-quality evaluator has never scored a production run: it needs a judge, and sampled runs had none.

A local comparison on real Workers AI (2026-11-03; the three sample journeys, 12 runs on 120b and 6 on 20b, each approved when it asked) bore this out:

| | gpt-oss-120b | gpt-oss-20b |
|---|---|---|
| Reached the reviewer | 12 of 12 | 4 of 6 |
| Authoring attempts rejected for wording | 26 of 38 (2.2 a run) | 32 of 37 (5.3 a run) |
| Delegations failed on a bad reference | 1 | 2 |
| Authoring answer quality (Clef) | 0.751 | 0.687 |
| Mean run time / tokens | 133 s / 18,054 | 127 s / 19,815 |

On 20b, two of six journeys never produced an email: one had all 7 authoring attempts rejected, another 11 of 12. Its accepted framing also dropped punctuation ("See the outcomes"). 120b took about as long and used fewer tokens, because it retried less.

## Decision

- `gpt-oss-120b` becomes champion for `orchestrate` and `draft`. `gpt-oss-20b` becomes their challenger.
- `classify` stays on `gpt-oss-20b`: those agents call deterministic services and decide little in their own words.
- A new task class, `score`, binds `@cf/cloudflare/clef`. It cannot call tools, so no agent runs on it. The answer-quality evaluator uses it to judge each run on three typed questions (did it do the task, is the summary grounded in the tool results, could a marketer act on it), averaged onto 0 to 1.
- Clef gives no reasons, and its probabilities are not yet calibrated against labelled runs, so answer quality is recorded and shown but is not part of drift.
- Models no longer applicable leave the catalog: Kimi K2.6 and GLM-4.7-Flash from the architecture router (neither was a champion, and Kimi costs 3 to 5 times 120b), and GLM-4.7-Flash and Llama 4 Scout from the live-eval run list, where WU-051 had already excluded them as low performers. Their prices stay in `pricing.ts` because the committed report holds their turns. Kimi K2.6 stays in the opt-in frontier tier of the live evals.

## Consequences

- Journey runs cost more per step (about 1.75 times input and 2.5 times output on planning and drafting) and each step is somewhat slower; the latency evaluator's 20-second budget (#115) allows for it.
- Each agent run makes one Clef call (input tokens only, a few thousand per run). A failed call leaves answer quality unscored and never fails the run.
- The chat orchestrator is unchanged: it runs `gpt-oss-20b` under ADR-005 and the contracts package.
- The promotion is consistent with ADR-009's gate: the new champion beats the old one on the same evaluations. 20b as challenger keeps the comparison available once shadow execution is built.

## Supersedes

ADR-009's choice of `gpt-oss-20b` as champion for `orchestrate` and `draft` in the architecture router. ADR-009's process and ADR-005's chat orchestrator choice are unchanged.
