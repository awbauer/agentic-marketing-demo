// The chat orchestrator's tools (ADR-020). Resource Tool::"<name>", where a name may carry its
// server's prefix (graph_, context_, ext_, ls_, or tool_<server>_ for Salesforce), so rules match
// with `like "*<tool>"`. context.done and context.prerequisites hold names without prefixes.
//
// The same decision offers tools to the model and allows each call, so a rule here both narrows
// what the model sees and refuses anything else it tries. Which tools are candidates is the
// scenario's (the intent router's toolset, or the brand's catalog); these rules decide which of
// them are on offer now. The guards in guards.cedar still apply: brand scope, no decisions, and
// the operator's kill switch.
//
// Context a rule can use (see schema.cedarschema): intents (the request classifier's labels),
// done, prerequisites, scenario, brand, persona, surface ("chat").

@id("orchestrator-tools")
@note("The orchestrator may call any tool the operator has not withheld, unless a rule below narrows the turn.")
permit (principal == Agent::"orchestrator", action == Action::"call", resource is Tool);

@id("orchestrator-off-topic")
@note("The classifier found the request has nothing to do with the workbench, so no tool is offered; the model answers in its own words.")
forbid (principal == Agent::"orchestrator", action == Action::"call", resource is Tool)
when { context.intents.contains("off-topic") };

@id("orchestrator-claims-check-first")
@note("A request about what a drug's materials may say starts with the claims check; other tools follow once it has run.")
forbid (principal == Agent::"orchestrator", action == Action::"call", resource is Tool)
when { context.intents.contains("claims") && !context.done.contains("check_clinical_claims") }
unless { resource.name like "*check_clinical_claims" };

@id("orchestrator-ground-before-drafting")
@note("Marketing Cloud's agents draft and create in Salesforce, so they are offered only once the checks the scenario runs first have worked.")
forbid (principal == Agent::"orchestrator", action == Action::"call", resource is Tool)
when { context has prerequisites && !context.done.containsAll(context.prerequisites) && (resource.name like "*draft_campaign_brief" || resource.name like "*refine_campaign_preview" || resource.name like "*draft_campaign_content" || resource.name like "*create_content_section") };
