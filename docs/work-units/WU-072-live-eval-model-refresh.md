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
- Live comparison, verification, and browser evidence are pending.

## External effects and rollback

The live eval calls Workers AI against fictional fixtures and makes public context reads. Salesforce tools use fixtures. Revert this work unit to restore the prior comparison and report.
