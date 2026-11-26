/**
 * Learn page content: a primer on context and GraphRAG, then an in-depth explainer for each
 * concept the Northstar demo uses. Bodies are Markdown; every resource link was checked to resolve.
 */

export type Resource = {
  label: string;
  url: string;
  kind: "Guide" | "Docs" | "Paper" | "Course" | "Spec" | "Code";
};

export type LearnSection = {
  id: string;
  title: string;
  summary: string;
  body: string;
  /** Where to see it in this demo: UI surfaces and source paths. */
  inDemo?: string[];
  resources: Resource[];
};

export type LearnPart = { id: string; title: string; intro: string; sections: LearnSection[] };

export const LEARN_TITLE = "Learn: context, GraphRAG, and how this demo works";
export const LEARN_LEDE =
  "A hands-on course in how an agent uses context, how GraphRAG grounds answers in connected facts, and how every piece of this workbench fits together. Each lesson has a diagram, one key idea, a way to try it here, and links to go deeper.";

const R = {
  cedar: { label: "Cedar policy language", url: "https://www.cedarpolicy.com/", kind: "Docs" },
  a2a: {
    label: "Agent2Agent (A2A) protocol",
    url: "https://a2a-protocol.org/latest/",
    kind: "Spec",
  },
  tokenExchange: {
    label: "RFC 8693: OAuth 2.0 token exchange",
    url: "https://datatracker.ietf.org/doc/html/rfc8693",
    kind: "Spec",
  },
  mcpApps: {
    label: "MCP Apps specification and SDK",
    url: "https://github.com/modelcontextprotocol/ext-apps",
    kind: "Spec",
  },
  adaptiveCards: { label: "Adaptive Cards", url: "https://adaptivecards.io/", kind: "Docs" },
  cfDurableObjects: {
    label: "Cloudflare Durable Objects",
    url: "https://developers.cloudflare.com/durable-objects/",
    kind: "Docs",
  },
  contextEngineering: {
    label: "Effective context engineering for AI agents (Anthropic)",
    url: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents",
    kind: "Guide",
  },
  buildingAgents: {
    label: "Building effective agents (Anthropic)",
    url: "https://www.anthropic.com/engineering/building-effective-agents",
    kind: "Guide",
  },
  writingTools: {
    label: "Writing effective tools for agents (Anthropic)",
    url: "https://www.anthropic.com/engineering/writing-tools-for-agents",
    kind: "Guide",
  },
  lostInTheMiddle: {
    label: "Lost in the Middle: How Language Models Use Long Contexts",
    url: "https://arxiv.org/abs/2307.03172",
    kind: "Paper",
  },
  rag: {
    label: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    url: "https://arxiv.org/abs/2005.11401",
    kind: "Paper",
  },
  graphragPaper: {
    label: "From Local to Global: A Graph RAG Approach (Microsoft Research)",
    url: "https://arxiv.org/abs/2404.16130",
    kind: "Paper",
  },
  msGraphrag: {
    label: "Microsoft GraphRAG project",
    url: "https://microsoft.github.io/graphrag/",
    kind: "Docs",
  },
  neo4jGraphrag: {
    label: "What is GraphRAG? (Neo4j)",
    url: "https://neo4j.com/blog/genai/what-is-graphrag/",
    kind: "Guide",
  },
  neo4jGraphragPython: {
    label: "Neo4j GraphRAG for Python",
    url: "https://neo4j.com/docs/neo4j-graphrag-python/current/",
    kind: "Docs",
  },
  graphDb: {
    label: "Graph database concepts (Neo4j)",
    url: "https://neo4j.com/docs/getting-started/graph-database/",
    kind: "Docs",
  },
  cypher: {
    label: "Cypher manual: introduction",
    url: "https://neo4j.com/docs/cypher-manual/current/introduction/",
    kind: "Docs",
  },
  queryApi: {
    label: "Neo4j Aura Query API",
    url: "https://neo4j.com/docs/aura/connecting-applications/query-api/",
    kind: "Docs",
  },
  graphAcademy: {
    label: "Neo4j GraphAcademy (free courses)",
    url: "https://graphacademy.neo4j.com/",
    kind: "Course",
  },
  neo4jMcp: {
    label: "Official Neo4j MCP server",
    url: "https://github.com/neo4j/mcp",
    kind: "Code",
  },
  agentforceNeo4j: {
    label: "Salesforce Agentforce + Neo4j (Neo4j Labs)",
    url: "https://neo4j.com/labs/genai-ecosystem/genai-frameworks/salesforce-agentforce/",
    kind: "Guide",
  },
  mcpIntro: {
    label: "Model Context Protocol: introduction",
    url: "https://modelcontextprotocol.io/docs/getting-started/intro",
    kind: "Docs",
  },
  mcpSpec: {
    label: "MCP specification (2025-06-18)",
    url: "https://modelcontextprotocol.io/specification/2025-06-18",
    kind: "Spec",
  },
  cloudRun: {
    label: "Cloud Run documentation",
    url: "https://cloud.google.com/run/docs",
    kind: "Docs",
  },
  firestore: {
    label: "Firestore documentation",
    url: "https://cloud.google.com/firestore/docs",
    kind: "Docs",
  },
  vertexGptOss: {
    label: "gpt-oss-120b on Vertex AI (managed API)",
    url: "https://cloud.google.com/vertex-ai/generative-ai/docs/maas/openai/gpt-oss-120b",
    kind: "Docs",
  },
  iapCloudRun: {
    label: "Identity-Aware Proxy for Cloud Run",
    url: "https://cloud.google.com/iap/docs/enabling-cloud-run",
    kind: "Docs",
  },
  cfAgents: {
    label: "Cloudflare Agents SDK",
    url: "https://developers.cloudflare.com/agents/",
    kind: "Docs",
  },
  cfChatAgents: {
    label: "Cloudflare chat agents",
    url: "https://developers.cloudflare.com/agents/api-reference/chat-agents/",
    kind: "Docs",
  },
  cfMcp: {
    label: "MCP on Cloudflare",
    url: "https://developers.cloudflare.com/agents/model-context-protocol/",
    kind: "Docs",
  },
  durableObjects: {
    label: "Cloudflare Durable Objects",
    url: "https://developers.cloudflare.com/durable-objects/",
    kind: "Docs",
  },
  workersAi: {
    label: "Cloudflare Workers AI",
    url: "https://developers.cloudflare.com/workers-ai/",
    kind: "Docs",
  },
  aiGateway: {
    label: "Cloudflare AI Gateway",
    url: "https://developers.cloudflare.com/ai-gateway/",
    kind: "Docs",
  },
  gptOss20b: {
    label: "gpt-oss-20b on Workers AI",
    url: "https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/",
    kind: "Docs",
  },
  gptOssRepo: { label: "openai/gpt-oss", url: "https://github.com/openai/gpt-oss", kind: "Code" },
  harmony: {
    label: "The harmony response format (OpenAI Cookbook)",
    url: "https://cookbook.openai.com/articles/openai-harmony",
    kind: "Guide",
  },
  aiSdk: {
    label: "AI SDK: introduction",
    url: "https://ai-sdk.dev/docs/introduction",
    kind: "Docs",
  },
  aiSdkRegistry: {
    label: "AI SDK: provider and model management (provider registry)",
    url: "https://ai-sdk.dev/docs/ai-sdk-core/provider-management",
    kind: "Docs",
  },
  aiSdkTools: {
    label: "AI SDK: tools and tool calling",
    url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
    kind: "Docs",
  },
  react: {
    label: "ReAct: Synergizing Reasoning and Acting in Language Models",
    url: "https://arxiv.org/abs/2210.03629",
    kind: "Paper",
  },
  hostedMcp: {
    label: "Salesforce Hosted MCP servers reference",
    url: "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/servers-reference.html",
    kind: "Docs",
  },
  hxl: {
    label: "HXL widgets for Agentforce action output",
    url: "https://developer.salesforce.com/docs/platform/hxl/guide/agentforce-action-output.html",
    kind: "Docs",
  },
  agentforceTrailhead: {
    label: "Introduction to Agentforce (Trailhead)",
    url: "https://trailhead.salesforce.com/content/learn/modules/introduction-to-agentforce",
    kind: "Course",
  },
  nagerDate: {
    label: "Nager.Date public holiday API",
    url: "https://date.nager.at/Api",
    kind: "Docs",
  },
  fedFeed: {
    label: "Federal Reserve press release feeds",
    url: "https://www.federalreserve.gov/feeds/feeds.htm",
    kind: "Docs",
  },
  finra2210: {
    label: "FINRA Rule 2210: communications with the public",
    url: "https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210",
    kind: "Docs",
  },
  nwsApi: {
    label: "National Weather Service API (api.weather.gov)",
    url: "https://www.weather.gov/documentation/services-web-api",
    kind: "Docs",
  },
  mcnAgentforce: {
    label: "Agentforce in Marketing Cloud Next (Salesforce Help)",
    url: "https://help.salesforce.com/s/articleView?id=mktg.mktg_einstein_copilot_in_mc.htm&language=en_US&type=5",
    kind: "Docs",
  },
  mcnCampaignTrailhead: {
    label: "Create and customize a marketing campaign with Agentforce (Trailhead)",
    url: "https://trailhead.salesforce.com/content/learn/modules/ai-in-marketing-cloud-next/create-and-customize-a-marketing-campaign-with-agentforce",
    kind: "Course",
  },
  hostedMcpAgents: {
    label: "Expose Agentforce agents as Hosted MCP tools (Salesforce Developers)",
    url: "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/agentforce.html",
    kind: "Docs",
  },
  agentforce: {
    label: "Salesforce Agentforce",
    url: "https://www.salesforce.com/agentforce/",
    kind: "Guide",
  },
  owaspLlm: {
    label: "OWASP Top 10 for LLM Applications",
    url: "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
    kind: "Guide",
  },
  evals: {
    label: "Your AI product needs evals (Hamel Husain)",
    url: "https://hamel.dev/blog/posts/evals/",
    kind: "Guide",
  },
  openMeteo: { label: "Open-Meteo API docs", url: "https://open-meteo.com/en/docs", kind: "Docs" },
  r2: { label: "Cloudflare R2", url: "https://developers.cloudflare.com/r2/", kind: "Docs" },
  d1: { label: "Cloudflare D1", url: "https://developers.cloudflare.com/d1/", kind: "Docs" },
  flux: {
    label: "FLUX.2 klein 4B on Workers AI",
    url: "https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/",
    kind: "Docs",
  },
  wcag: {
    label: "WCAG overview (W3C)",
    url: "https://www.w3.org/WAI/standards-guidelines/wcag/",
    kind: "Guide",
  },
  reactMarkdown: {
    label: "react-markdown",
    url: "https://github.com/remarkjs/react-markdown",
    kind: "Code",
  },
} satisfies Record<string, Resource>;

export const LEARN_PARTS: LearnPart[] = [
  {
    id: "context",
    title: "Primer: context",
    intro:
      "Everything a model knows during a turn is its **context**. Most agent quality problems (forgetting, hallucinating, acting on stale facts) are context problems. This part covers what context is, how this demo manages it, and what goes wrong.",
    sections: [
      {
        id: "what-is-context",
        title: "What context is",
        summary: "The model only sees what is in its context window for this one call.",
        body: `A language model has no memory between calls. Each time the orchestrator calls the model, it sends a **context window**: a bounded sequence of tokens that is all the model can see. Here that window holds:

- **System instructions:** the orchestrator's rules, such as "Salesforce tool results are the only authority" and "never claim a write happened".
- **Tool definitions:** the name, description, and JSON input schema of every tool the model may call on this step.
- **Conversation messages:** the recent user and assistant messages.
- **Tool results:** what each tool returned earlier in this turn.

**Context engineering** decides what goes into that window, in what form, and what stays out. More is not better: long, noisy windows dilute attention ("context rot"), cost more, and let stale or injected text steer the model. Aim for the *smallest* set of high-signal information that lets the model do the next step well.`,
        inDemo: [
          "System prompt: apps/edge/src/turn-policy.ts (orchestratorSystemPrompt)",
          "Technical trace at the top of each answer shows what the model did with its context",
        ],
        resources: [R.contextEngineering, R.lostInTheMiddle, R.buildingAgents],
      },
      {
        id: "memory-layers",
        title: "Three layers of memory",
        summary:
          "Working memory, the audit trail, and long-term memory each live somewhere different.",
        body: `"Session context" is really three things, with different lifetimes and owners:

| Layer | Holds | Lives in | Lifetime |
|---|---|---|---|
| **Working memory** | The current conversation, plus the workspace: the focus draft, open records, and context cards | {{cloudflare: Each user's agent Durable Object || google-cloud: Each user's chat in the Cloud Run agent host}} | Until **New chat** |
| **Audit trail** | What each turn did: route, tools, inputs and outputs, outcome, and the brand and role it ran under | Agent SQLite (turn history) | 24 hours |
| **Long-term memory** | Drafts you asked to remember and confirmed Salesforce writes | Knowledge graph, linked to the campaigns and brands involved | 14 days, across chats |

**Working memory** reaches the model as a bounded window: the last 8 messages, with earlier assistant replies reduced to their text so old tool results and reasoning never re-enter the prompt. The workspace (the draft being built, the records the chat opened, the context its tools gathered) is summarized in every prompt, so the model works from structured state instead of re-reading old replies. See *The workspace*.

**The audit trail** is never sent to the model. It's for people: History (a button on the Chat page) and the audit export.

**Long-term memory** lives in the graph because it's retrieved *by relationship* ("what did we decide about the Coastline push?"), not by recency, and needs provenance. It's never sent automatically: the model reads it through recall tools, only when a question asks about earlier work. See *Long-term memory*.`,
        inDemo: [
          "Chat → History: Turns (the audit trail) and Memory (long-term memory)",
          "apps/edge/src/orchestrator.ts (conversationWindow)",
          "packages/knowledge-graph/src/memory.ts",
        ],
        resources: [R.contextEngineering, R.durableObjects, R.cfChatAgents],
      },
      {
        id: "context-risks",
        title: "What goes wrong with context, and the defenses here",
        summary:
          "Stale claims, prompt injection, and overflow, plus the guards this demo uses against each.",
        body: `**Stale or unsupported claims.** A wrong claim left in the window tends to be repeated as fact. Defense: earlier replies are *context, not evidence*. The system prompt requires re-checking Salesforce facts with tools each turn, and old tool results are stripped from history.

**Prompt injection.** Text inside data, such as a campaign description saying "ignore previous instructions", can try to steer the model. Defenses:
- The model has **no write tools**; writes need a human confirmation.
- A **policy router** answers write and forbidden requests without calling the model.
- Tool results are treated as data.
- The Apex readiness check flags instruction-like text.

**Overflow and truncation.** {{workers-ai: Workers AI defaults to 256 output tokens, which gpt-oss's reasoning could use up before any answer. || vertex: A model endpoint's default output limit can be small enough for gpt-oss's reasoning to use up before any answer.}} Defenses: an explicit 4,096-token budget, forced text-only summary steps, and a recovery message if a turn still ends empty.`,
        inDemo: [
          "apps/edge/src/turn-policy.ts (system rules)",
          "packages/contracts/src/index.ts (classifyPolicyIntent)",
          'Evaluations view: "No false write claims" check',
        ],
        resources: [R.owaspLlm, R.contextEngineering],
      },
    ],
  },
  {
    id: "graphrag",
    title: "Primer: RAG and GraphRAG",
    intro:
      "**Retrieval-augmented generation (RAG)** grounds a model in data it wasn't trained on by retrieving relevant facts into its context. **GraphRAG** retrieves from a knowledge graph, so answers can follow relationships and show the path to their evidence.",
    sections: [
      {
        id: "rag",
        title: "RAG in one page",
        summary:
          "Retrieve relevant facts, add them to the context, then generate an answer grounded in them.",
        body: `Plain RAG has three steps:

1. **Retrieve** the data most relevant to the question, usually by embedding text as vectors and running a similarity search.
2. **Augment** the model's context with those pieces and the question.
3. **Generate** an answer from the retrieved facts instead of training data.

RAG is excellent at "find the passage that answers this". It struggles when the answer depends on **connections** between facts spread across documents, such as *which accounts engaged with content from two campaigns and also lack SMS consent?* Similarity search finds similar text; it doesn't join facts.

Here, tool calls are a form of retrieval: the Salesforce agents and the graph tools fetch facts at answer time.`,
        resources: [R.rag, R.buildingAgents],
      },
      {
        id: "graphrag-explained",
        title: "GraphRAG",
        summary:
          "Retrieve connected facts from a knowledge graph and return the paths as evidence.",
        body: `A **knowledge graph** stores entities (**nodes**, such as a Persona, a Campaign, or a MenuItem) and typed **relationships** between them (\`ENGAGED_WITH\`, \`TARGETS\`, \`FEATURED\`). **GraphRAG** retrieves by traversing those relationships. Common patterns:

- **Curated graph queries** (used here): the model picks from fixed, parameterized queries such as *explain buyer group*. Predictable, safe, fast, and easy to evaluate.
- **Text-to-Cypher:** the model writes graph queries itself. Flexible, but riskier and harder to govern.
- **Hybrid vector + graph:** vector search finds entry points; graph traversal expands to connected context.
- **Community summaries:** Microsoft's GraphRAG clusters the graph into communities and pre-summarizes them to answer global "what are the themes?" questions.

GraphRAG's strengths are **multi-hop reasoning** and **explainability**: every answer can carry the path that justifies it, which the demo shows in the **Graph evidence** panel.`,
        resources: [
          R.graphragPaper,
          R.msGraphrag,
          R.neo4jGraphrag,
          R.neo4jGraphragPython,
          R.graphDb,
        ],
      },
      {
        id: "graphrag-here",
        title: "How this demo does GraphRAG",
        summary: "Twelve read-only, curated graph tools over Neo4j, each returning evidence paths.",
        body: `**The graph.** A deterministic, fictional dataset of about 2,400 nodes and 20,300 relationships:
- **Northstar**, the parent brand: B2B accounts (each with a headquarters country), buying-role personas, campaigns, segments, content, brand rules, and consent scopes.
- **Coastline Kitchen**, a restaurant brand under Northstar: locations, menu, and dayparts from the restaurant system, with the same ids. Campaigns run on the **mobile app** and **email**. Each of 1,500 past push sends and 600 past email sends links to its campaign, content (push or email), app segment, channel consent, location, daypart, weather, and featured menu item, so an email campaign learns from past emails and a push from past pushes. Each location's app segment holds **marketing consent per channel** (separate push, email, and SMS opt-in counts): consent to one channel isn't consent to another.
- **Harborstone Wealth**, a wealth-management brand under Northstar: regulated content with approval records and required disclosures, an embargoed acquisition with its release package, and institutional clients with holdings, signals, advisors, and contacts.
- **Lumera Therapeutics**, a third brand modeling pharmaceutical promotion: seven more node types (Drug, Indication, ClinicalTrial, ClinicalClaim, Hospital, Specialty, PrescriberGroup) and twelve relationship types. It reuses ContentAsset, Approval, Disclosure, BrandRule and ConsentScope, so approval and consent checks work as for Harborstone. Its tools' Cypher hasn't been run against a live Neo4j database here; the fixture backend returns the rows the tests check.

**The store.** Neo4j AuraDB over the HTTPS **Query API**, {{cloudflare: because Workers can't open Bolt connections || google-cloud: the same way from either host the workbench runs on}}. Tool queries run in **read access mode**, so the database itself rejects writes; the only writes are the server's fixed long-term memory statements, kept to their own dataset.

::: details The twelve tools, and how they're tested
**The tools**, each returning an answer plus up to 25 **evidence paths**: \`explain_buyer_group\`, \`find_audience_overlap\`, \`check_consent_coverage\`, \`find_similar_past_pushes\`, \`trace_content_lineage\`, \`get_graph_overview\`; for sales and service use cases, \`plan_account_outreach\`, \`assess_location_impact\`, \`map_weather_demand\`; for financial services, \`match_news_to_approved_content\`, \`prepare_deal_release\`, \`build_aum_account_plan\`.

**Parity, grounding, flows.**
- Every tool also has an in-memory implementation over the same dataset; \`pnpm kg:parity\` proves both return identical results (so local development and evals match production) and reports latency, with the median under 500 ms.
- Evaluations check that a graph answer names only accounts, people, campaigns, and menu items the tools returned.
- The restaurant push campaign calls \`find_similar_past_pushes\` to learn what worked in the same weather and daypart, then passes that to the Salesforce content tool.
:::

**Graph explorer.** The Graph page's brand filter is the header's brand. It narrows the canvas to the nodes at least as close to that brand as to any other, walking loaded relationships without crossing another brand. So Coastline Kitchen keeps its campaigns, locations, shared channels and consent without pulling in Northstar's B2B accounts, and Lumera shows only its own nodes and what sits close. There's also a Lumera group and two guided tours.

**Evidence, shown twice.** Every path an answer used appears in words under the answer and, for a claims check, as a workspace card with each claim's evidence and the assets carrying it.`,
        inDemo: [
          "Use cases: Buyer-group recommendation, and Buyer-group outreach around local holidays",
          "Graph evidence panel under answers; “Knowledge graph · Neo4j” in Sources",
          "packages/knowledge-graph, apps/edge/src/knowledge-graph",
        ],
        resources: [R.cypher, R.queryApi, R.graphAcademy, R.neo4jMcp, R.agentforceNeo4j],
      },
    ],
  },
  {
    id: "concepts",
    title: "Every concept in the demo",
    intro: "Each piece of the workbench: how it works and where to see it.",
    sections: [
      {
        id: "orchestrator",
        title: "The orchestrator agent",
        summary:
          "A stateful agent per user, {{cloudflare: on Cloudflare || google-cloud: on Cloud Run}}, that runs each chat turn.",
        body: `{{cloudflare: The **orchestrator** is a Cloudflare **Agents SDK** chat agent running in a **Durable Object**: a single-threaded, stateful instance with its own SQLite storage. On Google Cloud the same class runs in a Node agent host that speaks the same protocol, with each chat's storage saved to Cloud Storage (see *Two hosts*). || google-cloud: The **orchestrator** is an **Agents SDK** chat agent, run on Google Cloud by the workbench's own Node agent host on **Cloud Run**: one stateful instance per user with its own SQLite storage, saved to **Cloud Storage** after every change.}}
- Each user gets their own instance, keyed by a hash of their {{cloudflare: Access || google-cloud: IAP}} identity and the workspace, so conversations and history are isolated by construction.
- Each turn streams to the browser over a WebSocket, and the stream is **resumable** if the tab reconnects.

**The tool loop.** A turn runs up to 6 steps; on each, the model calls a tool or writes the answer. Tools come from five MCP servers, connected per turn: Salesforce, campaign context, the knowledge graph, external services (public holidays and weather alerts) and the mocked life-sciences systems (see *Tools and the Model Context Protocol*). The orchestrator picks the tools available on each step (see *Routing*) and records a **turn trace** of every event.

**Around the loop**, the orchestrator handles what the model must not.

::: details Confirmed writes, brief refinements, inventory checks and memory
- **Confirmed writes.** Once you confirm, it asks Marketing Cloud's Campaign Creation agent to save the brief or create the campaign, then reads the records back. It checks Salesforce before and after the call, so a retry links what an earlier attempt saved instead of saving it twice. Each step is published as agent state over the WebSocket, so progress is live, not a spinner.
- **Brief refinements.** It adds the Brief ID to a saved brief's preview refinement if the model left it out.
- **Inventory checks.** It collects the forecast, the graph's demand map, and stock counts, computes which items are low, and rebuilds the answer step's system prompt so the model presents exactly that list.
- **Long-term memory.** It writes memory when a write is read back or you ask it to remember a draft, and reopens one into the workspace on **Reopen**. {{cloudflare: The Worker's hourly job || google-cloud: The hourly Cloud Scheduler job}} prunes the 24-hour audit and deletes memory past 14 days.
:::

**Every tool call passes the gateway.** Before a chosen tool runs, the {{cloudflare: Worker || google-cloud: server}} asks the agentic gateway whether the orchestrator may call \`tool:<name>\`. The decision, policy and caller are recorded; a denial reaches the model as a tool error. See *The agentic gateway*.

::: details How a tool result is judged usable
**Is a result usable?** A Salesforce agent answers in words, so its reply is checked for phrases such as "no business units" or "cannot access"; if found, the model is told the result was empty and not to fill the gap. The workbench's own tools (knowledge graph, life-sciences systems, campaign context, external services) return data that can quote such words and still be a full answer (a claim that "is not on the approved label" is evidence), so theirs counts as empty only as an error or \`found: false\`.
:::

::: details How the header's brand and role shape a turn
**The header's brand and role.** Each chat message carries both. The server withholds other brands' tools, answers a request about another brand with a note to switch (not from memory), and tells the model the role so it leads with what that person decides. The model knows what each brand sells (Lumera's Cardivance, Glucora and Neurelva; Harborstone's Sweep Account; Coastline's chowder), so a named product maps to its brand. The brand also sets which claims checks a new draft starts with. The role changes emphasis only, never what Salesforce allows or what needs confirmation.
:::

::: details The Lightning surface: sign-in, turns and scope
{{cloudflare: **The Lightning surface.** A Lightning Web Component on the Lightning Design System opens the same agent and workspace from Salesforce; it is a window, not a second agent.
- **Sign-in.** **Log in** opens Cloudflare Access; a Worker page then hands the Access token to the Lightning window, only for a Salesforce origin the Worker names. Apex relays each call with it in a \`cf-access-token\` header, so the Worker sees the same person, agent, Salesforce connection, and history as the browser app.
- **Turns.** Apex can't hold a WebSocket, so a turn starts over HTTP and the component polls about once a second. It enters through the same \`onChatMessage\` (routing, gateway, tools, confirmation, and turn history unchanged), and the tool calls, trace, and route map come from the browser's code.
- **Scope.** Chat, use cases, brand and role, connections, and history; the workspace panel and the Architecture, Graph, and Learn pages stay in the browser app. || google-cloud: **The Lightning surface.** A Salesforce Lightning component onto the same agent is part of this demo, but not on Google Cloud: it depends on handing a signed-in person's token to a Salesforce origin, which Identity-Aware Proxy doesn't do. Here the workbench is used from its own page (ADR-018).}}
:::
`,
        inDemo: [
          "apps/edge/src/orchestrator.ts",
          "apps/edge/src/surface.ts",
          "salesforce/workbench-surface/main/default/lwc/northstarWorkbench/",
          "“Behind the scenes · technical trace” at the top of each answer",
        ],
        resources: [R.cfAgents, R.cfChatAgents, R.durableObjects, R.aiSdk, R.react],
      },
      {
        id: "two-hosts",
        title: "Two hosts: Cloudflare and Google Cloud",
        summary:
          "The same code runs as a Cloudflare Worker or as a Node server on Cloud Run, behind a thin platform seam.",
        body: `The workbench runs on either host from the same commit: on **Cloudflare** as one Worker, on **Google Cloud** as one Node server on **Cloud Run**. The routes, the orchestrator, the gateway, and the agents don't know which host they're on (ADR-018).

**The seam.** Only four things differ, each behind a small interface in \`apps/edge/src/platform/\`:

| | Cloudflare | Google Cloud |
| --- | --- | --- |
| The app's tables (audit, image drafts, architecture, squad library) | D1 | Firestore |
| Models (the default; the top bar can switch) | Workers AI through AI Gateway, or Vertex AI | Vertex AI: gpt-oss-120b as a managed model, Gemini images, Claude |
| Sign-in | Cloudflare Access | Identity-Aware Proxy, plus a members list in Firestore |
| Chats | A Durable Object per user | A Node agent host, each chat saved to Cloud Storage |

::: details How feature code reaches each platform
Feature code asks \`dataPlatform(env)\` for repositories (D1, or the Firestore the GCP host puts into the environment) and \`modelPlatform(env, choice)\` for models. The HTTP routes live in \`app.ts\`; each host supplies only where chats run, how static files are served, and what readiness reports.
:::

**The AI platform is chosen apart from the host (ADR-021).** Workers AI and Vertex AI are AI SDK providers in one registry, so code asks for \`workers-ai:@cf/openai/gpt-oss-120b\` or \`vertex:@cf/openai/gpt-oss-120b\` the same way.
- The top bar's **AI platform** menu (beside Brand and Run as) lists what this server can reach and sends the choice with every chat message and workspace request. Cloudflare offers Workers AI, plus Vertex AI once it holds Google credentials; Google Cloud offers Vertex AI.

::: details Credentials, tracing and narrowing the menu
- The Worker needs no Google key: through **Workload Identity Federation** it signs its own short-lived token, which Google's Security Token Service exchanges for an hour's access as a service account that may only call Vertex AI.
- The route map and trace name the platform each turn ran on. A Vertex turn has no AI Gateway hop, whichever host served it.
- \`AI_PLATFORMS_ENABLED\` (in \`wrangler.jsonc\`, or a Cloud Run environment variable) narrows the menu: a comma-separated list; a platform left out is neither listed nor run, even if requested.
:::

::: details Chats, models and sign-in on Google Cloud
**Chats without Durable Objects.** The orchestrator extends the Agents SDK's chat agent. On Google Cloud the server bundle swaps that one import for a Node implementation of the same WebSocket protocol, so the browser's \`useAgentChat\` and the orchestrator are unchanged. As in a Durable Object, a chat keeps all its storage (messages, state, turn history, Salesforce tokens) in one in-memory SQLite database. The host saves it to Cloud Storage after each change, and the save fails if anyone else saved the chat since it was loaded. One Cloud Run instance with session affinity keeps each chat on a single writer.

**Models.** Vertex AI serves gpt-oss-120b as a managed model, the family the agents were evaluated on, but no gpt-oss-20b. So on Vertex the chat orchestrator (20b on Workers AI) and the catalog's other Workers AI models run 120b, and the trace names the model served; campaign images come from Gemini's image model. Two things follow the host, not the menu: on Google Cloud the answer-quality judge (Clef on Workers AI) is gpt-oss-120b answering the same rubric, and the squad's Anthropic provider reaches Claude on Vertex while OpenAI stays off until approved.

**Sign-in and Salesforce on Google Cloud.** IAP signs each request it lets through; the server checks that assertion, then looks the email up in Firestore's \`members\` collection for the role, which IAP doesn't carry. Requests that bypass IAP are refused. The chat connects to Salesforce's hosted MCP server directly, with OAuth and PKCE, storing tokens encrypted in the chat's own storage (on Cloudflare, per-user OAuth goes through an Access MCP portal). The Lightning surface needs an Access token, so it stays on Cloudflare.
:::

::: details How the page names its host, and the hourly job
**The page names its host.** \`packages/contracts/src/host.ts\` says what each host calls its sign-in, models, database, storage and scheduler. The Google Cloud server tags its page with \`<meta name="northstar-host" content="google-cloud">\`; the Worker leaves it untouched. The browser reads the tag once, so one build names the right services in the route map, image workflow, squad providers, identity chain, and this course. The course is written once, with inline host and AI-platform markers that \`apps/web/src/learn/variants.ts\` resolves: host from the meta tag, platform from the **AI platform** menu. \`docs/learn.md\` is the Cloudflare/Workers AI edition; \`docs/learn-google-cloud.md\` the Google Cloud edition.

**Maintenance.** The hourly job (audit pruning, drift sweeps, memory expiry) runs from the Worker's cron, or from Cloud Scheduler calling the service with a Google-signed token only its service account can get. Firestore's time-to-live policies also delete expired rows as a backstop.
:::
`,
        inDemo: [
          "apps/edge/src/app.ts, apps/edge/src/platform/",
          "apps/gcp/src/ (the Node host, Firestore, Vertex AI, Cloud Storage)",
          "scripts/gcp/bootstrap.sh, scripts/gcp/deploy.sh, infra/gcp/README.md",
          "docs/decisions/ADR-018-google-cloud-target.md",
          "Top bar → AI platform; GET /api/ai-platforms; docs/decisions/ADR-021-ai-platform-apart-from-host.md",
          "apps/web/src/learn/variants.ts; docs/learn.md, docs/learn-google-cloud.md",
        ],
        resources: [
          R.cloudRun,
          R.firestore,
          R.vertexGptOss,
          R.iapCloudRun,
          R.cfChatAgents,
          R.aiSdkRegistry,
        ],
      },
      {
        id: "workspace",
        title: "The workspace: focus, context, and records",
        summary:
          "A per-chat, structured model of the work, built from tool results rather than model text.",
        body: `Each chat has a **working set**, shown in the Workspace panel and summarized in every prompt. **New chat** empties it. It has three parts:

- **Focus:** the draft being built, as structured data: title, labeled fields, change note, and the context it came from.

::: details How a draft becomes the focus
- A campaign's focus is the **brief** Marketing Cloud's Campaign Creation agent drafted, read field for field from its reply (Key Message, Target Audience, Primary Goal, and so on), or from the answer if no brief comes back.
- Other drafts, such as Content Builder agent copy, are read from the answer's labeled parts: "**Headline:** …" on one line, or a label heading the lines below ("Body:" then bullets, "Ruled out" then a table, one line per row). A two-column table ("| Subject | … |") gives one field per row; HTML line breaks in it read as line breaks.
- After a claims check, the draft card shows its claims review: every factual sentence approved, or each flagged one with why.
- Each revision is a new version; earlier ones stay viewable. Once saved, the focus shows the brief's campaign preview, then the campaign and flow Salesforce read back.
:::

- **Context:** cards for what tools returned, each with source and fetch time: weather, forecasts, weather alerts, public holidays, the Federal Reserve's latest rate decision, store inventory, the inventory risk the workbench computed, the restaurant profile, graph evidence, remembered work, and Salesforce summaries.
- **Records:** records the chat opened, created, or updated in any connected system, plus any reopened from memory (marked *Remembered* until read again). Every system, Salesforce or restaurant data alike, joins through one reference: system, object type, and id.

Why it's trustworthy:

1. **Deterministic ingestion.** Cards and records come from tool results through code, never from model text, so nothing is invented.
2. **Open versus available.** Records the systems make available are listed separately as a catalog, so the model never acts on one the chat hasn't opened.
3. **Approvals come to you.** An **action card** appears in the chat when something needs approval: save the brief in Marketing Cloud, then create its campaign, or request a review after a readiness check. Accepting it prepares the confirmation card, with Salesforce's permission check.
4. **Writes act on what you see.** Saving asks the Campaign Creation agent to save exactly the focus version on screen, recorded in the confirmation's request hash. The Brief, Campaign, and flow then appear in Records as Salesforce read them back.

::: details Life-sciences cards and the claims check, row by row
**Life-sciences cards.** The three Lumera tools add a target list, a claims check and a hospital plan, each with a summary line. The life-sciences systems add a card per answer, named for the system, so what came from Aprimo, Reltio or Drupal stays visible beside the graph's evidence. Each row has a status label, an ID and the date that matters: Aprimo assets as usable (with MLR ID and approval date) or not and why (pending review, expired, failed a check); Vault library claims with status; Screendragon jobs with stage and due date; HCP pages as compliant or not.

**The claims check, claim by claim.** One row per claim, usable first: a verdict (usable, blocked, no approved content, content needs MLR), the claim, and why it's blocked. Under each: its supporting evidence (the trial, enrollment and result) and every asset carrying it, with MLR ID and whether it's usable. The answer's *Graph evidence* lists every path in words.
:::
`,
        inDemo: [
          "Workspace panel: Focus, Records, and Context",
          "apps/edge/src/working-set.ts, apps/edge/src/focus.ts",
          "Issue #46: session working set",
        ],
        resources: [R.contextEngineering, R.writingTools, R.buildingAgents],
      },
      {
        id: "model",
        title:
          "The model: {{workers-ai: gpt-oss-20b on Workers AI || vertex: gpt-oss-120b on Vertex AI}}",
        summary:
          "{{workers-ai: An open-weight reasoning model served at the edge, chosen by evaluation. || vertex: An open-weight reasoning model, served as a managed model on Vertex AI.}}",
        body: `The orchestrator runs {{workers-ai: **gpt-oss-20b**, OpenAI's open-weight reasoning model, on **Workers AI**, through **AI Gateway** for logging and cost visibility. || vertex: **gpt-oss-120b**, OpenAI's open-weight reasoning model, as a managed model on **Vertex AI**.}}{{google-cloud:  Every model call is logged to Cloud Logging.}} Its ID is set in one place: \`PROOF_DEFAULTS.orchestratorModel\`.

- **Why {{workers-ai: 20b || vertex: the catalog names 20b}}:** after the routing and reliability fixes, 20b matched or beat gpt-oss-120b through the pipeline at about 60% of the latency and lower cost (see *Evaluations*).{{vertex:  Vertex AI serves no 20b, so the orchestrator runs the 120b it was compared with, and the trace names the model served.}}
- **Where it runs.** The top bar's **AI platform** menu {{cloudflare: picks Workers AI or Vertex AI || google-cloud: shows where the models run: Vertex AI on Google Cloud}} (ADR-021).

::: details The model's tool-calling quirks
- **Its quirks** shaped several guards: it sometimes writes a tool call into its reasoning or answer instead of calling the tool, and leaks its "harmony" channel markup into tool names.
:::
`,
        inDemo: [
          "packages/contracts/src/index.ts (PROOF_DEFAULTS)",
          "Evaluations view: model comparison",
          "docs/decisions/ADR-005",
        ],
        resources: [R.gptOss20b, R.gptOssRepo, R.harmony, R.workersAi, R.aiGateway],
      },
      {
        id: "mcp",
        title: "Tools and the Model Context Protocol (MCP)",
        summary:
          "A standard way for agents to discover and call tools, and the MCP servers the demo uses.",
        body: `**Tool calling** lets a model ask the host to run a function with structured arguments and get the result. **MCP** standardizes it: a server advertises tools (name, description, JSON Schema for input), and clients list and call them over a transport such as streamable HTTP.

| Server | Tools | Reached |
|---|---|---|
| **Salesforce Hosted MCP** | 14 governed tools backed by Agentforce agents and Apex actions | Remote, per-user OAuth |
| **Campaign context** | Restaurant profile and store inventory (mocked); live weather and forecasts (Open-Meteo) | In-process; also \`/mcp/campaign-context\` |
| **External services** | Public holidays (Nager.Date) and weather alerts (National Weather Service), both free public APIs | In-process |
| **Knowledge graph** | Nine curated Neo4j queries, plus three memory recall tools in chat | In-process; also \`/mcp/knowledge-graph\` |
| **Life sciences** (\`northstar-life-sciences\`) | Mocked pharma systems, below | In-process |

In-process servers use an in-memory MCP transport: the real protocol, no network hop. External MCP clients reach the same servers over HTTP, behind {{cloudflare: Cloudflare Access || google-cloud: Identity-Aware Proxy}}.

::: details How loosely typed tool inputs are accepted
Tool inputs are typed, but models don't always type them exactly: the life-sciences tools accept a drug's name ("Cardivance") or its ID, and a channel or status in any case. The model still sees the strict values; only an input that matches nothing is rejected.
:::

**Life-sciences systems (mocked).** Pharma marketing runs on more than Salesforce. These read-only tools answer from the same fictional drugs, claims, MLR approvals and hospitals as the knowledge graph, so one system can be checked against another. None is a live connection.

::: details The mocked life-sciences tools, system by system
- **Aprimo** (digital assets, MLR workflow): \`aprimo_search_approved_assets\` (a drug's assets, MLR approval, expiry, usable now or not); \`aprimo_get_mlr_review\` (the medical, legal and regulatory stages, and why one is pending).
- **Reltio** (master data): \`reltio_resolve_organization\` (a hospital's golden record, hierarchy, merged sources, possible duplicates).
- **Veeva Vault PromoMats** (claims library, label): \`vault_list_approved_claims\`, \`vault_get_prescribing_information\`.
- **Screendragon** (work management): \`screendragon_list_jobs\`, \`screendragon_get_job\`, with the MLR approval each job awaits.
- **IQVIA** (prescription data, invented): \`iqvia_get_prescribing_trends\`.
- **Salesforce Life Sciences Cloud**: \`lsc_get_call_plan\`, a hospital's field plan as counts of prescribers.
- **Drupal** (the HCP website): \`drupal_list_hcp_site_content\` flags a live page with an expired approval.
:::

Ask one question across them (is a drug's material consistent across Aprimo, the claims library and the website?) and the orchestrator calls three and points out where they disagree.`,
        inDemo: [
          "Sources list in the left rail (collapsed to a status line)",
          "apps/edge/src/campaign-context, apps/edge/src/knowledge-graph",
          "salesforce/…/mcpServerDefinitions",
        ],
        resources: [R.mcpIntro, R.mcpSpec, R.cfMcp, R.writingTools, R.aiSdkTools],
      },
      {
        id: "salesforce",
        title: "Salesforce: Agentforce agents, Hosted MCP, and Apex actions",
        summary:
          "Salesforce is the system of record, and every Salesforce fact comes from its tools.",
        body: `Salesforce is **authoritative** for campaign data; the orchestrator never invents Salesforce facts. It calls tools on a **Salesforce Hosted MCP server**:

- **Agent-backed tools** each call an **Agentforce** agent defined as an Agent Script bundle. The **Salesforce agents** panel under each answer shows which (see *Structured UI*).

::: details The four Salesforce agents
- **Northstar Campaign Creation** (a Marketing Cloud Next Campaign Creation agent): drafts, saves and refines briefs; creates campaigns and their flows. See *Marketing Cloud Next*.
- **Northstar Content Builder** (a Marketing Cloud Next Content Builder agent): drafts copy and content sections with the standard Draft Content and Create Section actions.
- **Northstar Account Discovery**: Marketing's account discovery and scoring APIs for signals, engagement and buyer groups.
- **Campaign Readiness and Governance**: a custom agent whose Apex actions summarize a campaign and check readiness, consent and brand rules. Custom on purpose: Marketing Cloud Next has no campaign-summary or readiness action, and its standard **Generate Campaign Insights** flow fails in this org until campaigns have sent and gathered engagement data.
:::

- **Briefs and campaigns** come only from the Campaign Creation agent's standard actions, as Marketing Cloud's own **Brief**, **BriefPlanStep**, **Campaign** and campaign **flow** records. The workbench has no custom objects or Apex for them.
- **Other writes** (a review task, an image attachment, an inventory case for a store manager) are global **Apex invocable actions** that verify a signed confirmation.
- **Permission check:** \`check_write_access\`, a read-only Apex action called before any write is prepared, runs as the signed-in user and reports each permission it checked.

The model holds no write tool: only the confirmation flow calls write tools, and every write runs as you (see *Governance*).

::: details How Salesforce metadata is deployed
Metadata (Apex, fields, the permission set, the MCP definition) deploys through a gated CI pipeline to one approved proof org.
:::
`,
        inDemo: [
          "Use cases: Campaign performance summary, Launch readiness and review request",
          "“Salesforce agents” under each answer",
          "salesforce/force-app/main/default/aiAuthoringBundles, salesforce/force-app/main/default/classes",
          "docs/salesforce-deployment-pipeline.md",
        ],
        resources: [R.hostedMcp, R.agentforceTrailhead, R.agentforce],
      },
      {
        id: "marketing-cloud",
        title: "Marketing Cloud Next: agent-built briefs, campaigns, and flows",
        summary:
          "The workbench asks Salesforce's Campaign Creation agent to create briefs and campaigns, the way the Marketing app does.",
        body: `In **Marketing Cloud Next**, a campaign starts as a **brief** and becomes a **campaign with a flow**. The workbench asks Salesforce's **Campaign Creation agent** to do this with standard actions instead of writing records itself.

::: details The agent and its five standard actions
**The agent.** \`Northstar_Campaign_Creation\` is an Agent Script agent built from Salesforce's \`MktCloud__CampaignCreationAgent\` template and published as a Campaign Creation agent. Only Agent Script agents can be Hosted MCP tools, so the workbench reaches it through the \`NorthstarMarketingWorkbench\` MCP server. Its **Marketing Campaigns** subagent runs the standard actions in Salesforce's required order:

| Step | Standard action | What it does |
|---|---|---|
| 1 | Draft a Campaign Brief (\`MktCloud__GenerateBrief\`) | Drafts name, description, key message, audience, goal, CTAs, KPI, guardrails and priority. Saves nothing. |
| 2 | Save Campaign Brief (\`saveBrief\`) | Creates the **Brief** record. |
| 3 | Draft a Campaign Preview (\`MktCloud__GenerateCampaignFromBrief\`) | Plans the messages as **BriefPlanStep** records: channel, wait, subject, preheader, body. |
| 4 | Create Campaign (\`createCampaign\`) | Creates the **Campaign**, linked to the brief. |
| 5 | Save Campaign (\`MktCloud__SaveCampaign\`) | Builds the campaign's **flow** from the preview, as a draft. |

Its **Campaign Refinement** subagent runs **Refine Campaign Preview** on a saved preview ("make the second email shorter").
:::

**How the workbench uses it.**
1. A campaign request (the Coastline plan, or "create a campaign in Marketing Cloud") ends with \`draft_campaign_brief\`. The agent's brief becomes the workspace focus, field for field.
2. **Save brief** (an action card, then a confirmation card): \`save_marketing_brief\` asks the agent to run steps 2 and 3.
3. **Create the campaign** (a second card): \`create_marketing_campaign\` asks for steps 4 and 5.
4. After each write, \`get_marketing_records\` (read-only Apex) reads back the Brief, its steps, the Campaign and the flow. The workspace shows only what Salesforce returned, never the agent's say-so.

::: details How each call is made, and why a retry never saves twice
**One request per call.** Hosted MCP agent tools take a single message, so each call carries everything the agent needs: the confirmed brief fields, or the Brief ID whose preview was confirmed. The agent is asked to include record ids in its reply, and the read-back verifies them. When you change a saved brief, the server adds the Brief ID to the Refine Campaign Preview request if the model left it out (it did in half of the live evaluation runs), so the agent needn't guess which brief you meant.

**Safe to retry.** Marketing Cloud's save actions aren't idempotent, so the workbench checks Salesforce before asking the agent:
- A save sent before and never confirmed (say, it timed out after the agent saved) whose brief Salesforce now shows is linked, not saved again. A same-named brief from another chat is left alone.
- A brief that already has its campaign never gets a second one.
- If the agent call fails, it checks once more, since the agent may have saved before the timeout. Only if nothing is there are you asked to try again.
:::

**What stays in Marketing Cloud.** The flow is created as a draft. Choosing its audience and sender, and activating it, happen in Marketing Cloud; the workbench never sends or activates anything. Previews in this org plan email (and SMS) steps; a push request is recorded in the brief's guardrails.`,
        inDemo: [
          "Use cases: Weather-aware campaign in Marketing Cloud",
          "“Salesforce agents” under each answer, and the confirmation card's agent details",
          "Workspace focus: Brief saved, campaign preview, Campaign and flow links",
          "salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Campaign_Creation",
          "apps/edge/src/marketing-writes.ts",
        ],
        resources: [R.mcnAgentforce, R.mcnCampaignTrailhead, R.hostedMcpAgents],
      },
      {
        id: "routing",
        title: "Routing: policy router, intent router, and scenario toolsets",
        summary: "Deterministic decisions before and around the model.",
        body: `Not every decision belongs to the model. Each turn passes two deterministic routers.

**1. Policy router.** Without calling the model, so it can never claim a write happened:
- "Remember this draft": the server stores the focus in long-term memory.
- Save or create, with a draft in the workspace: the server plans the write from the draft, Salesforce checks your permissions, and a confirmation card appears.
- Other save, create or change requests: a fixed reply pointing to the confirmation flow.
- Publish, send, delete and similar: refused.

::: details How a question differs from a request
A question about what to send ("What can we send clients?") asks for guidance, not an action, and reaches the model. Each sentence that names an action is judged on its own, so context before the question ("The Fed moved rates.") doesn't make it a request.
:::

**2. Classifier and intent router.**
- The **request classifier** labels the request's topic (claims, a target list, Fed news, inventory, …, or *off topic*). Rules label what the scenarios name, instantly; a small model call, run while the tools connect, adds labels the rules missed (a paraphrased claims question) and never removes one.
- A clear intent picks a **scenario**, whose tools are the turn's candidates, never the whole catalog. A request no rule recognises gets the brand's catalog. The rules need specific signals and **defer to the model** when unsure, because wrong tools narrow what the model can do.
- **Cedar policies** decide which candidates are on offer each step, from the labels and what has already run (see *The agentic gateway*). The model chooses among them; nothing forces a call (ADR-019, ADR-020).

::: details Which request takes which route
| Request | Route |
|---|---|
| Labelled *claims* | Only the claims check until it has run, whatever else is asked; then the rest |
| Off topic (lottery numbers, sports scores) | No tools; a brief answer saying what it can help with |
| "Check readiness" | \`check_campaign_readiness\` |
| "Why is X in the buyer group?" | \`explain_buyer_group\` |
| "What did we decide about…?", "last time…" | \`recall_decisions\` |
| "What have we worked on recently?" | \`recall_recent_work\` |
| Outreach to an account's buyer group | \`plan_account_outreach\` → \`get_public_holidays\` for its country |
| Weather alerts or storms near a location | \`get_weather_alerts\` → \`assess_location_impact\` |
| Inventory, stock or ingredients at a location | \`get_weather_forecast\` → \`map_weather_demand\` → \`get_location_inventory\` |
| Fed or interest-rate news and approved content | \`get_fed_announcements\` → \`match_news_to_approved_content\` for the mapped event |
| Market volatility | \`match_news_to_approved_content\` alone |
| An acquisition announcement | \`prepare_deal_release\` |
| An account plan, AUM, a Harborstone client's plays | \`build_aum_account_plan\` |
| A Coastline Kitchen email or push campaign | Profile → weather → past sends on that channel → the Campaign Creation agent's brief, which becomes the focus |
| "Create a campaign … in Salesforce" / "in Marketing Cloud" | The agent's brief, then the save is prepared for confirmation |
| A change to a brief ("make it warmer") | Back to the agent: a re-drafted brief before saving, **Refine Campaign Preview** after |
| A change to other drafts | No tools; the model rewrites it as the next version |
| A target list or prescriber groups | \`build_hcp_target_list\` |
| Clinical claims, off-label use, a boxed warning, a Lumera drug beside *claims* | \`check_clinical_claims\` |
| A named hospital with formulary, P&T, access or a plan | \`plan_hospital_engagement\` |
| Aprimo, Reltio, Vault, Screendragon, IQVIA, Life Sciences Cloud, Drupal, an MLR or job ID | The matching life-sciences tool |
| A Lumera drug's materials consistent *across* systems | Three systems at once |

For life sciences, the model is told only supported, on-label, MLR-approved claims can be used and groups are never people. If the chosen brand excludes the tool a request needs, the router says so instead of calling anything.
:::

**Checks first, Marketing Cloud last.** Every new draft starts with its brand's claims checks and ends with Marketing Cloud's agents, whatever order the prompt implies: Lumera runs \`check_clinical_claims\` → \`aprimo_search_approved_assets\` → the brief; Harborstone \`get_fed_announcements\` → \`match_news_to_approved_content\` → the brief. The model drafts from what the checks allow and lists what it ruled out and why before asking for the brief. The header's brand decides the checks (with all brands, the one the request names). Coastline has no claims library in chat, so it starts from the restaurant's context. A revision of a brief in focus goes straight back to the agent.

**Guardrails, not mandates.** Within a scenario:
- **Look before you answer.** The first step must call one of the scenario's tools, so answers about Salesforce or the graph start from evidence.
- **Ground before you draft.** A Marketing Cloud agent (it drafts and creates in Salesforce) is offered only once every tool planned before it has worked (a Cedar policy).
- **Fix, don't fail.** A failed tool (say, a rejected argument) stays on offer so the model can correct it.
- **Then write.** When every planned tool has worked, or on the last step, the model gets **no tools** and must answer. It may answer sooner, once it has enough.`,
        inDemo: ["apps/edge/src/turn-policy.ts", "Turn history: “Interpretation” for each turn"],
        resources: [R.buildingAgents, R.writingTools],
      },
      {
        id: "reliability",
        title: "Reliability guards for tool calling",
        summary: "How the demo keeps a small model's tool calls on track.",
        body: `Small reasoning models fail at tool calling in predictable ways. The tool-call guard, a language-model middleware, handles each without deciding which tool the model calls (ADR-019).

::: details The full list of failure cases
| Failure | What the guard does |
|---|---|
| Tool call written into reasoning or answer text | Recovers the JSON arguments if they match the tool's schema; hides the leaked text |
| Channel markup or a dropped prefix in a tool name | Repairs the name when exactly one real tool matches |
| Arguments that aren't valid JSON | Escapes raw newlines in strings, drops anything after the object (a literal "\\n", channel markup), reads \`<arg_key>\`/\`<arg_value>\` markup. Arguments cut off mid-call count as no call |
| A call in reasoning that doesn't name the tool | On a must-call step, makes the call if exactly one offered tool fits the arguments. On a free step, only if the step produced nothing else, so an answer never becomes a call |
| No usable call on a must-call step | Retries the step once |
| A tool call in an answer step (no tools offered) | Drops it; if that was all, retries the answer once |
| Runaway reasoning | Caps must-call steps at 2,048 tokens, reasoning included; a detailed request to a Salesforce agent can take several hundred alone |

A mangled name looks like \`summarize_campaign<|channel|>analysis\`.
:::

Per turn:
- Structured timeouts cover the whole turn, gaps between chunks, and each tool call.
- Errors and empty answers become an explanatory message, not silence. If the Campaign Creation agent drafted a brief but the model wrote no reply, the answer is written from the brief's fields.
- {{workers-ai: Workers AI capacity errors || vertex: Model capacity errors}} are explained in plain language.`,
        inDemo: [
          "apps/edge/src/forced-tool-middleware.ts",
          "apps/edge/src/turn-trace.ts",
          "Technical trace: “Recovery message added”",
        ],
        resources: [R.aiSdkTools, R.harmony],
      },
      {
        id: "governance",
        title: "Governance: permissions, confirmations, and kill switches",
        summary:
          "Salesforce decides who may write, a person approves every write, and operators can turn things off.",
        body: `Every write (a brief, campaign and flow through Marketing Cloud's Campaign Creation agent; a review task, image or inventory case) follows one flow:

1. **Plan.** The server builds the request from the workspace draft, so the values are exactly what you reviewed. A review task or image targets a campaign this chat opened from Salesforce, never one only reopened from memory.
2. **Permission check.** Before anything is prepared, Salesforce checks **as you**: the workbench permission set, the Marketing User feature for campaigns, create or edit access on each object, field-level security, and record edit access for updates. The card lists every check; if one fails, nothing is prepared and the card says why.
3. **Confirmation.** The card shows what will be created, its values, the draft version and, for briefs and campaigns, the agent and the standard actions it will run. It's bound by a SHA-256 request hash and a 5-minute expiry, and works once.
4. **Execute.**
   - **Brief or campaign:** the Campaign Creation agent runs its standard actions through its Hosted MCP tool, as you, so Salesforce enforces your permissions on each.
   - **Review task, image or inventory case:** the {{cloudflare: Worker || google-cloud: server}} signs the confirmation with HMAC. Apex verifies signature, expiry, same user and hash, then writes in **user mode**. An inventory case's contents come from the {{cloudflare: Worker || google-cloud: server}}, so its hash covers exactly those contents and Apex re-hashes what it receives.
5. **Read-back.** The records are read back from Salesforce (\`get_marketing_records\` for Marketing Cloud), and only what Salesforce returns is shown. If the agent claims a save Salesforce doesn't show, nothing is shown as saved.

::: details How each step shows live
Each step shows live. Preparing: the plan, the permission check (how many passed), binding to a one-time confirmation. Running: the confirmation check, a look for an earlier attempt or the signing, the agent or Apex call, the read-back, the memory record. A failure marks where it stopped and why.
:::

**Approved claims, word for word.** Once the chat has checked a brand's claims, each saved draft is reviewed sentence by sentence, as Journeys checks a module: a sentence stating a fact or what the product does must be an approved claim's exact text. Rewording an approved claim, restating a blocked one, or asserting what no claim says ("can improve outcomes") is flagged on the draft card with the reason, and saving to Marketing Cloud waits for a revision that clears it. Legal text, IDs and logistics (safety information, MLR IDs, send time, audience) aren't checked. The model drafts with the exact approved and blocked claims in front of it.

| Layer | Responsible for | Not responsible for |
|---|---|---|
| **The model** | Drafting and proposing saves | Writing anything: it has no write tools |
| **The workbench** | Planning from your draft, asking Salesforce for a permission check, hashing, reading back | Deciding who may write, or creating briefs and campaigns itself |
| **The Marketing Cloud agent** | Marketing Cloud's standard actions for briefs, previews, campaigns and flows | Deciding what to save: it saves what you confirmed |
| **You** | Reviewing exact values and confirming | — |
| **Salesforce** | Authorization (profile, permission sets, field-level security, sharing), signature checks for Apex writes, the records, read-back | — |

::: details The kill switches and what they turn off
**Kill switches.** \`WRITES_ENABLED\`, \`DISABLED_TOOLS\` and \`MEMORY_ENABLED\` are {{cloudflare: Worker secrets that operators can flip without a deploy || google-cloud: service settings that operators can change without a rebuild}}. \`DISABLED_AGENTS\` switches a registry agent off; the gateway denies everything it tries. Approval is separate from Salesforce writes: a workbench object becomes *approved* only through the state machine, by a person (see *Agents, prompts, models, and drift*).
:::

**Read-only elsewhere.** Graph tools run read-only; only the server's fixed memory statements write, and only to the memory dataset. External-services tools read public data only (holidays, weather alerts, Federal Reserve press releases) and send nothing about customers. No customer PII enters prompts, logs or the graph.`,
        inDemo: [
          "Draft something → the Save to Salesforce action card in the chat → confirmation card with the permission check",
          "Check readiness → the Request a review action card → confirmation card",
          "Attach to campaign on a generated image",
          "infra/cloudflare/pot/README.md (operator runbook)",
        ],
        resources: [R.owaspLlm, R.buildingAgents],
      },
      {
        id: "ui",
        title: "Structured UI: Markdown, HXL cards, and native fallbacks",
        summary: "Answers render as rich text, and records render as governed cards.",
        body: `- **Markdown answers.** The model may use concise Markdown, rendered with \`react-markdown\`, which never renders raw HTML, so model output can't inject markup.
- **HXL cards.** Salesforce's HXL widgets (MCP Apps) let an agent action return a typed, interactive card, such as campaign readiness. Where HXL can't render, an accessible **native fallback** is built from the same contract.

::: details How native cards show each item
- **Item rows on native cards.** A list result shows one row per item: a colored status (usable, waiting, blocked), the item, a monospaced ID and a readable date, so an MLR ID and its expiry stand out. A row can list what stands behind it, such as a claim's trial evidence and the assets that carry it.
:::

- **Salesforce agents panel.** Under each answer that called Salesforce: each call's agent, type and template, subagent, and actions (with their flow or Apex targets). The confirmation card shows the same for its write.
- **Graph evidence panel.** Knowledge-graph paths render as directional chains, each with a screen-reader text alternative. Claims checks show claim by claim in *The workspace*.

::: details Write progress, the case confirmation and the left rail
- **Live write progress.** Accepting an action card shows **Preparing…** and the preparation steps until the confirmation card appears. **Confirm** disables the buttons and shows the write's steps as the {{cloudflare: Worker || google-cloud: server}} reports them. Afterwards a collapsible **Behind the scenes** record keeps each step and its duration, opening by itself if the write fails.
- **Inventory case confirmation.** The store manager, the forecast, and each low item (on hand, needed, the dishes it goes into). After you confirm, a banner links to the Case.
- **Left rail.** Data sources fold into one line (how many are ready, which are offline); open it for the full list. The **MCP Gateway** box below stays open: the Salesforce connection's state, how many governed tools are connected, and which.
:::

- **Use-case library.** Every scenario, filterable by team, with prompts, systems and data flow. **Try it** fills the chat box without sending.
- **Accessibility.** Targets WCAG 2.2 AA; tested in Chrome and Edge.

**Architecture workspaces.** Each **Architecture** tab is a *workspace manifest* (the roles, objects, tiles, agents and services it composes) drawn by one renderer, so a new workspace is data, not a new screen. The same approval card also renders as an Adaptive Card, as data for a Lightning Web Component, and as an MCP Apps resource. See *Governed objects and workspaces*.

**One scope in the header.** **Brand** and **Run as** apply everywhere: the chat (the message box suggests a prompt for the brand), the Graph's brand filter, the use-case library, the Architecture workspaces and the turn history. **AI platform** {{cloudflare: picks where the models run: Workers AI or Vertex AI || google-cloud: shows where the models run: Vertex AI only}}. It lists only what this server can reach, says why an option isn't set up, and is greyed out with one choice (ADR-021). Choices are remembered in the browser.

::: details Every page's address
**Every page has an address.** Each left-rail page has a path: \`/squad\`, \`/architecture\`, \`/journeys\`, \`/graph\`, \`/learn\`, \`/evaluations\`, plus \`/history\` and \`/use-cases\` from the chat (itself \`/\`). Reloads stay put, links open the page, and Back returns to the previous one.
:::
`,
        inDemo: [
          "Workspace panel (readiness card with native fallback)",
          "apps/web/src/Markdown.tsx, apps/web/src/GraphEvidence.tsx",
        ],
        resources: [R.hxl, R.reactMarkdown, R.wcag],
      },
      {
        id: "observability",
        title: "Observability: route map, technical trace, turn history, and audit export",
        summary: "See exactly what happened in every turn.",
        body: `- **Route map** (above the message box, in the browser and in Lightning) lights each component a turn passes through, pulsing on the one working now: the page, {{cloudflare: Cloudflare Access || google-cloud: Identity-Aware Proxy}}, the policy router, {{workers-ai: AI Gateway and Workers AI || vertex: Vertex AI, called directly}}, then the agentic gateway and each MCP server. A Lightning turn also shows the Apex relay. The model hop names the AI platform the turn actually ran on (ADR-021).{{cloudflare:  A turn that ran on Google Cloud says so in its trace, and its map shows Identity-Aware Proxy in place of Access.}}

::: details How the route map reads a turn
- It reads the same trace as the view below, not a script: a turn the policy router answers leaves the model dark; a tool the gateway denies marks the gateway, not the system behind it; a failed tool marks its system. The first hops are implied (a request can't reach the {{cloudflare: Worker || google-cloud: server}} without them); the router, model and tools are recorded.
- The finished route stays until the next message. It follows the query only: a confirmed write runs after the turn and shows its progress on its confirmation card. Lightning polls about once a second, so a shorter hop can appear already passed.
:::

- **Live tool calls** under the trace while an answer streams: system and tool, a spinner until the result returns, then a check or a cross.
- **Technical trace** at the top of each answer, so the streaming answer doesn't move it: every lifecycle event in order, with timing. It opens while the answer streams (or when something went wrong) and stays open until you close it.

::: details Every event the trace records, and the operator logs
- turn start; step start and finish (finish reason, token counts); reasoning start and end, with the reasoning redacted; text start and end
- tool input and output, with the Salesforce agent, subagent and actions behind each Salesforce tool; errors; recovery messages; the outcome, including an answer written from a tool's result because the model wrote none
- a failed or empty tool result names the system that answered (Aprimo, the knowledge graph, Salesforce) and whether the call failed or returned nothing usable
- a closing line: the turn's total time, **tokens** (input plus output, summed over steps) and **tool calls**
- **{{cloudflare: Workers Logs || google-cloud: Cloud Logging}}** for operators: a failed Salesforce or agent call is logged with its error and stack, even when the user sees a friendly message; a failed write or confirmation logs the step where it stopped. Request content is never logged.
:::

- **Turn history** (Chat → History → Turns): each utterance with the orchestrator's interpretation, tool calls with inputs and results, the outcome, and the brand and role it ran under; each row shows seconds, tokens and tool calls. Filterable; kept 24 hours per user.
- **Memory** (History → Memory): what the workspace remembers across chats, with provenance, **Reopen** and **Forget**. See *Long-term memory*.
- **Audit export:** a JSON download of the user's confirmed writes, memory remembers, reopens and forgets, and turn summaries.`,
        inDemo: [
          "Chat → the Route panel above the message box",
          "Any answer → “Behind the scenes · technical trace”",
          "Chat → History → Export audit (JSON)",
          "Chat → History → Memory",
        ],
        resources: [R.aiGateway, R.contextEngineering],
      },
      {
        id: "evaluations",
        title: "Evaluations",
        summary: "Measure the whole pipeline across models, and publish the real results.",
        body: `\`pnpm eval:live\` runs the **production pipeline** (policy router, intent router, prompt, guards, step settings) against live Workers AI models, in three suites:

- **Demo scenarios:** the use-case library's prompts, through the full pipeline.
- **Routing through the pipeline:** a shared prompt set, including memory recall and the financial services use cases, as evaluators experience them.
- **Routing by the model alone:** the same prompts with no routers, isolating model quality.

Each turn is scored on **right tool** (or right plan, in order), **answered**, **no tool errors**, **no false write claims**, and two grounding checks:
- **graph-grounded:** a graph or memory answer names only accounts, clients, people, campaigns, content, menu items and compliance approval IDs its tools returned
- **agent request grounded:** the request the Marketing Cloud Campaign Creation agent actually receives carries what the turn gathered: a brief request names the brand, a menu item, and the city or weather; a preview refinement names the saved Brief ID

Latency and tokens are recorded before judging. The Evaluations view shows each turn's seconds, tokens and tool calls, and each model's mean tokens and tool calls per turn. Runs recorded before the grounding check show no rate for it.

**What good looks like.** Pass/fail says the pipeline behaved, not that the answer was *good*. Each demo scenario has a **rubric** in \`packages/evals/src/rubric.ts\`: a goal, an audience persona where a customer is involved, weights for the quality dimensions that matter, and deterministic **criteria** (for the weather-aware Coastline campaign: names a menu item, uses the real weather and time of day, cites what worked before, a key message of 160 characters or fewer, a measurable KPI). "Criteria met" is reported beside the pass gate, so pass rates stay comparable with earlier runs.

**Quantifying the qualitative.** Two judges from different families (GLM-5.3 and DeepSeek V4.1 Flash; a model never judges its own family) rate each answer 1 to 5 on anchored scales: context fidelity, accuracy, clarity, brand voice, engagement, marketer usefulness, and **would act**, which the judge answers as the audience persona on a standard purchase-intent scale (reported as top-2-box, the share of 4s and 5s). Ratings combine into a 0 to 100 **Quality Index** with a 95% bootstrap interval, alongside how often the judges agree. Before a run is published, \`pnpm eval:calibrate\` checks that each judge ranks hand-written strong, mediocre and weak answers in the right order. These are judge scores, not customer behavior: use them to rank models, not to forecast click rates.

::: details Why one fixed model plays the Marketing Cloud agent
**A fixed stand-in for the Marketing Cloud agent.** The real agent's copy doesn't depend on the orchestrator model, so every contestant would get the same canned text. One fixed reference model plays the agent, so what differs is what the orchestrator asked for (weather, time, menu, past results) and how it presents the result.
:::

::: details How cost is estimated, capped and throttled
**Cost.**
- Every turn, judge call and simulated-agent call is priced from Cloudflare's published Workers AI per-million-token rates (neurons derived at $0.011 per 1,000): list rates before account-level allowances, shown to four decimal places.
- The run prints a projection and refuses to start above \`--max-usd\`. The report shows estimated USD per demo-scenario turn and per passing turn, a cost-versus-quality chart, and a run total including judges and the simulated agent.
- The default run compares gpt-oss-120b and gpt-oss-20b; the paid-access frontier model, DeepSeek V4.1 Flash, is opt-in with \`--tier frontier\`. GLM-5.3 stays on the judge panel.
- Kimi K2.6, GLM-5.3-Flash and DeepSeek V4 Pro left the roster when Workers AI retired them on November 20, 2026. GLM-4.7-Flash and Llama 4 Scout scored low and were retired in ADR-011.
- Cloudflare limits paid frontier models to 20 requests a minute per model, so the runner throttles every call (turns, judges, simulator) per model, serves contestant turns before judge calls, and refreshes its sign-in token during long runs.
:::

::: details Routing checks and the life-sciences scenarios
**Routing checks.** \`pnpm eval\` runs the routing set through the production policy and intent routers, without a model, on every verify. In the live run, read-style Salesforce tools are fixtures, so scores measure orchestration, not Salesforce agent quality. A held-out set of paraphrases guards the router against overfitting. The first published run found a real routing bug: any prompt mentioning "campaign" forced the summary tool.

**Life-sciences scenarios.** Four Lumera Therapeutics scenarios:
- A target list, a claims check and a hospital plan, whose rubrics check that the answer cites the trial and MLR approval IDs the tools returned, blocks unsupported and off-label claims instead of rewording them, and names groups rather than clinicians.
- One drug's materials compared across Aprimo, the claims library and the HCP website; the rubric checks that the answer names the systems, flags the page that is live with an expired approval, and says the systems are mocked.
:::
`,
        inDemo: ["Evaluations view", "scripts/run-live-evals.mjs, packages/evals"],
        resources: [R.evals, R.buildingAgents],
      },
      {
        id: "images",
        title: "Campaign image workflow",
        summary: "Generate reviewable variants, then attach one to Salesforce after confirmation.",
        body: `{{workers-ai: **FLUX.2 klein** on Workers AI || vertex: **Gemini's image model** on Vertex AI}} (following the top bar's **AI platform**) generates a 1024×1024 draft from a bounded prompt, with PII and injection checks on the concept. Each draft records which model drew it.

::: details Where drafts are stored
- Drafts are stored privately in {{cloudflare: **R2** || google-cloud: **Cloud Storage**}} for 7 days, with provenance (model, prompt version, content hash) in {{cloudflare: **D1** || google-cloud: **Firestore**}}.
:::

- The variant gallery lets you select, reject or revise.
- **Attach to campaign** runs the confirmation flow: Apex checks the PNG's SHA-256 against the confirmed hash, creates one Salesforce file on the Campaign, and reads back its checksum and link.`,
        inDemo: ["Workspace → Generate campaign visual (expand it) → Attach to campaign"],
        resources: [R.flux, R.r2, R.d1],
      },
      {
        id: "campaign-context",
        title: "Campaign context: restaurant data and live weather",
        summary: "External context that makes a campaign draft specific to the moment.",
        body: `The **campaign-context** MCP server gives the orchestrator facts Salesforce doesn't have:

- \`get_restaurant_profile\`: the restaurant system's data for **Coastline Kitchen**, a fictional fast-casual brand under Northstar, open 24/7: five California locations, menu, favorites, dayparts, app audience with opt-ins **by channel** (push, email, SMS), brand voice and promotion rules. Locations and menu items share ids with their knowledge-graph nodes.
- \`get_current_weather\`: live conditions for a California city from **Open-Meteo** (free, keyless, CC BY 4.0).
- \`get_weather_forecast\`: Open-Meteo's daily forecast, with each day's demand-planning weather (heat, rain, fog, cloudy or clear).
- \`get_location_inventory\`: a restaurant's stock from a randomized **store inventory** mock, with par levels and typical daily use from the menu's recipes. See *The use-case library*.

The Coastline campaign plan (email or push) chains these with the knowledge graph's past performance and the Salesforce content tool. It is **channel-aware**: the server pins the requested channel (or the draft's) on the past-performance lookup, so an email campaign cites email opt-ins, never push, whatever the model passed. The draft fits the menu, time of day, weather and what worked before, is saved to the workspace **focus**, and "make it warmer" revises it as a new version.`,
        inDemo: [
          "Use cases: Weather-aware campaign in Marketing Cloud (the push prompt)",
          "Sources: Restaurant data, Weather · Open-Meteo",
        ],
        resources: [R.openMeteo, R.mcpIntro],
      },
      {
        id: "use-cases",
        title: "The use-case library: marketing, sales, service, and financial services",
        summary:
          "Every scenario the demo runs, how data flows through it, the ones that reach beyond marketing, and three for a regulated industry.",
        body: `**Use cases** (a button on the Chat page) lists every scenario the demo runs end to end: the situation, its prompts (each with **Try it**), the systems involved, the data flow step by step, what the knowledge graph contributes, what it writes, and what to watch for. Drafted scenarios not yet built are greyed out as *Coming soon*. The library follows the header's brand: choosing Lumera Therapeutics shows only its use cases.

**Beyond marketing.** Two use cases (sales outreach and severe-weather impact) each pair a free, keyless public API with the knowledge graph, and **the graph supplies the key element**. Both APIs are called live from the {{cloudflare: Worker || google-cloud: server}} through an in-process **external services** MCP server. An API failure comes back as a tool error, and the answer says so instead of guessing.

::: details Sales outreach, weather impact and the inventory check, step by step
**Sales: buyer-group outreach around local holidays.** "Plan outreach to Acme Outfitters' buyer group for the next month."
1. \`plan_account_outreach\` walks from the account to its buying-role personas: each one's engagement, when they last engaged, and **the channels they have marketing consent for** (Persona → HAS_CONSENT → ConsentScope → FOR → Channel), plus the account's headquarters country.
2. \`get_public_holidays\` asks **Nager.Date** for that country's upcoming public holidays.
3. The answer is a prioritized, dated plan on consented channels only, avoiding the holidays. Nothing is sent or logged.

**Service: severe-weather customer impact.** "There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?"
1. \`get_weather_alerts\` asks the **National Weather Service** for active watches, warnings and advisories at the restaurant's coordinates, or, if none, alerts elsewhere in California.
2. \`assess_location_impact\` walks Location ← Segment → consent and Campaign → TARGETS → Segment: how many app users are near, how many each channel (push, email, SMS) can reach under its own consent, and which active campaigns target them and should be paused. Counts are aggregate; no customer is named.
3. The answer is an impact summary, a drafted customer notice and a note for the store team. Nothing is sent or paused.

**Service: weather-driven inventory check, with a case for the store manager.** "Check inventory for our Sacramento store against the forecast."
1. \`get_weather_forecast\` buckets each day of the **Open-Meteo** forecast: **heat** for highs of 88°F or more, **rain** for wet days, otherwise fog, cloudy or clear.
2. \`map_weather_demand\` walks WeatherCondition → **LIFTS_DEMAND** → MenuItem → **MADE_WITH** → InventoryItem, plus Location → **MANAGED_BY** → StoreManager. Each lift is learned from past push results (a dish's average order rate under that weather against its overall average) and kept when at least 15% higher. Heat lifts the cold drinks and açaí bowl; rain and fog lift soup, noodles and the burrito.
3. \`get_location_inventory\` reads the **store inventory system**, here a randomized mock stable within a day: on hand, par level and typical daily use per item.
4. **Code, not the model, decides what's low.** Each weather-lifted item's forecast need is its typical daily use, raised by the lift on days whose weather lifts a dish made with it; it's low when what's on hand won't cover that. The result becomes an **Inventory risk** card and an **action card**, and the answer step is told exactly this list.
5. Accepting the card prepares a **Salesforce case** for the store manager. Its contents are hashed into the confirmation's request hash; after you confirm, the \`create_inventory_case\` Apex action re-hashes what it received, refuses any mismatch, finds the manager's Contact by title and restaurant, creates the Case as you, and reads it back. The graph and prompts carry the manager's name only, never contact details. Nothing is ordered.
:::

**Financial services: Harborstone Wealth**, a fictional wealth-management brand under Northstar. Three use cases (filter **Financial services**) show the graph in a regulated industry, where only content a registered principal approved can go out, exactly as approved, with its required disclosures.

::: details The three Harborstone use cases
- **Market news to pre-approved content.** "The Fed just announced its rate decision. What pre-approved content can we send clients today?"
  1. \`get_fed_announcements\` reads the Federal Reserve's public press feed, finds the latest FOMC statement, reads its decision (raise, lower or maintain; the size; the new target range) and maps it to a market event.
  2. \`match_news_to_approved_content\` walks MarketEvent ← **RESPONDS_TO** ← ContentAsset → **APPROVED_UNDER** → Approval and → **REQUIRES** → Disclosure. It returns what's ready to send (approval IDs, expiry, disclosures); what's blocked and why (an expired or pending approval, or a **FAILED** compliance rule); reach per channel under marketing consent; and past responses, which show sends within hours of the news opened far better than next-day sends.
  3. The answer never writes new regulated copy. Asking for a Marketing Cloud campaign hands the approved asset, its approval ID and disclosures to the Campaign Creation agent's brief.
- **Acquisition announcement, released on time.** \`prepare_deal_release\` orders the embargoed package through **RELEASED_WITH** → Deal and checks each piece's audience through **ADDRESSED_TO** → Segment → **HAS_CONSENT**: advisors' FAQ first, then the press release, then client letters. The acquired firm's clients get service notices under their client agreement, never marketing, until they opt in, so an SMS that also failed its disclosure check is blocked for both reasons.
- **Account plan to grow assets under management.** \`build_aum_account_plan\` walks Client → **HAS_SIGNAL** → Signal → **SUGGESTS** → Product for products the client doesn't hold, sizes each play from estimated assets held elsewhere, counts how many similar clients hold it, and finds approved content through Product ← **EXPLAINS** ← ContentAsset. Each contact gets a channel with approved content they consented to, so the 30/60/90-day sequence never sends content on an unapproved channel. "Activate the plan" drafts a Marketing Cloud brief from it.
:::

**Life sciences: Lumera Therapeutics**, a third Northstar brand, shows pharmaceutical promotion, where a claim is only as good as the trial, label and MLR approval behind it. Everything is fictional: the drugs (Cardivance for heart failure, Glucora for type 2 diabetes, Neurelva for chronic migraine), the trials and their results.

::: details The Lumera use cases, tool by tool
- **Targets.** \`build_hcp_target_list\` ranks hospitals and prescriber groups for a drug by labeled-indication patients × (1 − Lumera's share) × a formulary access weight × decile. Where a drug isn't on formulary or is under P&T review, the approved value dossier comes before any detailing. Groups carry opted-in counts per channel (email, portal, rep visit), never people.
- **Claims.** \`check_clinical_claims\` walks Drug ← **CLAIMS_ABOUT** ← ClinicalClaim ← **SUPPORTS** ← ClinicalTrial, then compares **INDICATED_FOR** (on label) with **INVESTIGATED_FOR** (not). Content that **CARRIES** a claim is usable only with a current MLR approval, the safety information and, for Cardivance, the boxed warning. The “superior to every ARB” claim has no trial; the HFpEF claim is off label and its trial has no results; an expired approval blocks a supported Glucora claim.
- **Hospitals.** \`plan_hospital_engagement\` reads each drug's **ON_FORMULARY** status and days to P&T review at a hospital, the patients at stake, whether the value dossier is usable or still in MLR, and the prescriber groups' consent and engagement, then orders the next steps.
- **In the Architecture view**, Lumera runs through the same lifecycle as Harborstone: the authoring agent refuses a claim whose approval is draft or rejected, the farm flags superiority language, and a module can't be approved while its study report has lapsed.
:::
`,
        inDemo: [
          "Chat → Use cases",
          "Sources: Holidays · Nager.Date, Weather alerts · NWS, Rate news · Federal Reserve",
          "Workspace: Forecast, Store inventory, and Inventory risk cards, then the case action card",
          "apps/edge/src/external-services, apps/edge/src/inventory-risk.ts, apps/web/src/usecases",
        ],
        resources: [R.nagerDate, R.nwsApi, R.openMeteo, R.fedFeed, R.finra2210, R.mcpIntro],
      },
      {
        id: "object-model",
        title: "Governed objects and workspaces",
        summary:
          "One identifier per plan, brief, module, claim and result, with governance attached, and screens composed from it.",
        body: `Most marketing tools copy things forward (plan to brief to module), and each copy must be reconciled with the last. Here every **plan, brief, module, claim, piece of evidence, result, disclosure and gap** is a *governed object* with:

- a lifelong **urn**, such as \`urn:northstar:module:hs-mod-fomc-push\`
- a **version**, and the version it **supersedes**
- a **brand, market, owner and classification**
- an **approval state**, its creator (a person or an agent), and when

**Nothing is copied forward.** A brief holds only its plan's urn and the wave it covers; its audience, channel and timing are read from the plan *when you open it*, so changing the plan changes the brief. Relationships (\`INHERITS\`, \`CITES\`, \`SUBSTANTIATED_BY\`, \`MEASURED_BY\`, \`VARIANT_OF\`, \`GAP_FOR\`) are *derived from the objects' attributes*, so no second copy can go stale.

**The object inspector** shows any object by urn: attributes, inherited plan, evidence, lineage both ways, version chain, append-only history, and your next open decision. Open it from a Command Center card, a table row, a search result, or a link in an agent's answer.

**Workspaces are manifests**: who it's for, which objects it lists, which tiles it composes, which agents and services it calls. One renderer turns any manifest into a screen with the same loading, empty, error and permission-denied states. The **Command Center** lists every object by lifecycle stage with the person whose decision it awaits; **Brief Builder**, **Module Library**, **Approvals** and **Performance** are other manifests over the same objects. **Run as** in the header switches between a brand planner's, marketer's, reviewer's and brand lead's view: the role opens that person's workspace and is sent with each request, and the server enforces what it may do.

::: details How each screen explains itself
**Each screen explains itself.** The Architecture view opens with what you're looking at, why it beats copying claims by hand and reviewing over email, and where your role comes in: the seven steps, who decides at each, yours highlighted, and a button to your step's workspace. Each workspace opens with a card: what it is, why it's better, where it fits, something to try for the header's brand, and the technical idea it shows. The words live in \`apps/web/src/architecture/guide.ts\`, beside the manifests, so they follow brand and role as the data does.
:::

**Journeys.** The **Journeys** view (beside Architecture in the workspace rail) gives each brand's goal to a real orchestrator, which plans the work and hands each step to a real subagent: a brief from an approved plan, content from approved claims (and what it refused), red-team probes, the evidence packet, submission, **your decision** as reviewer, then what comes next. You watch each subagent: who it acts for, its model, each tool call and the gateway's decision, and what it made. Nothing is scripted, so runs differ; one takes about a minute.

::: details How the asset preview is built
**The asset, as it is built.** Beside the steps, the asset composes itself from the agents' tool results, in its channel wrapper (an email with sender, audience, send date and subject, or a push or SMS on a phone).
- The library's images (logo, banner, an image beside the claims) appear as placeholders with alt text and library ID, since the library is mocked.
- Each block is marked by its words' source: the agent's own opening or closing, an approved claim the service inserted word for word, or a disclosure a claim requires.
- **Kept out by the service** lists topics refused for lack of a substantiated claim (each filed as a gap) and agent wording the service rejected, with its reason. Probe findings and readiness blockers attach to the block they quote.
- Click a block for its author, the tool call and policy that allowed it, its source claim, and what the checks found. The atomization agent's channel versions appear as tabs, each with its character count against the channel limit.
- The preview is derived on the page from the flow's events (\`apps/web/src/architecture/asset.ts\`); nothing extra is fetched.
:::

::: details Channels and where the data lives
**Channels.** An approval card is composed once with brand rules (accent, disclosure label, rule version), then rendered four ways: React, an **Adaptive Card** for Teams and Outlook, **data for a Lightning Web Component**, and an **MCP Apps** resource for MCP clients such as Claude. Change one brand rule and all four change. The preview renders the payloads on screen; nothing is sent to Teams, Outlook or Copilot.

**Where the data lives.** Seed objects for the three brands (Harborstone Wealth, Coastline Kitchen, Lumera Therapeutics) ship in code; Lumera's brand rules label its disclosures as safety information. What you create (a plan, a module, a gap, a new claim version) and every approval state go to {{cloudflare: D1 || google-cloud: Firestore}}, scoped to you, and expire with the 24-hour audit. They are not in the Neo4j graph; making them graph nodes is a later step.
:::
`,
        inDemo: [
          "Architecture → read the intro, then pick a step to jump to its workspace",
          "Journeys → Start the orchestrator, click blocks in the asset, then approve when it asks",
          "Architecture → Command Center, then open any card",
          "Header → Run as: Brand planner, Marketer, Reviewer, Brand lead",
          "Architecture → open a module → Channels (React, Adaptive Card, LWC data, MCP Apps)",
          "packages/architecture/src/types.ts, world.ts, workspaces.ts, channels.ts",
        ],
        resources: [R.mcpApps, R.adaptiveCards, R.cfDurableObjects],
      },
      {
        id: "gateway",
        title: "The agentic gateway",
        summary:
          "One choke point for every tool call: default-deny policy, a per-call identity, and a record of the decision.",
        body: `A governed system can't have side doors. **Every architecture capability, and every tool the model calls, goes through one gateway**, which answers three questions first.

**1. Is this allowed?** Policies are **default-deny**: a call runs only if a *permit* matches its caller, action and object kind, and a matching *forbid* always wins, as in Cedar. Permits are compiled from the **agent registry**, so an agent can call only its entry's actions, on the object kind it is scoped to. Two rules are fixed:
- **Agents can never hold a decision.** A forbid covers \`transition\`, \`supersede_claim\` and \`accept_optimization\`. An agent may propose; only a person decides.
- **Brand scope.** A call on a brand outside the signed-in user's scope is denied. With a brand chosen in the header, another brand's tools are denied by \`forbid-out-of-scope-brand\` and never offered to the model; shared tools such as the graph overview stay. The model is told what each brand sells, so "Cardivance" with Lumera selected is in scope, and "the Sweep Account" is named as Harborstone's when it is not.

::: details How Cedar decides, for offered and called tools
**Real Cedar, one decision for offering and calling.** The policies are Cedar files (\`packages/architecture/policies/\`), schema-checked in CI and evaluated by the Cedar engine (\`@cedar-policy/cedar-wasm\`) on both hosts (ADR-020). Before a model step, only permitted tools are **offered**; when the model calls one, the gateway checks it **again** in the same context. So a model is never shown a tool it may not use, nor uses one it wasn't shown. The context carries the brand, role, surface, the chat's classifier labels, the tools already run, and (in the pharma lifecycle) the stage, so a policy can say "claims first", "ground before drafting", or "at the content stage the copy lead reads the claims library, approved assets and brand guidelines". **Agents → Policies** shows the files; every decision is logged with the policy id that made it.

**A model's calls get no shortcut.** For an agent running on a model, the gateway checks the run's central action before calling the model, then each tool call separately, as that agent. A tool outside its grants is denied like any caller's, and the denial returns to the model as the tool's result. The sample-flow orchestrator is checked before a flow starts or resumes and on every step; disabling or retiring it withholds its policy, so its kill switch stops a flow mid-way.
:::

**2. Who is calling, and for whom?** The gateway mints a signed, **short-lived token per invocation** naming the caller (\`agent:module-authoring\`) and, in an \`act\` claim, the user it acts for (the OAuth token-exchange pattern). The service checks the token was minted for this action and user before running. No shared credentials; no agent acts as itself.

**3. Was it recorded?** Every decision, allowed or denied, is logged with its policy, caller and correlation id. The **Trust** view draws any call's **identity chain**: user, surface (role, brand, market), {{cloudflare: Worker || google-cloud: server}}, gateway, agent, service. A denied call stops at the gateway and says so.

::: details How each kind of caller passes the gate
**Every caller, one gate.**
- **The orchestrator** is an agent too: each tool the model calls is authorized as \`tool:<name>\`. Existing kill switches still apply, and \`DISABLED_AGENTS\` switches a whole agent off.
- **The Campaign squad** keeps its roster outside the registry but gets no side door: each tool call is checked as \`team:<tool>\`, with permits compiled from its roster and added to the registry's. Default-deny, the forbids, brand scope, the per-call token, the audit log, \`DISABLED_AGENTS\` and the lifecycle (constrain keeps reads, retire withholds everything) apply exactly as to registry agents.
- **Partner agents** are registered with a contract, identity, policy and an A2A-style **Agent Card** (see **Agents**). Their prompts stay with their owner; the gateway governs the call, not the thinking.
- **The workbench as a channel:** \`/mcp/workbench\` exposes read tools, search and \`propose_transition\` to MCP clients through the gateway, and no tool that approves, publishes, sends or deletes.
:::

::: details What the gateway doesn't cover yet
**Not yet.** Confirmed Salesforce writes keep their own signed-confirmation audit, outside the gateway log. The Salesforce MCP portal call is authorized as the orchestrator calling that tool, not as a separate hop.
:::
`,
        inDemo: [
          "Architecture → Agents → run an action as an agent, then try one it isn't granted",
          "Architecture → Agents → Policies (Cedar text)",
          "Architecture → Trust → recent gateway calls and their identity chains",
          "packages/architecture/src/gateway.ts, apps/edge/src/architecture/context.ts",
        ],
        resources: [R.cedar, R.tokenExchange, R.a2a, R.cfAgents],
      },
      {
        id: "lifecycle",
        title: "The content lifecycle: plan to learn",
        summary:
          "Agents draft, check and measure; people decide at every stage; performance re-enters the plan.",
        body: `The lifecycle runs **Plan → Audience → Brief → Create → Substantiate → Approve → Deploy & learn**. A named person owns each stage's decision; narrow agents do the work.

**Agents are models; the rules live in services.** Each agent is a model on {{workers-ai: Workers AI || vertex: Vertex AI}} that decides what to ask for and writes its own words: a plan's waves and rationale, a brief's objective, the headline and framing of a module or channel version. Its tools are deterministic **services** that enforce the rules whatever it writes: they insert a claim's exact text and attach the disclosures the claim requires.

**What an agent may write.** Its words read as an email: a subject line, an opening before the claims (a greeting and the occasion, such as a meeting and its date) and a closing after them (what to do next, a sign-off). They may name the product, the occasion and dates, but may not assert anything a claim would have to support: a number, price, outcome, benefit, comparison or reason ("prevents", "well tolerated", "shows", "better", "because"). A fragment such as a bare "See" is rejected. A sentence that asserts is rejected with the words that did it, so the agent can try again. A topic with no substantiated claim is refused and recorded as a gap, even if the model leaves it out.

::: details What each agent does, from plan to module
**Plan and brief.** The *content plan agent* reads the calendar and past results and proposes waves as structured demand: theme, segment, channel, date, number of modules, and why. The *scenario agent* estimates what a change does (move a send, drop a channel, change an audience) from the audience size, the channel's baseline click rate and the brand's best past send, with a lift when a send lands on a market date. The *brief agent* drafts a brief that inherits the plan by reference.

**Reuse and create.** The *reuse agent* ranks existing modules by meaning (a local hashing embedder; {{cloudflare: Vectorize || google-cloud: a vector database}} would implement the same interface) and past results, and flags any that cite a superseded claim. The *module authoring agent* **cites or refuses**: every fact is an approved, substantiated claim or a disclosure the claim requires, and anything it can't cite becomes a **gap record**, not text. The *atomization agent* makes channel variants and never shortens a claim; if one doesn't fit a channel, it says so.

**Images are chosen by the service, not the agent**, from the brand's asset library (mocked: Aprimo for Lumera and Harborstone, Marketing Cloud Content Builder for Coastline): the logo, a banner matched to the wave's theme, and an image beside the claims. It takes only images that are approved, in usage rights on the send date, and show no claim the module doesn't cite (a chart of a refused claim stays out), and lists every image it passed over with the reason. A push keeps only the banner; a text message has no image. The web app serves the files from \`/library\`: logos, the chart, the rate card and the price tile are SVG artwork, and the photos are Unsplash stock (credited in \`apps/web/public/library/CREDITS.md\`), since the brands are fictional. A missing file shows the brand's colors instead.
:::

**Substantiate.** The *substantiation agent* builds an evidence packet for each cited claim and marks it substantiated, superseded, withdrawn, unapproved, missing evidence, expired evidence or conflicting. *Readiness* blocks until every claim is substantiated and every required disclosure is present. When a claim is **superseded**, every module citing it is flagged for refresh and can't be approved.

**The adversarial farm.** Four probes read each draft before a person does: a claim attacker (uncited facts, reworded claims), an injection prober (instruction-like text in the module, its brief or a cited claim), a brand and disclosure checker (absolute language, an embargoed deal, a missing disclosure) and a consent prober (the channel against the audience's opt-ins). They report findings and change nothing; a blocking finding blocks approval. The **data readiness agent** scores each stage's inputs the same way.

**Approve.** Every object moves through one **state machine with eleven transitions**: submit, start review, request changes, resubmit, approve, reject, escalate, a senior's approve or reject, expire, and withdraw. Each names who may take it: reviewers and seniors decide, *expire* is the system's when evidence lapses, and *withdraw* is an admin's or a supersession's. Rejecting, escalating, requesting changes and withdrawing need a reason. Every move is attributed, timestamped and appended to a history that is never edited. Agents can only **propose** a ready draft for review.

**Deploy and learn.** The *attribution agent* traces a result to the module and claim that carried it, with the path to the evidence. The *optimization agent* proposes **re-issue** (well above baseline), **refresh** (well below, or a superseded claim) or **retire** (far below); the brand lead decides. Accepting one revises the brand's plan as a **new version that cites the result**, so last quarter's results change the next plan.

::: details How nothing is overwritten
**Nothing is overwritten.** What an agent writes is named by a short hash of its words: the same words again are a no-op, and different words are a new draft beside the old one. Approved text can't change without a new review, and a superseded claim gets a new version. A decision is recorded only if the state really changed, so two reviewers acting at once can't both succeed, and an accepted optimization proposal isn't offered again for the same evidence.
:::

**Salesforce stays the system of record.** The lifecycle adds no Salesforce writes. Its approval is the workbench's own; the confirmed review-task write is still how a decision reaches Salesforce.

::: details How Lumera runs through the same stages
**A regulated brand beyond finance.** Lumera Therapeutics runs through the same stages. Its claims need a trial-backed study report, its safety information (and a boxed warning for Cardivance) is a required disclosure the authoring agent adds, and the farm blocks superiority or absolute-safety wording. The writer's own words may not imply what only a cited claim or the label can say: "guideline-ready", "proven", "a significant reduction" or "reduced the risk" outside the claim is refused, since no guideline has endorsed the product and the claim already carries the result.
:::
`,
        inDemo: [
          "Architecture → Module Library → Author a module (cite or refuse): pick topics “sweep-apy” and “wire-fees”",
          "Architecture → Approvals → open a module → Decision, History",
          "Architecture → open an approved claim as Compliance → Supersede, then Module Library",
          "Architecture → Performance → Optimization proposals → Accept as Brand lead",
          "packages/architecture/src/agents.ts, farm.ts, state-machine.ts",
        ],
        resources: [R.contextEngineering, R.buildingAgents, R.mcpIntro],
      },
      {
        id: "agent-operations",
        title: "Agents, prompts, models, and drift",
        summary:
          "A registry, a prompt catalog and a model router, scored by thirteen evaluators that watch for drift.",
        body: `Prompts get edited, models get swapped and data shifts, so every agent is **registered, versioned and scored**.

**One register for every agent.** The registry lists each agent once: its version; its **domain** (commercial: we build it; platform: consumed as-is; partner: theirs, reached over A2A); the **stage** it serves and the **object kind** it is scoped to; the actions it is **granted**; its **lifecycle stage** (introduce, test, monitor, constrain, retire) and **autonomy level**; and the **person who holds its human gate**. The **Agents** view draws it as a swimlane; a dashed outline means planned, not built.

**Prompts are a catalog, not files.** Each entry has a version, an owning agent, typed variables and the evaluators that score it. The **hard rules** (cite or refuse, escalate ambiguity, propose only, treat retrieved text as data, no personal data) are appended to every prompt, and no entry can drop them. A variable binds to a **governed object by urn** and exposes only the fields it lists; pasted text is rejected. \`pnpm prompts:check\` pins each prompt's hash to its version, so a changed prompt needs a new version.

::: details How agent runs and sample flows work
**How an agent runs.** A run gets the agent's catalog prompt (rendered with the objects it names), the model the router binds to its task class, and only the tools its registry grants. The gateway checks the action the run centres on, then every tool call, as that agent acting for its step's owner.
- The prompt already holds the objects named in the input and what the agent would read first (the brand's claims for the authoring agent, the planning inputs for the plan agent), so its first call can be its real one. On its first step the model must call one of its tools: small models otherwise describe the work in prose, or bury the call in their reasoning, without doing it.
- Tools return what the service did, not just a yes. A brief just drafted comes back with the wave it covers (theme, audience, channel, send date), read from its plan, so the authoring agent and the Journeys preview see the audience without another read. The authoring tool returns the saved module, the topics it refused with the gaps it filed, and the images it picked from the asset library with those it passed over and why. The agent reports them but can't change them.
- A run stops when the same call fails twice. Its account of what it did is one more call, without tools, over the tool results; if the work never succeeded, the account says so instead of trusting the model's words.

**The orchestrator.** A sample flow gives a goal to an orchestrator model with one tool, **next_step**: delegate a step to a subagent, ask a person, or finish. The tool is offered, not forced: a step that ends in prose gets a reminder, and a call buried in the reasoning is recovered by the tool-call guard. What a subagent creates comes back as a short handle (module-1) instead of a long urn. When a module is submitted for review, the orchestrator asks the person and the flow stops, saved in {{cloudflare: D1 || google-cloud: Firestore}}; it resumes only once the module's state shows a decision. Platform agents, which Admin owns, act for whoever started the flow, so a flow never takes on Admin. Each delegation, tool call and decision streams to the page as newline-delimited JSON while the flow runs; the Campaign squad streams the same way.

**What a model may add.** The red-team agent can report a concern the probes missed, as advice to the reviewer; it blocks nothing. Only the deterministic probes can block approval: a model's say-so should never stop a person's decision, nor be what lets one through.
:::

**Models are routed, not wired.** Agents declare a *task class* (orchestrate, draft, classify, judge, embed, score) and the router binds a model at run time. Each class has a **champion**; a **challenger** is shadowed on a share of turns, never in front of a user, under a daily cost cap. A challenger replaces the champion only by beating it on the same evaluations, through a pull request. Planning and drafting run on **gpt-oss-120b**, with gpt-oss-20b as challenger; classifying agents stay on gpt-oss-20b, since the services they call decide (ADR-011); the chat orchestrator stays on \`gpt-oss-20b\` (ADR-005, ADR-009).{{vertex:  On Vertex AI, which has no 20b, every one of them runs gpt-oss-120b.}}

::: details Where the models run, locally and in tests
**Where the models run.** Deployed, {{workers-ai: on Workers AI through AI Gateway || vertex: on Vertex AI}}. {{cloudflare: Locally, \`pnpm dev:local\` uses local D1 and R2 with real Workers AI (a Worker name of its own keeps the remote-bindings proxy off the Access-protected domain). || google-cloud: Locally, the Node server runs against the Firestore emulator.}} The hermetic worker tests select a scripted stand-in with \`AGENT_MODEL=scripted\` that calls each agent's real tools, so the gateway, services and persistence are tested; no deployed environment sets it. \`AGENT_CHAMPIONS\` can name another catalog model for a task class in one environment.
:::

::: details The thirteen evaluators and the answer-quality judge
**Thirteen evaluators:** tool selection, grounding, cite-or-refuse, claim accuracy, disclosure presence, brand rules, personal-data leakage, prompt-injection resistance, policy adherence, write discipline, answer quality (a judge), latency and cost. Every agent run is scored from its own trace. {{cloudflare: Answer quality is judged by **Clef**, Cloudflare's decision model (the *score* task class): it answers three typed questions || google-cloud: Answer quality is judged by **gpt-oss-120b** on Vertex AI (the *score* task class), answering three typed questions}} about each run (did it do the task, is its summary grounded in the tool results, could a marketer act on it) {{cloudflare: with probabilities, not prose, and bills input tokens only. Clef gives no reasons || google-cloud: as an index on each question's scale, returned as JSON. The judge gives no reasons}} and isn't calibrated yet, so its score is shown but not part of drift.
:::

**Drift.** Each agent has a baseline. When an evaluator's mean over the last twenty runs falls more than 0.15 below it (with at least five runs), the agent moves to **constrain**: it keeps its reads and loses everything else until a person reviews it. The hourly job and the **Run drift watch** button run the same check.

::: details How drift is measured for each evaluator
- Deterministic evaluators have a baseline of 1; measured ones (latency, cost) use their threshold, since a model's timing varies (a run within 20 seconds scores 1 on latency).
- Policy adherence counts only the gateway's denials; retrying wording a service sent back is the agent working. When the gateway refuses a subagent during a flow, the orchestrator is told it is policy and stops delegating to that agent rather than retrying.
- Content scores (claim accuracy, disclosures, brand rules) count only factual statements in content the agent wrote or moved forward; its own framing is checked to state none when saved. An agent that reports a flawed module's flaws, such as the readiness agent refusing to submit an email whose evidence has expired, did its job, so those flaws aren't its drift.
:::

**Staged autonomy.** Evidence also sets the autonomy an agent has *earned*: assistive, then orchestrated at twenty clean runs, then agentically led at a hundred. Raising a level is a pull request, and no level removes the human gate.

**Trust.** The **Trust** view sets each agentic threat (hallucination, prompt injection, data leakage, unauthorized action, drift, audit gaps) beside its control and live evidence: the grounding mean, denied calls, the farm's findings, constrained agents. Where nothing has been measured, it says "no samples yet".`,
        inDemo: [
          "Architecture → Agents (swimlane, lifecycle and autonomy badges)",
          "Architecture → Prompts & models",
          "Architecture → Evaluations → Run drift watch and expiry now",
          "Architecture → Trust",
          "packages/architecture/src/registry.ts, prompts.ts, models.ts, evaluators.ts, trust.ts",
          "docs/decisions/ADR-009-model-catalog-and-routing.md",
        ],
        resources: [R.cfAgents, R.aiGateway, R.buildingAgents, R.writingTools],
      },
      {
        id: "campaign-squad",
        title: "The campaign squad: a lead, four spokes, and the platform under them",
        summary:
          "Five model-driven agents build one campaign proposal, talking to each other, on a semantic layer and governed infrastructure, with a choice of model providers.",
        body: `The **Campaign squad** page runs a hub-and-spoke team of agents on a client's brief. Each agent is a real model with its own prompt and only its own tools; nothing about a run is scripted.

**The roles.** The **campaign lead**, at the hub, turns the brief into a work plan, hands one piece at a time to the spoke that owns it, and keeps what comes back or sends it back with notes. It never does a spoke's work. The spokes:
- **audience analyst**: who to win, how big each group is, what rivals are doing, which signals point to an opening
- **art director**: the campaign idea, its look and palette, and the approved library images it uses (none are generated), each shown as a card with the file, its library ID, approval and rights, and what the concept uses it for
- **copy lead**: the line, the recurring themes and copy for each placement
- **channel planner**: the channels to buy, spend and dates for each, and the results to expect

::: details How messages pass between the agents
**How the agents talk.** Assignments, hand-backs and send-backs pass between the lead and a spoke. A spoke that builds on another's saved work first asks it with \`ask_teammate\`, and the other answers from its saved work (\`answer_teammate\`). Every message is logged and drawn live on the map. The lead acts through one tool, \`next_step\` (offered, not forced), and hands out a piece only once the pieces it depends on are kept. Each spoke is offered only its own reads, \`ask_teammate\` and its save; from its fifth step, only the save.
:::

**Rules are code, not prompts.** Each spoke saves through one tool, and a service checks the work whatever the model wrote: findings must cite real data ids (cite or refuse); the palette must come from the brand book, and no image may show what it forbids; copy must fit each placement's character limits, avoid banned phrases and carry any required disclosure; the channel plan must respect minimum spends, the budget and the brief's window. A refused save comes back with every problem for the model to fix. A refusal for a missing field names the field and the values it accepts, because a model told only that its call was wrong tends to repeat it. Once the pieces are in, reconciliation finds clashes (a channel bought with no copy, copy for a channel not bought, an audience the analyst didn't recommend), and the lead resolves each or sends the piece back. The client gets a **proposal** and decides.

**Guardrails at work.** Hitting a guardrail is the system working, so the page shows it: a panel under the team map lists each rule refusal, gateway denial and rejected tool call as it happens, with the agent and tool, what the rule protects, and what the guardrail told the agent. A repeated mistake is counted (×3), and a hit is marked fixed once a later call to the same tool goes through.

**People in the loop.** The person at the browser takes the people's decisions.
- For a regulated brand (one with a required disclosure), a **compliance reviewer** must approve the copy first: the lead asks with \`request_compliance_review\`, and the server won't send a proposal until a person has approved the current version, so changed copy needs a new review.
- The **client** (played by the brand lead) then approves each proposal or sends feedback, up to two rounds.
- The gateway checks the person's role (\`team:decide_compliance\` or \`team:decide_proposal\`); no agent is ever granted either.
- A request for changes reaches the lead in the person's words, and the lead sends back the affected pieces. Its limit of two send-backs per spoke resets after each decision.
- A waiting run is saved with the lead's conversation and rebuilt from its event log when the person decides, so it survives a reload.

::: details How a run is scored
**Evals.** Every run is scored when it ends, from its own events: whether it reached an approved proposal, how often the rules refused a save, how well findings are grounded, whether the plan uses the budget well and puts money where the audience responds, whether every bought channel has copy, how the agents coordinated, whether spokes answered each other, and whether the team acted on people's requests for changes. A request isn't a failure (people ask for changes, and the eval runner asks on purpose): each scores by whether the same person approved the next version, and the detail still shows how many first versions were approved. A judge model scores the proposal on five criteria from 1 to 5; the overall score is 70% checks, 30% judge. {{cloudflare: The judge is always the Workers AI judge champion || google-cloud: The judge is always the same Vertex AI model}}, whichever provider ran the squad, so providers are compared by the same yardstick.
- The **Evals** tab shows the run's scorecard and this session's runs averaged per provider. Session metrics stay in this browser (local storage), never on the server, and count only runs this reader finished or stopped for a person and replays played or skipped to the end, scripted runs included, each labelled with its source. **Reset session metrics** starts afresh, and **Reset session** at the top of the page also clears the run on the page (runs in the shared library stay).
- \`pnpm eval:team\` runs the reference briefs on each provider against a running workbench, plays the people (\`--feedback\` has each ask for changes once) and writes a comparison report.
:::

**The semantic layer.** No agent reads a raw table. Each data tool is a named query on a governed layer that defines every entity (segment, competitor, signal, channel, guideline) and metric once: formula, grain, unit, source and owner. \`query_semantic_layer\` queries it directly; \`define_term\` resolves a business word ("CPC", "lapsed loyalty members") to its meaning here. Projection formulas (impressions, clicks, cost per click) live only in the layer, so the channel planner, the lead's reconciliation and the proposal can't disagree about a number. The page shows which definitions each agent used.

::: details The platform layers each event passes
**Under the hood.** One panel holds the agents at a glance (state, model, tool calls and guardrail hits; everything else is in each agent's details), a **tool library**, the infrastructure, the semantic layer, the evals and people's decisions, as tabs that change only when you pick one. The tool library lists every tool the gateway can grant the squad, with what it does, its kind and which agents hold it, and highlights the tools used in this run and earlier in this session. It lights the layers each event passes: the event stream to the page; the lead's coordination loop; the models, each call metered; the agentic gateway, which checks every tool call as \`team:<tool>\` and mints a token for it; tools and the semantic layer; the rule services; the agent-to-agent bus; the run's state, saved to {{cloudflare: D1 || google-cloud: Firestore}}; and operations, where an operator disables or constrains an agent without a deploy.
:::

**Model providers.** {{cloudflare: A switch runs the same squad on open models, **Anthropic** (Claude through the official Anthropic SDK) or **OpenAI** (the Responses API). || google-cloud: A switch runs the same squad on open models or **Anthropic** (Claude on Vertex AI, through the official Anthropic SDK, its requests rewritten for Vertex); **OpenAI** (the Responses API) stays off on Google Cloud until it is approved.}} Only the model changes; tools, gateway, semantic layer, rules and bus stay the same.

::: details How each provider's requests are sent
- **Open models follow the top bar's AI platform:** {{workers-ai: Workers AI, through AI Gateway || vertex: gpt-oss on Vertex AI}}. Each run records that platform, so the switch, the run summary, each agent's details and the run library name the one it actually used, not the host's.
- **Vendors follow the host.** {{cloudflare: Anthropic and OpenAI requests go through the Worker's AI binding to AI Gateway's provider endpoints with no vendor key on them, so the gateway supplies the key stored on it; Cloudflare-billed fallback is off. || google-cloud: Every request goes to Vertex AI with the service's own Google Cloud credentials, so no vendor key is stored anywhere.}}
- Claude Opus 5.5 doesn't accept a forced tool choice, so a forced step asks for automatic choice and names the tool in a system message; Claude's thinking blocks are replayed unchanged on the next turn.
:::

::: details Opening an agent and replaying a run
**Opening an agent.** Click an agent on the team map (or press Enter on it) to see its role, tier and model, with {{cloudflare: the provider, AI Gateway and effort || google-cloud: the provider and effort}}; the exact system prompts it sent, one per distinct prompt, with the tools offered, the tool choice and its settings (each recorded as a \`prompt\` event when first sent, so a replay shows it too); its usage (model calls, input, cached and output tokens, model time, its share of the run, and an estimated cost from the model's price); every message it sent and received, grouped by the other party; and every tool call with the gateway's decision, its input and result, plus the work it saved. Read tools such as \`get_competitors\` take no arguments, since the run's brand decides what they return, so they show "No arguments".

**Replaying a recent run.** Every run, on any brand, mode or provider, goes into a shared run library in {{cloudflare: D1 || google-cloud: Firestore}} (\`team_run_library\`): the last ten, newest first, readable by anyone who opens the page. Other transcripts expire after 24 hours; these ten stay until newer runs replace them. Each row holds the run's event log and when each event was sent. **Replay a recent run** plays one through the same reducer a live run uses, keeping the run's gaps between events (a person's wait or a slow model call is cut to a second and a half), at 1×, 2× or 5×, or all at once, with pause and skip to end. A replay calls no model and takes no decision.
:::

**What it does not do yet.** The sample market data stands in for real segmentation, competitive and benchmark systems. Runs differ and take a few minutes. The squad writes nothing to Salesforce. One person plays every role from the same browser, and the judge is generous until it is calibrated against people's scores.`,
        inDemo: [
          "Campaign squad → pick a brief and a provider → Hand the brief to the squad",
          "Campaign squad → Under the hood → Agent infrastructure / Semantic layer / Evals / Decisions",
          "Campaign squad → a Harborstone brief → approve or ask for changes as the compliance reviewer, then as the client",
          "pnpm eval:team (with the workbench running)",
          "Campaign squad → Under the hood → Agents (at a glance) and Tool library (every tool, with this session's use)",
          "Campaign squad → Replay a recent run → pick one of the last ten runs, then change the speed or pause",
          "Campaign squad → click an agent on the team map: prompt and config, usage, calls sent and received",
          "packages/architecture/src/team.ts, team-semantic.ts, team-services.ts",
          "apps/edge/src/team/director.ts, specialists.ts, gateway.ts, anthropic.ts, library.ts",
          "docs/decisions/ADR-013-campaign-squad.md",
          "docs/decisions/ADR-014-squad-people-and-evals.md",
          "docs/decisions/ADR-016-squad-run-library.md",
        ],
        resources: [R.buildingAgents, R.cfAgents, R.aiGateway, R.cedar],
      },
      {
        id: "pharma-lifecycle",
        title: "A pharma campaign, focus to analytics, with MLR",
        summary:
          "Seven agents take a prescription brand's campaign through six phases while people decide at ten points, including an early concept review and Medical, Legal and Regulatory review, and claims carry their IDs into the channels.",
        body: `The **Pharma lifecycle** mode of the Campaign squad page runs a prescription brand's campaign end to end: business focus, ideation, content and MLR review, audience selection, publishing and analytics. Agents do all the work; people take the decisions a brand team, an MLR committee and an operations team would.

::: details How the page lays out the phases
**The page.** One phase shows at a time. A stepper across the top lists all six, marks each agent step and each of your decisions, and stays in view as you scroll. The chosen phase shows its documented steps, your decision when it's your turn, and its outputs: one-line summaries that open to full detail, with earlier versions kept. The team map and conversation sit beside it; agents, infrastructure, semantic layer, evals and the decision log share one tabbed panel underneath. You can open any phase before or during a run; the page moves to the active phase only after you decide something.
:::

**Claims are records, not sentences.** Each claim in the library (\`get_claims_library\`) has an ID (CLM-CRD-0042), the passages that substantiate it (CARDIO-HF report p. 7, table 2), the context it can't be used without (endpoint, trial and absolute rates), its scope (audience, market, channels), the label version it was approved against, its expiry, and the claims it must never sit beside. A search also returns near twins approved for something else (a consumer version, a rep detail aid version, an old-label version), each refused for this campaign with the reason. Click any claim on the page, a concept's topic or a module's, placement's or result's claim ID, for a card with its approved text, status, scope, label, expiry, references and the disclosures it requires, as the run's agents read them from the library.

**The path.**
- **Business focus.** The audience analyst reads the segments, competitors, signals and last year's results and proposes two or three focus areas, each citing data ids and a success measure (\`propose_focus_areas\`). The **brand lead** chooses one.
- **Ideation.** The art director starts from what is approved: concepts carried only by claims in scope for US HCP email and display under the current label, with approved, in-rights images from the asset library (\`find_approved_assets\`); no image is generated (\`propose_concepts\`). The brand lead chooses one, then a **medical reviewer** looks at the concept before anything is built, so an objection to the idea comes now, not at finished art.
- **Content and MLR.** The copy lead assembles an email and a display module (\`draft_modules\`): each claim enters by ID, word for word, with its marker and required context, and the service attaches the ISI, boxed warning and PI beside the claims. A claim out of scope for the channel, audience or label, or two claims that must not appear together, are refused. The **MLR coordinator** runs the pre-review quality check (passage anchors, label version and scope, required context, reference validity, fair balance, and each module's net impression, since approved parts can still add up to a claim nobody approved), sets the review tier (new copy around approved claims is tier C, full committee) and submits the job (\`submit_mlr_job\`). **Medical**, **Legal** and **Regulatory** review in turn, routed by the MLR system without the lead. Regulatory's approval issues a document number, a material ID per module with its claim IDs, and an expiry (twelve months, or the first reference or claim expiry if sooner); the system checks every built variant against the approved version.
- **Audience.** The audience analyst builds the HCP list by segment and prescribing decile (\`get_hcp_universe\`, \`build_audience\`): email only to HCPs with documented consent, the do-not-contact list removed everywhere, rep coverage shown. **Marketing operations** approves it.
- **Publishing.** The channel planner schedules only approved modules, by material ID, to approved email and endemic HCP display, inside the window, before expiry and within budget (\`get_approved_job\`, \`schedule_deployment\`). The service stamps each placement with its material ID and claim IDs, so a claim's identity survives the handoff to the channels. The brand lead approves go-live; the MLR coordinator prepares **Form FDA 2253** with the scheduled materials and current PI version (\`prepare_form_2253\`), and **Regulatory** files it at first use. Only then does the schedule publish.
- **Analytics.** Thirty days in market are simulated from the brand's benchmarks and segment affinities, and labelled so. Results carry claim IDs and roll up by claim. The performance analyst reads them (\`get_campaign_results\`, \`get_past_results\`) and recommends continue, optimize or retire, citing result lines (\`report_performance\`). The brand lead decides; the system lists where every claim is live with its expiry and re-review date, and retiring turns that list into a withdrawal plan by ID.

::: details How the lead and the workers are kept to each step
**How the lead moves.** The campaign lead has one tool, \`lifecycle_step\` (offered, not forced): assign the next agent step or ask the next person (\`request_decision\`). The server holds the lifecycle as data (\`PHARMA_PHASES\`) and a pure state machine, refuses any step out of order, and tells the lead what comes next after every result.

**Different tools at each stage (ADR-019).** No agent sees the whole toolbox. A worker is offered that stage's reads, within its own grants, and that stage's save: the analyst gets segments, competitors, signals and past results to propose focus areas, then only the HCP universe to build the audience; the copy lead gets the claims library, approved assets and brand guidelines; the channel planner gets the approved job and channel benchmarks. The worker chooses what to read and when to save, but its first step must use one of these tools, and from its fifth step (or when nudged after a refusal) only the save is left and it must call it. A save names claims by topic: a claim ID such as \`CLM-CRD-0042\` is mapped to its topic, and a refusal for missing claims lists the topics this campaign may use. The guardrails are the state machine, the rule services and people's decisions, not the order of reads.
:::

::: details Which role takes each decision
**People.** Each human step is a gateway action only its role may take: the brand lead (\`team:decide_focus\`, \`decide_concept\`, \`approve_go_live\`, \`decide_next_action\`); Medical (the reviewer persona: the early concept review, \`team:review_concept\`, and the MLR review); Legal (senior); Regulatory (compliance); and marketing operations (marketer). Choice steps take one of the agents' options. Asking for changes sends the phase back to its first step, with the person's words, in a new round; a resubmitted MLR job gets a new job code.
:::

::: details Models, caching and scoring
**Models.** Coordinators (the campaign lead and MLR coordinator) run on each provider's top model, workers on a smaller one: Opus 5.5 and Sonnet 5.5 on Anthropic, gpt-6-astra and gpt-5.4-mini on OpenAI, {{workers-ai: GLM-5.3 and DeepSeek V4.1 Flash on Workers AI (a worker re-sends a growing prompt, and DeepSeek's cached input costs $0.006 per million tokens) || vertex: and gpt-oss-120b for both on Vertex AI, which serves no other open model here}}. The open-model tier uses the AI platform chosen in the top bar when the run starts, and the run records it. Each agent's calls share a growing prefix, so they are cached: Anthropic requests carry top-level \`cache_control\`, OpenAI requests a per-agent \`promptCacheKey\`, and the cost estimate prices cache reads at the cached rate.

**Scoring.** The scorecard counts phases finished, saves accepted on the first try and gateway denials, and scores how the team acted on requests for changes from the MLR reviewers and the brand team: a request counts as met when that person approves the next version.
:::

**What it does not do.** No channel is called and no Form 2253 is filed; the results, the HCP universe and its consent rates are fictional. One person plays every role.`,
        inDemo: [
          "Campaign squad → What the team runs → Pharma lifecycle → Start the campaign lifecycle",
          "Campaign squad → the phase stepper (each agent step and decision, and where the run is)",
          "Campaign squad → a phase's workspace: its steps, your decision, and what it produced",
          "Campaign squad → Under the hood (agents, infrastructure, semantic layer, evals, decisions)",
          "packages/architecture/src/team-pharma.ts",
          "apps/edge/src/team/lifecycle.ts, lifecycle-workers.ts",
          "docs/decisions/ADR-015-pharma-campaign-lifecycle.md",
          "docs/decisions/ADR-017-claims-managed-lifecycle.md",
        ],
        resources: [R.buildingAgents, R.cfAgents, R.aiGateway],
      },
      {
        id: "long-term-memory",
        title: "Long-term memory: remembering across chats",
        summary:
          "Drafts and decisions stored in the graph by the server, recalled by tools, and forgotten on request.",
        body: `A new chat starts with an empty workspace, but some work should outlive it: the draft you settled on, the campaign you saved, the review you asked for. **Long-term memory** keeps these in the knowledge graph for 14 days, shared by the workspace.

**What gets remembered, and by whom.** The server writes memory, never the model, and only on events it has verified:
- a Salesforce save, review task or image attachment you confirmed and Salesforce read back
- a request to remember the draft in focus: say "remember this draft", or use **History → Memory**

::: details How memory is stored in the graph
**How it's stored.** Each memory is a small subgraph in its own dataset, next to the demo graph:
- a \`Draft\` node per version, linked to the version it replaced (\`SUPERSEDES\`)
- a \`Decision\` node, linked to the draft it saved (\`DECIDED_ON\`) and the Salesforce record it created (\`RECORDED_IN\`)
- \`ABOUT\` links to the \`Campaign\` and \`Brand\` nodes involved, so "what did we decide about Coastline?" is a graph question

Every node carries its workspace and an expiry; the person who acted is stored only as a hash.
:::

**How it's recalled.** Ask about earlier work ("what did we decide…", "last time…", "what have we worked on recently?") and the intent router offers \`recall_decisions\`, \`recall_recent_work\` and \`explain_memory\`. The server gives these tools the workspace, so the model can't read another workspace's memory. Each item comes back **dated and sourced**, with provenance paths, and the model is told to treat it as past work and re-check Salesforce before reusing it.

**How it's reopened.** Only you can reopen memory, not the model. **Reopen** in the Memory tab puts a remembered draft back in focus at its remembered version, with a note saying where it came from (for a decision, its draft), and adds the records it links to **Records**, marked *Remembered*. Memory may be stale, so reopening never marks a draft as saved, and a remembered campaign isn't a write target until the chat reads it from Salesforce again.

**How it's forgotten.** **Forget** in the Memory tab deletes an item at once, and the audit export records it. An hourly job deletes anything past 14 days. \`MEMORY_ENABLED=false\` turns memory off entirely.`,
        inDemo: [
          "Chat: “Remember this draft”, then New chat and “What did we decide about …?”",
          "History → Memory (Reopen, Forget, Remember current draft)",
          "packages/knowledge-graph/src/memory.ts, apps/edge/src/memory.ts",
          "docs/decisions/ADR-007-long-term-graph-memory.md",
        ],
        resources: [R.contextEngineering, R.graphDb, R.cypher],
      },
    ],
  },
];

export const GLOSSARY: Array<{ term: string; definition: string }> = [
  {
    term: "Agent",
    definition:
      "A model that calls tools in a loop to do a task; its host controls which tools it may call.",
  },
  {
    term: "Context engineering",
    definition:
      "Choosing the smallest, highest-signal context that lets the model do the next step well.",
  },
  {
    term: "Context window",
    definition:
      "Everything the model sees in one call: instructions, tool definitions, messages and tool results.",
  },
  {
    term: "Cypher",
    definition: "Neo4j's graph query language, which matches patterns of nodes and relationships.",
  },
  {
    term: "{{cloudflare: Durable Object || google-cloud: Agent host}}",
    definition:
      "{{cloudflare: A single-threaded, stateful Cloudflare instance with its own storage; one per user here. || google-cloud: A single-threaded, stateful instance with its own storage, the shape each user's chat has; the Node agent host on Cloud Run provides it here.}}",
  },
  {
    term: "Evidence path",
    definition: "The chain of graph nodes and relationships that justifies an answer.",
  },
  {
    term: "Forced tool call",
    definition:
      "A step where the host makes the model call one specific tool. The demo avoids them (ADR-019): context limits which tools are offered, and the model chooses. The exception is a lifecycle worker whose save is the only tool left, which must call it.",
  },
  {
    term: "GraphRAG",
    definition: "RAG that retrieves connected facts from a knowledge graph.",
  },
  {
    term: "HXL",
    definition:
      "Salesforce's widget format that renders agent action output as typed, interactive cards.",
  },
  {
    term: "Idempotency key",
    definition:
      "A unique key that makes repeating a write safe: a second attempt returns the first result.",
  },
  {
    term: "Knowledge graph",
    definition: "A database of entities (nodes) and typed relationships between them.",
  },
  {
    term: "Long-term memory",
    definition:
      "Drafts and decisions the server (never the model) stores in the graph for 14 days, recalled by tools across chats.",
  },
  {
    term: "MCP",
    definition:
      "Model Context Protocol: a standard way for agents to discover and call tools on servers.",
  },
  {
    term: "Policy router",
    definition:
      "Deterministic rules that answer write or forbidden requests without calling the model.",
  },
  {
    term: "Prompt injection",
    definition:
      "Instructions hidden in data that try to steer a model; here they're treated as data, never as commands.",
  },
  {
    term: "RAG",
    definition:
      "Retrieval-augmented generation: retrieve relevant facts into context, then generate a grounded answer.",
  },
  {
    term: "Read-back",
    definition:
      "Re-reading a record from the system of record after a write, to confirm what actually changed.",
  },
  {
    term: "Tool plan",
    definition:
      "The tools a recognised scenario offers, with a suggested order; the model chooses which to call and when it has enough.",
  },
];
