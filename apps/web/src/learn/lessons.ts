/**
 * The learning layer over content.ts: what each part teaches, a diagram and one key idea per
 * section, hands-on "try it" actions, and a quick check per part. Kept separate so the long-form
 * text stays easy to edit.
 */

export type DiagramId =
  | "context-window"
  | "memory-layers"
  | "context-defenses"
  | "rag-flow"
  | "graph-path"
  | "graph-tools"
  | "architecture"
  | "workspace"
  | "model-guards"
  | "mcp"
  | "salesforce"
  | "routing"
  | "reliability"
  | "governance"
  | "ui-layers"
  | "observability"
  | "evaluations"
  | "images"
  | "push-plan"
  | "long-term-memory"
  | "marketing-cloud"
  | "use-cases"
  | "agent-lifecycle";

export type TryIt =
  | { kind: "prompt"; label: string; prompt: string }
  | {
      kind: "view";
      label: string;
      view: "graph" | "history" | "evaluations" | "journeys" | "architecture";
    };

export type SectionLesson = { diagram: DiagramId; keyIdea: string; tryIt?: TryIt[] };

export type PartLesson = {
  number: number;
  tagline: string;
  minutes: number;
  outcomes: string[];
  check: { question: string; options: string[]; answer: number; explain: string };
};

export const PART_LESSONS: Record<string, PartLesson> = {
  context: {
    number: 1,
    tagline: "What the model can see, and why it matters",
    minutes: 6,
    outcomes: [
      "Name what fills a model's context window on every call",
      "Tell working memory, the audit trail, and long-term memory apart",
      "Spot the context failures the demo defends against",
    ],
    check: {
      question: "Which of these does the model see on every turn?",
      options: [
        "The full turn history",
        "The recent conversation and a summary of the workspace",
        "Every earlier tool result, in full",
        "The whole knowledge graph",
      ],
      answer: 1,
      explain:
        "Models keep nothing between calls. Each turn sends the last 8 messages (text only) and a summary of the workspace: the draft in progress, open records, and context gathered. Turn history is for people, and the graph is queried through tools.",
    },
  },
  graphrag: {
    number: 2,
    tagline: "Grounding answers in connected facts",
    minutes: 7,
    outcomes: [
      "Explain retrieve → augment → generate",
      "Say when a graph beats similarity search",
      "Describe how the demo's six graph tools return evidence paths",
    ],
    check: {
      question: "Which question needs GraphRAG rather than plain vector RAG?",
      options: [
        "“Find the paragraph in the brief about the offer.”",
        "“Which accounts engaged with two campaigns and lack SMS consent?”",
        "“Summarize this email draft.”",
        "“Translate the headline into Spanish.”",
      ],
      answer: 1,
      explain:
        "It joins facts across accounts, campaigns, engagement, and consent: a multi-hop question. Similarity search finds similar text but can't follow relationships.",
    },
  },
  concepts: {
    number: 3,
    tagline: "Every moving part of the workbench",
    minutes: 20,
    outcomes: [
      "Trace one chat turn from the browser to Salesforce and back",
      "Explain why routing and guards sit around the model",
      "Know where to look when something goes wrong",
    ],
    check: {
      question: "Who decides whether you may create a campaign from the workbench?",
      options: [
        "The model, based on the conversation",
        "The workbench, from its own list of users",
        "Salesforce, from your profile, permission sets, and sharing",
        "Nobody: any signed-in user can write",
      ],
      answer: 2,
      explain:
        "Salesforce owns authorization. The workbench asks it, as you, before preparing the write and shows each check on the confirmation card; Apex enforces the same permissions again when the write runs. The model only drafts and proposes.",
    },
  },
};

const BUYER_GROUP_PROMPT = "Who should be in the buyer group for Acme Outfitters, and why?";
const EMAIL_PROMPT =
  "Draft an email campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu";
const PUSH_PROMPT =
  "Draft a push notification campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu";

export const SECTION_LESSONS: Record<string, SectionLesson> = {
  "what-is-context": {
    diagram: "context-window",
    keyIdea:
      "The model sees only what's in this call's window. Good context is the smallest set of high-signal facts for the next step.",
    tryIt: [
      {
        kind: "prompt",
        label: "Ask a question, then open its technical trace",
        prompt: "Summarize the sample campaign and its recent performance",
      },
    ],
  },
  "memory-layers": {
    diagram: "memory-layers",
    keyIdea:
      "“Session context” is three things: working memory for the model, an audit trail for people, and long-term memory by relationship.",
    tryIt: [{ kind: "view", label: "Open turn history and memory", view: "history" }],
  },
  "context-risks": {
    diagram: "context-defenses",
    keyIdea:
      "Treat earlier replies and tool results as data, not instructions, and never let the model hold write tools.",
    tryIt: [
      { kind: "prompt", label: "Try a blocked request", prompt: "Publish and send the campaign" },
    ],
  },
  rag: {
    diagram: "rag-flow",
    keyIdea:
      "RAG adds retrieved facts to the context so answers come from your data, not training.",
  },
  "graphrag-explained": {
    diagram: "graph-path",
    keyIdea:
      "GraphRAG follows relationships, so an answer can join many facts and show the path that proves it.",
    tryIt: [{ kind: "view", label: "Explore the graph", view: "graph" }],
  },
  "graphrag-here": {
    diagram: "graph-tools",
    keyIdea:
      "Nine curated, read-only queries, each returning evidence paths, with a local copy that must match Neo4j exactly.",
    tryIt: [
      { kind: "prompt", label: "Ask a graph question", prompt: BUYER_GROUP_PROMPT },
      { kind: "view", label: "Open the graph explorer", view: "graph" },
    ],
  },
  orchestrator: {
    diagram: "architecture",
    keyIdea:
      "One stateful agent per user runs each turn as a short tool loop and records every event.",
  },
  workspace: {
    diagram: "workspace",
    keyIdea:
      "Tools fill the workspace, the model drafts into it, and confirmed writes act on exactly what it shows.",
    tryIt: [
      {
        kind: "prompt",
        label: "Draft an email and watch the workspace fill",
        prompt: EMAIL_PROMPT,
      },
    ],
  },
  model: {
    diagram: "model-guards",
    keyIdea:
      "The model was chosen by measuring the whole pipeline, and its known quirks shaped the guards.",
    tryIt: [{ kind: "view", label: "See the model comparison", view: "evaluations" }],
  },
  mcp: {
    diagram: "mcp",
    keyIdea:
      "MCP lets any agent list and call tools the same way, whether the server is remote or in-process.",
  },
  salesforce: {
    diagram: "salesforce",
    keyIdea:
      "Salesforce is the system of record: drafts become real campaigns, briefs, and messages there, through Apex actions the model can't call.",
    tryIt: [
      {
        kind: "prompt",
        label: "Check campaign readiness",
        prompt: "Check the sample campaign readiness and explain every blocker",
      },
    ],
  },
  routing: {
    diagram: "routing",
    keyIdea:
      "Deterministic routers decide what must never be left to chance; the model handles the rest.",
    tryIt: [{ kind: "view", label: "See each turn's interpretation", view: "history" }],
  },
  reliability: {
    diagram: "reliability",
    keyIdea:
      "Small models fail at tool calls in predictable ways, so each failure mode gets a specific guard.",
  },
  governance: {
    diagram: "governance",
    keyIdea:
      "Salesforce owns authorization: it checks your permissions before a write is prepared and again when it runs. A person confirms every write.",
  },
  ui: {
    diagram: "ui-layers",
    keyIdea:
      "Model text renders as safe Markdown; records render as typed cards with accessible fallbacks.",
  },
  observability: {
    diagram: "observability",
    keyIdea: "Every turn leaves a trace for engineers and a history for reviewers.",
    tryIt: [{ kind: "view", label: "Open turn history", view: "history" }],
  },
  evaluations: {
    diagram: "evaluations",
    keyIdea:
      "Evaluate the real pipeline, not just the model, and keep held-out prompts to catch overfitting.",
    tryIt: [{ kind: "view", label: "Open evaluations", view: "evaluations" }],
  },
  images: {
    diagram: "images",
    keyIdea:
      "Generated images stay private drafts until a person confirms, and Salesforce verifies the file's hash.",
  },
  "marketing-cloud": {
    diagram: "marketing-cloud",
    keyIdea:
      "Salesforce's Campaign Creation agent creates the brief, the campaign, and its flow; the workbench asks it to, after you confirm, and reads the result back.",
    tryIt: [
      { kind: "prompt", label: "Draft the Coastline Kitchen email", prompt: EMAIL_PROMPT },
      {
        kind: "prompt",
        label: "Create a campaign in Marketing Cloud",
        prompt: "Create a campaign in Marketing Cloud for Coastline Kitchen's late-night tacos",
      },
    ],
  },
  "object-model": {
    diagram: "agent-lifecycle",
    keyIdea:
      "Every plan, brief, module, claim and result is one object with an identifier it keeps for life. Governance travels with it, and everything else (lineage, screens, channels) is derived from it, never copied.",
    tryIt: [{ kind: "view", label: "Open the Architecture view", view: "architecture" }],
  },
  gateway: {
    diagram: "agent-lifecycle",
    keyIdea:
      "Nothing acts except through one gateway: default-deny policy, a per-call identity, and a record of the decision. An agent that is denied leaves a trace; it never gets a second route.",
    tryIt: [{ kind: "view", label: "See the swimlane and policies", view: "architecture" }],
  },
  lifecycle: {
    diagram: "agent-lifecycle",
    keyIdea:
      "Agents do the narrow work and people decide. An agent cites an approved claim or refuses, readiness blocks until the evidence holds, and only a person moves an object to approved.",
    tryIt: [{ kind: "view", label: "Run the lifecycle", view: "architecture" }],
  },
  "agent-operations": {
    diagram: "agent-lifecycle",
    keyIdea:
      "Agents, prompts and models are catalogued and scored, so a regression is caught before it ships and an agent that drifts is constrained before anyone has to notice.",
    tryIt: [{ kind: "view", label: "See evaluations and trust", view: "architecture" }],
  },
  "use-cases": {
    diagram: "use-cases",
    keyIdea:
      "Each use case pairs a live outside service with the graph: the service says what's happening, and the graph says who or what it affects: people and how to reach them, or dishes and the stock they draw on.",
    tryIt: [
      {
        kind: "prompt",
        label: "Plan buyer-group outreach",
        prompt: "Plan outreach to Acme Outfitters' buyer group for the next month",
      },
      {
        kind: "prompt",
        label: "Assess a weather disruption",
        prompt:
          "There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?",
      },
      {
        kind: "prompt",
        label: "Check inventory against the forecast",
        prompt: "Check inventory for our Sacramento store against the forecast",
      },
    ],
  },
  "campaign-context": {
    diagram: "push-plan",
    keyIdea:
      "Outside context (menu, weather, past results) turns a generic draft into one that fits this moment.",
    tryIt: [
      { kind: "prompt", label: "Draft the Coastline Kitchen email", prompt: EMAIL_PROMPT },
      { kind: "prompt", label: "Draft the Coastline Kitchen push", prompt: PUSH_PROMPT },
    ],
  },
  "long-term-memory": {
    diagram: "long-term-memory",
    keyIdea:
      "The server remembers what you confirmed; the model only recalls it, dated and sourced, and re-checks Salesforce before reusing it.",
    tryIt: [
      { kind: "prompt", label: "Remember the current draft", prompt: "Remember this draft" },
      {
        kind: "prompt",
        label: "Ask what we worked on",
        prompt: "What have we worked on recently?",
      },
      { kind: "view", label: "Open History → Memory", view: "history" },
    ],
  },
};
