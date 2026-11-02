// Proves the Neo4j Cypher and the fixture backend return the same results for every graph tool,
// and for long-term memory in a throwaway workspace that is forgotten afterwards. Reports Neo4j
// tool latency (p50/p95) and fails when the median reaches 500 ms.
// Usage: pnpm kg:parity   (needs NEO4J_QUERY_URL, NEO4J_USERNAME, NEO4J_PASSWORD)
import { isDeepStrictEqual } from "node:util";
import {
  ACCOUNTS,
  buildDataset,
  ALL_CAMPAIGNS,
  CLIENT_NAMES,
  DRUG_IDS,
  HOSPITAL_NAMES,
  createMemoryStore,
  forgetMemory,
  KNOWLEDGE_GRAPH_TOOL_SPECS,
  listMemory,
  MEMORY_TOOL_SPECS,
  queryApiBackend,
  recordDecision,
  rememberDraft,
} from "../packages/knowledge-graph/src/index.ts";

const { NEO4J_QUERY_URL: url, NEO4J_USERNAME: username, NEO4J_PASSWORD: password } = process.env;
if (!url || !username || !password) {
  console.error("Set NEO4J_QUERY_URL, NEO4J_USERNAME, and NEO4J_PASSWORD.");
  process.exit(2);
}
const live = queryApiBackend({ url, username, password });
const fixture = { kind: "fixture", dataset: buildDataset(), memory: createMemoryStore() };
const LATENCY_BUDGET_MS = 500;
const cases = {
  get_graph_overview: [{}],
  explain_buyer_group: [ACCOUNTS[0], ACCOUNTS[5], ACCOUNTS[11]].map((account) => ({
    account,
    limit: 5,
  })),
  find_audience_overlap: ALL_CAMPAIGNS.map((campaign) => ({ campaign: campaign.id })),
  check_consent_coverage: [
    { campaign: "camp-fall", channel: "email" },
    { campaign: "camp-holiday", channel: "sms" },
    { campaign: "camp-winter", channel: "push" },
    { campaign: "camp-coastline-weather", channel: "mobile-app" },
    { campaign: "camp-coastline-late-night", channel: "push" },
  ],
  find_similar_past_pushes: [
    { location: "los-angeles", daypart: "dinner", condition: "clear" },
    { location: "san-francisco", daypart: "late-night", condition: "fog" },
    { location: "fresno", daypart: "afternoon", condition: "heat" },
    { location: "san-diego", daypart: "breakfast", condition: "rain" },
    { location: "los-angeles", daypart: "lunch", condition: "clear", channel: "email" },
    { location: "sacramento", daypart: "dinner", condition: "heat", channel: "sms" },
  ],
  trace_content_lineage: ALL_CAMPAIGNS.map((campaign) => ({ campaign: campaign.id })),
  plan_account_outreach: [ACCOUNTS[0], ACCOUNTS[3], ACCOUNTS[11]].map((account) => ({
    account,
    limit: 5,
  })),
  assess_location_impact: ["los-angeles", "san-diego", "fresno"].map((location) => ({ location })),
  match_news_to_approved_content: [
    { event: "rate-increase", channel: "any" },
    { event: "rate-cut", channel: "email" },
    { event: "rate-hold", channel: "sms" },
    { event: "market-volatility", channel: "any" },
  ],
  prepare_deal_release: [{ deal: "deal-bayview" }],
  build_aum_account_plan: CLIENT_NAMES.map((client) => ({ client })),
  build_hcp_target_list: DRUG_IDS.map((drug) => ({ drug, limit: 16 })),
  check_clinical_claims: DRUG_IDS.map((drug) => ({ drug })),
  plan_hospital_engagement: HOSPITAL_NAMES.map((hospital) => ({ hospital })),
  map_weather_demand: [
    { location: "sacramento", conditions: ["heat"] },
    { location: "san-francisco", conditions: ["fog", "rain"] },
    { location: "fresno", conditions: ["clear", "heat"] },
  ],
};

// Averages can differ in the last floating-point digits by summation order.
const normalize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "number" ? Math.round(item * 1e6) / 1e6 : item,
    ),
  );

let failures = 0;
const latencies = [];
function compare(liveResult, fixtureResult) {
  const same = isDeepStrictEqual(normalize(liveResult), normalize(fixtureResult));
  if (!same) failures += 1;
  return same;
}
function report(label, same, ms) {
  console.log(`${same ? "match " : "DIFFER"} ${label}${ms === undefined ? "" : ` (${ms} ms)`}`);
}

for (const spec of KNOWLEDGE_GRAPH_TOOL_SPECS) {
  for (const input of cases[spec.name]) {
    const parsed = spec.input.parse(input);
    const started = performance.now();
    const liveResult = await spec.run(live, parsed);
    const ms = Math.round(performance.now() - started);
    latencies.push(ms);
    const fixtureResult = await spec.run(fixture, parsed);
    const same = compare(liveResult, fixtureResult);
    report(`${spec.name} ${JSON.stringify(input)}`, same, ms);
    if (!same) {
      console.log("  neo4j:  ", JSON.stringify(normalize(liveResult)).slice(0, 600));
      console.log("  fixture:", JSON.stringify(normalize(fixtureResult)).slice(0, 600));
    }
  }
}

// Long-term memory: the same writes against both backends, then every read compared.
const workspaceId = `parity-${crypto.randomUUID()}`;
const now = new Date();
const stamp = (offsetMinutes) => {
  const at = new Date(now.getTime() - offsetMinutes * 60_000);
  return {
    workspaceId,
    actorHash: "0123456789abcdef",
    at: at.toISOString(),
    expiresAt: new Date(at.getTime() + 14 * 86_400_000).toISOString(),
    eventId: crypto.randomUUID(),
    id: crypto.randomUUID(),
  };
};
const subjects = { salesforceIds: [], names: ["Coastline Kitchen", "Coastline Rainy Day Comfort"] };
const draft = (version, headline) => ({
  focusId: "focus-parity",
  kind: "push-message",
  title: "Coastline rainy-day push",
  summary: `Rainy-day push, version ${version}.`,
  fields: [
    { label: "Headline", value: headline },
    { label: "Brand", value: "Coastline Kitchen" },
  ],
  version,
});
const writes = [
  (backend, inputs) => rememberDraft(backend, inputs[0]),
  (backend, inputs) => rememberDraft(backend, inputs[1]),
  (backend, inputs) => recordDecision(backend, inputs[2]),
];
const inputs = [
  { ...stamp(30), source: "remembered", draft: draft(1, "Soup's on"), subjects },
  {
    ...stamp(20),
    source: "saved-to-salesforce",
    draft: draft(2, "Rain check: soup's on"),
    subjects,
  },
  {
    ...stamp(10),
    decision: {
      kind: "confirmed-write",
      outcome: "Saved the brief “Coastline rainy-day push” (21y000000000001).",
      note: "Saved from version 2 of the draft.",
    },
    record: {
      system: "salesforce",
      objectType: "Brief",
      recordId: "21y000000000001",
      title: "Coastline rainy-day push",
    },
    draftRef: { focusId: "focus-parity", version: 2 },
    subjects,
  },
];
try {
  for (const write of writes) {
    await write(live, inputs);
    await write(fixture, inputs);
  }
  const context = { workspaceId, now: () => now };
  const memoryCases = [
    ["list_memory", (backend) => listMemory(backend, workspaceId, now)],
    ...MEMORY_TOOL_SPECS.flatMap((spec) =>
      (spec.name === "recall_decisions"
        ? [{ subject: "coastline" }, { subject: "21y000000000001" }, { subject: "nothing here" }]
        : spec.name === "recall_recent_work"
          ? [{ limit: 5 }]
          : [{ memoryId: inputs[2].id }, { memoryId: inputs[1].id }]
      ).map((input) => [
        `${spec.name} ${JSON.stringify(input)}`,
        (backend) => spec.run(backend, spec.input.parse(input), context),
      ]),
    ),
  ];
  for (const [label, run] of memoryCases) {
    const started = performance.now();
    const liveResult = await run(live);
    const ms = Math.round(performance.now() - started);
    latencies.push(ms);
    const same = compare(liveResult, await run(fixture));
    report(label, same, ms);
    if (!same) {
      console.log("  neo4j:  ", JSON.stringify(normalize(liveResult)).slice(0, 900));
      console.log("  fixture:", JSON.stringify(normalize(await run(fixture))).slice(0, 900));
    }
  }
  const other = await listMemory(live, `parity-${crypto.randomUUID()}`, now);
  const isolated = other.length === 0;
  if (!isolated) failures += 1;
  report("memory is isolated by workspace", isolated);
} finally {
  for (const input of inputs) await forgetMemory(live, workspaceId, input.id);
  const left = await listMemory(live, workspaceId, now);
  console.log(`Cleaned up the parity workspace (${left.length} memories left).`);
}

const sorted = [...latencies].sort((a, b) => a - b);
const percentile = (p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const p50 = percentile(50);
const p95 = percentile(95);
console.log(
  `Neo4j tool latency over ${sorted.length} calls: p50 ${p50} ms, p95 ${p95} ms (budget: p50 under ${LATENCY_BUDGET_MS} ms).`,
);
if (p50 >= LATENCY_BUDGET_MS) {
  failures += 1;
  console.log(`DIFFER latency: p50 ${p50} ms is over the ${LATENCY_BUDGET_MS} ms budget.`);
}
console.log(
  failures
    ? `${failures} mismatches`
    : "All graph and memory tools match between Neo4j and the fixture.",
);
process.exit(failures ? 1 : 0);
