# Learn: context, GraphRAG, and how this demo works

> Generated from the Learn page's sources in `apps/web/src/learn` by `pnpm learn:export`. Don't edit it by hand: `pnpm learn:check` fails when it's out of date.

A hands-on course in how an agent uses context, how GraphRAG grounds answers in connected facts, and how every piece of this workbench fits together. Each lesson has a diagram, one key idea, a way to try it here, and links to go deeper.

## Contents

- [Part 1: Primer: context](#part-1-primer-context): What the model can see, and why it matters (3 lessons, 6 min)
  - [1.1 What context is](#11-what-context-is)
  - [1.2 Three layers of memory](#12-three-layers-of-memory)
  - [1.3 What goes wrong with context, and the defenses here](#13-what-goes-wrong-with-context-and-the-defenses-here)
- [Part 2: Primer: RAG and GraphRAG](#part-2-primer-rag-and-graphrag): Grounding answers in connected facts (3 lessons, 7 min)
  - [2.1 RAG in one page](#21-rag-in-one-page)
  - [2.2 GraphRAG](#22-graphrag)
  - [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag)
- [Part 3: Every concept in the demo](#part-3-every-concept-in-the-demo): Every moving part of the workbench (20 lessons, 20 min)
  - [3.1 The orchestrator agent](#31-the-orchestrator-agent)
  - [3.2 The workspace: focus, context, and records](#32-the-workspace-focus-context-and-records)
  - [3.3 The model: gpt-oss-20b on Workers AI](#33-the-model-gpt-oss-20b-on-workers-ai)
  - [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp)
  - [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions)
  - [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows)
  - [3.7 Routing: policy router, intent router, and tool plans](#37-routing-policy-router-intent-router-and-tool-plans)
  - [3.8 Reliability guards for tool calling](#38-reliability-guards-for-tool-calling)
  - [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches)
  - [3.10 Structured UI: Markdown, HXL cards, and native fallbacks](#310-structured-ui-markdown-hxl-cards-and-native-fallbacks)
  - [3.11 Observability: technical trace, turn history, and audit export](#311-observability-technical-trace-turn-history-and-audit-export)
  - [3.12 Evaluations](#312-evaluations)
  - [3.13 Campaign image workflow](#313-campaign-image-workflow)
  - [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather)
  - [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services)
  - [3.16 Governed objects and workspaces](#316-governed-objects-and-workspaces)
  - [3.17 The agentic gateway](#317-the-agentic-gateway)
  - [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn)
  - [3.19 Agents, prompts, models, and drift](#319-agents-prompts-models-and-drift)
  - [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats)
- [Glossary](#glossary)
- [Reference: every concept in the code](#reference-every-concept-in-the-code)

## Part 1: Primer: context

*What the model can see, and why it matters* · 3 lessons · 6 min

Everything a model knows during a turn is its **context**. Most agent quality problems, such as forgetting, hallucinating, or acting on stale facts, are context problems. This part explains what context is, how this demo manages it, and what can go wrong.

**You'll be able to**

- Name what fills a model's context window on every call
- Tell working memory, the audit trail, and long-term memory apart
- Spot the context failures the demo defends against

### 1.1 What context is

*The model only sees what is in its context window for this one call.*

**Diagram: What fills the context window**

```mermaid
flowchart TB
  subgraph context_window0_window["Context window: everything the model can see"]
    direction LR
    context_window0_s0["System rules (14%)<br/>authority, safety, format"]
    context_window0_s1["Tool definitions (30%)<br/>names, descriptions, schemas"]
    context_window0_s2["Conversation (28%)<br/>last 8 messages, text only"]
    context_window0_s3["Tool results (20%)<br/>this turn only"]
    context_window0_s4["Latest message (8%)<br/>what to do now"]
  end
  context_window0_0["◆ gpt-oss-20b<br/>reads the whole window"]
  context_window0_1["→ Next step<br/>call a tool, or answer"]
  context_window0_0 --> context_window0_1
  context_window0_window --> context_window0_0
```

*One model call. Proportions are illustrative; the window is rebuilt from scratch every call.*

> **Key idea:** The model sees only what's in this call's window. Good context is the smallest set of high-signal facts for the next step.

A language model has no memory between calls. Each time the orchestrator asks the model for a turn, it sends a **context window**: a bounded sequence of tokens that is all the model can see. In this demo that window contains:

- **System instructions:** the orchestrator's rules, such as "Salesforce tool results are the only authority" and "never claim a write happened".
- **Tool definitions:** names, descriptions, and JSON input schemas for every tool the model may call on this step.
- **Conversation messages:** the recent user and assistant messages.
- **Tool results:** what each tool returned earlier in this turn.

**Context engineering** is deciding what goes into that window, in what form, and what stays out. More is not better. Long, noisy windows dilute attention ("context rot"), cost more, and give stale or injected text a chance to steer the model. Good context is the *smallest* set of high-signal information that lets the model do the next step well.

**Try it**

- Ask a question, then open its technical trace: “Summarize the sample campaign and its recent performance”

**In this demo**

- System prompt: apps/edge/src/turn-policy.ts (orchestratorSystemPrompt)
- Technical trace at the top of each answer shows what the model did with its context

**Learn more**

- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Paper: [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)

### 1.2 Three layers of memory

*Working memory, the audit trail, and long-term memory each live somewhere different.*

**Diagram: Three layers of memory**

```mermaid
flowchart TB
  memory_layers0_0["Working memory<br/>Agent Durable Object · chat messages<br/>Read by the model · Until New chat"]
  memory_layers0_1["Audit trail<br/>Agent SQLite · turn history<br/>Read by people · 24 hours"]
  memory_layers0_2["Long-term memory<br/>Knowledge graph · linked to campaigns and brands<br/>Recalled by the model, through tools · 14 days, across chats"]
```

*Each layer has a different reader and lifetime. Only working memory is sent to the model every turn.*

> **Key idea:** “Session context” is three things: working memory for the model, an audit trail for people, and long-term memory by relationship.

"Session context" is really three different things with different lifetimes and owners:

| Layer | Holds | Lives in | Lifetime |
|---|---|---|---|
| **Working memory** | The current conversation, plus the workspace: the focus draft, open records, and context cards | Each user's agent Durable Object | Until **New chat** |
| **Audit trail** | What each turn did: route, tools, inputs and outputs, outcome | Agent SQLite (turn history) | 24 hours |
| **Long-term memory** | Drafts you asked to remember and confirmed Salesforce writes | Knowledge graph, linked to the campaigns and brands involved | 14 days, across chats |

**Working memory** is sent to the model as a bounded window: the last 8 messages. Earlier assistant replies are reduced to their text, so old tool results and reasoning never re-enter the prompt. The workspace is working memory too. The draft being built, the records the chat opened, and the context its tools gathered are summarized in every prompt, so the model works from structured state instead of re-reading old replies. See *The workspace* under the demo concepts.

**The audit trail** is never sent to the model. It exists for people: History (a button on the Chat page) and the audit export.

**Long-term memory** belongs in the graph because it's retrieved *by relationship* ("what did we decide about the Coastline push?"), not by recency, and it needs provenance. It's never sent automatically: the model reads it through recall tools, only when a question asks about earlier work. See *Long-term memory* under the demo concepts.

Each turn in the history also records the brand and role it ran under.

**Try it**

- Open turn history and memory (opens the history view)

**In this demo**

- Chat → History: Turns (the audit trail) and Memory (long-term memory)
- apps/edge/src/orchestrator.ts (conversationWindow)
- packages/knowledge-graph/src/memory.ts

**Learn more**

- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Docs: [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- Docs: [Cloudflare chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)

### 1.3 What goes wrong with context, and the defenses here

*Stale claims, prompt injection, and overflow, plus the guards this demo uses against each.*

**Diagram: Context risks and defenses**

```mermaid
flowchart TB
  subgraph context_defenses0_lane0["Stale claims"]
    direction LR
    context_defenses0_0_0["! Old reply says X"]
    context_defenses0_0_1["✓ Re-check with tools<br/>earlier replies are context, not evidence"]
    context_defenses0_0_0 --> context_defenses0_0_1
  end
  subgraph context_defenses0_lane1["Prompt injection"]
    direction LR
    context_defenses0_1_0["! “Ignore your rules”<br/>hidden in data"]
    context_defenses0_1_1["✓ No write tools<br/>policy router · human confirmation"]
    context_defenses0_1_0 --> context_defenses0_1_1
  end
  subgraph context_defenses0_lane2["Overflow"]
    direction LR
    context_defenses0_2_0["! Reasoning uses the budget"]
    context_defenses0_2_1["✓ 4,096-token budget<br/>text-only final step · recovery message"]
    context_defenses0_2_0 --> context_defenses0_2_1
  end
  context_defenses0_lane0 ~~~ context_defenses0_lane1 ~~~ context_defenses0_lane2
```

*Each risk has a defense that doesn't depend on the model behaving.*

> **Key idea:** Treat earlier replies and tool results as data, not instructions, and never let the model hold write tools.

**Stale or unsupported claims.** If an earlier answer said something wrong and it stays in the window, the model tends to repeat it as fact. Defense: earlier replies are *context, not evidence*. The system prompt requires re-checking Salesforce facts with tools each turn, and old tool results are stripped from history.

**Prompt injection.** Text inside data, such as a campaign description saying "ignore previous instructions", can try to steer the model. Defenses:
- The model has **no write tools**; writes need a human confirmation.
- A **policy router** answers write and forbidden requests without calling the model.
- Tool results are treated as data.
- The Apex readiness check flags instruction-like text.

**Overflow and truncation.** Workers AI defaults to 256 output tokens, which gpt-oss's reasoning could use up before any answer. Defenses: an explicit 4,096-token budget, forced text-only summary steps, and a recovery message if a turn still ends empty.

**Try it**

- Try a blocked request: “Publish and send the campaign”

**In this demo**

- apps/edge/src/turn-policy.ts (system rules)
- packages/contracts/src/index.ts (classifyPolicyIntent)
- Evaluations view: "No false write claims" check

**Learn more**

- Guide: [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### Check your understanding

Which of these does the model see on every turn?

1. The full turn history
2. The recent conversation and a summary of the workspace
3. Every earlier tool result, in full
4. The whole knowledge graph

<details><summary>Answer</summary>

**2. The recent conversation and a summary of the workspace** Models keep nothing between calls. Each turn sends the last 8 messages (text only) and a summary of the workspace: the draft in progress, open records, and context gathered. Turn history is for people, and the graph is queried through tools.

</details>

## Part 2: Primer: RAG and GraphRAG

*Grounding answers in connected facts* · 3 lessons · 7 min

**Retrieval-augmented generation (RAG)** grounds a model in data it was not trained on by retrieving relevant facts into its context. **GraphRAG** retrieves from a knowledge graph, so answers can follow relationships and show the path to their evidence.

**You'll be able to**

- Explain retrieve → augment → generate
- Say when a graph beats similarity search
- Describe how the demo's six graph tools return evidence paths

### 2.1 RAG in one page

*Retrieve relevant facts, add them to the context, then generate an answer grounded in them.*

**Diagram: Retrieval-augmented generation**

```mermaid
flowchart TB
  rag_flow0_0["1. ? Question"]
  rag_flow0_1["2. ⌕ Retrieve<br/>search your data"]
  rag_flow0_2["3. + Augment<br/>add facts to the context"]
  rag_flow0_3["4. ◆ Generate<br/>answer from those facts"]
  rag_flow0_0 --> rag_flow0_1 --> rag_flow0_2 --> rag_flow0_3
```

*Retrieval puts the right facts in the window before the model answers.*

> **Key idea:** RAG adds retrieved facts to the context so answers come from your data, not training.

Plain RAG has three steps:

1. **Retrieve.** Find the pieces of data most relevant to the question, usually by embedding text into vectors and running a similarity search.
2. **Augment.** Put those pieces into the model's context with the question.
3. **Generate.** The model answers from the retrieved facts instead of its training data.

RAG is excellent for "find the passage that answers this". It struggles when the answer depends on **connections** between facts spread across many documents. For example: *which accounts engaged with content from two campaigns and also lack SMS consent?* Similarity search finds similar text; it doesn't join facts.

In this demo, tool calls are a form of retrieval: the Salesforce agents and the graph tools fetch facts at answer time.

**Learn more**

- Paper: [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)

### 2.2 GraphRAG

*Retrieve connected facts from a knowledge graph and return the paths as evidence.*

**Diagram: An evidence path in the knowledge graph**

```mermaid
flowchart LR
  campaign(("Fall Loyalty<br/>Campaign"))
  segment(("Fall audience<br/>Segment"))
  persona(("Economic buyer<br/>Persona"))
  account(("Acme Outfitters<br/>Account"))
  consent(("Email marketing<br/>ConsentScope"))
  asset(("Hero email<br/>ContentAsset"))
  campaign ==>|TARGETS| segment
  segment ==>|INCLUDES| persona
  persona ==>|WORKS_AT| account
  persona -.->|HAS_CONSENT| consent
  persona -.->|ENGAGED_WITH| asset
```

*Answering “why is Acme in the fall audience?” means following relationships. The highlighted path is the evidence.*

> **Key idea:** GraphRAG follows relationships, so an answer can join many facts and show the path that proves it.

A **knowledge graph** stores entities (**nodes**, such as a Persona, a Campaign, or a MenuItem) and typed **relationships** between them (`ENGAGED_WITH`, `TARGETS`, `FEATURED`). **GraphRAG** retrieves by traversing those relationships.

There are several common patterns:

- **Curated graph queries** (used here): the model picks from fixed, parameterized queries such as *explain buyer group*. This is predictable, safe, fast, and easy to evaluate.
- **Text-to-Cypher:** the model writes graph queries itself. It's flexible, but riskier and harder to govern.
- **Hybrid vector + graph:** vector search finds entry points, then graph traversal expands to connected context.
- **Community summaries:** Microsoft's GraphRAG clusters the graph into communities and pre-summarizes them to answer global "what are the themes?" questions.

GraphRAG's advantages are **multi-hop reasoning** and **explainability**. Every answer can carry the path that justifies it, which the demo shows in the **Graph evidence** panel.

**Try it**

- Explore the graph (opens the graph view)

**Learn more**

- Paper: [From Local to Global: A Graph RAG Approach (Microsoft Research)](https://arxiv.org/abs/2404.16130)
- Docs: [Microsoft GraphRAG project](https://microsoft.github.io/graphrag/)
- Guide: [What is GraphRAG? (Neo4j)](https://neo4j.com/blog/genai/what-is-graphrag/)
- Docs: [Neo4j GraphRAG for Python](https://neo4j.com/docs/neo4j-graphrag-python/current/)
- Docs: [Graph database concepts (Neo4j)](https://neo4j.com/docs/getting-started/graph-database/)

### 2.3 How this demo does GraphRAG

*Twelve read-only, curated graph tools over Neo4j, each returning evidence paths.*

**Diagram: The nine curated graph tools**

```mermaid
flowchart TB
  graph_tools0_tools["Curated tools<br/>explain_buyer_group: Why is this member in the group?<br/>find_audience_overlap: Who is also targeted elsewhere?<br/>check_consent_coverage: Who lacks consent for a channel?<br/>find_similar_past_pushes: What worked in this weather and daypart?<br/>trace_content_lineage: What was built from this brief?<br/>get_graph_overview: What is in the graph?<br/>plan_account_outreach: Who to contact, on which consented channel?<br/>assess_location_impact: Who is affected near this location?<br/>map_weather_demand: Which dishes and stock will the weather draw on?"]
  graph_tools0_a["◉ Neo4j Aura<br/>Query API · read mode"]
  graph_tools0_b["◌ Local copy<br/>same dataset, in memory"]
  graph_tools0_tools --> graph_tools0_a
  graph_tools0_a <-.->|identical results| graph_tools0_b
```

*Each tool is a fixed, parameterized Cypher query in read mode that returns an answer plus evidence paths.*

> **Key idea:** Nine curated, read-only queries, each returning evidence paths, with a local copy that must match Neo4j exactly.

- **The graph:** a deterministic, fictional dataset of about 2,400 nodes and 20,300 relationships. **Northstar** is the parent brand, with B2B accounts (each with a headquarters country), buying-role personas, campaigns, segments, content, brand rules, and consent scopes. **Coastline Kitchen** is a restaurant brand under Northstar: its locations, menu, and dayparts come from the restaurant system with the same ids. Its campaigns run on the **mobile app** and **email** channels. Each of its 1,500 past push sends and 600 past email sends links to its campaign, its content (push or email), app segment, consent for that channel, location, daypart, weather, and featured menu item, so an email campaign learns from past emails and a push from past pushes. Each location's app segment holds **marketing consent per channel**: separate push, email, and SMS opt-in counts, because consent to one channel isn't consent to another. **Harborstone Wealth** is a wealth-management brand under Northstar: regulated content with its approval records and required disclosures, an embargoed acquisition with its release package, and institutional clients with their holdings, signals, advisors, and contacts.
- **The store:** Neo4j AuraDB, reached over the HTTPS **Query API**, because Workers can't open Bolt connections. Every tool query runs in **read access mode**, so the database itself rejects writes. The only writes are the server's fixed long-term memory statements, which keep to their own dataset.
- **The tools:** `explain_buyer_group`, `find_audience_overlap`, `check_consent_coverage`, `find_similar_past_pushes`, `trace_content_lineage`, `get_graph_overview`, three that power the sales and service use cases (`plan_account_outreach`, `assess_location_impact`, and `map_weather_demand`), and three for financial services (`match_news_to_approved_content`, `prepare_deal_release`, and `build_aum_account_plan`). Each returns an answer plus up to 25 **evidence paths**.
- **Parity:** every tool also has an in-memory implementation over the same dataset. `pnpm kg:parity` proves both return identical results, so local development and evals match production. It also reports tool latency; the median stays under 500 ms.
- **Grounding:** evaluations check that a graph answer names only accounts, people, campaigns, and menu items that appear in what the tools returned.
- **In a flow:** the restaurant push campaign calls `find_similar_past_pushes` to learn what worked before in the same weather and daypart, then passes that to the Salesforce content tool.
- **Graph explorer:** the Graph page's brand filter narrows the canvas to one brand's own nodes: a node counts as a brand's own when it's at least as close to that brand as to any other, walking loaded relationships without crossing through another brand. That's how Coastline Kitchen keeps its campaigns, locations, and shared channels and consent, without pulling in Northstar's B2B accounts through the parent brand.

**A third brand: Lumera Therapeutics.** Seven more node types (Drug, Indication, ClinicalTrial, ClinicalClaim, Hospital, Specialty, PrescriberGroup) and twelve relationship types model pharmaceutical promotion in the same graph. It reuses ContentAsset, Approval, Disclosure, BrandRule and ConsentScope, so the approval and consent checks you saw for Harborstone work the same way. The Graph view has a Lumera group and two guided tours. The Cypher for these tools has not been run against a live Neo4j database here; the fixture backend returns the rows the tests check.

The Graph's brand filter and the header's brand are the same setting: choosing Lumera in either shows only Lumera's nodes and what sits close to it.

Every evidence path an answer used is shown twice: in words under the answer, and, for a claims check, as a card in the workspace with each claim's evidence and the assets that carry it.

**Try it**

- Ask a graph question: “Who should be in the buyer group for Acme Outfitters, and why?”
- Open the graph explorer (opens the graph view)

**In this demo**

- Use cases: Buyer-group recommendation, and Buyer-group outreach around local holidays
- Graph evidence panel under answers; “Knowledge graph · Neo4j” in Sources
- packages/knowledge-graph, apps/edge/src/knowledge-graph

**Learn more**

- Docs: [Cypher manual: introduction](https://neo4j.com/docs/cypher-manual/current/introduction/)
- Docs: [Neo4j Aura Query API](https://neo4j.com/docs/aura/connecting-applications/query-api/)
- Course: [Neo4j GraphAcademy (free courses)](https://graphacademy.neo4j.com/)
- Code: [Official Neo4j MCP server](https://github.com/neo4j/mcp)
- Guide: [Salesforce Agentforce + Neo4j (Neo4j Labs)](https://neo4j.com/labs/genai-ecosystem/genai-frameworks/salesforce-agentforce/)

### Check your understanding

Which question needs GraphRAG rather than plain vector RAG?

1. “Find the paragraph in the brief about the offer.”
2. “Which accounts engaged with two campaigns and lack SMS consent?”
3. “Summarize this email draft.”
4. “Translate the headline into Spanish.”

<details><summary>Answer</summary>

**2. “Which accounts engaged with two campaigns and lack SMS consent?”** It joins facts across accounts, campaigns, engagement, and consent: a multi-hop question. Similarity search finds similar text but can't follow relationships.

</details>

## Part 3: Every concept in the demo

*Every moving part of the workbench* · 20 lessons · 20 min

Each piece of the workbench, how it works, and where to see it.

**You'll be able to**

- Trace one chat turn from the browser to Salesforce and back
- Explain why routing and guards sit around the model
- Know where to look when something goes wrong

### 3.1 The orchestrator agent

*A stateful Cloudflare agent per user that runs each chat turn.*

**Diagram: How a turn travels through the system**

```mermaid
flowchart TB
  subgraph architecture0_tier0["Browser"]
    direction LR
    architecture0_0_0["▢ Workbench<br/>React · streaming chat"]
  end
  subgraph architecture0_tier1["Cloudflare edge"]
    direction LR
    architecture0_1_0["⛨ Worker + Access<br/>identity, routing, assets"]
    architecture0_1_1["◎ Orchestrator<br/>Durable Object per user"]
  end
  subgraph architecture0_tier2["Model and tools"]
    direction LR
    architecture0_2_0["◆ Workers AI<br/>gpt-oss-20b via AI Gateway"]
    architecture0_2_1["☁ Salesforce MCP<br/>agents and Apex"]
    architecture0_2_2["☀ Campaign context<br/>profile · Open-Meteo"]
    architecture0_2_3["⋈ Knowledge graph<br/>Neo4j Aura"]
  end
  subgraph architecture0_tier3["Storage"]
    direction LR
    architecture0_3_0["▤ Agent SQLite<br/>messages, turn history"]
    architecture0_3_1["▤ D1 + R2<br/>confirmations, image drafts"]
  end
  architecture0_tier0 --> architecture0_tier1 --> architecture0_tier2 --> architecture0_tier3
```

*The browser talks to one Worker behind Cloudflare Access; each user's orchestrator reaches the model and three MCP servers.*

> **Key idea:** One stateful agent per user runs each turn as a short tool loop and records every event.

The **orchestrator** is a Cloudflare **Agents SDK** chat agent running in a **Durable Object**: a single-threaded, stateful instance with its own SQLite storage.
- Each user gets their own instance, keyed by a hash of their Access identity and the workspace, so conversations and history are isolated by construction.
- Each turn streams to the browser over a WebSocket, and the stream is **resumable** if the tab reconnects.

A turn runs a **tool loop** of up to 6 steps. On each step the model either calls a tool or writes the answer. Its tools come from four MCP servers, connected per turn: Salesforce, campaign context, the knowledge graph, and external services (public holidays and weather alerts). The orchestrator decides which tools are available on each step (see *Routing*) and records a **turn trace** of every event.

Around the loop, the orchestrator also handles the events the model must not: it prepares confirmed writes and, once you confirm, asks Marketing Cloud's Campaign Creation agent to save the brief or create the campaign, then reads the records back. It checks Salesforce before and after the agent call, so a retry links what an earlier attempt saved instead of saving it twice. When the model refines a saved brief's preview, the orchestrator adds the Brief ID to the request if the model left it out. While a confirmed write runs, it publishes each step as agent state, which the browser receives immediately over the WebSocket, so the progress is live rather than a spinner until the end. For an inventory check, it keeps the forecast, the graph's demand map, and the stock counts as they arrive, computes which items are low, and rebuilds the system prompt for the answer step so the model presents exactly that list. It writes **long-term memory** when a write is read back or you ask it to remember a draft, and it reopens a memory into the workspace when you choose **Reopen**. The Worker's hourly job prunes the 24-hour audit and deletes memory past its 14 days.

**Every tool call passes the gateway.** Before a tool the model chose actually runs, the Worker asks the agentic gateway whether the orchestrator may call `tool:<name>`. The decision, its policy and the caller are recorded, and a denial comes back to the model as a tool error instead of a result. See *The agentic gateway*.

**Is a result usable?** A tool can answer and still have nothing to offer. A Salesforce agent answers in words, so its reply is read for phrases such as "no business units" or "cannot access"; the model is then told the result was empty and not to fill the gap. The workbench's own tools (the knowledge graph, the life-sciences systems, campaign context, external services) return data, and data can quote those words while being a full answer: a claims check that says a claim "is not on the approved label" is evidence. Theirs counts as empty only when it says so, as an error or `found: false`.

**The header's brand and role.** Each chat message carries the brand and role chosen in the header. The server withholds other brands' tools, answers a request about another brand with a note to switch rather than answering from memory, and tells the model the role so it leads with what that person decides. The model is told what each brand sells (Lumera's Cardivance, Glucora and Neurelva; Harborstone's Sweep Account; Coastline's chowder), so a request that names a product is read as its brand's, not as another brand. The brand also decides which claims checks a new draft starts with. The role changes emphasis only; it never changes what Salesforce allows or what needs confirmation.

**In this demo**

- apps/edge/src/orchestrator.ts
- “Behind the scenes · technical trace” at the top of each answer

**Learn more**

- Docs: [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- Docs: [Cloudflare chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)
- Docs: [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- Docs: [AI SDK: introduction](https://ai-sdk.dev/docs/introduction)
- Paper: [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)

### 3.2 The workspace: focus, context, and records

*A per-chat, structured model of the work, built from tool results rather than model text.*

**Diagram: How the workspace is built and used**

```mermaid
flowchart TB
  subgraph workspace0_lane0["Tools"]
    direction LR
    workspace0_0_0["▶ Tool result<br/>weather, graph, Salesforce"]
    workspace0_0_1["▤ Context and records<br/>built by code, any system"]
    workspace0_0_0 --> workspace0_0_1
  end
  subgraph workspace0_lane1["Drafting"]
    direction LR
    workspace0_1_0["◆ Model drafts"]
    workspace0_1_1["✎ Saved from the answer<br/>labeled lines become fields"]
    workspace0_1_2["◎ Focus v1, v2…<br/>every version kept"]
    workspace0_1_0 --> workspace0_1_1 --> workspace0_1_2
  end
  subgraph workspace0_lane2["Writes"]
    direction LR
    workspace0_2_0["☑ Confirm<br/>the version on screen"]
    workspace0_2_1["⛨ Signed write"]
    workspace0_2_2["✓ Record updated"]
    workspace0_2_0 --> workspace0_2_1 --> workspace0_2_2
  end
  workspace0_lane0 ~~~ workspace0_lane1 ~~~ workspace0_lane2
```

*Code turns tool results into context and records; the model drafts into the focus; confirmed writes act on the focus version shown.*

> **Key idea:** Tools fill the workspace, the model drafts into it, and confirmed writes act on exactly what it shows.

Each chat has a **working set**, shown in the Workspace panel and summarized in every prompt. It starts empty with **New chat** and has three parts:

- **Focus:** the draft being built as structured data: a title, labeled fields, a change note, and the context it was built from. A campaign's focus is the **brief** Marketing Cloud's Campaign Creation agent drafted, read field for field from the agent's reply (Key Message, Target Audience, Primary Goal, and so on). Other drafts, such as copy from the Content Builder agent, are read from the answer's labeled parts: a label with its value on the same line ("**Headline:** …"), or a label heading the lines below it ("Body:" then bullets, "Ruled out" then a table, one line per row). A draft written as a two-column table ("| Subject | … |") gives one field per row, and HTML line breaks in it read as line breaks. If the agent returns no brief, the answer is read the same way. When the chat has checked claims, the draft card shows its claims review: every factual sentence approved, or each flagged sentence with why. Each revision becomes a new version, and earlier versions stay viewable. Once saved, the focus shows the brief's campaign preview and then the campaign and flow Salesforce read back.
- **Context:** cards for what tools returned, such as weather, forecasts, weather alerts, public holidays, the Federal Reserve's latest rate decision, store inventory, the inventory risk the workbench computed, the restaurant profile, graph evidence, remembered work recalled from memory, and Salesforce summaries, each with its source and fetch time.
- **Records:** records the chat opened, created, or updated, in any connected system, plus any reopened from memory, which are marked *Remembered* until the chat reads them again. Salesforce is one system and restaurant data is another; any system can join through the same reference: system, object type, and id.

Four properties make it trustworthy:

1. **Deterministic ingestion.** Cards and records come from tool results through code, never from model-written text, so nothing in the workspace is invented.
2. **Open versus available.** Records the connected systems make available are listed separately as a catalog, so the model never acts on a record the chat hasn't opened.
3. **Approvals come to you.** When something needs your approval, an **action card** appears in the chat: saving the brief in Marketing Cloud, then creating its campaign, or requesting a review after a readiness check. Accepting it prepares the confirmation card, with Salesforce's permission check.
4. **Writes act on what you see.** Saving asks the Campaign Creation agent to save exactly the focus version on screen. The confirmation records that version in its request hash, and the Brief, Campaign, and flow appear in Records as Salesforce read them back.

**Life-sciences cards.** The three Lumera tools add working-set cards: a target list, a claims check and a hospital plan, each with the summary line the card shows.

The life-sciences systems add a card per answer, named for the system, so what came from Aprimo, Reltio or Drupal stays visible beside the graph's evidence. A card lists what was found, one row each, with a status label, its ID and the date that matters: every Aprimo asset as usable (with its MLR ID and approval date) or not and why (pending review, expired, failed a check), each claim in the Vault library with its status, each Screendragon job with its stage and due date, and each HCP page as compliant or not.

**The claims check, claim by claim.** A Lumera claims check adds a card with one row per claim, usable first: a verdict label (usable, blocked, no approved content, content needs MLR), the claim, and why it's blocked. Under each claim, its supporting evidence (the trial, its enrollment and result) and every asset that carries it, with its MLR ID and whether it can be used. The answer's own *Graph evidence* lists every path in words.

**Try it**

- Draft an email and watch the workspace fill: “Draft an email campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu”

**In this demo**

- Workspace panel: Focus, Records, and Context
- apps/edge/src/working-set.ts, apps/edge/src/focus.ts
- Issue #46: session working set

**Learn more**

- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Guide: [Writing effective tools for agents (Anthropic)](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)

### 3.3 The model: gpt-oss-20b on Workers AI

*An open-weight reasoning model served at the edge, chosen by evaluation.*

**Diagram: The model and its known quirks**

```mermaid
flowchart TB
  subgraph model_guards0_lane0["Every turn"]
    direction LR
    model_guards0_0_0["◆ gpt-oss-20b<br/>open-weight reasoning model"]
    model_guards0_0_1["⛨ AI Gateway<br/>logs, cost, caching"]
    model_guards0_0_0 --> model_guards0_0_1
  end
  subgraph model_guards0_lane1["Known quirks"]
    direction LR
    model_guards0_1_0["! Tool call in its text"]
    model_guards0_1_1["! Channel markup in names"]
    model_guards0_1_2["✓ Guards repair both"]
    model_guards0_1_0 --> model_guards0_1_1 --> model_guards0_1_2
  end
  model_guards0_lane0 ~~~ model_guards0_lane1
```

*The quirks are predictable, so each one has a targeted guard.*

> **Key idea:** The model was chosen by measuring the whole pipeline, and its known quirks shaped the guards.

The orchestrator runs **gpt-oss-20b**, OpenAI's open-weight reasoning model, on **Cloudflare Workers AI**, routed through **AI Gateway** for logging and cost visibility. The model ID is set in exactly one place: `PROOF_DEFAULTS.orchestratorModel`.

- **Why 20b:** after the routing and reliability fixes, it matched or beat gpt-oss-120b through the pipeline at about 60% of the latency and lower cost (see *Evaluations*).
- **Its quirks** shaped several guards. It sometimes writes a tool call into its reasoning or answer text instead of calling the tool, and leaks its internal "harmony" channel markup into tool names.

**Try it**

- See the model comparison (opens the evaluations view)

**In this demo**

- packages/contracts/src/index.ts (PROOF_DEFAULTS)
- Evaluations view: model comparison
- docs/decisions/ADR-005

**Learn more**

- Docs: [gpt-oss-20b on Workers AI](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)
- Code: [openai/gpt-oss](https://github.com/openai/gpt-oss)
- Guide: [The harmony response format (OpenAI Cookbook)](https://cookbook.openai.com/articles/openai-harmony)
- Docs: [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- Docs: [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)

### 3.4 Tools and the Model Context Protocol (MCP)

*A standard way for agents to discover and call tools, and the three MCP servers here.*

**Diagram: How MCP works**

```mermaid
flowchart TB
  mcp0_0["◎ Orchestrator<br/>MCP client"]
  mcp0_1["☰ tools/list<br/>names, descriptions, schemas"]
  mcp0_2["▶ tools/call<br/>validated JSON arguments"]
  mcp0_3["◧ Result<br/>structured content"]
  mcp0_0 --> mcp0_1 --> mcp0_2 --> mcp0_3
```

```mermaid
flowchart LR
  mcp1_0["☁ Salesforce Hosted MCP<br/>14 governed tools · remote · per-user OAuth"]
  mcp1_1["☀ Campaign context<br/>profile + weather · in-process and HTTP"]
  mcp1_2["⋈ Knowledge graph<br/>nine curated queries · in-process and HTTP"]
```

*Clients discover tools with tools/list and run them with tools/call; the transport can be HTTP or in-memory.*

> **Key idea:** MCP lets any agent list and call tools the same way, whether the server is remote or in-process.

**Tool calling** lets a model ask the host to run a function with structured arguments and get the result back. **MCP** standardizes this: a server advertises tools (a name, a description, and a JSON Schema for input), and clients list and call them over a transport such as streamable HTTP.

The demo uses four MCP servers:

| Server | Tools | How it's reached |
|---|---|---|
| **Salesforce Hosted MCP** | 14 governed tools backed by Agentforce agents and Apex actions | Remote, with per-user OAuth |
| **Campaign context** | Restaurant profile and store inventory (both mocked), and live weather and forecasts (Open-Meteo) | In-process; also at `/mcp/campaign-context` |
| **External services** | Public holidays (Nager.Date) and weather alerts (National Weather Service), both free public APIs | In-process |
| **Knowledge graph** | Nine curated Neo4j queries, plus three memory recall tools in chat | In-process; also at `/mcp/knowledge-graph` |

A tool's inputs are typed, and a model doesn't always type them exactly: the life-sciences tools take a drug's name ("Cardivance") as well as its ID, and a channel or status in any case. The model still sees the strict list of values; only an input that matches nothing is rejected.

The local servers are called **in-process** through an in-memory MCP transport. The orchestrator uses the real protocol without a network hop, and external MCP clients can still reach the same servers over HTTP, behind Cloudflare Access.

**Life-sciences systems (mocked).** A pharmaceutical company's marketing runs on more than Salesforce, so a fourth in-process MCP server, `northstar-life-sciences`, answers for the systems around it. Each tool is read-only, and each answers from the same fictional drugs, claims, MLR approvals and hospitals as the knowledge graph, so one system can be checked against another. None is a live connection:
- **Aprimo** (digital assets and MLR workflow): `aprimo_search_approved_assets` lists a drug's assets with their MLR approval, expiry and whether each is usable now; `aprimo_get_mlr_review` shows the medical, legal and regulatory stages and why one is pending.
- **Reltio** (master data): `reltio_resolve_organization` returns a hospital's golden record, hierarchy, merged sources and possible duplicates.
- **Veeva Vault PromoMats** (claims library and label): `vault_list_approved_claims` and `vault_get_prescribing_information`.
- **Screendragon** (work management): `screendragon_list_jobs` and `screendragon_get_job`, with the MLR approval each job is waiting on.
- **IQVIA** (prescription data, invented): `iqvia_get_prescribing_trends`.
- **Salesforce Life Sciences Cloud**: `lsc_get_call_plan` for a hospital's field plan, as counts of prescribers.
- **Drupal** (the HCP website): `drupal_list_hcp_site_content` flags a page that is live with an expired approval.

Ask one question across them (for example whether a drug's materials are consistent across Aprimo, the claims library and the website) and the orchestrator calls three and points out where they disagree.

**In this demo**

- Sources list in the left rail
- apps/edge/src/campaign-context, apps/edge/src/knowledge-graph
- salesforce/…/mcpServerDefinitions

**Learn more**

- Docs: [Model Context Protocol: introduction](https://modelcontextprotocol.io/docs/getting-started/intro)
- Spec: [MCP specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18)
- Docs: [MCP on Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/)
- Guide: [Writing effective tools for agents (Anthropic)](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Docs: [AI SDK: tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

### 3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions

*Salesforce is the system of record, and every Salesforce fact comes from its tools.*

**Diagram: Reads and writes in Salesforce**

```mermaid
flowchart TB
  subgraph salesforce0_lane0["Read"]
    direction LR
    salesforce0_0_0["◎ Orchestrator"]
    salesforce0_0_1["☁ Hosted MCP tool"]
    salesforce0_0_2["◆ Agentforce agent<br/>Agent Script"]
    salesforce0_0_3["✓ Grounded answer"]
    salesforce0_0_0 --> salesforce0_0_1 --> salesforce0_0_2 --> salesforce0_0_3
  end
  subgraph salesforce0_lane1["Write"]
    direction LR
    salesforce0_1_0["◎ Draft in focus"]
    salesforce0_1_1["⚿ Permission check<br/>as you"]
    salesforce0_1_2["☑ You confirm"]
    salesforce0_1_3["⚙ Apex, user mode<br/>campaign, brief, message"]
    salesforce0_1_4["✓ Record read-back"]
    salesforce0_1_0 --> salesforce0_1_1 --> salesforce0_1_2 --> salesforce0_1_3 --> salesforce0_1_4
  end
  salesforce0_lane0 ~~~ salesforce0_lane1
```

*Reads go through agents on Hosted MCP. Writes create or update real records through Apex actions, after a permission check and your confirmation.*

> **Key idea:** Salesforce is the system of record: drafts become real campaigns, briefs, and messages there, through Apex actions the model can't call.

Salesforce is **authoritative** for campaign data. The orchestrator never invents Salesforce facts. It calls tools on a **Salesforce Hosted MCP server**:

- **Agent-backed tools.** Each calls an **Agentforce** agent defined as an Agent Script bundle. Under every answer, **Salesforce agents** shows which agent handled each call, its type and template, its subagent, and the actions it ran.
  - **Northstar Campaign Creation** (a Marketing Cloud Next Campaign Creation agent) drafts, saves, and refines briefs and creates campaigns and their flows. See *Marketing Cloud Next*.
  - **Northstar Content Builder** (a Marketing Cloud Next Content Builder agent) drafts copy and content sections with the standard Draft Content and Create Section actions.
  - **Northstar Account Discovery** uses Marketing's account discovery and scoring APIs for signals, engagement, and buyer groups.
  - **Campaign Readiness and Governance** is a custom agent whose Apex actions summarize a campaign and check readiness, consent, and brand rules. These stay custom on purpose: Marketing Cloud Next has no campaign-summary or readiness action, and its standard **Generate Campaign Insights** flow fails in this org until campaigns have sent and gathered engagement data.
- **Briefs and campaigns** are created only by the Campaign Creation agent's standard actions, as Marketing Cloud's own **Brief**, **BriefPlanStep**, **Campaign**, and campaign **flow** records. The workbench has no custom objects or Apex for them.
- **Other writes:** a review task, an image attachment, and an inventory case for a store manager are global **Apex invocable actions** that verify a signed confirmation.
- **Permission check:** `check_write_access` is a read-only Apex action the workbench calls before preparing any write. It runs as the signed-in user and reports each permission it checked.

The model never holds a write tool: only the confirmation flow can call the write tools, and every write runs as you.

Metadata (Apex, fields, the permission set, and the MCP definition) deploys through a gated CI pipeline to one approved proof org.

**Try it**

- Check campaign readiness: “Check the sample campaign readiness and explain every blocker”

**In this demo**

- Use cases: Campaign performance summary, Launch readiness and review request
- “Salesforce agents” under each answer
- salesforce/force-app/main/default/aiAuthoringBundles, salesforce/force-app/main/default/classes
- docs/salesforce-deployment-pipeline.md

**Learn more**

- Docs: [Salesforce Hosted MCP servers reference](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/servers-reference.html)
- Course: [Introduction to Agentforce (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/introduction-to-agentforce)
- Guide: [Salesforce Agentforce](https://www.salesforce.com/agentforce/)

### 3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows

*The workbench asks Salesforce's Campaign Creation agent to create briefs and campaigns, the way the Marketing app does.*

**Diagram: How a campaign is created in Marketing Cloud Next**

```mermaid
flowchart TB
  subgraph marketing_cloud0_lane0["Draft"]
    direction LR
    marketing_cloud0_0_0["? Your request + context"]
    marketing_cloud0_0_1["◆ Draft a Campaign Brief<br/>Campaign Creation agent"]
    marketing_cloud0_0_2["✎ Brief in the focus<br/>nothing saved"]
    marketing_cloud0_0_0 --> marketing_cloud0_0_1 --> marketing_cloud0_0_2
  end
  subgraph marketing_cloud0_lane1["Save brief"]
    direction LR
    marketing_cloud0_1_0["✓ You confirm<br/>permission check first"]
    marketing_cloud0_1_1["◇ Save Brief → Draft Preview<br/>Brief + BriefPlanSteps"]
    marketing_cloud0_1_0 --> marketing_cloud0_1_1
  end
  subgraph marketing_cloud0_lane2["Create campaign"]
    direction LR
    marketing_cloud0_2_0["✓ You confirm"]
    marketing_cloud0_2_1["◇ Create → Save Campaign<br/>Campaign + draft flow"]
    marketing_cloud0_2_2["→ Activate in Marketing Cloud<br/>never from the workbench"]
    marketing_cloud0_2_0 --> marketing_cloud0_2_1 --> marketing_cloud0_2_2
  end
  marketing_cloud0_lane0 ~~~ marketing_cloud0_lane1 ~~~ marketing_cloud0_lane2
```

*Every record is created by the Campaign Creation agent's standard actions, after you confirm; the workbench reads each one back.*

> **Key idea:** Salesforce's Campaign Creation agent creates the brief, the campaign, and its flow; the workbench asks it to, after you confirm, and reads the result back.

In **Marketing Cloud Next**, a campaign starts as a **brief** and becomes a **campaign with a flow**. Salesforce's **Campaign Creation agent** does that work with standard actions, and the workbench asks it to rather than writing records itself.

**The agent.** `Northstar_Campaign_Creation` is an Agent Script agent built from Salesforce's `MktCloud__CampaignCreationAgent` template and published as a Campaign Creation agent. Only Agent Script agents can be exposed as Hosted MCP tools, so the workbench reaches it through the `NorthstarMarketingWorkbench` MCP server. Its **Marketing Campaigns** subagent runs the standard actions in Salesforce's required order:

| Step | Standard action | What it does |
|---|---|---|
| 1 | Draft a Campaign Brief (`MktCloud__GenerateBrief`) | Drafts name, description, key message, audience, goal, CTAs, KPI, guardrails, and priority. Saves nothing. |
| 2 | Save Campaign Brief (`saveBrief`) | Creates the **Brief** record. |
| 3 | Draft a Campaign Preview (`MktCloud__GenerateCampaignFromBrief`) | Plans the messages as **BriefPlanStep** records on the brief: channel, wait, subject, preheader, and body. |
| 4 | Create Campaign (`createCampaign`) | Creates the **Campaign**, linked to the brief. |
| 5 | Save Campaign (`MktCloud__SaveCampaign`) | Builds the campaign's **flow** from the preview, as a draft. |

Its **Campaign Refinement** subagent runs **Refine Campaign Preview** to change a saved preview ("make the second email shorter").

**How the workbench uses it.**
1. A campaign request (the Coastline plan, or "create a campaign in Marketing Cloud") ends with `draft_campaign_brief`. The agent's brief becomes the workspace focus, field for field.
2. **Save brief** (an action card, then a confirmation card): `save_marketing_brief` asks the agent to run steps 2 and 3.
3. **Create the campaign** (a second card): `create_marketing_campaign` asks it to run steps 4 and 5.
4. After each write, `get_marketing_records` (read-only Apex) reads the Brief, its steps, the Campaign, and the flow back from Salesforce. The workspace shows only what Salesforce returned, never the agent's say-so.

**What stays in Marketing Cloud.** The flow is created as a draft. Choosing its audience and sender, and activating it, happen in Marketing Cloud; the workbench never sends or activates anything. Previews in this org plan email (and SMS) steps: a push request is recorded in the brief's guardrails.

**Safe to retry.** Marketing Cloud's save actions aren't idempotent, so the workbench checks Salesforce before asking the agent. If this exact save was sent before and never confirmed (say, it timed out after the agent saved), and Salesforce now shows that brief, the workbench links it instead of saving again; a brief with the same name from another chat is left alone. A brief that already has its campaign never gets a second one. If the agent call fails, it checks once more, since the agent may have saved before the timeout. Only when nothing is there does it ask you to try again.

**The server fills in what the agent needs.** When you change a saved brief, the workbench adds the Brief ID to the Refine Campaign Preview request if the model left it out. The model forgot it in half of the live evaluation runs, and the agent would otherwise have to guess which brief you meant.

**Each call is one request.** Hosted MCP agent tools take a single message, so each call carries everything the agent needs: the confirmed brief fields, or the Brief ID whose preview was confirmed. The agent is asked to include the record ids in its reply, and the read-back verifies them.

**Try it**

- Draft the Coastline Kitchen email: “Draft an email campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu”
- Create a campaign in Marketing Cloud: “Create a campaign in Marketing Cloud for Coastline Kitchen's late-night tacos”

**In this demo**

- Use cases: Weather-aware campaign in Marketing Cloud
- “Salesforce agents” under each answer, and the confirmation card's agent details
- Workspace focus: Brief saved, campaign preview, Campaign and flow links
- salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Campaign_Creation
- apps/edge/src/marketing-writes.ts

**Learn more**

- Docs: [Agentforce in Marketing Cloud Next (Salesforce Help)](https://help.salesforce.com/s/articleView?id=mktg.mktg_einstein_copilot_in_mc.htm&language=en_US&type=5)
- Course: [Create and customize a marketing campaign with Agentforce (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/ai-in-marketing-cloud-next/create-and-customize-a-marketing-campaign-with-agentforce)
- Docs: [Expose Agentforce agents as Hosted MCP tools (Salesforce Developers)](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/agentforce.html)

### 3.7 Routing: policy router, intent router, and tool plans

*Deterministic decisions before and around the model.*

**Diagram: How a message is routed**

```mermaid
flowchart TB
  subgraph routing0_lane0["Write or forbidden"]
    direction LR
    routing0_0_0["✉ Message"]
    routing0_0_1["⛨ Policy router"]
    routing0_0_2["■ Fixed reply<br/>no model call"]
    routing0_0_0 --> routing0_0_1 --> routing0_0_2
  end
  subgraph routing0_lane1["Clear intent"]
    direction LR
    routing0_1_0["⑂ Intent router"]
    routing0_1_1["▶ Tool plan<br/>one forced tool per step"]
    routing0_1_2["◆ Answer<br/>no tools"]
    routing0_1_0 --> routing0_1_1 --> routing0_1_2
  end
  subgraph routing0_lane2["Unclear"]
    direction LR
    routing0_2_0["◆ Model chooses<br/>from allowed tools"]
    routing0_2_1["✓ Answer"]
    routing0_2_0 --> routing0_2_1
  end
  routing0_lane0 ~~~ routing0_lane1 ~~~ routing0_lane2
```

*Two deterministic routers run before the model. Forced tools come one per step, then the model answers with no tools.*

> **Key idea:** Deterministic routers decide what must never be left to chance; the model handles the rest.

Not every decision should be left to the model. Each turn passes through two deterministic routers:

1. **Policy router.** "Remember this draft" is handled by the server, which stores the focus in long-term memory. A save or create request with a draft in the workspace prepares that write: the server plans it from the draft, Salesforce checks your permissions, and a confirmation card appears. Other save, create, or change requests get a fixed reply pointing to the confirmation flow. Publish, send, delete, and similar requests are refused. A question about what to send ("What can we send clients?") asks for guidance, not an action, and reaches the model; each sentence that names an action is judged on its own, so context before the question ("The Fed moved rates.") doesn't turn it into a request. None of these calls the model, so it can never claim a write happened.
2. **Intent router.** Clear intents force a **tool plan**: an ordered list of tools, one forced per step.
   - "Check readiness" → `check_campaign_readiness`
   - "Why is X in the buyer group?" → `explain_buyer_group`
   - "What did we decide about…?" or "last time…" → `recall_decisions`; "what have we worked on recently?" → `recall_recent_work`
   - Outreach to an account's buyer group → `plan_account_outreach` → `get_public_holidays` for the account's country
   - Weather alerts or storms near a location → `get_weather_alerts` → `assess_location_impact`
   - Inventory, stock, or ingredients at a location → `get_weather_forecast` → `map_weather_demand` → `get_location_inventory`
   - Fed or interest-rate news and approved content → `get_fed_announcements` → `match_news_to_approved_content` for the event it maps to; market volatility → `match_news_to_approved_content` alone
   - An acquisition announcement → `prepare_deal_release`
   - An account plan, AUM, or a Harborstone client's plays → `build_aum_account_plan`
   - A Coastline Kitchen email or push campaign → profile → weather → past sends on that channel → the Campaign Creation agent's brief, which becomes the focus
   - "Create a campaign … in Salesforce" or "in Marketing Cloud" → the Campaign Creation agent's brief, then the save is prepared for confirmation
   - **Checks first, Marketing Cloud last.** Every new draft starts with its brand's claims checks and ends with Marketing Cloud's agents, whatever order the prompt implies: a Lumera campaign runs `check_clinical_claims` → `aprimo_search_approved_assets` → the brief, and a Harborstone one `get_fed_announcements` → `match_news_to_approved_content` → the brief. The model drafts from what the checks allow, lists what it ruled out and why, and only then asks Marketing Cloud for the brief. The header's brand decides the checks; with all brands, the brand the request names does. Coastline has no claims library in chat, so its campaigns start from the restaurant's context. A revision of a brief already in focus goes straight back to the agent
   - A change to a brief ("make it warmer") → back to the agent: a re-drafted brief before it's saved, or **Refine Campaign Preview** after
   - A change to other drafts → no tools; the model rewrites the draft, which is saved as the next version
   - The rules need specific signals and **defer to the model** when unsure, because a wrongly forced tool can't be undone within the turn.

If a planned tool fails, for example because it rejected an argument, the plan offers that same tool once more before moving on. A forced step also keeps the plan's earlier read-only tools callable, so a model taking a second look at the claims check gets an answer instead of failing the turn; the plan moves on only when the step's own tool runs, and Marketing Cloud's agents are never offered before their step. After a plan finishes, the model gets **no tools** and must write the answer.

**Life-sciences routes.** A request about a target list or prescriber groups goes to `build_hcp_target_list`; clinical claims, off-label use, a boxed warning or a Lumera drug beside `claims` go to `check_clinical_claims`; a named hospital with formulary, P&T, access or a plan goes to `plan_hospital_engagement`. The model is told that only supported, on-label, MLR-approved claims can be used and that groups are never people.

**Systems of record.** Naming Aprimo, Reltio, Vault, Screendragon, IQVIA, Life Sciences Cloud, Drupal or an MLR or job ID routes to the matching life-sciences tool; asking whether a Lumera drug's materials are consistent *across* systems plans three at once. If the chosen brand excludes the tool a request needs, the router answers that it is outside the selected brand instead of calling anything.

**Try it**

- See each turn's interpretation (opens the history view)

**In this demo**

- apps/edge/src/turn-policy.ts
- Turn history: “Interpretation” for each turn

**Learn more**

- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)
- Guide: [Writing effective tools for agents (Anthropic)](https://www.anthropic.com/engineering/writing-tools-for-agents)

### 3.8 Reliability guards for tool calling

*How the demo keeps a small model's tool calls on track.*

**Diagram: Tool-call failures and their guards**

```mermaid
flowchart TB
  subgraph reliability0_lane0["Call in text"]
    direction LR
    reliability0_0_0["! JSON in reasoning"]
    reliability0_0_1["✓ Salvage if schema matches"]
    reliability0_0_0 --> reliability0_0_1
  end
  subgraph reliability0_lane1["Bad name"]
    direction LR
    reliability0_1_0["! name<|channel|>…"]
    reliability0_1_1["✓ Repair if one tool matches"]
    reliability0_1_0 --> reliability0_1_1
  end
  subgraph reliability0_lane2["No call"]
    direction LR
    reliability0_2_0["! Nothing usable"]
    reliability0_2_1["↻ Retry once"]
    reliability0_2_0 --> reliability0_2_1
  end
  subgraph reliability0_lane3["Timeouts"]
    direction LR
    reliability0_3_0["! Stalled turn"]
    reliability0_3_1["✓ Explain, don't go silent"]
    reliability0_3_0 --> reliability0_3_1
  end
  reliability0_lane0 ~~~ reliability0_lane1 ~~~ reliability0_lane2 ~~~ reliability0_lane3
```

*The forced-tool middleware sits between the model and the tools.*

> **Key idea:** Small models fail at tool calls in predictable ways, so each failure mode gets a specific guard.

Small reasoning models fail at tool calling in predictable ways. The forced-tool guard, a language-model middleware, handles each one:

- **A tool call written into reasoning or answer text.** The guard recovers the JSON arguments when they match the tool's schema, and hides leaked text from the user.
- **Channel markup or a dropped prefix in tool names**, such as `summarize_campaign<|channel|>analysis`. The guard repairs the name when exactly one real tool matches.
- **Arguments that aren't valid JSON.** The guard escapes raw newlines inside strings and reads `<arg_key>`/`<arg_value>` markup. Arguments cut off mid-call can't be repaired, so they count as no call.
- **No usable call at all.** The step is retried once.
- **A tool call in an answer step,** which offers no tools. The call is dropped; if it was all the step produced, the answer is retried once.
- **Runaway reasoning.** Forced steps are capped at 2,048 tokens. Reasoning counts against the cap, and a detailed request to a Salesforce agent can take several hundred tokens on its own.

At the turn level:
- Structured timeouts cover the whole turn, gaps between chunks, and each tool call.
- Errors and empty answers become an explanatory message instead of a silent failure. When the Campaign Creation agent drafted a brief but the model wrote no reply, the answer is written from the brief's own fields.
- Workers AI capacity errors are explained in plain language.

**In this demo**

- apps/edge/src/forced-tool-middleware.ts
- apps/edge/src/turn-trace.ts
- Technical trace: “Recovery message added”

**Learn more**

- Docs: [AI SDK: tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- Guide: [The harmony response format (OpenAI Cookbook)](https://cookbook.openai.com/articles/openai-harmony)

### 3.9 Governance: permissions, confirmations, and kill switches

*Salesforce decides who may write, a person approves every write, and operators can turn things off.*

**Diagram: How a write is checked and confirmed**

```mermaid
flowchart TB
  governance0_0["1. ✎ Plan<br/>built from your draft"]
  governance0_1["2. ⚿ Permission check<br/>Salesforce, as you"]
  governance0_2["3. ☑ You confirm<br/>exact values, hashed"]
  governance0_3["4. ⛨ Signed write<br/>Apex, user mode"]
  governance0_4["5. ✓ Read-back<br/>created or updated"]
  governance0_0 --> governance0_1 --> governance0_2 --> governance0_3 --> governance0_4
```

```mermaid
flowchart LR
  governance1_0["◆ Model<br/>drafts and proposes; holds no write tools"]
  governance1_1["◎ Workbench<br/>plans, asks Salesforce, hashes, signs"]
  governance1_2["☑ You<br/>review and confirm"]
  governance1_3["☁ Salesforce<br/>owns authorization, verifies, writes, reads back"]
```

*Every write takes the same five steps. Salesforce checks your permissions before the card appears and again when the write runs; operators can also pause writes or tools without a deploy.*

> **Key idea:** Salesforce owns authorization: it checks your permissions before a write is prepared and again when it runs. A person confirms every write.

The workbench can have Marketing Cloud's Campaign Creation agent save a brief and create its campaign and flow, and it can create a review task or attach an image. Every write follows the same flow:

1. **Plan:** the server builds the request from the draft in the workspace, so the values are exactly what you reviewed. A review task or image targets a campaign this chat opened from Salesforce, never one it only reopened from memory.
2. **Permission check:** before anything is prepared, the workbench asks Salesforce, **as you**, whether you may make this write: the workbench permission set, the Marketing User feature for campaigns, create or edit access on each object, field-level security, and edit access to the record for updates. The confirmation card lists every check. If one fails, nothing is prepared and the card says why.
3. **Confirmation:** the card shows what will be created, its values, the draft version, and, for briefs and campaigns, the Marketing Cloud agent and the standard actions it will run. It's bound by a SHA-256 request hash and a 5-minute expiry, and it can be used once.
4. **Execute:**
   - For a **brief or campaign**, the workbench asks the Campaign Creation agent, through its Hosted MCP tool, to run its standard actions. The agent runs as you, so Salesforce enforces your permissions as each action runs.
   - For a **review task, image, or inventory case**, the Worker signs the confirmation with HMAC. Apex verifies the signature, the expiry, the same user, and the hash, then writes in **user mode**. An inventory case's contents come from the Worker, so its request hash is the SHA-256 of exactly those contents, and Apex re-hashes what it receives before writing.
5. **Read-back:** the workbench reads the records back from Salesforce (`get_marketing_records` for Marketing Cloud) and shows only what Salesforce returned. If the agent says it saved something that Salesforce doesn't show, nothing is shown as saved.

You watch both halves step by step. While a confirmation is prepared, the steps are the plan, Salesforce's permission check with how many checks passed, and binding the request to a one-time confirmation. While a confirmed write runs, they're the confirmation check, a look for an earlier attempt or the signing, the call to the agent or the Apex action, the read-back, and the memory record. A failure marks the step where it stopped and says why.

**Chat drafts use approved claims word for word.** When the chat has checked a brand's claims, each draft it saves is reviewed sentence by sentence, the way Journeys checks a module: a sentence that states a fact or asserts what the product does must be an approved claim's exact text. One that rewords an approved claim, restates a blocked one, or asserts something no claim says ("can improve outcomes") is flagged on the draft card with the reason, and saving to Marketing Cloud waits until a revision clears it. Legal text, IDs and logistics (safety information, MLR IDs, send time, audience) aren't checked as claims. The model is given the approved claims' exact text, and the blocked ones, when it drafts.

**Who checks what.** Each layer does one job:

| Layer | Responsible for | Not responsible for |
|---|---|---|
| **The model** | Drafting and proposing saves | Writing anything: it has no write tools |
| **The workbench** | Planning the request from your draft, asking Salesforce for a permission check, hashing, reading back | Deciding who may write, or creating briefs and campaigns itself |
| **The Marketing Cloud agent** | Running Marketing Cloud's standard actions for briefs, previews, campaigns, and flows | Deciding what to save: it saves what you confirmed |
| **You** | Reviewing exact values and confirming | — |
| **Salesforce** | Authorization (profile, permission sets, field-level security, sharing), signature checks for Apex writes, the records, and read-back | — |

**Kill switches** (`WRITES_ENABLED`, `DISABLED_TOOLS`, `MEMORY_ENABLED`) are Worker secrets that operators can flip without a deploy. Graph tools read in read-only mode; only the server's fixed memory statements write, and only to the memory dataset. The external-services tools only read public data (holidays, weather alerts, and Federal Reserve press releases) and send nothing about customers. No customer PII enters prompts, logs, or the graph.

**Agents have a kill switch too.** `DISABLED_AGENTS` switches a registry agent off: the gateway denies everything it tries. Approval is governed separately from writes to Salesforce: an object in the workbench only moves to *approved* through the state machine, by a person. See *Agents, prompts, models, and drift*.

**In this demo**

- Draft something → the Save to Salesforce action card in the chat → confirmation card with the permission check
- Check readiness → the Request a review action card → confirmation card
- Attach to campaign on a generated image
- infra/cloudflare/pot/README.md (operator runbook)

**Learn more**

- Guide: [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)

### 3.10 Structured UI: Markdown, HXL cards, and native fallbacks

*Answers render as rich text, and records render as governed cards.*

**Diagram: How answers render**

```mermaid
flowchart LR
  ui_layers0_0["¶ Markdown<br/>model text · never raw HTML"]
  ui_layers0_1["▦ HXL card<br/>typed Salesforce widget"]
  ui_layers0_2["▣ Native fallback<br/>same contract, accessible"]
  ui_layers0_3["⋈ Graph evidence<br/>paths with text alternatives"]
```

*Every surface has a safe, accessible rendering path.*

> **Key idea:** Model text renders as safe Markdown; records render as typed cards with accessible fallbacks.

- **Markdown answers.** The model may use concise Markdown. The UI renders it with `react-markdown`, which never renders raw HTML, so model output can't inject markup.
- **HXL cards.** Salesforce's HXL widgets (MCP Apps) let an agent action return a typed, interactive card, such as campaign readiness. When a host can't render HXL, the workbench shows an equivalent accessible **native fallback** built from the same contract.
- **Salesforce agents panel.** Under each answer that called Salesforce, a panel lists each call's agent, its type and template, the subagent, and the actions (with their flow or Apex targets) behind it. The confirmation card shows the same for the write it prepares.
- **Graph evidence panel.** Knowledge-graph paths render as directional chains, each with a text alternative for screen readers. The workspace shows a claims check claim by claim; see *The workspace*.
- **Item rows on native cards.** A card whose tool returned a list shows one row per item: a colored status label (usable, waiting, blocked), the item, a monospaced ID and a readable date, so an MLR ID and its expiry stand out. A row can list what stands behind it, such as a claim's trial evidence and the assets that carry it.
- **Live write progress.** Accepting an action card switches its button to **Preparing…** and shows the preparation's steps until the confirmation card appears. Clicking **Confirm** disables the buttons and shows the write's steps in the card as the Worker reports them, kept in view while they run. Afterwards a collapsible **Behind the scenes** record keeps each step and how long it took; it opens by itself when a write fails.
- **Inventory case confirmation.** The card lists the store manager, the forecast, and a table of each low item: on hand, needed, and the dishes it goes into. After you confirm, a banner links to the Case.
- **Use-case library.** A page of every scenario the demo runs, filterable by team, with its prompts, systems, and data flow. **Try it** puts a prompt in the chat box without sending it.
- **Accessibility.** The UI targets WCAG 2.2 AA and is tested in Chrome and Edge.

**Architecture workspaces.** The **Architecture** view is built differently from the chat: each tab is a *workspace manifest* (the roles, objects, tiles, agents and services it composes) drawn by one renderer, so a new workspace is data rather than a new screen. The same approval card also renders as an Adaptive Card, as data for a Lightning Web Component, and as an MCP Apps resource. See *Governed objects and workspaces*.

**One scope in the header.** The **Brand** and **Run as** selectors apply everywhere: the chat (the message box suggests a prompt for the brand), the Graph (its brand filter), the use-case library, the Architecture workspaces and the turn history. The choice is remembered in the browser.

**In this demo**

- Workspace panel (readiness card with native fallback)
- apps/web/src/Markdown.tsx, apps/web/src/GraphEvidence.tsx

**Learn more**

- Docs: [HXL widgets for Agentforce action output](https://developer.salesforce.com/docs/platform/hxl/guide/agentforce-action-output.html)
- Code: [react-markdown](https://github.com/remarkjs/react-markdown)
- Guide: [WCAG overview (W3C)](https://www.w3.org/WAI/standards-guidelines/wcag/)

### 3.11 Observability: technical trace, turn history, and audit export

*See exactly what happened in every turn.*

**Diagram: Three ways to see what happened**

```mermaid
flowchart LR
  observability0_0["≋ Technical trace<br/>under each answer<br/>• reasoning start / end<br/>• tool input / output<br/>• timings and tokens"]
  observability0_1["▤ Turn history<br/>History view · 24 hours<br/>• interpretation<br/>• tool calls<br/>• outcome"]
  observability0_2["⇩ Audit export<br/>JSON download<br/>• confirmed writes<br/>• turn summaries"]
```

*Engineers read the trace; reviewers read history; auditors export it.*

> **Key idea:** Every turn leaves a trace for engineers and a history for reviewers.

- **Live tool calls** under the trace while an answer streams: each call names its system and tool, with a spinner until its result comes back, then a check or a cross.
- **Technical trace** at the top of each answer, so the answer streaming in below doesn't move it: every lifecycle event in order, with timing.
  - turn start, step start and finish (finish reason, token counts)
  - reasoning start and end, with the model's reasoning, redacted
  - text start and end
  - tool input and output, with the Salesforce agent, subagent, and actions behind each Salesforce tool; errors; recovery messages; and the outcome, including when the answer was written from a tool's result because the model wrote none
  - a failed or empty tool result names the system that answered (Aprimo, the knowledge graph, Salesforce), and says whether the call failed or returned nothing usable
  - the closing line gives the turn's total time with its **tokens** (input plus output, summed over the steps) and **tool calls**
- **Workers Logs** for operators: a Salesforce or agent call that failed is logged with its error and stack, even when the user sees a friendly message. A write or confirmation that failed logs the step where it stopped. Request content is never logged.
- **Turn history** (Chat → History → Turns): each utterance with the orchestrator's interpretation, the tool calls with inputs and results, and the outcome. Each row shows the turn's seconds beside its tokens and tool calls. Filterable, and kept 24 hours per user.
- **Memory** (History → Memory): what the workspace remembers across chats, with provenance, and **Reopen** and **Forget** buttons. The audit export lists each reopen. See *Long-term memory*.
- **Audit export:** a JSON download of the user's confirmed writes, memory remembers and forgets, and turn summaries.

History shows the brand and role each turn ran under.

**Try it**

- Open turn history (opens the history view)

**In this demo**

- Any answer → “Behind the scenes · technical trace”
- Chat → History → Export audit (JSON)
- Chat → History → Memory

**Learn more**

- Docs: [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### 3.12 Evaluations

*Measure the whole pipeline across models, and publish the real results.*

**Diagram: What the evaluations measure**

```mermaid
flowchart LR
  evaluations0_0["▶ Demo scenarios<br/>Use-case prompts, full pipeline"]
  evaluations0_1["⑂ Pipeline routing<br/>20 prompts, as evaluators see them"]
  evaluations0_2["◆ Model-only routing<br/>no routers: raw model skill"]
```

```mermaid
flowchart LR
  subgraph evaluations1_chips["Scores"]
    direction LR
    evaluations1_0["✓ Right tool or plan"]
    evaluations1_1["✓ Answered"]
    evaluations1_2["✓ No tool errors"]
    evaluations1_3["✓ No false write claims"]
  end
```

*Three suites run the production pipeline; every turn is scored on four checks.*

> **Key idea:** Evaluate the real pipeline, not just the model, and keep held-out prompts to catch overfitting.

`pnpm eval:live` runs the **production pipeline**: policy router, intent router, prompt, guards, and step settings, against live Workers AI models. Three suites:

- **Demo scenarios:** the use-case library's prompts, through the full pipeline.
- **Routing through the pipeline:** 28 prompts, including memory recall and the financial services use cases, as evaluators experience them.
- **Routing by the model alone:** the same prompts with no routers, isolating model quality.

Each turn is scored on:
- **right tool** (or the right plan in order)
- **answered**
- **no tool errors**
- **no false write claims**
- **graph-grounded:** a graph or memory answer names only accounts, clients, people, campaigns, content, menu items, and compliance approval IDs that its tools returned
- **agent request grounded:** a request to the Marketing Cloud Campaign Creation agent carries what the turn gathered. A brief request names the brand, a menu item, and the city or weather; a preview refinement names the saved Brief ID. It's scored on the request the agent actually receives.

Latency and tokens are recorded too, and the Evaluations view shows each turn's seconds with its tokens and tool calls, plus the mean tokens and tool calls per turn for each model. Runs recorded before the grounding check show no rate for it.

**What good looks like.** Pass/fail says the pipeline behaved; it doesn't say the answer was *good*. Each demo scenario has a written **rubric** in `packages/evals/src/rubric.ts`: a goal, an audience persona where a customer is involved, deterministic **criteria** (for the weather-aware Coastline campaign: names a menu item, uses the real weather and time of day, cites what worked before, a key message of 160 characters or fewer, a measurable KPI), and weights saying which quality dimensions matter. Criteria are reported as "criteria met" beside the pass gate, so pass rates stay comparable with earlier runs.

**Quantifying the qualitative.** A panel of two strong models from different families (GLM-5.3 and DeepSeek V4 Pro; a model never judges its own family) rates each answer 1 to 5 on anchored scales: context fidelity, accuracy, clarity, brand voice, engagement, marketer usefulness, and **would act**. For "would act" the judge answers as the audience persona on a standard purchase-intent scale, and the report shows the share of ratings that are 4 or 5 (the top-2-box). Ratings combine into a 0 to 100 **Quality Index** with a 95% bootstrap interval, and the report shows how often the two judges agree. Before a run is published, `pnpm eval:calibrate` has each judge score hand-written strong, mediocre, and weak answers and requires the right ordering. These are judge scores, not customer behavior: use them to rank models, not to forecast click rates.

**A fixed stand-in for the Marketing Cloud agent.** The real agent's copy doesn't depend on the orchestrator model, so every contestant would get the same canned text. In the run, one fixed reference model plays the agent, so what differs is what the orchestrator asked for (weather, time, menu, past results) and how it presents the result.

**Cost.** Every turn, judge call, and simulated-agent call is priced from Cloudflare's published Workers AI per-million-token rates (neurons are derived at $0.011 per 1,000). The run prints a projection first and refuses to start above `--max-usd`; the report shows cost per turn, cost per passing turn, and a cost-versus-quality chart. The default run compares gpt-oss-120b and gpt-oss-20b; the expensive frontier models (Kimi K2.6, GLM-5.3, DeepSeek V4 Pro) are opt-in with `--tier frontier`. GLM-4.7-Flash and Llama 4 Scout, which scored low, are no longer run (ADR-011); the published report still shows their earlier turns. Cloudflare limits paid frontier models to 20 requests a minute per model, so the runner throttles every call (turns, judges, simulator) per model, serves contestant turns before judge calls, and refreshes its sign-in token during long runs.

`pnpm eval` runs the routing set through the production policy and intent routers without a model, on every verify. Read-style Salesforce tools are fixtures in the live run, so the scores measure orchestration, not Salesforce agent quality. A held-out set of paraphrases guards the router against overfitting. The first published run found a real routing bug: any prompt mentioning "campaign" forced the summary tool.

**Life-sciences scenarios.** The demo scenarios include three for Lumera Therapeutics (a target list, a claims check, a hospital plan). Their rubrics check that the answer cites the trial and MLR approval IDs the tools returned, blocks unsupported and off-label claims instead of rewording them, and names groups rather than clinicians.

A fourth Lumera scenario compares one drug's materials across Aprimo, the claims library and the HCP website, and its rubric checks that it names the systems, flags the page that is live with an expired approval, and says the systems are mocked.

**Try it**

- Open evaluations (opens the evaluations view)

**In this demo**

- Evaluations view
- scripts/run-live-evals.mjs, packages/evals

**Learn more**

- Guide: [Your AI product needs evals (Hamel Husain)](https://hamel.dev/blog/posts/evals/)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)

### 3.13 Campaign image workflow

*Generate reviewable variants, then attach one to Salesforce after confirmation.*

**Diagram: From concept to Salesforce file**

```mermaid
flowchart TB
  images0_0["✎ Concept<br/>PII and injection checks"]
  images0_1["◆ FLUX.2 klein<br/>1024 × 1024 draft"]
  images0_2["▤ R2 draft<br/>private, 7 days"]
  images0_3["☑ Confirm attach"]
  images0_4["✓ Campaign file<br/>hash checked by Apex"]
  images0_0 --> images0_1 --> images0_2 --> images0_3 --> images0_4
```

*Drafts stay private until a person confirms; Salesforce verifies the file hash.*

> **Key idea:** Generated images stay private drafts until a person confirms, and Salesforce verifies the file's hash.

**FLUX.2 klein** on Workers AI generates a 1024×1024 draft from a bounded prompt, with PII and injection checks on the concept.
- Drafts are stored privately in **R2** for 7 days, with provenance (model, prompt version, content hash) in **D1**.
- The variant gallery lets you select, reject, or revise.
- **Attach to campaign** runs the confirmation flow. Apex checks the PNG's SHA-256 against the confirmed hash, creates one Salesforce file on the Campaign, and reads back its checksum and link.

**In this demo**

- Workspace → Generate campaign visual (expand it) → Attach to campaign

**Learn more**

- Docs: [FLUX.2 klein 4B on Workers AI](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/)
- Docs: [Cloudflare R2](https://developers.cloudflare.com/r2/)
- Docs: [Cloudflare D1](https://developers.cloudflare.com/d1/)

### 3.14 Campaign context: restaurant data and live weather

*External context that makes a campaign draft specific to the moment.*

**Diagram: The Coastline campaign tool plan**

```mermaid
flowchart TB
  push_plan0_0["1. ☰ Restaurant profile<br/>menu, favorites, voice"]
  push_plan0_1["2. ☀ Current weather<br/>Open-Meteo, live"]
  push_plan0_2["3. ⋈ Past pushes<br/>knowledge graph"]
  push_plan0_3["4. ☁ Content draft<br/>Salesforce agent"]
  push_plan0_4["5. ◎ Workspace focus<br/>saved as version 1"]
  push_plan0_0 --> push_plan0_1 --> push_plan0_2 --> push_plan0_3 --> push_plan0_4
```

*Four forced tools in order: context, past results, then the content draft. The model presents the draft, and the workspace saves it as the focus.*

> **Key idea:** Outside context (menu, weather, past results) turns a generic draft into one that fits this moment.

The **campaign-context** MCP server gives the orchestrator facts Salesforce doesn't have:

- `get_restaurant_profile`: the restaurant system's own data for **Coastline Kitchen**, a fictional fast-casual brand under Northstar that is open 24/7: its five California locations, menu, favorites, dayparts, app audience with opt-ins **by channel** (push, email, SMS), brand voice, and promotion rules. Locations and menu items carry the same ids as their knowledge-graph nodes.
- `get_current_weather`: live conditions from **Open-Meteo**, which is free, keyless, and CC BY 4.0, for a California city.
- `get_weather_forecast`: Open-Meteo's daily forecast, with each day's demand-planning weather (heat, rain, fog, cloudy, or clear).
- `get_location_inventory`: a restaurant's stock from a randomized **store inventory** mock, with par levels and typical daily use from the menu's recipes. See *The use-case library*.

The Coastline campaign plan (email or push) chains these with the knowledge graph's past performance and the Salesforce content tool. The plan is **channel-aware**: the channel you ask for (or the draft's channel) is pinned on the past-performance lookup by the server, so an email campaign cites email opt-ins, never push opt-ins, whatever the model passed. The finished draft is saved to the workspace **focus**. The draft fits the menu, the time of day, the weather, and what worked before, and "make it warmer" revises it as a new version.

**Try it**

- Draft the Coastline Kitchen email: “Draft an email campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu”
- Draft the Coastline Kitchen push: “Draft a push notification campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu”

**In this demo**

- Use cases: Weather-aware campaign in Marketing Cloud (the push prompt)
- Sources: Restaurant data, Weather · Open-Meteo

**Learn more**

- Docs: [Open-Meteo API docs](https://open-meteo.com/en/docs)
- Docs: [Model Context Protocol: introduction](https://modelcontextprotocol.io/docs/getting-started/intro)

### 3.15 The use-case library: marketing, sales, service, and financial services

*Every scenario the demo runs, how data flows through it, the ones that reach beyond marketing, and three for a regulated industry.*

**Diagram: Sales and service use cases**

```mermaid
flowchart TB
  subgraph use_cases0_lane0["Sales"]
    direction LR
    use_cases0_0_0["? Account + time frame"]
    use_cases0_0_1["⋈ plan_account_outreach<br/>contacts · consent · country"]
    use_cases0_0_2["↗ Nager.Date<br/>public holidays"]
    use_cases0_0_3["✎ Dated outreach plan<br/>consented channels only"]
    use_cases0_0_0 --> use_cases0_0_1 --> use_cases0_0_2 --> use_cases0_0_3
  end
  subgraph use_cases0_lane1["Service"]
    direction LR
    use_cases0_1_0["? Location + concern"]
    use_cases0_1_1["↗ National Weather Service<br/>active alerts"]
    use_cases0_1_2["⋈ assess_location_impact<br/>audience · push reach · campaigns"]
    use_cases0_1_3["✎ Impact + drafted notice<br/>aggregate only"]
    use_cases0_1_0 --> use_cases0_1_1 --> use_cases0_1_2 --> use_cases0_1_3
  end
  subgraph use_cases0_lane2["Inventory"]
    direction LR
    use_cases0_2_0["↗ Open-Meteo forecast<br/>heat, rain, …"]
    use_cases0_2_1["⋈ map_weather_demand<br/>dishes · stock · manager"]
    use_cases0_2_2["▤ Store inventory<br/>randomized mock"]
    use_cases0_2_3["✎ Case for the manager<br/>after you confirm"]
    use_cases0_2_0 --> use_cases0_2_1 --> use_cases0_2_2 --> use_cases0_2_3
  end
  use_cases0_lane0 ~~~ use_cases0_lane1 ~~~ use_cases0_lane2
```

*A live outside service says what's happening; the knowledge graph says who or what it affects, and a confirmed write goes to Salesforce only when you approve it.*

> **Key idea:** Each use case pairs a live outside service with the graph: the service says what's happening, and the graph says who or what it affects: people and how to reach them, or dishes and the stock they draw on.

**Use cases** (a button on the Chat page) lists every scenario the demo can run end to end. Each has the situation it's for, the prompts that drive it (with a **Try it** button), the systems involved, a step-by-step data flow, what the knowledge graph contributes, what it writes, and what to watch for. Drafted scenarios that aren't built yet are shown greyed out as *Coming soon*.

Two use cases take the same pattern beyond marketing. Each pairs a new free public API with the knowledge graph, and **the graph supplies the key element**.

**Sales: buyer-group outreach around local holidays.** "Plan outreach to Acme Outfitters' buyer group for the next month."
1. `plan_account_outreach` walks the graph from the account to its buying-role personas. For each person it returns their engagement, when they last engaged, and **the channels they have marketing consent for**, following Persona → HAS_CONSENT → ConsentScope → FOR → Channel. It also returns the account's headquarters country.
2. `get_public_holidays` asks **Nager.Date** for that country's upcoming public holidays.
3. The answer is a prioritized, dated plan that uses only consented channels and avoids the holidays. Nothing is sent or logged.

**Service: severe-weather customer impact.** "There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?"
1. `get_weather_alerts` asks the **National Weather Service** for active watches, warnings, and advisories at the restaurant's coordinates. If there are none there, it lists alerts elsewhere in California.
2. `assess_location_impact` walks Location ← Segment → consent and Campaign → TARGETS → Segment. It returns how many app users are near the location, how many can be reached on each channel (push, email, SMS) under that channel's own consent, and which active campaigns target them and should be paused. The counts are aggregate; no individual customer is named.
3. The answer is an impact summary, a drafted customer notice, and a note for the store team. Nothing is sent or paused.

Both APIs are free and keyless, called live from the Worker through a new in-process **external services** MCP server. An API failure comes back as a tool error, and the answer says so instead of guessing.

**Service: weather-driven inventory check, with a case for the store manager.** "Check inventory for our Sacramento store against the forecast."
1. `get_weather_forecast` reads the daily **Open-Meteo** forecast and buckets each day for demand planning: **heat** for highs of 88°F or more, **rain** for wet days, otherwise fog, cloudy, or clear.
2. `map_weather_demand` walks WeatherCondition → **LIFTS_DEMAND** → MenuItem → **MADE_WITH** → InventoryItem, plus Location → **MANAGED_BY** → StoreManager. Each lift is learned from past push results: a dish's average order rate under that weather against its overall average, kept when it's at least 15% higher. Heat lifts the cold drinks and açaí bowl; rain and fog lift soup, noodles, and the burrito.
3. `get_location_inventory` reads the restaurant's stock from the **store inventory system**. In this demo it's a randomized mock that's stable within a day: on hand, par level, and typical daily use per item.
4. **Code, not the model, decides what's low.** For each weather-lifted item, the forecast need is typical daily use on each day, raised by the lift on the days whose weather lifts a dish made with it. An item is low when what's on hand won't cover that. The result becomes an **Inventory risk** card and an **action card**, and the answer step is told exactly this list.
5. Accepting the card prepares a **Salesforce case** for the store manager. The case contents are hashed, the hash becomes the confirmation's request hash, and after you confirm, the `create_inventory_case` Apex action re-hashes what it received and refuses anything that doesn't match. It then finds the manager's Contact by title and restaurant, creates the Case as you, and reads it back.

The graph and prompts carry the manager's name only, never contact details. Nothing is ordered.

**Financial services: Harborstone Wealth.** Three use cases (filter **Financial services**) show the graph in a regulated industry, where only content a registered principal approved can go out, exactly as approved, with its required disclosures. Harborstone is a fictional wealth-management brand under Northstar.
- **Market news to pre-approved content.** "The Fed just announced its rate decision. What pre-approved content can we send clients today?"
  1. `get_fed_announcements` reads the Federal Reserve's public press feed, finds the latest FOMC statement, and reads its rate decision: raise, lower, or maintain, the size, and the new target range. It maps the decision to a market event.
  2. `match_news_to_approved_content` walks MarketEvent ← **RESPONDS_TO** ← ContentAsset → **APPROVED_UNDER** → Approval and → **REQUIRES** → Disclosure. It returns what's ready to send, with approval IDs, expiry, and disclosures; what's blocked and exactly why (an expired approval, one still pending, or a **FAILED** compliance rule); reach per channel under marketing consent; and past responses, which show that sending within hours of the news opened far better than the next day.
  3. The answer never writes new regulated copy. Asking for a Marketing Cloud campaign hands the approved asset, its approval ID, and disclosures to the Campaign Creation agent's brief.
- **Acquisition announcement, released on time.** `prepare_deal_release` orders the embargoed package through **RELEASED_WITH** → Deal and checks each piece's audience through **ADDRESSED_TO** → Segment → **HAS_CONSENT**. Advisors get their FAQ first, then the press release, then client letters. The acquired firm's clients get service notices under their client agreement, never marketing, until they opt in, so an SMS that also failed its disclosure check is blocked for both reasons.
- **Account plan to grow assets under management.** `build_aum_account_plan` walks Client → **HAS_SIGNAL** → Signal → **SUGGESTS** → Product for products the client doesn't hold, sizes each play from the estimated assets held elsewhere, counts how many clients of the same type hold it, and finds its approved content through Product ← **EXPLAINS** ← ContentAsset. Each contact comes with the channel that has approved content they consented to, so the 30/60/90-day sequence never sends content on a channel it isn't approved for. "Activate the plan" drafts a Marketing Cloud brief from it.

**Life sciences: Lumera Therapeutics.** A third brand under Northstar shows pharmaceutical promotion, where a claim is only as good as the trial, the label and the MLR approval behind it. Everything is fictional, including the drugs (Cardivance for heart failure, Glucora for type 2 diabetes, Neurelva for chronic migraine), the trials and their results.
- **Targets.** `build_hcp_target_list` ranks hospitals and prescriber groups for a drug by labeled-indication patients × (1 − Lumera's share) × a formulary access weight × decile. A drug that is not on formulary, or is under P&T review, leads with the approved value dossier before any detailing. Groups carry opted-in counts per channel (email, portal, rep visit), never people.
- **Claims.** `check_clinical_claims` walks Drug ← **CLAIMS_ABOUT** ← ClinicalClaim ← **SUPPORTS** ← ClinicalTrial, then compares **INDICATED_FOR** (on the label) with **INVESTIGATED_FOR** (not). Content that **CARRIES** a claim is usable only with a current MLR approval, the safety information, and the boxed warning for Cardivance. The “superior to every ARB” claim has no trial; the HFpEF claim is off label and its trial has no results; an expired approval blocks a supported Glucora claim.
- **Hospitals.** `plan_hospital_engagement` reads a hospital's **ON_FORMULARY** status and days to its P&T review for each drug, the patients at stake, whether the value dossier is usable or still in MLR, and the prescriber groups with their consent and engagement, then orders the next steps.
- **In the Architecture view.** Lumera's claims, evidence, modules and plan run through the same lifecycle as Harborstone's: the authoring agent refuses a claim whose approval is draft or rejected, the farm flags superiority language, and a module can't be approved while its study report has lapsed.

The library follows the header's brand: choosing Lumera Therapeutics shows only its use cases.

**Try it**

- Plan buyer-group outreach: “Plan outreach to Acme Outfitters' buyer group for the next month”
- Assess a weather disruption: “There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?”
- Check inventory against the forecast: “Check inventory for our Sacramento store against the forecast”

**In this demo**

- Chat → Use cases
- Sources: Holidays · Nager.Date, Weather alerts · NWS, Rate news · Federal Reserve
- Workspace: Forecast, Store inventory, and Inventory risk cards, then the case action card
- apps/edge/src/external-services, apps/edge/src/inventory-risk.ts, apps/web/src/usecases

**Learn more**

- Docs: [Nager.Date public holiday API](https://date.nager.at/Api)
- Docs: [National Weather Service API (api.weather.gov)](https://www.weather.gov/documentation/services-web-api)
- Docs: [Open-Meteo API docs](https://open-meteo.com/en/docs)
- Docs: [Federal Reserve press release feeds](https://www.federalreserve.gov/feeds/feeds.htm)
- Docs: [FINRA Rule 2210: communications with the public](https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210)
- Docs: [Model Context Protocol: introduction](https://modelcontextprotocol.io/docs/getting-started/intro)

### 3.16 Governed objects and workspaces

*One identifier per plan, brief, module, claim and result, with governance attached, and screens composed from it.*

**Diagram: Plan to learn, with a person at every gate**

```mermaid
flowchart TB
  subgraph agent_lifecycle0_lane0["People decide"]
    direction LR
    agent_lifecycle0_0_0["? Brand planner<br/>approves the plan"]
    agent_lifecycle0_0_1["? Marketer<br/>validates brief and reuse"]
    agent_lifecycle0_0_2["? Content Lab<br/>approves every module"]
    agent_lifecycle0_0_3["? Compliance<br/>owns the evidence"]
    agent_lifecycle0_0_4["? Reviewer<br/>decides, by state machine"]
    agent_lifecycle0_0_5["? Brand lead<br/>disposes on optimization"]
    agent_lifecycle0_0_0 --> agent_lifecycle0_0_1 --> agent_lifecycle0_0_2 --> agent_lifecycle0_0_3 --> agent_lifecycle0_0_4 --> agent_lifecycle0_0_5
  end
  subgraph agent_lifecycle0_lane1["Agents work"]
    direction LR
    agent_lifecycle0_1_0["▸ Plan and scenario<br/>plan → structured demand"]
    agent_lifecycle0_1_1["▸ Brief and reuse<br/>inherits the plan"]
    agent_lifecycle0_1_2["▸ Module authoring<br/>cites or refuses"]
    agent_lifecycle0_1_3["▸ Substantiation<br/>evidence per claim"]
    agent_lifecycle0_1_4["◆ Readiness and farm<br/>block until it passes"]
    agent_lifecycle0_1_5["▸ Attribution and optimization<br/>signal → module → claim"]
    agent_lifecycle0_1_0 --> agent_lifecycle0_1_1 --> agent_lifecycle0_1_2 --> agent_lifecycle0_1_3 --> agent_lifecycle0_1_4 --> agent_lifecycle0_1_5
  end
  subgraph agent_lifecycle0_lane2["Governed by"]
    direction LR
    agent_lifecycle0_2_0["⋈ Governed objects<br/>one id for life"]
    agent_lifecycle0_2_1["◆ Gateway<br/>default-deny · identity"]
    agent_lifecycle0_2_2["▤ Registry<br/>versioned · scoped"]
    agent_lifecycle0_2_3["◆ State machine<br/>11 transitions"]
    agent_lifecycle0_2_4["✓ Evaluators<br/>13 · drift watch"]
    agent_lifecycle0_2_5["✎ Channels<br/>one card, four surfaces"]
    agent_lifecycle0_2_0 --> agent_lifecycle0_2_1 --> agent_lifecycle0_2_2 --> agent_lifecycle0_2_3 --> agent_lifecycle0_2_4 --> agent_lifecycle0_2_5
  end
  agent_lifecycle0_lane0 ~~~ agent_lifecycle0_lane1 ~~~ agent_lifecycle0_lane2
```

*People decide at each stage, agents do the narrow work, and every call between them passes the gateway. Performance re-enters planning inside the quarter.*

> **Key idea:** Every plan, brief, module, claim and result is one object with an identifier it keeps for life. Governance travels with it, and everything else (lineage, screens, channels) is derived from it, never copied.

Most marketing tools copy things forward: a plan becomes a brief, a brief becomes a module, and each copy has to be reconciled with the last. This demo does the opposite. Every **plan, brief, module, claim, piece of evidence, result, disclosure and gap** is a *governed object*:

- a **urn**, such as `urn:northstar:module:hs-mod-fomc-push`, which it keeps for life
- its **version**, and the version it **supersedes**
- its **brand, market, owner and classification**
- its **approval state**, who created it (a person or an agent), and when

**Nothing is copied forward.** A brief holds only the urn of its plan and the wave it covers. When you open the brief, its audience, channel and timing are read from the plan *at that moment*, so changing the plan changes what the brief shows. Relationships such as `INHERITS`, `CITES`, `SUBSTANTIATED_BY`, `MEASURED_BY`, `VARIANT_OF` and `GAP_FOR` are *derived from the objects' attributes*, so there is no second copy of a relationship to fall out of date.

**The object inspector** shows any object by urn: its attributes, the plan it inherits, its evidence, its lineage in both directions, its version chain, its append-only history, and the next decision open to you. Open it from a Command Center card, a table row, a search result, or a link in an agent's answer.

**Workspaces are manifests.** A workspace says who it is for, which objects it lists, which tiles it composes, and which agents and services it calls. One renderer turns any manifest into a screen, with the same loading, empty, error and permission-denied states. The **Command Center** lists every object by lifecycle stage with the person whose decision it is waiting on; **Brief Builder**, **Module Library**, **Approvals** and **Performance** are other manifests over the same objects. Choose **Run as** in the header to see a brand planner, a marketer, a reviewer or a brand lead's view of the same data. The role opens that person's workspace and is sent with each request, and the server enforces what it may do.

**Each screen explains itself.** The Architecture view opens with a short intro: what you are looking at, why it beats copying claims by hand and reviewing over email, and where your role comes in. It shows the seven steps with the person who decides at each, highlights yours, and offers a button to the workspace where your step happens. Each workspace then opens with a card: what it is, why it is better, where it fits in the flow, something to try for the brand in the header, and the technical idea it demonstrates. The words live in one file, `apps/web/src/architecture/guide.ts`, beside the manifests they describe, so they follow the brand and role just as the data does.

**Journeys.** The **Journeys** view, beside Architecture in the workspace rail, gives a goal for each brand to a real orchestrator, which plans the work and hands each step to a real subagent: a brief from an approved plan, content written from approved claims (and what it refused), red-team probes, the evidence packet, submission, then **your decision** as the reviewer, then what comes next. You watch each subagent work: who it acts for, its model, each tool call and the gateway's decision, and what it made. Nothing is scripted, so runs differ, and a run takes about a minute.

**The asset, as it is built.** Beside the steps, the asset composes itself from what the agents' tool calls return: the channel wrapper (an email with its sender, audience, send date and subject, or a push or SMS on a phone) with each block in place. The library's images sit in place too (the logo, the banner, and an image beside the claims), drawn as placeholders with their alt text and library ID since the library is mocked. Blocks are marked by where their words come from: the agent's own opening and closing, an approved claim the service inserted word for word, or a disclosure a claim requires. Below it, **kept out by the service**: topics refused because no substantiated claim exists (each filed as a gap), and the agent's own wording the service rejected, with the reason it gave. Probe findings and readiness blockers attach to the block they quote. Click any block for who wrote it, the tool call and policy that allowed it, its source claim, and what the checks found. Channel versions from the atomization agent appear as tabs, with each one's character count against the channel's limit. The preview is derived on the page from the flow's events (`apps/web/src/architecture/asset.ts`); nothing extra is fetched.

**Channels.** An approval card is composed once, with brand rules (accent, disclosure label, rule version) applied, and then rendered four ways: React, an **Adaptive Card** for Teams and Outlook, **data for a Lightning Web Component**, and an **MCP Apps** resource for MCP clients such as Claude. Change one brand rule and all four renderings change. The preview renders these payloads on screen; nothing is sent to Teams, Outlook or Copilot.

**Where the data lives.** Seed objects for all three brands ship in code. What you create (a plan, a module, a gap, a new claim version) and every approval state go to D1, scoped to you, and expire with the 24-hour audit. They are not in the Neo4j graph; making them graph nodes is a later step.

The seed has three brands: Harborstone Wealth, Coastline Kitchen and Lumera Therapeutics. The approval card's brand rules for Lumera label its disclosures as safety information.

**Try it**

- Open the Architecture view (opens the architecture view)

**In this demo**

- Architecture → read the intro, then pick a step to jump to its workspace
- Journeys → Start the orchestrator, click blocks in the asset, then approve when it asks
- Architecture → Command Center, then open any card
- Header → Run as: Brand planner, Marketer, Reviewer, Brand lead
- Architecture → open a module → Channels (React, Adaptive Card, LWC data, MCP Apps)
- packages/architecture/src/types.ts, world.ts, workspaces.ts, channels.ts

**Learn more**

- Spec: [MCP Apps specification and SDK](https://github.com/modelcontextprotocol/ext-apps)
- Docs: [Adaptive Cards](https://adaptivecards.io/)
- Docs: [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)

### 3.17 The agentic gateway

*One choke point for every tool call: default-deny policy, a per-call identity, and a record of the decision.*

**Diagram: Plan to learn, with a person at every gate**

```mermaid
flowchart TB
  subgraph agent_lifecycle0_lane0["People decide"]
    direction LR
    agent_lifecycle0_0_0["? Brand planner<br/>approves the plan"]
    agent_lifecycle0_0_1["? Marketer<br/>validates brief and reuse"]
    agent_lifecycle0_0_2["? Content Lab<br/>approves every module"]
    agent_lifecycle0_0_3["? Compliance<br/>owns the evidence"]
    agent_lifecycle0_0_4["? Reviewer<br/>decides, by state machine"]
    agent_lifecycle0_0_5["? Brand lead<br/>disposes on optimization"]
    agent_lifecycle0_0_0 --> agent_lifecycle0_0_1 --> agent_lifecycle0_0_2 --> agent_lifecycle0_0_3 --> agent_lifecycle0_0_4 --> agent_lifecycle0_0_5
  end
  subgraph agent_lifecycle0_lane1["Agents work"]
    direction LR
    agent_lifecycle0_1_0["▸ Plan and scenario<br/>plan → structured demand"]
    agent_lifecycle0_1_1["▸ Brief and reuse<br/>inherits the plan"]
    agent_lifecycle0_1_2["▸ Module authoring<br/>cites or refuses"]
    agent_lifecycle0_1_3["▸ Substantiation<br/>evidence per claim"]
    agent_lifecycle0_1_4["◆ Readiness and farm<br/>block until it passes"]
    agent_lifecycle0_1_5["▸ Attribution and optimization<br/>signal → module → claim"]
    agent_lifecycle0_1_0 --> agent_lifecycle0_1_1 --> agent_lifecycle0_1_2 --> agent_lifecycle0_1_3 --> agent_lifecycle0_1_4 --> agent_lifecycle0_1_5
  end
  subgraph agent_lifecycle0_lane2["Governed by"]
    direction LR
    agent_lifecycle0_2_0["⋈ Governed objects<br/>one id for life"]
    agent_lifecycle0_2_1["◆ Gateway<br/>default-deny · identity"]
    agent_lifecycle0_2_2["▤ Registry<br/>versioned · scoped"]
    agent_lifecycle0_2_3["◆ State machine<br/>11 transitions"]
    agent_lifecycle0_2_4["✓ Evaluators<br/>13 · drift watch"]
    agent_lifecycle0_2_5["✎ Channels<br/>one card, four surfaces"]
    agent_lifecycle0_2_0 --> agent_lifecycle0_2_1 --> agent_lifecycle0_2_2 --> agent_lifecycle0_2_3 --> agent_lifecycle0_2_4 --> agent_lifecycle0_2_5
  end
  agent_lifecycle0_lane0 ~~~ agent_lifecycle0_lane1 ~~~ agent_lifecycle0_lane2
```

*People decide at each stage, agents do the narrow work, and every call between them passes the gateway. Performance re-enters planning inside the quarter.*

> **Key idea:** Nothing acts except through one gateway: default-deny policy, a per-call identity, and a record of the decision. An agent that is denied leaves a trace; it never gets a second route.

A governed system can't have side doors. In this demo **every architecture capability, and every tool the model calls, goes through one gateway**, and the gateway answers three questions before anything runs.

**1. Is this allowed?** Policies are **default-deny**. A call is allowed only if a *permit* matches its caller, its action and the kind of object, and a matching *forbid* always wins, as in the Cedar policy language. Permits are compiled from the **agent registry**: an agent can call only the actions in its entry, on the object kind it is scoped to. Two rules are not configurable:
- **Agents can never hold a decision.** A forbid covers `transition`, `supersede_claim` and `accept_optimization`. An agent may propose; only a person decides.
- **Brand scope.** A call on a brand outside the signed-in user's scope is denied.

The **Agents → Policies** panel shows every policy as Cedar text. The evaluator is a typed equivalent of Cedar written for this demo; the policies are shaped so they can be loaded into a Cedar engine.

**A model's calls get no shortcut.** When an agent runs on a model, the gateway checks the action the run centres on before the model is called, and then each tool the model calls, separately, as that agent. A model that tries a tool outside its grants is denied like any other caller, and the denial goes back to the model as the tool's result. The sample-flow orchestrator is held to the same gate: it is checked before a flow starts or resumes and on every step it takes, and its policy is withheld when an operator disables it or it is retired, so its kill switch stops a flow mid-way.

**2. Who is calling, and for whom?** The gateway mints a **short-lived token for each invocation**, signed, naming the caller (`agent:module-authoring`) and the user it acts for in an `act` claim, the pattern from OAuth token exchange. The service verifies that the token was minted for this action and this user before it runs. There are no shared credentials, and no agent acts as itself.

**3. Was it recorded?** Every decision, allowed or denied, is logged with the policy that decided it, the caller, and a correlation id. The **Trust** view draws the **identity chain** for any call: the user, the surface (role, brand, market), the Worker, the gateway, the agent, and the service. A denied call stops at the gateway and says so.

**The orchestrator is an agent too.** Each tool the model calls is authorized as `tool:<name>`. Existing kill switches still apply, and `DISABLED_AGENTS` switches a whole agent off.

**Partner agents** are registered with a contract, an identity and a policy, and an **Agent Card** in the style of the A2A protocol (see **Agents**). Their prompts stay with their owner; the gateway governs the call, not the thinking.

**The workbench as a channel.** `/mcp/workbench` exposes read tools, search, and `propose_transition` to MCP clients through the same gateway. It has no tool that approves, publishes, sends or deletes.

**What it does not do yet.** Confirmed Salesforce writes keep their own signed-confirmation audit and do not pass the gateway log. The call to the Salesforce MCP portal is authorized as the orchestrator calling that tool, not as a separate hop.

**Brand scope reaches tools.** When a brand is chosen in the header, each tool that belongs to another brand is denied with the `forbid-out-of-scope-brand` rule, and the model is not given those tools in the first place. Tools that every brand uses, such as the graph overview, stay available. The model is also told what each brand sells, so "Cardivance" with Lumera selected is in scope, and "the Sweep Account" is named as Harborstone's when it is not.

**Try it**

- See the swimlane and policies (opens the architecture view)

**In this demo**

- Architecture → Agents → run an action as an agent, then try one it isn't granted
- Architecture → Agents → Policies (Cedar text)
- Architecture → Trust → recent gateway calls and their identity chains
- packages/architecture/src/gateway.ts, apps/edge/src/architecture/context.ts

**Learn more**

- Docs: [Cedar policy language](https://www.cedarpolicy.com/)
- Spec: [RFC 8693: OAuth 2.0 token exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- Spec: [Agent2Agent (A2A) protocol](https://a2a-protocol.org/latest/)
- Docs: [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)

### 3.18 The content lifecycle: plan to learn

*Agents draft, check and measure; people decide at every stage; performance re-enters the plan.*

**Diagram: Plan to learn, with a person at every gate**

```mermaid
flowchart TB
  subgraph agent_lifecycle0_lane0["People decide"]
    direction LR
    agent_lifecycle0_0_0["? Brand planner<br/>approves the plan"]
    agent_lifecycle0_0_1["? Marketer<br/>validates brief and reuse"]
    agent_lifecycle0_0_2["? Content Lab<br/>approves every module"]
    agent_lifecycle0_0_3["? Compliance<br/>owns the evidence"]
    agent_lifecycle0_0_4["? Reviewer<br/>decides, by state machine"]
    agent_lifecycle0_0_5["? Brand lead<br/>disposes on optimization"]
    agent_lifecycle0_0_0 --> agent_lifecycle0_0_1 --> agent_lifecycle0_0_2 --> agent_lifecycle0_0_3 --> agent_lifecycle0_0_4 --> agent_lifecycle0_0_5
  end
  subgraph agent_lifecycle0_lane1["Agents work"]
    direction LR
    agent_lifecycle0_1_0["▸ Plan and scenario<br/>plan → structured demand"]
    agent_lifecycle0_1_1["▸ Brief and reuse<br/>inherits the plan"]
    agent_lifecycle0_1_2["▸ Module authoring<br/>cites or refuses"]
    agent_lifecycle0_1_3["▸ Substantiation<br/>evidence per claim"]
    agent_lifecycle0_1_4["◆ Readiness and farm<br/>block until it passes"]
    agent_lifecycle0_1_5["▸ Attribution and optimization<br/>signal → module → claim"]
    agent_lifecycle0_1_0 --> agent_lifecycle0_1_1 --> agent_lifecycle0_1_2 --> agent_lifecycle0_1_3 --> agent_lifecycle0_1_4 --> agent_lifecycle0_1_5
  end
  subgraph agent_lifecycle0_lane2["Governed by"]
    direction LR
    agent_lifecycle0_2_0["⋈ Governed objects<br/>one id for life"]
    agent_lifecycle0_2_1["◆ Gateway<br/>default-deny · identity"]
    agent_lifecycle0_2_2["▤ Registry<br/>versioned · scoped"]
    agent_lifecycle0_2_3["◆ State machine<br/>11 transitions"]
    agent_lifecycle0_2_4["✓ Evaluators<br/>13 · drift watch"]
    agent_lifecycle0_2_5["✎ Channels<br/>one card, four surfaces"]
    agent_lifecycle0_2_0 --> agent_lifecycle0_2_1 --> agent_lifecycle0_2_2 --> agent_lifecycle0_2_3 --> agent_lifecycle0_2_4 --> agent_lifecycle0_2_5
  end
  agent_lifecycle0_lane0 ~~~ agent_lifecycle0_lane1 ~~~ agent_lifecycle0_lane2
```

*People decide at each stage, agents do the narrow work, and every call between them passes the gateway. Performance re-enters planning inside the quarter.*

> **Key idea:** Agents do the narrow work and people decide. An agent cites an approved claim or refuses, readiness blocks until the evidence holds, and only a person moves an object to approved.

The lifecycle runs **Plan → Audience → Brief → Create → Substantiate → Approve → Deploy & learn**. At each stage a named person owns the decision, and narrow agents do the work.

**Agents are models; the rules live in services.** Each agent below is a model on Workers AI that decides what to ask for and writes its own words: a plan's waves and rationale, a brief's objective, a module's headline and framing, a channel version's headline. What it can *do* is a set of tools, and each tool is a deterministic **service** that enforces the rules whatever the model writes: a claim's exact text is inserted for it and the disclosures it requires are attached. The agent's own words read as an email: a subject line, an opening before the claims (greeting the reader and setting the occasion, such as the meeting and its date) and a closing after them (what to do next, and a sign-off). They may name the product, the occasion and dates. They may not assert anything a claim would have to support: a number, price, outcome, benefit, comparison or reason ("prevents", "well tolerated", "shows", "better", "because"), and each sentence must be complete, so a bare "See" is rejected as a fragment. A sentence that asserts is rejected with the words that did it, so the agent can try again. A topic with no substantiated claim is refused and recorded as a gap even if the model leaves it out.

**Plan and brief.** The *content plan agent* reads the calendar and past results and proposes waves as structured demand: a theme, a segment, a channel, a date, a number of modules, and why. The *scenario agent* estimates what a change does (move a send, drop a channel, change an audience) from the audience size, the channel's baseline click rate, and how the brand's best past send performed, with a lift when a send lands on a market date. The *brief agent* drafts a brief that inherits the plan by reference.

**Reuse and create.** The *reuse agent* ranks existing modules by meaning (a local hashing embedder here; Vectorize would implement the same interface) and by past results, and it flags any that cite a superseded claim. The *module authoring agent* **cites or refuses**: every fact in its module is an approved, substantiated claim or a disclosure the claim requires, and its own words (an opening, a closing, a sign-off) state none. For anything it can't cite, it writes a **gap record** instead of text. **Images come the same way:** the service picks them from the brand's asset library (mocked here: Aprimo for Lumera and Harborstone, Marketing Cloud Content Builder for Coastline) as the logo, a banner matched to the wave's theme, and an image beside the claims. It takes only images that are approved, in usage rights on the send date, and show no claim the module doesn't cite (a chart of a refused claim stays out), and it lists every image it passed over with the reason. The agent doesn't choose them. The *atomization agent* makes channel variants and never shortens a claim; if a claim doesn't fit a channel, it says so. A push keeps the banner only, and a text message carries no image.

**Substantiate.** The *substantiation agent* assembles an evidence packet for each claim a module cites and marks it substantiated, superseded, withdrawn, unapproved, missing evidence, expired evidence or conflicting. *Readiness* blocks until every claim is substantiated and every required disclosure is present. When a claim is **superseded**, every module citing it is flagged for refresh and can't be approved.

**The adversarial farm.** Before a human sees a draft, four probes read it: a claim attacker (uncited facts, reworded claims), an injection prober (instruction-like text in the module, its brief or a cited claim), a brand and disclosure checker (absolute language, an embargoed deal, a missing disclosure), and a consent prober (the channel against the audience's opt-ins). They report findings. They change nothing, and a blocking finding blocks approval. The **data readiness agent** scores each stage's inputs the same way.

**Approve.** Every object moves through one **state machine with eleven transitions**: submit, start review, request changes, resubmit, approve, reject, escalate, a senior's approve or reject, expire, and withdraw. Each has the people who may take it. Reviewers and seniors decide; *expire* is the system's, when evidence lapses; *withdraw* is an admin's or a supersession's. Every move is attributed, timestamped and appended to a history that is never edited. A reason is required to reject, escalate, request changes or withdraw. Agents can only **propose** a ready draft for review.

**Deploy and learn.** The *attribution agent* traces a result to the module and the claim that carried it, with the path to the evidence. The *optimization agent* proposes **re-issue** (well above baseline), **refresh** (well below, or a superseded claim) or **retire** (far below). The brand lead decides. Accepting one revises the brand's plan as a **new version that cites the result**, so what happened last quarter changes what the plan says next.

**Nothing is overwritten.** What an agent writes is named by a short hash of its words, so the same words again are a no-op and different words are a new draft beside the old one; existing content is never replaced, so approved text can't change without a new review, and a superseded claim gets a new version instead. A decision is recorded only if the state really changed, so two reviewers acting at once can't both succeed, and an accepted optimization proposal is spent: it isn't offered again for the same evidence.

**Salesforce stays the system of record.** The lifecycle adds no new Salesforce writes. The state machine's approval is the workbench's own; the confirmed review-task write remains how a decision reaches Salesforce.

**A regulated brand beyond finance.** Lumera Therapeutics' content runs through the same stages. Its claims need a trial-backed study report, the safety information (and a boxed warning for Cardivance) is a required disclosure the authoring agent adds, and the farm treats superiority or absolute-safety wording as a blocking finding.

**Try it**

- Run the lifecycle (opens the architecture view)

**In this demo**

- Architecture → Module Library → Author a module (cite or refuse): pick topics “sweep-apy” and “wire-fees”
- Architecture → Approvals → open a module → Decision, History
- Architecture → open an approved claim as Compliance → Supersede, then Module Library
- Architecture → Performance → Optimization proposals → Accept as Brand lead
- packages/architecture/src/agents.ts, farm.ts, state-machine.ts

**Learn more**

- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)
- Docs: [Model Context Protocol: introduction](https://modelcontextprotocol.io/docs/getting-started/intro)

### 3.19 Agents, prompts, models, and drift

*A registry, a prompt catalog and a model router, scored by thirteen evaluators that watch for drift.*

**Diagram: Plan to learn, with a person at every gate**

```mermaid
flowchart TB
  subgraph agent_lifecycle0_lane0["People decide"]
    direction LR
    agent_lifecycle0_0_0["? Brand planner<br/>approves the plan"]
    agent_lifecycle0_0_1["? Marketer<br/>validates brief and reuse"]
    agent_lifecycle0_0_2["? Content Lab<br/>approves every module"]
    agent_lifecycle0_0_3["? Compliance<br/>owns the evidence"]
    agent_lifecycle0_0_4["? Reviewer<br/>decides, by state machine"]
    agent_lifecycle0_0_5["? Brand lead<br/>disposes on optimization"]
    agent_lifecycle0_0_0 --> agent_lifecycle0_0_1 --> agent_lifecycle0_0_2 --> agent_lifecycle0_0_3 --> agent_lifecycle0_0_4 --> agent_lifecycle0_0_5
  end
  subgraph agent_lifecycle0_lane1["Agents work"]
    direction LR
    agent_lifecycle0_1_0["▸ Plan and scenario<br/>plan → structured demand"]
    agent_lifecycle0_1_1["▸ Brief and reuse<br/>inherits the plan"]
    agent_lifecycle0_1_2["▸ Module authoring<br/>cites or refuses"]
    agent_lifecycle0_1_3["▸ Substantiation<br/>evidence per claim"]
    agent_lifecycle0_1_4["◆ Readiness and farm<br/>block until it passes"]
    agent_lifecycle0_1_5["▸ Attribution and optimization<br/>signal → module → claim"]
    agent_lifecycle0_1_0 --> agent_lifecycle0_1_1 --> agent_lifecycle0_1_2 --> agent_lifecycle0_1_3 --> agent_lifecycle0_1_4 --> agent_lifecycle0_1_5
  end
  subgraph agent_lifecycle0_lane2["Governed by"]
    direction LR
    agent_lifecycle0_2_0["⋈ Governed objects<br/>one id for life"]
    agent_lifecycle0_2_1["◆ Gateway<br/>default-deny · identity"]
    agent_lifecycle0_2_2["▤ Registry<br/>versioned · scoped"]
    agent_lifecycle0_2_3["◆ State machine<br/>11 transitions"]
    agent_lifecycle0_2_4["✓ Evaluators<br/>13 · drift watch"]
    agent_lifecycle0_2_5["✎ Channels<br/>one card, four surfaces"]
    agent_lifecycle0_2_0 --> agent_lifecycle0_2_1 --> agent_lifecycle0_2_2 --> agent_lifecycle0_2_3 --> agent_lifecycle0_2_4 --> agent_lifecycle0_2_5
  end
  agent_lifecycle0_lane0 ~~~ agent_lifecycle0_lane1 ~~~ agent_lifecycle0_lane2
```

*People decide at each stage, agents do the narrow work, and every call between them passes the gateway. Performance re-enters planning inside the quarter.*

> **Key idea:** Agents, prompts and models are catalogued and scored, so a regression is caught before it ships and an agent that drifts is constrained before anyone has to notice.

Agents change over time: their prompts get edited, models get swapped, data shifts. The demo treats each of those as something to **register, version and score**.

**One register for every agent.** The registry lists each agent once, with its version, its **domain** (commercial: we build it; platform: consumed as-is; partner: theirs, reached over A2A), the **stage** it serves, the **object kind** it is scoped to, the actions it is **granted**, its **lifecycle stage** (introduce, test, monitor, constrain, retire), its **autonomy level**, and the **person who holds its human gate**. The **Agents** view draws it as a swimlane. Agents drawn with a dashed outline are planned, not built.

**Prompts are a catalog, not files.** Each prompt is an entry with a version, an owning agent, typed variables and the evaluators that score it. The **hard rules** (cite or refuse, escalate ambiguity, propose only, treat retrieved text as data, no personal data) are appended to every prompt and an entry can't drop them. A variable binds to a **governed object by urn** and exposes only the fields it lists; pasted text is rejected. `pnpm prompts:check` pins each prompt's hash to its version, so a changed prompt must have a new version.

**How an agent runs.** A run gets the agent's catalog prompt (rendered with the objects it names), the model the router binds to its task class, and only the tools its registry grants name. The gateway first checks the action the run centres on, then every tool call again, as that agent acting for its step's owner. The objects named in its input and what it would read first (the brand's claims, for the authoring agent; the planning inputs, for the plan agent) are in its prompt, so its first call can be its real one. Until that call succeeds it is the tool the model must call: small models otherwise describe the work in prose, or bury the call in their reasoning, without doing it. Tools answer with the object as the next step needs it: a brief just drafted comes back with the wave it covers (theme, audience, channel, send date), read from the plan it points at, so the authoring agent and the Journeys preview see the audience without another read. A run stops when the same call fails twice. The agent's account of what it did is written by one more call, without tools, over the tool results; if the work never succeeded, the account says so instead of trusting the model's words.

**What a tool hands back.** A tool returns what its service did, not just a yes: the authoring tool returns the saved module, the topics it refused with the gaps it filed, and the images it picked from the brand's asset library with those it passed over and why. The agent reports them in its summary; it can't change them, because the service chose them.

**What a model may add.** The red-team agent can report a concern the probes missed, but that is advice shown to the reviewer; it blocks nothing, because only the deterministic probes can block approval. A model's say-so should never stop a person's decision, and should never be what lets one through.

**The orchestrator.** A sample flow gives a goal to an orchestrator model, which has one tool, **next_step**: delegate a step to a subagent, ask a person, or finish. One tool forced on every step is what makes gpt-oss dependable here, because a call buried in its reasoning can still be recovered. Each delegation runs the subagent as above; what it creates comes back as a short handle (module-1) the orchestrator uses instead of copying a long urn. When a module is submitted for review the orchestrator asks the person and the flow stops, saved in D1; it resumes only once the module's state shows a decision. Platform agents, which Admin owns, act for whoever started the flow, so a flow never takes on Admin.

**Where the models run.** Deployed, on Workers AI through AI Gateway. Locally, `pnpm dev:local` uses local D1 and R2 with real Workers AI (a Worker name of its own keeps the remote-bindings proxy off the Access-protected domain). The hermetic worker tests select a scripted stand-in with `AGENT_MODEL=scripted`; it calls each agent's real tools, so the gateway, services and persistence are tested, and no deployed environment sets it. `AGENT_CHAMPIONS` can name another catalog model for a task class in one environment.

**Models are routed, not wired.** Agents declare a *task class* (orchestrate, draft, classify, judge, embed, score) and the router binds a model at run time. Each class has a **champion**; a **challenger** is shadowed on a share of turns, never in front of a user, with a daily cost cap. A challenger replaces the champion only by beating it on the same evaluations, and promotion is a pull request. Planning and drafting run on **gpt-oss-120b**, with gpt-oss-20b as their challenger; agents that classify stay on gpt-oss-20b, since the services they call decide (ADR-011). The chat orchestrator stays on `gpt-oss-20b` (ADR-005, ADR-009).

**Thirteen evaluators.** Tool selection, grounding, cite-or-refuse, claim accuracy, disclosure presence, brand rules, personal-data leakage, prompt-injection resistance, policy adherence, write discipline, answer quality (a judge), latency and cost. Every agent run is scored from its own trace. Answer quality is judged by **Clef**, Cloudflare's decision model (the *score* task class): it answers three typed questions about each run (did it do the task, is its summary grounded in the tool results, could a marketer act on it) with probabilities, not prose, and bills input tokens only. Clef gives no reasons and isn't calibrated yet, so its score is shown but not part of drift.

**Drift and staged autonomy.** Each agent has a baseline. When an evaluator's mean over the last twenty runs falls more than 0.15 below baseline (with at least five runs), the agent is moved to **constrain**: it keeps its reads and loses everything else, until a person reviews it. Deterministic evaluators have a baseline of 1; measured ones (latency, cost) use their threshold, since a model's timing varies (a run within 20 seconds scores 1 on latency). Policy adherence counts the gateway's denials only: wording a service sent back for another try was allowed, and retrying it is the agent working. When the gateway refuses a subagent during a flow, the orchestrator is told it is policy and stops delegating to that agent rather than retrying. Content scores (claim accuracy, disclosures, brand rules) count only against content the agent wrote or moved forward, and only factual statements count: an agent's own framing is checked to state none when it is saved. An agent that inspects a flawed module and reports the flaws, such as the readiness agent refusing to submit an email whose evidence has expired, did its job, so those flaws are not its drift. The hourly job runs the same check, and so does the **Run drift watch** button. Evidence also says how much autonomy an agent has *earned*: assistive, then orchestrated at twenty clean runs, then agentically led at a hundred. Raising a level is a pull request, and no level removes the human gate.

**Trust.** The **Trust** view lays out each agentic threat (hallucination, prompt injection, data leakage, unauthorized action, drift, audit gaps) beside its control and the live evidence, such as the grounding mean, the denied calls, the farm's findings and the constrained agents. Where nothing has been measured, it says "no samples yet".

**Try it**

- See evaluations and trust (opens the architecture view)

**In this demo**

- Architecture → Agents (swimlane, lifecycle and autonomy badges)
- Architecture → Prompts & models
- Architecture → Evaluations → Run drift watch and expiry now
- Architecture → Trust
- packages/architecture/src/registry.ts, prompts.ts, models.ts, evaluators.ts, trust.ts
- docs/decisions/ADR-009-model-catalog-and-routing.md

**Learn more**

- Docs: [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- Docs: [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- Guide: [Building effective agents (Anthropic)](https://www.anthropic.com/engineering/building-effective-agents)
- Guide: [Writing effective tools for agents (Anthropic)](https://www.anthropic.com/engineering/writing-tools-for-agents)

### 3.20 Long-term memory: remembering across chats

*Drafts and decisions stored in the graph by the server, recalled by tools, and forgotten on request.*

**Diagram: How long-term memory is written, recalled, and forgotten**

```mermaid
flowchart TB
  subgraph long_term_memory0_lane0["Remember"]
    direction LR
    long_term_memory0_0_0["✓ Confirmed write or “remember this”<br/>read back from Salesforce"]
    long_term_memory0_0_1["⚙ Server writes fixed Cypher<br/>never the model"]
    long_term_memory0_0_2["◇ Draft · Decision nodes<br/>ABOUT campaigns and brands"]
    long_term_memory0_0_0 --> long_term_memory0_0_1 --> long_term_memory0_0_2
  end
  subgraph long_term_memory0_lane1["Recall"]
    direction LR
    long_term_memory0_1_0["? “What did we decide…?”"]
    long_term_memory0_1_1["⌕ recall_decisions<br/>workspace set by the server"]
    long_term_memory0_1_2["✓ Dated, sourced answer<br/>re-check Salesforce before reuse"]
    long_term_memory0_1_0 --> long_term_memory0_1_1 --> long_term_memory0_1_2
  end
  subgraph long_term_memory0_lane2["Forget"]
    direction LR
    long_term_memory0_2_0["× History → Memory → Forget"]
    long_term_memory0_2_1["⏱ Hourly sweep<br/>after 14 days"]
    long_term_memory0_2_0 --> long_term_memory0_2_1
  end
  long_term_memory0_lane0 ~~~ long_term_memory0_lane1 ~~~ long_term_memory0_lane2
```

*The server writes memory on events it verified; the model can only recall it, for this workspace, and must re-check Salesforce.*

> **Key idea:** The server remembers what you confirmed; the model only recalls it, dated and sourced, and re-checks Salesforce before reusing it.

A new chat starts with an empty workspace, but some work should outlive it: the draft you settled on, the campaign you saved, the review you asked for. **Long-term memory** keeps these in the knowledge graph for 14 days, shared by the workspace.

**What gets remembered, and by whom.** The model never writes memory. The server does, only on events it has verified:
- a Salesforce save, review task, or image attachment that you confirmed and Salesforce read back
- a request to remember the draft in focus: say "remember this draft", or use **History → Memory**

**How it's stored.** Each memory is a small subgraph in its own dataset, next to the demo graph:
- a `Draft` node per version, linked to the version it replaced (`SUPERSEDES`)
- a `Decision` node, linked to the draft it saved (`DECIDED_ON`) and the Salesforce record it created (`RECORDED_IN`)
- `ABOUT` links to the `Campaign` and `Brand` nodes involved, so "what did we decide about Coastline?" is a graph question

Every node carries its workspace and an expiry. The person who acted is stored only as a hash.

**How it's recalled.** When you ask about earlier work ("what did we decide…", "last time…", "what have we worked on recently?"), the intent router forces a recall tool:
- `recall_decisions`
- `recall_recent_work`
- `explain_memory`

The server gives these tools the workspace, so the model can't read another workspace's memory. Each item comes back **dated and sourced**, with provenance paths, and the model is told to treat it as past work and re-check Salesforce before reusing it.

**How it's reopened.** **Reopen** in the Memory tab puts remembered work back into the current chat:
- A remembered draft becomes the focus again, at its remembered version, with a note saying where it came from.
- For a decision, its draft becomes the focus.
- The records it links to join **Records**, marked *Remembered*.

Memory may be stale, so reopening never marks a draft as saved, and a remembered campaign isn't a write target. The chat has to read it from Salesforce again first. Only you can reopen memory; the model can't.

**How it's forgotten.** **Forget** in the Memory tab deletes an item at once, and the audit export records it. An hourly job deletes anything past 14 days. `MEMORY_ENABLED=false` turns memory off entirely.

**Try it**

- Remember the current draft: “Remember this draft”
- Ask what we worked on: “What have we worked on recently?”
- Open History → Memory (opens the history view)

**In this demo**

- Chat: “Remember this draft”, then New chat and “What did we decide about …?”
- History → Memory (Reopen, Forget, Remember current draft)
- packages/knowledge-graph/src/memory.ts, apps/edge/src/memory.ts
- docs/decisions/ADR-007-long-term-graph-memory.md

**Learn more**

- Guide: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Docs: [Graph database concepts (Neo4j)](https://neo4j.com/docs/getting-started/graph-database/)
- Docs: [Cypher manual: introduction](https://neo4j.com/docs/cypher-manual/current/introduction/)

### Check your understanding

Who decides whether you may create a campaign from the workbench?

1. The model, based on the conversation
2. The workbench, from its own list of users
3. Salesforce, from your profile, permission sets, and sharing
4. Nobody: any signed-in user can write

<details><summary>Answer</summary>

**3. Salesforce, from your profile, permission sets, and sharing** Salesforce owns authorization. The workbench asks it, as you, before preparing the write and shows each check on the confirmation card; Apex enforces the same permissions again when the write runs. The model only drafts and proposes.

</details>

## Glossary

- **Agent**: A model that uses tools in a loop to accomplish a task, with a host that controls which tools it may call.
- **Context engineering**: Choosing the smallest, highest-signal context that lets the model do the next step well.
- **Context window**: Everything the model can see during one call: instructions, tool definitions, messages, and tool results.
- **Cypher**: Neo4j's graph query language, which matches patterns of nodes and relationships.
- **Durable Object**: A single-threaded, stateful Cloudflare instance with its own storage; one per user here.
- **Evidence path**: The chain of graph nodes and relationships that justifies an answer.
- **Forced tool call**: A step where the host requires the model to call one specific tool.
- **GraphRAG**: Retrieval-augmented generation that retrieves connected facts from a knowledge graph.
- **HXL**: Salesforce's widget format for rendering agent action output as typed, interactive cards.
- **Idempotency key**: A unique key that makes repeating a write safe: the second attempt returns the first result.
- **Knowledge graph**: A database of entities (nodes) and typed relationships between them.
- **Long-term memory**: Drafts and decisions the server stores in the graph for 14 days, recalled by tools across chats, never written by the model.
- **MCP**: Model Context Protocol, a standard for agents to discover and call tools on servers.
- **Policy router**: Deterministic rules that answer write or forbidden requests without calling the model.
- **Prompt injection**: Instructions hidden in data that try to steer a model; treated as data here, never as commands.
- **RAG**: Retrieval-augmented generation: retrieve relevant facts into context, then generate a grounded answer.
- **Read-back**: Re-reading a record from the system of record after a write, to confirm what actually changed.
- **Tool plan**: An ordered list of tools the intent router forces, one per step, before the model writes its answer.

## Reference: every concept in the code

### Tools (73)

| Name | What it is | Taught in |
| --- | --- | --- |
| `next_step` | The sample-flow orchestrator's one tool: delegate a step to a subagent, ask a person to decide, or finish. It is forced on every step, and passes the gateway as the orchestrator each time. | [3.19 Agents, prompts, models, and drift](#319-agents-prompts-models-and-drift) |
| `read_object` | Reads one governed object by urn for an agent, limited to the run's brand. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `list_objects` | Lists the run's brand's governed objects of one kind, with their urns and states. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `search_objects` | Searches the run's brand's governed objects by meaning; the reuse agent uses it. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `get_planning_inputs` | Reads what a plan is built from: today's date, the calendar, past results against the channel baseline, and the waves already planned. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `list_claims` | Lists the brand's current claims by topic with their exact text and whether each is substantiated; only a substantiated claim can be stated. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `plan_content` | Saves a content plan from the plan agent's own waves and rationale, after the service checks channels, dates and audience sizes. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `run_scenario` | Estimates what moving a send, dropping a channel or changing an audience does to expected clicks, with its basis; it changes nothing. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `draft_brief` | Saves a brief for one wave of an approved plan, with the agent's own one-sentence objective; the brief points at the plan for audience, channel and timing. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `reuse_modules` | Ranks the brand's existing modules for a brief or query by meaning and past results, flagging any that need a refresh. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `author_module` | Writes a module: the service inserts each substantiated claim's exact text and its required disclosures, refuses unsupported topics as gap records, and rejects the agent's own words unless they are a greeting, a call to action or a label built from the wave's theme. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `atomize_module` | Makes channel versions of a module, never shortening a claim and using each disclosure's short form on tight channels. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `assemble_evidence` | Assembles the evidence packet for a module's cited claims: evidence, expiry, supersession and conflicts. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `check_readiness` | Checks whether a module is ready for review: every claim substantiated, every disclosure present, no blocking probe finding. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `propose_transition` | Submits a draft module for review only if readiness passes; the furthest an agent can move anything, since a person decides after it. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `run_farm` | Runs the four automatic probes on a module and reports findings; it changes nothing, and a blocking finding blocks approval. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `report_finding` | Lets the red-team agent add a concern the probes missed. It is advice to the reviewer, shown beside the probes' findings, and blocks nothing, because only the deterministic probes can. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `attribute_result` | Traces a result to the module and the claim that carried it, with the path to the evidence. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `propose_optimization` | Reads the brand's performance signals: modules below baseline or citing a superseded claim, each with a suggested re-issue, refresh or retire. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `check_data_readiness` | Scores the inputs each lifecycle stage depends on for a brand, with reasons. | [3.18 The content lifecycle: plan to learn](#318-the-content-lifecycle-plan-to-learn) |
| `summarize_campaign` | Agent-backed summary of a campaign's status, dates, and performance from Salesforce. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `generate_campaign_insights` | Agent-backed insights on a campaign's engagement and opportunities. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `check_campaign_readiness` | Checks a campaign for launch blockers, such as missing dates, consent, or accessibility copy. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `draft_campaign_brief` | The Campaign Creation agent's Draft a Campaign Brief action; the brief becomes the workspace focus. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `refine_campaign_preview` | The Campaign Creation agent's Refine Campaign Preview action, on a brief saved in Marketing Cloud. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `draft_campaign_content` | The Content Builder agent's Draft Content action: copy for an email, push, or SMS. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `create_content_section` | The Content Builder agent's Create Section with Content action: a hero, header, or footer. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `validate_content_against_brand` | Checks copy against Northstar brand rules and reports what passed or failed. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `get_account_marketing_signals` | Account-level marketing signals from Salesforce. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `recommend_buyer_group_members` | Suggests buyer-group members for an account from Salesforce signals. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `summarize_account_engagement` | Summarizes how an account has engaged with recent campaigns. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `check_write_access` | Read-only Apex check, run as the signed-in user, of every permission a write needs. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `save_marketing_brief` | Confirmed write: the Campaign Creation agent saves the brief (Save Campaign Brief) and drafts its preview. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `create_marketing_campaign` | Confirmed write: the Campaign Creation agent creates the campaign and its flow (Create Campaign, Save Campaign). | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `get_marketing_records` | Read-back of a Brief, its preview steps, and the Campaign and flow created from it. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `create_campaign_review_request` | Confirmed write: creates a Salesforce review task with context and a checklist. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `create_inventory_case` | Confirmed write: opens a Salesforce Case for a store manager listing items that won't cover the forecast. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `attach_campaign_image` | Confirmed write: attaches a generated image to a campaign after Salesforce verifies its hash. | [3.13 Campaign image workflow](#313-campaign-image-workflow) |
| `get_restaurant_profile` | Coastline Kitchen's locations, menu, favorites, dayparts, and brand voice from the restaurant system. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `get_current_weather` | Live weather from Open-Meteo for a California city. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `get_weather_forecast` | The daily Open-Meteo forecast for a city, with each day's demand-planning weather. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `get_location_inventory` | Stock counts for a Coastline Kitchen restaurant from a randomized store inventory mock. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `get_public_holidays` | Upcoming public holidays for a country from Nager.Date, a free public API. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `get_weather_alerts` | Active National Weather Service alerts at a Coastline Kitchen location, most severe first. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `get_fed_announcements` | The latest FOMC rate decision from the Federal Reserve's public press feed, and the market event it maps to. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `get_graph_overview` | Counts of nodes and relationships in the knowledge graph, and its dataset version. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `explain_buyer_group` | Ranks an account's people for a buyer group, with the engagement paths behind each. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `find_audience_overlap` | Finds other campaigns whose audiences share people with a campaign's audience. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `check_consent_coverage` | How much of a campaign's audience holds consent for a channel, with uncovered examples. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `find_similar_past_pushes` | Past Coastline sends on the campaign's channel (emails or pushes) for a location, daypart, and weather, which menu items and content performed best, and the audience's opt-ins for that channel. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `plan_account_outreach` | An account's contacts in priority order, their consented channels, and the account's country. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `map_weather_demand` | The dishes forecast weather lifts, what they're made with, and the location's store manager. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `assess_location_impact` | The app audience near a location, how many can be reached on each channel, and campaigns to pause. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `match_news_to_approved_content` | Harborstone's pre-approved content for a market event: what's ready to send, what's blocked and why, reach by consent, and past response speed. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `prepare_deal_release` | The embargoed acquisition package in release order, with each piece's audience, consent basis, approval, and blockers. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `build_aum_account_plan` | A Harborstone client's signals, ranked plays with peer adoption and approved content, and contacts with consented channels. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `aprimo_search_approved_assets` | Aprimo (mocked): a drug's assets with MLR approval, expiry, claims, and whether each is usable now. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `aprimo_get_mlr_review` | Aprimo (mocked): an MLR approval's medical, legal and regulatory stages, comments and cycle time. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `reltio_resolve_organization` | Reltio (mocked): a hospital's golden record, hierarchy, merged sources, confidence and possible duplicates. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `vault_list_approved_claims` | Veeva Vault (mocked): a drug's claims library entries with status, references and the documents that carry them. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `vault_get_prescribing_information` | Veeva Vault (mocked): a drug's current label version, boxed warning and safety documents. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `screendragon_list_jobs` | Screendragon (mocked): marketing jobs by stage, due date, budget and the MLR approval each waits on. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `screendragon_get_job` | Screendragon (mocked): one job's workflow, linked asset and blockers. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `iqvia_get_prescribing_trends` | IQVIA (mocked, invented): six months of prescriptions and share by hospital for a drug. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `lsc_get_call_plan` | Salesforce Life Sciences Cloud (mocked): a hospital's call plan by prescriber group, with approved detail aids. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `drupal_list_hcp_site_content` | Drupal (mocked): HCP website pages for a drug, with the approvals and claims they rely on and any compliance issue. | [3.4 Tools and the Model Context Protocol (MCP)](#34-tools-and-the-model-context-protocol-mcp) |
| `build_hcp_target_list` | Lumera's hospitals and prescriber groups ranked for a drug by patients, formulary access, share, decile and opted-in channels, with the first move at each. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `check_clinical_claims` | Each clinical claim for a drug: the trial behind it, whether its indication is on the label, and the MLR-approved content that carries it, with blockers. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `plan_hospital_engagement` | A hospital's formulary status and P&T timing for each Lumera drug, the value dossier to send (usable or blocked), its prescriber groups and consent, and ordered next steps. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `trace_content_lineage` | Traces a campaign's content back to its brief and brand-rule results. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `recall_decisions` | Recalls remembered drafts and decisions about a subject in this workspace, dated and sourced. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `recall_recent_work` | Lists this workspace's most recent remembered drafts and decisions. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `explain_memory` | Shows where one memory came from: its record, the draft versions it replaced, and its subjects. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |

### Write actions (5)

| Name | What it is | Taught in |
| --- | --- | --- |
| `save-marketing-brief` | Have the Campaign Creation agent save the focus as a Marketing Cloud brief. Needs a permission check and your confirmation. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `create-marketing-campaign` | Have the Campaign Creation agent create the campaign and its flow from the saved brief. Needs a permission check and your confirmation. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `create-review-task` | Create a Salesforce review task for the open campaign. Needs a permission check and your confirmation. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `attach-generated-image` | Attach an approved generated image to the open campaign. Needs a permission check and your confirmation. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `create-inventory-case` | Open a Salesforce case for a store manager from an inventory check's low items. Needs a permission check and your confirmation. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |

### Graph nodes (41)

| Name | What it is | Taught in |
| --- | --- | --- |
| `Brand` | Northstar and its brands: Coastline Kitchen (restaurants) and Harborstone Wealth (wealth management). | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Channel` | Email, SMS, and the mobile app. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `ConsentScope` | A consent a person or segment holds for a channel. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `BrandRule` | A brand rule that content passes or fails. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Campaign` | A marketing campaign, for Northstar or Coastline Kitchen. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Brief` | The brief a campaign's content is built from. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `ContentAsset` | An email, push, or other piece of campaign content. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Segment` | An audience a campaign targets. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Account` | A fictional B2B customer account. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Persona` | A buying role at an account; roles, not real people. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Daypart` | A time of day: breakfast, lunch, afternoon, dinner, and so on. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `WeatherCondition` | A weather bucket: clear, cloudy, fog, rain, or heat. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `Menu` | Coastline Kitchen's menu. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `MenuItem` | A dish on the menu, with its order rate. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `Location` | A Coastline Kitchen restaurant in California. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `InventoryItem` | Stock a restaurant keeps, counted in kitchen units. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `StoreManager` | A restaurant's store manager, by name only. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `PushSend` | One past push notification send and how it performed. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `EmailSend` | One past Coastline email send: its opens, clicks, and orders. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `Approval` | A compliance approval record: approved, expired, or pending, with its dates and any embargo. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Disclosure` | Required disclosure text a regulated asset must carry. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `MarketEvent` | A market event Harborstone prepares approved content for. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ClientSend` | A past Harborstone response: hours after the news, opens, clicks. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Deal` | Harborstone's embargoed acquisition. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Firm` | The firm being acquired. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Client` | A Harborstone client: a foundation, business, or family office. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Advisor` | The Harborstone advisor who covers a client. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Product` | A Harborstone product or service a client can hold. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Signal` | Something the relationship team noticed about a client. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Drug` | A Lumera Therapeutics drug, with its class and whether it carries a boxed warning. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Indication` | A condition a drug is labeled for, or only investigated in. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ClinicalTrial` | A trial with its phase, size, status, endpoint and result. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ClinicalClaim` | A claim about a drug's effect or safety that promotional content may carry. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Hospital` | A fictional hospital or health system, with its formulary and patient volumes. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Specialty` | A prescriber specialty, such as cardiology, and the conditions it treats. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `PrescriberGroup` | A segment of prescribers at one hospital in one specialty; a count and a decile, never a person. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `Workspace` | The workspace that owns a memory. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `MemoryEvent` | The server event that created a memory, with a hashed actor. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `Draft` | One remembered version of a focus draft. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `Decision` | A confirmed save, review, or image attachment. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `RecordRef` | The Salesforce record a decision was recorded in. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |

### Graph relationships (65)

| Name | What it is | Taught in |
| --- | --- | --- |
| `PART_OF` | A sub-brand under its parent brand, or a push send within its campaign. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `FOR` | A consent scope for its channel, a brief for its campaign, or a push for a location. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `RULE_OF` | A brand rule belonging to its brand. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `BELONGS_TO` | A campaign belonging to its brand. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `ON` | A campaign or push send on its channel. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `USES` | A campaign using a content asset. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `BUILT_FROM` | Content built from its brief. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `PASSED` | Content that passed a brand rule. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `FAILED` | Content that failed a brand rule. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `TARGETS` | A campaign targeting a segment. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `WORKS_AT` | A persona at its account. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `ENGAGED_WITH` | A persona that engaged with a content asset. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `INCLUDES` | A segment including a persona. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `HAS_CONSENT` | A persona or segment holding a consent scope; segments carry opt-in counts per channel. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `MENU_OF` | A menu belonging to its brand. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `ON_MENU` | A menu item on the menu. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `AVAILABLE_DURING` | A menu item offered during a daypart. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `FAVORITE` | A brand's favorite menu item. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `OPERATES` | A brand operating a location. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `SERVES` | A location serving a menu. | [3.14 Campaign context: restaurant data and live weather](#314-campaign-context-restaurant-data-and-live-weather) |
| `NEAR` | An app segment near a location. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `MADE_WITH` | A menu item made with an inventory item, per serving. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `LIFTS_DEMAND` | Weather that raises a menu item's orders, learned from past pushes. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `MANAGED_BY` | A location managed by its store manager. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `APPROVED_UNDER` | Regulated content and the approval it was released under. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `REQUIRES` | Regulated content and a disclosure it must carry. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `APPROVED_FOR` | Regulated content and the channel it's approved for. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `RESPONDS_TO` | Content or a past response prepared for a market event. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `EXPLAINS` | Content explaining a product. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `RELEASED_WITH` | An announcement asset, its release step, and timing. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ADDRESSED_TO` | An announcement asset and the audience it goes to. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ANNOUNCED_BY` | A deal announced by its brand. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ANNOUNCES` | A campaign announcing a deal. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ACQUIRES` | A deal and the firm it acquires. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `CLIENT_OF` | A client of a brand, or a segment of a firm's clients. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `COVERED_BY` | A client and the advisor who covers it. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `HOLDS` | A client holding a product, with its assets in $ millions. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `HAS_SIGNAL` | A client showing a signal, and when it was detected. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `SUGGESTS` | A signal pointing to a product, with the share it might capture. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `OFFERS` | A brand offering a product. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ADVISES_FOR` | An advisor at a brand. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `INDICATED_FOR` | A drug and a condition it is labeled for. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `INVESTIGATED_FOR` | A drug and a condition it is only being studied in, so not on the label. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `STUDIED_IN` | A drug and a trial that studied it. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `SUPPORTS` | A trial and a clinical claim its results support. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `CLAIMS_ABOUT` | A clinical claim and the drug it is about. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `CARRIES` | A content asset and a clinical claim it makes. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `TREATS` | A specialty and a condition it treats. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `SPECIALIZES_IN` | A prescriber group and its specialty. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `PRACTICES_AT` | A prescriber group and the hospital it practices at. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `ON_FORMULARY` | A hospital and a drug, with its formulary status and days to the next P&T review. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `SEES_PATIENTS_WITH` | A hospital and a condition, with its annual patient count. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `PRESCRIBES` | A prescriber group and a drug, with Lumera's share of the class. | [3.15 The use-case library: marketing, sales, service, and financial services](#315-the-use-case-library-marketing-sales-service-and-financial-services) |
| `USED` | A push send that used a content asset. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `SENT_TO` | A push send delivered to a segment. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `SENT_UNDER` | A push send made under a consent scope. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `FEATURED` | A push send featuring a menu item. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `SENT_DURING` | A push send made during a daypart. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `UNDER` | A push send made under a weather condition. | [2.3 How this demo does GraphRAG](#23-how-this-demo-does-graphrag) |
| `IN_WORKSPACE` | A memory event in its workspace. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `CREATED` | The memory event that created a draft or decision. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `SUPERSEDES` | A draft version replacing the one before it. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `ABOUT` | A memory about a campaign or brand in the demo graph. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `DECIDED_ON` | A decision about the draft version it saved. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |
| `RECORDED_IN` | A decision recorded in a Salesforce record. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |

### Operator controls (4)

| Name | What it is | Taught in |
| --- | --- | --- |
| `WRITES_ENABLED` | Set to false to pause every Salesforce write without a deploy. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `DISABLED_TOOLS` | A comma-separated list of tools to withhold from the model or block as writes. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `DISABLED_AGENTS` | A comma-separated list of registry agents to switch off; the gateway denies every call they make. | [3.17 The agentic gateway](#317-the-agentic-gateway) |
| `MEMORY_ENABLED` | Set to false to stop remembering and withhold the recall tools. | [3.20 Long-term memory: remembering across chats](#320-long-term-memory-remembering-across-chats) |

### Salesforce components (10)

| Name | What it is | Taught in |
| --- | --- | --- |
| `NorthstarCheckWriteAccess` | Apex: the read-only permission check run as the user. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `NorthstarConfirmationVerifier` | Apex: verifies the signed confirmation before any write. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
| `NorthstarGetMarketingRecords` | Apex: reads back the Brief, preview steps, Campaign, and flow the agent created. | [3.6 Marketing Cloud Next: agent-built briefs, campaigns, and flows](#36-marketing-cloud-next-agent-built-briefs-campaigns-and-flows) |
| `NorthstarCreateCampaignReviewRequest` | Apex action behind create_campaign_review_request. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `NorthstarCreateInventoryCase` | Apex action behind create_inventory_case; checks the contents' hash. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `NorthstarAttachCampaignImage` | Apex action behind attach_campaign_image; checks the hash. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `NorthstarGetCampaignContext` | Apex action: bounded campaign context for the readiness check. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `NorthstarGetConsentSummary` | Apex action: aggregate consent evidence, no customer fields. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `NorthstarValidateCampaignContent` | Apex action: readiness checks on campaign fields, including instruction-like text. | [3.5 Salesforce: Agentforce agents, Hosted MCP, and Apex actions](#35-salesforce-agentforce-agents-hosted-mcp-and-apex-actions) |
| `Northstar_Confirmation_Config__c` | Custom setting holding the key Apex uses to verify signed confirmations. | [3.9 Governance: permissions, confirmations, and kill switches](#39-governance-permissions-confirmations-and-kill-switches) |
