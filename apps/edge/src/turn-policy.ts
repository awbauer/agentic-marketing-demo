import { scopePrompt, type WorkbenchScope } from "../../../packages/architecture/src/scope.ts";
import type { Brand } from "../../../packages/architecture/src/types.ts";
import type { FocusKind } from "../../../packages/contracts/src/index.ts";

/**
 * Turn routing and model settings shared by the orchestrator and the live evaluation runner.
 * Keep this module free of Workers runtime imports so the evaluation runs exactly this logic.
 */

// Room for the longest tool plan (four tools) plus the written answer.
export const MAX_TURN_STEPS = 6;
// Salesforce agent calls can take tens of seconds, so the budget covers model steps plus tool time.
export const TURN_TIMEOUT = { totalMs: 150_000, chunkMs: 60_000, toolMs: 120_000 } as const;
// Workers AI defaults to 256 output tokens, which gpt-oss reasoning can exhaust before any text.
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * The system prompt. `workspace` describes the chat's working set (records opened or created
 * and context gathered) and, separately, the catalog of records the chat has not opened.
 */
export function orchestratorSystemPrompt(
  workspace: string,
  toolPlan?: readonly string[],
  scope?: WorkbenchScope,
) {
  // Scenario guidance is added only when its plan is active, so it cannot steer other requests.
  const restaurantPlan = toolPlan?.some((name) => name.endsWith("get_restaurant_profile"));
  const briefPlan = toolPlan?.some((name) => name.endsWith("draft_campaign_brief"));
  const refinePlan = toolPlan?.some((name) => name.endsWith("refine_campaign_preview"));
  const outreachPlan = toolPlan?.some((name) => name.endsWith("plan_account_outreach"));
  const impactPlan = toolPlan?.some((name) => name.endsWith("assess_location_impact"));
  const inventoryPlan = toolPlan?.some((name) => name.endsWith("map_weather_demand"));
  const newsPlan = toolPlan?.some((name) => name.endsWith("match_news_to_approved_content"));
  const fedPlan = toolPlan?.some((name) => name.endsWith("get_fed_announcements"));
  const dealPlan = toolPlan?.some((name) => name.endsWith("prepare_deal_release"));
  const accountPlan = toolPlan?.some((name) => name.endsWith("build_aum_account_plan"));
  const targetPlan = toolPlan?.some((name) => name.endsWith("build_hcp_target_list"));
  const claimPlan = toolPlan?.some((name) => name.endsWith("check_clinical_claims"));
  const hospitalPlan = toolPlan?.some((name) => name.endsWith("plan_hospital_engagement"));
  const systemsPlan = toolPlan?.some((name) =>
    /(?:aprimo|reltio|vault|screendragon|iqvia|lsc|drupal)_/.test(name),
  );
  const graphPlan = toolPlan?.some((name) => name.startsWith("graph_"));
  const memoryPlan = toolPlan?.some((name) =>
    /_(?:recall_decisions|recall_recent_work)$/.test(name),
  );
  return [
    "You are the Northstar marketing proof orchestrator.",
    ...(scope ? [scopePrompt(scope)] : []),
    "Salesforce tool results are the only authority for Salesforce facts. Protocol success does not mean that a business result exists.",
    "If a tool reports unavailable, empty, no business units, no records, or an error, explain that limitation and do not fill gaps from workspace presentation data.",
    "Never say you reviewed Salesforce unless a Salesforce tool returned usable evidence.",
    "Never claim a write, publish, send, or activation occurred. Keep customer PII out of responses.",
    "Earlier messages in this conversation are context for follow-up requests. Treat facts in your earlier replies as unverified: call the governed tools again before restating Salesforce facts. Chat cannot create, save, publish, or send anything; when asked to act on something from earlier, say what it refers to and point to the confirmation actions in the workspace.",
    "When you write or revise a campaign, brief, or message, start with its title as a bold line, then give the draft as labeled lines, one per line, such as **Headline:** …, **Body:** …, **Send time:** …, **Audience:** …, **Channel:** …, **Campaign:** …, and **Brand:** … The workspace saves your draft from these lines. For a revision, rewrite the whole draft with the requested change and keep everything else the same.",
    "Saving to Salesforce always goes through a confirmation card that checks the user's Salesforce permissions; nothing is written until the user confirms. Never say a record was created, saved, scheduled, or sent.",
    "Format answers in concise Markdown: short paragraphs, bold labels, bullet lists, and small tables when they help. Never use raw HTML.",
    ...(restaurantPlan
      ? [
          "For this restaurant campaign, read the restaurant profile, then the current weather for its city, then look up similar past sends in the knowledge graph for that location, daypart, weather bucket, and the campaign's channel (past emails for an email campaign, past pushes for push; they show which menu items and content performed best on that channel, and how many of the audience hold marketing consent for it). Cite past performance and content from the campaign's own channel: never present push results as email results. Marketing consent is per channel: for an email campaign cite email opt-ins, for SMS the SMS opt-ins, and push opt-ins only for push; never cite one channel's opt-ins for another. Then ask the Marketing Cloud Campaign Creation agent for the campaign brief: its objective must name Coastline Kitchen, the channel requested, the audience and city with its opt-ins for that channel, the featured menu items, the local time of day, the weather, and what performed best before. Explain briefly how the context shaped the brief and cite past performance.",
        ]
      : []),
    ...(briefPlan
      ? [
          "draft_campaign_brief asks the Northstar Campaign Creation agent (a Marketing Cloud Next Campaign Creation agent) to run its Draft a Campaign Brief action. Send one complete request: for a new brief, 'Draft a campaign brief for …' with the full objective; to revise the brief in focus, 'Revise this campaign brief' followed by its current fields and the requested change. Present the brief the agent returns as labeled lines: **Name:**, **Description:**, **Key Message:**, **Target Audience:**, **Primary Goal:**, **Primary CTAs:**, **Primary KPI:**, **Agent Guardrails:**, **Priority:**; do not invent fields it didn't return. Say that the agent drafted it and nothing is saved yet: saving it to Marketing Cloud goes through a confirmation card, after which the agent drafts the campaign preview. Marketing Cloud previews here plan email and SMS steps; if the user asked for push, say the brief records that and the preview may use email. When earlier messages hold Harborstone Wealth's pre-approved content or account plan, build the objective from it: name the approved assets with their approval IDs, their required disclosures, and the audience with the consent it relies on, and say approved copy is used as approved with no new claims.",
        ]
      : []),
    ...(outreachPlan
      ? [
          "For this sales outreach plan, first read the account's contacts from the knowledge graph (who to contact first and why, when they last engaged, and the channels each has marketing consent for, plus the account's country), then get the public holidays for that country code. Present: the contacts in priority order with the evidence for each; the channel for each contact, using only channels they have consented to (say who can't be reached); and a dated outreach schedule for the next few weeks that avoids the public holidays, naming the holidays you avoided. It is a plan: never say anything was sent, scheduled, or logged.",
        ]
      : []),
    ...(impactPlan
      ? [
          "For this service disruption, first check active weather alerts for the Coastline Kitchen location, then assess the impact in the knowledge graph. Present: the alerts at that location (or say plainly there are none there right now, and mention any elsewhere in California); the impact from the graph in aggregate only (app users near the location, how many can be notified by push under their push consent, and the active campaigns targeting them that should be paused); then draft a short customer push notice (under 120 characters) and a note for the store team. Never name individual customers. It is a draft: never say anything was sent or paused.",
        ]
      : []),
    ...(inventoryPlan
      ? [
          "For this inventory check, first get the weather forecast for the Coastline Kitchen location, then map the forecast's demand-planning conditions (pass its demandConditions) to menu demand and inventory in the knowledge graph, then read the location's stock counts. The workbench then computes which items are low (on hand below the forecast need: typical daily use, raised by the graph's demand lift on the days whose weather lifts a dish made with the item). Present: the forecast by day; the dishes the weather lifts, with the lift from past results; the low items exactly as the workbench's inventory check lists them, each with its on-hand amount, the amount needed, and the dishes it goes into; and the store manager. Say that an action card can open a Salesforce case for the store manager, and that nothing is ordered or created until the user confirms it. Stock counts come from a randomized mock of the store inventory system.",
        ]
      : []),
    ...(newsPlan || dealPlan || accountPlan
      ? [
          "Harborstone Wealth is a fictional wealth-management brand under Northstar. Its client communications are regulated: only content a registered principal has approved, and whose approval is current, can be sent, exactly as approved with its required disclosures. Never write new claims, rewrite approved copy, predict markets, or promise returns; say what is blocked and why instead of working around it. Quote approval IDs exactly as the tools return them. Clients are institutions and family offices; never name individual people other than the advisor the tools return.",
        ]
      : []),
    ...(newsPlan
      ? [
          `For this market-news response, ${fedPlan ? "first read the Federal Reserve's latest announcement, then look up Harborstone's pre-approved content for the market event it maps to (pass the news tool's event unless the user asked about a different event)" : "look up Harborstone's pre-approved content for the market event the user describes"}. Present: ${fedPlan ? "the news in one or two sentences with its date and source; " : ""}the approved assets ready to send now, each with its channel, approval ID and expiry, required disclosures, and how many clients and subscribers can be reached under that channel's marketing consent; the blocked assets and exactly why (expired, pending, or failed a compliance check); and what past responses show about speed (open rates when sent within a few hours of the news against later). Then offer to set up the send as a Marketing Cloud campaign built from the approved asset. Never say anything was sent or scheduled.`,
        ]
      : []),
    ...(dealPlan
      ? [
          "For this acquisition announcement, read the release package from the knowledge graph and present a numbered release plan in order: timing, asset, audience and how many can be reached, what the send relies on (a service notice under the client agreement, marketing consent, an internal audience, or the public release), and its approval ID and required disclosures; then the blocked items and why. The package is embargoed until the announcement and the deal is confidential: never suggest releasing anything early. Say plainly that the acquired firm's clients receive service notices only and can't be marketed to until they opt in. Offer to set up the announcement sends as a Marketing Cloud campaign timed to the announcement. Never say anything was released, sent, or scheduled.",
        ]
      : []),
    ...(accountPlan
      ? [
          "For this account plan, read the client's plan from the knowledge graph. Present: a one-line relationship snapshot (AUM with Harborstone, estimated assets held elsewhere, wallet share, advisor); the signals, newest first; the plays ranked by estimated AUM opportunity, each with why, peer adoption, and the approved content to use with its approval ID (and any blocked content and why); the contacts in priority order with the channel to use for each (their channelForPlayContent), naming anyone with no consented channel or no approved content for their channels, whom the advisor contacts directly instead; and a 30/60/90-day activation sequence in which every touch sends an approved asset on a channel it is approved for and the contact consented to. Amounts are fictional estimates in $ millions, never promises. Offer to activate the plan as a Marketing Cloud campaign. Never say anything was sent, logged, or changed.",
        ]
      : []),
    ...(targetPlan || claimPlan || hospitalPlan
      ? [
          "Lumera Therapeutics is a fictional pharmaceutical brand under Northstar. Its promotion is regulated: only claims a completed trial supports, for an indication on the approved label, carried by content with a current medical-legal-regulatory (MLR) approval and its required safety information, can be used. Never write new clinical claims, rewrite approved copy, suggest off-label use, or compare with other drugs unless the tool shows head-to-head evidence. Quote approval IDs and trial names exactly as the tools return them. Audiences are prescriber groups at hospitals; never name individual clinicians or patients.",
        ]
      : []),
    ...(systemsPlan
      ? [
          "These tools return mocked views of pharmaceutical systems of record (Aprimo, Reltio, Veeva Vault, Screendragon, IQVIA, Salesforce Life Sciences Cloud, Drupal) built from invented data. Name the system each fact came from and say it is mocked. When more than one system answers, compare them and point out any disagreement, such as a page live on the HCP site with an expired MLR approval, or a claim approved in one place and not in another. Quote approval, claim, job and entity IDs exactly. Groups are counts of prescribers, never people. Nothing here changes anything: never say an asset was approved, published, taken down or merged.",
        ]
      : []),
    ...(targetPlan
      ? [
          "For this target list, read it from the knowledge graph and present the ranked hospitals and prescriber groups: the patients with the labeled indication, formulary status and days to the next P&T review, Lumera's share, the decile, the opted-in channels, and the play for each. Say that a drug that is not on formulary needs the approved value dossier before detailing. State the scoring formula the tool returns. Offer to plan engagement with the top hospital. Never say anything was sent or scheduled.",
        ]
      : []),
    ...(claimPlan && briefPlan
      ? [
          "For this Lumera campaign, work in order and finish in Marketing Cloud. First check the drug's claims: keep only those a trial supports, on the approved label and carried by content with a current MLR approval. Then find the approved assets in Aprimo for the channel. Then write the email draft yourself from the supported claims, word for word, with the safety information they require (including any boxed warning) and the approved assets by their Aprimo and MLR IDs. Only then ask the Marketing Cloud Campaign Creation agent for the brief: its objective must name the drug, the channel, the prescriber audience, each claim used exactly as approved with its MLR approval ID, the required safety information, and the approved assets, and must say no new claims are made. In your answer, give the draft, then a section **Ruled out** listing each claim or wording you considered but left out and why (no supporting trial, off label, expired or pending approval, or a comparison without head-to-head evidence), then the brief the agent returned.",
        ]
      : []),
    ...(newsPlan && briefPlan
      ? [
          "For this Harborstone campaign, work in order and finish in Marketing Cloud. First read the latest rate news and find the pre-approved content for it. Use only content the check says is releasable now, exactly as approved, with its approval ID and required disclosures. Then write the email draft yourself from that content. Only then ask the Marketing Cloud Campaign Creation agent for the brief, naming the approved assets with their approval IDs, their disclosures and the audience with the consent it relies on, and saying approved copy is used as approved with no new claims. In your answer, give the draft, then a section **Ruled out** listing content that is blocked (expired, pending, or failed a compliance check) and why, then the brief the agent returned.",
        ]
      : []),
    ...(claimPlan
      ? [
          "For this claims check, read it from the knowledge graph and present each claim with its verdict: the trial and result that support it (or that none does), whether the indication is on the approved label, and the approved content that carries it with its MLR approval, expiry and required safety information (including any boxed warning). Say plainly which claims are blocked and why, and that blocked claims must not appear in promotional content until a trial and the label support them. Never approve, rewrite or soften a claim yourself.",
        ]
      : []),
    ...(hospitalPlan
      ? [
          "For this hospital plan, read it from the knowledge graph and present: the formulary status of each Lumera drug and days to the next P&T review; the patients at stake; the formulary value dossier for each drug that is not yet preferred, usable now or blocked and why; the prescriber groups with the channels they opted in to and what they engaged with; and the next steps in the order the tool returns. Never say a dossier was submitted.",
        ]
      : []),
    ...(refinePlan
      ? [
          "refine_campaign_preview asks the Northstar Campaign Creation agent to run its Refine Campaign Preview action on the saved brief. Send 'Refine the campaign preview on brief <Brief ID from the workspace focus>: <the requested change>'. Then summarize what the agent changed; the workspace reloads the preview from Salesforce.",
        ]
      : []),
    ...(graphPlan
      ? [
          "Knowledge-graph results are fictional demo data with evidence paths. Explain the answer from those paths, name only entities that appear in the results, and never suggest that the graph or Salesforce was changed.",
        ]
      : []),
    ...(memoryPlan
      ? [
          "Memory results are dated records of past work in this workspace, not current Salesforce state. For each item, give its date and source; say it was remembered, not that it is true now; and offer to re-check Salesforce before reusing it. If nothing was found, say so plainly and do not guess.",
        ]
      : []),
    `Workspace (built from tool results in this chat): ${workspace}`,
  ].join(" ");
}

// Ordered intent rules. Each needs a specific signal, so a bare mention of "campaign" never forces
// a tool; when no rule matches, the model chooses. Precision matters more than coverage here,
// because a forced wrong tool cannot be recovered within the turn.
const INTENT_RULES: ReadonlyArray<readonly [string, (prompt: string) => boolean]> = [
  // Memory recall asks about earlier work; it never matches a request to draft something new.
  ["recall_recent_work", (p) => isRecallRequest(p) && RECENT_WORK.test(p)],
  ["recall_decisions", (p) => isRecallRequest(p)],
  // Knowledge-graph intents come first; each needs a signal the Salesforce tools cannot answer.
  [
    "check_consent_coverage",
    (p) =>
      /\bconsent\b/i.test(p) &&
      /\b(?:email|sms|push)\b/i.test(p) &&
      /\b(?:cover(?:ed|age)?|missing|lacks?|without)\b/i.test(p),
  ],
  [
    "explain_buyer_group",
    (p) => /\bbuyer group\b/i.test(p) && /\b(?:why|explain|evidence|reasons?|justify)\b/i.test(p),
  ],
  [
    "find_audience_overlap",
    (p) =>
      /\b(?:overlap(?:s|ping)?|fatigue|also (?:in|targeted))\b/i.test(p) &&
      /\b(?:campaigns?|audiences?)\b/i.test(p),
  ],
  [
    "trace_content_lineage",
    (p) => /\b(?:lineage|built from|brand[- ]rule(?:s)? (?:results|checks))\b/i.test(p),
  ],
  ["get_graph_overview", (p) => /\bknowledge graph\b/i.test(p)],
  [
    "check_campaign_readiness",
    (p) =>
      /\b(?:readiness|ready for|blockers?|risks?|consent coverage)\b/i.test(p) ||
      (/\b(?:complete|missing|incomplete)\b/i.test(p) && /\b(?:dates?|brief)\b/i.test(p)),
  ],
  ["refine_campaign_preview", (p) => /\brefine\b/i.test(p) && /\bpreview\b/i.test(p)],
  [
    "draft_campaign_brief",
    // "Draft a campaign brief" asks for a brief; "draft email content from this brief" does not.
    (p) => /\b(?:draft|create|write)\s+(?:a|an|the|new)?\s*(?:\w+\s+){0,2}brief\b/i.test(p),
  ],
  ["generate_campaign_insights", (p) => /\binsights?\b/i.test(p)],
  [
    "validate_content_against_brand",
    (p) => /\bbrand\b/i.test(p) && /\b(?:check|validate|review|against)\b/i.test(p),
  ],
  [
    "create_content_section",
    (p) =>
      /\b(?:hero|section|header|footer|module|banner)\b/i.test(p) &&
      /\b(?:draft|create|write)\b/i.test(p),
  ],
  [
    "draft_campaign_content",
    (p) =>
      /\b(?:draft|write|create|generate|prepare)\b/i.test(p) &&
      /\b(?:content|copy|subject line|preheader|email|sms|landing page)\b/i.test(p),
  ],
  ["recommend_buyer_group_members", (p) => /\bbuyer group\b/i.test(p)],
  ["get_account_marketing_signals", (p) => /\bsignals?\b/i.test(p) && /\baccounts?\b/i.test(p)],
  ["summarize_account_engagement", (p) => /\bengagement\b/i.test(p) && /\baccount'?s?\b/i.test(p)],
  [
    "summarize_campaign",
    (p) =>
      /\b(?:summarize|summary|recap|overview|performance|perform)\b/i.test(p) &&
      /\b(?:campaign|701[a-zA-Z0-9]{12,15})\b/i.test(p),
  ],
];

// Multi-tool plans for requests that need context before drafting. Each step forces one tool.
/** A request to check a location's stock against what its forecast weather will lift. */
export function isInventoryCheck(prompt: string) {
  return (
    /\b(?:inventory|stock(?:ed|s)?|par levels?|running low|run out|supplies|ingredients?)\b/i.test(
      prompt,
    ) &&
    /\b(?:weather|forecast|demand|coastline|location|restaurant|store|los angeles|san francisco|san diego|sacramento|fresno)\b/i.test(
      prompt,
    )
  );
}

/** Harborstone Wealth's fictional clients, for routing account-plan requests. */
const HARBORSTONE_CLIENTS =
  /\b(?:cedar valley|bayshore arts|redwood coast|mission hills|pacific dental|summit ridge|coastal freight|golden state veterinary|marin family|sierra crest|lakehouse capital|point reyes)\b/i;

/** Lumera Therapeutics' fictional drugs and hospitals, for routing life-sciences requests. */
const LUMERA_DRUGS = /\b(?:cardivance|glucora|neurelva|lumera)\b/i;
const LUMERA_HOSPITALS =
  /\b(?:st\.? brigid|lakeshore health|mesa verde|cascade university|pinecrest|gulf coast heart|heartland medical|harbor view)\b/i;

const TOOL_PLANS: ReadonlyArray<readonly [readonly string[], (prompt: string) => boolean]> = [
  // Life sciences: a campaign for a Lumera drug. The claims are checked and the approved assets
  // found first, so Marketing Cloud's brief is built from them, last.
  [
    ["check_clinical_claims", "aprimo_search_approved_assets", "draft_campaign_brief"],
    (p) =>
      LUMERA_DRUGS.test(p) &&
      /\b(?:draft|write|create|build|plan|set up|launch)\b/i.test(p) &&
      /\b(?:campaign|e-?mail|newsletter)\b/i.test(p),
  ],
  // Life sciences: one drug's materials checked across Aprimo, the claims library and the HCP site.
  [
    ["aprimo_search_approved_assets", "vault_list_approved_claims", "drupal_list_hcp_site_content"],
    (p) =>
      LUMERA_DRUGS.test(p) &&
      /\b(?:consistent|in sync|across|every system|all systems|end to end)\b/i.test(p) &&
      /\b(?:materials?|content|assets?|claims?|site|website|pages?)\b/i.test(p),
  ],
  // Life sciences: the mocked systems of record, each asked for what it holds.
  [
    ["aprimo_get_mlr_review"],
    (p) =>
      /\bMLR-\d{4}-\d{4}\b/i.test(p) && /\b(?:review|stage|why|status|pending|reviewer)\b/i.test(p),
  ],
  [
    ["aprimo_search_approved_assets"],
    (p) => /\b(?:aprimo|asset library|digital asset|mlr[- ]approved assets?)\b/i.test(p),
  ],
  [
    ["reltio_resolve_organization"],
    (p) => /\b(?:reltio|golden record|master data|mdm|duplicate (?:hospital|record)s?)\b/i.test(p),
  ],
  [
    ["vault_get_prescribing_information"],
    (p) => /\b(?:prescribing information|label version|pi version|current label)\b/i.test(p),
  ],
  [["vault_list_approved_claims"], (p) => /\b(?:veeva|vault|promomats|claims library)\b/i.test(p)],
  [["screendragon_get_job"], (p) => /\bSD-\d{4}\b/i.test(p)],
  [
    ["screendragon_list_jobs"],
    (p) => /\b(?:screendragon|work management|marketing jobs?|job status|jobs at risk)\b/i.test(p),
  ],
  [
    ["iqvia_get_prescribing_trends"],
    (p) =>
      /\b(?:iqvia|prescribing trends?|trx|nbrx|new[- ]to[- ]brand|prescription data)\b/i.test(p),
  ],
  [
    ["lsc_get_call_plan"],
    (p) =>
      /\b(?:life sciences cloud|call plan|rep calls?|field team|detail calls?)\b/i.test(p) &&
      (LUMERA_HOSPITALS.test(p) || /\bhospital\b/i.test(p)),
  ],
  [
    ["drupal_list_hcp_site_content"],
    (p) => /\b(?:drupal|hcp (?:web)?site|website content|published pages?|hcp pages?)\b/i.test(p),
  ],
  // Life sciences: a hospital's formulary status, its P&T review, and the dossier to send.
  [
    ["plan_hospital_engagement"],
    (p) =>
      LUMERA_HOSPITALS.test(p) &&
      /\b(?:engage\w*|plan|formulary|p&t|pharmacy and therapeutics|access|dossier|next steps?|approach)\b/i.test(
        p,
      ),
  ],
  // Life sciences: are a drug's clinical claims supported, on label, and approved for use?
  [
    ["check_clinical_claims"],
    (p) =>
      /\b(?:clinical claims?|promotional claims?|claim support|off-?label|on-?label|boxed warning|isi|important safety information|mlr)\b/i.test(
        p,
      ) ||
      (LUMERA_DRUGS.test(p) &&
        /\b(?:claims?|supported|substantiat\w*|approved content|usable)\b/i.test(p)),
  ],
  // Life sciences: which hospitals and prescriber groups to reach first for a drug.
  [
    ["build_hcp_target_list"],
    (p) =>
      /\b(?:target list|hcp targets?|target (?:hospitals|accounts|prescribers)|prescriber groups?|where to (?:detail|engage|focus))\b/i.test(
        p,
      ) ||
      (LUMERA_DRUGS.test(p) &&
        /\b(?:target\w*|prioriti[sz]\w*|hospitals?|prescribers?|hcps?|detail)\b/i.test(p)),
  ],
  // Financial services: an account plan to grow a Harborstone client's assets under management.
  [
    ["build_aum_account_plan"],
    (p) =>
      /\b(?:account plan|aum|assets under management|wallet share|share of wallet|grow (?:the |our |this )?relationship)\b/i.test(
        p,
      ) ||
      (HARBORSTONE_CLIENTS.test(p) && /\b(?:plan|grow|opportunit\w*|next best|plays?)\b/i.test(p)),
  ],
  // Financial services: the embargoed acquisition announcement and its pre-approved package.
  [
    ["prepare_deal_release"],
    (p) =>
      /\b(?:acquisitions?|acquir\w*|mergers?|m&a|bayview)\b/i.test(p) &&
      /\b(?:content|release|announce\w*|approved|send|communications?|embargo\w*|package|clients?)\b/i.test(
        p,
      ),
  ],
  // Financial services: live Federal Reserve news, then the content pre-approved for it.
  [
    ["get_fed_announcements", "match_news_to_approved_content"],
    (p) =>
      /\b(?:fed|federal reserve|fomc|rate (?:decision|cut|hike|increase|move|announcement)s?|interest rates?)\b/i.test(
        p,
      ) &&
      /\b(?:content|approved|pre-?approved|send|respond|response|clients?|campaign|emails?|messages?|compliance|news)\b/i.test(
        p,
      ),
  ],
  // Financial services: a market swing, answered from content approved for it.
  [
    ["match_news_to_approved_content"],
    (p) =>
      /\b(?:volatil\w*|markets? (?:are |is )?(?:swing\w*|sell\w*|drop\w*|fall\w*|tumbl\w*|turmoil|downturn)|sell-?offs?)\b/i.test(
        p,
      ) && /\b(?:content|approved|pre-?approved|send|clients?|compliance)\b/i.test(p),
  ],
  // Service: stock at a location against the dishes its forecast weather will lift.
  [["get_weather_forecast", "map_weather_demand", "get_location_inventory"], isInventoryCheck],
  // Sales: who to contact at an account and when, around its local public holidays.
  [
    ["plan_account_outreach", "get_public_holidays"],
    (p) =>
      /\b(?:outreach|reach out|contact plan|sequence|follow[- ]?ups?|meetings?|prospect)\b/i.test(
        p,
      ) &&
      /\b(?:account|buyer group|acme|summit trail|redwood rangers|harbor point|blue ridge|pacific crest|granite peak|riverbend|northwind|cedar hollow|silverline|lakeside paddle)\b/i.test(
        p,
      ),
  ],
  // Service: a weather disruption near a location, and which customers it affects.
  [
    ["get_weather_alerts", "assess_location_impact"],
    (p) =>
      /\b(?:weather alerts?|storm|severe weather|flood(?:ing)?|heat wave|wildfire|smoke|evacuat\w*|closure|closed|outage|disruption|advisory|warning)\b/i.test(
        p,
      ) &&
      /\b(?:coastline|location|restaurant|store|customers?|los angeles|san francisco|san diego|sacramento|fresno)\b/i.test(
        p,
      ),
  ],
  [
    [
      "get_restaurant_profile",
      "get_current_weather",
      "find_similar_past_pushes",
      "draft_campaign_brief",
    ],
    // A push campaign, or any campaign or email for the restaurant: both use the same context.
    (p) =>
      (/\bpush\b/i.test(p) && /\b(?:notifications?|campaigns?|messages?|alerts?)\b/i.test(p)) ||
      (/\b(?:coastline|restaurant)\b/i.test(p) &&
        /\b(?:draft|write|create|plan)\b/i.test(p) &&
        /\b(?:e-?mail|campaign|newsletter)\b/i.test(p)),
  ],
];

// Tools whose result is a draft; a plan ending in one saves the draft to the workspace focus.
const DRAFTING_TOOLS = new Set([
  "draft_campaign_content",
  "draft_campaign_brief",
  "create_content_section",
  "refine_campaign_preview",
]);

export type PlanContext = {
  /** The brand chosen in the header, which decides the claims checks a new draft starts with. */
  brand?: Brand | "all";
  hasFocus?: boolean;
  focusKind?: FocusKind;
  /** The focus is a brief saved in Marketing Cloud, so changes refine its campaign preview. */
  briefSaved?: boolean;
};

/**
 * A change to the draft in focus: "make it warmer", "shorten the body", "use the burrito
 * instead". Only meaningful when a focus exists.
 */
export function isRevisionRequest(prompt: string) {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  return (
    words > 0 &&
    words <= 30 &&
    (/\b(?:make|change|rewrite|revise|tweak|shorten|lengthen|swap|adjust|edit|update|try|use|add|remove|drop|replace)\b/i.test(
      prompt,
    ) ||
      /\b(?:shorter|longer|warmer|punchier|friendlier|simpler|bolder|more|less)\b/i.test(prompt)) &&
    !/\b(?:summarize|summary|readiness|overview|buyer group|consent|overlap|lineage)\b/i.test(
      prompt,
    )
  );
}

const RECALL =
  /\b(?:what (?:did|have) we (?:decide|decided|save|saved|draft|drafted|do|done|agree|agreed|work(?:ed)? on)|what do you (?:remember|recall)|do you (?:remember|recall)|last time|previously|earlier (?:session|chat|conversation)|recall|reuse (?:what|the) we|did we (?:save|decide|draft|approve|request))\b/i;
const RECENT_WORK =
  /\b(?:recent(?:ly)?|lately|so far|latest)\b[^.?!]*\b(?:work|worked|drafts?|decisions?|done)\b|\bwhat have we (?:done|worked on)\b/i;

/** A question about work remembered from earlier chats in this workspace. */
export function isRecallRequest(prompt: string) {
  return RECALL.test(prompt) && !isRememberRequest(prompt);
}

/** "Remember this draft": store the draft in focus in long-term memory. */
export function isRememberRequest(prompt: string) {
  return /^\s*(?:please\s+)?(?:remember|memorize)\s+(?:this|that|it|the (?:current |latest )?(?:draft|campaign|brief|email|message|push(?: message)?))\b[^?]*$|\b(?:save|add|keep|store) (?:this|that|it|the draft) (?:to|in) (?:long[- ]term )?memory\b/i.test(
    prompt,
  );
}

/** A request for a record in Salesforce, such as "…as a new campaign in Salesforce". */
export function wantsSalesforceRecord(prompt: string) {
  return /\b(?:in|to|into)\s+salesforce\b|\bsalesforce\s+(?:record|campaign|brief|email|message)\b/i.test(
    prompt,
  );
}

export type DraftIntent = { mode: "draft" | "revise"; kind: FocusKind };

/**
 * Whether this turn writes a draft the workspace should save as its focus: a new draft (a
 * drafting plan, or a new campaign requested in Salesforce) or a revision of the current one.
 * The orchestrator saves the draft from the finished answer, so no tool call is required.
 */
export function draftIntent(
  prompt: string,
  context: PlanContext & { focusKind?: FocusKind } = {},
): DraftIntent | null {
  const plan = requestedToolPlan(prompt, context);
  const last = plan?.at(-1);
  if (last && DRAFTING_TOOLS.has(last)) {
    if (last === "draft_campaign_brief")
      return {
        mode:
          context.hasFocus && context.focusKind === "brief" && isRevisionRequest(prompt)
            ? "revise"
            : "draft",
        kind: "brief",
      };
    // Refining a saved brief's preview changes Marketing Cloud, not the draft in focus.
    if (last === "refine_campaign_preview")
      return context.briefSaved ? null : { mode: "draft", kind: "campaign" };
    if (/\bpush\b|\bnotification/i.test(prompt)) return { mode: "draft", kind: "push-message" };
    if (/\bemail\b|subject line|preheader/i.test(prompt)) return { mode: "draft", kind: "email" };
    return { mode: "draft", kind: "content" };
  }
  if (plan) return null;
  if (context.hasFocus && context.focusKind && isRevisionRequest(prompt))
    return { mode: "revise", kind: context.focusKind };
  return null;
}

/** Tools that hand work to Marketing Cloud's agents. They come last, after the checks. */
const MARKETING_CLOUD_TOOLS = new Set([
  "draft_campaign_brief",
  "refine_campaign_preview",
  "draft_campaign_content",
  "create_content_section",
]);

/**
 * What each brand checks before anything is drafted: Lumera's clinical claims and its approved
 * assets in Aprimo; Harborstone's approved, releasable content for the current rate news.
 * Coastline has no claims library in chat, so its drafts start from its restaurant context.
 */
export const CLAIMS_CHECKS: Record<Brand, readonly string[]> = {
  "Lumera Therapeutics": ["check_clinical_claims", "aprimo_search_approved_assets"],
  "Harborstone Wealth": ["get_fed_announcements", "match_news_to_approved_content"],
  "Coastline Kitchen": [],
};

/** The brand a request is for: the header's choice, or the one the request names. */
function planBrand(prompt: string, context: PlanContext): Brand | undefined {
  if (context.brand && context.brand !== "all") return context.brand;
  if (LUMERA_DRUGS.test(prompt)) return "Lumera Therapeutics";
  if (/\b(?:harborstone|sweep account|wealth)\b/i.test(prompt)) return "Harborstone Wealth";
  if (/\b(?:coastline|chowder|restaurant)\b/i.test(prompt)) return "Coastline Kitchen";
  return undefined;
}

/**
 * A new draft starts with its brand's claims checks and ends in Marketing Cloud: the checks are
 * put first if the plan lacks them, and Marketing Cloud's agents are moved to the end.
 */
function checksFirst(plan: readonly string[], prompt: string, context: PlanContext) {
  if (!plan.some((name) => DRAFTING_TOOLS.has(name))) return plan;
  const brand = planBrand(prompt, context);
  const checks = (brand ? CLAIMS_CHECKS[brand] : []).filter((name) => !plan.includes(name));
  return [
    ...checks,
    ...plan.filter((name) => !MARKETING_CLOUD_TOOLS.has(name)),
    ...plan.filter((name) => MARKETING_CLOUD_TOOLS.has(name)),
  ];
}

/** The ordered tools a prompt requires, or null to let the model choose. */
export function requestedToolPlan(
  prompt: string,
  context: PlanContext = {},
): readonly string[] | null {
  // Changes to a Marketing Cloud brief go back to the Campaign Creation agent: a re-draft
  // before the brief is saved, a preview refinement after.
  if (context.hasFocus && context.focusKind === "brief" && isRevisionRequest(prompt))
    return [context.briefSaved ? "refine_campaign_preview" : "draft_campaign_brief"];
  if (
    context.briefSaved &&
    /\b(?:preview|email [12]|second email|first email|step \d)\b/i.test(prompt) &&
    isRevisionRequest(prompt)
  )
    return ["refine_campaign_preview"];
  const planned = TOOL_PLANS.find(([, matches]) => matches(prompt))?.[0];
  // A new campaign "in Salesforce" or "in Marketing Cloud" ends with the agent's brief. A plan
  // that gathers its context first (claims, assets, past results) keeps Marketing Cloud last;
  // otherwise the brief is the whole plan.
  if (
    (wantsSalesforceRecord(prompt) || /\bmarketing cloud\b/i.test(prompt)) &&
    /\bcampaign\b/i.test(prompt) &&
    /\b(?:create|set up|start|make|build|plan)\b/i.test(prompt)
  )
    return checksFirst(
      planned?.includes("draft_campaign_brief") ? planned : ["draft_campaign_brief"],
      prompt,
      context,
    );
  const plan =
    planned ??
    (() => {
      const single = INTENT_RULES.find(([, matches]) => matches(prompt))?.[0];
      return single ? [single] : null;
    })();
  return plan ? checksFirst(plan, prompt, context) : null;
}

export function requestedToolName(prompt: string, context: PlanContext = {}) {
  return requestedToolPlan(prompt, context)?.[0] ?? null;
}

function resolveTool(name: string, availableNames: string[]) {
  return availableNames.find((available) => available === name || available.endsWith(`_${name}`));
}

/** Resolves a prompt's plan to available tool keys; undefined if any step's tool is missing. */
export function selectToolPlan(
  prompt: string,
  availableNames: string[],
  context: PlanContext = {},
) {
  const plan = requestedToolPlan(prompt, context);
  if (!plan) return undefined;
  const resolved = plan.map((name) => resolveTool(name, availableNames));
  return resolved.every((name): name is string => Boolean(name)) ? resolved : undefined;
}

/** The first planned tool that is not available, for explaining why a plan cannot run. */
export function missingPlannedTool(
  prompt: string,
  availableNames: string[],
  context: PlanContext = {},
) {
  return (
    requestedToolPlan(prompt, context)?.find((name) => !resolveTool(name, availableNames)) ?? null
  );
}

export function selectRequiredTool(prompt: string, availableNames: string[]) {
  return selectToolPlan(prompt, availableNames)?.[0];
}

export function requiredToolChoice(requiredTool: string | undefined, stepNumber: number) {
  if (!requiredTool) return undefined;
  return stepNumber === 0
    ? { toolChoice: { type: "tool" as const, toolName: requiredTool } }
    : { toolChoice: "none" as const };
}

/**
 * Per-step tool settings. Step N of a plan forces its Nth tool and only sees that tool; steps after
 * the plan, and the last allowed step, receive no tools at all: Workers AI does not enforce
 * `toolChoice: "none"`, so gpt-oss otherwise emits malformed tool calls instead of the answer.
 */
export function stepToolChoice(
  plan: string | readonly string[] | undefined,
  stepNumber: number,
  maxSteps = MAX_TURN_STEPS,
) {
  const steps = plan === undefined ? [] : typeof plan === "string" ? [plan] : plan;
  const forced = steps[stepNumber];
  if (forced && stepNumber < maxSteps - 1)
    return { toolChoice: { type: "tool" as const, toolName: forced }, activeTools: [forced] };
  if (steps.length > 0 || stepNumber >= maxSteps - 1)
    return { toolChoice: "none" as const, activeTools: [] as string[] };
  return undefined;
}

export type CampaignChannel = "push" | "email" | "sms";

const CHANNEL_WORDS: Array<[CampaignChannel, RegExp]> = [
  ["email", /\b(?:e-?mails?|newsletters?|subject lines?|preheaders?)\b/i],
  ["sms", /\b(?:sms|texts?|text messages?)\b/i],
  ["push", /\b(?:push(?:es)?|notifications?)\b/i],
];

/**
 * The channel a campaign request names: the earliest channel word in the prompt, or else the
 * channel of the draft in focus. Null when neither names one.
 */
export function requestedChannel(prompt: string, focusChannel?: string): CampaignChannel | null {
  const found = (text: string) =>
    CHANNEL_WORDS.flatMap(([channel, pattern]) => {
      const index = text.search(pattern);
      return index >= 0 ? [{ channel, index }] : [];
    }).sort((a, b) => a.index - b.index)[0]?.channel ?? null;
  return found(prompt) ?? (focusChannel ? found(focusChannel) : null);
}

type Executable = { execute?: (input: never, options: never) => unknown };

/**
 * Marketing consent is per channel, so the audience's consent is looked up for the channel the
 * user asked for, whatever channel the model passed.
 */
export function pinCampaignChannel<T extends Record<string, unknown>>(
  tools: T,
  channel: CampaignChannel | null,
): T {
  if (!channel) return tools;
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = (definition as Executable).execute;
      if (!/(?:^|_)find_similar_past_pushes$/.test(name) || typeof execute !== "function")
        return [name, definition];
      return [
        name,
        {
          ...(definition as object),
          execute: (input: Record<string, unknown>, options: unknown) =>
            execute({ ...input, channel } as never, options as never),
        },
      ];
    }),
  ) as T;
}
