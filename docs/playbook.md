# Agentic Systems in Production: A Playbook

Nov 24, 2026 · @Andrew Bauer

## The short version

Most agent programs that fail in production fail on plumbing, not on the model. The model is usually good enough. What breaks is the stuff around it: tools with loose permissions, no evals tied to the business outcome, no trace of why the agent did what it did, and no owner once the pilot team moves on.

So this playbook treats an agent as a distributed system with a probabilistic component in the middle. You wrap that component in deterministic code, give it the fewest tools it needs, measure it against cases you wrote before you built it, and ship it the way you would ship a payments change: behind flags, with rollback, with someone on call.

Four rules carry most of the weight:

1. **Bound the blast radius before you tune the prompt.** What can this agent do on its worst day? Make that answer boring.
2. **No eval, no ship.** If you can't say what "good" is in a test set, you aren't ready for users.
3. **Every action is traceable to a person, a policy and a model version.** Regulated or not, you will need this the first time something goes wrong.
4. **Prefer a workflow to an agent.** Give the model freedom only where the path truly can't be known ahead of time.

Read sections 1 and 5 first if you're deciding whether to start. Read 8 and 9 if you already have something running.

## 1. Should this be an agent at all?

Many use cases pitched as agents are a form, a rules engine, or one LLM call inside a workflow. Pick the lowest rung on this ladder that solves the problem. Each step up buys flexibility and costs you predictability, test effort and audit burden.

| Level | What the model decides | Example | Human role | Eval burden |
| --- | --- | --- | --- | --- |
| L0 Deterministic | Nothing | Rules routing a case by type | None | Unit tests |
| L1 Single call | Text or a label | Summarize a call transcript; classify intent | Reviews output | Golden set, rubric |
| L2 Workflow | Values inside fixed steps | Extract claim fields, validate, file | Approves exceptions | Per-step plus end-to-end |
| L3 Bounded agent | Which tool, in what order, from a short list | Service agent that looks up orders and issues refunds under $50 | Approves anything over a threshold | Trajectory evals, red team |
| L4 Open agent | Its own plan, many tools, long horizon | Research or coding agent | Reviews the final artifact | Sandboxed, task-success benchmarks |
| L5 Multi-agent | Delegation between agents | Orchestrator with specialist sub-agents | Sets goals and budgets | All of the above, plus handoff tests |

Most enterprise wins live at L2 and L3. L4 and L5 are real, but they belong in sandboxes or with expert users who can judge the output.

### The qualification test

Score each question. If you get three or more "no" answers, stop or move down a rung.

1. Does the task need judgment over messy input that rules can't capture?
2. Is there a clear way to tell a good outcome from a bad one, ideally from data you already have?
3. Can the worst plausible action be reversed, capped or caught before it lands?
4. Are the systems it needs reachable through APIs with scoped credentials, not screen scraping?
5. Is the knowledge it relies on current, owned by someone, and retrievable?
6. Is the volume high enough that the build and run cost pays back? Agents that save ten minutes a week for 40 people rarely survive the first budget review.
7. Is there a business owner who will own the metric after launch, not just the demo?

Question 2 matters most. A team that can't write down 50 examples of right and wrong has a discovery problem, not an AI problem.

## 2. Reference architecture: one bounded agent

Start here. One agent, a short list of tools, and every model and tool call passing through a door you own. Most production agents in service, claims, care management and sales ops fit this shape.

&#91;embedded content: reference architecture · single bounded agent\]

Requests come in from channels. The orchestrator runs an explicit loop inside hard caps, with guardrails on the way in and out, and limits enforced by a policy engine rather than the prompt. Every model call goes through the gateway, every action through a tool server with strict schemas, and every fact through retrieval over owned content. The control plane on the right covers all of it.

Three design rules follow from the picture:

- **The orchestrator never holds raw credentials.** Tool servers get a scoped token per run from identity and act on the user's behalf.
- **The model never writes to a system of record directly.** It proposes a tool call. Code validates it, checks policy, and executes it.
- **Nothing bypasses the gateway.** One place to switch models, cap spend, redact data and log calls.

## 3. Workflow and multi-agent patterns

Use the simplest pattern that works, and move up only when you hit a limit you can name. Most good systems are mostly workflow with a few agentic steps.

| Pattern | How it works | Use it when | Watch for |
| --- | --- | --- | --- |
| Prompt chain | Fixed steps, each an LLM call with checks between | The process is known and stable | Errors compounding across steps; add a gate after each |
| Router | A classifier sends each request to a specialized flow | Requests fall into distinct types | Misroutes; track routing accuracy as its own eval |
| Parallel fan-out | Same input to several calls, results merged or voted | Speed matters, or you want several independent checks | Cost multiplies; merge logic becomes the hard part |
| Evaluator and optimizer | One call drafts, another critiques, loop to a cap | Quality criteria are clear and checkable | Endless polishing; cap the loop at two or three rounds |
| Single bounded agent | One model picks tools in a loop, inside caps | The path varies by case but the tool set is small | Tool sprawl past about 15 tools |
| Supervisor and specialists | A planner delegates to sub-agents with their own tools and context | Work exceeds one context window, or roles need different permissions | Handoff loss, cost, and debugging across agents |

### The best reason to go multi-agent is permissions

Splitting work across agents is most useful when it splits rights. An agent that reads untrusted web content should not hold write tools. An agent that drafts customer text needs no tools at all. The drawing shows the shape that follows.

&#91;embedded content: supervisor and specialist agents · rights split by role\]

The supervisor plans but can't change anything. Only the action agent holds write tools, and it never reads raw untrusted content, which breaks the lethal combination described in section 6. Nothing commits until a verifier passes it, and anything the verifier can't judge goes to a person.

Handoffs between agents should carry structured data (a typed findings object, a proposed change set), not free-text summaries. Free text loses detail at every hop, and you can't validate it.

## 4. Technology stack by layer

Pick by layer, and keep each layer swappable. The model you launch with will not be the model you run in a year, and the framework market is still consolidating. The names below are common choices as of late 2026, not endorsements. Check them before you commit.

| Layer | Job | Common options | Selection notes |
| --- | --- | --- | --- |
| Models | Reasoning and generation | Anthropic Claude, OpenAI GPT, Google Gemini, open-weight (Llama, Qwen, Mistral) via Bedrock, Vertex, Azure or self-hosted | Route by task. A small fast model for classification, a frontier model for planning. Pin versions. |
| Gateway | One door for every model call | LiteLLM, Portkey, Cloudflare AI Gateway, Kong AI Gateway, cloud-native gateways | Keys, quotas, fallback, caching, PII redaction and logging in one place. Non-negotiable past one team. |
| Orchestration | Loop, state, retries | LangGraph, OpenAI Agents SDK, Claude Agent SDK, Google ADK, Microsoft Agent Framework, Pydantic AI | Favor explicit graphs over hidden loops. You need to see and test each transition. |
| Durable execution | Survive crashes in long runs | Temporal, AWS Step Functions, Azure Durable Functions, Restate | Anything that runs longer than a request or waits on a human needs this. |
| Tool protocol | Expose systems to agents | MCP for tools and data; A2A for agent-to-agent | Treat every MCP server as a third-party API with its own threat model. |
| Retrieval | Ground answers in your content | pgvector, OpenSearch, Pinecone, Weaviate; hybrid keyword plus vector search; rerankers | Retrieval quality caps answer quality. Most "hallucination" bugs are retrieval bugs. |
| Memory | Carry state across sessions | Your own database with explicit schemas; managed memory services | Store facts with source and expiry. Unbounded memory becomes a poisoning target. |
| Guardrails | Check inputs and outputs | Bedrock Guardrails, Azure AI Content Safety, NeMo Guardrails, Llama Guard, custom classifiers | Layer fast cheap checks before slow ones. Guardrails catch some things; permissions catch the rest. |
| Sandboxing | Run generated code safely | Firecracker or gVisor microVMs, E2B, Modal, cloud container sandboxes | No generated code touches a host with real credentials. Ever. |
| Identity | Who is the agent acting for | OAuth 2.1 with token exchange, workload identity (SPIFFE), short-lived scoped tokens | The agent acts with the user's rights, narrowed, never with a shared service account. |
| Observability | Traces, cost, quality | OpenTelemetry GenAI conventions, Langfuse, Arize Phoenix, LangSmith, Braintrust, Datadog LLM Observability | Emit OTel so you can change vendors. Trace every tool call with inputs and outputs. |
| Evals | Measure quality offline and online | Braintrust, LangSmith, Inspect, DeepEval, Ragas, promptfoo | The tool matters less than the dataset. Version datasets like code. |
| Platform suites | Bundled agent runtime | Salesforce Agentforce, AWS Bedrock AgentCore, Google Vertex AI Agent Engine, Microsoft Copilot Studio and Foundry | Fastest path when the data already lives there. Check how much of the trace and eval layer you can export. |

### Build versus buy

Buy the platform when the agent lives inside one system of record, the actions are that system's own, and the vendor's guardrails and audit trail meet your control set. Agentforce on Salesforce data is the clear case.

Build when the agent spans several systems, needs custom evals, or when the trace data is a competitive or regulatory asset you can't leave in someone else's console. Most large programs end up with both: platform agents for in-app tasks, a custom layer for cross-system work, and a shared gateway and eval harness over the top.

## 5. Failure patterns

These are the failures that show up again and again once real users and real data arrive. Few of them show up in a demo, which is why demos mislead. Each one has a signal you can watch for and a fix that works better than more prompting.

### Reasoning and control failures

| Failure | What it looks like | How you detect it | Mitigation |
| --- | --- | --- | --- |
| Infinite or runaway loops | Agent calls the same tool with tiny variations, burns tokens, never finishes | Step count and cost per run over p99; repeated identical tool calls | Hard caps on steps, tokens, wall time and spend per run. Loop detector on repeated calls. Fail to a human, not to a retry. |
| Premature success | Agent reports "done" when the downstream system shows nothing changed | Outcome checks against the system of record, not the agent's claim | Verify side effects in code after each action. Never trust a model's report of its own success. |
| Plan drift | Long tasks wander from the goal after many steps | Goal-adherence judge on trajectories; rising step counts | Re-state the goal each turn, checkpoint plans, split long work into sub-tasks with their own success tests. |
| Wrong tool, right syntax | Valid call to the wrong tool or wrong record | Tool-selection accuracy in trajectory evals | Fewer tools per agent (under 15 is a good ceiling). Clear, distinct tool names and descriptions. Required ID confirmation before writes. |
| Argument hallucination | Made-up order IDs, dates, account numbers | Schema validation fails; lookups return not-found | Strict JSON schemas, enums, server-side validation. IDs come from prior tool results, never from generation. |
| Over-refusal | Agent declines safe, in-policy requests | Refusal rate by intent; user abandonment | Tune with real refusal samples. Over-refusal costs adoption quietly and rarely shows up in risk reviews. |
| Sycophantic agreement | Agent caves when a user pushes back on a correct answer | Adversarial multi-turn evals | Policy in code, not in prompt. The refund cap is a function check, not a sentence. |

### Data and context failures

| Failure | What it looks like | How you detect it | Mitigation |
| --- | --- | --- | --- |
| Retrieval misses | Confident answer from stale or wrong document | Retrieval recall and precision on a labeled set; groundedness scores | Hybrid search, reranking, metadata filters, document owners and expiry dates. Fix retrieval before prompts. |
| Context overflow and rot | Quality drops as conversations get long; early instructions ignored | Quality by turn number; token counts per call | Summarize and compact state. Keep system rules short. Put critical constraints in code. |
| Memory poisoning | A bad fact written once keeps steering future sessions | Audit of memory writes; drift in answers for a user over time | Memory writes go through validation. Store source and timestamp. Let users see and delete what's stored. |
| Stale knowledge | Policy changed last month; agent quotes the old one | Content freshness metrics; complaint tags | Content ownership, review dates, automatic reindex on change, and evals that cover recent policy changes. |

### Integration and system failures

| Failure | What it looks like | How you detect it | Mitigation |
| --- | --- | --- | --- |
| Non-idempotent retries | A timeout causes two refunds or two emails | Duplicate side effects in downstream logs | Idempotency keys on every write. Durable execution so a retry resumes rather than repeats. |
| Partial completion | Step 3 of 5 fails; the record is half-updated | Orphaned states in the system of record | Sagas with compensating actions. Write a plan, execute, verify, then commit. |
| Silent model change | Provider updates a model alias; behavior shifts overnight | Eval scores drop with no code change | Pin dated model versions. Run the regression suite on every model change, including provider-side ones. |
| Rate limits and latency spikes | Timeouts at peak; users abandon | p95 latency, 429 counts at the gateway | Gateway fallback across regions or providers, queues for async work, timeouts that degrade to a human handoff. |
| Cost blowouts | One user or one bug drives spend up 10x | Cost per run and per tenant, alerted | Budgets per run, per user and per day at the gateway. Caching. Smaller models for sub-steps. |

### Organizational failures

These kill more programs than any of the above.

- **Pilot purgatory.** The pilot worked, but nobody budgeted the run cost, the support model or the integration hardening. Plan the production path before the pilot starts.
- **No metric owner.** Engineering measures accuracy, the business measures nothing. Tie each agent to one business number, such as handle time, containment or cost per case, with a named owner.
- **Eval set built after launch.** Teams ship on vibes, then can't tell whether a change helped. Write the eval set first.
- **Security review at the end.** The review blocks launch for months because tool scopes were never designed. Bring security in at the architecture stage.
- **Knowledge with no owner.** The agent is only as current as its content. If no one owns the content, the agent degrades on a schedule.

## 6. Security, safety and identity

Assume the model will be talked into doing something you didn't intend. Prompt injection has no complete fix today, so the design goal is that a fully hijacked agent still can't do much damage. Permissions, not prompts, are the control.

### The lethal combination

An agent becomes dangerous when one run has all three of these: access to private data, exposure to untrusted content (email, web pages, uploaded files, tickets written by customers), and a way to send data out (email, HTTP calls, writing to a shared system). Break at least one link for any run. A support agent that reads customer emails should not also be able to email arbitrary addresses.

### Controls that work

- **Delegated identity.** The agent acts as the user, with that user's rights narrowed further by task. Use OAuth token exchange to mint short-lived, scoped tokens per run. No shared service accounts with broad rights.
- **Tool allowlists per agent.** Each agent gets the smallest set of tools for its job, with read and write split into separate tools. Writes above a value threshold need a human or a second check.
- **Policy in code.** Limits like refund caps, which records a user may touch, and which fields may change are enforced in the tool server, not described in the prompt.
- **Untrusted content is labeled.** Mark retrieved and user-supplied text as data. Strip or neutralize instructions in it where you can. Run a classifier for injection attempts on inbound content, but don't rely on it.
- **Egress control.** Agents that run code or browse sit behind an egress allowlist. No outbound calls to hosts nobody approved.
- **MCP supply chain.** Pin MCP server versions, review their tool descriptions (they're prompt text and can carry instructions), run third-party servers in isolation, and keep an inventory of which agent uses which server.
- **Kill switch.** One flag per agent that stops all actions within seconds, tested in a game day before launch.

### OWASP Top 10 for Agentic Applications (2026) mapped to controls

The [OWASP list](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) is the best shared vocabulary for security reviews. Use its IDs in your threat model so reviewers and auditors speak the same language.

| OWASP risk | Primary control in this playbook |
| --- | --- |
| ASI01 Agent goal hijack | Lethal-combination split, labeled untrusted content, policy in code |
| ASI02 Tool misuse and exploitation | Tool allowlists, schema validation, value thresholds |
| ASI03 Identity and privilege abuse | Delegated, short-lived, scoped tokens per run |
| ASI04 Agentic supply chain | Pinned MCP servers and models, inventory, isolation |
| ASI05 Unexpected code execution | MicroVM sandboxes, no credentials in sandbox, egress allowlist |
| ASI06 Memory and context poisoning | Validated memory writes with source and expiry |
| ASI07 Insecure inter-agent communication | Signed, authenticated A2A calls; each agent re-checks authorization |
| ASI08 Cascading failures | Per-agent budgets, circuit breakers, kill switch |
| ASI09 Human-agent trust exploitation | Approval screens that show the real action and its effect, not the agent's summary |
| ASI10 Rogue agents | Agent registry, behavior baselines, anomaly alerts, kill switch |

Red-team before launch and on every major change. Include indirect injection through every content source the agent reads, not just the chat box.

### Safety: what the AI safety bodies are telling deployers

Security asks whether an attacker can make the agent misbehave. Safety asks whether the agent will misbehave on its own: drift out of scope, take actions nobody sanctioned, or misreport what it did. Government safety institutes and national cyber agencies spent 2026 publishing on exactly this. Their advice lines up well.

| Source | What they found or recommend | What to do with it |
| --- | --- | --- |
| [UK NCSC, Managing the cyber risk of agentic AI (2026)](https://www.ncsc.gov.uk/sites/default/files/2026-08/Managing-the-cyber-risk-of-agentic-AI_0.pdf) | Safeguards built into models give a baseline level of protection and should not be treated as complete. More autonomy means more risk unless controls grow with it. Tell agents explicitly what they should and should not do. | Never rely on the vendor's model safety alone. Write negative instructions ("never email outside the company domain") and enforce the important ones in code as well. |
| [NIST CAISI, agent hijacking evaluations](https://www.nist.gov/node/1872381) | Hijacking, meaning indirect prompt injection through data the agent reads, is a primary agent risk. Testing an attack across multiple attempts gives more realistic results than a single try. | Run injection tests many times per case and report the attack success rate, not pass or fail. Include every data source the agent reads. |
| [NIST CAISI with UK AISI and Gray Swan, red-teaming competition](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition) | Across 13 frontier models and more than 250,000 attack attempts, red-teamers found at least one successful hijack against every model ([CSA summary](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-caisi-ai-agent-security-agenda-2026-2/)). Models differed sharply in robustness. | Assume your agent can be hijacked; design so a hijack can't do much. Compare candidate models on published injection robustness, not just capability. |
| UK AI Security Institute, 2026 incident report | In a deliberately permissive cyber test, frontier agents with open internet access and disabled safety classifiers took actions outside their sanctioned scope. AISI tied it to that mix of test conditions plus flawed task design and no purpose-built real-time monitoring ([CSA analysis](https://labs.cloudsecurityalliance.org/research/csa-research-note-aisi-frontier-model-rogue-agent-incident-2/)). | Never combine open network access, relaxed safeguards and no live monitoring, in production or in your own test environments. Watch for scope creep as a named failure mode. |
| NIST AI RMF and AI 600-1 Generative AI Profile | Govern, map, measure, manage as the risk lifecycle, with a catalog of GenAI-specific risks. | Use it as the spine of your AI governance program; most US regulators and auditors recognize it. |
| ISO/IEC 42001 | Certifiable AI management system standard. | Worth pursuing when clients or regulators want third-party assurance of your AI program. |
| MITRE ATLAS | Knowledge base of adversary tactics against AI systems. | Threat modeling input next to OWASP. |
| Frontier lab safety frameworks and system cards (Anthropic RSP, OpenAI Preparedness Framework, Google DeepMind Frontier Safety Framework) | Labs publish capability thresholds, safeguards and agentic safety results for each model. | Read the system card before you adopt or upgrade a model. Look for prompt injection robustness, agentic misbehavior tests and known limits. |

### Safety behaviors to test for

Add these to your adversarial eval slice. Each has shown up in published evaluations of agents.

- **Scope creep.** The agent pursues the goal through means you didn't sanction: new accounts, unexpected tools, systems outside its brief. Detect by comparing every action against an allowlist of expected action types.
- **Misreporting.** The agent says it did something it didn't, or hides something it did. Grade the final summary against the trace.
- **Specification gaming.** The agent satisfies the letter of the goal or the grader and misses the intent. Review passing transcripts, not only failures.
- **Pressure response.** The agent bends policy when a user pushes, threatens or flatters. Run multi-turn adversarial scripts.
- **Oversight resistance.** The agent works around a stop signal, a budget cap or an approval step. Test that the kill switch, caps and approval gates hold when the agent is mid-task and "close" to its goal.

### Two practices to adopt from safety research

**Runtime monitors.** A second, cheaper model or a rules engine watches each trajectory as it runs and can pause it: an unusual tool sequence, an action outside the expected set, data headed somewhere new. Monitors catch what static guardrails miss because they see the whole run, not one message.

**A safety case per agent.** A short written argument, backed by evidence, that the agent is safe enough for its use: what it can do, what could go wrong, which controls stop each failure, and the eval results that show the controls work. Safety institutes promote this format for frontier systems, and it adapts well to enterprise agents. It also gives risk committees and auditors one document to review instead of a pile of tickets.

## 7. Regulated industries

Regulators mostly don't care that it's an agent. They care about the same things they always have: who decided, on what basis, can you show it, and did a qualified person supervise it. Design so those answers fall out of your logs. This section is a map for design, not legal advice. Bring compliance and counsel in at the architecture stage.

### What changes by industry

| Industry | Rules that bite | What it means for the agent |
| --- | --- | --- |
| Healthcare | HIPAA privacy and security rules; ONC HTI-1 transparency for decision support; FDA rules where software drives clinical decisions; state privacy laws | BAAs with every model and tool vendor that touches PHI. Minimum-necessary data in prompts. PHI redacted or encrypted in traces. Keep clinical judgment with clinicians unless you're ready for device-level validation. |
| Life sciences | 21 CFR Part 11; GxP; FDA Computer Software Assurance; promotional review (MLR); pharmacovigilance reporting duties | Audit trails and e-signatures on regulated records. Risk-based validation of the agent and its prompts as configuration. Generated promotional content goes through MLR. Any patient or HCP conversation must detect possible adverse events and route them within the reporting clock. |
| Banking and lending | Model risk management (SR 11-7 and OCC equivalents); ECOA and Reg B adverse-action reasons; UDAAP; GLBA; NYDFS Part 500 | The agent and its prompts enter the model inventory, with validation and ongoing monitoring. No agent makes or explains a credit decision without reasons you can trace to inputs. Fair-lending testing on outputs. |
| Broker-dealers and advisers | FINRA 3110 supervision; FINRA 2210 communications; SEC record-keeping (17a-4); Reg BI | Customer-facing output is a communication: retain it, supervise it, review samples. No recommendations without suitability logic you can show. |
| Insurance | NAIC model bulletin on AI; state unfair-discrimination rules; claims-handling regulations | Written AI program, vendor oversight, bias testing on underwriting and claims outcomes. Human review of denials. |
| Hospitality and retail | PCI DSS; GDPR, CCPA and state privacy laws; loyalty program terms | Card data never enters prompts or traces. Consent and purpose checks before using profile data for personalization. Clear disclosure that the customer is talking to AI. |
| EU operations, any sector | EU AI Act; GDPR; DORA for financial entities | Classify each use case by AI Act risk tier. Transparency to users. For high-risk uses: risk management, data governance, logging, human oversight and post-market monitoring. |

### EU AI Act timing

The dates moved in 2026, so plan against the current ones. The Commission proposed the Digital Omnibus on AI in November 2025 to push high-risk deadlines back from August 2026. On 7 May 2026, Parliament and Council reached a provisional agreement. Under that deal, high-risk obligations for stand-alone Annex III systems, such as AI used in employment or credit, move to 2 December 2027, and those for AI embedded in regulated products under Annex I move to 2 August 2028 ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-), [Taylor Wessing](https://taylorwessing.com/en/insights-and-events/insights/2026/05/the-eu-digital-omnibus-on-ai-what-the-political-deal-means)). Some marking obligations for AI-generated content land sooner, around 2 December 2026 ([Proskauer](https://www.proskauer.com/insights/get-pdf/29886)). Confirm formal adoption status with counsel before you rely on any date.

Don't read the delay as a reason to wait. The controls the Act asks for are the same ones you need to run agents safely anyway.

### Cross-cutting controls for any regulated deployment

1. **Use-case register.** Every agent listed with owner, risk tier, data classes touched, tools, model versions and approval date.
2. **Immutable decision record.** For each run: user, inputs, retrieved sources, model and prompt version, tool calls with arguments and results, final output, and who approved what. Retained to the longest rule that applies.
3. **Data residency and retention.** Know where prompts and traces are processed and stored. Zero-retention agreements with model providers where available.
4. **Human oversight that is real.** Reviewers see the evidence and the actual action, have time to judge, and their override rate is tracked. A reviewer who approves 99.8% of items in four seconds each is not oversight.
5. **Change control.** Prompts, tool definitions, retrieval indexes and model versions are all configuration. Changes go through review and regression evals, with a record.
6. **Bias and outcome testing.** Test outcomes across protected groups where decisions affect people's access to money, care, jobs or housing.
7. **Disclosure.** Users know they are dealing with AI and how to reach a person.

## 8. Evaluation framework

Evals are the product spec for an agent. They decide whether you can ship, whether a change helped, and whether a model swap is safe. Build the first version before you build the agent.

### Five layers of evaluation

| Layer | Question it answers | Method | Runs |
| --- | --- | --- | --- |
| Component | Does each piece work? | Unit tests on tools, retrieval recall and precision, classifier accuracy | Every commit |
| Step | Did the agent pick the right tool with the right arguments? | Compare tool calls to expected calls on labeled cases | Every commit |
| Trajectory | Was the path reasonable, efficient and within policy? | LLM judge with a rubric over the full trace; step and cost counts | Every PR and model change |
| Outcome | Did the job get done in the system of record? | Check end state against expected state, in a sandbox with real APIs mocked or seeded | Every PR and model change |
| Business | Did the agent move the metric it exists for? | A/B or phased rollout against baseline: resolution, handle time, cost per case, CSAT | Continuously in production |

Outcome evals matter most and are the most often skipped. An agent can produce a lovely trace and a polite reply while the refund never posts.

### Quality frameworks worth borrowing

The layers say where to test. These frameworks say what "good" means. Use them to write rubrics, not as scores to report on their own.

**HHH: helpful, honest, harmless.** Anthropic researchers [proposed HHH in 2021](https://arxiv.org/pdf/2112.00861v2) as a short definition of an aligned assistant. It still makes a good top level for an agent rubric, once you translate each word into checks you can grade:

| Criterion | What it means for an agent | Checks to grade | Failure it catches |
| --- | --- | --- | --- |
| Helpful | Finishes the user's real task, efficiently, without needless back-and-forth | Task success in the system of record; steps and cost per success; clarifying questions only when the request is truly ambiguous | Over-refusal, stalling, busywork |
| Honest | Says only what its sources and tool results support, and reports its own actions accurately | Groundedness against retrieved sources; claimed actions match the trace; says "I don't know" or escalates when unsure | Hallucination, premature success, made-up confirmations |
| Harmless | Stays inside policy, permissions and scope, even under pressure | Policy violations (target zero on critical ones); out-of-scope actions; PII exposure; behavior under adversarial and injected inputs | Unsafe actions, data leaks, hijacking |

The three pull against each other. Push hard on harmless and the agent refuses safe work; push hard on helpful and it bends rules for a persistent user. Always report a helpfulness number and a harm number side by side, so nobody can improve one by quietly sacrificing the other.

For agents, honest has one extra edge worth its own check: does the agent's account of what it did match what it did? Grade the final message against the trace. This catches the most damaging failure in production, an agent that says the refund went through when it didn't.

**Other frameworks that earn a place:**

| Framework | Where it comes from | Use it for |
| --- | --- | --- |
| RAG triad: context relevance, groundedness, answer relevance | TruLens and the wider RAG eval community | Splitting answer errors into retrieval failures versus generation failures, so you fix the right layer |
| pass^k reliability | Sierra's tau-bench agent benchmark | Running each case k times and counting it as passed only if all k pass. A 90% single-run agent can fall well below that at k=4. Customers experience pass^k, not pass@1. |
| NIST AI RMF trustworthiness characteristics | NIST AI Risk Management Framework | A checklist of qualities (valid and reliable, safe, secure and resilient, accountable and transparent, explainable, privacy-enhanced, fair) that maps cleanly onto risk and audit reviews |
| NIST AI 600-1 Generative AI Profile | NIST | A catalog of GenAI-specific risks, such as confabulation and information security, to make sure your eval set covers each one |
| Task, trajectory, cost, safety | Common practice in agent eval tools | A four-number scorecard for every release: did it succeed, how did it get there, what did it cost, did it break any rules |

One warning from government evaluators: agents game graders. NIST's CAISI found agents in its own evaluations [finding answers online or exploiting scoring flaws](https://www.nist.gov/blogs/caissi-research-blog/cheating-ai-agent-evaluations) instead of solving the task. Your agent can do the same to your eval harness, for example by satisfying a judge's rubric wording while skipping the real work. Read a sample of passing transcripts every release, not only the failures.

### Building the dataset

- **Start with 50 to 100 real cases** pulled from logs, tickets or transcripts, labeled by domain experts. Synthetic cases fill gaps; they don't replace real ones.
- **Grow past 200 before launch,** spread across intents, with a deliberate slice of edge cases, out-of-scope requests and adversarial inputs.
- **Tag every case** by intent, risk level and source, so you can see where a change helps and where it hurts. An average hides regressions in small, high-risk slices.
- **Version the dataset** and record which version produced each score.

### Using LLM judges well

Judges scale review, but they are models too. Write rubrics as specific pass or fail checks rather than 1 to 10 scales. Calibrate each judge against at least 100 human labels and track agreement over time. Use a different model family from the agent where you can. Re-check calibration after any judge model change. A judge nobody has calibrated is an opinion with a dashboard.

### Launch gates

Agree thresholds in writing before you see results. A typical set: task success above the human baseline or an agreed floor, zero critical policy violations on the adversarial slice, no regression over 2 points on any high-risk slice, and cost per successful outcome inside budget. Agents are non-deterministic, so run each case several times and gate on pass rate, not a single lucky run.

&#91;embedded content: the eval loop · production feeds the test set\]

The loop is the point. Production surfaces new failures, experts label them, they join the dataset, and CI stops the same failure from shipping twice.

## 9. LLMOps: running it

An agent in production is a service with an SLO, an on-call rotation and a release process. The difference from normal services is that quality can degrade with no code change and no error in the logs.

### Treat these as versioned artifacts

Prompts, tool definitions, model IDs, retrieval index snapshots, guardrail configs and eval datasets. Store them in Git, deploy them through the same pipeline as code, and stamp every trace with the version of each. When quality drops, the first question is "what changed," and you can only answer it if all of these are versioned.

### Release process

1. **Pull request.** Change to prompt, tool or model. Offline regression suite runs in CI. Merge blocks on any drop past the agreed threshold.
2. **Shadow.** New version runs on live traffic with outputs discarded. Compare against production with judges and diff reports.
3. **Canary.** 1% to 5% of traffic, watched on quality, cost and latency for a set window.
4. **Ramp.** 25%, 50%, 100% with automatic rollback triggers.
5. **Post-release.** Online evals keep sampling. Feedback and escalations get triaged into new eval cases.

### What to monitor

| Signal | Example metric | Alert when |
| --- | --- | --- |
| Outcome | Task success, containment, resolution without re-contact | Drops more than 3 points week over week |
| Quality | Judge scores for groundedness, policy adherence, tone on sampled traffic | Falls below the launch baseline |
| Safety | Guardrail trips, injection detections, PII leaks caught | Any PII leak; spike in injection attempts |
| Behavior | Steps per run, tool error rate, loop detections, refusal rate | p99 steps doubles; tool errors over 2% |
| Human oversight | Escalation rate, reviewer override rate, time per review | Override rate near 0% or rising fast |
| Cost | Cost per run, per tenant, per successful outcome | Daily spend over budget; cost per outcome up 25% |
| Latency | Time to first token, end-to-end p95 | Over SLO for 10 minutes |
| Drift | Input topic mix, new intents, embedding drift | New cluster over 5% of traffic |

Cost per successful outcome is the number finance will ask for. Track it from day one.

### Cost levers, roughly in order of payoff

- Route simple steps to small models.
- Prompt caching for long system prompts and shared context.
- Trim tool outputs before they go back into context. Raw API responses are mostly noise.
- Batch APIs for anything that doesn't need an answer in seconds.
- Cap steps and retries.

### Incident response

Agent incidents need their own runbook because the usual first move, roll back the deploy, may not apply when the cause is a provider model change or poisoned content.

1. **Contain.** Flip the kill switch or drop to a safe mode, such as read-only or human handoff.
2. **Scope.** Query traces for affected runs by time, version and tool. This only works if traces carry versions.
3. **Remediate.** Roll back the prompt, pin the previous model, purge bad memory or index entries, reverse side effects with compensating actions.
4. **Notify.** Regulated data or customer harm may start a legal reporting clock. Know these timelines before launch.
5. **Learn.** Every incident becomes eval cases, so the same failure fails CI next time.

## 10. Rollout: pilot to production

A bounded agent in a large enterprise typically takes four to seven months from qualification to limited release. Regulated work adds validation time. The gates matter more than the dates: each one has written criteria, and failing a gate means fixing the cause, not moving the date.

&#91;embedded content: rollout roadmap · 5 phases, 4 gates, typical durations\]

Gate C is where most programs should slow down. A pilot that doesn't beat the baseline on the business metric is a finding, not a delay. Set kill criteria at Gate A as well: if the agent can't beat the baseline after two pilot rounds, stop and put the money elsewhere.

## 11. Operating model and team

The team that builds the pilot is rarely the team that should run it. Decide who owns what before launch, or the agent will be orphaned within two quarters.

| Role | Owns | Common gap |
| --- | --- | --- |
| Business owner | The outcome metric, the budget, go and no-go calls | Missing entirely, or a sponsor who never looks at the dashboard |
| Product manager | Scope, eval criteria, roadmap, feedback triage | Treats evals as an engineering task |
| Forward deployed or agent engineers | Prompts, tools, orchestration, integration | Spread across too many agents to tune any of them |
| Platform team | Gateway, observability, eval harness, sandboxes, identity | Built late, so each agent team rebuilds it |
| Domain experts | Labeling eval sets, judging edge cases, writing policy | Not given time; labeling becomes a side job |
| Security and risk | Threat model, red team, model inventory, controls testing | Engaged at the end as a gate |
| Content owners | The knowledge the agent retrieves | Nobody, so content rots |
| Support and on-call | Incidents, user escalations | Never trained on how an agent fails |

A central platform with embedded agent teams scales better than either a single center of excellence or every business unit for itself. The platform owns the paved road: gateway, identity, tracing, the eval harness, the agent registry. Agent teams own their use cases on top of it. A review board approves new agents by risk tier, with a fast lane for low-risk internal ones so the process doesn't become the bottleneck.

## 12. Go-live checklist

No agent goes to real users until every box is ticked or has a signed exception.

**Scope and ownership**

- [ ] Business owner and outcome metric named, with a baseline measured before launch
- [ ] Use case registered with risk tier, data classes and model versions
- [ ] Run cost modeled at expected and peak volume

**Safety and security**

- [ ] Threat model done against OWASP agentic risks
- [ ] Lethal combination broken for every run type
- [ ] Delegated, scoped, short-lived credentials; no shared broad service accounts
- [ ] Write actions have idempotency keys, value thresholds and human approval where required
- [ ] Red team covered direct and indirect injection through every content source
- [ ] Kill switch, caps and approval gates tested mid-task in a game day; runtime monitor live; safety case written and reviewed

**Quality**

- [ ] Eval set of at least 200 cases, including adversarial, out-of-scope and safety-behavior cases, with HHH rubric checks, signed off by domain experts
- [ ] Launch thresholds agreed in writing and met
- [ ] LLM judges calibrated against human labels
- [ ] Regression suite runs in CI and blocks merges

**Operations**

- [ ] Traces capture inputs, retrieval, tool calls, outputs and all versions
- [ ] Dashboards and alerts for outcome, quality, safety, cost and latency
- [ ] Budgets per run, user and day enforced at the gateway
- [ ] Runbook written, on-call rotation staffed, support trained
- [ ] Rollback path tested for prompt, model and index changes

**Compliance**

- [ ] Decision record retained to the longest applicable rule
- [ ] Vendor agreements in place (BAA, DPA, zero retention where needed)
- [ ] User disclosure and path to a human
- [ ] Compliance and legal sign-off recorded

## 13. Advice to ignore

Some popular ideas cost more than they return. Push back when you hear them.

- **"Start with multi-agent."** Most multi-agent designs are one agent's job split across several prompts, with more handoff bugs and higher cost. Start with one agent and a good tool set. Split only when context limits or a clear separation of permissions forces it.
- **"Let the agent figure out the process."** If you know the process, encode it. Autonomy is for the parts you can't predict, not a way to skip process design.
- **"Fine-tune for quality."** Fine-tuning rarely fixes agent failures, which are mostly retrieval, tool design and control flow. Exhaust those first. Fine-tune for cost or latency once the behavior is stable.
- **"Guardrails make it safe."** Guardrails are a filter with a miss rate. Permissions and policy in code decide what the worst case is.
- **"Human in the loop solves accountability."** Only if the human has the evidence, the time and the incentive to say no. Measure override rates or you're running theater.
- **"One platform for every agent."** A single vendor suite is fine for agents inside that vendor's data. Forcing cross-system agents into it usually means giving up trace data and eval control.
- **"Accuracy is the metric."** Accuracy on what? Report task success on a representative set, cost per successful outcome, and the rate of harmful errors. A 95% accurate agent whose 5% are wire transfers is not shippable.
- **"We'll add evals after launch."** You won't. And without a baseline you can't prove the agent helped, which is what kills the budget next year.

## Sources

- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [Gibson Dunn: EU AI Act Omnibus agreement](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-)
- [Taylor Wessing: the EU Digital Omnibus on AI political deal](https://taylorwessing.com/en/insights-and-events/insights/2026/05/the-eu-digital-omnibus-on-ai-what-the-political-deal-means)
- [Proskauer: provisional deal would delay high-risk AI rules](https://www.proskauer.com/insights/get-pdf/29886)
- [DLA Piper: proposed deferral of high-risk obligations](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/The-Digital-AI-Omnibus-Proposed-deferral-of-high-risk-AI-obligations-under-the-AI-Act)

* [Askell et al., A General Language Assistant as a Laboratory for Alignment (HHH)](https://arxiv.org/pdf/2112.00861v2)
* [UK NCSC: Managing the cyber risk of agentic AI](https://www.ncsc.gov.uk/sites/default/files/2026-08/Managing-the-cyber-risk-of-agentic-AI_0.pdf)
* [NIST CAISI: Strengthening AI agent hijacking evaluations](https://www.nist.gov/node/1872381)
* [NIST CAISI: Insights from a large-scale agent red-teaming competition](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition)
* [NIST CAISI: Cheating on AI agent evaluations](https://www.nist.gov/blogs/caissi-research-blog/cheating-ai-agent-evaluations)
* [CSA: CAISI's AI agent security agenda](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-caisi-ai-agent-security-agenda-2026-2/)
* [CSA: AISI incident, frontier models attempted real supply-chain attacks](https://labs.cloudsecurityalliance.org/research/csa-research-note-aisi-frontier-model-rogue-agent-incident-2/)
