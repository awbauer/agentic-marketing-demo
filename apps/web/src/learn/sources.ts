/**
 * Which source paths each Learn section explains. `pnpm learn:check` uses this map in two ways:
 *
 * - **Drift:** when a change touches a mapped path, the sections that explain it must change in
 *   the same branch, or a commit must carry `Learn-Reviewed: <section ids> (<why no update>)`.
 * - **New concepts:** every source file must be mapped to a section here or listed as untaught
 *   below, so a new module can't land without someone deciding where it's taught.
 *
 * Entries are path prefixes: a directory ends with "/", and anything else is a file.
 */
export const SECTION_SOURCES: Record<string, readonly string[]> = {
  // Primers explain ideas rather than code; they change when the ideas do.
  "what-is-context": [],
  "memory-layers": ["apps/edge/src/turn-history.ts"],
  "context-risks": [],
  rag: [],
  "graphrag-explained": [],
  "graphrag-here": [
    "packages/knowledge-graph/src/dataset.ts",
    "packages/knowledge-graph/src/tools.ts",
    "packages/knowledge-graph/src/query-api.ts",
    "packages/knowledge-graph/src/explorer.ts",
    "packages/knowledge-graph/src/index.ts",
    "apps/edge/src/knowledge-graph/",
    "apps/web/src/graph/",
    "apps/web/src/GraphEvidence.tsx",
    "scripts/seed-knowledge-graph.mjs",
    "scripts/check-knowledge-graph.mjs",
  ],
  orchestrator: ["apps/edge/src/orchestrator.ts", "apps/edge/src/index.ts"],
  workspace: [
    "apps/edge/src/working-set.ts",
    "apps/edge/src/focus.ts",
    "apps/web/src/WorkspacePanel.tsx",
    "apps/web/src/ActionCards.tsx",
  ],
  model: [],
  mcp: ["apps/edge/src/campaign-context/server.ts", "apps/edge/src/life-sciences/"],
  salesforce: [
    "salesforce/force-app/main/default/aiAuthoringBundles/Campaign_Readiness_Governance/",
    "salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Account_Discovery/",
    "salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Content_Builder/",
    "apps/web/src/SalesforceAgents.tsx",
    "salesforce/force-app/main/default/bots/",
    "salesforce/force-app/main/default/mcpServerDefinitions/",
    "packages/contracts/src/tool-catalog.json",
    "salesforce/force-app/main/default/objects/Activity/",
    "salesforce/force-app/main/default/objects/ContentVersion/",
    "salesforce/force-app/main/default/classes/NorthstarGetCampaignContext.cls",
    "salesforce/force-app/main/default/classes/NorthstarGetConsentSummary.cls",
    "salesforce/force-app/main/default/classes/NorthstarValidateCampaignContent.cls",
    "salesforce/force-app/main/default/classes/NorthstarCreateCampaignReviewRequest.cls",
  ],
  routing: ["apps/edge/src/turn-policy.ts"],
  reliability: ["apps/edge/src/forced-tool-middleware.ts", "apps/edge/src/turn-trace.ts"],
  governance: [
    "apps/edge/src/auth.ts",
    "apps/web/src/ConfirmationDetails.tsx",
    "packages/contracts/src/index.ts",
    "salesforce/force-app/main/default/classes/NorthstarCheckWriteAccess.cls",
    "salesforce/force-app/main/default/classes/NorthstarConfirmationVerifier.cls",
    "salesforce/force-app/main/default/objects/Northstar_Confirmation_Config__c/",
    "salesforce/force-app/main/default/permissionsets/",
  ],
  ui: [
    "apps/web/src/App.tsx",
    "apps/web/src/WriteProgress.tsx",
    "apps/web/src/ScopeBar.tsx",
    "apps/web/src/scope.tsx",
    "apps/web/src/Markdown.tsx",
    "packages/ui/src/",
    "salesforce/force-app/main/default/lightningTypes/",
    "salesforce/force-app/main/default/uiWidgets/",
  ],
  observability: [
    "apps/web/src/HistoryView.tsx",
    "apps/web/src/turn-trace.ts",
    "apps/web/src/turn-stats.ts",
  ],
  evaluations: [
    "packages/evals/src/",
    "apps/web/src/EvaluationView.tsx",
    "scripts/run-evals.mjs",
    "scripts/run-live-evals.mjs",
    "scripts/rescore-evals.mjs",
    "scripts/calibrate-judge.mjs",
    "scripts/lib/eval-methodology.mjs",
    "scripts/lib/eval-summary.mjs",
    "scripts/lib/eval-estimate.mjs",
    "scripts/lib/eval-judge.mjs",
    "scripts/lib/eval-provider.mjs",
    "scripts/lib/eval-throttle.mjs",
    "scripts/lib/eval-simulated-agent.mjs",
  ],
  images: ["salesforce/force-app/main/default/classes/NorthstarAttachCampaignImage.cls"],
  "campaign-context": [
    "apps/edge/src/campaign-context/open-meteo.ts",
    "apps/edge/src/campaign-context/restaurant-profile.ts",
    "packages/knowledge-graph/src/coastline.ts",
  ],
  "marketing-cloud": [
    "apps/edge/src/marketing-writes.ts",
    "salesforce/force-app/main/default/aiAuthoringBundles/Northstar_Campaign_Creation/",
    "salesforce/force-app/main/default/classes/NorthstarGetMarketingRecords.cls",
  ],
  "use-cases": [
    "apps/edge/src/external-services/",
    "apps/web/src/usecases/",
    "apps/edge/src/campaign-context/store-inventory.ts",
    "packages/knowledge-graph/src/harborstone.ts",
    "packages/knowledge-graph/src/pharma.ts",
    "apps/edge/src/inventory-risk.ts",
    "salesforce/force-app/main/default/classes/NorthstarCreateInventoryCase.cls",
  ],
  "object-model": [
    "packages/architecture/src/types.ts",
    "packages/architecture/src/seed.ts",
    "packages/architecture/src/world.ts",
    "packages/architecture/src/workspaces.ts",
    "packages/architecture/src/channels.ts",
    "packages/architecture/src/index.ts",
    "apps/web/src/architecture/ArchitectureView.tsx",
    "apps/web/src/architecture/WorkspaceRenderer.tsx",
    "apps/web/src/architecture/Orientation.tsx",
    "apps/web/src/architecture/guide.ts",
    "apps/web/src/architecture/SampleFlows.tsx",
    "apps/web/src/architecture/JourneysView.tsx",
    "apps/web/src/architecture/AssetPreview.tsx",
    "apps/web/src/architecture/asset.ts",
    "packages/architecture/src/flows.ts",
    "apps/edge/src/architecture/objects.ts",
    "apps/web/src/architecture/ObjectInspector.tsx",
    "apps/web/src/architecture/Shared.tsx",
    "apps/web/src/architecture/api.ts",
    "apps/web/src/architecture/architecture.css",
  ],
  gateway: [
    "packages/architecture/src/gateway.ts",
    "packages/architecture/src/scope.ts",
    "apps/edge/src/architecture/context.ts",
    "apps/edge/src/architecture/api.ts",
    "apps/edge/src/architecture/mcp.ts",
    "apps/edge/src/architecture/store.ts",
    "migrations/0006_architecture_roadmap.sql",
  ],
  lifecycle: [
    "packages/architecture/src/agents.ts",
    "packages/architecture/src/language.ts",
    "packages/architecture/src/farm.ts",
    "packages/architecture/src/state-machine.ts",
    "apps/edge/src/architecture/ops.ts",
    "apps/web/src/architecture/AgentConsole.tsx",
  ],
  "agent-operations": [
    "apps/edge/src/architecture/agent-runtime.ts",
    "apps/edge/src/architecture/agent-tools.ts",
    "apps/edge/src/architecture/orchestration.ts",
    "apps/edge/src/architecture/scripted-model.ts",
    "packages/architecture/src/registry.ts",
    "packages/architecture/src/prompts.ts",
    "packages/architecture/src/models.ts",
    "packages/architecture/src/evaluators.ts",
    "packages/architecture/src/trust.ts",
    "packages/architecture/src/retention.ts",
    "packages/architecture/prompts.lock.json",
    "apps/edge/src/architecture/views.ts",
    "apps/web/src/architecture/AgentsPanel.tsx",
    "apps/web/src/architecture/CatalogsPanel.tsx",
    "apps/web/src/architecture/TrustPanel.tsx",
    "scripts/check-prompts.mjs",
    "docs/decisions/ADR-009-model-catalog-and-routing.md",
  ],
  "long-term-memory": [
    "packages/knowledge-graph/src/memory.ts",
    "apps/edge/src/memory.ts",
    "apps/web/src/MemoryPanel.tsx",
  ],
};

/** Roots whose code files (.ts, .tsx, .mjs, .cls) must each be mapped above or listed as untaught. */
export const TAUGHT_ROOTS = [
  "apps/edge/src/",
  "apps/web/src/",
  "packages/",
  "salesforce/force-app/",
  "scripts/",
] as const;

/** Source files that aren't concepts a reader needs taught, and why. */
export const UNTAUGHT_SOURCES: ReadonlyArray<{ path: string; reason: string }> = [
  { path: "apps/web/src/learn/", reason: "The Learn page itself" },
  { path: "apps/web/src/main.tsx", reason: "React entry point" },
  { path: "apps/edge/src/worker-configuration.d.ts", reason: "Generated Worker types" },
  { path: "apps/edge/src/worker.test-helpers.ts", reason: "Test helpers" },
  {
    path: "salesforce/force-app/main/default/classes/NorthstarCampaignActionsTest.cls",
    reason: "Apex tests",
  },
  {
    path: "salesforce/force-app/main/default/classes/NorthstarMarketingAgentTest.cls",
    reason: "Apex tests",
  },
  {
    path: "salesforce/force-app/main/default/classes/NorthstarInventoryCaseTest.cls",
    reason: "Apex tests",
  },
  { path: "scripts/check-blocked-words.mjs", reason: "Delivery gate" },
  { path: "scripts/check-docs.mjs", reason: "Delivery gate" },
  { path: "scripts/export-learn.mjs", reason: "Writes docs/learn.md from the Learn page itself" },
  { path: "scripts/check-hxl.mjs", reason: "Delivery gate" },
  { path: "scripts/check-invariants.mjs", reason: "Delivery gate" },
  { path: "scripts/check-learn.mjs", reason: "This gate" },
  { path: "scripts/check-salesforce-metadata.mjs", reason: "Delivery gate" },
  { path: "scripts/check-retired-salesforce.mjs", reason: "Delivery gate" },
  { path: "scripts/install-git-hooks.mjs", reason: "Developer setup" },
  { path: "scripts/verify.mjs", reason: "Delivery gate runner" },
  { path: "scripts/lib/report.mjs", reason: "Gate report helper" },
  { path: "scripts/prove-salesforce-mcp.mjs", reason: "One-time OAuth proof" },
  { path: "scripts/run-live-proof.mjs", reason: "Production smoke test" },
  { path: "scripts/test-production-chat.mjs", reason: "Production smoke test" },
  { path: "scripts/validate-salesforce.mjs", reason: "Salesforce CI validation" },
];

/**
 * Changes to these never need a Learn update: tests, snapshots, and the metadata companions of
 * Apex classes. Other `-meta.xml` files (objects, fields, permission sets, the MCP definition) are
 * Salesforce source and are checked like code.
 */
export const DRIFT_IGNORED = [
  /\.test\.[cm]?[jt]sx?$/,
  /Test\.cls(?:-meta\.xml)?$/,
  /\.cls-meta\.xml$/,
  /\.snap$/,
];
