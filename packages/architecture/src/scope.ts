// The scope a person has chosen in the header: which brand they are working on, and which role
// they are running as. It follows every page and every chat message, and it is enforced on the
// server, so choosing a brand also withholds the other brands' tools from the model.
import { PERSONAS, type Persona } from "./state-machine.ts";
import { BRANDS, type Brand } from "./types.ts";

export type WorkbenchScope = { brand: Brand | "all"; persona: Persona };
export const DEFAULT_SCOPE: WorkbenchScope = { brand: "all", persona: "marketer" };

export const isBrand = (value: unknown): value is Brand =>
  typeof value === "string" && (BRANDS as readonly string[]).includes(value);

/** Reads a scope from untrusted input, falling back to the default for anything invalid. */
export function parseScope(value: unknown): WorkbenchScope {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    brand: input.brand === "all" || isBrand(input.brand) ? (input.brand as Brand | "all") : "all",
    persona: (PERSONAS as readonly string[]).includes(input.persona as string)
      ? (input.persona as Persona)
      : DEFAULT_SCOPE.persona,
  };
}

export const HARBORSTONE_TOOLS = [
  "match_news_to_approved_content",
  "prepare_deal_release",
  "build_aum_account_plan",
  "get_fed_announcements",
] as const;
export const COASTLINE_TOOLS = [
  "get_restaurant_profile",
  "get_current_weather",
  "get_weather_forecast",
  "get_location_inventory",
  "get_weather_alerts",
  "map_weather_demand",
  "find_similar_past_pushes",
  "assess_location_impact",
] as const;
export const LUMERA_TOOLS = [
  "build_hcp_target_list",
  "check_clinical_claims",
  "plan_hospital_engagement",
  "aprimo_search_approved_assets",
  "aprimo_get_mlr_review",
  "reltio_resolve_organization",
  "vault_list_approved_claims",
  "vault_get_prescribing_information",
  "screendragon_list_jobs",
  "screendragon_get_job",
  "iqvia_get_prescribing_trends",
  "lsc_get_call_plan",
  "drupal_list_hcp_site_content",
] as const;

const PREFIXES = /^(?:graph_|context_|ext_|ls_)/;
const TOOL_BRAND = new Map<string, Brand>([
  ...HARBORSTONE_TOOLS.map((name): [string, Brand] => [name, "Harborstone Wealth"]),
  ...COASTLINE_TOOLS.map((name): [string, Brand] => [name, "Coastline Kitchen"]),
  ...LUMERA_TOOLS.map((name): [string, Brand] => [name, "Lumera Therapeutics"]),
]);

/** The brand a tool belongs to, or undefined for a tool every brand can use. */
export const toolBrand = (toolName: string): Brand | undefined =>
  TOOL_BRAND.get(toolName.replace(PREFIXES, ""));

/** A tool is allowed unless it belongs to a different brand than the one chosen. */
export function scopeAllowsTool(scope: WorkbenchScope, toolName: string): boolean {
  const brand = toolBrand(toolName);
  return scope.brand === "all" || brand === undefined || brand === scope.brand;
}

/** The first tool in a plan that belongs to a brand other than the chosen one, if any. */
export function outOfScopeTool(scope: WorkbenchScope, toolPlan: readonly string[] | undefined) {
  return toolPlan?.find((name) => !scopeAllowsTool(scope, name));
}

export const PERSONA_FOCUS: Record<Persona, string> = {
  "brand-planner": "planning: themes, calendar, audiences and what the data says about timing",
  marketer: "marketing execution: briefs, content, audiences and channels",
  "content-lab": "content: drafting and adapting modules from approved claims",
  compliance: "evidence: claims, substantiation, disclosures and what is blocked and why",
  reviewer: "review: what is ready for a decision, and every blocker",
  senior: "escalated review: what the first reviewer could not decide",
  "brand-lead": "results: what performed, why, and what to refresh, re-issue or retire",
  admin: "operations: access, controls and audit",
};

/** What the model is told about the chosen scope. It narrows the answer; it grants nothing. */
export function scopePrompt(scope: WorkbenchScope): string {
  const brand =
    scope.brand === "all"
      ? "No single brand is selected, so any brand's data may be used when the request names it."
      : `The user is working on ${scope.brand}. Use only ${scope.brand}'s data and tools. If the request is about another brand, say it is outside the selected brand and ask the user to switch the brand in the header; do not answer it from memory.`;
  return `${brand} The user is running as ${scope.persona.replace("-", " ")}, so lead with ${PERSONA_FOCUS[scope.persona]}. The role changes emphasis only: it does not change what Salesforce allows or what needs confirmation.`;
}
