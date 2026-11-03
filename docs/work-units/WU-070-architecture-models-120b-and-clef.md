# WU-070: Architecture agents on gpt-oss-120b, Clef as the answer-quality judge

Status: done

## Scope

- Make `gpt-oss-120b` the architecture router's champion for `orchestrate` and `draft`, with `gpt-oss-20b` as challenger; keep `classify` on 20b.
- Add the `score` task class bound to `@cf/cloudflare/clef`, and judge every agent run's answer quality with it.
- Remove models no longer applicable from the router and the live-eval run list.
- Record the decision in ADR-011 and update Learn.

## Acceptance criteria

- `routeModel` binds orchestrate and draft to 120b, classify to 20b, score to Clef; 20b is the only shadow for orchestrate.
- An agent run carries an answer-quality score when Workers AI is bound, and is unscored (never failed) when the judge is absent or fails.
- Answer quality is not part of any agent's drift baseline.
- Kimi K2.6 and GLM-4.7-Flash are gone from the router; GLM-4.7-Flash and Llama 4 Scout are gone from the live-eval run list; their prices remain for the committed report.

## Evidence

- `packages/architecture/src/architecture.test.ts` (model routing)
- `apps/edge/src/architecture.worker.test.ts` (answer-quality judge; models endpoint)
- `docs/decisions/ADR-011-architecture-models-120b-and-clef.md`, including the local journey comparison (12 runs on 120b, 6 on 20b)
