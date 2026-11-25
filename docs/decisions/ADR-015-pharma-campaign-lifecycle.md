# ADR-015: A pharma campaign lifecycle, with MLR, run by the agent team

Status: accepted (extended by ADR-017)

Date: 2026-11-20

## Context

Andrew asked for the agent team to take a prescription brand's campaign idea from business focus through ideation, content, audience selection, publishing and analytics, with realistic human steps and a proper MLR (Medical, Legal, Regulatory) process; for agents to do as much as possible with every step documented; for images to come from approved content rather than be generated; for coordinators to run on each provider's top model (Opus, Astra) and workers on smaller ones; and for the page not to move under a reader.

Common US practice, which the lifecycle follows: focus areas come from the brand plan and market data; concepts are built on claims already approved in a claims library and on assets approved in the digital asset library; content is assembled as modules from that library with each claim's references and the required ISI, boxed warning and PI; an MLR coordinator annotates claims to references and routes the job to medical, legal and regulatory reviewers, and an approved job gets a document number and an expiry; HCP targeting is by segment and prescribing decile, email only with documented consent and with the do-not-contact list removed; only the approved version is deployed; Form FDA 2253 goes to OPDP at first use; results are read back by segment, decile and channel into a decision to continue, optimize or retire.

## Decision

- **A second run mode, `lifecycle`, beside the squad.** `POST /api/arch/team/runs` takes `mode: "lifecycle"` for a prescription brand (Lumera Therapeutics). The squad mode is unchanged.
- **The lifecycle is data, and the server enforces it.** `PHARMA_PHASES` in `team-pharma.ts` lists six phases as ordered agent steps (each ending with its save tool) and person steps (each a gate). A pure state machine (`currentStep`, `recordArtifact`, `applyDecision`) decides what comes next; the server, the tests and the page all use it, and a run's state is rebuilt from its event log.
- **Two new agents.** An MLR coordinator (coordinator tier) annotates and checks the job, submits it and prepares Form 2253; a performance analyst (worker tier) reads results and recommends. The campaign lead coordinates the lifecycle with one tool, `lifecycle_step` (assign, or request a person's decision); it is refused any step out of order.
- **Rules live in services, not prompts.** Focus areas must cite real data ids; concepts and modules may use only substantiated claims and usable, in-rights assets; module copy is the library's exact claim text with reference markers, and the service attaches the disclosures the claims require; a job is not submitted unless every pre-review check passes; the HCP list applies consent and do-not-contact; the schedule may run only approved modules, inside the window, before expiry and within budget.
- **Nine human steps, each a gateway-checked role.** The brand lead chooses the focus and the concept, approves go-live and decides the next action; Medical (reviewer persona), Legal (senior) and Regulatory (compliance) review the job; marketing operations (marketer) approves the list; Regulatory submits Form 2253. Choice steps take one of the agents' options. A person asking for changes sends the phase back to its first step, with their words, in a new round; a resubmitted job gets a new job code.
- **The MLR system routes the job.** After Medical approves, the run goes straight to Legal, then Regulatory, without a lead turn. Regulatory's approval issues the document number and an expiry of twelve months or the first reference expiry, whichever is sooner.
- **Results are simulated and labelled so.** Thirty days in market are computed from the brand's benchmarks and each segment's channel affinity, deterministically. No live channel is called.
- **Model tiers.** Coordinators (the campaign lead and the MLR coordinator) run on `claude-opus-5-5`, `gpt-6-astra` or GLM-5.3 (`@cf/zai-org/glm-5.3`); workers on `claude-sonnet-5-5`, `gpt-5.4-mini` or DeepSeek V4.1 Flash (`@cf/deepseek-ai/deepseek-v4.1-flash-1017`). Kimi K2.6 and gpt-oss-120b were chosen first; Workers AI retired Kimi on 2026-11-20, and DeepSeek V4.1 Flash is a frontier model with input cheaper than 120b and cached input at $0.006 per million tokens, which suits workers whose prompts grow with each step. It is limited to 20 requests a minute (50 with prepaid AI Gateway credits). `CLOUDFLARE_TEAM_MODEL` and `CLOUDFLARE_WORKER_MODEL` override the pair.
- **Prompt caching.** Each agent's calls grow one conversation, so the prefix is cached: Anthropic requests carry top-level `cache_control`, OpenAI requests a `promptCacheKey` of run and agent. Model events record cached input tokens, and the cost estimate prices them at the cached rate.
- **Images are chosen, never made.** Agents pick from the asset library, which reports each image's approval and rights and why it can't be used.
- **A lifecycle scorecard.** Phases finished, saves accepted on the first try, MLR resubmissions, brand-team changes and gateway denials. No judge: the rules and people already judge each step.

## Consequences

- A lifecycle run waits on a person nine or more times; each wait saves the run, so a reload or a later visit carries on.
- The lead's conversation grows across the phases; tool results to it are kept to reports and the next step, not the work itself.
- The person plays every role from one browser, as in ADR-014. In production each role is a different signed-in person.
- Market results, the HCP universe and its consent rates are fictional.

## Supersedes

none
