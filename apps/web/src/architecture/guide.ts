import { type Brand, type Persona, STAGE_OWNERS, type Stage } from "@northstar/architecture";

// Plain-language orientation for the architecture workspaces: what each one is, why it beats
// how the work is done today, where it sits in a person's day, and something to try for the
// brand in the header. The technical panels stay as they are; this sits on top of them.

export type Tab =
  | "flows"
  | "command-center"
  | "brief-builder"
  | "module-library"
  | "approvals"
  | "performance"
  | "agents"
  | "catalogs"
  | "evaluations"
  | "trust";

type BrandText = Record<Brand | "all", string>;

export type TabGuide = {
  label: string;
  group: "work" | "hood";
  /** What the screen is, in one sentence. */
  what: string;
  /** Why it is better than how the work is done today. */
  why: string;
  /** Something to try with the brand in the header, using the sample data. */
  tryIt: BrandText;
  /** The technical idea the screen demonstrates, for readers who want it. */
  technical: string;
};

export const TAB_GUIDES: Record<Tab, TabGuide> = {
  flows: {
    label: "Sample flows",
    group: "work",
    what: "A goal for each brand that a real orchestrator plans and hands, step by step, to real subagents, pausing for a person where only a person may decide.",
    why: "Instead of reading how the pieces fit, you watch them work: which agent the orchestrator picks, what each one writes or refuses, which of its calls the gateway allows, and the decision that is yours.",
    tryIt: {
      all: "Pick a flow and start the orchestrator. When it asks for your decision, open the module, then approve it or request changes.",
      "Harborstone Wealth":
        "Run the sweep-rate flow: watch the authoring agent get wire fees refused for lack of an approved claim, and the old fee-waiver email stopped because its evidence expired.",
      "Coastline Kitchen":
        "Run the cold-front flow: a what-if on the send date, a push written from two approved claims, and email and SMS versions that keep both whole.",
      "Lumera Therapeutics":
        "Run the congress flow: the superiority claim is refused and filed as a gap, the boxed warning is attached for you, and approval waits for you as the MLR reviewer.",
    },
    technical:
      "The orchestrator and every subagent run on Workers AI models the router picks. Subagents get their catalog prompt and only their granted tools; each tool call passes the gateway as that agent, acting for the step's owner. The services behind the tools enforce cite-or-refuse.",
  },
  "command-center": {
    label: "Command Center",
    group: "work",
    what: "Everything in flight for the brand, laid out by step from plan to results, with what is waiting on whom.",
    why: "Today this picture is pieced together from project trackers, inboxes and status meetings. Here it is read straight from the work itself, so it is never out of date.",
    tryIt: {
      all: "Look for cards marked “blockers” or “needs refresh”: those are the ones that need a person. Click any card to see its history and what it cites.",
      "Harborstone Wealth":
        "Open “Put idle cash to work”. It is flagged “needs refresh” because the sweep-rate claim it cites was replaced by a newer version.",
      "Coastline Kitchen":
        "Open “Soup weather is here” and follow it to the claim it cites and the result it earned.",
      "Lumera Therapeutics":
        "Open “Cardivance versus every ARB”. It is a draft with blockers: it cites a rejected superiority claim, so it cannot go to review.",
    },
    technical:
      "One object model (plans, briefs, modules, claims, results) rendered by a workspace manifest. Every screen in this section is the same renderer over a different manifest.",
  },
  "brief-builder": {
    label: "Brief Builder",
    group: "work",
    what: "Where plans are made and briefs are drafted from them.",
    why: "A brief usually re-types the plan’s audience, channel and dates, and the two drift apart. Here a brief points at the plan, so when the plan changes, every brief knows.",
    tryIt: {
      all: "Pick a brand in the header, then run “Propose a content plan”: it schedules waves around that brand’s calendar and says why.",
      "Harborstone Wealth":
        "Run “Propose a content plan”: it times sends around the Federal Reserve rate decisions and uses the best past channel.",
      "Coastline Kitchen":
        "Run “Propose a content plan”: it times sends around the Bay Area cold front and Thanksgiving.",
      "Lumera Therapeutics":
        "Run “Propose a content plan”: it times waves around the heart failure congress and the Cascade University P&T review.",
    },
    technical:
      "Plans hold structured demand (waves). Briefs reference a wave rather than copying it, and a plan revision is a new version that supersedes the old one.",
  },
  "module-library": {
    label: "Module Library",
    group: "work",
    what: "Approved, reusable pieces of content (modules) and the channel versions made from them.",
    why: "Writers normally copy claims from a spreadsheet or PDF and hope they are current. Here a module can only state a fact that is an approved claim, and anything it cannot back up is written down as a gap instead of being made up.",
    tryIt: {
      all: "Run “Author a module” with a few facts ticked. It writes only the approved ones and lists what it refused, and why.",
      "Harborstone Wealth":
        "Author a module with “sweep-apy” and “wire-fees” ticked: it writes the first and records a gap for the second, which has no approved claim.",
      "Coastline Kitchen":
        "Author a module with “chowder-price” and “soup-hours” ticked: both are approved, so it writes both and cites each one.",
      "Lumera Therapeutics":
        "Author a module with “cardivance-mortality” and “cardivance-superior” ticked: it writes the first, with the boxed warning and safety information, and refuses the rejected superiority claim.",
    },
    technical:
      "Cite-or-refuse authoring: every factual block carries a claim URN, required disclosures are attached from the claim, and atomization keeps each claim whole in every variant.",
  },
  approvals: {
    label: "Approvals",
    group: "work",
    what: "The review queue: what is waiting for a decision, and the decisions your role is allowed to take.",
    why: "Reviewers usually find the problems — a missing disclosure, lapsed evidence. Here those are caught before anything reaches the queue, so review time goes on judgment, not checklists.",
    tryIt: {
      all: "Run “Check readiness” on any draft: it lists exactly what blocks it from review.",
      "Harborstone Wealth":
        "Check readiness on “Start with 90 days of no advisory fees”: the fee-waiver evidence has expired, so it is blocked.",
      "Coastline Kitchen":
        "Assemble the evidence packet for “Soup weather is here”: one packet per claim, with the evidence and when it expires.",
      "Lumera Therapeutics":
        "Probe “Cardivance versus every ARB”: the red-team checks flag the superiority language before a reviewer ever sees it.",
    },
    technical:
      "An eleven-transition approval state machine with an append-only history. Readiness and the adversarial farm are agents; only people move an object to approved.",
  },
  performance: {
    label: "Performance",
    group: "work",
    what: "What each piece of content earned, traced back to the module and claim that carried it.",
    why: "Results usually arrive in a report after the campaign is over. Here they come back as proposed changes to the plan, with the numbers that justify them.",
    tryIt: {
      all: "Accept an optimization proposal: the plan gets a new version that cites the result, and it waits for approval like any other change.",
      "Harborstone Wealth":
        "Compare the sweep-rate email (above the email baseline) with the rate-decision push (below the push baseline), then accept a proposal.",
      "Coastline Kitchen":
        "The chowder push ran well above the push baseline and the soup email well below: see what the optimization agent proposes.",
      "Lumera Therapeutics":
        "The Neurelva push ran above the push baseline and the Glucora email below the email baseline: see what the optimization agent proposes.",
    },
    technical:
      "Results are indexed against a per-channel baseline. Attribution walks result → module → claim, and accepted proposals become plan revisions with lineage.",
  },
  agents: {
    label: "Agents",
    group: "hood",
    what: "Every agent in the system: what it does, what it may touch, and who decides after it.",
    why: "AI tools are often switched on with broad access and nobody can say what they are allowed to do. Here each agent has a written grant, a named person who decides after it, and an off switch.",
    tryIt: {
      all: "Pick an agent to see its grants and the person who decides after it. As Admin, switch one off and watch its runs get denied.",
      "Harborstone Wealth":
        "Pick the module-authoring agent to see that it can read claims but never approve anything.",
      "Coastline Kitchen":
        "Pick the optimization agent to see that it proposes plan changes and the brand lead decides.",
      "Lumera Therapeutics":
        "Pick the substantiation agent to see that it assembles evidence for MLR but cannot approve a claim.",
    },
    technical:
      "A registry of commercial, platform and partner agents, each with a lifecycle (introduce → retire), autonomy level and Cedar-style policy. Grants are enforced by the gateway, not the UI.",
  },
  catalogs: {
    label: "Prompts & models",
    group: "hood",
    what: "The instructions each agent works from, and which AI model handles each job.",
    why: "Prompts usually live in code nobody reviews. Here each one is versioned and locked, carries the hard rules it must keep, and a change without a new version fails the build.",
    tryIt: {
      all: "Open a prompt to see its hard rules and the evaluators that score it, then compare the champion and challenger models.",
      "Harborstone Wealth":
        "Open the module-authoring prompt: it must refuse any statement without a claim.",
      "Coastline Kitchen":
        "Open the content-plan prompt: it must state each wave with its rationale.",
      "Lumera Therapeutics":
        "Open the module-authoring prompt: the same cite-or-refuse rule is what keeps off-label claims out.",
    },
    technical:
      "A prompt catalog with typed variables and a lock file, and a model router with champion/challenger routing (ADR-009).",
  },
  evaluations: {
    label: "Evaluations",
    group: "hood",
    what: "The automatic checks that score every agent run, and how agents earn or lose autonomy.",
    why: "Most teams find out an AI tool has gone wrong when a person spots it. Here thirteen checks score every run, and an agent that starts to drift is constrained automatically.",
    tryIt: {
      all: "Look at each agent’s recent scores, then see which ones are trusted to act and which only suggest.",
      "Harborstone Wealth": "Look at the cite-or-refuse scores for the module-authoring agent.",
      "Coastline Kitchen": "Look at the brand-rules scores for the atomization agent.",
      "Lumera Therapeutics":
        "Look at the grounding and cite-or-refuse scores for the authoring agent.",
    },
    technical:
      "Thirteen evaluators, sampled scores per agent, drift detection with a constrain action, and staged autonomy.",
  },
  trust: {
    label: "Trust",
    group: "hood",
    what: "How each AI risk is controlled, and a record of every agent call — allowed or denied — and on whose behalf.",
    why: "When someone asks “what did the AI do, and who said it could?”, the answer is usually a guess. Here it is a log entry, with each step of the identity chain verified.",
    tryIt: {
      all: "Run any agent, then come back here to see the call, the policy that allowed it and who it acted for.",
      "Harborstone Wealth":
        "Run an agent as a role that is not allowed to, then find the denial here.",
      "Coastline Kitchen":
        "Check where Coastline’s data is kept and how long, under retention and residency.",
      "Lumera Therapeutics":
        "Run an agent on a Lumera module, then trace the call here from your role to the agent to the tool.",
    },
    technical:
      "A default-deny gateway (forbid beats permit), per-call signed agent tokens with an act claim, and an append-only decision log.",
  },
};

export const TAB_ORDER = Object.keys(TAB_GUIDES) as Tab[];

/** Where each lifecycle step is worked on. */
export const STAGE_TAB: Record<Stage, Tab> = {
  plan: "brief-builder",
  audience: "brief-builder",
  brief: "brief-builder",
  create: "module-library",
  substantiate: "approvals",
  approve: "approvals",
  deploy: "performance",
};

/** Where each role comes in, in their words. */
export const PERSONA_FLOW: Record<Persona, { line: string; start: Tab }> = {
  "brand-planner": {
    line: "You set the plan. An agent drafts it from the calendar and past results; you approve it, and every brief inherits it.",
    start: "brief-builder",
  },
  marketer: {
    line: "You turn the plan into audiences and briefs, and keep an eye on what is waiting on you.",
    start: "command-center",
  },
  "content-lab": {
    line: "You build the content. The authoring agent writes only from approved claims and tells you what it could not write.",
    start: "module-library",
  },
  compliance: {
    line: "You own the evidence. Packets are assembled for you; you decide whether each claim is substantiated.",
    start: "approvals",
  },
  reviewer: {
    line: "You review what is ready. Nothing reaches you until its claims are backed and its disclosures are present.",
    start: "approvals",
  },
  senior: {
    line: "You take the escalations: the final say on anything a reviewer sends up.",
    start: "approvals",
  },
  "brand-lead": {
    line: "You decide what changes next. Results come back as proposals, and accepting one revises the plan.",
    start: "performance",
  },
  admin: {
    line: "You run the agents: what each may touch, how it is scored, and when it is switched off.",
    start: "agents",
  },
};

/** The steps a role decides at. The senior reviewer decides escalated approvals. */
export const stagesFor = (persona: Persona): Stage[] =>
  (Object.entries(STAGE_OWNERS) as Array<[Stage, Persona]>)
    .filter(([, owner]) => owner === persona || (persona === "senior" && owner === "reviewer"))
    .map(([stage]) => stage);

export const BEFORE_AFTER: ReadonlyArray<{
  today: string;
  todayFor?: Partial<Record<Brand, string>>;
  here: string;
}> = [
  {
    today: "Approved claims live in spreadsheets and PDFs, and writers copy them by hand.",
    todayFor: {
      "Lumera Therapeutics":
        "Claims, trial references and MLR approvals sit in separate systems, and writers copy them by hand.",
    },
    here: "Each claim is one approved record. Content cites it, so when a claim changes, everything that uses it is flagged.",
  },
  {
    today: "Review runs over email, and nobody is sure what is waiting on whom.",
    todayFor: {
      "Lumera Therapeutics":
        "MLR review runs on PDFs and comment threads, and problems surface late.",
      "Harborstone Wealth":
        "Compliance review runs on email and shared drives, and problems surface late.",
    },
    here: "One queue shows what is waiting, on whom, and what blocks it — before a reviewer opens it.",
  },
  {
    today: "Content is rebuilt for every channel and campaign.",
    here: "Approved modules are found by meaning, reused, and split into channel versions that keep each claim whole.",
  },
  {
    today: "AI tools run with broad access and leave little record.",
    here: "Agents only propose; people decide. Every call is checked against policy and logged.",
  },
  {
    today: "Results land in a report after the campaign is over.",
    here: "Results come back as proposed plan changes that cite the numbers.",
  },
];

export const GLOSSARY: ReadonlyArray<[string, string]> = [
  ["Plan", "What the brand will send, when, to whom and on which channel, as waves."],
  [
    "Brief",
    "The request for content for one wave of a plan. It points at the plan rather than copying it.",
  ],
  ["Module", "A reusable, approved piece of content, such as an email body or a push message."],
  ["Variant", "A channel version of a module, made without changing what it claims."],
  [
    "Claim",
    "One approved factual statement, with the evidence behind it and when that evidence expires.",
  ],
  ["Gap", "A fact someone asked for that has no approved claim yet. It is recorded, not invented."],
  [
    "Agent",
    "Software that does a step of the work — drafting, checking, assembling — and hands it to a person.",
  ],
  [
    "Gateway",
    "The checkpoint every agent call goes through. It decides whether the call is allowed and logs it.",
  ],
];
