// The pharma lifecycle (packages/architecture/src/team-pharma.ts). At each step one worker reads
// what that step rests on and saves with the step's own tool; context.stage is that save tool.
// The worker's grants (team-<id>) still bound it: a step offers, and allows, the reads below
// that the worker holds, and the save. These forbids narrow; they never grant.

@id("lifecycle-propose_focus_areas")
@note("Business focus reads segments, competitors, market signals and past results, and saves focus areas; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "propose_focus_areas" }
unless {
  [
    "get_audience_segments",
    "get_competitors",
    "get_market_signals",
    "get_past_results",
    "propose_focus_areas"
  ].contains(resource.name)
};

@id("lifecycle-propose_concepts")
@note("Concepts read the claims library, approved assets and brand guidelines, and save concepts; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "propose_concepts" }
unless {
  [
    "get_claims_library",
    "find_approved_assets",
    "get_brand_guidelines",
    "propose_concepts"
  ].contains(resource.name)
};

@id("lifecycle-draft_modules")
@note("Modules read the claims library, approved assets and brand guidelines, and save modules; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "draft_modules" }
unless {
  [
    "get_claims_library",
    "find_approved_assets",
    "get_brand_guidelines",
    "draft_modules"
  ].contains(resource.name)
};

@id("lifecycle-submit_mlr_job")
@note("The MLR job reads the claims library and submits the job; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "submit_mlr_job" }
unless { ["get_claims_library", "submit_mlr_job"].contains(resource.name) };

@id("lifecycle-build_audience")
@note("The audience reads the HCP universe and saves the list; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "build_audience" }
unless { ["get_hcp_universe", "build_audience"].contains(resource.name) };

@id("lifecycle-schedule_deployment")
@note("Deployment reads the approved job and channel benchmarks, and saves the schedule; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "schedule_deployment" }
unless {
  ["get_approved_job", "get_channel_benchmarks", "schedule_deployment"].contains(resource.name)
};

@id("lifecycle-prepare_form_2253")
@note("Form FDA 2253 reads the approved job and saves the form; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "prepare_form_2253" }
unless { ["get_approved_job", "prepare_form_2253"].contains(resource.name) };

@id("lifecycle-report_performance")
@note("Analytics reads the campaign results and past results, and saves the report; {tool} is not part of this step.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when { context has stage && context.stage == "report_performance" }
unless { ["get_campaign_results", "get_past_results", "report_performance"].contains(resource.name) };

// A step this file does not name gets its save tool and nothing else.
@id("lifecycle-unlisted-step")
@note("This lifecycle step offers only its own save tool; {tool} is not it.")
forbid (principal is Agent, action == Action::"call", resource is TeamTool)
when {
  context has stage &&
  ![
    "propose_focus_areas",
    "propose_concepts",
    "draft_modules",
    "submit_mlr_job",
    "build_audience",
    "schedule_deployment",
    "prepare_form_2253",
    "report_performance"
  ].contains(context.stage)
}
unless { resource.name == context.stage };
