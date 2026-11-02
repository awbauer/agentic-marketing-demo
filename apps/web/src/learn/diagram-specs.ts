/**
 * Every Learn diagram as data, with no JSX: diagrams.tsx draws them on the page, and
 * `pnpm learn:export` turns the same specs into Mermaid for docs/learn.md, so the two can't drift.
 */
import type { DiagramId } from "./lessons";

export type Tone =
  | "user"
  | "edge"
  | "model"
  | "tool"
  | "store"
  | "guard"
  | "output"
  | "blocked"
  | "person";
export type Step = { title: string; caption?: string; tone: Tone; glyph?: string };
export type Card = Step & { points?: string[] };

export type DiagramBlock =
  | { kind: "flow"; steps: Step[]; numbered?: boolean }
  | { kind: "lanes"; lanes: Array<{ label: string; steps: Step[] }> }
  | { kind: "cards"; cards: Card[] }
  | { kind: "chips"; label: string; items: string[] }
  | {
      kind: "context-window";
      segments: Array<{ name: string; detail: string; share: number; tone: Tone }>;
      steps: Step[];
    }
  | {
      kind: "memory-layers";
      layers: Array<{
        name: string;
        where: string;
        reader: string;
        life: string;
        width: number;
        tone: Tone;
      }>;
    }
  | {
      kind: "graph-path";
      description: string;
      nodes: Array<{ id: string; label: string; name: string; x: number; y: number }>;
      edges: Array<{ from: string; to: string; type: string; path: boolean }>;
    }
  | {
      kind: "graph-tools";
      tools: Array<{ name: string; question: string }>;
      stores: Step[];
      parity: string;
    }
  | { kind: "architecture"; tiers: Array<{ label: string; steps: Step[] }> };

export type DiagramSpec = { label: string; caption: string; blocks: DiagramBlock[] };

export const DIAGRAM_SPECS: Record<DiagramId, DiagramSpec> = {
  "context-window": {
    label: "What fills the context window",
    caption:
      "One model call. Proportions are illustrative; the window is rebuilt from scratch every call.",
    blocks: [
      {
        kind: "context-window",
        segments: [
          {
            name: "System rules",
            detail: "authority, safety, format",
            share: 14,
            tone: "guard",
          },
          {
            name: "Tool definitions",
            detail: "names, descriptions, schemas",
            share: 30,
            tone: "tool",
          },
          {
            name: "Conversation",
            detail: "last 8 messages, text only",
            share: 28,
            tone: "user",
          },
          {
            name: "Tool results",
            detail: "this turn only",
            share: 20,
            tone: "store",
          },
          {
            name: "Latest message",
            detail: "what to do now",
            share: 8,
            tone: "person",
          },
        ],
        steps: [
          {
            title: "gpt-oss-20b",
            caption: "reads the whole window",
            tone: "model",
            glyph: "◆",
          },
          {
            title: "Next step",
            caption: "call a tool, or answer",
            tone: "output",
            glyph: "→",
          },
        ],
      },
    ],
  },
  "memory-layers": {
    label: "Three layers of memory",
    caption:
      "Each layer has a different reader and lifetime. Only working memory is sent to the model every turn.",
    blocks: [
      {
        kind: "memory-layers",
        layers: [
          {
            name: "Working memory",
            where: "Agent Durable Object · chat messages",
            reader: "Read by the model",
            life: "Until New chat",
            width: 22,
            tone: "user",
          },
          {
            name: "Audit trail",
            where: "Agent SQLite · turn history",
            reader: "Read by people",
            life: "24 hours",
            width: 58,
            tone: "store",
          },
          {
            name: "Long-term memory",
            where: "Knowledge graph · linked to campaigns and brands",
            reader: "Recalled by the model, through tools",
            life: "14 days, across chats",
            width: 100,
            tone: "tool",
          },
        ],
      },
    ],
  },
  "context-defenses": {
    label: "Context risks and defenses",
    caption: "Each risk has a defense that doesn't depend on the model behaving.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Stale claims",
            steps: [
              {
                title: "Old reply says X",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Re-check with tools",
                caption: "earlier replies are context, not evidence",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
          {
            label: "Prompt injection",
            steps: [
              {
                title: "“Ignore your rules”",
                caption: "hidden in data",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "No write tools",
                caption: "policy router · human confirmation",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
          {
            label: "Overflow",
            steps: [
              {
                title: "Reasoning uses the budget",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "4,096-token budget",
                caption: "text-only final step · recovery message",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  "rag-flow": {
    label: "Retrieval-augmented generation",
    caption: "Retrieval puts the right facts in the window before the model answers.",
    blocks: [
      {
        kind: "flow",
        numbered: true,
        steps: [
          {
            title: "Question",
            tone: "person",
            glyph: "?",
          },
          {
            title: "Retrieve",
            caption: "search your data",
            tone: "tool",
            glyph: "⌕",
          },
          {
            title: "Augment",
            caption: "add facts to the context",
            tone: "store",
            glyph: "+",
          },
          {
            title: "Generate",
            caption: "answer from those facts",
            tone: "model",
            glyph: "◆",
          },
        ],
      },
    ],
  },
  "marketing-cloud": {
    label: "How a campaign is created in Marketing Cloud Next",
    caption:
      "Every record is created by the Campaign Creation agent's standard actions, after you confirm; the workbench reads each one back.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Draft",
            steps: [
              {
                title: "Your request + context",
                tone: "person",
                glyph: "?",
              },
              {
                title: "Draft a Campaign Brief",
                caption: "Campaign Creation agent",
                tone: "tool",
                glyph: "◆",
              },
              {
                title: "Brief in the focus",
                caption: "nothing saved",
                tone: "output",
                glyph: "✎",
              },
            ],
          },
          {
            label: "Save brief",
            steps: [
              {
                title: "You confirm",
                caption: "permission check first",
                tone: "guard",
                glyph: "✓",
              },
              {
                title: "Save Brief → Draft Preview",
                caption: "Brief + BriefPlanSteps",
                tone: "store",
                glyph: "◇",
              },
            ],
          },
          {
            label: "Create campaign",
            steps: [
              {
                title: "You confirm",
                tone: "guard",
                glyph: "✓",
              },
              {
                title: "Create → Save Campaign",
                caption: "Campaign + draft flow",
                tone: "store",
                glyph: "◇",
              },
              {
                title: "Activate in Marketing Cloud",
                caption: "never from the workbench",
                tone: "person",
                glyph: "→",
              },
            ],
          },
        ],
      },
    ],
  },
  "agent-lifecycle": {
    label: "Plan to learn, with a person at every gate",
    caption:
      "People decide at each stage, agents do the narrow work, and every call between them passes the gateway. Performance re-enters planning inside the quarter.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "People decide",
            steps: [
              { title: "Brand planner", caption: "approves the plan", tone: "person", glyph: "?" },
              {
                title: "Marketer",
                caption: "validates brief and reuse",
                tone: "person",
                glyph: "?",
              },
              {
                title: "Content Lab",
                caption: "approves every module",
                tone: "person",
                glyph: "?",
              },
              { title: "Compliance", caption: "owns the evidence", tone: "person", glyph: "?" },
              {
                title: "Reviewer",
                caption: "decides, by state machine",
                tone: "person",
                glyph: "?",
              },
              {
                title: "Brand lead",
                caption: "disposes on optimization",
                tone: "person",
                glyph: "?",
              },
            ],
          },
          {
            label: "Agents work",
            steps: [
              {
                title: "Plan and scenario",
                caption: "plan → structured demand",
                tone: "tool",
                glyph: "▸",
              },
              { title: "Brief and reuse", caption: "inherits the plan", tone: "tool", glyph: "▸" },
              { title: "Module authoring", caption: "cites or refuses", tone: "tool", glyph: "▸" },
              { title: "Substantiation", caption: "evidence per claim", tone: "tool", glyph: "▸" },
              {
                title: "Readiness and farm",
                caption: "block until it passes",
                tone: "guard",
                glyph: "◆",
              },
              {
                title: "Attribution and optimization",
                caption: "signal → module → claim",
                tone: "tool",
                glyph: "▸",
              },
            ],
          },
          {
            label: "Governed by",
            steps: [
              { title: "Governed objects", caption: "one id for life", tone: "store", glyph: "⋈" },
              { title: "Gateway", caption: "default-deny · identity", tone: "guard", glyph: "◆" },
              { title: "Registry", caption: "versioned · scoped", tone: "store", glyph: "▤" },
              { title: "State machine", caption: "11 transitions", tone: "guard", glyph: "◆" },
              { title: "Evaluators", caption: "13 · drift watch", tone: "guard", glyph: "✓" },
              { title: "Channels", caption: "one card, four surfaces", tone: "output", glyph: "✎" },
            ],
          },
        ],
      },
    ],
  },
  "use-cases": {
    label: "Sales and service use cases",
    caption:
      "A live outside service says what's happening; the knowledge graph says who or what it affects, and a confirmed write goes to Salesforce only when you approve it.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Sales",
            steps: [
              {
                title: "Account + time frame",
                tone: "person",
                glyph: "?",
              },
              {
                title: "plan_account_outreach",
                caption: "contacts · consent · country",
                tone: "store",
                glyph: "⋈",
              },
              {
                title: "Nager.Date",
                caption: "public holidays",
                tone: "tool",
                glyph: "↗",
              },
              {
                title: "Dated outreach plan",
                caption: "consented channels only",
                tone: "output",
                glyph: "✎",
              },
            ],
          },
          {
            label: "Service",
            steps: [
              {
                title: "Location + concern",
                tone: "person",
                glyph: "?",
              },
              {
                title: "National Weather Service",
                caption: "active alerts",
                tone: "tool",
                glyph: "↗",
              },
              {
                title: "assess_location_impact",
                caption: "audience · push reach · campaigns",
                tone: "store",
                glyph: "⋈",
              },
              {
                title: "Impact + drafted notice",
                caption: "aggregate only",
                tone: "output",
                glyph: "✎",
              },
            ],
          },
          {
            label: "Inventory",
            steps: [
              {
                title: "Open-Meteo forecast",
                caption: "heat, rain, …",
                tone: "tool",
                glyph: "↗",
              },
              {
                title: "map_weather_demand",
                caption: "dishes · stock · manager",
                tone: "store",
                glyph: "⋈",
              },
              {
                title: "Store inventory",
                caption: "randomized mock",
                tone: "tool",
                glyph: "▤",
              },
              {
                title: "Case for the manager",
                caption: "after you confirm",
                tone: "output",
                glyph: "✎",
              },
            ],
          },
        ],
      },
    ],
  },
  "long-term-memory": {
    label: "How long-term memory is written, recalled, and forgotten",
    caption:
      "The server writes memory on events it verified; the model can only recall it, for this workspace, and must re-check Salesforce.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Remember",
            steps: [
              {
                title: "Confirmed write or “remember this”",
                caption: "read back from Salesforce",
                tone: "person",
                glyph: "✓",
              },
              {
                title: "Server writes fixed Cypher",
                caption: "never the model",
                tone: "edge",
                glyph: "⚙",
              },
              {
                title: "Draft · Decision nodes",
                caption: "ABOUT campaigns and brands",
                tone: "store",
                glyph: "◇",
              },
            ],
          },
          {
            label: "Recall",
            steps: [
              {
                title: "“What did we decide…?”",
                tone: "person",
                glyph: "?",
              },
              {
                title: "recall_decisions",
                caption: "workspace set by the server",
                tone: "tool",
                glyph: "⌕",
              },
              {
                title: "Dated, sourced answer",
                caption: "re-check Salesforce before reuse",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
          {
            label: "Forget",
            steps: [
              {
                title: "History → Memory → Forget",
                tone: "person",
                glyph: "×",
              },
              {
                title: "Hourly sweep",
                caption: "after 14 days",
                tone: "edge",
                glyph: "⏱",
              },
            ],
          },
        ],
      },
    ],
  },
  "graph-path": {
    label: "An evidence path in the knowledge graph",
    caption:
      "Answering “why is Acme in the fall audience?” means following relationships. The highlighted path is the evidence.",
    blocks: [
      {
        kind: "graph-path",
        description:
          "Fall Loyalty campaign targets the fall audience segment, which includes the economic buyer persona, who works at Acme Outfitters. The persona also has email marketing consent and engaged with the hero email.",
        nodes: [
          {
            id: "campaign",
            label: "Campaign",
            name: "Fall Loyalty",
            x: 70,
            y: 60,
          },
          {
            id: "segment",
            label: "Segment",
            name: "Fall audience",
            x: 230,
            y: 60,
          },
          {
            id: "persona",
            label: "Persona",
            name: "Economic buyer",
            x: 390,
            y: 60,
          },
          {
            id: "account",
            label: "Account",
            name: "Acme Outfitters",
            x: 550,
            y: 60,
          },
          {
            id: "consent",
            label: "ConsentScope",
            name: "Email marketing",
            x: 540,
            y: 180,
          },
          {
            id: "asset",
            label: "ContentAsset",
            name: "Hero email",
            x: 240,
            y: 180,
          },
        ],
        edges: [
          {
            from: "campaign",
            to: "segment",
            type: "TARGETS",
            path: true,
          },
          {
            from: "segment",
            to: "persona",
            type: "INCLUDES",
            path: true,
          },
          {
            from: "persona",
            to: "account",
            type: "WORKS_AT",
            path: true,
          },
          {
            from: "persona",
            to: "consent",
            type: "HAS_CONSENT",
            path: false,
          },
          {
            from: "persona",
            to: "asset",
            type: "ENGAGED_WITH",
            path: false,
          },
        ],
      },
    ],
  },
  "graph-tools": {
    label: "The nine curated graph tools",
    caption:
      "Each tool is a fixed, parameterized Cypher query in read mode that returns an answer plus evidence paths.",
    blocks: [
      {
        kind: "graph-tools",
        tools: [
          {
            name: "explain_buyer_group",
            question: "Why is this member in the group?",
          },
          {
            name: "find_audience_overlap",
            question: "Who is also targeted elsewhere?",
          },
          {
            name: "check_consent_coverage",
            question: "Who lacks consent for a channel?",
          },
          {
            name: "find_similar_past_pushes",
            question: "What worked in this weather and daypart?",
          },
          {
            name: "trace_content_lineage",
            question: "What was built from this brief?",
          },
          {
            name: "get_graph_overview",
            question: "What is in the graph?",
          },
          {
            name: "plan_account_outreach",
            question: "Who to contact, on which consented channel?",
          },
          {
            name: "assess_location_impact",
            question: "Who is affected near this location?",
          },
          {
            name: "map_weather_demand",
            question: "Which dishes and stock will the weather draw on?",
          },
        ],
        stores: [
          {
            title: "Neo4j Aura",
            caption: "Query API · read mode",
            tone: "store",
            glyph: "◉",
          },
          {
            title: "Local copy",
            caption: "same dataset, in memory",
            tone: "store",
            glyph: "◌",
          },
        ],
        parity: "= identical results =",
      },
    ],
  },
  architecture: {
    label: "How a turn travels through the system",
    caption:
      "The browser talks to one Worker behind Cloudflare Access; each user's orchestrator reaches the model and three MCP servers.",
    blocks: [
      {
        kind: "architecture",
        tiers: [
          {
            label: "Browser",
            steps: [
              {
                title: "Workbench",
                caption: "React · streaming chat",
                tone: "person",
                glyph: "▢",
              },
            ],
          },
          {
            label: "Cloudflare edge",
            steps: [
              {
                title: "Worker + Access",
                caption: "identity, routing, assets",
                tone: "edge",
                glyph: "⛨",
              },
              {
                title: "Orchestrator",
                caption: "Durable Object per user",
                tone: "edge",
                glyph: "◎",
              },
            ],
          },
          {
            label: "Model and tools",
            steps: [
              {
                title: "Workers AI",
                caption: "gpt-oss-20b via AI Gateway",
                tone: "model",
                glyph: "◆",
              },
              {
                title: "Salesforce MCP",
                caption: "agents and Apex",
                tone: "tool",
                glyph: "☁",
              },
              {
                title: "Campaign context",
                caption: "profile · Open-Meteo",
                tone: "tool",
                glyph: "☀",
              },
              {
                title: "Knowledge graph",
                caption: "Neo4j Aura",
                tone: "tool",
                glyph: "⋈",
              },
            ],
          },
          {
            label: "Storage",
            steps: [
              {
                title: "Agent SQLite",
                caption: "messages, turn history",
                tone: "store",
                glyph: "▤",
              },
              {
                title: "D1 + R2",
                caption: "confirmations, image drafts",
                tone: "store",
                glyph: "▤",
              },
            ],
          },
        ],
      },
    ],
  },
  workspace: {
    label: "How the workspace is built and used",
    caption:
      "Code turns tool results into context and records; the model drafts into the focus; confirmed writes act on the focus version shown.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Tools",
            steps: [
              {
                title: "Tool result",
                caption: "weather, graph, Salesforce",
                tone: "tool",
                glyph: "▶",
              },
              {
                title: "Context and records",
                caption: "built by code, any system",
                tone: "store",
                glyph: "▤",
              },
            ],
          },
          {
            label: "Drafting",
            steps: [
              {
                title: "Model drafts",
                tone: "model",
                glyph: "◆",
              },
              {
                title: "Saved from the answer",
                caption: "labeled lines become fields",
                tone: "guard",
                glyph: "✎",
              },
              {
                title: "Focus v1, v2…",
                caption: "every version kept",
                tone: "output",
                glyph: "◎",
              },
            ],
          },
          {
            label: "Writes",
            steps: [
              {
                title: "Confirm",
                caption: "the version on screen",
                tone: "person",
                glyph: "☑",
              },
              {
                title: "Signed write",
                tone: "guard",
                glyph: "⛨",
              },
              {
                title: "Record updated",
                tone: "output",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  "model-guards": {
    label: "The model and its known quirks",
    caption: "The quirks are predictable, so each one has a targeted guard.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Every turn",
            steps: [
              {
                title: "gpt-oss-20b",
                caption: "open-weight reasoning model",
                tone: "model",
                glyph: "◆",
              },
              {
                title: "AI Gateway",
                caption: "logs, cost, caching",
                tone: "edge",
                glyph: "⛨",
              },
            ],
          },
          {
            label: "Known quirks",
            steps: [
              {
                title: "Tool call in its text",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Channel markup in names",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Guards repair both",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  mcp: {
    label: "How MCP works",
    caption:
      "Clients discover tools with tools/list and run them with tools/call; the transport can be HTTP or in-memory.",
    blocks: [
      {
        kind: "flow",
        steps: [
          {
            title: "Orchestrator",
            caption: "MCP client",
            tone: "edge",
            glyph: "◎",
          },
          {
            title: "tools/list",
            caption: "names, descriptions, schemas",
            tone: "tool",
            glyph: "☰",
          },
          {
            title: "tools/call",
            caption: "validated JSON arguments",
            tone: "tool",
            glyph: "▶",
          },
          {
            title: "Result",
            caption: "structured content",
            tone: "output",
            glyph: "◧",
          },
        ],
      },
      {
        kind: "cards",
        cards: [
          {
            title: "Salesforce Hosted MCP",
            caption: "14 governed tools · remote · per-user OAuth",
            tone: "tool",
            glyph: "☁",
          },
          {
            title: "Campaign context",
            caption: "profile + weather · in-process and HTTP",
            tone: "tool",
            glyph: "☀",
          },
          {
            title: "Knowledge graph",
            caption: "nine curated queries · in-process and HTTP",
            tone: "tool",
            glyph: "⋈",
          },
        ],
      },
    ],
  },
  salesforce: {
    label: "Reads and writes in Salesforce",
    caption:
      "Reads go through agents on Hosted MCP. Writes create or update real records through Apex actions, after a permission check and your confirmation.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Read",
            steps: [
              {
                title: "Orchestrator",
                tone: "edge",
                glyph: "◎",
              },
              {
                title: "Hosted MCP tool",
                tone: "tool",
                glyph: "☁",
              },
              {
                title: "Agentforce agent",
                caption: "Agent Script",
                tone: "model",
                glyph: "◆",
              },
              {
                title: "Grounded answer",
                tone: "output",
                glyph: "✓",
              },
            ],
          },
          {
            label: "Write",
            steps: [
              {
                title: "Draft in focus",
                tone: "person",
                glyph: "◎",
              },
              {
                title: "Permission check",
                caption: "as you",
                tone: "tool",
                glyph: "⚿",
              },
              {
                title: "You confirm",
                tone: "person",
                glyph: "☑",
              },
              {
                title: "Apex, user mode",
                caption: "campaign, brief, message",
                tone: "guard",
                glyph: "⚙",
              },
              {
                title: "Record read-back",
                tone: "output",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  routing: {
    label: "How a message is routed",
    caption:
      "Two deterministic routers run before the model. Forced tools come one per step, then the model answers with no tools.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Write or forbidden",
            steps: [
              {
                title: "Message",
                tone: "person",
                glyph: "✉",
              },
              {
                title: "Policy router",
                tone: "guard",
                glyph: "⛨",
              },
              {
                title: "Fixed reply",
                caption: "no model call",
                tone: "blocked",
                glyph: "■",
              },
            ],
          },
          {
            label: "Clear intent",
            steps: [
              {
                title: "Intent router",
                tone: "guard",
                glyph: "⑂",
              },
              {
                title: "Tool plan",
                caption: "one forced tool per step",
                tone: "tool",
                glyph: "▶",
              },
              {
                title: "Answer",
                caption: "no tools",
                tone: "model",
                glyph: "◆",
              },
            ],
          },
          {
            label: "Unclear",
            steps: [
              {
                title: "Model chooses",
                caption: "from allowed tools",
                tone: "model",
                glyph: "◆",
              },
              {
                title: "Answer",
                tone: "output",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  reliability: {
    label: "Tool-call failures and their guards",
    caption: "The forced-tool middleware sits between the model and the tools.",
    blocks: [
      {
        kind: "lanes",
        lanes: [
          {
            label: "Call in text",
            steps: [
              {
                title: "JSON in reasoning",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Salvage if schema matches",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
          {
            label: "Bad name",
            steps: [
              {
                title: "name<|channel|>…",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Repair if one tool matches",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
          {
            label: "No call",
            steps: [
              {
                title: "Nothing usable",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Retry once",
                tone: "guard",
                glyph: "↻",
              },
            ],
          },
          {
            label: "Timeouts",
            steps: [
              {
                title: "Stalled turn",
                tone: "blocked",
                glyph: "!",
              },
              {
                title: "Explain, don't go silent",
                tone: "guard",
                glyph: "✓",
              },
            ],
          },
        ],
      },
    ],
  },
  governance: {
    label: "How a write is checked and confirmed",
    caption:
      "Every write takes the same five steps. Salesforce checks your permissions before the card appears and again when the write runs; operators can also pause writes or tools without a deploy.",
    blocks: [
      {
        kind: "flow",
        numbered: true,
        steps: [
          {
            title: "Plan",
            caption: "built from your draft",
            tone: "edge",
            glyph: "✎",
          },
          {
            title: "Permission check",
            caption: "Salesforce, as you",
            tone: "tool",
            glyph: "⚿",
          },
          {
            title: "You confirm",
            caption: "exact values, hashed",
            tone: "person",
            glyph: "☑",
          },
          {
            title: "Signed write",
            caption: "Apex, user mode",
            tone: "guard",
            glyph: "⛨",
          },
          {
            title: "Read-back",
            caption: "created or updated",
            tone: "output",
            glyph: "✓",
          },
        ],
      },
      {
        kind: "cards",
        cards: [
          {
            title: "Model",
            caption: "drafts and proposes; holds no write tools",
            tone: "model",
            glyph: "◆",
          },
          {
            title: "Workbench",
            caption: "plans, asks Salesforce, hashes, signs",
            tone: "edge",
            glyph: "◎",
          },
          {
            title: "You",
            caption: "review and confirm",
            tone: "person",
            glyph: "☑",
          },
          {
            title: "Salesforce",
            caption: "owns authorization, verifies, writes, reads back",
            tone: "tool",
            glyph: "☁",
          },
        ],
      },
    ],
  },
  "ui-layers": {
    label: "How answers render",
    caption: "Every surface has a safe, accessible rendering path.",
    blocks: [
      {
        kind: "cards",
        cards: [
          {
            title: "Markdown",
            caption: "model text · never raw HTML",
            tone: "model",
            glyph: "¶",
          },
          {
            title: "HXL card",
            caption: "typed Salesforce widget",
            tone: "tool",
            glyph: "▦",
          },
          {
            title: "Native fallback",
            caption: "same contract, accessible",
            tone: "output",
            glyph: "▣",
          },
          {
            title: "Graph evidence",
            caption: "paths with text alternatives",
            tone: "store",
            glyph: "⋈",
          },
        ],
      },
    ],
  },
  observability: {
    label: "Three ways to see what happened",
    caption: "Engineers read the trace; reviewers read history; auditors export it.",
    blocks: [
      {
        kind: "cards",
        cards: [
          {
            title: "Technical trace",
            caption: "under each answer",
            tone: "edge",
            glyph: "≋",
            points: ["reasoning start / end", "tool input / output", "timings and tokens"],
          },
          {
            title: "Turn history",
            caption: "History view · 24 hours",
            tone: "store",
            glyph: "▤",
            points: ["interpretation", "tool calls", "outcome"],
          },
          {
            title: "Audit export",
            caption: "JSON download",
            tone: "output",
            glyph: "⇩",
            points: ["confirmed writes", "turn summaries"],
          },
        ],
      },
    ],
  },
  evaluations: {
    label: "What the evaluations measure",
    caption: "Three suites run the production pipeline; every turn is scored on four checks.",
    blocks: [
      {
        kind: "cards",
        cards: [
          {
            title: "Demo scenarios",
            caption: "Use-case prompts, full pipeline",
            tone: "person",
            glyph: "▶",
          },
          {
            title: "Pipeline routing",
            caption: "20 prompts, as evaluators see them",
            tone: "guard",
            glyph: "⑂",
          },
          {
            title: "Model-only routing",
            caption: "no routers: raw model skill",
            tone: "model",
            glyph: "◆",
          },
        ],
      },
      {
        kind: "chips",
        label: "Scores",
        items: ["Right tool or plan", "Answered", "No tool errors", "No false write claims"],
      },
    ],
  },
  images: {
    label: "From concept to Salesforce file",
    caption: "Drafts stay private until a person confirms; Salesforce verifies the file hash.",
    blocks: [
      {
        kind: "flow",
        steps: [
          {
            title: "Concept",
            caption: "PII and injection checks",
            tone: "person",
            glyph: "✎",
          },
          {
            title: "FLUX.2 klein",
            caption: "1024 × 1024 draft",
            tone: "model",
            glyph: "◆",
          },
          {
            title: "R2 draft",
            caption: "private, 7 days",
            tone: "store",
            glyph: "▤",
          },
          {
            title: "Confirm attach",
            tone: "guard",
            glyph: "☑",
          },
          {
            title: "Campaign file",
            caption: "hash checked by Apex",
            tone: "output",
            glyph: "✓",
          },
        ],
      },
    ],
  },
  "push-plan": {
    label: "The Coastline campaign tool plan",
    caption:
      "Four forced tools in order: context, past results, then the content draft. The model presents the draft, and the workspace saves it as the focus.",
    blocks: [
      {
        kind: "flow",
        numbered: true,
        steps: [
          {
            title: "Restaurant profile",
            caption: "menu, favorites, voice",
            tone: "tool",
            glyph: "☰",
          },
          {
            title: "Current weather",
            caption: "Open-Meteo, live",
            tone: "tool",
            glyph: "☀",
          },
          {
            title: "Past pushes",
            caption: "knowledge graph",
            tone: "store",
            glyph: "⋈",
          },
          {
            title: "Content draft",
            caption: "Salesforce agent",
            tone: "tool",
            glyph: "☁",
          },
          {
            title: "Workspace focus",
            caption: "saved as version 1",
            tone: "output",
            glyph: "◎",
          },
        ],
      },
    ],
  },
};
