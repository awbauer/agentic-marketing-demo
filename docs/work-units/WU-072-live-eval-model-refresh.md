---
id: WU-072
title: Refresh the live evaluation model comparison
status: active
plan_sections: [10, 16, 17]
owners: [agent]
---

# Scope

Keep both gpt-oss models as baselines, with 20b as the chat orchestrator. Keep Kimi K2.6 and DeepSeek V4 Pro as benchmarks. GLM-5.3-Flash and DeepSeek V4.1 Flash are lower-cost challengers with function calling. GLM-5.3 runs as a judge only. The initial seven-model run found that GLM-5.3-Flash passed more cases in all three suites at about one seventh of the cost per demo turn. Llama 4 Scout and GLM-4.7-Flash were retired from the roster in ADR-011. Their prices support earlier reports.

Show estimated USD per demo turn and per pass beside pass rates. All displayed USD estimates use four decimal places, including totals and preflight estimates. Link Cloudflare's rate source and distinguish model estimates from the run total, which includes the judge panel and simulated agent. Stop the measured turn clock before judging. Link the Edge workspace's existing architecture dependency so the live runner resolves it directly under Node on a clean install.

## Verification and evidence

- [Cloudflare Workers AI rates](https://developers.cloudflare.com/workers-ai/platform/pricing/), checked 2026-11-05.
- The six-model command is `pnpm eval:live --tier frontier --trials-demo 1 --trials-routing 1 --out /private/tmp/agentic-marketing-eval-six.json`. Its preflight estimate was $5.8383. The run covers all 23 demo scenarios and 35 routing prompts in both routing suites. One observation per case limits conclusions about close pass rates.
- `pnpm verify` passed all 14 gates, including fixed-format tests for zero, sub-cent amounts, and run totals. The two focused Playwright tests passed in both Chrome and Edge (four tests). Tests checked the empty state, semantic cost column headers, four-decimal run cost, report contents, and suite navigation. The local Edge project used signed Microsoft Edge 156 via a temporary Playwright config. Screenshots use the synthetic rendering fixture. [Chrome](../../artifacts/evidence/WU-072/evaluations-chrome.png) and [Edge](../../artifacts/evidence/WU-072/evaluations-edge.png).
- The [generated report](../../apps/web/public/evals/latest.json) passed schema validation and contains 558 turns, 93 per contestant, from runner commit `5799459`. Zero turns had provider errors. Recorded usage at Cloudflare list rates totaled $3.5216, comprising $2.3154 for contestants, $1.1557 for judges, and $0.0504 for the simulated agent. The total is rounded independently.
- Chrome workbench read-back checked all six rows, four-decimal USD, and GLM-5.3's presence in methodology as a judge. [Live comparison screenshot](../../artifacts/evidence/WU-072/live-model-comparison-chrome.png).

| Model | Demo scenarios | Pipeline routing | Model-only routing | Est. USD per demo turn |
| --- | ---: | ---: | ---: | ---: |
| gpt-oss-120b | 18/23 | 32/35 | 23/35 | $0.0025 |
| gpt-oss-20b | 22/23 | 32/35 | 11/35 | $0.0016 |
| Kimi K2.6 | 21/23 | 32/35 | 24/35 | $0.0125 |
| GLM-5.3-Flash | 21/23 | 32/35 | 21/35 | $0.0015 |
| DeepSeek V4.1 Flash | 20/23 | 28/35 | 14/35 | $0.0029 |
| DeepSeek V4 Pro | 18/23 | 30/35 | 19/35 | $0.0074 |

## External effects and rollback

The live eval calls Workers AI against fictional fixtures and makes public context reads. Salesforce tools use fixtures. Revert this work unit to restore the prior comparison and report.
