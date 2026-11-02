/**
 * The Learn reference: one plain-language entry for every tool, write action, graph node and
 * relationship type, operator control, and Salesforce component the code defines. `pnpm
 * learn:check` extracts that inventory from the code and fails when an entry is missing or
 * stale, so a new concept can't ship without being taught. Each entry names the Learn section
 * that explains it in depth.
 */

export const REFERENCE_KINDS = [
  "Tool",
  "Write action",
  "Graph node",
  "Graph relationship",
  "Operator control",
  "Salesforce component",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export type ReferenceEntry = {
  kind: ReferenceKind;
  /** The exact identifier in code, such as a tool name or a relationship type. */
  name: string;
  summary: string;
  /** The Learn section that explains it. */
  section: string;
};

const tool = (name: string, section: string, summary: string): ReferenceEntry => ({
  kind: "Tool",
  name,
  section,
  summary,
});
const node = (name: string, summary: string, section = "graphrag-here"): ReferenceEntry => ({
  kind: "Graph node",
  name,
  section,
  summary,
});
const edge = (name: string, summary: string, section = "graphrag-here"): ReferenceEntry => ({
  kind: "Graph relationship",
  name,
  section,
  summary,
});

export const LEARN_REFERENCE: ReferenceEntry[] = [
  // Salesforce Hosted MCP tools.
  tool(
    "summarize_campaign",
    "salesforce",
    "Agent-backed summary of a campaign's status, dates, and performance from Salesforce.",
  ),
  tool(
    "generate_campaign_insights",
    "salesforce",
    "Agent-backed insights on a campaign's engagement and opportunities.",
  ),
  tool(
    "check_campaign_readiness",
    "salesforce",
    "Checks a campaign for launch blockers, such as missing dates, consent, or accessibility copy.",
  ),
  tool(
    "draft_campaign_brief",
    "marketing-cloud",
    "The Campaign Creation agent's Draft a Campaign Brief action; the brief becomes the workspace focus.",
  ),
  tool(
    "refine_campaign_preview",
    "marketing-cloud",
    "The Campaign Creation agent's Refine Campaign Preview action, on a brief saved in Marketing Cloud.",
  ),
  tool(
    "draft_campaign_content",
    "salesforce",
    "The Content Builder agent's Draft Content action: copy for an email, push, or SMS.",
  ),
  tool(
    "create_content_section",
    "salesforce",
    "The Content Builder agent's Create Section with Content action: a hero, header, or footer.",
  ),
  tool(
    "validate_content_against_brand",
    "salesforce",
    "Checks copy against Northstar brand rules and reports what passed or failed.",
  ),
  tool(
    "get_account_marketing_signals",
    "salesforce",
    "Account-level marketing signals from Salesforce.",
  ),
  tool(
    "recommend_buyer_group_members",
    "salesforce",
    "Suggests buyer-group members for an account from Salesforce signals.",
  ),
  tool(
    "summarize_account_engagement",
    "salesforce",
    "Summarizes how an account has engaged with recent campaigns.",
  ),
  tool(
    "check_write_access",
    "governance",
    "Read-only Apex check, run as the signed-in user, of every permission a write needs.",
  ),
  tool(
    "save_marketing_brief",
    "marketing-cloud",
    "Confirmed write: the Campaign Creation agent saves the brief (Save Campaign Brief) and drafts its preview.",
  ),
  tool(
    "create_marketing_campaign",
    "marketing-cloud",
    "Confirmed write: the Campaign Creation agent creates the campaign and its flow (Create Campaign, Save Campaign).",
  ),
  tool(
    "get_marketing_records",
    "marketing-cloud",
    "Read-back of a Brief, its preview steps, and the Campaign and flow created from it.",
  ),
  tool(
    "create_campaign_review_request",
    "governance",
    "Confirmed write: creates a Salesforce review task with context and a checklist.",
  ),
  tool(
    "create_inventory_case",
    "use-cases",
    "Confirmed write: opens a Salesforce Case for a store manager listing items that won't cover the forecast.",
  ),
  tool(
    "attach_campaign_image",
    "images",
    "Confirmed write: attaches a generated image to a campaign after Salesforce verifies its hash.",
  ),
  // Campaign-context MCP tools.
  tool(
    "get_restaurant_profile",
    "campaign-context",
    "Coastline Kitchen's locations, menu, favorites, dayparts, and brand voice from the restaurant system.",
  ),
  tool(
    "get_current_weather",
    "campaign-context",
    "Live weather from Open-Meteo for a California city.",
  ),
  tool(
    "get_weather_forecast",
    "use-cases",
    "The daily Open-Meteo forecast for a city, with each day's demand-planning weather.",
  ),
  tool(
    "get_location_inventory",
    "use-cases",
    "Stock counts for a Coastline Kitchen restaurant from a randomized store inventory mock.",
  ),
  // External-services MCP tools.
  tool(
    "get_public_holidays",
    "use-cases",
    "Upcoming public holidays for a country from Nager.Date, a free public API.",
  ),
  tool(
    "get_weather_alerts",
    "use-cases",
    "Active National Weather Service alerts at a Coastline Kitchen location, most severe first.",
  ),
  tool(
    "get_fed_announcements",
    "use-cases",
    "The latest FOMC rate decision from the Federal Reserve's public press feed, and the market event it maps to.",
  ),
  // Knowledge-graph MCP tools.
  tool(
    "get_graph_overview",
    "graphrag-here",
    "Counts of nodes and relationships in the knowledge graph, and its dataset version.",
  ),
  tool(
    "explain_buyer_group",
    "graphrag-here",
    "Ranks an account's people for a buyer group, with the engagement paths behind each.",
  ),
  tool(
    "find_audience_overlap",
    "graphrag-here",
    "Finds other campaigns whose audiences share people with a campaign's audience.",
  ),
  tool(
    "check_consent_coverage",
    "graphrag-here",
    "How much of a campaign's audience holds consent for a channel, with uncovered examples.",
  ),
  tool(
    "find_similar_past_pushes",
    "graphrag-here",
    "Past Coastline sends on the campaign's channel (emails or pushes) for a location, daypart, and weather, which menu items and content performed best, and the audience's opt-ins for that channel.",
  ),
  tool(
    "plan_account_outreach",
    "use-cases",
    "An account's contacts in priority order, their consented channels, and the account's country.",
  ),
  tool(
    "map_weather_demand",
    "use-cases",
    "The dishes forecast weather lifts, what they're made with, and the location's store manager.",
  ),
  tool(
    "assess_location_impact",
    "use-cases",
    "The app audience near a location, how many can be reached on each channel, and campaigns to pause.",
  ),
  tool(
    "match_news_to_approved_content",
    "use-cases",
    "Harborstone's pre-approved content for a market event: what's ready to send, what's blocked and why, reach by consent, and past response speed.",
  ),
  tool(
    "prepare_deal_release",
    "use-cases",
    "The embargoed acquisition package in release order, with each piece's audience, consent basis, approval, and blockers.",
  ),
  tool(
    "build_aum_account_plan",
    "use-cases",
    "A Harborstone client's signals, ranked plays with peer adoption and approved content, and contacts with consented channels.",
  ),
  tool(
    "build_hcp_target_list",
    "use-cases",
    "Lumera's hospitals and prescriber groups ranked for a drug by patients, formulary access, share, decile and opted-in channels, with the first move at each.",
  ),
  tool(
    "check_clinical_claims",
    "use-cases",
    "Each clinical claim for a drug: the trial behind it, whether its indication is on the label, and the MLR-approved content that carries it, with blockers.",
  ),
  tool(
    "plan_hospital_engagement",
    "use-cases",
    "A hospital's formulary status and P&T timing for each Lumera drug, the value dossier to send (usable or blocked), its prescriber groups and consent, and ordered next steps.",
  ),
  tool(
    "trace_content_lineage",
    "graphrag-here",
    "Traces a campaign's content back to its brief and brand-rule results.",
  ),
  tool(
    "recall_decisions",
    "long-term-memory",
    "Recalls remembered drafts and decisions about a subject in this workspace, dated and sourced.",
  ),
  tool(
    "recall_recent_work",
    "long-term-memory",
    "Lists this workspace's most recent remembered drafts and decisions.",
  ),
  tool(
    "explain_memory",
    "long-term-memory",
    "Shows where one memory came from: its record, the draft versions it replaced, and its subjects.",
  ),

  // Confirmation actions.
  ...(
    [
      [
        "save-marketing-brief",
        "Have the Campaign Creation agent save the focus as a Marketing Cloud brief.",
      ],
      [
        "create-marketing-campaign",
        "Have the Campaign Creation agent create the campaign and its flow from the saved brief.",
      ],
      ["create-review-task", "Create a Salesforce review task for the open campaign."],
      ["attach-generated-image", "Attach an approved generated image to the open campaign."],
      [
        "create-inventory-case",
        "Open a Salesforce case for a store manager from an inventory check's low items.",
      ],
    ] as const
  ).map(
    ([name, summary]): ReferenceEntry => ({
      kind: "Write action",
      name,
      summary: `${summary} Needs a permission check and your confirmation.`,
      section: name.includes("marketing")
        ? "marketing-cloud"
        : name === "create-inventory-case"
          ? "use-cases"
          : "governance",
    }),
  ),

  // Graph nodes: the demo dataset.
  node(
    "Brand",
    "Northstar and its brands: Coastline Kitchen (restaurants) and Harborstone Wealth (wealth management).",
  ),
  node("Channel", "Email, SMS, and the mobile app."),
  node("ConsentScope", "A consent a person or segment holds for a channel."),
  node("BrandRule", "A brand rule that content passes or fails."),
  node("Campaign", "A marketing campaign, for Northstar or Coastline Kitchen."),
  node("Brief", "The brief a campaign's content is built from."),
  node("ContentAsset", "An email, push, or other piece of campaign content."),
  node("Segment", "An audience a campaign targets."),
  node("Account", "A fictional B2B customer account."),
  node("Persona", "A buying role at an account; roles, not real people."),
  node(
    "Daypart",
    "A time of day: breakfast, lunch, afternoon, dinner, and so on.",
    "campaign-context",
  ),
  node(
    "WeatherCondition",
    "A weather bucket: clear, cloudy, fog, rain, or heat.",
    "campaign-context",
  ),
  node("Menu", "Coastline Kitchen's menu.", "campaign-context"),
  node("MenuItem", "A dish on the menu, with its order rate.", "campaign-context"),
  node("Location", "A Coastline Kitchen restaurant in California.", "campaign-context"),
  node("InventoryItem", "Stock a restaurant keeps, counted in kitchen units.", "use-cases"),
  node("StoreManager", "A restaurant's store manager, by name only.", "use-cases"),
  node("PushSend", "One past push notification send and how it performed."),
  node("EmailSend", "One past Coastline email send: its opens, clicks, and orders."),
  node(
    "Approval",
    "A compliance approval record: approved, expired, or pending, with its dates and any embargo.",
    "use-cases",
  ),
  node("Disclosure", "Required disclosure text a regulated asset must carry.", "use-cases"),
  node("MarketEvent", "A market event Harborstone prepares approved content for.", "use-cases"),
  node(
    "ClientSend",
    "A past Harborstone response: hours after the news, opens, clicks.",
    "use-cases",
  ),
  node("Deal", "Harborstone's embargoed acquisition.", "use-cases"),
  node("Firm", "The firm being acquired.", "use-cases"),
  node("Client", "A Harborstone client: a foundation, business, or family office.", "use-cases"),
  node("Advisor", "The Harborstone advisor who covers a client.", "use-cases"),
  node("Product", "A Harborstone product or service a client can hold.", "use-cases"),
  node("Signal", "Something the relationship team noticed about a client.", "use-cases"),
  node(
    "Drug",
    "A Lumera Therapeutics drug, with its class and whether it carries a boxed warning.",
    "use-cases",
  ),
  node("Indication", "A condition a drug is labeled for, or only investigated in.", "use-cases"),
  node("ClinicalTrial", "A trial with its phase, size, status, endpoint and result.", "use-cases"),
  node(
    "ClinicalClaim",
    "A claim about a drug's effect or safety that promotional content may carry.",
    "use-cases",
  ),
  node(
    "Hospital",
    "A fictional hospital or health system, with its formulary and patient volumes.",
    "use-cases",
  ),
  node(
    "Specialty",
    "A prescriber specialty, such as cardiology, and the conditions it treats.",
    "use-cases",
  ),
  node(
    "PrescriberGroup",
    "A segment of prescribers at one hospital in one specialty; a count and a decile, never a person.",
    "use-cases",
  ),
  // Graph nodes: long-term memory.
  node("Workspace", "The workspace that owns a memory.", "long-term-memory"),
  node(
    "MemoryEvent",
    "The server event that created a memory, with a hashed actor.",
    "long-term-memory",
  ),
  node("Draft", "One remembered version of a focus draft.", "long-term-memory"),
  node("Decision", "A confirmed save, review, or image attachment.", "long-term-memory"),
  node("RecordRef", "The Salesforce record a decision was recorded in.", "long-term-memory"),

  // Graph relationships: the demo dataset.
  edge("PART_OF", "A sub-brand under its parent brand, or a push send within its campaign."),
  edge(
    "FOR",
    "A consent scope for its channel, a brief for its campaign, or a push for a location.",
  ),
  edge("RULE_OF", "A brand rule belonging to its brand."),
  edge("BELONGS_TO", "A campaign belonging to its brand."),
  edge("ON", "A campaign or push send on its channel."),
  edge("USES", "A campaign using a content asset."),
  edge("BUILT_FROM", "Content built from its brief."),
  edge("PASSED", "Content that passed a brand rule."),
  edge("FAILED", "Content that failed a brand rule."),
  edge("TARGETS", "A campaign targeting a segment."),
  edge("WORKS_AT", "A persona at its account."),
  edge("ENGAGED_WITH", "A persona that engaged with a content asset."),
  edge("INCLUDES", "A segment including a persona."),
  edge(
    "HAS_CONSENT",
    "A persona or segment holding a consent scope; segments carry opt-in counts per channel.",
  ),
  edge("MENU_OF", "A menu belonging to its brand.", "campaign-context"),
  edge("ON_MENU", "A menu item on the menu.", "campaign-context"),
  edge("AVAILABLE_DURING", "A menu item offered during a daypart.", "campaign-context"),
  edge("FAVORITE", "A brand's favorite menu item.", "campaign-context"),
  edge("OPERATES", "A brand operating a location.", "campaign-context"),
  edge("SERVES", "A location serving a menu.", "campaign-context"),
  edge("NEAR", "An app segment near a location."),
  edge("MADE_WITH", "A menu item made with an inventory item, per serving.", "use-cases"),
  edge(
    "LIFTS_DEMAND",
    "Weather that raises a menu item's orders, learned from past pushes.",
    "use-cases",
  ),
  edge("MANAGED_BY", "A location managed by its store manager.", "use-cases"),
  edge("APPROVED_UNDER", "Regulated content and the approval it was released under.", "use-cases"),
  edge("REQUIRES", "Regulated content and a disclosure it must carry.", "use-cases"),
  edge("APPROVED_FOR", "Regulated content and the channel it's approved for.", "use-cases"),
  edge("RESPONDS_TO", "Content or a past response prepared for a market event.", "use-cases"),
  edge("EXPLAINS", "Content explaining a product.", "use-cases"),
  edge("RELEASED_WITH", "An announcement asset, its release step, and timing.", "use-cases"),
  edge("ADDRESSED_TO", "An announcement asset and the audience it goes to.", "use-cases"),
  edge("ANNOUNCED_BY", "A deal announced by its brand.", "use-cases"),
  edge("ANNOUNCES", "A campaign announcing a deal.", "use-cases"),
  edge("ACQUIRES", "A deal and the firm it acquires.", "use-cases"),
  edge("CLIENT_OF", "A client of a brand, or a segment of a firm's clients.", "use-cases"),
  edge("COVERED_BY", "A client and the advisor who covers it.", "use-cases"),
  edge("HOLDS", "A client holding a product, with its assets in $ millions.", "use-cases"),
  edge("HAS_SIGNAL", "A client showing a signal, and when it was detected.", "use-cases"),
  edge("SUGGESTS", "A signal pointing to a product, with the share it might capture.", "use-cases"),
  edge("OFFERS", "A brand offering a product.", "use-cases"),
  edge("ADVISES_FOR", "An advisor at a brand.", "use-cases"),
  edge("INDICATED_FOR", "A drug and a condition it is labeled for.", "use-cases"),
  edge(
    "INVESTIGATED_FOR",
    "A drug and a condition it is only being studied in, so not on the label.",
    "use-cases",
  ),
  edge("STUDIED_IN", "A drug and a trial that studied it.", "use-cases"),
  edge("SUPPORTS", "A trial and a clinical claim its results support.", "use-cases"),
  edge("CLAIMS_ABOUT", "A clinical claim and the drug it is about.", "use-cases"),
  edge("CARRIES", "A content asset and a clinical claim it makes.", "use-cases"),
  edge("TREATS", "A specialty and a condition it treats.", "use-cases"),
  edge("SPECIALIZES_IN", "A prescriber group and its specialty.", "use-cases"),
  edge("PRACTICES_AT", "A prescriber group and the hospital it practices at.", "use-cases"),
  edge(
    "ON_FORMULARY",
    "A hospital and a drug, with its formulary status and days to the next P&T review.",
    "use-cases",
  ),
  edge(
    "SEES_PATIENTS_WITH",
    "A hospital and a condition, with its annual patient count.",
    "use-cases",
  ),
  edge(
    "PRESCRIBES",
    "A prescriber group and a drug, with Lumera's share of the class.",
    "use-cases",
  ),
  edge("USED", "A push send that used a content asset."),
  edge("SENT_TO", "A push send delivered to a segment."),
  edge("SENT_UNDER", "A push send made under a consent scope."),
  edge("FEATURED", "A push send featuring a menu item."),
  edge("SENT_DURING", "A push send made during a daypart."),
  edge("UNDER", "A push send made under a weather condition."),
  // Graph relationships: long-term memory.
  edge("IN_WORKSPACE", "A memory event in its workspace.", "long-term-memory"),
  edge("CREATED", "The memory event that created a draft or decision.", "long-term-memory"),
  edge("SUPERSEDES", "A draft version replacing the one before it.", "long-term-memory"),
  edge("ABOUT", "A memory about a campaign or brand in the demo graph.", "long-term-memory"),
  edge("DECIDED_ON", "A decision about the draft version it saved.", "long-term-memory"),
  edge("RECORDED_IN", "A decision recorded in a Salesforce record.", "long-term-memory"),

  // Operator controls.
  {
    kind: "Operator control",
    name: "WRITES_ENABLED",
    summary: "Set to false to pause every Salesforce write without a deploy.",
    section: "governance",
  },
  {
    kind: "Operator control",
    name: "DISABLED_TOOLS",
    summary: "A comma-separated list of tools to withhold from the model or block as writes.",
    section: "governance",
  },
  {
    kind: "Operator control",
    name: "DISABLED_AGENTS",
    summary:
      "A comma-separated list of registry agents to switch off; the gateway denies every call they make.",
    section: "gateway",
  },
  {
    kind: "Operator control",
    name: "MEMORY_ENABLED",
    summary: "Set to false to stop remembering and withhold the recall tools.",
    section: "long-term-memory",
  },

  // Salesforce components.
  ...(
    [
      ["NorthstarCheckWriteAccess", "Apex: the read-only permission check run as the user."],
      ["NorthstarConfirmationVerifier", "Apex: verifies the signed confirmation before any write."],
      [
        "NorthstarGetMarketingRecords",
        "Apex: reads back the Brief, preview steps, Campaign, and flow the agent created.",
      ],
      [
        "NorthstarCreateCampaignReviewRequest",
        "Apex action behind create_campaign_review_request.",
      ],
      [
        "NorthstarCreateInventoryCase",
        "Apex action behind create_inventory_case; checks the contents' hash.",
      ],
      [
        "NorthstarAttachCampaignImage",
        "Apex action behind attach_campaign_image; checks the hash.",
      ],
      [
        "NorthstarGetCampaignContext",
        "Apex action: bounded campaign context for the readiness check.",
      ],
      [
        "NorthstarGetConsentSummary",
        "Apex action: aggregate consent evidence, no customer fields.",
      ],
      [
        "NorthstarValidateCampaignContent",
        "Apex action: readiness checks on campaign fields, including instruction-like text.",
      ],
      [
        "Northstar_Confirmation_Config__c",
        "Custom setting holding the key Apex uses to verify signed confirmations.",
      ],
    ] as const
  ).map(
    ([name, summary]): ReferenceEntry => ({
      kind: "Salesforce component",
      name,
      summary,
      section:
        name === "NorthstarGetMarketingRecords"
          ? "marketing-cloud"
          : name.startsWith("Northstar_") || /Verifier|CheckWrite/.test(name)
            ? "governance"
            : "salesforce",
    }),
  ),
];
