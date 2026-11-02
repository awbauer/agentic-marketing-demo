/**
 * The use-case library: each scenario the demo supports, the utterances that drive it, the
 * systems it touches, and how data flows between them. "Coming soon" entries are drafted
 * scenarios that aren't built; the page shows them greyed out with no prompts to run.
 */

export type Team = "Marketing" | "Sales" | "Service";
export type Industry = "Financial services" | "Life sciences";

export type SystemKind =
  | "Salesforce agent"
  | "Salesforce action"
  | "Knowledge graph"
  | "MCP server"
  | "External API"
  | "Workers AI"
  | "Workbench";

export type UseCaseSystem = { name: string; kind: SystemKind; role: string };

export type UseCasePrompt = { text: string; demonstrates: string };

export type FlowStep = { from: string; to: string; carries: string };

export type UseCase = {
  id: string;
  title: string;
  team: Team;
  /** Set for scenarios built on an industry brand, such as Harborstone Wealth or Lumera Therapeutics. */
  industry?: Industry;
  status: "available" | "coming-soon";
  /** One sentence for the card. */
  summary: string;
  /** The situation a person is in when they'd use this. */
  scenario: string;
  prompts: UseCasePrompt[];
  systems: UseCaseSystem[];
  flow: FlowStep[];
  /** What the knowledge graph contributes, when it's involved. */
  graphRole?: string;
  /** Records created, and how; "Nothing" for read-only scenarios. */
  writes: string;
  /** What to look at while it runs. */
  watch: string[];
  /** For a new external service: where it comes from. */
  newService?: { name: string; url: string; note: string };
};

const SF_CAMPAIGN_AGENT: UseCaseSystem = {
  name: "Northstar Campaign Creation",
  kind: "Salesforce agent",
  role: "Marketing Cloud Next Campaign Creation agent: drafts and saves the brief, previews, creates the campaign and flow",
};
const GRAPH: UseCaseSystem = {
  name: "Knowledge graph (Neo4j)",
  kind: "Knowledge graph",
  role: "Multi-hop answers with evidence paths",
};
const READINESS_AGENT: UseCaseSystem = {
  name: "Campaign Readiness and Governance",
  kind: "Salesforce agent",
  role: "Custom agent: campaign context, consent summary, content validation (Apex)",
};
const ORCHESTRATOR: UseCaseSystem = {
  name: "Northstar orchestrator (gpt-oss-20b)",
  kind: "Workers AI",
  role: "Routes the request, calls the tools in order, writes the answer",
};

const FED_NEWS: UseCaseSystem = {
  name: "Federal Reserve press releases",
  kind: "External API",
  role: "Latest FOMC rate decision and monetary policy releases (free, no key)",
};

const EMAIL_PROMPT =
  "Draft an email campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu";
const PUSH_PROMPT =
  "Draft a push notification campaign for Coastline Kitchen, our fast casual restaurant in California, tailored to the current weather, time of day, and our menu";

export const USE_CASES: UseCase[] = [
  // ------------------------------------------------------------------------------------------
  // Available
  {
    id: "weather-aware-campaign",
    title: "Weather-aware campaign in Marketing Cloud",
    team: "Marketing",
    status: "available",
    summary:
      "Turn today's weather, the menu, and past results into a Marketing Cloud Next brief, then a campaign with its flow.",
    scenario:
      "A Coastline Kitchen marketer wants a lunch campaign that fits today's weather in Los Angeles and what has worked before, built the way Marketing Cloud Next builds campaigns: brief first, then a campaign with a flow.",
    prompts: [
      {
        text: EMAIL_PROMPT,
        demonstrates: "Context tools, then the Campaign Creation agent drafts the brief",
      },
      {
        text: "Looks good, create it",
        demonstrates: "Confirmed save: the agent saves the brief and drafts the preview",
      },
      {
        text: "Make the second email shorter",
        demonstrates: "The agent's Refine Campaign Preview on the saved brief",
      },
      {
        text: PUSH_PROMPT,
        demonstrates: "The same plan for a push request (the brief records the channel)",
      },
    ],
    systems: [
      ORCHESTRATOR,
      {
        name: "Restaurant data",
        kind: "MCP server",
        role: "Menu, favorites, dayparts, brand voice (mocked)",
      },
      { name: "Open-Meteo", kind: "External API", role: "Current weather for the city" },
      GRAPH,
      SF_CAMPAIGN_AGENT,
    ],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The campaign request" },
      { from: "Restaurant data", to: "Orchestrator", carries: "Menu, favorites, dayparts" },
      { from: "Open-Meteo", to: "Orchestrator", carries: "Weather now in Los Angeles" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "What sold best in this weather and daypart",
      },
      {
        from: "Orchestrator",
        to: "Campaign Creation agent",
        carries: "A brief request with all of that context",
      },
      {
        from: "Campaign Creation agent",
        to: "Workspace",
        carries: "The brief (Draft a Campaign Brief)",
      },
      {
        from: "You",
        to: "Campaign Creation agent",
        carries: "Confirmed saves: Brief + preview, then Campaign + flow",
      },
      { from: "Salesforce", to: "Workspace", carries: "Read-back of Brief, steps, Campaign, flow" },
    ],
    graphRole:
      "Finds past push sends for the same location, daypart, and weather, and which menu items performed best.",
    writes:
      "A Brief with its preview steps, then a Campaign and its draft flow, each only after you confirm. Nothing is sent or activated.",
    watch: [
      "Salesforce agents panel: which agent and standard actions ran",
      "Workspace focus: brief, preview steps, then campaign and flow links",
      "Confirmation card: permission check and the agent that will do the work",
    ],
  },
  {
    id: "campaign-performance",
    title: "Campaign performance summary",
    team: "Marketing",
    status: "available",
    summary:
      "Summarize a Salesforce campaign and its recent performance from live Salesforce evidence.",
    scenario:
      "A marketing manager needs a quick read on how the fall loyalty campaign is doing before a stand-up.",
    prompts: [
      {
        text: "Summarize the sample campaign and its recent performance",
        demonstrates: "A Salesforce agent summary grounded in campaign records",
      },
    ],
    systems: [ORCHESTRATOR, READINESS_AGENT],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The question" },
      {
        from: "Orchestrator",
        to: "Readiness agent",
        carries: "Summarize campaign 701jV000004GglIQAS",
      },
      { from: "Readiness agent", to: "Workspace", carries: "Campaign facts and performance" },
    ],
    writes: "Nothing.",
    watch: [
      "Workspace: the campaign opens as a record",
      "Technical trace: the forced summary tool",
    ],
  },
  {
    id: "readiness-review",
    title: "Launch readiness and review request",
    team: "Marketing",
    status: "available",
    summary: "Check a campaign for launch blockers, then request a review as a Salesforce task.",
    scenario:
      "Before launch, a marketer checks what's blocking the campaign and asks a reviewer to sign off.",
    prompts: [
      {
        text: "Check the sample campaign readiness and explain every blocker",
        demonstrates: "Readiness checks across context, consent, and content",
      },
      { text: "Create a review task", demonstrates: "A confirmed Salesforce review task" },
    ],
    systems: [
      ORCHESTRATOR,
      READINESS_AGENT,
      {
        name: "NorthstarCreateCampaignReviewRequest",
        kind: "Salesforce action",
        role: "Creates the review Task after a signed confirmation",
      },
    ],
    flow: [
      { from: "Orchestrator", to: "Readiness agent", carries: "Check readiness" },
      { from: "Readiness agent", to: "Workspace", carries: "Blockers and checks" },
      { from: "Workbench", to: "You", carries: "Action card: request a review" },
      { from: "You", to: "Salesforce", carries: "Confirmed, signed review Task" },
    ],
    writes: "A Salesforce review Task, only after you confirm.",
    watch: [
      "The action card appears after the readiness check",
      "Confirmation card: permission check",
    ],
  },
  {
    id: "on-brand-copy",
    title: "On-brand campaign copy",
    team: "Marketing",
    status: "available",
    summary:
      "Draft copy with the Marketing Cloud Content Builder agent, then check it against brand rules.",
    scenario: "A copywriter needs subject lines and a hero section that fit the Northstar brand.",
    prompts: [
      {
        text: "Draft campaign content for the sample audience",
        demonstrates: "The Content Builder agent's Draft Content action",
      },
      {
        text: "Create a draft hero section for the email",
        demonstrates: "Create Section with Content",
      },
      { text: "Check this content against the Northstar brand", demonstrates: "Brand validation" },
    ],
    systems: [
      ORCHESTRATOR,
      {
        name: "Northstar Content Builder",
        kind: "Salesforce agent",
        role: "Marketing Cloud Next Content Builder agent",
      },
      READINESS_AGENT,
    ],
    flow: [
      { from: "Orchestrator", to: "Content Builder agent", carries: "Draft request" },
      { from: "Content Builder agent", to: "Workspace", carries: "Draft copy" },
      { from: "Orchestrator", to: "Readiness agent", carries: "Copy to validate" },
    ],
    writes: "Nothing: drafts stay in the workspace.",
    watch: ["Salesforce agents panel: Content Builder actions"],
  },
  {
    id: "buyer-group",
    title: "Buyer-group recommendation",
    team: "Sales",
    status: "available",
    summary: "Who should be in an account's buyer group, and the evidence for each person.",
    scenario: "An account executive is building the buying committee for Acme Outfitters.",
    prompts: [
      {
        text: "Who should be in the buyer group for Acme Outfitters, and why?",
        demonstrates: "Graph ranking with evidence paths",
      },
      {
        text: "Recommend buyer group members using the available sample signals",
        demonstrates: "The Salesforce account discovery agent",
      },
    ],
    systems: [
      ORCHESTRATOR,
      GRAPH,
      {
        name: "Northstar Account Discovery",
        kind: "Salesforce agent",
        role: "Account engagement and buyer-group signals",
      },
    ],
    flow: [
      { from: "Orchestrator", to: "Knowledge graph", carries: "Account name" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Ranked personas with engagement paths",
      },
    ],
    graphRole:
      "Ranks personas by role weight and engagement, with the content and campaigns behind each.",
    writes: "Nothing. Buyer groups are never changed from the chat.",
    watch: ["Graph evidence panel under the answer"],
  },
  {
    id: "sales-outreach",
    title: "Buyer-group outreach around local holidays",
    team: "Sales",
    status: "available",
    summary:
      "Plan who to contact at an account, on which consented channel, and when, avoiding the account's public holidays.",
    scenario:
      "A sales rep wants to run a four-week outreach sequence to Acme Outfitters' buyer group without landing on a holiday, and only on channels each person has agreed to.",
    prompts: [
      {
        text: "Plan outreach to Acme Outfitters' buyer group for the next month",
        demonstrates: "Graph contacts and consent, then live public holidays",
      },
      {
        text: "Plan outreach to the Harbor Point Sports buyer group over the next month",
        demonstrates: "A UK account: different holidays from the same plan",
      },
    ],
    systems: [
      ORCHESTRATOR,
      GRAPH,
      {
        name: "Nager.Date",
        kind: "External API",
        role: "Public holidays by country (free, no key)",
      },
    ],
    flow: [
      { from: "You", to: "Orchestrator", carries: "Account and time frame" },
      { from: "Orchestrator", to: "Knowledge graph", carries: "plan_account_outreach(account)" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Contacts, last engagement, consented channels, country",
      },
      { from: "Orchestrator", to: "Nager.Date", carries: "get_public_holidays(country)" },
      { from: "Nager.Date", to: "Orchestrator", carries: "Upcoming public holidays" },
      { from: "Orchestrator", to: "You", carries: "Prioritized, dated outreach plan" },
    ],
    graphRole:
      "The key element: walks Account ← Persona → consent → Channel and engagement, so each contact comes with who they are, why they rank, and exactly which channels are allowed.",
    writes: "Nothing: the plan stays in the chat.",
    watch: [
      "Graph evidence: WORKS_AT and HAS_CONSENT → FOR paths",
      "Workspace context: Public holidays · Nager.Date",
      "Contacts without consent are called out, not contacted",
    ],
    newService: {
      name: "Nager.Date",
      url: "https://date.nager.at",
      note: "Free, keyless public-holiday API, called live through the external-services MCP server.",
    },
  },
  {
    id: "service-weather",
    title: "Severe-weather customer impact",
    team: "Service",
    status: "available",
    summary:
      "When weather alerts hit a location, see which customers are affected, who can be notified, and what to pause.",
    scenario:
      "A service lead hears there are weather alerts near a Coastline Kitchen location and needs to know who's affected, what to tell customers, and which campaigns to hold.",
    prompts: [
      {
        text: "There are weather alerts near our San Diego location. Which customers are affected and what should we tell them?",
        demonstrates: "Live NWS alerts, then graph impact and a drafted notice",
      },
      {
        text: "Is there severe weather near our Sacramento location that affects customers?",
        demonstrates: "An honest answer when there are no alerts at that location",
      },
    ],
    systems: [
      ORCHESTRATOR,
      {
        name: "National Weather Service",
        kind: "External API",
        role: "Active watches, warnings, and advisories (free, no key)",
      },
      GRAPH,
    ],
    flow: [
      { from: "You", to: "Orchestrator", carries: "Location and concern" },
      {
        from: "Orchestrator",
        to: "National Weather Service",
        carries: "get_weather_alerts(location)",
      },
      {
        from: "National Weather Service",
        to: "Orchestrator",
        carries: "Active alerts, most severe first",
      },
      { from: "Orchestrator", to: "Knowledge graph", carries: "assess_location_impact(location)" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Affected app users, push-reachable count, campaigns targeting them",
      },
      {
        from: "Orchestrator",
        to: "You",
        carries: "Impact summary, customer notice, store-team note",
      },
    ],
    graphRole:
      "The key element: walks Location ← Segment → push consent and Campaign → TARGETS → Segment, to size the affected audience (aggregate only), how many can be reached, and which active campaigns to pause.",
    writes: "Nothing: the notice is a draft, and campaigns aren't paused from the chat.",
    watch: [
      "Workspace context: Weather alerts · National Weather Service",
      "Graph evidence: NEAR, HAS_CONSENT, and TARGETS paths",
      "Counts only; no individual customers are named",
    ],
    newService: {
      name: "National Weather Service API",
      url: "https://www.weather.gov/documentation/services-web-api",
      note: "Free, keyless public alerts API (api.weather.gov), called live through the external-services MCP server.",
    },
  },
  {
    id: "weather-inventory",
    title: "Weather-driven inventory check",
    team: "Service",
    status: "available",
    summary:
      "Check each restaurant's stock against the dishes the forecast will lift, and open a Salesforce case for the store manager when something is running low.",
    scenario:
      "Before a hot or rainy stretch, operations wants to know whether each Coastline Kitchen has enough of what the weather will sell, and to get a case to the store manager for anything that won't last.",
    prompts: [
      {
        text: "Check inventory for our Sacramento store against the forecast",
        demonstrates:
          "Live forecast, the graph's weather → dish → inventory map, stock counts, and a case action card",
      },
      {
        text: "Are any ingredients running low at our Fresno location for this week's weather?",
        demonstrates: "The same check for another restaurant and its manager",
      },
    ],
    systems: [
      ORCHESTRATOR,
      {
        name: "Open-Meteo forecast",
        kind: "External API",
        role: "Daily conditions, highs, and chance of rain (free, no key)",
      },
      GRAPH,
      {
        name: "Store inventory (randomized mock)",
        kind: "MCP server",
        role: "On-hand stock, par levels, and typical daily use per restaurant",
      },
      {
        name: "Create Inventory Case (Apex)",
        kind: "Salesforce action",
        role: "Opens one confirmed Case for the store manager's Contact and reads it back",
      },
    ],
    flow: [
      { from: "You", to: "Orchestrator", carries: "Location to check" },
      { from: "Orchestrator", to: "Open-Meteo", carries: "get_weather_forecast(location)" },
      {
        from: "Open-Meteo",
        to: "Orchestrator",
        carries: "Each day's weather and its demand-planning bucket (heat, rain, …)",
      },
      {
        from: "Orchestrator",
        to: "Knowledge graph",
        carries: "map_weather_demand(location, conditions)",
      },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Lifted dishes, what they're made with, and the store manager",
      },
      { from: "Orchestrator", to: "Store inventory", carries: "get_location_inventory(location)" },
      { from: "Store inventory", to: "Workbench", carries: "On-hand stock and typical daily use" },
      {
        from: "Workbench",
        to: "You",
        carries: "Low items (computed by code) and a case action card",
      },
      {
        from: "You",
        to: "Salesforce",
        carries: "Confirmed case → create_inventory_case → Case read back",
      },
    ],
    graphRole:
      "The key element: WeatherCondition → LIFTS_DEMAND → MenuItem → MADE_WITH → InventoryItem says which stock the forecast will draw down and by how much (lift learned from past push results), and Location → MANAGED_BY → StoreManager says who gets the case.",
    writes:
      "One Salesforce Case for the store manager, only after you confirm it. The case contents are hashed into the signed confirmation, and Apex checks them before creating the Case. Nothing is ordered.",
    watch: [
      "Workspace context: Forecast, Store inventory, and Inventory risk cards",
      "Graph evidence: LIFTS_DEMAND → MADE_WITH and MANAGED_BY paths",
      "The action card and confirmation list exactly the items the workbench found low",
      "Stock counts are a randomized mock that changes daily",
    ],
    newService: {
      name: "Open-Meteo forecast API",
      url: "https://open-meteo.com/en/docs",
      note: "Free, keyless daily forecast, called live through the campaign-context MCP server alongside a randomized store inventory mock.",
    },
  },
  {
    id: "fsi-market-news",
    title: "Market news to pre-approved content",
    team: "Marketing",
    industry: "Financial services",
    status: "available",
    summary:
      "When the Fed moves rates, find the compliance-approved content that's ready to send, who can get it, and what's blocked.",
    scenario:
      "The Fed just announced a rate decision. Harborstone Wealth prepared compliance-approved content for each outcome, and past responses sent within hours of the news opened far better than next-day ones. Marketing needs to know now what's approved to send, to whom, and what isn't, without writing a word of new regulated copy.",
    prompts: [
      {
        text: "The Fed just announced its rate decision. What pre-approved content can we send clients today?",
        demonstrates:
          "Live Federal Reserve news, then approved content, consent, and response speed from the graph",
      },
      {
        text: "What approved content do we have if the Fed cuts rates instead?",
        demonstrates: "Content approved ahead of time for a different outcome",
      },
      {
        text: "Markets are swinging hard today. What approved content can we send clients?",
        demonstrates: "A market event without a news call, including an expired FAQ that's blocked",
      },
      {
        text: "Create a Marketing Cloud campaign for the approved rate-move email",
        demonstrates:
          "The Campaign Creation agent drafts a brief built on the approved asset, its approval ID, and its disclosures",
      },
    ],
    systems: [ORCHESTRATOR, FED_NEWS, GRAPH, SF_CAMPAIGN_AGENT],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The news and the question" },
      { from: "Orchestrator", to: "Federal Reserve", carries: "get_fed_announcements()" },
      {
        from: "Federal Reserve",
        to: "Orchestrator",
        carries: "The latest FOMC decision and the market event it maps to",
      },
      {
        from: "Orchestrator",
        to: "Knowledge graph",
        carries: "match_news_to_approved_content(event)",
      },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Approved assets with approval IDs and disclosures, blocked assets and why, reach by consent, past response speed",
      },
      { from: "Orchestrator", to: "You", carries: "What to send now, to whom, and what's blocked" },
      {
        from: "You",
        to: "Campaign Creation agent",
        carries: "A confirmed brief and campaign built on the approved asset",
      },
    ],
    graphRole:
      "The key element: MarketEvent ← RESPONDS_TO ← ContentAsset → APPROVED_UNDER → Approval and → REQUIRES → Disclosure say which assets are approved, until when, and what they must carry; FAILED → BrandRule explains a failed compliance check; Campaign → TARGETS → Segment → HAS_CONSENT sizes reach per channel; and past sends show how response speed affected opens.",
    writes:
      "Nothing from the lookup. A Marketing Cloud brief and campaign only after you confirm; nothing is sent.",
    watch: [
      "Workspace context: Federal Reserve · live",
      "Graph evidence: RESPONDS_TO, APPROVED_UNDER, and REQUIRES paths",
      "Blocked assets and exactly why: expired, pending, or failed compliance",
      "Approved copy is used as approved; the model never writes new claims",
    ],
    newService: {
      name: "Federal Reserve press releases",
      url: "https://www.federalreserve.gov/feeds/feeds.htm",
      note: "Free, keyless public RSS feed; the latest FOMC statement is read for its rate decision, through the external-services MCP server.",
    },
  },
  {
    id: "fsi-deal-release",
    title: "Acquisition announcement, released on time",
    team: "Marketing",
    industry: "Financial services",
    status: "available",
    summary:
      "Line up the embargoed, pre-approved announcement package in release order, with who each piece can reach and what's still blocked.",
    scenario:
      "Harborstone Wealth announces its acquisition of Bayview Retirement Advisors tomorrow at 8:00 ET. Legal and compliance approved the package under embargo. The team needs the release order, the audience and consent basis for each piece, and anything that can't go out, before the announcement, not after.",
    prompts: [
      {
        text: "We announce the Bayview acquisition tomorrow at 8am. What approved content is ready to release, in what order, and who can we send it to?",
        demonstrates:
          "The graph's release package: sequence, approvals, disclosures, audiences, and consent basis",
      },
      {
        text: "Set up the Bayview announcement emails as a Marketing Cloud campaign",
        demonstrates:
          "The Campaign Creation agent drafts a brief for the approved, embargoed sends",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH, SF_CAMPAIGN_AGENT],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The announcement and its timing" },
      { from: "Orchestrator", to: "Knowledge graph", carries: "prepare_deal_release(deal)" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Each asset in order: timing, audience, consent basis, reach, approval, disclosures, blockers",
      },
      { from: "Orchestrator", to: "You", carries: "A numbered release plan and what's blocked" },
      {
        from: "You",
        to: "Campaign Creation agent",
        carries: "A confirmed brief and campaign for the ready sends",
      },
    ],
    graphRole:
      "The key element: ContentAsset → RELEASED_WITH → Deal orders the package; ADDRESSED_TO → Segment → HAS_CONSENT says whether each send relies on a service notice or marketing consent (Bayview's clients have service notices only); APPROVED_UNDER and REQUIRES carry the embargoed approvals and disclosures.",
    writes:
      "Nothing from the plan. A Marketing Cloud brief and campaign only after you confirm; nothing is released or sent early.",
    watch: [
      "Graph evidence: RELEASED_WITH, ADDRESSED_TO, and APPROVED_UNDER paths",
      "An SMS that failed compliance and has no consent is blocked, with both reasons",
      "Bayview's clients get service notices only, never marketing, until they opt in",
    ],
  },
  {
    id: "fsi-aum-plan",
    title: "Account plan to grow assets under management",
    team: "Sales",
    industry: "Financial services",
    status: "available",
    summary:
      "Turn a client's signals, holdings, and peers into ranked plays, then activate them with approved content on consented channels.",
    scenario:
      "An institutional consultant at Harborstone Wealth has 90 days to grow a foundation client's assets. Some of its money is still at another custodian, the board just raised its payout, and rates moved. They need a plan that says which products to lead with and why, who to talk to on which channel, and which approved content to use, then a campaign to run it.",
    prompts: [
      {
        text: "Build an account plan to grow AUM with Cedar Valley Community Foundation",
        demonstrates:
          "Signals, holdings, and peers become ranked plays with approved content and consented contacts",
      },
      {
        text: "What are the best plays to grow the Marin Family Office relationship?",
        demonstrates: "A family office: different signals, peers, and plays from the same graph",
      },
      {
        text: "Activate the plan: create a Marketing Cloud campaign for Cedar Valley's top play",
        demonstrates: "The Campaign Creation agent drafts a brief from the plan's approved content",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH, SF_CAMPAIGN_AGENT],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The client" },
      { from: "Orchestrator", to: "Knowledge graph", carries: "build_aum_account_plan(client)" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Holdings, held-away estimate, signals, plays with peer adoption, approved content, contacts and consent",
      },
      {
        from: "Orchestrator",
        to: "You",
        carries: "Ranked plays and a 30/60/90-day activation sequence",
      },
      {
        from: "You",
        to: "Campaign Creation agent",
        carries: "A confirmed brief and campaign that activate the plan",
      },
    ],
    graphRole:
      "The key element: Client → HAS_SIGNAL → Signal → SUGGESTS → Product finds the plays; other clients of the same type → HOLDS → Product gives peer adoption; Product ← EXPLAINS ← ContentAsset → APPROVED_UNDER → Approval says what can be sent; and Persona → WORKS_AT and HAS_CONSENT say who to contact and on which channel.",
    writes:
      "Nothing from the plan. A Marketing Cloud brief and campaign only after you confirm; nothing is sent.",
    watch: [
      "Graph evidence: HAS_SIGNAL → SUGGESTS, EXPLAINS → APPROVED_UNDER, and COVERED_BY paths",
      "A play whose only content is pending approval has no approved content to send",
      "A contact whose only consented channel has no approved content goes to the advisor",
      "Amounts are fictional estimates in $ millions",
    ],
  },
  {
    id: "pharma-hcp-targets",
    title: "Target hospitals and prescriber groups for a drug",
    team: "Sales",
    industry: "Life sciences",
    status: "available",
    summary:
      "Rank the hospitals and prescriber groups to reach first for a drug, by patients, formulary access, share and opted-in channels.",
    scenario:
      "Lumera Therapeutics is refreshing Cardivance for heart failure. Field and marketing leaders need to know where to spend the next quarter: which hospitals see the most patients with the labeled indication, where the drug is already preferred, where access has to come first, and which prescriber groups have agreed to be contacted on which channel.",
    prompts: [
      {
        text: "Which hospitals and prescriber groups should we target first for Cardivance?",
        demonstrates:
          "A ranked target list with formulary status, share, decile, consent, and the play for each",
      },
      {
        text: "Where should we focus for Glucora in type 2 diabetes?",
        demonstrates: "The same graph for a different drug, indication and set of specialties",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The drug" },
      { from: "Orchestrator", to: "Knowledge graph", carries: "build_hcp_target_list(drug)" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Groups with patients, formulary status, P&T timing, share, decile, opted-in channels, and the play",
      },
      { from: "Orchestrator", to: "You", carries: "A ranked list and the scoring behind it" },
    ],
    graphRole:
      "The key element: Drug → INDICATED_FOR → Indication ← TREATS ← Specialty ← SPECIALIZES_IN ← PrescriberGroup finds the right groups; → PRACTICES_AT → Hospital → SEES_PATIENTS_WITH and ON_FORMULARY give volume and access; PRESCRIBES gives share; HAS_CONSENT says which channels each group opted in to.",
    writes: "Nothing: read-only.",
    watch: [
      "Graph evidence: PRACTICES_AT and ON_FORMULARY paths",
      "A hospital where the drug is not on formulary leads with the value dossier, not detailing",
      "Groups are prescriber segments with counts, never named clinicians",
    ],
  },
  {
    id: "pharma-claims-check",
    title: "Check clinical claims before they are used",
    team: "Marketing",
    industry: "Life sciences",
    status: "available",
    summary:
      "For each claim about a drug: is a trial behind it, is the indication on the label, and is the content that carries it approved with its safety information?",
    scenario:
      "A brand team is about to brief an HCP email for Cardivance. Medical, legal and regulatory review will reject a claim that no trial supports, one that goes beyond the label, or content missing the boxed warning. The team wants to know before the brief, not at review.",
    prompts: [
      {
        text: "Check the clinical claims for Cardivance: which are supported, on label and approved?",
        demonstrates:
          "Each claim's trial, label basis and carrying content, with blockers and MLR approvals",
      },
      {
        text: "Can we use the Cardivance superiority claim, or is it off-label?",
        demonstrates: "An unsupported comparative claim is blocked, with the reason",
      },
      {
        text: "Which Glucora claims can go in an HCP email?",
        demonstrates:
          "An expired approval blocks a claim that is otherwise supported, on label content",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The drug (and optionally a channel)" },
      {
        from: "Orchestrator",
        to: "Knowledge graph",
        carries: "check_clinical_claims(drug, channel)",
      },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Claims with trials, label basis, carrying assets, approvals and safety information",
      },
      { from: "Orchestrator", to: "You", carries: "What is usable, what is blocked, and why" },
    ],
    graphRole:
      "The key element: ClinicalTrial → SUPPORTS → ClinicalClaim says what is evidenced; Drug → INDICATED_FOR (labeled) versus INVESTIGATED_FOR (not) says what is on label; ContentAsset → CARRIES → ClinicalClaim and APPROVED_UNDER → Approval, REQUIRES → Disclosure say what can go out and with what.",
    writes: "Nothing: it approves, rewrites and softens nothing.",
    watch: [
      "Graph evidence: SUPPORTS and CARRIES paths",
      "The HFpEF claim fails twice: not on the label, and its trial has no results",
      "An expired MLR approval blocks content even when the claim itself is supported",
    ],
  },
  {
    id: "pharma-hospital-access",
    title: "Plan engagement with a hospital's formulary",
    team: "Sales",
    industry: "Life sciences",
    status: "available",
    summary:
      "From a hospital's formulary status and P&T calendar to the dossier to send, the groups to reach, and the next steps in order.",
    scenario:
      "St. Brigid Medical Center's Pharmacy and Therapeutics committee reviews Cardivance in 21 days. The account team needs to know whether the approved value dossier can be sent, which prescriber groups to prepare and on which channels, and what to do first.",
    prompts: [
      {
        text: "Plan our engagement with St. Brigid Medical Center ahead of their P&T review",
        demonstrates:
          "Formulary status, dossier approval, prescriber groups, and ordered next steps",
      },
      {
        text: "How should we engage Mesa Verde Regional Hospital on formulary access?",
        demonstrates: "A dossier still pending MLR is a blocker, not something to send",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "You", to: "Orchestrator", carries: "The hospital" },
      {
        from: "Orchestrator",
        to: "Knowledge graph",
        carries: "plan_hospital_engagement(hospital)",
      },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries:
          "Formulary by drug, patients at stake, dossiers and their approvals, groups and consent",
      },
      { from: "Orchestrator", to: "You", carries: "Next steps in order, with what is blocked" },
    ],
    graphRole:
      "The key element: Hospital → ON_FORMULARY → Drug carries status and days to the review; ContentAsset (dossier) → EXPLAINS → Drug and APPROVED_UNDER → Approval say whether it can be sent; PrescriberGroup → PRACTICES_AT → Hospital with HAS_CONSENT and ENGAGED_WITH say who to reach and how.",
    writes: "Nothing: nothing is submitted or sent.",
    watch: [
      "Graph evidence: ON_FORMULARY and PRACTICES_AT paths",
      "The first next step is the drug with the most patients at stake and no access",
      "Prescriber groups are shown with opted-in channels, never as people",
    ],
  },
  {
    id: "consent-coverage",
    title: "Consent coverage audit",
    team: "Marketing",
    status: "available",
    summary:
      "How much of a campaign's audience can legally be reached on a channel, and who can't.",
    scenario:
      "Before an email send, compliance asks how much of the fall audience has commercial email consent.",
    prompts: [
      {
        text: "Is the fall campaign audience covered for commercial email consent?",
        demonstrates: "Graph consent coverage with examples",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "Orchestrator", to: "Knowledge graph", carries: "Campaign and channel" },
      { from: "Knowledge graph", to: "Orchestrator", carries: "Covered vs. uncovered, with paths" },
    ],
    graphRole: "Walks Campaign → Segment → Persona → consent → Channel.",
    writes: "Nothing.",
    watch: ["Graph evidence panel"],
  },
  {
    id: "audience-overlap",
    title: "Audience overlap and fatigue",
    team: "Marketing",
    status: "available",
    summary: "Which other campaigns hit the same people, before you add another send.",
    scenario: "A marketer worries the fall audience is already getting too many messages.",
    prompts: [
      {
        text: "Which members of the fall loyalty audience overlap with other active campaigns?",
        demonstrates: "Graph overlap across campaign audiences",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "Orchestrator", to: "Knowledge graph", carries: "Campaign" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Overlapping campaigns and shared members",
      },
    ],
    graphRole: "Finds personas shared between campaign segments.",
    writes: "Nothing.",
    watch: ["Graph evidence panel"],
  },
  {
    id: "content-lineage",
    title: "Content lineage and brand compliance",
    team: "Marketing",
    status: "available",
    summary:
      "Trace content back to its brief and see which brand rules each asset passed or failed.",
    scenario:
      "A brand manager wants to know what was built from the fall brief and whether it's compliant.",
    prompts: [
      {
        text: "What content was built from the fall brief, and what are its brand rule results?",
        demonstrates: "Graph lineage and rule results",
      },
    ],
    systems: [ORCHESTRATOR, GRAPH],
    flow: [
      { from: "Orchestrator", to: "Knowledge graph", carries: "Campaign" },
      {
        from: "Knowledge graph",
        to: "Orchestrator",
        carries: "Assets, brief, passed and failed rules",
      },
    ],
    graphRole:
      "Walks Campaign → ContentAsset → Brief and ContentAsset → PASSED/FAILED → BrandRule.",
    writes: "Nothing.",
    watch: ["Graph evidence panel"],
  },
  {
    id: "campaign-visual",
    title: "Campaign visual, attached in Salesforce",
    team: "Marketing",
    status: "available",
    summary:
      "Generate an on-brand image with Workers AI and attach the one you approve to the campaign.",
    scenario:
      "A marketer needs a hero image for the campaign and wants it stored with the campaign record.",
    prompts: [
      {
        text: "Summarize the sample campaign and its recent performance",
        demonstrates: "Opens the campaign; then use Generate campaign visual in the Workspace",
      },
    ],
    systems: [
      { name: "Workers AI (FLUX)", kind: "Workers AI", role: "Image generation" },
      {
        name: "NorthstarAttachCampaignImage",
        kind: "Salesforce action",
        role: "Attaches the confirmed image after a hash check",
      },
    ],
    flow: [
      { from: "Workspace", to: "Workers AI", carries: "A governed image prompt" },
      { from: "Workers AI", to: "Workspace", carries: "Draft images (private)" },
      { from: "You", to: "Salesforce", carries: "Confirmed attachment, hash-verified" },
    ],
    writes: "A file on the Salesforce Campaign, only after you confirm.",
    watch: ["Workspace: Generate campaign visual (expand it)"],
  },
  {
    id: "memory-recall",
    title: "Remember and recall decisions",
    team: "Marketing",
    status: "available",
    summary: "Remember a draft, then recall it in a new chat, dated and sourced.",
    scenario:
      "A marketer comes back days later and asks what was decided about the rainy-day push.",
    prompts: [
      {
        text: "Remember this draft",
        demonstrates: "The server stores the focus in long-term memory",
      },
      {
        text: "What did we decide about the Coastline rainy-day push?",
        demonstrates: "Recall in a new chat, with provenance",
      },
    ],
    systems: [
      ORCHESTRATOR,
      {
        name: "Long-term memory (Neo4j)",
        kind: "Knowledge graph",
        role: "Drafts and decisions, 14 days",
      },
    ],
    flow: [
      { from: "Workspace", to: "Memory", carries: "The draft, on your request" },
      { from: "Orchestrator", to: "Memory", carries: "recall_decisions(subject)" },
      { from: "Memory", to: "You", carries: "Dated, sourced items; re-check Salesforce" },
    ],
    graphRole: "Links remembered drafts and decisions to the campaigns and brands they're about.",
    writes: "A memory in the graph (forget it from History → Memory).",
    watch: ["History → Memory"],
  },

  // ------------------------------------------------------------------------------------------
  // Coming soon: drafted, not built.
  ...(
    [
      {
        id: "localize-campaign",
        title: "Localize a campaign for a new market",
        team: "Marketing",
        summary: "Translate a saved brief and its preview for a new language, keeping brand rules.",
        systems: ["DeepL API", "Knowledge graph (brand rules)", "Campaign Creation agent"],
        graphRole: "Brand rules and past localized content per market.",
      },
      {
        id: "subject-line-test",
        title: "Subject-line A/B test plan",
        team: "Marketing",
        summary:
          "Propose subject-line variants from past winners and set up a split in the campaign flow.",
        systems: [
          "Knowledge graph (past performance)",
          "Campaign Creation agent",
          "Marketing Cloud flow",
        ],
        graphRole: "Which angles and items won before, by audience.",
      },
      {
        id: "loyalty-upgrade",
        title: "Loyalty tier upgrade campaign",
        team: "Marketing",
        summary: "Target members close to the next tier with a personalized nudge.",
        systems: ["Loyalty Management", "Data 360 segments", "Campaign Creation agent"],
        graphRole: "Member segments and their consent by channel.",
      },
      {
        id: "paid-media-pacing",
        title: "Paid media budget pacing",
        team: "Marketing",
        summary: "Compare spend against plan and suggest reallocations across channels.",
        systems: ["Google Ads API", "Meta Marketing API", "Knowledge graph (campaign ↔ channel)"],
        graphRole: "Which campaigns run on which paid channels.",
      },
      {
        id: "social-listening",
        title: "Social listening to campaign idea",
        team: "Marketing",
        summary: "Turn trending public posts about the brand into a campaign brief.",
        systems: ["Bluesky public API", "Knowledge graph (products)", "Campaign Creation agent"],
        graphRole: "Maps mentioned products to menu items and campaigns.",
      },
      {
        id: "renewal-risk",
        title: "Renewal risk radar",
        team: "Sales",
        summary: "Flag accounts whose buyer-group engagement is fading before renewal.",
        systems: [
          "Knowledge graph (engagement decay)",
          "Salesforce Opportunities",
          "Account Discovery agent",
        ],
        graphRole: "Engagement recency across each account's buying roles.",
      },
      {
        id: "territory-routing",
        title: "Territory-aware lead routing",
        team: "Sales",
        summary: "Geocode new leads and route them to the right territory owner.",
        systems: ["US Census Geocoder", "Salesforce Leads", "Knowledge graph (territories)"],
        graphRole: "Territory ↔ owner ↔ account relationships.",
      },
      {
        id: "local-currency-quote",
        title: "Local-currency quote prep",
        team: "Sales",
        summary: "Prepare pricing in the account's currency at today's exchange rate.",
        systems: ["Frankfurter FX API", "Knowledge graph (account country)", "Salesforce Quotes"],
        graphRole: "The account's country and buying roles.",
      },
      {
        id: "event-follow-up",
        title: "Conference follow-up",
        team: "Sales",
        summary: "Follow up with event attendees who belong to open buyer groups.",
        systems: ["Event platform API", "Knowledge graph (buyer groups)", "Salesforce Tasks"],
        graphRole: "Which attendees sit in which accounts' buyer groups.",
      },
      {
        id: "order-delay-notice",
        title: "Proactive order-delay notice",
        team: "Service",
        summary: "Spot delayed shipments and notify affected customers before they ask.",
        systems: [
          "Carrier tracking API (test mode)",
          "Service Cloud Cases",
          "Knowledge graph (orders ↔ customers)",
        ],
        graphRole: "Orders to customers to consent and channel.",
      },
      {
        id: "case-deflection",
        title: "Knowledge-based case deflection",
        team: "Service",
        summary: "Answer common questions from knowledge articles before a case is opened.",
        systems: ["Salesforce Knowledge", "Agentforce Service Agent", "Knowledge graph (topics)"],
        graphRole: "Links topics to articles and products.",
      },
      {
        id: "service-recovery",
        title: "Service recovery offers after an incident",
        team: "Service",
        summary: "After an outage, offer loyalty credit to affected customers who can be reached.",
        systems: ["Status page API", "Loyalty Management", "Knowledge graph (impact + consent)"],
        graphRole: "Who was affected, their tier, and allowed channels.",
      },
      {
        id: "store-closure",
        title: "Planned store closure communications",
        team: "Service",
        summary:
          "Tell nearby app users about a planned closure and point them to the next-closest location.",
        systems: ["Knowledge graph (locations ↔ segments)", "Campaign Creation agent", "Maps API"],
        graphRole: "Segments near each location and the next-nearest store.",
      },
    ] as const
  ).map(
    (draft): UseCase => ({
      id: draft.id,
      title: draft.title,
      team: draft.team,
      status: "coming-soon",
      summary: draft.summary,
      scenario: draft.summary,
      prompts: [],
      systems: draft.systems.map((name) => ({
        name,
        kind: /graph/i.test(name)
          ? "Knowledge graph"
          : /agent/i.test(name)
            ? "Salesforce agent"
            : /api|platform|geocoder|deepl|bluesky|tracking|maps|status/i.test(name)
              ? "External API"
              : "Salesforce action",
        role: "Planned",
      })),
      flow: [],
      graphRole: draft.graphRole,
      writes: "Not built yet.",
      watch: [],
    }),
  ),
];

export const TEAMS: Team[] = ["Marketing", "Sales", "Service"];
