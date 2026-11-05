---
id: WU-072
title: Refresh the live evaluation model comparison
status: active
plan_sections: [10, 16, 17]
owners: [agent]
---

# Scope

Keep both gpt-oss models as baselines, with 20b as the chat orchestrator. Keep Kimi K2.6 as the previous quality leader, plus GLM-5.3 and DeepSeek V4 Pro as reference points for the two new paid-access challengers. GLM-5.3-Flash and DeepSeek V4.1 Flash support function calling and have lower published token rates than their respective reference points. Llama 4 Scout and GLM-4.7-Flash were retired from the roster in ADR-011. Their prices support earlier reports.

Show estimated USD per demo turn and per pass beside pass rates. Link Cloudflare's rate source and distinguish model estimates from the run total, which includes the judge panel and simulated agent. Stop the measured turn clock before judging. Link the Edge workspace's existing architecture dependency so the live runner resolves it directly under Node on a clean install.

## Verification and evidence

- [Cloudflare Workers AI rates](https://developers.cloudflare.com/workers-ai/platform/pricing/), checked 2026-11-05.
- `pnpm eval:live --tier frontier --dry-run` projected $10.78 with default repetitions, including $7.05 for judging.
- `pnpm eval:live --tier frontier --trials-demo 1 --trials-routing 1 --dry-run` projected $2.68 for a directional comparison covering all 23 demo scenarios and 35 routing prompts in both routing suites. One observation per case limits conclusions about close pass rates.
- Live smoke: seven models, three turns each, zero provider errors, and $0.148 at list rates. Command: `pnpm eval:live --tier frontier --cases routing-01,demo-summary --trials-demo 1 --trials-routing 1 --no-judge --out /private/tmp/agentic-marketing-eval-smoke.json`.
- `pnpm verify` passed all 14 gates. The two focused Playwright tests passed in both Chrome and Edge (four tests). Tests checked the empty state, semantic cost column headers, report contents, and suite navigation. The local Edge project used the signed Microsoft Edge 156 executable via a temporary Playwright config. Screenshots use the synthetic rendering fixture: [Chrome](../../artifacts/evidence/WU-072/evaluations-chrome.png), [Edge](../../artifacts/evidence/WU-072/evaluations-edge.png).
- Chrome rendered the generated report with all seven model rows, the recorded run cost, and no Llama row. [Live comparison screenshot](../../artifacts/evidence/WU-072/live-model-comparison-chrome.png).
- Live comparison: `pnpm eval:live --tier frontier --trials-demo 1 --trials-routing 1 --out /private/tmp/agentic-marketing-eval-full.json`. The [published report](../../apps/web/public/evals/latest.json) passed schema validation and contains 651 turns, 93 per model, from runner commit `80ab9b1`. No turn had a provider error. Usage priced at list rates was $5.30 ($3.89 contestants, $1.36 judges, $0.052 simulated agent), versus the $2.68 projection. The projection uses historical or fallback token counts, and it is a preflight check.

| Model | Demo scenarios | Pipeline routing | Model-only routing | Est. USD per demo turn |
| --- | ---: | ---: | ---: | ---: |
| gpt-oss-120b | 20/23 | 33/35 | 23/35 | $0.0028 |
| gpt-oss-20b | 21/23 | 33/35 | 8/35 | $0.0015 |
| Kimi K2.6 | 20/23 | 31/35 | 23/35 | $0.014 |
| GLM-5.3 | 17/23 | 29/35 | 18/35 | $0.013 |
| GLM-5.3-Flash | 18/23 | 32/35 | 20/35 | $0.0017 |
| DeepSeek V4.1 Flash | 20/23 | 29/35 | 14/35 | $0.0033 |
| DeepSeek V4 Pro | 20/23 | 31/35 | 15/35 | $0.011 |

GLM-5.3-Flash improved all three pass counts over GLM-5.3 at roughly one seventh of its estimated demo-turn cost. DeepSeek V4.1 Flash tied V4 Pro on demos at roughly one third of the cost and had fewer routing passes. Quality comparisons are directional because each case ran once and Zhipu AI and DeepSeek contestants are each scored by only the other model family.

## External effects and rollback

The live eval calls Workers AI against fictional fixtures and makes public context reads. Salesforce tools use fixtures. Revert this work unit to restore the prior comparison and report.
