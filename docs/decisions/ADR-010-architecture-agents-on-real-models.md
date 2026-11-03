# ADR-010: The architecture agents run on real models, with the rules in services

Status: accepted when Andrew merges the pull request

Date: 2026-11-03

## Context

The architecture workspaces' agents (content plan, brief, module authoring, substantiation, readiness, the adversarial farm and the rest) were deterministic functions with agent labels, and the sample flows called them in a fixed order. ADR-009 recorded that: the router named a model for each agent but none was called. Andrew asked for the agents to be real and for an orchestrator to run and call them as subagents; only the backend services' data may be mocked. See WU-068.

## Decision

- **Every live architecture agent runs on a model.** A run gets the agent's catalog prompt, the model the router binds to its task class (ADR-009's champions, unchanged), and only the tools its registry grants name. The deterministic code becomes the **services** behind those tools. The services keep the rules whatever the model writes: claims are inserted verbatim, required disclosures attached, the agent's own words rejected if they state, restate or compare a fact, unsupported topics refused and recorded as gaps, and nothing existing overwritten.
- **The gateway checks a run and then every tool call** in it, as that agent acting for the step's owner. Platform agents owned by Admin act for whoever started a flow.
- **An orchestrator model runs the sample flows.** It has one tool, `next_step` (delegate, ask a person, finish), forced on every step. It pauses when a module is submitted for review, saved in D1 (`arch_orchestrations`, migration 0007), and resumes only after the module's state shows a person's decision.
- **Reliability with gpt-oss-20b comes from structure, not a bigger model:** an agent's own tool is forced until it succeeds, with what it would read first already in its prompt; the orchestrator's single forced tool lets the existing salvage middleware recover a call written into reasoning; created objects are referred to by short handles; a run stops when the same call fails twice; an agent's account of its work comes from a separate call over the tool results, and is replaced by a plain statement if the work never succeeded.
- **Drift and the evaluators score real runs.** Content scores count only against content the agent wrote or moved forward, and only factual statements count.
- **Tests stay hermetic.** The worker tests set `AGENT_MODEL=scripted`, a stand-in that calls each agent's real tools. No deployed environment sets it; without Workers AI the agents fail with `NO_MODEL` instead of falling back to a script.
- **Local development uses real models**: `pnpm dev:local` runs local D1 and R2 with remote Workers AI under a separate Worker name, so the remote-bindings proxy avoids the Access-protected domain. `AGENT_CHAMPIONS` may name another catalog model per task class for one environment.

## Consequences

- Agent runs cost model tokens and take seconds; a sample flow takes about a minute. Workspace reads (the Performance screen's proposals, workspace manifests) stay service reads and call no model.
- Runs differ. Tests assert the governance (the gateway, the services, the pause for a person), which holds for any model output; they don't assert what a model writes.
- gpt-oss-20b's judgment is uneven: it sometimes picks a less suitable subagent, retries, or summarizes loosely. The services keep any such run safe; promoting a stronger orchestrate champion stays an ADR-009 decision on evaluations.
- Streamed tool arguments from Workers AI occasionally lose characters; the orchestrator recovers by retrying, and the handles keep urns short.

## Supersedes

ADR-009's last decision bullet ("Agents in the architecture workspaces are deterministic functions today ... It does not call a model for them"). The rest of ADR-009 stands.
