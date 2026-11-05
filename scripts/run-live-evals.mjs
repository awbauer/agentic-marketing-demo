// Live evaluation of the orchestrator turn pipeline across Workers AI models.
// Runs the production routing, prompt, step settings, and forced-tool middleware against
// fictional tool fixtures, then writes a typed report that the demo UI renders.
//
// Usage: pnpm eval:live [--tier frontier] [--models id,id] [--trials-demo 5] [--trials-routing 2]
//                       [--out path] [--live-graph] [--cases id,id] [--no-judge]
//                       [--dry-run] [--max-usd n]
//   --tier frontier  also runs the expensive models (they need Workers Paid)
//   --models         explicit model IDs from the comparison roster
//   --cases          only these case ids; for cheap targeted re-runs
//   --dry-run        print the projected cost and exit without calling any model
//   --max-usd        refuse to start when the projected cost exceeds this (default 2, or 15 with --tier frontier)
//   --no-judge       skip quality scoring, which removes the judge panel's cost
// Cost: every run prints a projection first; turns, judge calls, and the simulated agent are priced
// at Cloudflare's Workers AI list rates and written into the report.
// Credentials: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or an authenticated wrangler login.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import {
  CAMPAIGN_CONTEXT_TOOL_PREFIX,
  connectCampaignContextTools,
} from "../apps/edge/src/campaign-context/server.ts";
import {
  connectExternalServiceTools,
  EXTERNAL_SERVICES_TOOL_PREFIX,
} from "../apps/edge/src/external-services/server.ts";
import { applyFocusUpdate } from "../apps/edge/src/focus.ts";
import { forcedToolCallMiddleware } from "../apps/edge/src/forced-tool-middleware.ts";
import {
  connectKnowledgeGraphTools,
  KNOWLEDGE_GRAPH_TOOL_PREFIX,
  knowledgeGraphBackend,
} from "../apps/edge/src/knowledge-graph/server.ts";
import {
  connectLifeSciencesTools,
  LIFE_SCIENCES_TOOL_PREFIX,
} from "../apps/edge/src/life-sciences/server.ts";
import { pinBriefToRefinement } from "../apps/edge/src/marketing-writes.ts";
import {
  MAX_OUTPUT_TOKENS,
  MAX_TURN_STEPS,
  orchestratorSystemPrompt,
  pinCampaignChannel,
  requestedChannel,
  selectToolPlan,
  stepToolChoice,
  TURN_TIMEOUT,
} from "../apps/edge/src/turn-policy.ts";
import { workingSetPrompt } from "../apps/edge/src/working-set.ts";
import {
  classifyPolicyIntent,
  emptyWorkingSet,
  KNOWLEDGE_GRAPH_TOOLS,
  MEMORY_TOOLS,
  PHASE_2_AUTONOMOUS_TOOLS,
  POLICY_RESPONSES,
  PROOF_DEFAULTS,
} from "../packages/contracts/src/index.ts";
import { demoScenarios, routingCases } from "../packages/evals/src/cases.ts";
import { formatUsd, turnCost } from "../packages/evals/src/pricing.ts";
import { EvalReportSchema } from "../packages/evals/src/report.ts";
import { evaluateCriteria, isJudged } from "../packages/evals/src/rubric.ts";
import {
  claimsWrite,
  groundingEntities,
  ungroundedEntities,
} from "../packages/evals/src/scoring.ts";
import {
  buildDataset,
  recordDecision,
  rememberDraft,
} from "../packages/knowledge-graph/src/index.ts";
import { estimateRun, formatEstimate } from "./lib/eval-estimate.mjs";
import { buildQuality, JUDGES, judgeAnswer } from "./lib/eval-judge.mjs";
import { buildMethodology } from "./lib/eval-methodology.mjs";
import { createEvalProvider } from "./lib/eval-provider.mjs";
import {
  createSimulatedAgent,
  SIMULATED_TOOLS,
  simulatedResult,
} from "./lib/eval-simulated-agent.mjs";
import { summarize, summarizeAgreement, summarizeCost } from "./lib/eval-summary.mjs";
import { concurrencyFor } from "./lib/eval-throttle.mjs";

// Served as a static asset so the demo UI shows the latest committed run without a code change.
const DEFAULT_REPORT_PATH = "apps/web/public/evals/latest.json";
// The Hosted MCP namespace prefix observed in production tool names.
const TOOL_PREFIX = "tool_salesforce_northstar-marketing-salesforce_";
const CALIBRATION_PATH = "artifacts/reports/eval-calibration.json";

// The two gpt-oss baselines run by default. The paid-access models are opt-in (--tier frontier).
// GLM-4.7-Flash and Llama 4 Scout were retired from the live roster in ADR-011.
const MODELS = [
  { id: "@cf/openai/gpt-oss-120b", label: "gpt-oss-120b", family: "openai", tier: "default" },
  { id: "@cf/openai/gpt-oss-20b", label: "gpt-oss-20b", family: "openai", tier: "default" },
  { id: "@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6", family: "moonshot", tier: "frontier" },
  {
    id: "@cf/zai-org/glm-5.3-flash",
    label: "GLM-5.3-Flash",
    family: "zai",
    tier: "frontier",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    label: "DeepSeek V4.1 Flash",
    family: "deepseek",
    tier: "frontier",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro",
    family: "deepseek",
    tier: "frontier",
  },
];

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/** Tool descriptions come from the source-controlled Hosted MCP definition. */
function toolDescriptions() {
  const xml = readFileSync(
    "salesforce/force-app/main/default/mcpServerDefinitions/NorthstarMarketingWorkbench.mcpServerDefinition-meta.xml",
    "utf8",
  );
  return Object.fromEntries(
    [
      ...xml.matchAll(
        /<descriptionOverride>([^<]+)<\/descriptionOverride>[\s\S]*?<toolName>([^<]+)<\/toolName>/g,
      ),
    ].map(([, description, name]) => [name, description]),
  );
}

// Fictional fixture results shaped like the Salesforce agent responses; no customer data.
const FIXTURES = {
  summarize_campaign: {
    campaign: { name: "VERO Phase 1 Launch", status: "In Progress", type: "Email", sent: 12400 },
    performance: {
      openRate: 0.382,
      clickRate: 0.067,
      conversions: 214,
      trend: "8.4 percent above the four-week baseline",
    },
  },
  check_campaign_readiness: {
    checksComplete: 7,
    checksTotal: 9,
    blockers: ["Hero image alt text is missing", "Commercial consent scope is not confirmed"],
  },
  draft_campaign_content: {
    subjectLine: "Your trail is waiting",
    preheader: "Members-only gear picks for fall hikes",
    body: "A short fictional draft inviting dormant loyalty members back for fall hiking season.",
  },
  // The Campaign Creation agent's Draft a Campaign Brief reply, in its real format.
  draft_campaign_brief: {
    message: [
      "Here is a draft campaign brief:",
      "Name: Rainy Day Comfort",
      "Description: Lunch email for Coastline Kitchen app users in Los Angeles on rainy days.",
      "Key Message: Rain outside? Spicy Tortilla Soup is ready in minutes.",
      "Target Audience: Los Angeles app users who order at lunch.",
      "Primary Goal: Drive lunch app orders on rainy days.",
      "Primary CTAs: Order now",
      "Primary KPI: Lunch orders from the campaign",
      "Agent Guardrails: Coastline Kitchen brand voice.",
      "Priority: High",
      "Would you like to see a campaign preview based on this brief?",
    ].join("\n"),
  },
  recommend_buyer_group_members: {
    candidates: [
      { role: "Marketing lead", signal: "High engagement with fall launch content" },
      { role: "Operations manager", signal: "Attended the spring webinar" },
    ],
  },
  summarize_account_engagement: {
    lastActivity: "Webinar attendance",
    engagementScore: 72,
    trend: "rising",
  },
  get_account_marketing_signals: {
    signals: ["Opened three campaign emails", "Visited the pricing page twice"],
  },
  generate_campaign_insights: { insights: ["Mobile opens outperform desktop by 12 percent"] },
  validate_content_against_brand: { issues: ["Replace one exclamation mark to match brand tone"] },
  create_content_section: { section: "Hero: Find your next trail with members-only fall picks." },
  refine_campaign_preview: {
    message:
      "I refined the campaign preview: the second email is now shorter, with the same call to action.",
  },
};

function fixtureTools(simulator) {
  const descriptions = toolDescriptions();
  const schema = jsonSchema({
    type: "object",
    properties: {
      message: { type: "string", description: "Natural-language request for the Salesforce agent" },
    },
    required: ["message"],
  });
  return Object.fromEntries(
    PHASE_2_AUTONOMOUS_TOOLS.map((name) => [
      `${TOOL_PREFIX}${name}`,
      tool({
        description: descriptions[name] ?? name.replaceAll("_", " "),
        inputSchema: schema,
        // Drafting tools are answered by the fixed simulated agent when judging is on.
        execute: async (input) =>
          simulator && SIMULATED_TOOLS.includes(name)
            ? simulatedResult(simulator, name, String(input?.message ?? ""))
            : {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ source: "fictional-fixture", ...FIXTURES[name] }),
                  },
                ],
                isError: false,
              },
      }),
    ]),
  );
}

// Each evaluation turn is a fresh chat, so its working set is empty and only the catalog is listed.
const WORKSPACE = workingSetPrompt(emptyWorkingSet());
// A chat whose brief was saved in Marketing Cloud, for refinement scenarios.
const SAVED_BRIEF_ID = "21yjV0000002NIHQA2";
function savedBriefWorkspace() {
  const set = applyFocusUpdate(
    emptyWorkingSet(),
    {
      kind: "brief",
      title: "Rainy Day Comfort",
      summary: "Lunch email for Coastline Kitchen app users in Los Angeles on rainy days.",
      fields: [
        { label: "Key Message", value: "Rain outside? Spicy Tortilla Soup is ready in minutes." },
        { label: "Target Audience", value: "Los Angeles app users who order at lunch." },
      ],
      changeNote: "Drafted by the Campaign Creation agent",
    },
    new Date(),
  );
  const focus = set.focus;
  return {
    ...set,
    focus: focus && {
      ...focus,
      saved: { objectType: "Brief", recordId: SAVED_BRIEF_ID, version: 1, preview: [] },
    },
  };
}
const WORKSPACES = {
  "saved-brief": {
    prompt: workingSetPrompt(savedBriefWorkspace()),
    context: { hasFocus: true, focusKind: "brief", briefSaved: true },
  },
};
function shortName(name) {
  if (!name) return null;
  if (name.startsWith(TOOL_PREFIX)) return name.slice(TOOL_PREFIX.length);
  if (name.startsWith(CAMPAIGN_CONTEXT_TOOL_PREFIX))
    return name.slice(CAMPAIGN_CONTEXT_TOOL_PREFIX.length);
  if (name.startsWith(EXTERNAL_SERVICES_TOOL_PREFIX))
    return name.slice(EXTERNAL_SERVICES_TOOL_PREFIX.length);
  if (name.startsWith(LIFE_SCIENCES_TOOL_PREFIX))
    return name.slice(LIFE_SCIENCES_TOOL_PREFIX.length);
  if (name.startsWith(KNOWLEDGE_GRAPH_TOOL_PREFIX))
    return name.slice(KNOWLEDGE_GRAPH_TOOL_PREFIX.length);
  return name;
}

async function runCase(model, tools, suite, testCase, trial, judging) {
  const started = Date.now();
  const policyRouted =
    suite !== "routing-model-only" ? classifyPolicyIntent(testCase.prompt) : null;
  const base = {
    model: model.id,
    suite,
    caseId: testCase.id,
    prompt: testCase.prompt,
    expected: testCase.expected,
    trial,
  };
  let route = "model";
  let text = "";
  let toolCalled = null;
  let toolErrors = 0;
  let evidence = "";
  let agentRequest;
  const sent = [];
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let trace = [];
  let steps = "";
  let failure;
  let streamError;
  if (policyRouted) {
    route = policyRouted;
    text = POLICY_RESPONSES[policyRouted];
  } else {
    try {
      const workspace = testCase.workspace ? WORKSPACES[testCase.workspace] : undefined;
      const toolPlan =
        suite === "routing-model-only"
          ? undefined
          : selectToolPlan(testCase.prompt, Object.keys(tools), workspace?.context);
      const result = streamText({
        model: wrapLanguageModel({
          model: model.provider(model.id),
          middleware: forcedToolCallMiddleware,
        }),
        system: orchestratorSystemPrompt(workspace?.prompt ?? WORKSPACE, toolPlan),
        prompt: testCase.prompt,
        // The same server-side pinning production applies to refinements of a saved brief, with
        // each request recorded as the agent receives it.
        tools: pinCampaignChannel(
          pinBriefToRefinement(
            recordAgentRequests(tools, sent),
            workspace?.context.briefSaved ? SAVED_BRIEF_ID : undefined,
          ),
          requestedChannel(testCase.prompt),
        ),
        prepareStep: ({ stepNumber }) => stepToolChoice(toolPlan, stepNumber),
        stopWhen: stepCountIs(MAX_TURN_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        timeout: TURN_TIMEOUT,
        onError: ({ error }) => {
          streamError = error;
        },
      });
      text = (await result.text).trim();
      const resultSteps = await result.steps;
      const called = resultSteps
        .flatMap((step) => step.toolCalls)
        .map((call) => shortName(call.toolName));
      toolCalled = called.length ? called.join(" → ") : null;
      agentRequest = agentRequestCheck(resultSteps, sent);
      // Grounding applies when a graph or memory tool ran; any tool's result counts as evidence,
      // since a restaurant menu item can come from the restaurant profile, not the graph.
      const results = resultSteps.flatMap((step) => step.toolResults);
      if (
        results.some((result) =>
          [...KNOWLEDGE_GRAPH_TOOLS, ...MEMORY_TOOLS].includes(shortName(result.toolName)),
        )
      )
        evidence = results.map((result) => JSON.stringify(result.output)).join("\n");
      toolErrors = resultSteps
        .flatMap((step) => step.content)
        .filter((part) => part.type === "tool-error").length;
      steps = resultSteps.map((step) => step.finishReason).join(",");
      // Every tool call with its request and result, for the rubric and the judge.
      const outputs = new Map(results.map((entry) => [entry.toolCallId, entry.output]));
      trace = resultSteps
        .flatMap((step) => step.toolCalls)
        .map((call) => ({
          name: shortName(call.toolName),
          request: String(call.input?.message ?? JSON.stringify(call.input ?? {})),
          output: JSON.stringify(outputs.get(call.toolCallId) ?? null),
        }));
      const usage = await result.totalUsage;
      inputTokens = usage.inputTokens ?? 0;
      cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
      outputTokens = usage.outputTokens ?? 0;
    } catch (error) {
      route = "error";
      const cause = streamError ?? error;
      failure = String(cause instanceof Error ? cause.message : cause)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .slice(0, 240);
    }
  }
  const expectsNoTool =
    testCase.expected === "confirmation_required" || testCase.expected === "unsupported";
  const checks = {
    // Single-tool cases check the first call; planned sequences must start with every planned tool.
    toolCorrect: expectsNoTool
      ? toolCalled === null
      : (toolCalled ?? "").startsWith(testCase.expected) &&
        (testCase.expected.includes(" → ") || toolCalled?.split(" → ")[0] === testCase.expected),
    textProduced: text.length > 0,
    noToolErrors: toolErrors === 0 && route !== "error",
    noFalseWriteClaim: !claimsWrite(text),
    // A graph or memory answer names only entities its tool results contain.
    graphGrounded: !evidence || ungroundedEntities(text, evidence, GRAPH_ENTITIES).length === 0,
    // A request to the Marketing Cloud Campaign Creation agent carries what the turn gathered.
    agentRequestGrounded: agentRequest ?? true,
  };
  const passed = Object.values(checks).every(Boolean);
  if (!passed && !failure)
    failure = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([check]) => check)
      .join(", ");
  const latencyMs = Date.now() - started;
  const isDemo = suite === "demo-scenarios";
  let criteria;
  let quality;
  if (isDemo) {
    const ungrounded = ungroundedEntities(
      text,
      trace.map((item) => item.output).join("\n"),
      GRAPH_ENTITIES,
    );
    criteria = evaluateCriteria(testCase.id, { answer: text, trace, ungrounded });
    // Judge only answers a model wrote; policy replies and errors have nothing to rate.
    if (judging && isJudged(testCase.id) && route === "model" && text) {
      const judged = await judgeAnswer(judging.provider, model.family, {
        caseId: testCase.id,
        prompt: testCase.prompt,
        answer: text.slice(0, 3000),
        trace,
        toolRequests: trace.map((item) => item.request),
      });
      judging.costs.push(...judged.costs);
      quality = buildQuality(testCase.id, judged);
    }
  }
  return {
    ...base,
    route,
    toolCalled,
    checks,
    passed,
    latencyMs,
    inputTokens,
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
    outputTokens,
    cost: turnCost(model.id, { inputTokens, cachedInputTokens, outputTokens }),
    steps,
    excerpt: text.replace(/\s+/g, " ").slice(0, 240),
    ...(isDemo
      ? {
          answer: text.slice(0, 3000),
          toolRequests: trace.map((item) => item.request.slice(0, 1000)),
          criteria,
        }
      : {}),
    ...(quality ? { quality } : {}),
    ...(failure ? { failure } : {}),
  };
}

const GRAPH_ENTITIES = groundingEntities(buildDataset().nodes);
const MENU_ITEMS = buildDataset()
  .nodes.filter((node) => node.label === "MenuItem")
  .map((node) => node.name);

/** Records what the Campaign Creation agent's tools actually receive, after server changes. */
function recordAgentRequests(tools, sent) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const short = shortName(name);
      if (
        !["draft_campaign_brief", "refine_campaign_preview"].includes(short) ||
        !definition.execute
      )
        return [name, definition];
      const execute = definition.execute;
      return [
        name,
        {
          ...definition,
          execute: (input, options) => {
            sent.push({ toolName: name, input });
            return execute(input, options);
          },
        },
      ];
    }),
  );
}

/**
 * Whether the turn's request to the Campaign Creation agent carries the context the turn
 * gathered: a refinement names the saved Brief ID; a brief request after context tools names the
 * brand, a menu item those tools returned, and the city or weather. Undefined when the turn
 * didn't ask the agent.
 */
function agentRequestCheck(resultSteps, sent) {
  const results = resultSteps.flatMap((step) => step.toolResults);
  const request = (name) => {
    const call = sent.find((item) => shortName(item.toolName) === name);
    return call ? JSON.stringify(call.input ?? {}).toLowerCase() : null;
  };
  const refine = request("refine_campaign_preview");
  if (refine !== null) return refine.includes(SAVED_BRIEF_ID.toLowerCase());
  const brief = request("draft_campaign_brief");
  if (brief === null) return undefined;
  const context = results
    .filter((result) => shortName(result.toolName) !== "draft_campaign_brief")
    .map((result) => JSON.stringify(result.output ?? {}))
    .join("\n")
    .toLowerCase();
  if (!context) return true;
  const menu = MENU_ITEMS.filter((item) => context.includes(item.toLowerCase()));
  const placeOrWeather = [
    "los angeles",
    "san francisco",
    "san diego",
    "fresno",
    "sacramento",
    "rain",
    "clear",
    "cloud",
    "fog",
    "heat",
    "sunny",
  ].filter((term) => context.includes(term));
  return (
    brief.includes("coastline") &&
    menu.some((item) => brief.includes(item.toLowerCase())) &&
    placeOrWeather.some((term) => brief.includes(term))
  );
}

// The last `pnpm eval:calibrate` result, recorded in the report so readers can see the judges
// were checked. A missing or stale file simply omits the section.
function calibrationFromDisk() {
  try {
    return JSON.parse(readFileSync(CALIBRATION_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

async function seedEvalMemory(backend, workspaceId) {
  const stamp = (daysAgo) => {
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    return {
      workspaceId,
      actorHash: "eval0000eval0000",
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + 14 * 86_400_000).toISOString(),
      eventId: crypto.randomUUID(),
      id: crypto.randomUUID(),
    };
  };
  const subjects = { salesforceIds: [], names: ["Coastline Kitchen"] };
  const draft = {
    focusId: "eval-focus",
    kind: "push-message",
    title: "Rainy-day comfort",
    summary: "Lunch push for Los Angeles app users on rainy days.",
    fields: [
      { label: "Headline", value: "Rain outside? Soup's on." },
      { label: "Brand", value: "Coastline Kitchen" },
    ],
    version: 2,
  };
  await rememberDraft(backend, { ...stamp(3), source: "saved-to-salesforce", draft, subjects });
  await recordDecision(backend, {
    ...stamp(3),
    decision: {
      kind: "confirmed-write",
      outcome: "Saved the brief “Rainy-day comfort” (21y000000000001).",
      note: "Saved from version 2 of the draft.",
    },
    record: {
      system: "salesforce",
      objectType: "Brief",
      recordId: "21y000000000001",
      title: "Rainy-day comfort",
    },
    draftRef: { focusId: "eval-focus", version: 2 },
    subjects,
  });
}

async function pool(tasks, limit) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await tasks[index]();
      }
    }),
  );
  return results;
}

const REPORT_PATH = argument("out", DEFAULT_REPORT_PATH);
const trialsDemo = Number(argument("trials-demo", "5"));
const trialsRouting = Number(argument("trials-routing", "2"));
const frontier = argument("tier", "default") === "frontier";
const judgingOn = !process.argv.includes("--no-judge");
const selected = argument(
  "models",
  MODELS.filter((model) => frontier || model.tier === "default")
    .map((model) => model.id)
    .join(","),
).split(",");
const models = MODELS.filter((model) => selected.includes(model.id));
const suites = [
  { id: "demo-scenarios", cases: [...demoScenarios], trials: trialsDemo },
  { id: "routing-pipeline", cases: [...routingCases], trials: trialsRouting },
  { id: "routing-model-only", cases: [...routingCases], trials: trialsRouting },
];
const onlyCases = argument("cases", "").split(",").filter(Boolean);
if (onlyCases.length)
  for (const suite of suites)
    suite.cases = suite.cases.filter((test) => onlyCases.includes(test.id));

// Project the cost first and refuse to start above the cap; nothing has been spent yet.
const previousReport = (() => {
  try {
    return JSON.parse(readFileSync(DEFAULT_REPORT_PATH, "utf8"));
  } catch {
    return undefined;
  }
})();
const estimate = estimateRun(
  { models, suites: suites.map((suite) => ({ ...suite, cases: suite.cases })) },
  previousReport,
);
console.log(formatEstimate(estimate));
const maxUsd = Number(argument("max-usd", frontier ? "15" : "2"));
if (process.argv.includes("--dry-run")) process.exit(0);
if (estimate.totalUsd > maxUsd) {
  console.error(
    `Projected ${formatUsd(estimate.totalUsd)} exceeds the ${formatUsd(maxUsd)} cap. Raise --max-usd, run fewer trials, or pick fewer models.`,
  );
  process.exit(1);
}

// Every call goes through a per-model limiter: paid frontier models allow 20 requests a minute.
const provider = createEvalProvider();
// Judging and the simulated agent are fixed reference models, held constant across contestants.
const judging = judgingOn ? { provider: provider.background, costs: [] } : undefined;
const simulator = judgingOn ? createSimulatedAgent(provider) : undefined;
// Salesforce read tools are fixtures; the campaign-context MCP runs for real (mocked restaurant data,
// live Open-Meteo weather) through the same in-process MCP client as production.
const campaignContext = await connectCampaignContextTools();
// The knowledge graph uses its local fictional copy unless --live-graph points it at Neo4j.
// Memory recall reads an evaluation workspace, seeded locally with one remembered decision.
const graphBackend = process.argv.includes("--live-graph")
  ? knowledgeGraphBackend(process.env)
  : knowledgeGraphBackend({});
const memoryContext = { workspaceId: `eval-${Date.now()}`, now: () => new Date() };
if (graphBackend.kind === "fixture") await seedEvalMemory(graphBackend, memoryContext.workspaceId);
const graph = await connectKnowledgeGraphTools(graphBackend, memoryContext);
// Nager.Date holidays and National Weather Service alerts are live public APIs.
const external = await connectExternalServiceTools();
// The pharmaceutical systems of record are mocked, so they need no credentials.
const lifeSciences = await connectLifeSciencesTools();
const tools = {
  ...fixtureTools(simulator),
  ...campaignContext.tools,
  ...external.tools,
  ...lifeSciences.tools,
  ...graph.tools,
};

const results = (
  await Promise.all(
    models.map(async (model) => {
      const tasks = suites.flatMap((suite) =>
        suite.cases.flatMap((testCase) =>
          Array.from(
            { length: suite.trials },
            (_, trial) => () =>
              runCase({ ...model, provider }, tools, suite.id, testCase, trial, judging),
          ),
        ),
      );
      const modelResults = await pool(tasks, concurrencyFor(model.id));
      const passed = modelResults.filter((result) => result.passed).length;
      console.log(`${model.label}: ${passed}/${modelResults.length} passed`);
      return modelResults;
    }),
  )
).flat();

const cost = summarizeCost(results, {
  judgeCosts: judging?.costs ?? [],
  simulatorCost: simulator?.cost() ?? { usd: 0, neurons: 0 },
});
const report = EvalReportSchema.parse({
  generatedAt: new Date().toISOString(),
  gitSha: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  productionModel: PROOF_DEFAULTS.orchestratorModel,
  methodology: buildMethodology({ trialsDemo, trialsRouting }),
  models: MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    tier: model.tier,
    included: selected.includes(model.id),
  })),
  summaries: summarize(results),
  results,
  cost,
  ...(judgingOn
    ? {
        judges: JUDGES.map(({ id, label }) => ({ id, label })),
        agreement: summarizeAgreement(results),
        ...(calibrationFromDisk() ? { calibration: calibrationFromDisk() } : {}),
      }
    : {}),
});
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 1)}\n`);
await campaignContext.close();
await graph.close();
await external.close();
await lifeSciences.close();
console.log(
  `Wrote ${REPORT_PATH} (${results.length} turns). Actual cost ${formatUsd(cost.totalUsd)} (models ${formatUsd(cost.contestantsUsd)}, judges ${formatUsd(cost.judgesUsd)}, simulated agent ${formatUsd(cost.simulatorUsd)}); projected ${formatUsd(estimate.totalUsd)}.`,
);
