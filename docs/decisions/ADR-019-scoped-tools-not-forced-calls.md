# ADR-019: Scope the tools each context offers; don't force which one is called

Status: accepted

Date: 2026-11-25

## Context

Andrew asked that the demo show real agent behaviour: no forced tool calls, but not everything allowed all the time either. Sane guardrails, and the right tools for the job in each context; in the pharma lifecycle, people at different stages working with different tools.

The demo forced tools in many places, all added because gpt-oss-20b on Workers AI picked tools unreliably (ADR-004, ADR-005, ADR-010, WU-016, WU-017):

- the chat orchestrator's intent router turned a recognised request into a **tool plan** and forced one tool per step;
- the architecture flows' orchestrator, the squad's lead and the pharma lifecycle's lead had one tool each (`next_step`, `lifecycle_step`), forced on every step;
- architecture agents were forced to call their primary tool until it succeeded;
- squad specialists and lifecycle workers were made to call some tool, then forced to ask a teammate on step two and to save from step five;
- the squad judge was forced to call `score_proposal`.

Vertex AI's managed gpt-oss also refuses a forced tool choice outright (ADR-018), so on Google Cloud the forcing was already being translated into instructions.

## Decision

Context decides **which tools are on offer**; the model decides **which to call, in what order, and when it has enough**. Guardrails stay where a wrong move can't be undone or a step must actually act.

- **Chat orchestrator** (`stepToolChoice` in `turn-policy.ts`). A recognised scenario offers only its own tools, never the whole catalog; an unrecognised request gets the brand's catalog as before. The first step must call *one of them*, any one (`toolChoice: "required"`): look before answering. After that the model chooses freely. A Marketing Cloud agent, which drafts and creates in Salesforce, is offered only once every tool planned before it has worked (ground before drafting). When every planned tool has worked, or on the last step, no tools are offered and the model writes the answer. A failed tool stays on offer so the model can fix its arguments. The scenario's order remains as advice in its system prompt.
- **Coordinators** (architecture flows, the squad lead, the lifecycle lead). Their control tool is offered, not forced; a turn that ends in prose gets the existing reminder.
- **Workers** (architecture agents, squad specialists, lifecycle workers). Each is offered only the tools its grants and its stage allow. In the pharma lifecycle that is the stage's reads (`STEP_READS`) within the agent's grants plus that stage's save, so the analyst, the copy lead, MLR and the channel planner each work with different tools at different stages. The first step must use one of them; from the fifth step, or on a nudge, only the save is on offer. Asking an upstream teammate first is guidance in the prompt, not a mandate.
- **The squad judge** has its one scoring tool, unforced; a judge that doesn't score leaves the run unscored.
- **Unchanged guardrails.** The policy router still refuses forbidden actions and prepares writes for confirmation without the model; writes still need a person's confirmation; the gateway still authorises every tool call; brand scope still withholds other brands' tools; rule services still refuse bad saves.
- **Reliability without forcing.** The tool-call guard (`forced-tool-middleware.ts`) now also serves unforced steps. A step that must call some tool is capped and held back; a call leaked into its reasoning is recovered when exactly one offered tool fits it (a tool with no required arguments only when it is the only one), and the step is retried once otherwise. A free step streams live and recovers a leaked call only when it produced nothing else.

## Consequences

- Turns can differ run to run: the model may call tools in another order, call fewer, or answer once it has enough. That is the behaviour the demo now shows; the trace and route map record what it actually did.
- `pnpm eval` (the routing set) still measures which scenario and toolset the router recognises. `pnpm eval:live` runs the same step policy and now measures what the model chose; its next run is the new baseline.
- Verified on live Vertex AI gpt-oss-120b with no forced calls: a Lumera target-list request called `build_hcp_target_list`; a claims question no scenario rule matched called `check_clinical_claims` on the model's own choice; a Fed question chained `get_fed_announcements` then `match_news_to_approved_content`. Each answered from the tool results.
- Learn's routing, reliability, agent-operations, squad and lifecycle lessons describe the new behaviour.

## Supersedes

The forced tool plans and forced control tools described in ADR-004, ADR-005, ADR-010, ADR-013 and ADR-015, and in WU-016 and WU-017. Their evidence about gpt-oss's failure modes still holds and is why the guard remains.
