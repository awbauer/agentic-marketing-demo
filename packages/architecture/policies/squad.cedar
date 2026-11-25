// A squad run (brief to proposal). A spoke at work is offered, and may call, its data reads, the
// shared folder and semantic layer, its teammates, and the one tool that saves its deliverable,
// within its grants (team-<id>). Its lifecycle tools wait for a lifecycle run.

@id("squad-spoke-tools")
@note("In a squad run a spoke uses its data reads, the shared folder, the semantic layer, its teammates and its own deliverable; {tool} is not one of them.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context.surface == "squad" && principal has role && principal.role == "spoke" }
unless {
  [
    "get_audience_segments",
    "get_competitors",
    "get_market_signals",
    "get_brand_guidelines",
    "get_channel_specs",
    "get_channel_benchmarks",
    "find_approved_assets",
    "read_team_output",
    "query_semantic_layer",
    "define_term",
    "ask_teammate",
    "answer_teammate"
  ].contains(resource.name) ||
  (principal has deliverable && principal.deliverable == resource.name)
};
